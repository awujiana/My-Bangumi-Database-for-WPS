/**
 * 锁定数据表的重复行清洗核心（与 UI 解耦，供主面板清洗按钮、富化完成后自动去重、
 * 以及通用清理页的「扫描预览 / 执行」两阶段复用）。
 * @module sync/sheet-cleaning
 * @description
 * 按「名称」列分组识别重复行：保留含 Bangumi_URL 的行、合并被删除行的
 * 「标签/分级」到保留行、批量删除无 URL 的重复行。
 * 不做任何 UI 交互（toast/弹窗），由调用方根据返回结果自行提示。
 *
 * 两阶段设计：
 * - `plan*`：**只读扫描**，产出待删除行与待写入变更（供执行前预览）；
 * - `applyRowPlan`：**写入**，先应用单元格变更、再从大到小批量删行。
 * 预览与执行走同一份计划，保证预览条数与实际执行条数严格一致。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { bgmLog, findHeaderRow, getColumnMap, getLastRow, readRangeValues, setCellValue, } from '../tools/util/index.js';
import { mergeTagValues } from './value-merge.js';
/** 未执行清洗时的空结果（附原因） */
function emptyResult(skippedReason) {
    return {
        performed: false,
        deletedRows: 0,
        mergedTagGroups: 0,
        duplicateNameGroups: 0,
        skippedReason,
    };
}
/** 空的清理计划 */
function emptyPlan(skippedReason) {
    return { deleteRows: [], changes: [], groups: 0, mergedGroups: 0, skippedReason };
}
/**
 * 解析工作表结构。失败（无表头 / 无数据行）时返回 null，由调用方记日志。
 */
export function readSheetLayout(worksheet) {
    const headerRow = findHeaderRow(worksheet);
    if (!headerRow)
        return null;
    const lastRow = getLastRow(worksheet);
    if (lastRow <= headerRow)
        return null;
    return {
        headerRow,
        lastRow,
        columnMap: getColumnMap(worksheet, headerRow),
        dataStartRow: headerRow + 1,
    };
}
/** 读取单列数据（返回按数据行顺序排列的一维数组） */
function readColumn(worksheet, layout, column) {
    return readRangeValues(worksheet, layout.dataStartRow, layout.lastRow, column, column).map((row) => row[0] ?? '');
}
/** 数据索引 → Excel 行号 */
function toRow(layout, index) {
    return layout.dataStartRow + index;
}
/** Excel 行号 → 数据索引 */
function toIndex(layout, row) {
    return row - layout.dataStartRow;
}
// 合并「 | 」分隔值的实现已下沉到 value-merge.ts（零依赖叶子模块，语义差异见其模块文档），
// 保持既有导出路径（sheet-cleaning 测试）不变。
export { mergeTagValues } from './value-merge.js';
/** 把待删行的标签并入保留行，返回合并后的值；无变化时返回 null */
function mergeVictimTags(layout, keepRow, victims, tags) {
    let merged = tags[toIndex(layout, keepRow)] ?? '';
    let isChanged = false;
    for (const row of victims) {
        const extra = tags[toIndex(layout, row)] ?? '';
        if (extra.trim()) {
            const next = mergeTagValues(merged, extra);
            if (next !== merged) {
                merged = next;
                isChanged = true;
            }
        }
    }
    return isChanged ? merged : null;
}
// ========== 1. 重复名称行 ==========
/**
 * 解析单个重复名称组：
 * - 组内保留首个含 Bangumi_URL 的行；
 * - 无 URL 的行进入待删除，其「标签/分级」并入保留行；
 * - 边界 1：组内全无 URL → 返回 null（不删，避免误删唯一数据）；
 * - 边界 2：组内多个含 URL 行的「开播日期」/「集数」不同 → 视为不同作品，返回 null。
 */
function resolveNameGroup(layout, rows, urls, tags, dates, episodes) {
    const withUrl = rows.filter((row) => (urls[toIndex(layout, row)] ?? '').trim() !== '');
    if (withUrl.length === 0)
        return null;
    if (withUrl.length >= 2 && hasDistinctValues(layout, withUrl, dates, episodes))
        return null;
    const keepRow = withUrl[0];
    if (keepRow === undefined)
        return null;
    const victims = rows.filter((row) => row !== keepRow && (urls[toIndex(layout, row)] ?? '').trim() === '');
    if (victims.length === 0)
        return null;
    return {
        keepRow,
        victims,
        mergedTags: tags ? mergeVictimTags(layout, keepRow, victims, tags) : null,
    };
}
/** 单列上是否存在 ≥2 种不同非空取值 */
function hasDistinctInColumn(layout, rows, column) {
    const values = new Set();
    for (const row of rows) {
        const value = (column[toIndex(layout, row)] ?? '').trim();
        if (value)
            values.add(value);
    }
    return values.size >= 2;
}
/** 判断给定行集合在参考列上是否存在 ≥2 种不同取值 */
function hasDistinctValues(layout, rows, dates, episodes) {
    return [dates, episodes].some((column) => column !== null && hasDistinctInColumn(layout, rows, column));
}
/**
 * 扫描「重复名称行」。
 * 按「名称」分组，保留组内首个含 Bangumi_URL 的行，删除组内无 URL 的重复行，
 * 并把被删行的「标签/分级」合并进保留行（去重）。
 */
export function planDuplicateRows(worksheet, options) {
    // 表结构优先用调用方解析好的（scanTarget 每目标一次、多规则共用）；
    // 未提供时才自行解析（plan* 可独立调用）。null = 已解析且失败，直接空计划。
    const layout = options?.layout === undefined ? readSheetLayout(worksheet) : options.layout;
    if (!layout)
        return emptyPlan('未找到表头行或无数据行');
    const nameColumn = layout.columnMap.get('名称');
    if (!nameColumn)
        return emptyPlan('未找到「名称」列');
    const urlColumn = layout.columnMap.get('Bangumi_URL');
    if (!urlColumn)
        return emptyPlan('未找到「Bangumi_URL」列');
    const tagsColumn = layout.columnMap.get('标签/分级');
    const dateColumn = layout.columnMap.get('开播日期');
    const episodesColumn = layout.columnMap.get('集数');
    const excluded = options?.excludedRows;
    const names = readColumn(worksheet, layout, nameColumn);
    const urls = readColumn(worksheet, layout, urlColumn);
    const tags = tagsColumn ? readColumn(worksheet, layout, tagsColumn) : null;
    const dates = dateColumn ? readColumn(worksheet, layout, dateColumn) : null;
    const episodes = episodesColumn ? readColumn(worksheet, layout, episodesColumn) : null;
    // 1. 按名称分组（空名称与排除行不参与）
    const groups = new Map();
    for (const [index, rawName] of names.entries()) {
        const name = rawName.trim();
        const row = toRow(layout, index);
        if (name && !excluded?.has(row)) {
            const rows = groups.get(name) ?? [];
            rows.push(row);
            groups.set(name, rows);
        }
    }
    // 2. 逐组解析
    const rowsToDelete = [];
    const changes = [];
    let groupCount = 0;
    let mergedCount = 0;
    // 执行前预览数据顺带采集（names / urls 已在内存，零额外 COM 读取）
    const rowPreviews = [];
    const groupPreviews = [];
    for (const rows of groups.values()) {
        const outcome = resolveNameGroup(layout, rows, urls, tags, dates, episodes);
        if (outcome) {
            groupCount += 1;
            rowsToDelete.push(...outcome.victims);
            if (tagsColumn && outcome.mergedTags !== null) {
                changes.push({
                    row: outcome.keepRow,
                    column: tagsColumn,
                    value: outcome.mergedTags,
                    oldValue: tags?.[toIndex(layout, outcome.keepRow)] ?? '',
                });
                mergedCount += 1;
            }
            // 组内行共享同一名称（分组键），保留行与待删行的名称相同
            const keepName = (names[toIndex(layout, outcome.keepRow)] ?? '').trim();
            const keepUrl = (urls[toIndex(layout, outcome.keepRow)] ?? '').trim();
            const victims = outcome.victims.map((row) => ({
                row,
                name: keepName,
                url: (urls[toIndex(layout, row)] ?? '').trim(),
            }));
            rowPreviews.push(...victims);
            groupPreviews.push({ keepRow: outcome.keepRow, keepName, keepUrl, victims });
        }
    }
    rowsToDelete.sort((a, b) => a - b);
    if (rowsToDelete.length === 0)
        return emptyPlan('未发现重复数据');
    return {
        deleteRows: rowsToDelete,
        changes,
        groups: groupCount,
        mergedGroups: mergedCount,
        rowPreviews,
        groupPreviews,
    };
}
// ========== 2. 同 URL 跨名称重复行 ==========
/** 同 URL 组 ≥2 行时解析保留行 / 待删行 / 合并标签；否则返回 null */
function resolveUrlGroup(layout, rows, tags) {
    if (rows.length < 2)
        return null;
    const keepRow = Math.max(...rows);
    const victims = rows.filter((row) => row !== keepRow);
    if (victims.length === 0)
        return null;
    return {
        keepRow,
        victims,
        mergedTags: tags ? mergeVictimTags(layout, keepRow, victims, tags) : null,
    };
}
/**
 * 扫描「同一 Bangumi_URL 出现在多行」的重复行（含跨名称场景）：
 * 保留行号最大的一行，合并其余行的「标签/分级」后删除其余行。
 */
export function planDuplicateUrlRows(worksheet, options) {
    const layout = options?.layout === undefined ? readSheetLayout(worksheet) : options.layout;
    if (!layout)
        return emptyPlan('未找到表头行或无数据行');
    const urlColumn = layout.columnMap.get('Bangumi_URL');
    if (!urlColumn)
        return emptyPlan('未找到「Bangumi_URL」列');
    const tagsColumn = layout.columnMap.get('标签/分级');
    const excluded = options?.excludedRows;
    const urls = readColumn(worksheet, layout, urlColumn);
    const tags = tagsColumn ? readColumn(worksheet, layout, tagsColumn) : null;
    // 同 URL 组内各行名称不同，diff 对比视图需要名称列（一次矩形读）
    const nameColumn = layout.columnMap.get('名称');
    const names = nameColumn ? readColumn(worksheet, layout, nameColumn) : null;
    const groups = new Map();
    for (const [index, rawUrl] of urls.entries()) {
        const url = rawUrl.trim();
        const row = toRow(layout, index);
        if (url && !excluded?.has(row)) {
            const rows = groups.get(url) ?? [];
            rows.push(row);
            groups.set(url, rows);
        }
    }
    const rowsToDelete = [];
    const changes = [];
    let groupCount = 0;
    let mergedCount = 0;
    // 执行前预览数据顺带采集（urls / names 已在内存，零额外 COM 读取）
    const rowPreviews = [];
    const groupPreviews = [];
    for (const rows of groups.values()) {
        const outcome = resolveUrlGroup(layout, rows, tags);
        if (outcome) {
            groupCount += 1;
            rowsToDelete.push(...outcome.victims);
            if (tagsColumn && outcome.mergedTags !== null) {
                changes.push({
                    row: outcome.keepRow,
                    column: tagsColumn,
                    value: outcome.mergedTags,
                    oldValue: tags?.[toIndex(layout, outcome.keepRow)] ?? '',
                });
                mergedCount += 1;
            }
            const keepName = names ? (names[toIndex(layout, outcome.keepRow)] ?? '').trim() : '';
            const keepUrl = (urls[toIndex(layout, outcome.keepRow)] ?? '').trim();
            const victims = outcome.victims.map((row) => ({
                row,
                name: names ? (names[toIndex(layout, row)] ?? '').trim() : '',
                url: (urls[toIndex(layout, row)] ?? '').trim(),
            }));
            rowPreviews.push(...victims);
            groupPreviews.push({ keepRow: outcome.keepRow, keepName, keepUrl, victims });
        }
    }
    rowsToDelete.sort((a, b) => a - b);
    if (rowsToDelete.length === 0)
        return emptyPlan('未发现同 URL 重复行');
    return {
        deleteRows: rowsToDelete,
        changes,
        groups: groupCount,
        mergedGroups: mergedCount,
        rowPreviews,
        groupPreviews,
    };
}
// ========== 3. 空白数据行 ==========
/**
 * 扫描数据区内部的空白行：「名称」为空，且所有已识别列均无数据。
 * 只清理数据区内部（表头行 +1 ~ 最后数据行）的空洞，不动表尾。
 */
export function planEmptyNameRows(worksheet, options) {
    const layout = options?.layout === undefined ? readSheetLayout(worksheet) : options.layout;
    if (!layout)
        return emptyPlan('未找到表头行或无数据行');
    const nameColumn = layout.columnMap.get('名称');
    if (!nameColumn)
        return emptyPlan('未找到「名称」列');
    const excluded = options?.excludedRows;
    // 单次矩形读整块数据区：原实现按列逐个读（列数 = COM 往返次数）。
    // 语义不变——仍只检查 columnMap 已识别列（表头为空的间隙列有数据时不阻止判空白）。
    const maxColumn = Math.max(...layout.columnMap.values());
    const block = readRangeValues(worksheet, layout.dataStartRow, layout.lastRow, 1, maxColumn);
    const otherColumns = [...layout.columnMap.values()].filter((column) => column !== nameColumn);
    const rowsToDelete = [];
    for (const [index, cells] of block.entries()) {
        const row = toRow(layout, index);
        const isBlank = (cells[nameColumn - 1] ?? '').trim() === '' &&
            otherColumns.every((column) => (cells[column - 1] ?? '').trim() === '');
        if (isBlank && !excluded?.has(row))
            rowsToDelete.push(row);
    }
    if (rowsToDelete.length === 0)
        return emptyPlan('未发现空白数据行');
    return {
        deleteRows: rowsToDelete,
        changes: [],
        groups: rowsToDelete.length,
        mergedGroups: 0,
        rowPreviews: rowsToDelete.map((row) => ({ row, name: '', url: '' })),
    };
}
// ========== 写入阶段 ==========
/**
 * 批量删除行：从大到小删除，并把连续行合并为单个 Range 调用，减少 COM 次数。
 * @returns 实际发生的 Range.Delete 调用次数
 */
export function deleteRowsBatched(worksheet, rows) {
    if (rows.length === 0)
        return 0;
    const sorted = [...rows].sort((a, b) => b - a);
    let callCount = 0;
    let index = 0;
    while (index < sorted.length) {
        let end = index;
        while (end + 1 < sorted.length && (sorted[end] ?? 0) - (sorted[end + 1] ?? 0) === 1) {
            end += 1;
        }
        const from = sorted[end] ?? 0;
        const to = sorted[index] ?? 0;
        worksheet
            .Range(from === to ? `${String(from)}:${String(from)}` : `${String(from)}:${String(to)}`)
            .Delete();
        callCount += 1;
        index = end + 1;
    }
    return callCount;
}
/**
 * 应用行级清理计划：先写入单元格变更，再从大到小批量删除行。
 * 变更所在行若同时处于待删除列表则跳过，避免写入即将删除的行。
 * @returns 实际删除的行数
 */
export function applyRowPlan(worksheet, plan) {
    const removedRows = new Set(plan.deleteRows);
    for (const change of plan.changes) {
        if (!removedRows.has(change.row)) {
            setCellValue(worksheet, change.row, change.column, change.value);
        }
    }
    if (plan.deleteRows.length === 0)
        return 0;
    deleteRowsBatched(worksheet, plan.deleteRows);
    return plan.deleteRows.length;
}
/**
 * 清洗指定工作表的重复行（一步到位版本，供主面板「数据清洗」按钮与富化后自动去重使用）。
 *
 * 1. 按「名称」列分组，识别重复行；
 * 2. 重复组中保留含 Bangumi_URL 的行，无 URL 的行进入待删除；
 * 3. 把被删除行的「标签/分级」合并到保留行（去重，` | ` 连接）；
 * 4. 合并连续行为范围删除，减少 COM 调用。
 */
export function cleanSheetDuplicates(worksheet) {
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[cleanSheetDuplicates] ======== 开始清洗重复行 ========');
    const plan = planDuplicateRows(worksheet);
    if (plan.deleteRows.length === 0) {
        bgmLog(LOG_LEVELS.INFO, `[cleanSheetDuplicates] 未发现需清洗的重复数据，耗时: ${String(Date.now() - startTime)}ms`);
        return emptyResult(plan.skippedReason ?? '未发现重复数据');
    }
    bgmLog(LOG_LEVELS.INFO, `[cleanSheetDuplicates] 统计: 重复名称=${String(plan.groups)}个, 待删除行=${String(plan.deleteRows.length)}, 合并标签组=${String(plan.mergedGroups)}`);
    const deleted = applyRowPlan(worksheet, plan);
    bgmLog(LOG_LEVELS.INFO, `[cleanSheetDuplicates] ======== 清洗完成: 删除 ${String(deleted)} 行，合并 ${String(plan.mergedGroups)} 个名称组的标签，耗时: ${String(Date.now() - startTime)}ms ========`);
    return {
        performed: true,
        deletedRows: deleted,
        mergedTagGroups: plan.mergedGroups,
        duplicateNameGroups: plan.groups,
    };
}
