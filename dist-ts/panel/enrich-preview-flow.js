/**
 * @fileoverview 富化预览流程：表头识别与列映射编辑、源数据预览、多新番表工作簿切换、匹配预览与匹配详情弹窗。
 * @module panel/enrich-preview-flow
 * @description
 *   从 `enrich-page.ts` 切出的独立流程块。`enrich-page.ts` 是富化页的 UI 控制器，
 *   本块只依赖共享上下文（`enrich-page-context.js`）与外部模块，**不反向依赖源文件**。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { buildIntroSheetContext, findIntroSheetInWorkbook } from '../sync/enrich-intro.js';
import { detectAnimeSourceLayout, detectColumns, readPlatformValues, } from '../sync/enrich-layout.js';
import { matchEntries } from '../sync/enrich-matching.js';
import { normalizeName } from '../sync/enrich-normalize.js';
import { ANIME_SOURCE_DETECTOR, findAnimeSourceSheetInWorkbook, monthLabelFromWorkbookName, scanMatchingWorkbooks, } from '../sync/workbook-auto-detect.js';
import { sanitizeHtml, sanitizeTableRows } from '../tools/sanitize.js';
import { renderStatCards } from '../ui/stat-cards.js';
import { escapeHtml } from '../tools/string-utilities.js';
import { getCellValue, getLastRow, findHeaderRow, getColumnMap, bgmLog, BGM, } from '../tools/util/index.js';
import { getOpenWorkbooks } from '../tools/locked-sheet.js';
import { saveDataContext, snapshotFromWorksheet } from '../tools/data-context.js';
import { COLUMN_MAPPING_FIELDS, resetEnrichPreviewConfig } from './enrich-page-state.js';
import { renderPlatformChipsCell, renderPreviewCell } from './enrich-preview-cell.js';
import { setPreviewTab, applyPreviewTabVisibility, resetMatchResults, refreshMatchHintText, } from './enrich-preview-tab.js';
import { closeOpenedSourceWorkbook, closeSourceWorkbookOnly, ensureSourceSheet, } from './enrich-source-workbook.js';
import { state, safeGetElement } from './enrich-page-context.js';
// ========== 源数据预览 ==========
/**
 * 在指定工作表上识别表头并写入 state（不负责工作簿的打开/关闭）。
 * @returns 识别成功返回列映射；失败返回 null
 */
export function detectHeaderOnSheet(worksheet, label) {
    try {
        const sourceLayout = detectAnimeSourceLayout(worksheet);
        const headerRow = sourceLayout?.headerRow ?? findHeaderRow(worksheet);
        if (headerRow === 0) {
            BGM.Dialog.alert('提示', '未检测到有效的表头行，请检查表头是否在前 10 行内');
            bgmLog(LOG_LEVELS.ERROR, `[enrich] 表头识别失败: ${label} 未检测到有效的表头行`);
            return null;
        }
        const mapping = sourceLayout?.columnMapping ?? detectColumns(worksheet, headerRow);
        state.animeSourceSheet = worksheet;
        state.headerRow = headerRow;
        state.dataStartRow = sourceLayout?.dataStartRow ?? headerRow + 1;
        state.columnMapping = mapping;
        // 跨页共享：把刚获取的工作簿/表/列/行写入数据上下文，其它页进入时重放显示
        saveDataContext(snapshotFromWorksheet(worksheet, headerRow, 'enrich'));
        // 关联简介表 + 刷新工作簿切换按钮条
        discoverIntroContext();
        renderWorkbookTabs();
        renderDetectResult(worksheet, mapping);
        renderColumnMappingEditor(worksheet, mapping);
        renderSourcePreview(worksheet, mapping);
        bgmLog(LOG_LEVELS.INFO, `[enrich] 表头识别成功: ${label} / 工作表=${worksheet.Name || '未知'} / 表头行=${String(headerRow)} / 名称列=${String(mapping.nameColumn)}`);
        return mapping;
    }
    catch (error) {
        BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.ERROR,
            context: 'detectHeaderOnSheet',
        });
        BGM.Dialog.error('错误', `识别表头失败: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
function renderDetectResult(worksheet, _mapping) {
    const resultArea = safeGetElement('detectResult');
    if (!resultArea)
        return;
    const sheetName = worksheet.Name || '未知';
    const sheetNameElement = safeGetElement('detectSheetName');
    if (sheetNameElement)
        sheetNameElement.textContent = sheetName;
    const headerRowElement = safeGetElement('detectHeaderRow');
    if (headerRowElement)
        headerRowElement.textContent = String(state.headerRow);
    const dataRowElement = safeGetElement('detectDataRow');
    if (dataRowElement)
        dataRowElement.textContent = String(state.dataStartRow);
    resultArea.style.display = '';
}
function renderColumnMappingEditor(worksheet, mapping) {
    const mappingList = safeGetElement('mappingList');
    if (!mappingList)
        return;
    const maxColumns = 50;
    const { headerRow } = state;
    const columnOptions = [];
    // 覆盖全部列（含表头为空的列）：Hazx 模板的名称列 C 没有表头，
    // 若只列有表头的列，自动识别的名称列将无法在下拉中回显
    for (let column = 1; column <= maxColumns; column += 1) {
        const header = getCellValue(worksheet, headerRow, column).trim();
        columnOptions.push({ column, header });
    }
    let html = '';
    for (const field of COLUMN_MAPPING_FIELDS) {
        const currentColumn = mapping[field.key];
        const selectedValue = currentColumn ? String(currentColumn) : '';
        const optionsHtml = `<option value="">-- 未映射 --</option>${columnOptions
            .map((o) => {
            const optionLabel = o.header
                ? `${escapeHtml(o.header)} (列${String(o.column)})`
                : `(列${String(o.column)}，无表头)`;
            return `<option value="${String(o.column)}" ${String(o.column) === selectedValue ? 'selected' : ''}>${optionLabel}</option>`;
        })
            .join('')}`;
        const requiredMark = field.required ? ' <span style="color:#ff6b6b;">*</span>' : '';
        html += `
      <div class="mapping-item" data-field="${field.key}">
        <label class="mapping-label">${escapeHtml(field.label)}${requiredMark}</label>
        <select class="mapping-select" data-field="${field.key}">
          ${optionsHtml}
        </select>
      </div>
    `;
    }
    mappingList.innerHTML = sanitizeHtml(html);
    const selects = mappingList.querySelectorAll('.mapping-select');
    selects.forEach((select) => {
        const fieldKey = select.dataset.field;
        if (!fieldKey)
            return;
        select.addEventListener('change', () => {
            const value = Number(select.value);
            if (state.columnMapping) {
                updateColumnMapping(fieldKey, Number.isNaN(value) ? 0 : value);
            }
        });
    });
}
function updateColumnMapping(field, value) {
    if (!state.columnMapping)
        return;
    state.columnMapping[field] = value === 0 ? undefined : value;
    bgmLog(LOG_LEVELS.INFO, `[enrich] 列映射更新: ${field} → ${value > 0 ? `列${String(value)}` : '未映射'}`);
}
/**
 * 数据预览的「一栏一行」列顺序：按已映射字段渲染，避免 50 列全部挤压成文本流
 */
const PREVIEW_FIELD_COLUMNS = [
    { key: 'nameColumn', label: '名称' },
    { key: 'weekdayCol', label: '周更时间' },
    { key: 'premiereCol', label: '首播' },
    { key: 'episodesColumn', label: '集数' },
    { key: 'platformCol', label: '播放平台' },
    { key: 'exclusiveCol', label: '独播' },
    { key: 'specialCol', label: '特殊/备注' },
    { key: 'tagsColumn', label: 'TAGS/标签' },
];
/**
 * 简介（2026年4月新番简介）字段在预览/匹配结果中的展示顺序与标签。
 * 仅展示简介表映射命中的列；目标列名与源列名不同（编剧→脚本等）由富化引擎处理。
 */
const INTRO_PREVIEW_FIELDS = [
    { key: 'directorCol', label: '导演' },
    { key: 'screenplayCol', label: '编剧' },
    { key: 'characterDesignCol', label: '人设' },
    { key: 'cgDirectorCol', label: 'CG导演' },
    { key: 'musicCol', label: '音乐' },
    { key: 'studioCol', label: '动画制作' },
    { key: 'seriesCompositionCol', label: '系列构成' },
    { key: 'storyboardCol', label: '分镜' },
    { key: 'originalWorkCol', label: '原作' },
];
/**
 * 安全读取工作簿 / 工作表名。
 * @remarks 工作簿可能正在切换或已被关闭，此时读 `.Name` 会抛 COM 异常。该异常若冒泡到
 *   `detectHeaderOnSheet` 的 catch，会让「列映射编辑器 + 源数据预览 + 工作簿按钮条」整链静默
 *   不渲染（而 state 早已写入），用户只看到一句「识别表头失败」。故读名一律走这里。
 */
function readWorkbookName(wb) {
    if (!wb)
        return '';
    try {
        return wb.Name;
    }
    catch {
        return '';
    }
}
// ========== 简介工作表关联 ==========
/**
 * 发现并缓存与当前源表关联的「新番简介」工作表：
 * 1. 源工作簿内查找（表头命中 ≥2 个简介关键字且非主新番表布局）；
 * 2. 兜底：其他已打开工作簿（如单独的「2026年4月新番简介」工作簿）。
 * 找不到时清空缓存（源表切换后旧简介表失效）。
 */
function discoverIntroContext() {
    state.introContext = null;
    const sourceName = readWorkbookName(state.animeSourceSheet);
    const sourceWb = state.sourceWorkbook ??
        state.animeSourceSheet?.Parent ??
        null;
    if (sourceWb) {
        const sheet = findIntroSheetInWorkbook(sourceWb, sourceName);
        if (sheet) {
            state.introContext = buildIntroSheetContext(sheet);
            if (state.introContext)
                return;
        }
    }
    for (const wb of getOpenWorkbooks()) {
        const name = readWorkbookName(wb);
        if (readWorkbookName(sourceWb) === name) {
            // 源工作簿已在上方优先查找，跳过
        }
        else {
            const sheet = findIntroSheetInWorkbook(wb, sourceName);
            if (sheet) {
                state.introContext = buildIntroSheetContext(sheet);
                if (state.introContext) {
                    bgmLog(LOG_LEVELS.INFO, `[enrich] 在工作簿 ${name} 中找到关联简介表`);
                    return;
                }
            }
        }
    }
}
// ========== 多新番表工作簿切换（yy年m月按钮） ==========
/** 收集可切换的新番表工作簿（当前源表优先，其次全部自动识别命中的已打开工作簿） */
function collectWorkbookTabs() {
    const seen = new Set();
    const items = [];
    const push = (wb) => {
        const name = readWorkbookName(wb);
        if (name && !seen.has(name)) {
            seen.add(name);
            items.push(wb);
        }
    };
    if (state.sourceWorkbook)
        push(state.sourceWorkbook);
    for (const wb of scanMatchingWorkbooks(ANIME_SOURCE_DETECTOR))
        push(wb);
    return items;
}
/** 当前活动源工作簿名（无则空串；工作簿已关闭时读名会抛错，故走 readWorkbookName 兜底） */
function activeWorkbookName() {
    if (!state.animeSourceSheet)
        return '';
    const fromSourceWorkbook = readWorkbookName(state.sourceWorkbook);
    if (fromSourceWorkbook !== '')
        return fromSourceWorkbook;
    return readWorkbookName(state.animeSourceSheet?.Parent ?? null);
}
/** 渲染「26年4月」式切换按钮条；仅一个候选时隐藏 */
function renderWorkbookTabs() {
    const container = safeGetElement('workbookTabs');
    if (!container)
        return;
    const items = collectWorkbookTabs();
    if (items.length <= 1) {
        container.style.display = 'none';
        container.replaceChildren();
        return;
    }
    container.style.display = '';
    container.replaceChildren();
    const activeName = activeWorkbookName();
    for (const wb of items) {
        const button = document.createElement('button');
        button.type = 'button';
        const name = readWorkbookName(wb);
        button.className = `workbook-tab${name === activeName ? ' active' : ''}`;
        button.textContent = monthLabelFromWorkbookName(name);
        button.title = name;
        button.addEventListener('click', () => {
            if (name !== activeName)
                switchSourceWorkbook(wb);
        });
        container.appendChild(button);
    }
}
/** 切换源工作簿：识别新番表布局并刷新预览与匹配结果 */
function switchSourceWorkbook(wb) {
    const sheet = findAnimeSourceSheetInWorkbook(wb);
    if (!sheet) {
        BGM.Dialog.alert('提示', `工作簿「${wb.Name}」中未识别到新番表布局`);
        return;
    }
    // 释放旧源工作簿（仅回收本插件自动打开的；closeOpenedSourceWorkbook 会清空源表状态）
    if (state.sourceWorkbook && state.isSourceWorkbookOpenedByUs) {
        try {
            if (state.sourceWorkbook.Name !== wb.Name)
                closeOpenedSourceWorkbook();
        }
        catch {
            // 旧工作簿已关闭
        }
    }
    state.filePath = (() => {
        try {
            return wb.FullName;
        }
        catch {
            return state.filePath;
        }
    })();
    const mapping = detectHeaderOnSheet(sheet, wb.Name);
    if (!mapping)
        return;
    state.sourceWorkbook = wb;
    state.isSourceWorkbookOpenedByUs = false;
    renderWorkbookTabs();
    // 切换后自动刷新匹配结果（无需再点「预览匹配」）
    if (state.bangumiSheet)
        previewMatch();
}
/** 匹配结果对比表格：新番表源侧展示的字段（名称列单独展示） */
const SOURCE_CMP_FIELDS = [
    { key: 'weekdayCol', label: '周更' },
    { key: 'premiereCol', label: '首播' },
    { key: 'episodesColumn', label: '集数' },
    { key: 'platformCol', label: '平台' },
    { key: 'exclusiveCol', label: '独播' },
    { key: 'specialCol', label: '特殊' },
    { key: 'tagsColumn', label: '标签' },
];
/** 匹配结果对比表格：目标表侧展示的字段（按目标表表头动态读取） */
const TARGET_CMP_FIELDS = [
    { columnKey: '周更时间', label: '周更' },
    { columnKey: '开播日期', label: '首播' },
    { columnKey: '集数', label: '集数' },
    { columnKey: '在线播放平台', label: '平台' },
    { columnKey: '标签/分级', label: '标签', fallbackColKey: '标签' },
    { columnKey: '特点/印象', label: '特点' },
    { columnKey: '别名', label: '别名' },
];
// 着色工具（TAGS / 首播 / 平台按内容稳定配色）已抽至 ./enrich-preview-cell.ts（renderPreviewCell / renderPlatformChipsCell）
function renderSourcePreview(worksheet, mapping) {
    const tableContainer = safeGetElement('sourceTable');
    if (!tableContainer)
        return;
    // 预览配置按页加载缓存（避免逐单元格读 PluginStorage）。此处是「每次预览只跑一次」
    // 的入口，重读一次配置即可让设置页的改动在本页立即生效，无需重开富化页。
    resetEnrichPreviewConfig();
    const { dataStartRow } = state;
    // 只取已映射的字段列，形成「一栏一行」的简洁预览。
    // 平台列聚合：有播放平台列时独播列并入「播放平台」一栏展示（F/G/H/I/J 聚合去重）。
    const hasPlatformColumn = (mapping.platformCol ?? 0) > 0;
    const fieldColumns = PREVIEW_FIELD_COLUMNS.filter((f) => (mapping[f.key] ?? 0) > 0 && (f.key !== 'exclusiveCol' || !hasPlatformColumn));
    // 简介表字段列（关联到「新番简介」工作表时展示）
    const introSheet = state.introContext?.sheet ?? null;
    const introFields = state.introContext
        ? INTRO_PREVIEW_FIELDS.filter((f) => (state.introContext?.mapping[f.key] ?? 0) > 0)
        : [];
    if (fieldColumns.length === 0) {
        const emptyThead = tableContainer.querySelector('thead');
        if (emptyThead)
            emptyThead.replaceChildren();
        const emptyTbody = tableContainer.querySelector('tbody');
        if (emptyTbody)
            emptyTbody.replaceChildren();
        state.hasSourcePreview = false;
        const hintElement = safeGetElement('sourcePreviewHint');
        if (hintElement) {
            hintElement.textContent = '尚未识别到映射列，请先在「新番表文件」中识别表头';
            hintElement.style.display = '';
        }
        // 源表不可用：旧的匹配结果已失效
        resetMatchResults();
        return;
    }
    state.hasSourcePreview = true;
    const thead = tableContainer.querySelector('thead');
    if (thead) {
        thead.innerHTML = sanitizeTableRows(`<tr><th></th>${fieldColumns.map((f) => `<th>${escapeHtml(f.label)}</th>`).join('')}${introFields
            .map((f) => `<th class="column-intro">${escapeHtml(f.label)}</th>`)
            .join('')}</tr>`);
    }
    const tbody = tableContainer.querySelector('tbody');
    if (!tbody)
        return;
    // 仅在通过 tbody 校验后才需要 maxRows，故在 early exit 之后声明
    const maxRows = 20;
    const rowsHtml = [];
    // 源表末行单独取一次：既要算预览上限，也要算「数据总行」统计（避免重复调 COM）
    const sourceLastRow = getLastRow(worksheet);
    const lastRow = Math.min(sourceLastRow, dataStartRow + maxRows - 1);
    for (let row = dataStartRow; row <= lastRow; row += 1) {
        const rowCells = [];
        let hasData = false;
        // 简介表按名称关联本行（无关联行时简介列留空）
        const introRow = state.introContext
            ? state.introContext.nameIndex.get(normalizeName(getCellValue(worksheet, row, mapping.nameColumn).trim()))
            : undefined;
        for (const f of fieldColumns) {
            if (hasPlatformColumn && f.key === 'platformCol') {
                // 播放平台聚合展示：platformCol + platformExtraCols + exclusiveCol 去重
                const platforms = readPlatformValues(worksheet, row, mapping);
                if (platforms.length > 0)
                    hasData = true;
                rowCells.push(renderPlatformChipsCell(platforms));
            }
            else {
                const column = mapping[f.key] ?? 0;
                const value = getCellValue(worksheet, row, column);
                if (value.trim())
                    hasData = true;
                rowCells.push(renderPreviewCell(f.key, value));
            }
        }
        for (const f of introFields) {
            const column = state.introContext?.mapping[f.key] ?? 0;
            const value = introRow !== undefined && column > 0 ? getCellValue(introSheet, introRow, column) : '';
            if (value.trim())
                hasData = true;
            rowCells.push(`<td class="column-intro" title="${escapeHtml(value.trim())}">${escapeHtml(value.trim())}</td>`);
        }
        if (hasData) {
            rowsHtml.push(`<tr data-row="${String(row)}"><td class="row-num">${String(row)}</td>${rowCells.join('')}</tr>`);
        }
    }
    tbody.innerHTML = sanitizeTableRows(rowsHtml.join(''));
    // 源数据统计：预览只画前 20 行，但用户需要知道表里到底有多少行
    renderStatCards(safeGetElement('sourceStats'), [
        { label: '数据总行', value: Math.max(0, sourceLastRow - dataStartRow + 1) },
        { label: '已映射字段', value: fieldColumns.length + introFields.length },
        { label: '本次预览', value: rowsHtml.length },
        { label: '数据起始行', value: dataStartRow },
    ]);
    // 预览提示：仅展示前 maxRows 行
    const hintElement = safeGetElement('sourcePreviewHint');
    if (hintElement) {
        hintElement.textContent =
            rowsHtml.length >= maxRows
                ? `仅显示前 ${String(maxRows)} 行，可点击「查看详细数据表格」查看完整数据`
                : '';
    }
    // 「查看详细数据表格」按钮与提示的显示由 applyPreviewTabVisibility 统一控制
    applyPreviewTabVisibility();
    bgmLog(LOG_LEVELS.INFO, `[enrich] 源数据预览已渲染: ${String(rowsHtml.length)} 行`);
}
// ========== 匹配预览 ==========
/**
 * 匹配预览。
 * @param options.keepSourceOpen 为 true 时预览结束不回收源工作簿
 *   （富化流程内部调用时使用：调用方还持有工作表引用，关闭会使其失效）
 */
export function previewMatch(options) {
    const animeSourceSheet = ensureSourceSheet();
    if (!animeSourceSheet) {
        BGM.Dialog.alert('提示', '请先选择新番表文件并识别表头');
        return;
    }
    if (!state.bangumiSheet) {
        BGM.Dialog.alert('提示', '请先选择目标 Bangumi 工作表');
        return;
    }
    if (!state.columnMapping || state.columnMapping.nameColumn === 0) {
        BGM.Dialog.alert('提示', '列映射未正确识别，缺少名称列');
        return;
    }
    try {
        const config = {
            filePath: state.filePath,
            sheetName: animeSourceSheet.Name || '',
            headerRow: state.headerRow,
            dataStartRow: state.dataStartRow,
            columnMapping: state.columnMapping,
            targetSheetName: state.bangumiSheet.Name || '',
        };
        state.matches = matchEntries(animeSourceSheet, state.bangumiSheet, config);
        renderMatchStats(state.matches);
        renderMatchResultsToTable(state.matches);
        refreshMatchHintText();
        // 预览完成后确保停留在「匹配结果」页签并展示统计/表格
        setPreviewTab('match');
        bgmLog(LOG_LEVELS.INFO, `[enrich] 匹配预览完成: ${String(state.matches.length)} 条结果`);
    }
    catch (error) {
        BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.ERROR,
            context: 'previewMatch',
        });
        BGM.Dialog.error('错误', `匹配预览失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        // 可选开关：预览时重开了源工作簿，预览结束同样回收（仅关闭本插件打开的）
        if (!options?.keepSourceOpen &&
            state.closeSourceAfterDetect &&
            state.isSourceWorkbookOpenedByUs) {
            closeSourceWorkbookOnly();
        }
    }
}
function renderMatchStats(matches) {
    const statsArea = safeGetElement('matchStats');
    if (!statsArea)
        return;
    const exactCount = matches.filter((m) => m.matchType === 'exact').length;
    const aliasCount = matches.filter((m) => m.matchType === 'alias').length;
    const unmatchedCount = matches.filter((m) => m.matchType === 'unmatched').length;
    const exactElement = safeGetElement('exactMatchCount');
    if (exactElement)
        exactElement.textContent = String(exactCount);
    const aliasElement = safeGetElement('aliasMatchCount');
    if (aliasElement)
        aliasElement.textContent = String(aliasCount);
    const unmatchedElement = safeGetElement('unmatchedCount');
    if (unmatchedElement)
        unmatchedElement.textContent = String(unmatchedCount);
}
/** 匹配方式的徽标 class（与 .preview-table .match-status 配套） */
function matchStatusClass(matchType) {
    switch (matchType) {
        case 'exact': {
            return 'status-exact';
        }
        case 'alias': {
            return 'status-alias';
        }
        case 'error': {
            return 'status-error';
        }
        default: {
            return 'status-unmatched';
        }
    }
}
/** 匹配方式的徽标文案 */
function matchStatusText(matchType) {
    switch (matchType) {
        case 'exact': {
            return '✅ 精确';
        }
        case 'alias': {
            return '🔄 别名';
        }
        case 'error': {
            return '⚠️ 错误';
        }
        default: {
            return '❌ 未匹配';
        }
    }
}
/** 渲染「标签 值」对比标签列表 */
function renderCmpTags(items) {
    if (items.length === 0)
        return '<div class="cmp-empty">—</div>';
    const tagsHtml = items
        .map((item) => `<span class="cmp-tag" title="${escapeHtml(`${item.label}：${item.value}`)}"><i>${escapeHtml(item.label)}</i>${escapeHtml(item.value)}</span>`)
        .join('');
    return `<div class="cmp-tags">${tagsHtml}</div>`;
}
/** 读取新番表源行的对比字段（按列映射读取已识别列；平台聚合 + 关联简介表字段） */
function buildSourceCmpTags(sourceSheet, match) {
    const mapping = state.columnMapping;
    if (!sourceSheet || !mapping)
        return renderCmpTags([]);
    const items = [];
    const hasPlatformColumn = (mapping.platformCol ?? 0) > 0;
    for (const field of SOURCE_CMP_FIELDS) {
        // 平台聚合时独播已并入平台项，不重复展示
        const isMergedExclusive = hasPlatformColumn && field.key === 'exclusiveCol';
        if (!isMergedExclusive) {
            const column = mapping[field.key] ?? 0;
            if (column > 0) {
                const value = hasPlatformColumn && field.key === 'platformCol'
                    ? readPlatformValues(sourceSheet, match.animeRow, mapping).join(' | ')
                    : getCellValue(sourceSheet, match.animeRow, column).trim();
                if (value)
                    items.push({ label: field.label, value });
            }
        }
    }
    // 关联简介表：按名称读取导演/编剧/人设等字段
    const intro = state.introContext;
    if (intro) {
        const introRow = intro.nameIndex.get(normalizeName(match.matchedAnimeName));
        if (introRow !== undefined) {
            for (const field of INTRO_PREVIEW_FIELDS) {
                const column = intro.mapping[field.key] ?? 0;
                if (column > 0) {
                    const value = getCellValue(intro.sheet, introRow, column).trim();
                    if (value)
                        items.push({ label: field.label, value });
                }
            }
        }
    }
    return renderCmpTags(items);
}
/** 读取 Bangumi 目标行对比字段（按目标表表头动态读取） */
function buildTargetCmpTags(targetSheet, targetColumnMap, match) {
    if (!targetSheet || !targetColumnMap || match.bangumiRow === undefined) {
        return '<div class="cmp-empty">未匹配到目标行</div>';
    }
    const items = [];
    for (const field of TARGET_CMP_FIELDS) {
        const column = targetColumnMap.get(field.columnKey) ??
            (field.fallbackColKey ? targetColumnMap.get(field.fallbackColKey) : undefined);
        if (column && column > 0) {
            const value = getCellValue(targetSheet, match.bangumiRow, column).trim();
            if (value)
                items.push({ label: field.label, value });
        }
    }
    if (items.length === 0)
        return '<div class="cmp-empty">目标行无对比数据</div>';
    return renderCmpTags(items);
}
// ========== 匹配详情弹窗 ==========
function showMatchDetail(match) {
    const modalElement = safeGetElement('matchDetailModal');
    const bodyElement = safeGetElement('matchDetailBody');
    if (!modalElement || !bodyElement)
        return;
    bodyElement.innerHTML = sanitizeHtml(renderMatchDetail(match));
    modalElement.style.display = 'flex';
}
export function hideMatchDetail() {
    const modalElement = safeGetElement('matchDetailModal');
    if (modalElement) {
        modalElement.style.display = 'none';
    }
}
/**
 * 渲染匹配结果对比表格：源数据 / 匹配方式 / 目标数据 三栏对照
 * 表头增加「📋 查看所有详情」按钮，点击打开全部匹配的汇总弹窗（不用逐个点 🔍 详情）
 */
function renderMatchResultsToTable(matches) {
    const tbodyElement = safeGetElement('matchTable')?.querySelector('tbody');
    if (!tbodyElement)
        return;
    // 同 renderSourcePreview：每次匹配预览重读一次富化预览配置
    resetEnrichPreviewConfig();
    // 目标表列映射：按目标表表头动态读取对比字段
    const sourceSheet = state.animeSourceSheet;
    const targetSheet = state.bangumiSheet;
    const targetHeaderRow = targetSheet ? findHeaderRow(targetSheet) : 0;
    const targetColumnMap = targetSheet && targetHeaderRow > 0 ? getColumnMap(targetSheet, targetHeaderRow) : null;
    const rowsHtml = matches.map((match) => {
        const statusClass = matchStatusClass(match.matchType);
        const statusText = matchStatusText(match.matchType);
        const sourceTags = buildSourceCmpTags(sourceSheet, match);
        const targetNameHtml = match.bangumiName
            ? `<div class="cmp-name">${escapeHtml(match.bangumiName)}</div>`
            : '';
        const targetMetaHtml = match.bangumiRow === undefined
            ? ''
            : `<div class="cmp-meta">目标行 ${String(match.bangumiRow)}</div>`;
        const targetTags = buildTargetCmpTags(targetSheet, targetColumnMap, match);
        return `
      <tr class="match-row match-${match.matchType}">
        <td class="cmp-cell cmp-source">
          <div class="cmp-name">${escapeHtml(match.matchedAnimeName)}</div>
          <div class="cmp-meta">源表行 ${String(match.animeRow)}</div>
          ${sourceTags}
        </td>
        <td class="cmp-status-cell">
          <span class="match-status ${statusClass}">${statusText}</span>
        </td>
        <td class="cmp-cell cmp-target">
          ${targetNameHtml}
          ${targetMetaHtml}
          ${targetTags}
        </td>
        <td class="cmp-action">
          <button class="bgm-btn small match-detail-btn">🔍 详情</button>
        </td>
      </tr>
    `;
    });
    tbodyElement.innerHTML = sanitizeTableRows(rowsHtml.join(''));
    // 绑定每行详情按钮（行内按钮由预览刷新时重建，需按次绑定；
    // 闭包按索引取值，避免依赖会被 sanitize 剥离的 data-* 属性）
    const detailButtons = tbodyElement.querySelectorAll('.match-detail-btn');
    detailButtons.forEach((button, index) => {
        button.addEventListener('click', () => {
            const match = matches[index];
            if (match)
                showMatchDetail(match);
        });
    });
    // 「📋 查看所有详情」按钮同步写入表头（避免内联按钮跟随 tbody 重建）
    injectAllMatchesDetailButton(matches);
    // 表格的显示由 applyPreviewTabVisibility 统一控制（未预览 / 非匹配页签时保持隐藏）
}
/** 把「📋 查看所有详情」按钮塞进 matchTable 的表头（th 详情列）。只在表头尚未注入时写入。 */
function injectAllMatchesDetailButton(matches) {
    const table = safeGetElement('matchTable');
    if (!table)
        return;
    const thead = table.querySelector(':scope > thead > tr');
    if (!thead)
        return;
    let detailTh = thead.querySelector(':scope > th.all-detail-cell');
    if (detailTh) {
        // 已有按钮则跳过
        if (detailTh.querySelector('button'))
            return;
    }
    else {
        // 最后一列（详情）表头加一个全详情按钮
        detailTh = document.createElement('th');
        detailTh.className = 'all-detail-cell';
        detailTh.textContent = '详情';
        thead.appendChild(detailTh);
    }
    const cell = detailTh;
    cell.replaceChildren();
    const button = document.createElement('button');
    button.className = 'bgm-btn small primary';
    button.type = 'button';
    button.textContent = `📋 查看全部 (${String(matches.length)})`;
    button.addEventListener('click', () => {
        showAllMatchesDetail(matches);
    });
    cell.appendChild(button);
}
/** 渲染全部匹配汇总（按匹配方式分组），用于一屏看清所有匹配项 */
function showAllMatchesDetail(matches) {
    const modalElement = safeGetElement('matchDetailModal');
    const bodyElement = safeGetElement('matchDetailBody');
    if (!modalElement || !bodyElement)
        return;
    if (matches.length === 0) {
        bodyElement.innerHTML = sanitizeHtml('<p class="hint">暂无匹配结果</p>');
        modalElement.style.display = 'flex';
        return;
    }
    const groups = {
        exact: [],
        alias: [],
        unmatched: [],
        error: [],
    };
    for (const m of matches) {
        const bucket = groups[m.matchType] ?? groups.unmatched;
        if (bucket)
            bucket.push(m);
    }
    const groupHtml = [];
    const labels = [
        ['exact', '✅ 精确匹配', 'status-exact'],
        ['alias', '🔄 别名匹配', 'status-alias'],
        ['error', '⚠️ 错误', 'status-error'],
        ['unmatched', '❌ 未匹配', 'status-unmatched'],
    ];
    for (const label of labels) {
        const [key, title, cssClass] = label;
        const items = groups[key];
        if (items && items.length > 0) {
            const listHtml = items
                .map((m, index) => {
                const bangumi = m.bangumiRow === undefined ? '—' : `目标行 ${String(m.bangumiRow)}`;
                const bangumiName = m.bangumiName ? ` · ${escapeHtml(m.bangumiName)}` : '';
                const error = m.errorMessage
                    ? `<div class="match-detail-error">${escapeHtml(m.errorMessage)}</div>`
                    : '';
                const index_ = matches.indexOf(m);
                return `
            <div class="match-all-item">
              <span class="match-all-idx">#${String(index + 1)}</span>
              <span class="match-all-name">${escapeHtml(m.matchedAnimeName)}</span>
              <span class="match-all-meta">源表行 ${String(m.animeRow)} → ${bangumi}${bangumiName}</span>
              <button class="bgm-btn xsmall match-all-jump" data-match-index="${String(index_)}">🔍</button>
              ${error}
            </div>
          `;
            })
                .join('');
            groupHtml.push(`
        <div class="match-all-group">
          <div class="match-all-title"><span class="match-status ${cssClass}">${title}</span> <span class="match-all-count">${String(items.length)} 条</span></div>
          <div class="match-all-list">${listHtml}</div>
        </div>
      `);
        }
    }
    bodyElement.innerHTML = sanitizeHtml(groupHtml.join(''));
    // 绑定每项「🔍」按钮：跳到该条的单条详情弹窗
    bodyElement.querySelectorAll('.match-all-jump').forEach((button) => {
        button.addEventListener('click', () => {
            const indexAttribute = button.dataset.matchIndex;
            if (!indexAttribute)
                return;
            const index = Number(indexAttribute);
            const m = matches[index];
            if (m)
                showMatchDetail(m);
        });
    });
    modalElement.style.display = 'flex';
}
/** 匹配详情的键值对列表渲染 */
function renderMatchDetail(match) {
    let statusClass = 'match-status';
    let statusText;
    switch (match.matchType) {
        case 'exact': {
            statusClass += ' status-exact';
            statusText = '✅ 精确匹配';
            break;
        }
        case 'alias': {
            statusClass += ' status-alias';
            statusText = '🔄 别名匹配';
            break;
        }
        case 'unmatched': {
            statusClass += ' status-unmatched';
            statusText = '❌ 未匹配';
            break;
        }
        case 'error': {
            statusClass += ' status-error';
            statusText = '⚠️ 错误';
            break;
        }
        default: {
            statusClass += ' status-unmatched';
            statusText = '未知';
            break;
        }
    }
    const items = [
        { label: '新番名称', valueHtml: escapeHtml(match.matchedAnimeName) },
        { label: '源表行号', valueHtml: String(match.animeRow) },
        { label: '匹配方式', valueHtml: `<span class="${statusClass}">${statusText}</span>` },
    ];
    if (match.bangumiRow !== undefined) {
        items.push({ label: 'Bangumi行号', valueHtml: String(match.bangumiRow) });
    }
    if (match.bangumiName !== undefined) {
        items.push({ label: 'Bangumi名称', valueHtml: escapeHtml(match.bangumiName) });
    }
    if (match.aliases && match.aliases.length > 0) {
        const aliasHtml = match.aliases
            .map((a) => `<span class="match-detail-alias">${escapeHtml(a)}</span>`)
            .join('');
        items.push({ label: '别名', valueHtml: `<div class="match-detail-aliases">${aliasHtml}</div>` });
    }
    if (match.errorMessage) {
        items.push({ label: '错误信息', valueHtml: escapeHtml(match.errorMessage) });
    }
    // 详情弹窗额外展示源/目标对比字段（与内联表格同源数据），方便用户在不滚动小表格的情况下看清
    const sourceSheet = state.animeSourceSheet;
    const targetSheet = state.bangumiSheet;
    const targetHeaderRow = targetSheet ? findHeaderRow(targetSheet) : 0;
    const targetColumnMap = targetSheet && targetHeaderRow > 0 ? getColumnMap(targetSheet, targetHeaderRow) : null;
    if (sourceSheet && state.columnMapping) {
        items.push({
            label: '源表对比字段',
            valueHtml: buildSourceCmpTags(sourceSheet, match),
        });
    }
    if (targetSheet && targetColumnMap && match.bangumiRow !== undefined) {
        items.push({
            label: '目标表对比字段',
            valueHtml: buildTargetCmpTags(targetSheet, targetColumnMap, match),
        });
    }
    const listHtml = items
        .map((item) => `
        <div class="match-detail-item">
          <span class="match-detail-label">${escapeHtml(item.label)}</span>
          <span class="match-detail-value">${item.valueHtml}</span>
        </div>
      `)
        .join('');
    return `<div class="match-detail-list">${listHtml}</div>`;
}
