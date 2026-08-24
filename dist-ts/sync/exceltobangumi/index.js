/**
 * @fileoverview Excel到Bangumi同步模块 - 统一导出入口
 * @module sync/exceltobangumi
 * @description 实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。
 *              支持智能表头识别、列映射构建、观看状态转换、标签处理等功能。
 *
 * 拆分结构：
 *   - exceltobangumi/api.ts：API 请求（bgmRequestSync、setBangumiToken、testTokenValidityForRibbon、openBangumiTokenPage、notifyUserInfoUpdated）
 *   - exceltobangumi/chapterMarker.ts：章节标记（fetchEpisodeIds、markEpisodesComplete）
 *   - exceltobangumi/progressReporter.ts：进度上报（SyncTask、applySyncSuccessResults、applySyncFailResults、handleStoppedRemainingTasks、finalizeSyncResults）
 *   - exceltobangumi/index.ts：常量、辅助函数、getFilterStatus、getSequentialRowsBySeqCol、buildJsonPayload、SyncToBangumiAsync、syncSelectedRows 等
 *
 * @author BGM Development Team
 * @version 1.1.0 (优化版，保留原注释和日志)
 */
import { BGM_COLOR, LOG_LEVELS, bgmLog, getApp, getCell, trim, getColumnMap, findHeaderRow, colNumToLetter, getCellValue, loadBgToken, BGM, wpsMsgBox, _getUserApiPath, readRangeValues, delay, calcFingerprint, getAllSyncRecords, isWpsWorksheet, clearSheetCache, showToast, } from '../../index.js';
import { showConfirm, showSyncProgressDialog, buildSyncConfig, updateSyncProgressDialog, completeSyncProgressDialog, hideSyncProgressDialog, } from '../../ui/dialog.js';
import { isBangumiUrl, extractSubjectId, mapWatchStatus, getSeqColIndex, addTagsFromStr, } from '../pureUtils.js';
import { getOrCreateSyncRecordSheet } from '../syncRecord.js';
// Re-export 纯函数，保持模块对外 API 兼容
export { isBangumiUrl, extractSubjectId, mapWatchStatus, getSeqColIndex, addTagsFromStr, buildTagsArray, } from '../pureUtils.js';
// Re-export 子模块公开 API
export { openBangumiTokenPage, testTokenValidityForRibbon, bgmRequestSync, setBangumiToken, notifyUserInfoUpdated, extractResponseMessage, parseErrorResponse, } from './api.js';
export { fetchEpisodeIds, markEpisodesComplete } from './chapterMarker.js';
export { TYPE_NAMES, DEFAULT_SEQ_COL, markSyncResultColor, applySyncSuccessResults, applySyncFailResults, handleStoppedRemainingTasks, finalizeSyncResults, } from './progressReporter.js';
// 子模块内部依赖（不通过 re-export 暴露给外部）
import { bgmRequestSync as _bgmRequestSync } from './api.js';
import { markEpisodesComplete as _markEpisodesComplete } from './chapterMarker.js';
import { finalizeSyncResults as _finalizeSyncResults, DEFAULT_SEQ_COL as _DEFAULT_SEQ_COL, } from './progressReporter.js';
// ========== 常量定义 (优化点：集中管理) ==========
/** 批量读取时需要获取的列名 */
const BATCH_READ_COLUMNS = [
    'Bangumi_URL',
    '名称',
    '是否看完',
    '状态',
    '观看状态',
    '打分',
    '标签/分级',
    '原作标签',
    '完播日',
    '类别',
    '剧透/感言',
    '集号',
    '集数',
    '特点/印象',
];
/** 默认并发请求数 */
const DEFAULT_CONCURRENCY = 5;
/** 请求最小间隔（毫秒） */
const MIN_REQUEST_INTERVAL = 100;
// ========== 辅助函数 (优化点：拆分复用) ==========
/**
 * 检查单元格是否已标记为同步成功（颜色判断）
 * @param ws 工作表
 * @param row 行号
 * @param seqCol 序列号列索引（可选，默认4）
 */
function isCellMarkedSuccess(ws, row, seqCol) {
    try {
        const col = seqCol || _DEFAULT_SEQ_COL;
        const cell = getCell(ws, row, col);
        if (!cell?.Interior)
            return false;
        const color = cell.Interior.Color;
        return (color === BGM_COLOR.SUCCESS ||
            color === BGM_COLOR.LIGHT_GREEN ||
            color === BGM_COLOR.DARK_GREEN);
    }
    catch {
        return false;
    }
}
/**
 * 批量读取数据并创建字段快速访问器
 * 优化点：集中批量读取，减少 COM 调用
 */
function createFieldGetter(ws, colMap, startRow, lastRow) {
    // 批量读取所有需要的数据列
    let maxCol = 1;
    for (const key of BATCH_READ_COLUMNS) {
        if (colMap.has(key))
            maxCol = Math.max(maxCol, colMap.get(key));
    }
    const allData = readRangeValues(ws, startRow, lastRow, 1, maxCol);
    return (row, key) => {
        const col = colMap.get(key);
        if (!col)
            return '';
        const rowIdx = row - startRow;
        if (allData && rowIdx >= 0 && rowIdx < allData.length) {
            const rowData = allData[rowIdx];
            if (Array.isArray(rowData) && col - 1 < rowData.length) {
                return trim(rowData[col - 1]);
            }
        }
        // 回退到逐单元格读取
        return colMap.has(key) ? trim(getCellValue(ws, row, colMap.get(key))) : '';
    };
}
// 以下纯函数（extractSubjectId / mapWatchStatus / addTagsFromStr / buildTagsArray）
// 已迁移至 ./pureUtils.js，通过顶部 import 与 re-export 引入。
/**
 * 获取筛选状态（可见行）
 * @param wsOrLastRow 工作表对象或最后行号（兼容旧用法）
 * @param lastRow 最后行号（当 wsOrLastRow 为工作表时）
 * @param headerRow 表头行号，用于排除
 * @returns hasFilter, visibleRows（不含表头和全空行）, hiddenRows
 */
export function getFilterStatus(wsOrLastRow, lastRow, headerRow, deepCheck) {
    const result = {
        hasFilter: false,
        visibleRows: [],
        hiddenRows: [],
    };
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return result;
        let ws = null;
        let effectiveLastRow;
        let effectiveHeaderRow;
        if (typeof wsOrLastRow === 'number') {
            effectiveLastRow = wsOrLastRow;
            effectiveHeaderRow = lastRow;
            ws = app.ActiveWorkbook.ActiveSheet;
            bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用 ActiveSheet（兼容模式）`);
        }
        else if (wsOrLastRow) {
            ws = wsOrLastRow;
            effectiveLastRow = lastRow;
            effectiveHeaderRow = headerRow;
            bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用传入的工作表: ${ws.Name}`);
        }
        else {
            ws = app.ActiveWorkbook.ActiveSheet;
            bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 使用 ActiveSheet（无参数）`);
        }
        if (!isWpsWorksheet(ws))
            return result;
        let autoFilterMode = false;
        try {
            autoFilterMode = !!ws.AutoFilterMode;
        }
        catch (e) {
            BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
        }
        bgmLog(LOG_LEVELS.INFO, `getFilterStatus: AutoFilterMode=${autoFilterMode}, ws.Name=${ws.Name}, deepCheck=${deepCheck}`);
        // 2. 快速检测：仅在 deepCheck 时才扫描全范围
        //    旧用法（无 deepCheck）只查 AutoFilter，这是兼容的快速路径
        if (!autoFilterMode && !deepCheck) {
            bgmLog(LOG_LEVELS.INFO, 'getFilterStatus: 快速路径：无 AutoFilter');
            return result;
        }
        // 3. 确定扫描范围（非 AutoFilter 模式需要全范围扫描隐藏行）
        const maxRow = effectiveLastRow && effectiveLastRow > 0 ? effectiveLastRow : ws.Rows.Count;
        const scanRange = ws.Range(`A1:A${maxRow}`);
        bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 扫描范围 A1:A${maxRow}`);
        // 4. 获取可见单元格来检测筛选/隐藏行
        let visibleCells = null;
        if (autoFilterMode) {
            try {
                if (ws.AutoFilter?.Range) {
                    visibleCells = ws.AutoFilter.Range.SpecialCells(12);
                    bgmLog(LOG_LEVELS.INFO, `getFilterStatus: AutoFilter 模式`);
                }
            }
            catch (e) {
                BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
            }
        }
        else {
            // deepCheck 模式：用全范围检测手动隐藏行
            try {
                visibleCells = scanRange.SpecialCells(12);
            }
            catch {
                /* 所有行可见时抛出异常，忽略 */
            }
        }
        if (!visibleCells) {
            bgmLog(LOG_LEVELS.INFO, 'getFilterStatus: 无筛选');
            return result;
        }
        // 5. 快速判断：可见行数 ≈ 总行数 → 无隐藏行（仅对非 AutoFilter 的 deepCheck 模式）
        if (!autoFilterMode) {
            try {
                const totalCount = scanRange.Count;
                const visibleCount = visibleCells.Count;
                if (visibleCount >= totalCount) {
                    bgmLog(LOG_LEVELS.INFO, `getFilterStatus: 所有 ${maxRow} 行均可见，无筛选`);
                    return result;
                }
            }
            catch {
                /* Count 异常则继续走完整检测 */
            }
        }
        result.hasFilter = true;
        // 6. 提取所有可见行号（去重）
        const rawRows = new Set();
        if (visibleCells) {
            const areas = [];
            try {
                if (visibleCells.Areas) {
                    for (let a = 1; a <= visibleCells.Areas.Count; a++) {
                        areas.push(visibleCells.Areas.Item(a));
                    }
                }
                else {
                    areas.push(visibleCells);
                }
            }
            catch (e) {
                BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
                areas.push(visibleCells);
            }
            for (const area of areas) {
                const rows = area.Rows;
                for (let r = 1; r <= rows.Count; r++) {
                    rawRows.add(rows.Item(r).Row);
                }
            }
            bgmLog(LOG_LEVELS.INFO, `SpecialCells 收集到 ${rawRows.size} 个原始行号`);
            const rowList = Array.from(rawRows).sort((a, b) => a - b);
            // 仅打印行号摘要，不逐行读取单元格值（避免大量 COM 调用导致卡顿）
            bgmLog(LOG_LEVELS.INFO, `  前 ${Math.min(rowList.length, 10)} 行: ${rowList.slice(0, 10).join(', ')}`);
            if (rowList.length > 10) {
                bgmLog(LOG_LEVELS.INFO, `  ... 剩余 ${rowList.length - 10} 行省略`);
            }
        }
        // 6. 生成最终可见行列表（排除表头行）
        for (const r of rawRows) {
            if (effectiveHeaderRow != null && r === effectiveHeaderRow)
                continue;
            result.visibleRows.push(r);
        }
        result.visibleRows.sort((a, b) => a - b);
        bgmLog(LOG_LEVELS.INFO, `有效可见数据行: ${result.visibleRows.length} 行`);
        if (result.visibleRows.length > 0) {
            bgmLog(LOG_LEVELS.INFO, `可见行前10: ${result.visibleRows.slice(0, 10).join(',')}`);
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'getFilterStatus', showAlert: false });
    }
    return result;
}
/**
 * 根据序列号列获取连续的有效行
 *
 * @function getSequentialRowsBySeqCol
 * @param {number} startRow - 起始行
 * @param {number} endRow - 结束行
 * @param {Map<string, number>} [colMap] - 列映射（可选）
 * @returns {{ validRows: number[]; seqMap: Map<string, number> }} 有效行和序列号映射
 *
 * @description
 * 扫描序列号列，找出有序列号的数据行。
 * 序列号格式应为数字，用于标记同步进度。
 */
export function getSequentialRowsBySeqCol(startRow, endRow, colMap) {
    const result = {
        validRows: [],
        seqMap: new Map(),
    };
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook)
            return result;
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws)
            return result;
        const seqCol = getSeqColIndex(colMap);
        for (let r = startRow; r <= endRow; r++) {
            try {
                const val = getCellValue(ws, r, seqCol);
                if (val !== null && val !== undefined && val !== '') {
                    const seqNum = String(val).trim();
                    if (/^\d+$/.test(seqNum)) {
                        result.validRows.push(r);
                        result.seqMap.set(seqNum, r);
                    }
                }
            }
            catch (e) {
                BGM.handleError(e, { context: 'getSequentialRowsBySeqCol', showAlert: false });
            }
        }
    }
    catch (e) {
        BGM.handleError(e, { context: 'getSequentialRowsBySeqCol', showAlert: false });
    }
    return result;
}
/**
 * 构建API请求的JSON Payload
 *
 * @function buildJsonPayload
 * @param {WpsWorksheet} ws - 工作表对象
 * @param {number} rowNum - 数据行号
 * @param {Map<string, number>} colMap - 列映射
 * @param {string} finishedDate - 完播日期
 * @returns {string} JSON格式的请求体
 *
 * @description
 * 根据工作表中的数据构建Bangumi API所需的JSON格式。
 * 包含字段：type（状态）、rate（评分）、tags（标签）、
 * comment（感言）、private（是否私有）
 */
export function buildJsonPayload(getField, _finishedDate) {
    try {
        const payload = {};
        // 观看状态 - 支持多种列名
        const statusKeys = ['是否看完', '状态', '观看状态', '收藏类型', 'type'];
        let statusFound = false;
        let rawStatusValue = '';
        for (const key of statusKeys) {
            const statusVal = trim(getField(key));
            if (statusVal) {
                rawStatusValue = statusVal;
                const mappedStatus = mapWatchStatus(statusVal);
                if (mappedStatus !== undefined && mappedStatus > 0) {
                    payload.type = mappedStatus;
                    statusFound = true;
                    bgmLog(LOG_LEVELS.INFO, `[buildJsonPayload] 从列 "${key}" 读取状态: "${statusVal}" -> ${mappedStatus}`);
                    break;
                }
                else {
                    bgmLog(LOG_LEVELS.WARN, `[buildJsonPayload] 从列 "${key}" 读取状态: "${statusVal}" -> ${mappedStatus} (无效)`);
                }
            }
        }
        if (!statusFound) {
            if (!rawStatusValue) {
                // 所有状态字段为空 → 默认视为「想看」(status=1)
                payload.type = 1;
                bgmLog(LOG_LEVELS.INFO, `[buildJsonPayload] 未找到观看状态，默认设为「想看」(type=1)`);
            }
            else {
                bgmLog(LOG_LEVELS.ERROR, `[buildJsonPayload] 未找到有效的观看状态，返回空对象，原始值: "${rawStatusValue}"`);
                return '{}';
            }
        }
        // 评分
        const rateVal = trim(getField('打分'));
        if (rateVal && rateVal !== 'true' && rateVal !== 'True') {
            const rate = parseFloat(rateVal);
            if (!isNaN(rate) && rate >= 0 && rate <= 10) {
                payload.rate = rate;
            }
        }
        // 标签 - 合并 "标签/分级" 与 "原作标签" 两列
        const tagSet = new Set();
        const tagsGradeVal = trim(getField('标签/分级'));
        const originalTagVal = trim(getField('原作标签'));
        if (tagsGradeVal)
            addTagsFromStr(tagSet, tagsGradeVal);
        if (originalTagVal)
            addTagsFromStr(tagSet, originalTagVal);
        if (tagSet.size > 0) {
            payload.tags = Array.from(tagSet);
            bgmLog(LOG_LEVELS.INFO, `[buildJsonPayload] 标签合并: 标签/分级="${tagsGradeVal || '(空)'}" + 原作标签="${originalTagVal || '(空)'}" -> ${JSON.stringify(payload.tags)}`);
        }
        // 感言（支持 emoji、中文、日文等 UTF-8 字符；过滤控制字符并截断到 1000 字符）
        let commentVal = trim(getField('剧透/感言') || getField('感言'));
        const nVal = trim(getField('特点/印象'));
        bgmLog(LOG_LEVELS.INFO, `[buildJsonPayload] 剧透/感言="${commentVal}", 特点/印象="${nVal}"`);
        if (nVal) {
            commentVal = commentVal ? `${commentVal}\n${nVal}` : nVal;
        }
        if (commentVal) {
            // 移除控制字符（保留换行符 \n 和制表符 \t）
            // eslint-disable-next-line no-control-regex -- 有意匹配控制字符以清洗文本
            const cleaned = commentVal.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
            // Bangumi API comment 字段长度限制约 1000 字符，超出截断
            const MAX_COMMENT_LEN = 1000;
            const finalComment = cleaned.length > MAX_COMMENT_LEN ? cleaned.slice(0, MAX_COMMENT_LEN) : cleaned;
            if (finalComment) {
                payload.comment = finalComment;
                if (cleaned.length > MAX_COMMENT_LEN) {
                    bgmLog(LOG_LEVELS.WARN, `[buildJsonPayload] 感言长度 ${cleaned.length} 超过 ${MAX_COMMENT_LEN}，已截断`);
                }
            }
        }
        // 隐私收藏
        const privateVal = trim(getField('私密收藏')).toLowerCase();
        if (privateVal === '是' || privateVal === '1' || privateVal === 'true') {
            payload.private = true;
        }
        return JSON.stringify(payload);
    }
    catch (e) {
        BGM.handleError(e, { context: 'buildJsonPayload', showAlert: false });
        return '{}';
    }
}
/**
 * 获取可见行（数据获取层 - 步骤1）
 * 根据筛选状态确定需要处理的行号列表；无筛选时返回 [startRow, lastRow] 全量行。
 * @param ws 工作表
 * @param startRow 起始数据行
 * @param lastRow 最后一行
 * @param headerRow 表头行（用于排除）
 * @returns 待处理的行号数组
 */
function fetchVisibleRowsForSync(ws, startRow, lastRow, headerRow) {
    const filterStatus = getFilterStatus(ws, lastRow, headerRow, true);
    if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
        const rows = filterStatus.visibleRows.filter((r) => r >= startRow);
        bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 筛选模式：处理 ${rows.length} 个可见行`);
        return rows;
    }
    const rows = [];
    for (let r = startRow; r <= lastRow; r++)
        rows.push(r);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 总行数: ${rows.length}`);
    return rows;
}
/**
 * 构建历史指纹映射（数据获取层 - 步骤3）
 * 增量同步模式下从同步记录加载历史指纹，用于后续对比跳过未变更项。
 * @param incremental 是否启用增量同步
 * @returns 指纹映射（sid -> fingerprint）；未启用增量时返回 undefined
 */
function buildFingerprintMap(incremental) {
    if (!incremental)
        return undefined;
    bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 正在加载历史同步记录...');
    const allRecords = getAllSyncRecords();
    const fingerprintMap = new Map();
    for (const r of allRecords) {
        if (r.sid && r.fingerprint) {
            fingerprintMap.set(r.sid, r.fingerprint);
        }
    }
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 增量同步模式：已加载 ${fingerprintMap.size} 条历史指纹`);
    return fingerprintMap;
}
/**
 * 处理单行数据并转换为同步任务（业务处理层 - 步骤4循环体）
 * 校验链：URL → SID → 冲突跳过 → 观看状态 → 状态类型 → 指纹对比 → 颜色标记 → 构建 SyncTask。
 * 任何校验失败均返回 skipped=true；异常返回 failed=true。
 * @param ws 工作表
 * @param rowNum 当前行号
 * @param getField 字段访问器（基于批量缓存）
 * @param skipSids 需跳过的 SID 集合（冲突处理）
 * @param fingerprintMap 历史指纹映射（增量同步用）
 * @param seqCol 序列号列索引（用于颜色检查）
 * @returns 处理结果：task 有值表示需要同步
 */
function processRowToSyncTask(ws, rowNum, getField, skipSids, fingerprintMap, seqCol) {
    try {
        const bgmUrl = getField(rowNum, 'Bangumi_URL');
        if (!bgmUrl)
            return { task: null, skipped: true, failed: false };
        const sid = extractSubjectId(bgmUrl);
        if (!sid)
            return { task: null, skipped: true, failed: false };
        // 冲突跳过
        if (skipSids && skipSids.has(sid)) {
            return { task: null, skipped: true, failed: false };
        }
        // 读取观看状态（空状态视为「想看」，由 mapWatchStatus 返回 1）
        const watchStatusField = getField(rowNum, '是否看完') || getField(rowNum, '状态') || getField(rowNum, '观看状态');
        // 获取观看状态类型（空值 → 1=想看，未识别 → 0 跳过）
        const watchType = mapWatchStatus(watchStatusField);
        if (watchType === 0) {
            return { task: null, skipped: true, failed: false };
        }
        // 增量同步指纹检查（标签包含 标签/分级 + 原作标签，与 buildJsonPayload 保持一致）
        let currentFingerprint;
        if (fingerprintMap) {
            currentFingerprint = calcFingerprint([
                getField(rowNum, '名称'),
                watchType.toString(),
                getField(rowNum, '打分'),
                getField(rowNum, '标签/分级'),
                getField(rowNum, '原作标签'),
                getField(rowNum, '剧透/感言'),
                getField(rowNum, '集数'),
                getField(rowNum, '集号'),
            ]);
            const storedFingerprint = fingerprintMap.get(sid);
            if (storedFingerprint === currentFingerprint) {
                return { task: null, skipped: true, failed: false };
            }
        }
        // 检查已上传颜色（非增量模式）
        if (!fingerprintMap && isCellMarkedSuccess(ws, rowNum, seqCol)) {
            return { task: null, skipped: true, failed: false };
        }
        const finishedDate = getField(rowNum, '完播日');
        const jsonBody = buildJsonPayload((key) => getField(rowNum, key), finishedDate);
        const name = getField(rowNum, '名称');
        const epRaw = trim(getField(rowNum, '集数') || getField(rowNum, '集号') || '');
        const epNum = parseInt(epRaw, 10);
        const task = {
            rowNum,
            sid,
            bgmUrl,
            name,
            jsonBody,
            ...(currentFingerprint !== undefined ? { fingerprint: currentFingerprint } : {}),
            type: watchType,
            ...(!isNaN(epNum) && epNum > 0 ? { epCount: epNum } : {}),
        };
        return { task, skipped: false, failed: false };
    }
    catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.WARN, context: 'SyncToBangumiAsync:preprocess' });
        return { task: null, skipped: false, failed: true };
    }
}
/**
 * 预处理同步任务（协调函数 - 步骤 1-4）
 * 协调 fetchVisibleRowsForSync → buildFingerprintMap → processRowToSyncTask 三个子步骤，
 * 完成筛选可见行、批量读取数据缓存、构建历史指纹映射、收集所有需要同步的任务。
 * @param ws 工作表
 * @param colMap 列映射
 * @param options 同步选项
 * @param startRow 起始数据行（headerRow + 1）
 * @param lastRow 最后一行
 * @param seqCol 序列号列索引
 * @returns 待同步任务列表及预处理阶段的跳过/失败计数
 */
function prepareSyncTasks(ws, colMap, options, startRow, lastRow, seqCol) {
    let skip = 0;
    let fail = 0;
    const headerRow = startRow - 1;
    // 步骤1：获取可见行（数据获取）
    const rowsToProcess = fetchVisibleRowsForSync(ws, startRow, lastRow, headerRow);
    // 步骤2：批量读取数据缓存（性能关键）
    const getField = createFieldGetter(ws, colMap, startRow, lastRow);
    // 步骤3：构建历史指纹映射（数据获取）
    const fingerprintMap = buildFingerprintMap(options?.incremental);
    // 步骤4：预处理收集同步任务（业务处理）
    bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 步骤4: 预处理收集同步任务');
    const syncTasks = [];
    const skipSids = options?.skipSids;
    for (const rowNum of rowsToProcess) {
        const outcome = processRowToSyncTask(ws, rowNum, getField, skipSids, fingerprintMap, seqCol);
        if (outcome.failed) {
            fail++;
        }
        else if (outcome.skipped) {
            skip++;
        }
        else if (outcome.task) {
            syncTasks.push(outcome.task);
        }
    }
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 预处理完成：${syncTasks.length} 条待同步，${skip} 条跳过（失败${fail}条）`);
    return { syncTasks, skip, fail };
}
/**
 * 批量执行同步请求（并发控制）
 * 优化点：提取独立函数，保留所有原有日志
 * @param tasks 同步任务列表
 * @param token API Token
 * @param userIdPath 用户路径
 * @param concurrency 并发数
 * @param onProgress 进度回调（current=已完成数, total=总数, message=描述）
 * @returns 成功和失败的任务列表以及是否停止
 */
async function batchSyncRequests(tasks, token, userIdPath, concurrency = DEFAULT_CONCURRENCY, onProgress) {
    const success = [];
    const fail = [];
    let lastRequestTime = 0;
    let stopped = false;
    const total = tasks.length;
    const queue = [...tasks];
    const executing = [];
    while (queue.length > 0 || executing.length > 0) {
        if (BGM.sync.checkShouldStop()) {
            bgmLog(LOG_LEVELS.INFO, '[batchSyncRequests] 检测到停止请求，正在停止...');
            stopped = true;
            if (executing.length > 0) {
                await Promise.all(executing.map((e) => e.promise));
            }
            break;
        }
        // 暂停检查：如果用户请求暂停，等待恢复后再继续
        if (BGM.sync.checkPaused()) {
            bgmLog(LOG_LEVELS.INFO, `[batchSyncRequests] 同步已暂停，剩余 ${queue.length} 个任务，等待恢复...`);
            await BGM.sync.waitForResume();
            if (BGM.sync.checkShouldStop()) {
                bgmLog(LOG_LEVELS.INFO, '[batchSyncRequests] 暂停期间收到停止请求，正在停止...');
                stopped = true;
                if (executing.length > 0) {
                    await Promise.all(executing.map((e) => e.promise));
                }
                break;
            }
            bgmLog(LOG_LEVELS.INFO, '[batchSyncRequests] 同步已恢复，继续处理');
        }
        while (executing.length < concurrency && queue.length > 0) {
            const task = queue.shift();
            // 更新当前行号（工作表和列在调用方 SyncToBangumiAsync 中已通过 updatePosition 设置）
            BGM.sync.updatePosition(undefined, task.rowNum);
            const entry = { promise: null, task, done: false };
            entry.promise = (async () => {
                try {
                    const now = Date.now();
                    const elapsed = now - lastRequestTime;
                    if (elapsed < MIN_REQUEST_INTERVAL) {
                        await delay(MIN_REQUEST_INTERVAL - elapsed);
                    }
                    const apiResult = await _bgmRequestSync('POST', `/v0/users${userIdPath}/collections/${task.sid}`, task.jsonBody, token);
                    lastRequestTime = Date.now();
                    // 防御：_bgmRequestSync 在极端异常下可能返回 undefined，避免后续访问属性抛错
                    if (!apiResult) {
                        fail.push(task);
                        bgmLog(LOG_LEVELS.ERROR, `[batchSyncRequests] SID ${task.sid} 请求返回异常：apiResult 为 undefined`);
                        return;
                    }
                    if (apiResult.code >= 200 && apiResult.code < 300) {
                        success.push(task);
                        bgmLog(LOG_LEVELS.INFO, `[batchSyncRequests] SID ${task.sid} 同步成功，HTTP ${apiResult.code}`);
                        // 标记章节为已完成（仅"看过" type=2 需要标记章节；"在看" ）
                        if (task.type === 2 && task.epCount && task.epCount > 0) {
                            try {
                                bgmLog(LOG_LEVELS.INFO, `[batchSyncRequests] SID ${task.sid} 状态"看过"(type=2)，集数: ${task.epCount}，开始标记章节...`);
                                const epResult = await _markEpisodesComplete(task.sid, task.epCount, token);
                                bgmLog(LOG_LEVELS.INFO, `[batchSyncRequests] SID ${task.sid} 章节标记结果: ${epResult.message}`);
                            }
                            catch (epErr) {
                                bgmLog(LOG_LEVELS.WARN, `[batchSyncRequests] SID ${task.sid} 章节标记异常: ${epErr instanceof Error ? epErr.message : String(epErr)}`);
                            }
                        }
                        else if (task.type === 3 && task.epCount && task.epCount > 0) {
                            bgmLog(LOG_LEVELS.INFO, `[batchSyncRequests] SID ${task.sid} 状态"在看"(type=3)，跳过章节标记`);
                        }
                        else if (task.epCount && task.epCount > 0) {
                            bgmLog(LOG_LEVELS.INFO, `[batchSyncRequests] SID ${task.sid} 状态非"看过"(type=${task.type})，跳过章节标记`);
                        }
                    }
                    else {
                        fail.push(task);
                        bgmLog(LOG_LEVELS.WARN, `[batchSyncRequests] SID ${task.sid} 同步失败，HTTP ${apiResult.code}，消息: ${apiResult.message}`);
                    }
                }
                catch (e) {
                    fail.push(task);
                    bgmLog(LOG_LEVELS.ERROR, `[batchSyncRequests] SID ${task.sid} 同步异常: ${e instanceof Error ? e.message : String(e)}`);
                }
                finally {
                    entry.done = true;
                    // 报告进度（每完成一个任务回调一次）
                    if (onProgress) {
                        const completed = success.length + fail.length;
                        try {
                            onProgress(completed, total, `同步中 ${completed}/${total}`);
                        }
                        catch (e) {
                            bgmLog(LOG_LEVELS.WARN, `[batchSyncRequests] onProgress 回调异常: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }
                }
            })();
            executing.push(entry);
        }
        if (executing.length > 0) {
            await Promise.race(executing.map((e) => e.promise));
            for (let i = executing.length - 1; i >= 0; i--) {
                if (executing[i].done)
                    executing.splice(i, 1);
            }
        }
    }
    return { success, fail, stopped };
}
/**
 * 批量执行同步请求（步骤 5）：创建同步记录表、设置同步状态机位置、调用 batchSyncRequests。
 * @param syncTasks 待同步任务列表
 * @param token API Token
 * @param userIdPath 用户 API 路径
 * @param options 同步选项
 * @param ws 工作表
 * @param headerRow 表头行
 * @param seqCol 序列号列索引
 * @returns 成功/失败任务列表及是否被停止
 */
async function executeBatchSync(syncTasks, token, userIdPath, options, ws, headerRow, seqCol) {
    // 尝试创建同步记录表
    try {
        getOrCreateSyncRecordSheet();
    }
    catch (e) {
        BGM.handleError(e, { level: BGM.ErrorLevel.WARN, context: 'SyncToBangumiAsync:createSheet' });
    }
    bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 步骤5: 开始批量同步请求');
    // 设置同步状态机的当前位置（工作表 + 序列号列），供暂停时定位
    BGM.sync.updatePosition(ws, headerRow, seqCol);
    const { success: successTasks, fail: failTasks, stopped, } = await batchSyncRequests(syncTasks, token, userIdPath, DEFAULT_CONCURRENCY, options?.onProgress);
    return { successTasks, failTasks, stopped };
}
export async function SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, options) {
    const result = { success: 0, fail: 0, skip: 0, stopped: false };
    const startRow = headerRow + 1;
    const startTime = Date.now();
    const seqCol = getSeqColIndex(colMap);
    const userIdPath = _getUserApiPath();
    bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] ========== 开始批量同步 ==========');
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 配置参数：`);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 增量同步模式: ${options?.incremental ? '开启' : '关闭'}`);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 跳过冲突数量: ${options?.skipSids?.size || 0}`);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 表头行: ${headerRow}`);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 最后一行: ${lastRow}`);
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync]   - 序列号列: ${seqCol} (列${colNumToLetter(seqCol)})`);
    // 步骤 1-4: 预处理（筛选可见行 + 数据缓存 + 指纹映射 + 任务收集）
    const { syncTasks, skip, fail } = prepareSyncTasks(ws, colMap, options, startRow, lastRow, seqCol);
    result.skip = skip;
    result.fail = fail;
    // 步骤 5: 批量执行同步请求（并发控制）
    const { successTasks, failTasks, stopped } = await executeBatchSync(syncTasks, token, userIdPath, options, ws, headerRow, seqCol);
    // 步骤 6: 批量更新 UI 和记录
    const reportProgress = (current, message) => {
        if (options?.onProgress)
            options.onProgress(current, syncTasks.length, message);
    };
    _finalizeSyncResults(ws, seqCol, successTasks, failTasks, syncTasks, stopped, result, startTime, reportProgress);
    return result;
}
/**
 * 从当前选中区域收集行号（含非连续区域 Areas 处理）
 * @param app WPS Application 对象
 * @returns 原始行号数组；若未选中或异常则返回空数组（已提示用户）
 */
function collectSelectedRows(app) {
    const rawRows = [];
    try {
        const sel = app.Selection;
        if (!sel) {
            bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] 未选中任何区域');
            wpsMsgBox('请先在Excel中选中要同步的数据行', 0, 48);
            return rawRows;
        }
        // 记录选中区域地址用于调试
        let selAddress = '';
        try {
            selAddress = sel.Address || '';
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, '[exceltobangumi] 获取地址失败: ' + (e instanceof Error ? e.message : String(e)));
            selAddress = '(无法获取)';
        }
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] Selection.Address: ${selAddress}`);
        // 处理非连续选择（多区域）
        const areas = sel.Areas;
        const areaCount = areas?.Count ?? 1;
        if (areaCount > 1 && areas) {
            // 非连续选择：遍历每个 Area 收集行号
            bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 检测到非连续选择，共 ${areaCount} 个区域`);
            for (let ai = 1; ai <= areaCount; ai++) {
                const area = areas.Item(ai);
                const aStartRow = area.Row;
                const aRowCount = area.Rows.Count;
                for (let r = aStartRow; r < aStartRow + aRowCount; r++) {
                    if (!rawRows.includes(r))
                        rawRows.push(r);
                }
            }
        }
        else {
            // 连续选择：直接读取
            const startRow = sel.Row;
            const rowCount = sel.Rows.Count;
            for (let r = startRow; r < startRow + rowCount; r++) {
                rawRows.push(r);
            }
        }
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 选中区域: ${rawRows.length} 行，行号 ${Math.min(...rawRows)}-${Math.max(...rawRows)}`);
    }
    catch (e) {
        BGM.handleError(e, { context: 'syncSelectedRows', showAlert: false });
        wpsMsgBox('获取选中区域失败，请检查是否选中了有效区域', 0, 48);
        return [];
    }
    return rawRows;
}
/**
 * 校验选中行并准备同步所需数据（排除表头、阈值确认、构建列映射、加载 Token）
 * @param ws 工作表
 * @param rawRows 原始选中行号
 * @param headerRow 表头行号
 * @returns 准备结果（rows/colMap/token）；若校验失败则返回 null（已提示用户）
 */
async function validateSelectedRows(ws, rawRows, headerRow) {
    // 排除表头行
    const rows = rawRows.filter((r) => r > headerRow);
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 排除表头后有效数据行: ${rows.length} 行（原始选中 ${rawRows.length} 行）`);
    if (rows.length === 0) {
        bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] 排除表头后没有有效数据行');
        showToast('未选中任何数据行', 'warn');
        return null;
    }
    // 选中行数超过阈值时弹出确认对话框
    if (rows.length > 10) {
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 选中 ${rows.length} 行，弹出确认对话框`);
        const confirmed = await new Promise((resolve) => {
            showConfirm(`选中了 ${rows.length} 行数据，确认要同步全部吗？\n\n行号范围: ${Math.min(...rows)} - ${Math.max(...rows)}`, (result) => resolve(result), '批量同步确认');
        });
        if (!confirmed) {
            bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 用户取消同步');
            wpsMsgBox('已取消同步', 0, 64);
            return null;
        }
    }
    clearSheetCache(ws);
    const colMap = getColumnMap(ws, headerRow);
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 列映射完成，共 ${colMap.size} 列`);
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 集数列号: ${colMap.get('集数')}, 集号列号: ${colMap.get('集号')}, Bangumi_URL列号: ${colMap.get('Bangumi_URL')}`);
    if (!colMap.has('Bangumi_URL')) {
        bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] 未找到 Bangumi_URL 列');
        wpsMsgBox('未找到 Bangumi URL 列', 0, 48);
        return null;
    }
    const token = loadBgToken();
    if (!token) {
        bgmLog(LOG_LEVELS.WARN, '[syncSelectedRows] Token 未设置');
        wpsMsgBox('请先设置 Token', 0, 48);
        return null;
    }
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] Token 已设置（长度: ${token.length}）`);
    return { rows, colMap, token };
}
/**
 * 执行选中行同步（启动状态机、显示进度弹窗、循环同步、完成弹窗、异常处理、重置状态机）
 * @param ws 工作表
 * @param rows 待同步行号数组（已排除表头）
 * @param colMap 列映射
 * @param token Bangumi Token
 * @param headerRow 表头行号
 * @param startTime 同步开始时间戳（用于耗时统计）
 */
async function executeSelectedSync(ws, rows, colMap, token, headerRow, startTime) {
    let enteredRunning = false;
    try {
        const urlCol = colMap.get('Bangumi_URL');
        const nameCol = colMap.has('名称') ? colMap.get('名称') : undefined;
        const userPath = _getUserApiPath();
        let successCount = 0;
        let failCount = 0;
        let skipCount = 0;
        let episodeMarkCount = 0;
        const details = [];
        // P2：进入运行状态（防重入 + 重置标志 + 置位）
        if (!BGM.sync.enterRunningState())
            return;
        enteredRunning = true;
        const selectedRowsConfig = buildSyncConfig({
            source: '当前工作表',
            strategy: '选中行同步',
            direction: 'Excel → Bangumi',
            selectedRowsOnly: true,
            extra: [
                { label: '选中行数', value: String(rows.length) },
                { label: '行号范围', value: rows.length > 0 ? `${rows[0]}~${rows[rows.length - 1]}` : '-' },
            ],
        });
        // P1：显示同步进度弹窗（新 API：handlers 对象，暂停状态由 dialog 内部管理）
        showSyncProgressDialog('正在同步 - 选中行同步', {
            onPause: () => BGM.sync.pause(),
            onResume: () => BGM.sync.resume(),
            onStop: () => BGM.sync.requestStop(),
        }, selectedRowsConfig);
        // 设置同步状态机位置（用于暂停时定位到单元格）
        BGM.sync.updatePosition(ws, 0, urlCol);
        for (let idx = 0; idx < rows.length; idx++) {
            // 检查停止
            if (BGM.sync.checkShouldStop()) {
                bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 检测到停止请求，终止循环');
                break;
            }
            // 暂停检查：等待恢复后再继续
            if (BGM.sync.checkPaused()) {
                bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 同步已暂停，当前进度 ${idx}/${rows.length}，等待恢复...`);
                await BGM.sync.waitForResume();
                if (BGM.sync.checkShouldStop()) {
                    bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 暂停期间收到停止请求，终止循环');
                    break;
                }
                bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 同步已恢复，继续处理');
            }
            const rowNum = rows[idx];
            const rowProgress = `[${idx + 1}/${rows.length}]`;
            // 更新当前位置（行号），供暂停时定位
            BGM.sync.updatePosition(undefined, rowNum);
            try {
                const bgmUrl = trim(getCellValue(ws, rowNum, urlCol) || '');
                const name = nameCol
                    ? trim(getCellValue(ws, nameCol === urlCol ? rowNum : rowNum, nameCol) || '')
                    : '';
                if (!bgmUrl) {
                    const msg = `行${rowNum} "${name || '无名'}" URL为空，跳过`;
                    bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${msg}`);
                    showToast(msg, 'warn');
                    details.push(`⊘ 行${rowNum} ${name || '无名'} 跳过: URL为空`);
                    skipCount++;
                    updateSyncProgressDialog(idx + 1, rows.length, msg, `⊘ ${rowProgress} ${msg}`);
                    continue;
                }
                // 检查是否为 BGM 链接（bgm.tv / bangumi.tv / chii.in 或纯数字 ID）
                if (!isBangumiUrl(bgmUrl)) {
                    const msg = `行${rowNum} "${name || '无名'}" 非BGM链接，跳过`;
                    bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${msg}`);
                    showToast(msg, 'warn');
                    details.push(`⊘ 行${rowNum} ${name || '无名'} 跳过: 非BGM链接 (${bgmUrl.substring(0, 30)})`);
                    skipCount++;
                    updateSyncProgressDialog(idx + 1, rows.length, msg, `⊘ ${rowProgress} ${msg}`);
                    continue;
                }
                const sid = extractSubjectId(bgmUrl);
                if (!sid) {
                    const msg = `行${rowNum} "${name || '无名'}" 无法提取 Subject ID，跳过`;
                    bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${msg}`);
                    showToast(msg, 'warn');
                    details.push(`⊘ 行${rowNum} ${name || '无名'} 跳过: 无效ID`);
                    skipCount++;
                    updateSyncProgressDialog(idx + 1, rows.length, msg, `⊘ ${rowProgress} ${msg}`);
                    continue;
                }
                bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} 开始同步: 名称="${name || '无名'}", SID=${sid}, URL=${bgmUrl}`);
                updateSyncProgressDialog(idx + 1, rows.length, `${rowProgress} 行${rowNum} "${name || sid}" 同步中...`, `⏳ ${rowProgress} 行${rowNum} "${name || sid}" SID=${sid} 开始同步`);
                const finishedDate = colMap.has('完播日')
                    ? trim(getCellValue(ws, rowNum, colMap.get('完播日')) || '')
                    : '';
                const jsonBody = buildJsonPayload((key) => (colMap.has(key) ? trim(getCellValue(ws, rowNum, colMap.get(key))) : ''), finishedDate);
                if (jsonBody === '{}') {
                    const msg = `行${rowNum} "${name || sid}" 请求体为空，跳过`;
                    bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} ${msg}`);
                    showToast(msg, 'warn');
                    details.push(`⊘ 行${rowNum} ${name || sid} 跳过: 请求体为空`);
                    skipCount++;
                    updateSyncProgressDialog(idx + 1, rows.length, msg, `⊘ ${rowProgress} ${msg}`);
                    continue;
                }
                bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} 请求体: ${jsonBody.length > 300 ? jsonBody.substring(0, 300) + '...' : jsonBody}`);
                const endpoint = `/v0/users${userPath}/collections/${sid}`;
                const result = await _bgmRequestSync('POST', endpoint, jsonBody, token);
                if (result.code >= 200 && result.code < 300) {
                    successCount++;
                    details.push(`✓ 行${rowNum} ${name || sid} HTTP:${result.code}`);
                    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} "${name || sid}" 同步成功！HTTP: ${result.code}`);
                    updateSyncProgressDialog(idx + 1, rows.length, `${rowProgress} 行${rowNum} "${name || sid}" ✓ HTTP:${result.code}`, `✓ ${rowProgress} 行${rowNum} "${name || sid}" 成功 HTTP:${result.code}`);
                    // 标记章节为已完成（"看过" type=2 和 "在看" type=3 都需要标记）
                    let watchType = 0;
                    try {
                        watchType = JSON.parse(jsonBody).type;
                    }
                    catch (parseErr) {
                        bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] 行${rowNum} jsonBody 解析失败: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
                    }
                    const epRaw = trim(getCellValue(ws, rowNum, colMap.has('集数') ? colMap.get('集数') : colMap.get('集号')));
                    const epCount = parseInt(epRaw, 10);
                    if ((watchType === 2 || watchType === 3) && !isNaN(epCount) && epCount > 0) {
                        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} 状态${watchType === 2 ? '"看过"' : '"在看"'}(type=${watchType})，集数: ${epCount}，开始标记章节...`);
                        const epResult = await _markEpisodesComplete(sid, epCount, token);
                        episodeMarkCount++;
                        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} 章节标记结果: ${epResult.message}`);
                    }
                    else if (!isNaN(epCount) && epCount > 0) {
                        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ${rowProgress} 行${rowNum} 状态非"看过/在看"(type=${watchType})，跳过章节标记`);
                    }
                }
                else {
                    failCount++;
                    details.push(`✗ 行${rowNum} ${name || sid} HTTP:${result.code}`);
                    bgmLog(LOG_LEVELS.WARN, `[syncSelectedRows] ${rowProgress} 行${rowNum} "${name || sid}" 同步失败！HTTP: ${result.code}, 消息: ${result.message}`);
                    updateSyncProgressDialog(idx + 1, rows.length, `${rowProgress} 行${rowNum} "${name || sid}" ✗ HTTP:${result.code}`, `✗ ${rowProgress} 行${rowNum} "${name || sid}" 失败 HTTP:${result.code} ${result.message}`);
                }
            }
            catch (e) {
                failCount++;
                const errMsg = e instanceof Error ? e.message : String(e);
                bgmLog(LOG_LEVELS.ERROR, `[syncSelectedRows] ${rowProgress} 行${rowNum} 处理异常: ${errMsg}`);
                updateSyncProgressDialog(idx + 1, rows.length, `${rowProgress} 行${rowNum} 异常: ${errMsg}`, `✗ ${rowProgress} 行${rowNum} 异常: ${errMsg}`);
            }
        }
        // 输出最终汇总日志
        const elapsed = Date.now() - startTime;
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ========== 汇总 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 总行数: ${rows.length}  |  成功: ${successCount}  |  失败: ${failCount}  |  跳过: ${skipCount}  |  标记章节: ${episodeMarkCount}  |  耗时: ${elapsed}ms`);
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 详情: ${details.join('  |  ')}`);
        // 切换弹窗为完成状态（保留弹窗，显示统计 + 详情）
        const wasStopped = BGM.sync.checkShouldStop();
        const summary = `📊 选中 ${rows.length} 行 | 耗时 ${(elapsed / 1000).toFixed(1)}s\n\n✅ 成功: ${successCount}\n❌ 失败: ${failCount}\n⏭️ 跳过: ${skipCount}\n📺 标记章节: ${episodeMarkCount}`;
        completeSyncProgressDialog(summary, details, wasStopped);
    }
    catch (e) {
        hideSyncProgressDialog();
        BGM.handleError(e, { context: 'syncSelectedRows', showAlert: false });
        const errMsg = e instanceof Error ? e.message : String(e);
        bgmLog(LOG_LEVELS.ERROR, `[syncSelectedRows] 同步异常: ${errMsg}`);
        wpsMsgBox(`选中行同步异常: ${errMsg}`, 0, 16);
    }
    finally {
        // 统一在 finally 中清理运行状态，避免 catch/success 路径重复调用 exitRunningState
        // 正常完成时 completeSyncProgressDialog 已切换弹窗状态；异常时 hideSyncProgressDialog 已隐藏弹窗
        if (enteredRunning) {
            BGM.sync.exitRunningState();
        }
    }
}
/**
 * 选中行同步到 Bangumi（多行/单行）
 *
 * @function syncSelectedRows
 */
export async function syncSelectedRows() {
    // P0：防重入预检，避免并发同步
    if (BGM.sync.isRunning) {
        showToast('同步正在进行中，请稍后', 'warn');
        return;
    }
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] ========== 开始选中行同步 ==========');
    try {
        const app = getApp();
        if (!app?.ActiveWorkbook) {
            bgmLog(LOG_LEVELS.ERROR, '[syncSelectedRows] 无法获取 Application');
            wpsMsgBox('无法获取 Application', 0, 48);
            return;
        }
        const ws = app.ActiveWorkbook.ActiveSheet;
        if (!ws) {
            bgmLog(LOG_LEVELS.ERROR, '[syncSelectedRows] 无法获取工作表');
            wpsMsgBox('无法获取工作表', 0, 48);
            return;
        }
        bgmLog(LOG_LEVELS.INFO, '[syncSelectedRows] 工作表获取成功');
        // 1. 收集选中行号（含非连续区域 Areas 处理）
        const rawRows = collectSelectedRows(app);
        if (rawRows.length === 0)
            return;
        // 2. 定位表头行
        const headerRow = findHeaderRow(ws);
        bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] 表头行: ${headerRow}`);
        if (headerRow === 0) {
            bgmLog(LOG_LEVELS.ERROR, '[syncSelectedRows] 未找到有效表头行，中止同步');
            wpsMsgBox('未在当前工作表中检测到有效表头行！\n请确保表头包含"名称"、"是否看完"、"Bangumi URL"等关键词。', 0, 48);
            return;
        }
        // 3. 校验选中行并准备同步数据（排除表头、阈值确认、列映射、Token）
        const validated = await validateSelectedRows(ws, rawRows, headerRow);
        if (!validated)
            return;
        // 4. 执行同步（状态机、弹窗、循环、完成、异常处理、重置状态机）
        await executeSelectedSync(ws, validated.rows, validated.colMap, validated.token, headerRow, startTime);
    }
    catch (e) {
        hideSyncProgressDialog();
        BGM.handleError(e, { context: 'syncSelectedRows', showAlert: false });
        const errMsg = e instanceof Error ? e.message : String(e);
        bgmLog(LOG_LEVELS.ERROR, `[syncSelectedRows] 同步异常: ${errMsg}`);
        wpsMsgBox(`选中行同步异常: ${errMsg}`, 0, 16);
    }
    bgmLog(LOG_LEVELS.INFO, `[syncSelectedRows] ========== 选中行同步结束，总耗时: ${Date.now() - startTime}ms ==========`);
}
//# sourceMappingURL=index.js.map