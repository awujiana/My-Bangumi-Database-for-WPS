/**
 * @fileoverview 番剧高亮页 UI 控制器
 * @module panel/highlightPage
 * @description 「按季度起点高亮最新番剧」的独立页面：日期源自选、自动/手动季目标、
 *   高亮列多选（默认值缓存）、面板内实时预览（不动表）、应用/清除。
 *
 * 三个设计约束：
 * 1. **预览不动表**：只有点「应用高亮」才写工作表（用户选定的 A 口径）；
 * 2. **地址串长度不是瓶颈**：2026-10-20 真机探针实测单次 `Range` 可接受约 524287 字符
 *    （VBA 那个 255 是 Excel 2003 时代的说法）。仍按 8000 字符 greedy 装车 + 连续行合并，
 *    且块失败会对半拆分重试——不赌平台上限，也不像宏那样整批静默失败；
 * 3. **清除只抹本插件加的绿**：上次应用的地址记录在 PluginStorage，清除精确重放，
 *    不整列 ColorIndex 乱扫（那会抹掉用户手工填的色）。
 *
 * 序列号列刻意不进高亮列列表：它的绿色是「已上传」判定色（isUploadedByColor），
 * 高亮它会让「看起来传过」与「本季新番」混淆。
 */
import { BGM_COLOR, LOG_LEVELS } from '../core/constants.js';
import { showToast } from '../ui/dialog.js';
import { escapeHtml } from '../tools/string-utilities.js';
import { bgmLog, findHeaderRow, getApp, getColumnMap, getLastRow, markHighlightPaneLoaded, readRangeValues, } from '../tools/util/index.js';
import { CONFIG_KEYS, getConfig, setConfig } from '../tools/config.js';
import { currentSeason, formatSeasonKey, formatSeasonLabel, isSeasonFilterMatch, rowsToRangeAddresses, runRangeGroupsWithSplit, selectSeasonRows, splitRangeAddresses, } from './highlight-season.js';
import { registerSheetChangeAutoRefresh } from './panel-auto-refresh.js';
import { initializeShellNav } from './shell-nav.js';
import { notifyModulesReady } from './action-buttons-gate.js';
import { initializeTheme, startThemeSync } from '../tools/theme.js';
import { activeWorksheet, collectSheets } from '../tools/sheet-list.js';
import { mountDataContextNotice, registerTargetSheetApplier, saveDataContext, snapshotFromWorksheet, } from '../tools/data-context.js';
import { renderOptionPicker } from '../ui/components/option-picker.js';
// ===== 配置键（PluginStorage，跨会话缓存）=====
const KEY_SOURCE = 'highlight.source';
const KEY_COLUMNS = 'highlight.columns';
const KEY_MANUAL = 'highlight.manual';
const KEY_LAST_APPLIED = 'highlight.lastApplied';
/** 上次选中的工作表（稳定键：工作簿名::工作表名）；下次打开直接定位 */
const KEY_SHEET = 'highlight.sheet';
/** 筛选范围配置（range|year|quarter|month，与 GitHub 同步筛选同口径） */
const KEY_FILTER = 'highlight.filter';
/** 是否包含非动漫条目（书籍 / 音乐 / 游戏 / 三次元） */
const KEY_NON_ANIME = 'highlight.includeNonAnime';
/**
 * 目标表锁定开关（`1` = 锁定）。
 *
 * 语义**不是** locked-sheet 那种索引锁，而是「兜底策略」：
 * 两级下拉的选中键失效时（目标簿被关 / 目标表被删），未锁定会静默跳到
 * 活动表或第一张 —— 用户往往没注意，随后「加载并预览」读到的是另一张表。
 * 锁定后**不跳**，改在下拉里放一条「⚠️ 原目标表已不存在，请重新选择」，
 * 把「应用到哪张表」这个决定权交回用户，而不是替他猜。
 */
const KEY_SHEET_LOCK = 'highlight.sheetLock';
/** 日期源候选（规范列名，按自动模式的优先级排列） */
const SOURCE_CANDIDATES = ['开播季度', '开播日期', '完播日'];
/** 公式列（值已被数据页公式归一到季文本，匹配时直接比、不再归一路） */
const FORMULA_SOURCE = '开播季度';
/** 高亮填充色：与宏的 RGB(0,176,80) 一致（BGM_COLOR.DARK_GREEN = 0x00b050） */
const HIGHLIGHT_COLOR = BGM_COLOR.DARK_GREEN;
/** 清除填充：xlNone；清除字体色：xlAutomatic */
const COLOR_INDEX_NONE = -4142;
const COLOR_INDEX_AUTOMATIC = -4105;
/** 预览行号切片最多展示几个 */
const PREVIEW_CHIP_LIMIT = 8;
const state = {
    worksheet: null,
    headerRow: 1,
    columnMap: new Map(),
    sourceKey: '',
    sourceCol: 0,
    columns: [],
    mode: 'auto',
    manual: { year: new Date().getFullYear(), month: 1 },
    filter: {
        enabled: false,
        year: new Date().getFullYear(),
        range: 'all',
        quarter: 1,
        month: 1,
    },
    includeNonAnime: false,
    filterSpan: null,
    lastSelect: { matchedRows: [], emptyCount: 0, invalidCount: 0 },
    lastTarget: null,
    sheets: [],
    selectedKey: '',
    selectionMissing: '',
};
/** 自动跟随（SheetChange 常驻监听）的清理函数；开关关闭时为 null */
let disposeAutoWatch = null;
// ===== DOM 辅助 =====
function byId(id) {
    return document.getElementById(id);
}
function selectById(id) {
    return document.getElementById(id);
}
function inputById(id) {
    return document.getElementById(id);
}
function setText(id, text) {
    const element = byId(id);
    if (element)
        element.textContent = text;
}
// ===== 数据源与列 =====
function columnLetter(column) {
    let letter = '';
    let n = column;
    while (n > 0) {
        const rem = (n - 1) % 26;
        letter = String.fromCodePoint(65 + rem) + letter;
        n = Math.floor((n - 1) / 26);
    }
    return letter;
}
/**
 * 解析日期源：配置指定 > 自动（开播季度 > 开播日期 > 完播日）
 * @returns 规范列名与列号；都识别不到返回 null
 */
function resolveSource() {
    const configured = getConfig(KEY_SOURCE, '__auto__', true);
    // 显式指定了某一列（含非日期列）：直接用它识别，不再自动猜
    if (configured && configured !== '__auto__') {
        const column = state.columnMap.get(configured);
        if (column !== undefined)
            return { key: configured, column };
    }
    // 自动：开播季度 > 开播日期 > 完播日（公式列已归一，匹配最准）
    for (const candidate of SOURCE_CANDIDATES) {
        const column = state.columnMap.get(candidate);
        if (column !== undefined)
            return { key: candidate, column };
    }
    return null;
}
/** 当前匹配口径：公式列的值已归一，直接比；原始日期列先归一再比 */
function isFormulaSource() {
    return state.sourceKey === FORMULA_SOURCE;
}
/**
 * 重建高亮列列表：**列出全部可选列**（源列恒选置顶，序列号列刻意排除）
 *
 * 曾经只列缓存里已有的列，导致首次使用只有「源列 + 名称」，且**没有任何 UI 能把
 * 别的列加进来**——勾选框只能取消、不能新增（真机反馈：高亮列不能选择更多的）。
 */
function rebuildColumns() {
    const cached = new Set();
    try {
        const raw = getConfig(KEY_COLUMNS, '', true);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (typeof item === 'string')
                        cached.add(item);
                }
            }
        }
    }
    catch {
        bgmLog(LOG_LEVELS.WARN, '[highlight] 高亮列缓存解析失败，按默认处理');
    }
    const columns = [];
    for (const [name, column] of state.columnMap) {
        // 序列号列的绿色是「已上传」判定色，高亮它会混淆两种语义，故不进列表
        const isSequenceColumn = name === '序列号';
        const isSource = name === state.sourceKey;
        // 首次使用（无缓存）默认带「名称」作视觉锚点
        const isFirstRunDefault = cached.size === 0 && name === '名称';
        if (!isSequenceColumn) {
            columns.push({
                name,
                column,
                letter: columnLetter(column),
                selected: isSource || isFirstRunDefault || cached.has(name),
            });
        }
    }
    // 源列恒选置顶：列映射变化等边缘情况下也要在，且不让用户取消
    columns.sort((a, b) => Number(b.name === state.sourceKey) - Number(a.name === state.sourceKey));
    state.columns = columns;
}
/** 渲染识别列选择器（列多时自动带搜索） */
function renderSourcePicker() {
    const container = byId('highlightSourcePicker');
    if (!container)
        return;
    const configured = getConfig(KEY_SOURCE, '__auto__', true);
    // 列出全部列供用户选「识别列」；默认「自动识别」按日期候选挑
    const values = ['__auto__'];
    for (const [name] of state.columnMap) {
        if (name && name !== '__auto__')
            values.push(name);
    }
    renderOptionPicker(container, values.map((value) => ({
        value,
        label: value === '__auto__' ? '自动识别（日期列优先）' : value,
    })), {
        value: configured,
        ariaLabel: '识别列',
        onChange: (value) => {
            onSourceChange(value);
        },
    });
}
/** 识别列切换：写配置 + 重算预览 */
function onSourceChange(value) {
    setConfig(KEY_SOURCE, value === '__auto__' ? '__auto__' : value);
    refreshPreview();
    renderColumnListIfChanged();
}
function renderColumnList() {
    const container = byId('highlightColList');
    if (!container)
        return;
    container.innerHTML = state.columns
        .map((c) => {
        const isLocked = c.name === state.sourceKey;
        return `
      <label class="highlight-row">
        <input type="checkbox" data-column="${escapeHtml(c.name)}"${c.selected ? ' checked' : ''}${isLocked ? ' disabled' : ''} />
        <span class="highlight-column-name">${escapeHtml(c.name)}${isLocked ? '（日期源，必选）' : ''}</span>
        <span class="highlight-column-letter">${escapeHtml(c.letter)} 列</span>
      </label>`;
    })
        .join('');
    container.querySelectorAll('input[type="checkbox"]').forEach((box) => {
        box.addEventListener('change', () => {
            const name = box.dataset.column ?? '';
            const column = state.columns.find((c) => c.name === name);
            if (column)
                column.selected = box.checked;
            persistColumns();
            refreshPreview();
        });
    });
}
/** 列集合变化时才重渲列表（避免每次预览刷新都重建 DOM） */
function renderColumnListIfChanged() {
    const container = byId('highlightColList');
    if (!container)
        return;
    const rendered = new Set([...container.querySelectorAll('input[type="checkbox"]')].map((box) => box.dataset.column ?? ''));
    const current = new Set(state.columns.map((c) => c.name));
    const isSame = rendered.size === current.size && [...current].every((name) => rendered.has(name));
    if (!isSame)
        renderColumnList();
}
function persistColumns() {
    const checked = state.columns.filter((c) => c.selected).map((c) => c.name);
    // 源列必须留在缓存里：换表后源列可能变（公式列 → 原始日期列），届时它仍要默认勾上
    const withSource = state.sourceKey && !checked.includes(state.sourceKey) ? [state.sourceKey, ...checked] : checked;
    setConfig(KEY_COLUMNS, JSON.stringify(withSource));
}
// ===== 工作簿 / 工作表选择（显式，不自动猜、不轮询）=====
/** 当前选中的枚举项（按稳定键反查） */
function selectedSheetEntry() {
    return state.sheets.find((entry) => entry.key === state.selectedKey) ?? null;
}
/** 当前选中的工作簿名（从选中表反推；选中为空时为空） */
function currentWorkbookName() {
    return selectedSheetEntry()?.workbook ?? '';
}
/** 渲染工作簿选择器（去重的工作簿名，保持枚举顺序） */
function renderWorkbookPicker() {
    const container = byId('highlightWorkbookPicker');
    if (!container)
        return;
    const workbookNames = [];
    for (const entry of state.sheets) {
        if (!workbookNames.includes(entry.workbook))
            workbookNames.push(entry.workbook);
    }
    renderOptionPicker(container, workbookNames.map((name) => ({ value: name, label: name })), {
        value: currentWorkbookName(),
        ariaLabel: '工作簿',
        emptyText: '（无已打开的工作簿）',
        onChange: (workbook) => {
            onWorkbookChange(workbook);
        },
    });
}
/** 渲染工作表选择器：只显示当前工作簿下的表（两级联动） */
function renderSheetPicker() {
    const container = byId('highlightSheetPicker');
    if (!container)
        return;
    const workbook = currentWorkbookName();
    const visible = state.sheets.filter((entry) => entry.workbook === workbook);
    renderOptionPicker(container, visible.map((entry) => ({ value: entry.key, label: entry.sheet })), {
        value: state.selectedKey,
        ariaLabel: '工作表',
        emptyText: '（该工作簿下没有可显示的工作表）',
        onChange: (key) => {
            onSheetChange(key);
        },
    });
    // 锁定态下选中键失效：不静默跳到别的表，用一行说明让用户自己重选
    const notice = byId('highlightSheetNotice');
    if (notice) {
        notice.hidden = state.selectionMissing === '';
        notice.textContent =
            state.selectionMissing === ''
                ? ''
                : `⚠️ 原目标表 ${state.selectionMissing} 已不存在，请重新选择`;
    }
}
/** 工作簿切换：只重渲工作表选择器（轻量，不读数据） */
function onWorkbookChange(workbook) {
    // 切到新工作簿后，默认选中该簿下第一张表
    const first = state.sheets.find((entry) => entry.workbook === workbook);
    if (first) {
        state.selectedKey = first.key;
        state.worksheet = first.worksheet;
        state.selectionMissing = '';
        setConfig(KEY_SHEET, first.key);
    }
    renderSheetPicker();
    resetSheetData();
}
/** 工作表切换：只记录选择（轻量），真正读表等用户点「加载并预览」 */
function onSheetChange(key) {
    const entry = state.sheets.find((item) => item.key === key);
    state.selectedKey = entry?.key ?? '';
    state.worksheet = entry?.worksheet ?? null;
    // 用户已经重新选了：退出「原表已不存在」状态
    state.selectionMissing = '';
    if (entry)
        setConfig(KEY_SHEET, entry.key);
    resetSheetData();
}
/** 切表后清空上一表的列映射 / 预览 / 识别列下拉（避免串表） */
function resetSheetData() {
    state.columnMap = new Map();
    state.columns = [];
    state.sourceKey = '';
    state.sourceCol = 0;
    renderSourcePicker();
    setText('highlightSheetName', selectedSheetEntry()?.sheet ?? '请选择工作表');
    renderPreviewEmpty('点「加载并预览」读取该表并生成预览');
}
// ===== 预览 =====
function currentTarget() {
    if (state.mode === 'manual')
        return state.manual;
    return currentSeason(new Date());
}
function refreshPreview() {
    const { worksheet } = state;
    if (!worksheet)
        return;
    const source = resolveSource();
    if (!source) {
        state.lastSelect = { matchedRows: [], emptyCount: 0, invalidCount: 0 };
        state.lastTarget = null;
        renderPreviewEmpty('未识别到日期列（开播季度 / 开播日期 / 完播日），请检查表头');
        return;
    }
    state.sourceKey = source.key;
    state.sourceCol = source.column;
    rebuildColumns();
    renderColumnListIfChanged();
    const headerRow = findHeaderRow(worksheet);
    state.headerRow = headerRow;
    const lastRow = getLastRow(worksheet, true, headerRow);
    const firstRow = headerRow + 1;
    if (lastRow < firstRow) {
        state.lastSelect = { matchedRows: [], emptyCount: 0, invalidCount: 0 };
        renderPreviewEmpty('表里没有数据行');
        return;
    }
    // 一次矩形读：日期源列 + 名称列（名称仅用于预览展示）+ 非动漫兜底列
    const nameColumn = state.columnMap.get('名称');
    const fallbackColumn = nonAnimeFallbackColumn(source.key);
    const readColumns = new Set([source.column]);
    if (nameColumn !== undefined)
        readColumns.add(nameColumn);
    if (fallbackColumn !== null)
        readColumns.add(fallbackColumn);
    let minColumn = Infinity;
    let maxColumn = 0;
    for (const column of readColumns) {
        if (column < minColumn)
            minColumn = column;
        if (column > maxColumn)
            maxColumn = column;
    }
    const block = readRangeValues(worksheet, firstRow, lastRow, minColumn, maxColumn);
    if (block.length === 0) {
        state.lastSelect = { matchedRows: [], emptyCount: 0, invalidCount: 0 };
        renderPreviewEmpty('读取工作表失败，请重试');
        return;
    }
    const names = new Map();
    const rows = [];
    const fallbackValues = new Map();
    for (const [index, line] of block.entries()) {
        const rowNo = firstRow + index;
        const cells = line;
        const value = cells[source.column - minColumn] ?? '';
        rows.push({ row: rowNo, value });
        if (nameColumn !== undefined)
            names.set(rowNo, cells[nameColumn - minColumn] ?? '');
        if (fallbackColumn !== null) {
            fallbackValues.set(rowNo, cells[fallbackColumn - minColumn] ?? '');
        }
    }
    const target = currentTarget();
    state.lastTarget = target;
    state.filterSpan = { firstRow, lastRow };
    state.lastSelect = selectVisibleRows(rows, fallbackValues, target);
    renderPreview(names);
}
/**
 * 非动漫兜底列：勾了「包含非动漫」且当前源是公式列（开播季度）时，
 * 读该行的原始日期列（开播日期 > 完播日）来匹配。
 *
 * 公式列只对日漫归一（数据页公式的设计意图），非动漫行的公式值是原始年月
 * （如 `25年12月`），永远匹配不上季目标；给它们一条原始日期的活路。
 */
function nonAnimeFallbackColumn(sourceKey) {
    if (!state.includeNonAnime)
        return null;
    if (sourceKey !== FORMULA_SOURCE)
        return null;
    for (const candidate of ['开播日期', '完播日']) {
        const column = state.columnMap.get(candidate);
        if (column !== undefined)
            return column;
    }
    return null;
}
/**
 * 按季目标 + 筛选范围选出可见行
 *
 * 顺序：先按季目标选（既有口径），再过筛选（与 GitHub 同步同口径），
 * 勾了非动漫时对**季目标未命中**的行用原始日期列再捞一遍。
 */
function selectVisibleRows(rows, fallbackValues, target) {
    const base = selectSeasonRows(rows, target, { mapAirMonthToSeason: !isFormulaSource() });
    let matched = base.matchedRows;
    // 非动漫补捞：公式列口径下未命中的行，改用原始日期列 + 归一口径再选一次
    if (fallbackValues.size > 0) {
        const already = new Set(matched);
        const pending = rows
            .filter((item) => !already.has(item.row))
            .map((item) => ({ row: item.row, value: fallbackValues.get(item.row) ?? '' }));
        const second = selectSeasonRows(pending, target, { mapAirMonthToSeason: true });
        matched = [...matched, ...second.matchedRows].sort((a, b) => a - b);
    }
    if (!state.filter.enabled || state.filter.range === 'all') {
        return { ...base, matchedRows: matched };
    }
    const valueByRow = new Map(rows.map((item) => [item.row, item.value]));
    const filtered = matched.filter((row) => {
        const value = valueByRow.get(row) ?? '';
        // 非动漫行的季命中来自兜底列，筛的时候也要按兜底列的值判
        const fallbackValue = fallbackValues.get(row);
        const effective = fallbackValue !== undefined && fallbackValue.trim() !== '' ? fallbackValue : value;
        return isSeasonFilterMatch(effective, state.filter);
    });
    return { ...base, matchedRows: filtered };
}
function renderPreview(names) {
    const { matchedRows, emptyCount, invalidCount } = state.lastSelect;
    const target = state.lastTarget;
    setText('highlightPreviewCount', `命中 ${String(matchedRows.length)} 行`);
    setText('highlightPreviewTarget', target
        ? `目标：${formatSeasonLabel(target)}（${formatSeasonKey(target)}）${isFormulaSource() ? ' · 公式列口径' : ' · 原始日期口径'}`
        : '');
    const chips = byId('highlightPreviewChips');
    if (chips) {
        chips.innerHTML =
            matchedRows.length === 0
                ? '<span class="highlight-chip highlight-chip-empty">无匹配行</span>'
                : matchedRows
                    .slice(0, PREVIEW_CHIP_LIMIT)
                    .map((row) => `<span class="highlight-chip">行 ${String(row)}</span>`)
                    .join('') +
                    (matchedRows.length > PREVIEW_CHIP_LIMIT
                        ? `<span class="highlight-chip">…共 ${String(matchedRows.length)} 行</span>`
                        : '');
    }
    const firstNames = matchedRows
        .slice(0, 3)
        .map((row) => names.get(row) ?? '')
        .filter((name) => name.trim() !== '');
    setText('highlightPreviewNames', firstNames.length > 0 ? `如：${firstNames.join('、')}` : '');
    setText('highlightPreviewSkip', `空 ${String(emptyCount)} 格 · 非日期文本 ${String(invalidCount)} 条（已跳过）`);
}
function renderPreviewEmpty(message) {
    setText('highlightPreviewCount', '命中 0 行');
    setText('highlightPreviewTarget', message);
    const chips = byId('highlightPreviewChips');
    chips?.replaceChildren();
    setText('highlightPreviewNames', '');
    setText('highlightPreviewSkip', '');
}
// ===== 应用 / 清除 =====
function isLastApplied(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const sheet = Reflect.get(value, 'sheet');
    const addresses = Reflect.get(value, 'addresses');
    return typeof sheet === 'string' && Array.isArray(addresses);
}
function readLastApplied() {
    const raw = getConfig(KEY_LAST_APPLIED, '', true);
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (isLastApplied(parsed)) {
            return {
                sheet: parsed.sheet,
                addresses: parsed.addresses.filter((a) => typeof a === 'string'),
            };
        }
    }
    catch {
        bgmLog(LOG_LEVELS.WARN, '[highlight] 上次高亮记录解析失败');
    }
    return null;
}
/** 写样式。Interior / Font 先取到局部量，避免把 COM 属性读两遍 */
function applyRangeStyle(range, style) {
    const interior = range.Interior;
    if (interior) {
        if (style.fillColor !== undefined)
            interior.Color = style.fillColor;
        if (style.fillColorIndex !== undefined)
            interior.ColorIndex = style.fillColorIndex;
    }
    const font = range.Font;
    if (font) {
        if (style.fontColor !== undefined)
            font.Color = style.fontColor;
        if (style.fontColorIndex !== undefined)
            font.ColorIndex = style.fontColorIndex;
    }
}
/**
 * 给一个工作表刷样式：分组装车 + 失败自动对半拆分（拆分逻辑在引擎里，可单测）。
 *
 * @returns 写入成功的组数（0 表示全部失败）
 */
function paintSheet(worksheet, addresses, style) {
    return runRangeGroupsWithSplit(splitRangeAddresses(addresses), (group) => {
        applyRangeStyle(worksheet.Range(group.join(',')), style);
    }, (group, error) => {
        bgmLog(LOG_LEVELS.WARN, `[highlight] 区域写入失败: ${error.message}（${group.join(',')}）`);
    });
}
function applyHighlight(isSilent = false) {
    const { worksheet } = state;
    if (!worksheet) {
        if (!isSilent)
            showToast('请先打开一个数据工作表', 'warn');
        return;
    }
    const rows = state.lastSelect.matchedRows;
    if (rows.length === 0) {
        if (!isSilent)
            showToast('没有可高亮的匹配行', 'warn');
        return;
    }
    // 连续行合并 + 按 8000 字符装车：块失败自动对半拆（见 paintSheet）
    const addresses = [];
    const selected = state.columns.filter((c) => c.selected);
    for (const column of selected) {
        addresses.push(...rowsToRangeAddresses(rows, column.letter));
    }
    const selectedColumns = state.columns.filter((c) => c.selected).length;
    const painted = paintSheet(worksheet, addresses, { fillColor: HIGHLIGHT_COLOR, fontColor: 0 });
    if (painted === 0) {
        if (!isSilent)
            showToast('高亮写入失败，请查看日志', 'error');
        return;
    }
    const record = { sheet: worksheet.Name, addresses };
    setConfig(KEY_LAST_APPLIED, JSON.stringify(record));
    bgmLog(LOG_LEVELS.INFO, `[highlight] 已高亮 ${String(rows.length)} 行 × ${String(selectedColumns)} 列（${String(painted)} 个区域块）`);
    if (!isSilent) {
        showToast(`已高亮 ${String(rows.length)} 行 × ${String(selectedColumns)} 列`, 'success');
    }
}
function clearHighlight(isSilent = false) {
    const record = readLastApplied();
    if (!record) {
        if (!isSilent)
            showToast('没有本插件施加的高亮记录', 'info');
        return;
    }
    const { worksheet } = state;
    if (worksheet?.Name !== record.sheet) {
        if (!isSilent)
            showToast(`请先切换到工作表「${record.sheet}」再清除`, 'warn');
        return;
    }
    paintSheet(worksheet, record.addresses, {
        fillColorIndex: COLOR_INDEX_NONE,
        fontColorIndex: COLOR_INDEX_AUTOMATIC,
    });
    setConfig(KEY_LAST_APPLIED, '');
    bgmLog(LOG_LEVELS.INFO, '[highlight] 已清除上次高亮');
    if (!isSilent)
        showToast('已清除高亮', 'success');
}
// ===== 自动关注（设置页统一管理，页面只读配置同步监听）=====
/** 按配置同步「自动关注」监听：开→注册 SheetChange 监听，关→注销。
 *  不写配置 —— 配置只在设置页「功能开关」改；本页在 init 与每次 reloadSheet 时重读对齐。 */
function syncAutoWatch() {
    const isEnabled = getConfig(CONFIG_KEYS.HIGHLIGHT_AUTO_WATCH, '0', true) === '1';
    if (isEnabled) {
        if (disposeAutoWatch)
            return;
        const app = getApp();
        disposeAutoWatch = registerSheetChangeAutoRefresh(app, () => {
            const { worksheet } = state;
            if (!worksheet)
                return;
            refreshPreview();
            // 之前应用过且仍在同一张表 → 清旧 + 应用新，保持「表格变了高亮跟着变」
            const record = readLastApplied();
            if (record?.sheet === worksheet.Name) {
                clearHighlight(true);
                applyHighlight(true);
            }
        }, { debounceMs: 300 });
        bgmLog(LOG_LEVELS.INFO, '[highlight] 自动关注已开启（SheetChange → 重算高亮）');
    }
    else {
        disposeAutoWatch?.();
        disposeAutoWatch = null;
    }
}
// ===== 手动年月选择器 =====
function buildManualSelectors() {
    const yearSelect = selectById('highlightManualYear');
    if (yearSelect) {
        const thisYear = new Date().getFullYear();
        const years = [thisYear - 3, thisYear - 2, thisYear - 1, thisYear, thisYear + 1];
        yearSelect.innerHTML = years
            .map((y) => `<option value="${String(y)}">${String(y)} 年</option>`)
            .join('');
        yearSelect.value = String(state.manual.year);
        yearSelect.addEventListener('change', () => {
            state.manual = { ...state.manual, year: Number(yearSelect.value) };
            persistManual();
            refreshPreview();
        });
    }
    const monthSelect = selectById('highlightManualMonth');
    if (monthSelect) {
        monthSelect.innerHTML = Array.from({ length: 12 }, (_, index) => index + 1)
            .map((m) => `<option value="${String(m)}">${String(m)} 月</option>`)
            .join('');
        monthSelect.value = String(state.manual.month);
        monthSelect.addEventListener('change', () => {
            state.manual = { ...state.manual, month: Number(monthSelect.value) };
            persistManual();
            refreshPreview();
        });
    }
}
/** 手动年月变更只落 KEY_MANUAL（高亮模式归设置页管理，本页不再写 KEY_MODE） */
function persistManual() {
    setConfig(KEY_MANUAL, `${String(state.manual.year)}-${String(state.manual.month).padStart(2, '0')}`);
}
// ===== 筛选范围（与 GitHub 同步的时间筛选同口径）=====
/** 季度起点月选项（番剧四季：1 / 4 / 7 / 10 月） */
const QUARTER_OPTIONS = [1, 4, 7, 10];
/** 建筛选控件（年 / 季 / 月下拉 + 五个范围按钮 + 非动漫开关 + 筛选动作） */
function buildFilterControls() {
    const yearSelect = selectById('highlightFilterYear');
    if (yearSelect) {
        const thisYear = new Date().getFullYear();
        const years = Array.from({ length: 11 }, (_, index) => thisYear - 5 + index);
        yearSelect.innerHTML = years
            .map((y) => `<option value="${String(y)}">${String(y)} 年</option>`)
            .join('');
        yearSelect.value = String(state.filter.year);
        yearSelect.addEventListener('change', () => {
            state.filter = { ...state.filter, year: Number(yearSelect.value) };
            persistFilter();
            refreshPreview();
        });
    }
    const quarterSelect = selectById('highlightFilterQuarter');
    if (quarterSelect) {
        quarterSelect.innerHTML = QUARTER_OPTIONS.map((m) => `<option value="${String(m)}">${String(m)} 月季</option>`).join('');
        quarterSelect.value = String(state.filter.quarter ?? 1);
        quarterSelect.addEventListener('change', () => {
            state.filter = { ...state.filter, quarter: Number(quarterSelect.value) };
            persistFilter();
            refreshPreview();
        });
    }
    const monthSelect = selectById('highlightFilterMonth');
    if (monthSelect) {
        monthSelect.innerHTML = Array.from({ length: 12 }, (_, index) => index + 1)
            .map((m) => `<option value="${String(m)}">${String(m)} 月</option>`)
            .join('');
        monthSelect.value = String(state.filter.month ?? 1);
        monthSelect.addEventListener('change', () => {
            state.filter = { ...state.filter, month: Number(monthSelect.value) };
            persistFilter();
            refreshPreview();
        });
    }
    for (const button of document.querySelectorAll('[data-filter-range]')) {
        button.addEventListener('click', () => {
            const range = button.dataset.filterRange;
            if (!range)
                return;
            state.filter = { ...state.filter, range: range };
            persistFilter();
            renderFilterUi();
            refreshPreview();
        });
    }
    const nonAnimeBox = inputById('highlightIncludeNonAnime');
    if (nonAnimeBox) {
        nonAnimeBox.checked = state.includeNonAnime;
        nonAnimeBox.addEventListener('change', () => {
            state.includeNonAnime = nonAnimeBox.checked;
            setConfig(KEY_NON_ANIME, nonAnimeBox.checked ? '1' : '0');
            refreshPreview();
        });
    }
    byId('highlightFilterApplyBtn')?.addEventListener('click', () => {
        applyFilterRows();
    });
    byId('highlightFilterClearBtn')?.addEventListener('click', () => {
        clearFilterRows();
    });
}
/** 筛选控件显隐与按钮 active（按 state.filter.range） */
function renderFilterUi() {
    for (const button of document.querySelectorAll('[data-filter-range]')) {
        button.classList.toggle('active', button.dataset.filterRange === state.filter.range);
    }
    // 需要选目标年的三种模式（年度 / 季度 / 月份）；全部与未来番只要一个按钮
    const isYearScoped = ['year', 'quarter', 'month'].includes(state.filter.range);
    const box = byId('highlightFilterBox');
    if (box)
        box.style.display = isYearScoped ? 'flex' : 'none';
    const quarterSelect = selectById('highlightFilterQuarter');
    if (quarterSelect)
        quarterSelect.style.display = state.filter.range === 'quarter' ? '' : 'none';
    const monthSelect = selectById('highlightFilterMonth');
    if (monthSelect)
        monthSelect.style.display = state.filter.range === 'month' ? '' : 'none';
}
/** 落筛选配置：`range|year|quarter|month` */
function persistFilter() {
    setConfig(KEY_FILTER, [
        state.filter.range,
        String(state.filter.year),
        String(state.filter.quarter ?? 1),
        String(state.filter.month ?? 1),
    ].join('|'));
}
/** 从配置恢复筛选（格式不对就回默认全部） */
function restoreFilter() {
    const raw = getConfig(KEY_FILTER, '', true);
    if (raw) {
        const [range, year, quarter, month] = raw.split('|', 4);
        if (range && year) {
            state.filter = {
                enabled: range !== 'all',
                year: Number(year),
                range: range,
                quarter: Number(quarter),
                month: Number(month),
            };
        }
    }
}
/**
 * 筛选显示：把不命中的行隐藏（只改 Hidden，不动数据与填充）
 *
 * 为什么不用 AutoFilter：日期列的单元格形态五花八门（Excel 序列值 / `25年4月`
 * 文本 / 公式输出），criteria 拼不出来；Hidden 是精确的逐行控制，且「取消筛选」
 * 能把范围整体还原，不会留下筛选项箭头误导用户。
 */
function applyFilterRows(isSilent = false) {
    const { worksheet } = state;
    const span = state.filterSpan;
    if (!worksheet || !span) {
        if (!isSilent)
            showToast('请先点「加载并预览」', 'warn');
        return;
    }
    const matched = new Set(state.lastSelect.matchedRows);
    const hiddenRows = [];
    for (let row = span.firstRow; row <= span.lastRow; row += 1) {
        if (!matched.has(row))
            hiddenRows.push(row);
    }
    if (hiddenRows.length === 0) {
        if (!isSilent)
            showToast('所有行都命中，无需筛选', 'info');
        return;
    }
    const painted = runRangeGroupsWithSplit(splitRangeAddresses(rowsToRangeAddresses(hiddenRows, 'A')), (group) => {
        worksheet.Range(group.join(',')).Rows.Hidden = true;
    });
    if (painted === 0) {
        if (!isSilent)
            showToast('筛选写入失败，请查看日志', 'error');
        return;
    }
    bgmLog(LOG_LEVELS.INFO, `[highlight] 已筛选显示 ${String(matched.size)} 行（隐藏 ${String(hiddenRows.length)} 行）`);
    if (!isSilent) {
        showToast(`已筛选显示 ${String(matched.size)} 行（隐藏 ${String(hiddenRows.length)} 行）`, 'success');
    }
}
/** 取消筛选：把数据区整体显示回来 */
function clearFilterRows(isSilent = false) {
    const { worksheet } = state;
    const span = state.filterSpan;
    if (!worksheet || !span) {
        if (!isSilent)
            showToast('请先点「加载并预览」', 'warn');
        return;
    }
    worksheet.Range(`A${String(span.firstRow)}:A${String(span.lastRow)}`).Rows.Hidden = false;
    if (!isSilent)
        showToast('已取消筛选', 'success');
}
/** 按 state.mode 渲染模式按钮 active 与手动框显隐（只读反映配置，不在本页切换） */
function renderModeUi() {
    const autoButton = byId('highlightModeAuto');
    const manualButton = byId('highlightModeManual');
    const manualBox = byId('highlightManualBox');
    autoButton?.classList.toggle('active', state.mode === 'auto');
    manualButton?.classList.toggle('active', state.mode === 'manual');
    if (manualBox)
        manualBox.style.display = state.mode === 'manual' ? 'flex' : 'none';
}
/** 从配置应用「高亮模式 / 自动关注」（设置页统一管理，init 与每次 reloadSheet 重读）。
 *  不在此 refreshPreview —— 由调用链按需触发，避免 init 时数据未就绪的空跑。 */
function applyFeatureTogglesFromConfig() {
    const mode = getConfig(CONFIG_KEYS.HIGHLIGHT_MODE, 'auto', true);
    state.mode = mode === 'manual' ? 'manual' : 'auto';
    renderModeUi();
    syncAutoWatch();
}
// ===== 初始化 =====
/** 重新绑定工作表与列映射（「加载并预览」按钮共用）。只跑选定表，不自动猜。 */
function reloadSheet() {
    const { worksheet } = state;
    if (!worksheet) {
        setText('highlightSheetName', '请选择数据工作表');
        renderPreviewEmpty('请先在上方选择工作簿与工作表，然后点「加载并预览」');
        return;
    }
    // 每次加载工作表前重读功能开关（设置页改的模式 / 自动关注在此对齐）
    applyFeatureTogglesFromConfig();
    state.headerRow = findHeaderRow(worksheet);
    state.columnMap = getColumnMap(worksheet, state.headerRow);
    setText('highlightSheetName', worksheet.Name);
    // 跨页共享：把刚加载的工作簿/表/列/行写入数据上下文，其它页进入时重放显示
    saveDataContext(snapshotFromWorksheet(worksheet, state.headerRow, 'highlight'));
    renderSourcePicker();
    rebuildColumns();
    renderColumnList();
}
/**
 * 分片 1：恢复配置 + 主题 + 枚举工作表（含 PluginStorage 读与 collectSheets，
 *   属跨进程调用，必须过 COM 闸门）。只枚举**表名**，不读单元格数据——
 *   真正的重活在用户点「加载并预览」时才发生（那时宿主早已 attach，不会卡）。
 */
function highlightPhaseConfig() {
    markHighlightPaneLoaded();
    initializeTheme();
    startThemeSync();
    // 进入时重放：其它页获取的工作簿/表/列/行一次性显示（读一次存储，零轮询）
    mountDataContextNotice('highlight');
    const manual = getConfig(KEY_MANUAL, '', true);
    const manualMatch = /^(\d{4})-(\d{1,2})$/.exec(manual);
    if (manualMatch) {
        state.manual = { year: Number(manualMatch[1]), month: Number(manualMatch[2]) };
    }
    buildManualSelectors();
    // 筛选范围（年度 / 季度 / 月份 / 未来番，与 GitHub 同步同口径）+ 非动漫开关
    restoreFilter();
    buildFilterControls();
    renderFilterUi();
    // 高亮模式 / 自动关注从配置应用（设置页统一管理；renderModeUi 同步按钮态与手动框显隐）
    applyFeatureTogglesFromConfig();
    // 枚举已打开的工作簿 / 工作表（轻量 COM），默认定位到：
    //   上次选中的表（KEY_SHEET）> 当前活动表 > 第一张表
    state.sheets = collectSheets();
    const savedKey = getConfig(KEY_SHEET, '', true);
    const isSavedValid = state.sheets.some((entry) => entry.key === savedKey);
    if (isSavedValid) {
        state.selectedKey = savedKey;
    }
    else if (isSheetLocked()) {
        // 锁定：选中键失效也不静默跳走（用户要去套用到别处的表时，
        // 原表可能已被关掉），交给 renderSheetPicker 提示重选。
        state.selectedKey = '';
        state.selectionMissing = savedKey;
    }
    else {
        const active = activeWorksheet();
        const matched = active ? state.sheets.find((entry) => entry.worksheet === active) : undefined;
        state.selectedKey = (matched ?? state.sheets[0])?.key ?? '';
    }
    state.worksheet = selectedSheetEntry()?.worksheet ?? null;
    renderWorkbookPicker();
    renderSheetPicker();
    resetSheetData();
    // 「一键套用」：把别处选中的簿/表落到本页的 KEY_SHEET 上
    registerTargetSheetApplier('highlight', (snap) => {
        if (!snap.workbook || !snap.sheet)
            return false;
        const key = `${snap.workbook}::${snap.sheet}`;
        const isHit = state.sheets.some((entry) => entry.key === key);
        if (!isHit)
            return false;
        state.selectedKey = key;
        state.worksheet = selectedSheetEntry()?.worksheet ?? null;
        state.selectionMissing = '';
        setConfig(KEY_SHEET, key);
        renderWorkbookPicker();
        renderSheetPicker();
        resetSheetData();
        return true;
    });
}
/** 目标表锁定开关当前值（默认不锁，保持既有兜底行为） */
function isSheetLocked() {
    return getConfig(KEY_SHEET_LOCK, '0', true) === '1';
}
/** 设置目标表锁定开关 */
function setSheetLock(isLocked) {
    setConfig(KEY_SHEET_LOCK, isLocked ? '1' : '0');
    // 解锁的瞬间若正处于「原表已不存在」状态，立刻补一次兜底定位，
    // 否则用户要等到下次刷新才能选到表（解锁却选不了，像是按钮失灵）。
    if (!isLocked && state.selectionMissing) {
        reloadSheetSelection();
    }
    renderSheetPicker();
}
/** 重新枚举并按既有优先级定位（锁定态不跳活动表） */
function reloadSheetSelection() {
    state.sheets = collectSheets();
    const isSelectionValid = state.sheets.some((entry) => entry.key === state.selectedKey);
    if (!isSelectionValid && state.sheets.length > 0) {
        if (isSheetLocked()) {
            state.selectedKey = '';
            state.selectionMissing = state.selectedKey || '（未知）';
        }
        else {
            const active = activeWorksheet();
            const matched = active ? state.sheets.find((entry) => entry.worksheet === active) : undefined;
            state.selectedKey = (matched ?? state.sheets[0])?.key ?? '';
            state.selectionMissing = '';
        }
    }
    else if (isSelectionValid) {
        state.selectionMissing = '';
    }
    state.worksheet = selectedSheetEntry()?.worksheet ?? null;
    renderWorkbookPicker();
    renderSheetPicker();
    resetSheetData();
}
/** 分片 2：事件接线 + 启用按钮（纯 DOM，零 COM） */
function highlightPhaseBind() {
    // 工作簿 / 工作表 / 识别列：选择器内部通过 onChange 调
    // onWorkbookChange / onSheetChange / onSourceChange，不再绑 <select> 的 change
    // 高亮模式已上移设置页「⚙️ 功能开关」统一管理；此处按钮只读展示当前模式，点击给指引
    byId('highlightModeAuto')?.addEventListener('click', () => {
        showToast('高亮模式请在「设置 · 功能开关」中修改', 'info');
    });
    byId('highlightModeManual')?.addEventListener('click', () => {
        showToast('高亮模式请在「设置 · 功能开关」中修改', 'info');
    });
    byId('highlightRefreshBtn')?.addEventListener('click', () => {
        reloadSheet();
        refreshPreview();
    });
    byId('highlightApplyBtn')?.addEventListener('click', () => {
        applyHighlight();
    });
    byId('highlightClearBtn')?.addEventListener('click', () => {
        clearHighlight();
    });
    // 自动关注已上移设置页「⚙️ 功能开关」统一管理；此处复选框只读反映配置，
    // 勾选态在 init/reloadSheet 的 syncAutoWatch 里按配置对齐。点击仅给指引，
    // 并把勾选态还原成配置值，避免视觉与配置不一致。
    const watchBox = inputById('highlightAutoWatch');
    if (watchBox) {
        watchBox.checked = getConfig(CONFIG_KEYS.HIGHLIGHT_AUTO_WATCH, '0', true) === '1';
        watchBox.addEventListener('change', () => {
            watchBox.checked = getConfig(CONFIG_KEYS.HIGHLIGHT_AUTO_WATCH, '0', true) === '1';
            showToast('自动关注请在「设置 · 功能开关」中修改', 'info');
        });
    }
    // 目标表锁定：默认不锁（选中键失效时兜底跳活动表，保持既有行为）。
    // 勾选后失效不跳 —— 避免用户没注意时把高亮应用到另一张表上。
    const lockBox = inputById('highlightSheetLock');
    if (lockBox) {
        lockBox.checked = isSheetLocked();
        lockBox.addEventListener('change', () => {
            setSheetLock(lockBox.checked);
        });
    }
    // 启用 data-action 按钮
    notifyModulesReady();
}
/**
 * 高亮页初始化分片（仅轻量 COM）。
 *
 * 关键原则（2026-10-21 真机 bisect）：新窗格打开时若在宿主「attach → COM 桥建好」
 * 的窗口里自动读表，会把 WPS 主线程卡 70 秒（宿主与渲染进程互锁死等，直到 JSAPI
 * 桥看门狗超时）。所以初始化**只做轻量 COM**（配置 + 枚举表名 + 主题），数据读取
 * 100% 交给用户点「加载并预览」——那时宿主早已就绪，稀疏同步 COM 只有几百毫秒，
 * 不再撞窗口、也不轮询。
 */
export function createHighlightPagePhases() {
    return [
        { name: '恢复配置', run: highlightPhaseConfig },
        { name: '事件接线', run: highlightPhaseBind },
    ];
}
/** 一次性跑完所有分片并加载（供测试 / 非窗格场景；窗格页面请走 runComPhases） */
export function initializeHighlightPage() {
    initializeShellNav();
    for (const phase of createHighlightPagePhases()) {
        phase.run();
    }
    // 非窗格路径无下拉可选，直接对活动表做完整加载
    state.worksheet ??= activeWorksheet();
    reloadSheet();
    refreshPreview();
}
