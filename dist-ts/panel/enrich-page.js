/**
 * @fileoverview 富化页面的 UI 控制器
 * @module panel/enrichPage
 * @description 负责文件选择、表头识别、列映射编辑、匹配预览、富化执行与进度、富化记录查看。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { enrichEntries } from '../sync/enrich-engine.js';
import { buildIntroSheetContext, findIntroSheetInWorkbook } from '../sync/enrich-intro.js';
import { detectAnimeSourceLayout, detectColumns } from '../sync/enrich-layout.js';
import { matchEntries } from '../sync/enrich-matching.js';
import { refreshEnrichWorkbooks, refreshEnrichSheets, toggleEnrichWorkbookLock, updateEnrichLockButton, getLockedEnrichSheet, initializeEnrichLock, autoSelectEnrichTarget, lockEnrichSheetByName, } from '../sync/enrich-lock.js';
import { getOrCreateEnrichRecordSheet } from '../sync/enrich-record.js';
import { ANIME_SOURCE_DETECTOR, BANGUMI_TARGET_DETECTOR, collectDetectedWorkbookPaths, describeOpenWorkbooks, mergeDetectedPathsIntoStorage, } from '../sync/workbook-auto-detect.js';
import { sanitizeHtml } from '../tools/sanitize.js';
import { escapeHtml } from '../tools/string-utilities.js';
import { showToast } from '../ui/dialog.js';
import { findHeaderRow, bgmLog, BGM, getApp } from '../tools/util/index.js';
import { findWorkbookByName } from '../tools/locked-sheet.js';
// 工作簿集合签名与面板 / 富化识别缓存共用同一实现（含活动工作簿名）
import { readWorkbookSignature } from '../tools/target-detect-cache.js';
import { mountDataContextNotice, registerTargetSheetApplier } from '../tools/data-context.js';
import { recomputeScrollspy } from './shell-nav.js';
import { extractFileName } from './enrich-file-name.js';
import { setPreviewTab, applyPreviewTabVisibility, resetMatchResults, refreshMatchHintText, } from './enrich-preview-tab.js';
import { openSourceWorkbook, closeWorkbook, closeOpenedSourceWorkbook, closeSourceWorkbookOnly, ensureSourceSheet, } from './enrich-source-workbook.js';
import { state, safeGetElement, safeGetButton, safeGetSelect, safeGetCheckbox, } from './enrich-page-context.js';
import { showSourceDetail, hideSourceDetail } from './enrich-source-detail.js';
import { maybeAutoCleanAfterEnrich, showEnrichDetailButton, showEnrichDetail, hideEnrichDetail, } from './enrich-result-view.js';
import { openEnrichRecordSheet, clearRecords, loadRecentRecords } from './enrich-record-view.js';
import { createFloatingProgress, createInlineProgress, progressHosts, } from './enrich-progress-hosts.js';
import { collectAllConflicts, bindConflictDialogButtons, showConflictDialog, } from './enrich-conflict-dialog.js';
import { detectHeaderOnSheet, previewMatch, hideMatchDetail } from './enrich-preview-flow.js';
// ========== 初始化 ==========
export function initializeEnrichPage() {
    bgmLog(LOG_LEVELS.INFO, '[enrich] initializeEnrichPage 开始');
    // 进入时重放：其它页获取的工作簿/表/列/行一次性显示（读一次存储，零轮询）
    mountDataContextNotice('enrich');
    // 初始化富化工作簿锁定模块（恢复持久化的锁定状态）
    initializeEnrichLock('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus');
    bindFileSelector();
    bindDetectHeaderButton();
    bindTargetSheetControls();
    bindTabSwitches();
    bindStartEnrichButton();
    bindRecordControls();
    bindEnrichDetailControls();
    bindPreviewDetailControls();
    bindBatchControls();
    bindConflictDialogButtons();
    loadRecentRecords();
    // 如果有锁定的工作表，自动填充到 state
    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
        const locked = getLockedEnrichSheet();
        if (locked) {
            const [, lockedSheet] = locked;
            state.bangumiSheet = lockedSheet;
            bgmLog(LOG_LEVELS.INFO, `[enrich] 已恢复锁定的目标工作表: ${lockedSheet.Name}`);
        }
    }
    // 检查方式 B：打开富化工具页面时，自动添加并识别已打开的新番表工作簿
    autoAddOpenAnimeWorkbooks();
    // 页面打开时：若已识别到打开的 Bangumi 数据表且目标表未锁定，自动选择/锁定目标表
    checkBangumiAutoDetectRecords();
    // 初始化「数据预览」页签可见性（默认新番表数据页签，隐藏匹配相关按钮/统计）
    refreshMatchHintText();
    applyPreviewTabVisibility();
    startEnrichWorkbookWatch();
    // 通知模块就绪，启用按钮（与 panelPage.initializePanelCore / settings-entry.startSettings 对齐）
    if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('bgm:modulesReady'));
        bgmLog(LOG_LEVELS.INFO, '[enrich] initializeEnrichPage 完成，bgm:modulesReady 已触发');
    }
    // 「一键套用」：把别处选中的簿/表落到本页的锁定键上（索引按名字反查，
    // 见 lockEnrichSheetByName）。成功后同步下拉与 state.bangumiSheet，
    // 用户可直接点「开始富化」。
    registerTargetSheetApplier('enrich', (snap) => {
        if (!snap.workbook || !snap.sheet)
            return false;
        if (!lockEnrichSheetByName(snap.workbook, snap.sheet))
            return false;
        refreshWorkbookList();
        refreshSheetList();
        updateEnrichLockButton('lockSheetBtn', 'lockStatus');
        selectTargetSheet();
        return true;
    });
}
function bindFileSelector() {
    const button = safeGetButton('selectFileBtn');
    if (button) {
        button.addEventListener('click', () => {
            selectNewAnimeFile();
        });
    }
}
function bindDetectHeaderButton() {
    const button = safeGetButton('detectHeaderBtn');
    if (button) {
        button.addEventListener('click', () => {
            autoDetectHeader();
        });
    }
    // 可选开关：识别后关闭源文件，开始富化时再重开
    const closeChk = safeGetCheckbox('closeSourceAfterDetectChk');
    if (closeChk) {
        closeChk.addEventListener('change', () => {
            state.closeSourceAfterDetect = closeChk.checked;
            bgmLog(LOG_LEVELS.INFO, `[enrich] 源文件识别后关闭开关: ${closeChk.checked ? '开' : '关'}`);
        });
        state.closeSourceAfterDetect = closeChk.checked;
    }
}
function bindTargetSheetControls() {
    const wbSelect = safeGetSelect('workbookSelect');
    if (wbSelect) {
        wbSelect.addEventListener('change', () => {
            // 用户已手动选择：取消自动识别的兜底重试，避免覆盖用户选择
            suppressEnrichAutoSelect();
            refreshSheetList();
            // 切换工作簿时同步锁定状态显示
            updateEnrichLockButton('lockSheetBtn', 'lockStatus');
        });
    }
    const sheetSelect = safeGetSelect('sheetSelect');
    if (sheetSelect) {
        sheetSelect.addEventListener('change', () => {
            // 用户已手动选择：取消自动识别的兜底重试，避免覆盖用户选择
            suppressEnrichAutoSelect();
            selectTargetSheet();
            // 切换工作表时同步锁定状态显示
            updateEnrichLockButton('lockSheetBtn', 'lockStatus');
        });
    }
    const refreshButton = document.querySelector('[data-action="refreshSheets"]');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            refreshWorkbookList();
            if (BGM.sheet.isLocked) {
                refreshSheetList();
            }
            else {
                // 未锁定时重新尝试自动选择目标工作表
                // 手动刷新：强制全扫并回写识别缓存（缓存不会变成死角）
                autoSelectEnrichTarget('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus', {
                    force: true,
                });
                refreshSheetList();
                selectTargetSheet();
            }
            updateEnrichLockButton('lockSheetBtn', 'lockStatus');
            // 刷新后若已锁定目标工作表，自动跑一次预览匹配（用户无需再点一次「预览匹配」即可看到匹配结果）
            if (state.animeSourceSheet && state.bangumiSheet && state.columnMapping) {
                queueMicrotask(() => {
                    previewMatch();
                });
            }
        });
    }
    const lockButton = safeGetButton('lockSheetBtn');
    if (lockButton) {
        lockButton.addEventListener('click', () => {
            toggleSheetLock();
        });
    }
    refreshWorkbookList();
    refreshSheetList();
}
function bindTabSwitches() {
    const tabs = document.querySelectorAll('.preview-tab');
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            if (tabName !== 'source' && tabName !== 'match')
                return;
            tabs.forEach((t) => {
                t.classList.remove('active');
            });
            tab.classList.add('active');
            setPreviewTab(tabName);
        });
    });
}
function bindStartEnrichButton() {
    const button = safeGetButton('startEnrichBtn');
    if (button) {
        button.addEventListener('click', () => {
            startEnrichment();
        });
    }
}
function bindRecordControls() {
    const openRecordButton = document.querySelector('[data-action="openRecordSheet"]');
    if (openRecordButton) {
        openRecordButton.addEventListener('click', () => {
            openEnrichRecordSheet();
        });
    }
    const clearRecordButton = document.querySelector('[data-action="clearRecords"]');
    if (clearRecordButton) {
        clearRecordButton.addEventListener('click', () => {
            clearRecords();
        });
    }
}
function bindEnrichDetailControls() {
    const viewButton = safeGetButton('viewEnrichDetailBtn');
    if (viewButton) {
        viewButton.addEventListener('click', () => {
            showEnrichDetail();
        });
    }
    const closeButtons = [
        safeGetButton('enrichDetailCloseBtn'),
        safeGetButton('enrichDetailDoneBtn'),
    ].filter((button) => button !== null);
    for (const button of closeButtons) {
        button.addEventListener('click', () => {
            hideEnrichDetail();
        });
    }
}
function bindPreviewDetailControls() {
    const previewMatchButton = safeGetButton('previewMatchBtn');
    if (previewMatchButton) {
        previewMatchButton.addEventListener('click', () => {
            previewMatch();
        });
    }
    const viewSourceButton = safeGetButton('viewSourceDetailBtn');
    if (viewSourceButton) {
        viewSourceButton.addEventListener('click', () => {
            showSourceDetail();
        });
    }
    const sourceCloseButtons = [
        safeGetButton('sourceDetailCloseBtn'),
        safeGetButton('sourceDetailDoneBtn'),
    ].filter((button) => button !== null);
    for (const button of sourceCloseButtons) {
        button.addEventListener('click', () => {
            hideSourceDetail();
        });
    }
    const matchCloseButtons = [
        safeGetButton('matchDetailCloseBtn'),
        safeGetButton('matchDetailDoneBtn'),
    ].filter((button) => button !== null);
    for (const button of matchCloseButtons) {
        button.addEventListener('click', () => {
            hideMatchDetail();
        });
    }
}
/**
 * 调用 WPS 原生多选文件对话框
 * @returns 选中的文件路径数组（用户取消返回空数组）；FileDialog 不可用或异常时返回 null（触发回退）
 */
function pickFilesWithMultiSelect() {
    // 整个调用包在大 try 里：WPS 部分版本可能声明了 FileDialog 但实际抛错，
    // 任何环节出错都安全回退到 GetOpenFilename 循环
    try {
        const app = getApp();
        if (!app || typeof app.FileDialog !== 'function')
            return null;
        // msoFileDialogFilePicker = 3；优先用 Application 上的常量，缺失则用字面量
        const dialogType = typeof app.msoFileDialogFilePicker === 'number' ? app.msoFileDialogFilePicker : 3;
        const dialog = app.FileDialog(dialogType);
        if (!dialog)
            return null;
        dialog.AllowMultiSelect = true;
        dialog.Title = '选择新番表文件（可多选，按住 Ctrl/Shift 批量选择）';
        try {
            dialog.Filters.Clear();
        }
        catch {
            // 部分实现不支持 Clear，直接 Add 即可（Add 会追加）
        }
        dialog.Filters.Add('Excel 文件 (*.xlsx)', '*.xlsx', 1);
        dialog.Filters.Add('Excel 97-2003 文件 (*.xls)', '*.xls', 2);
        dialog.Filters.Add('CSV 文件 (*.csv)', '*.csv', 3);
        dialog.Filters.Add('所有文件 (*.*)', '*.*', 4);
        // Show() 返回 -1 = 确定，0 = 取消
        const result = dialog.Show();
        if (result !== -1)
            return [];
        const paths = [];
        const count = dialog.SelectedItems.Count;
        for (let index = 1; index <= count; index += 1) {
            const item = dialog.SelectedItems.Item(index);
            if (item)
                paths.push(item);
        }
        return paths;
    }
    catch {
        return null;
    }
}
/**
 * 将一批路径合并入 state.batchFiles，跳过重复项，刷新 UI。
 * 返回本次新增数量。
 */
function mergeSelectedPaths(paths) {
    let added = 0;
    for (const filePath of paths) {
        if (state.batchFiles.includes(filePath)) {
            bgmLog(LOG_LEVELS.INFO, `[enrich] 跳过重复文件: ${extractFileName(filePath)}`);
        }
        else {
            state.batchFiles.push(filePath);
            // 首个文件同时作为单文件富化目标
            if (state.batchFiles.length === 1) {
                state.filePath = filePath;
            }
            added += 1;
        }
    }
    if (added > 0) {
        bgmLog(LOG_LEVELS.INFO, `[enrich] 批量选择: 新增 ${String(added)} 个，累计 ${String(state.batchFiles.length)} 个`);
        renderBatchFileList();
    }
    return added;
}
/**
 * 回退方案：GetOpenFilename 循环单选 + 询问是否继续
 * 用于 FileDialog 在当前 WPS 版本不可用时
 */
function selectNewAnimeFileLoop() {
    const app = getApp();
    if (!app || typeof app.GetOpenFilename !== 'function') {
        BGM.Dialog.alert('提示', 'WPS 文件对话框不可用，请直接在 WPS 中打开文件');
        return;
    }
    const fileFilter = 'Excel 文件 (*.xlsx),*.xlsx,Excel 97-2003 文件 (*.xls),*.xls,CSV 文件 (*.csv),*.csv,所有文件 (*.*),*.*';
    for (;;) {
        const titleSuffix = state.batchFiles.length > 0
            ? `（已选 ${String(state.batchFiles.length)} 个，继续添加按"取消"结束）`
            : '';
        const selected = app.GetOpenFilename(fileFilter, `选择新番表文件${titleSuffix}`);
        // 用户取消
        if (typeof selected === 'boolean' || selected === false) {
            bgmLog(LOG_LEVELS.INFO, '[enrich] 用户取消文件选择');
            break;
        }
        const filePath = String(selected);
        const fileName = extractFileName(filePath);
        // 重复文件跳过
        if (state.batchFiles.includes(filePath)) {
            BGM.Dialog.alert('提示', `文件已在列表中：\n${fileName}`);
        }
        else {
            state.batchFiles.push(filePath);
            // 首个文件同时作为单文件富化目标
            if (state.batchFiles.length === 1) {
                state.filePath = filePath;
            }
            bgmLog(LOG_LEVELS.INFO, `[enrich] 已选择文件: ${fileName}（共 ${String(state.batchFiles.length)} 个）`);
            // 每次选完后同步刷新 UI（让用户看到当前已选列表）
            renderBatchFileList();
            // 询问是否继续添加（WPS 同步阻塞式 confirm：回调里改 shouldContinue，随后立即读取）
            // `false as boolean`：避免 TS 将闭包赋值忽略后把变量静态收窄为 false 字面量
            let shouldContinue = false;
            BGM.Dialog.confirm(`已添加 ${fileName}\n当前共 ${String(state.batchFiles.length)} 个文件\n点击【确定】继续添加，点击【取消】完成选择`, (isConfirmed) => {
                shouldContinue = isConfirmed;
            }, '继续添加？');
            if (!shouldContinue)
                break;
        }
    }
}
export function selectNewAnimeFile() {
    try {
        // 1) 优先尝试 FileDialog（真正的多选）
        const multiResult = pickFilesWithMultiSelect();
        if (multiResult !== null) {
            // FileDialog 可用；空数组代表用户取消
            if (multiResult.length > 0) {
                mergeSelectedPaths(multiResult);
                // 单文件：选完立即自动识别表头（多文件由批量流程逐文件识别）
                maybeAutoDetectSingleFile();
            }
            else {
                bgmLog(LOG_LEVELS.INFO, '[enrich] 用户取消文件选择');
            }
            return;
        }
        // 2) 回退：GetOpenFilename 循环
        bgmLog(LOG_LEVELS.INFO, '[enrich] FileDialog 不可用，回退到 GetOpenFilename 循环单选');
        selectNewAnimeFileLoop();
        // 回退路径同样支持单文件自动识别
        maybeAutoDetectSingleFile();
    }
    catch (error) {
        BGM.handleError(error, {
            showAlert: true,
            level: BGM.ErrorLevel.ERROR,
            context: 'selectNewAnimeFile',
        });
    }
}
/** 渲染文件选择区 UI：路径展示、文件列表、批量按钮可见性 */
function renderBatchFileList() {
    const pathElement = safeGetElement('filePathDisplay');
    const listElement = safeGetElement('batchFileList');
    const startButton = safeGetButton('batchStartBtn');
    const clearButton = safeGetButton('batchClearBtn');
    const summaryElement = safeGetElement('batchSummary');
    const singleEnrichButton = safeGetButton('startEnrichBtn');
    const n = state.batchFiles.length;
    // 0) 单文件自动识别接管的源工作簿仅在 N===1 时保持打开
    if (n !== 1) {
        closeOpenedSourceWorkbook();
    }
    // 1) 路径展示
    if (pathElement) {
        if (n === 0) {
            pathElement.textContent = '';
            pathElement.setAttribute('placeholder', '未选择文件...');
            pathElement.removeAttribute('title');
        }
        else {
            const firstFile = state.batchFiles[0];
            if (n === 1 && firstFile !== undefined) {
                pathElement.textContent = firstFile;
                pathElement.setAttribute('title', firstFile);
            }
            else if (firstFile !== undefined) {
                const firstName = extractFileName(firstFile);
                pathElement.textContent = `已选 ${String(n)} 个文件（首个：${firstName}）`;
                pathElement.setAttribute('title', state.batchFiles.join('\n'));
            }
        }
    }
    // 2) 单文件"开始富化"按钮的启用状态
    //    N>=2 时源表归批量流程所有（单文件源工作簿已被回收），必须禁用，
    //    否则会拿着失效/错误的源表跑单文件富化。
    if (singleEnrichButton) {
        singleEnrichButton.disabled = n !== 1;
        if (n >= 2) {
            singleEnrichButton.title = '已选多个文件，请使用「🚀 批量富化」';
        }
        else if (n === 0) {
            singleEnrichButton.title = '请先选择新番表文件';
        }
        else {
            singleEnrichButton.title = '';
        }
    }
    // 3) 文件列表（只在 N≥1 时显示）
    if (listElement) {
        if (n === 0) {
            listElement.style.display = 'none';
            listElement.replaceChildren();
        }
        else {
            const rows = state.batchFiles.map((filePath, index) => {
                const fileName = extractFileName(filePath);
                return `
          <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px solid #2a2a2a;font-size:12px;">
            <span style="color:#888;flex-shrink:0;">#${String(index + 1)}</span>
            <span style="flex:1;color:#e0e0e0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(filePath)}">${escapeHtml(fileName)}</span>
            <button class="bgm-btn small" data-batch-remove="${String(index)}" style="flex-shrink:0;padding:2px 6px;font-size:11px;">✕</button>
          </div>
        `;
            });
            listElement.innerHTML = sanitizeHtml(rows.join(''));
            listElement.style.display = '';
            listElement.querySelectorAll('[data-batch-remove]').forEach((button) => {
                button.addEventListener('click', () => {
                    const index = Number(button.dataset.batchRemove || '-1');
                    if (index >= 0)
                        batchRemoveFile(index);
                });
            });
        }
    }
    // 4) 批量按钮可见性
    //    - 批量富化：N≥2 才显示（单文件走"开始富化"）
    //    - 清空列表：N≥1 才显示
    if (startButton)
        startButton.style.display = n >= 2 ? '' : 'none';
    if (clearButton)
        clearButton.style.display = n >= 1 ? '' : 'none';
    // 5) 汇总区域重置（清空时一并隐藏）
    if (n === 0) {
        // 上一轮批量富化的完成态浮动卡片此时已无对应文件，回收掉；
        // 富化进行中不回收——用户可能正靠着卡片看进度、点「停止」。
        if (!state.isBatchEnriching) {
            progressHosts.batch?.hide();
            progressHosts.batch = null;
        }
        if (summaryElement)
            summaryElement.style.display = 'none';
        state.batchResults = [];
        state.filePath = '';
        // 列表清空时同步隐藏自动识别提示
        const notice = safeGetElement('autoDetectNotice');
        if (notice)
            notice.style.display = 'none';
    }
    // 6) 文件已选后折叠 sec-file 内的「选择文件 / 自动识别」按钮组（CSS 控制）
    //    使 sec-file 收缩，让 sec-target 自然上移到主区域顶部，与侧栏第 2 项高亮对齐，
    //    避免 scrollspy 在 sec-file 与 sec-target 之间跳动造成「导航高亮与首个可见模块错位」。
    const secFile = document.getElementById('sec-file');
    if (secFile)
        secFile.classList.toggle('has-file-selected', n > 0);
    // 7) 主动触发 scrollspy 重算：sec-file 高度变化后立刻刷新「当前主导区块」
    recomputeScrollspy();
}
// ========== 表头自动识别 ==========
/**
 * 打开新番表文件并在其首个工作表上识别表头。
 * - 文件已在 WPS 中打开时直接复用，避免重复打开、更避免误关用户文件
 * - 识别成功后工作簿保持打开供富化使用，由 closeOpenedSourceWorkbook() 统一回收
 * @returns 是否识别成功
 */
function autoDetectHeaderFromFile(filePath) {
    const fileName = extractFileName(filePath);
    try {
        const opened = openSourceWorkbook(filePath);
        if (!opened) {
            throw new Error('WPS 应用不可用，无法打开新番表文件');
        }
        const { wb, isOpenedByUs } = opened;
        // 先回收上一个源工作簿再识别：回收会清空源表状态，必须早于写入新状态
        if (state.sourceWorkbook && state.sourceWorkbook !== wb) {
            closeOpenedSourceWorkbook();
        }
        const worksheet = wb.Worksheets.Item(1);
        if (!worksheet) {
            if (isOpenedByUs)
                closeWorkbook(wb);
            throw new Error('文件中没有工作表');
        }
        const mapping = detectHeaderOnSheet(worksheet, fileName);
        if (!mapping) {
            // 识别失败：本次为识别而打开的工作簿立即回收，不接管到 state
            if (isOpenedByUs)
                closeWorkbook(wb);
            return false;
        }
        // 识别成功：接管当前工作簿
        state.sourceWorkbook = wb;
        state.isSourceWorkbookOpenedByUs = isOpenedByUs;
        // 可选开关：识别后关闭源工作簿，开始富化时再重开（避免文件长期占用）
        if (state.closeSourceAfterDetect) {
            closeSourceWorkbookOnly();
            bgmLog(LOG_LEVELS.INFO, '[enrich] 识别成功，按开关关闭源工作簿（开始富化时自动重开）');
        }
        return true;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bgmLog(LOG_LEVELS.ERROR, `[enrich] 自动识别表头失败: ${fileName} - ${message}`);
        BGM.Dialog.alert('提示', `自动识别表头失败：${message}\n可手动点击「🔍 自动识别表头」重试`);
        return false;
    }
}
/** 单文件场景下选完文件立即自动识别表头（多文件由 processSingleBatchFile 逐文件识别） */
function maybeAutoDetectSingleFile() {
    if (state.batchFiles.length !== 1)
        return;
    const filePath = state.batchFiles[0];
    if (filePath === undefined)
        return;
    bgmLog(LOG_LEVELS.INFO, '[enrich] 单文件选择完成，自动识别表头');
    autoDetectHeaderFromFile(filePath);
}
// ========== 已打开工作簿自动识别（检查方式 B：打开页面时） ==========
/** 在页面打开时自动检查：把 WPS 中已打开的新番表工作簿加入列表并识别表头 */
function autoAddOpenAnimeWorkbooks() {
    try {
        const paths = collectDetectedWorkbookPaths(ANIME_SOURCE_DETECTOR);
        if (paths.length === 0) {
            bgmLog(LOG_LEVELS.INFO, '[enrich] 页面打开检查：未检测到已打开的新番表工作簿');
            return;
        }
        const added = mergeSelectedPaths(paths);
        if (added === 0)
            return;
        bgmLog(LOG_LEVELS.INFO, `[enrich] 页面打开检查：自动添加 ${String(added)} 个已打开的新番表工作簿`);
        showAutoDetectNotice(paths);
        // 单文件：自动添加后立即识别表头（多文件由批量流程逐文件识别）
        maybeAutoDetectSingleFile();
    }
    catch (error) {
        BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.ERROR,
            context: 'autoAddOpenAnimeWorkbooks',
        });
    }
}
/**
 * 页面打开时检查 Bangumi 数据表识别情况：未锁定时交由 autoSelectEnrichTarget 自动选择/锁定目标表。
 *
 * 注意：不能因为「检测器结果为 0」就跳过自动选择。
 * 检测器（BANGUMI_TARGET_DETECTOR）带名称预筛，工作表名不含 bangumi/追踪/动画 等关键词时会返回 0；
 * 而 autoSelectEnrichTarget 内部使用的 findBangumiTargetSheets 具备「无名称命中时回退扫描全部工作表」
 * 的兜底能力。二者判定口径不一致，跳过会导致明明可识别的目标表被漏掉。
 */
function checkBangumiAutoDetectRecords() {
    try {
        // § 性能：已锁定目标表时，自动定位不需要检测记录 —— 直接早退，
        // 不再做「实时扫描 + 合并记录」两次全簿扫描。
        // 记录本身由 WPS 启动时的 overwrite + WorkbookOpen/Activate 事件维护；
        // 页面打开时的合并只为「未锁定 → 自动选表」服务。
        if (BGM.sheet.isLocked) {
            bgmLog(LOG_LEVELS.INFO, '[enrich] 页面打开检查：目标表已锁定，跳过识别记录扫描');
            return;
        }
        // 合并结果自带各检测目标的条数：日志直接复用，避免再单独扫一遍（原先重复扫描）
        const merged = mergeDetectedPathsIntoStorage();
        const bangumiCount = merged.find((item) => item.label === BANGUMI_TARGET_DETECTOR.label)?.count ?? 0;
        bgmLog(LOG_LEVELS.INFO, `[enrich] 页面打开检查：Bangumi 数据表识别记录 ${String(bangumiCount)} 个；当前打开工作簿 ${describeOpenWorkbooks()}`);
        const result = autoSelectEnrichTarget('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus');
        if (result !== 'none') {
            // 自动选择/锁定不会触发 select 的 change 事件，需同步 state.bangumiSheet
            selectTargetSheet();
        }
        bgmLog(LOG_LEVELS.INFO, `[enrich] 页面打开检查：目标表自动识别结果=${result}`);
    }
    catch (error) {
        BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.ERROR,
            context: 'checkBangumiAutoDetectRecords',
        });
    }
}
// ========== 工作簿变化监听（自动识别目标工作簿） ==========
//
// 背景：页面打开时 WPS 的 Workbooks 集合可能尚未就绪，或目标工作簿在页面打开之后才被打开/激活，
// 导致首轮扫描漏掉目标表（现象：工作簿下拉只列出部分工作簿、自动识别 0 个候选，必须手动点刷新或
// 先切换到目标工作簿才找得到）。这里沿用主面板 userInfoPolling 的思路做低频轮询：
//   1. 工作簿数量变化（打开/关闭工作簿）；
//   2. 活动工作簿切换（用户在 WPS 中切换窗口）；
//   3. 页面打开后若干次兜底重试（应对首轮扫描时集合未就绪）。
// 命中任一项即刷新工作簿列表并重新识别目标表，无需用户手动点击「刷新」。
const ENRICH_WATCH_INTERVAL_MS = 2000;
let enrichWatchTimer = null;
/**
 * 上一轮的工作簿集合签名（Count + 各簿名 + 活动簿名）。
 * 轮询每 2s 只做这次**便宜的读取**（Count 次 `Name` 读取，无全量扫描），
 * 签名没变就什么都不做 —— 旧版「未识别就盲重试 3 次全量扫描」每轮都是
 * refreshWorkbookList + autoSelectEnrichTarget + refreshSheetList 的完整
 * COM 往返（真机日志：打开页面连扫 5 轮），是页面卡顿的来源之一。
 * 签名变化才全量识别，且**永不过期**：旧版重试次数用完后就再也不自动识别了，
 * 现在用户稍后打开目标工作簿仍会被自动识别到。
 */
let lastWorkbookSignature = null;
/**
 * 用户已手动选择 / 主动解锁：自动识别只同步列表、不再选表（避免覆盖用户意图）。
 * 由 `suppressEnrichAutoSelect()` 置位（原「取消兜底重试」的等价物 ——
 * 兜底重试机制移除后，防覆盖语义由本标志承担）。
 */
let isAutoSelectSuppressed = false;
/** 用户已手动选择 / 主动解锁后调用：停止自动选表（保留列表刷新） */
function suppressEnrichAutoSelect() {
    isAutoSelectSuppressed = true;
}
/** 刷新工作簿列表并重新自动识别目标表（已锁定时仅同步列表与引用） */
function recheckEnrichTarget(reason) {
    bgmLog(LOG_LEVELS.INFO, `[enrich] ${reason}：刷新工作簿列表并重新识别目标表`);
    refreshWorkbookList();
    if (BGM.sheet.isLocked) {
        refreshSheetList();
        selectTargetSheet();
        return;
    }
    // 用户已手动选择 / 解锁过：只同步列表，不自动选（避免覆盖用户意图）
    const isAutoSelectAllowed = !isAutoSelectSuppressed && !state.bangumiSheet;
    const result = isAutoSelectAllowed
        ? autoSelectEnrichTarget('workbookSelect', 'sheetSelect', 'lockSheetBtn', 'lockStatus')
        : null;
    refreshSheetList();
    selectTargetSheet();
    if (result === null) {
        bgmLog(LOG_LEVELS.INFO, `[enrich] ${reason}：用户已手动选择，跳过自动识别`);
        return;
    }
    bgmLog(LOG_LEVELS.INFO, `[enrich] ${reason}：目标表自动识别结果=${result}（${describeOpenWorkbooks()}）`);
}
/** 启动富化页面的工作簿变化监听（幂等，页面卸载时自动停止） */
function startEnrichWorkbookWatch() {
    if (typeof window === 'undefined')
        return;
    if (enrichWatchTimer !== null)
        return;
    // 基线取**启动时**的签名：首轮不再扫（initializeEnrichPage 刚扫过一次）。
    // 「集合未就绪」场景下签名会在就绪后变化，自然触发一次全量识别 ——
    // 覆盖旧版盲重试的场景，且没有「3 次用完就再也不自动识别」的死角。
    lastWorkbookSignature = readWorkbookSignature(getApp());
    const pollOnce = () => {
        try {
            const currentApp = getApp();
            const signature = readWorkbookSignature(currentApp);
            // 签名没变 → 本轮什么都不做（这是卡顿修复的核心：不再每 2s 全量扫描）
            if (signature === lastWorkbookSignature)
                return;
            lastWorkbookSignature = signature;
            recheckEnrichTarget(`检测到工作簿集合变化（${String(currentApp?.Workbooks?.Count ?? 0)} 个）`);
        }
        catch (error) {
            bgmLog(LOG_LEVELS.WARN, `[enrich] 工作簿监听轮询失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    enrichWatchTimer = window.setInterval(pollOnce, ENRICH_WATCH_INTERVAL_MS);
    window.addEventListener('beforeunload', stopEnrichWorkbookWatch);
}
/** 停止富化页面的工作簿变化监听 */
function stopEnrichWorkbookWatch() {
    if (enrichWatchTimer === null)
        return;
    window.clearInterval(enrichWatchTimer);
    enrichWatchTimer = null;
}
/** 显示自动识别提示（列出已添加的文件名） */
function showAutoDetectNotice(paths) {
    const notice = safeGetElement('autoDetectNotice');
    if (!notice)
        return;
    const names = paths.map((path) => extractFileName(path)).join('、');
    notice.textContent = `🔄 已自动识别已打开的新番表工作簿（${String(paths.length)} 个）：${names}`;
    notice.style.display = '';
}
export function autoDetectHeader() {
    // 已选择新番表文件时：以「所选文件」为源表识别。
    // 注意：不可取「🎯 目标工作表」的 sheetSelect —— 那是目标 Bangumi 表，会导致源表=目标表。
    if (state.filePath) {
        autoDetectHeaderFromFile(state.filePath);
        return;
    }
    // 未选择文件时：回落到当前活动工作表
    const app = getApp();
    if (!app?.ActiveWorkbook) {
        BGM.Dialog.alert('提示', '未连接到 Excel，请先打开包含新番表的工作簿');
        return;
    }
    const worksheet = app.ActiveWorkbook.ActiveSheet;
    if (!worksheet) {
        BGM.Dialog.alert('提示', '请先打开新番表文件并激活其工作表');
        return;
    }
    detectHeaderOnSheet(worksheet, '活动工作表');
}
// ========== 目标工作表选择 ==========
function getSelectedWorkbook() {
    const app = getApp();
    if (!app)
        return null;
    const wbSelect = safeGetSelect('workbookSelect');
    const wbName = wbSelect?.value ?? '';
    if (!wbName)
        return app.ActiveWorkbook ?? null;
    const selected = findWorkbookByName(wbName);
    return selected ?? app.ActiveWorkbook ?? null;
}
function refreshWorkbookList() {
    refreshEnrichWorkbooks('workbookSelect');
    // 如果已锁定，选中锁定的工作簿
    if (BGM.sheet.isLocked && BGM.sheet.lockedWorkbookName) {
        const wbSelect = safeGetSelect('workbookSelect');
        if (wbSelect)
            wbSelect.value = BGM.sheet.lockedWorkbookName;
    }
}
function refreshSheetList() {
    const wbSelect = safeGetSelect('workbookSelect');
    const wbName = wbSelect?.value || undefined;
    refreshEnrichSheets(wbName, 'sheetSelect', 'workbookSelect');
    // 如果已锁定，选中锁定的工作表
    if (BGM.sheet.isLocked && BGM.sheet.lockedIndex) {
        const sheetSelect = safeGetSelect('sheetSelect');
        if (sheetSelect)
            sheetSelect.value = String(BGM.sheet.lockedIndex);
    }
}
function selectTargetSheet() {
    const sheetSelect = safeGetSelect('sheetSelect');
    if (!sheetSelect?.value) {
        applyTargetSheet(null);
        return;
    }
    const sheetIndex = Number(sheetSelect.value);
    const wb = getSelectedWorkbook();
    if (!wb || sheetIndex <= 0) {
        applyTargetSheet(null);
        return;
    }
    try {
        const worksheet = wb.Worksheets.Item(sheetIndex);
        applyTargetSheet(worksheet);
        bgmLog(LOG_LEVELS.INFO, `[enrich] 已选择目标工作表: ${worksheet.Name} (索引: ${String(sheetIndex)})`);
    }
    catch (error) {
        applyTargetSheet(null);
        BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.INFO,
            context: 'selectTargetSheet',
        });
    }
}
/**
 * 更新目标工作表引用：目标表变化时清空已有的匹配结果（结果依赖目标表，失效结果不可继续展示）。
 */
function applyTargetSheet(worksheet) {
    const previousName = state.bangumiSheet?.Name ?? null;
    state.bangumiSheet = worksheet;
    if ((worksheet?.Name ?? null) === previousName) {
        refreshMatchHintText();
        applyPreviewTabVisibility();
        return;
    }
    resetMatchResults();
}
function toggleSheetLock() {
    toggleEnrichWorkbookLock('sheetSelect', 'workbookSelect', 'lockSheetBtn', 'lockStatus');
    const sheetSelect = safeGetSelect('sheetSelect');
    if (!sheetSelect)
        return;
    const isNowLocked = BGM.sheet.isLocked;
    sheetSelect.disabled = isNowLocked;
    if (isNowLocked) {
        // 锁定成功后同步目标工作表引用（自动预选场景下不触发 change 事件）
        selectTargetSheet();
    }
    else {
        // 用户主动解锁：取消自动识别的兜底重试，避免立刻又被自动锁定回去
        suppressEnrichAutoSelect();
        state.bangumiSheet = null;
    }
}
// ========== 富化执行 ==========
export function startEnrichment() {
    if (state.isEnriching) {
        bgmLog(LOG_LEVELS.WARN, '[enrich] 富化正在进行中，忽略重复请求');
        return;
    }
    // 多文件场景的源表归批量流程所有，单文件富化不可用
    if (state.batchFiles.length >= 2) {
        BGM.Dialog.alert('提示', '已选择多个文件，请使用「🚀 批量富化」');
        return;
    }
    const animeSourceSheet = ensureSourceSheet();
    if (!animeSourceSheet) {
        BGM.Dialog.alert('提示', '请先选择新番表文件并识别表头');
        return;
    }
    // 如果 state 中没有 bangumiSheet，尝试从锁定状态获取
    if (!state.bangumiSheet) {
        const locked = getLockedEnrichSheet();
        if (locked) {
            const [, lockedSheet] = locked;
            state.bangumiSheet = lockedSheet;
            bgmLog(LOG_LEVELS.INFO, `[enrich] 使用锁定的目标工作表: ${lockedSheet.Name}`);
        }
    }
    if (!state.bangumiSheet) {
        BGM.Dialog.alert('提示', '请先选择目标 Bangumi 工作表');
        return;
    }
    if (!state.columnMapping || state.columnMapping.nameColumn === 0) {
        BGM.Dialog.alert('提示', '列映射未正确识别');
        return;
    }
    if (state.matches.length === 0) {
        // keepSourceOpen: 调用方仍持有 animeSourceSheet，预览结束时不能回收工作簿
        previewMatch({ keepSourceOpen: true });
        // 重新读取（previewMatch 可能已更新 state.matches）
        const recheckedMatches = state.matches;
        if (recheckedMatches.length === 0) {
            BGM.Dialog.alert('提示', '未匹配到任何条目，无法开始富化');
            return;
        }
    }
    state.isEnriching = true;
    state.cancelRequested = false;
    showProgressUI(true);
    const config = {
        filePath: state.filePath,
        sheetName: animeSourceSheet.Name || '',
        headerRow: state.headerRow,
        dataStartRow: state.dataStartRow,
        columnMapping: state.columnMapping,
        targetSheetName: state.bangumiSheet.Name || '',
    };
    try {
        bgmLog(LOG_LEVELS.INFO, `[enrich] 开始富化，共 ${String(state.matches.length)} 条匹配`);
        const results = enrichEntries(animeSourceSheet, state.bangumiSheet, state.matches, config, updateProgressUI, state.introContext ?? undefined, isEnrichCancelled);
        const wasCancelled = isEnrichCancelled();
        showProgressUI(false);
        // 保存本次富化详细条目并显示「查看详细结果」按钮（有无冲突均可查看）
        state.enrichDetailGroups = [{ fileName: extractFileName(state.filePath), items: results }];
        showEnrichDetailButton();
        const allConflicts = collectAllConflicts(results);
        if (wasCancelled) {
            // 用户主动停止：不再弹出冲突确认（避免在"停止"之后继续要求交互），只给摘要
            bgmLog(LOG_LEVELS.WARN, `[enrich] 已按用户请求停止，保留 ${String(results.length)} 条已完成结果`);
            showToast(`已停止富化，保留已完成（含未解决冲突）的部分结果`, 'warning');
            renderEnrichSummary(results);
        }
        else if (allConflicts.length > 0) {
            state.pendingConflicts = allConflicts;
            state.currentConflictIndex = 0;
            showConflictDialog();
        }
        else {
            renderEnrichSummary(results);
        }
        bgmLog(LOG_LEVELS.INFO, `[enrich] 富化完成: ${String(results.length)} 条结果, 冲突 ${String(allConflicts.length)} 条`);
    }
    catch (error) {
        BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.ERROR,
            context: 'startEnrichment',
        });
        BGM.Dialog.error('错误', `富化执行失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        state.isEnriching = false;
        state.cancelRequested = false;
        // 可选开关：识别后已关闭源工作簿，富化结束再回收一次（仅关闭本插件打开的）
        if (state.closeSourceAfterDetect && state.isSourceWorkbookOpenedByUs) {
            closeSourceWorkbookOnly();
        }
    }
}
/**
 * 富化是否已被用户请求取消。
 * 经函数读取是刻意的：直接读 `state.cancelRequested` 会被 TS 的控制流分析收窄为
 * `false` 字面量（`state` 初始化时该字段为 false 且中间赋值发生在别的函数里），
 * 从而把 `if (wasCancelled)` 判成恒假。
 */
function isEnrichCancelled() {
    return state.cancelRequested;
}
/**
 * 请求取消当前富化。
 * 仅置位标记，真正停止由 `enrichEntries` 在条目循环边界检查后返回；已写入的部分保留（不回滚）。
 */
function cancelEnrichment() {
    if (!state.isEnriching)
        return;
    state.cancelRequested = true;
    bgmLog(LOG_LEVELS.WARN, '[enrich] 用户请求取消富化，将在当前条目处理完成后停止');
}
function showProgressUI(isVisible) {
    const progressArea = safeGetElement('enrichProgress');
    if (isVisible) {
        progressHosts.enrich = createInlineProgress('enrichProgressHost', '富化进度', '✨', cancelEnrichment);
        if (progressArea)
            progressArea.style.display = '';
    }
    else {
        progressHosts.enrich?.hide();
        progressHosts.enrich = null;
        if (progressArea)
            progressArea.style.display = 'none';
    }
    const startButton = safeGetButton('startEnrichBtn');
    if (startButton) {
        // 富化结束恢复时也要尊重"仅 N===1 可用"的约束（N>=2 走批量富化）
        startButton.disabled = isVisible || state.batchFiles.length !== 1;
        startButton.textContent = isVisible ? '⏳️ 富化中...' : '🚀 开始富化';
    }
}
function updateProgressUI(progress) {
    // 百分比、当前条目与 ETA 统一由通用进度组件渲染（页面只维护富化专有统计）
    progressHosts.enrich?.update(progress.current, progress.total, progress.currentName || '-');
    const enrichedElement = safeGetElement('enrichedCount');
    if (enrichedElement)
        enrichedElement.textContent = String(progress.stats.enriched);
    const skippedElement = safeGetElement('skippedCount');
    if (skippedElement)
        skippedElement.textContent = String(progress.stats.skipped);
    const failedElement = safeGetElement('failedCount');
    if (failedElement)
        failedElement.textContent = String(progress.stats.failed);
}
function renderEnrichSummary(results) {
    const enriched = results.filter((r) => r.kind === 'matched').length;
    const unmatched = results.filter((r) => r.kind === 'unmatched').length;
    const errors = results.filter((r) => r.kind === 'error').length;
    bgmLog(LOG_LEVELS.INFO, `[enrich] 富化摘要: 匹配 ${String(enriched)}, 未匹配 ${String(unmatched)}, 错误 ${String(errors)}`);
    // 详细条目已在 startEnrichment 统一保存并显示「查看详细结果」按钮
    try {
        getOrCreateEnrichRecordSheet();
        loadRecentRecords();
    }
    catch (error) {
        BGM.handleError(error, {
            showAlert: false,
            level: BGM.ErrorLevel.INFO,
            context: 'renderEnrichSummary',
        });
    }
}
// ========== 批量富化 ==========
/** 绑定批量控件事件（单/多选统一入口后，只剩开始富化 + 清空列表两个按钮） */
function bindBatchControls() {
    const batchStartButton = safeGetButton('batchStartBtn');
    if (batchStartButton) {
        batchStartButton.addEventListener('click', batchStartEnrichment);
    }
    const batchClearButton = safeGetButton('batchClearBtn');
    if (batchClearButton) {
        batchClearButton.addEventListener('click', () => {
            state.batchFiles = [];
            state.batchResults = [];
            state.filePath = '';
            renderBatchFileList();
        });
    }
}
/**
 * 批量文件选择入口（已废弃）
 * @deprecated 自 2026-08-30 起，"选择文件"按钮已合并为单/多选统一入口。
 *   该函数仅作向后兼容保留，不再被任何 UI 触发；新逻辑在 selectNewAnimeFile() 中。
 */
export function batchSelectFiles() {
    // 兼容旧引用：直接走新的统一入口
    selectNewAnimeFile();
}
/** 从列表中移除某个文件 */
function batchRemoveFile(index) {
    if (index < 0 || index >= state.batchFiles.length)
        return;
    const removed = state.batchFiles[index];
    if (removed === undefined)
        return;
    state.batchFiles.splice(index, 1);
    // 单/多选统一入口：移除后保持 state.filePath 始终指向 batchFiles 的首位
    state.filePath = state.batchFiles[0] ?? '';
    bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 移除文件: ${extractFileName(removed)}`);
    renderBatchFileList();
    // 由多文件回到单文件时，源表状态在 renderBatchFileList() 中已被回收清空，
    // 这里补一次自动识别，避免用户还要手动点「识别表头」。
    if (state.batchFiles.length === 1 && state.headerRow === 0) {
        maybeAutoDetectSingleFile();
    }
}
/**
 * 展示批量进度 UI：右下角浮动卡片（detach）。
 *
 * 为什么不是 inline：批量富化循环里主动 `await` 让出主线程，用户期间可以
 * 继续操作页面；浮动卡片 `position: fixed` 不占页面布局，进度与「停止」
 * 按钮始终在视口里可见（inline 会随页面滚动滚出视野）。
 */
function showBatchProgress() {
    // 上一轮的完成态卡片可能还挂在右下角，先回收再建，避免 dock 泄漏
    progressHosts.batch?.hide();
    // 「停止」按钮把此前不可达的批量取消路径接上（state.batchCancelRequested 原先无人置位）
    progressHosts.batch = createFloatingProgress('批量富化进度', '📦', () => {
        state.batchCancelRequested = true;
        bgmLog(LOG_LEVELS.WARN, '[enrich-batch] 用户请求取消批量富化，将在当前文件处理完成后停止');
    });
}
/**
 * 批量富化收尾：浮动卡片切完成态并保留结果摘要。
 *
 * 刻意不 `hide()`：批量可能跑好几分钟，用户早已滚动到页面别处，卡片是
 * 唯一的「跑完了」提示（页面摘要在批量区块内，不一定在当前视口）。
 * 卡片停留到用户点「关闭」/按 ESC，或被下一轮 / 清空列表回收。
 */
function finishBatchProgress(wasCancelled, total) {
    const controller = progressHosts.batch;
    if (controller === null)
        return;
    const done = state.batchResults.length;
    const successCount = state.batchResults.filter((result) => result.success).length;
    const failCount = done - successCount;
    const matched = state.batchResults.reduce((sum, result) => sum + result.matched, 0);
    const scope = wasCancelled
        ? `已停止（${String(done)}/${String(total)}）`
        : `${String(done)}/${String(total)} 个文件`;
    controller.complete({
        summary: `${scope} · 成功 ${String(successCount)} · 失败 ${String(failCount)} · 匹配 ${String(matched)}`,
        ok: !wasCancelled,
        doneTitle: wasCancelled ? '批量富化已停止' : '批量富化完成',
    });
}
/** 更新批量进度条（百分比与计数由通用进度组件渲染） */
function updateBatchProgressUI(current, total, currentFileName) {
    progressHosts.batch?.update(current, total, extractFileName(currentFileName));
}
/** 打开批量源文件并取得首个工作表。失败时抛出，由调用方统一记录结果。 */
function openBatchSourceWorkbook(filePath, fileName) {
    const app = getApp();
    if (!app?.Workbooks)
        throw new Error('WPS 应用不可用');
    const workbooks = app.Workbooks;
    bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 打开文件: ${fileName}`);
    if (typeof workbooks.Open !== 'function')
        throw new TypeError('WPS Workbooks.Open 不可用');
    const wb = workbooks.Open(filePath);
    if (!wb)
        throw new Error('无法打开文件：WPS 返回了 null');
    const worksheet = wb.Worksheets.Item(1);
    if (!worksheet)
        throw new Error('文件中没有工作表');
    return { wb, worksheet };
}
/** 对已打开的批量源表执行布局识别、匹配和富化。 */
function enrichSingleBatchSource(filePath, fileName, worksheet, bangumiSheet, result) {
    const sourceLayout = detectAnimeSourceLayout(worksheet);
    const headerRow = sourceLayout?.headerRow ?? findHeaderRow(worksheet);
    if (headerRow === 0) {
        result.error = '未检测到有效的表头行';
        bgmLog(LOG_LEVELS.ERROR, `[enrich-batch] ${fileName}: 表头识别失败 - 未检测到有效的表头行（请确认表头在前 10 行内）`);
        return;
    }
    const dataStartRow = sourceLayout?.dataStartRow ?? headerRow + 1;
    const columnMapping = sourceLayout?.columnMapping ?? detectColumns(worksheet, headerRow);
    if (columnMapping.nameColumn === 0) {
        result.error = '已找到字段行，但未找到名称列';
        bgmLog(LOG_LEVELS.ERROR, `[enrich-batch] ${fileName}: 表头识别失败 - 未找到名称列`);
        return;
    }
    result.headerRow = headerRow;
    bgmLog(LOG_LEVELS.INFO, `[enrich-batch] ${fileName}: 表头识别成功 - 工作表=${worksheet.Name || '未知'} / 表头行=${String(headerRow)} / 名称列=${String(columnMapping.nameColumn)}`);
    const config = {
        filePath,
        sheetName: worksheet.Name || '',
        headerRow,
        dataStartRow,
        columnMapping,
        targetSheetName: bangumiSheet.Name || '',
    };
    const matches = matchEntries(worksheet, bangumiSheet, config);
    const matched = matches.filter((m) => m.matchType !== 'unmatched' && m.matchType !== 'error').length;
    const unmatched = matches.length - matched;
    // 批量模式同样关联简介工作表：在源工作簿内查找
    const parentWb = worksheet?.Parent ?? null;
    const introSheet = parentWb ? findIntroSheetInWorkbook(parentWb, worksheet.Name) : null;
    const introContext = introSheet ? buildIntroSheetContext(introSheet) : undefined;
    const enrichResults = enrichEntries(worksheet, bangumiSheet, matches, config, () => {
        /* 批量模式不回调进度（已由外层控制） */
    }, introContext ?? undefined);
    const updatedEntries = enrichResults.filter((r) => r.kind === 'matched').length;
    const entries = enrichResults.filter((r) => r.kind === 'matched' && r.enrichedFields.length > 0).length;
    result.matched = matched;
    result.addedEntries = entries;
    result.updatedEntries = updatedEntries;
    result.unmatched = unmatched;
    result.success = true;
    // 累积到详情弹窗数据（批量结束时统一显示「查看详细结果」按钮）
    state.enrichDetailGroups.push({ fileName, items: enrichResults });
    bgmLog(LOG_LEVELS.INFO, `[enrich-batch] ${fileName}: 匹配 ${String(matched)}，未匹配 ${String(unmatched)}，处理 ${String(updatedEntries)}`);
}
/** 关闭批量源文件，不保存。 */
function closeBatchSourceWorkbook(wb, fileName) {
    try {
        const wbWithClose = wb;
        if (typeof wbWithClose.Close === 'function')
            wbWithClose.Close(false);
        bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 已关闭文件: ${fileName}`);
    }
    catch (error) {
        bgmLog(LOG_LEVELS.WARN, `[enrich-batch] 关闭文件时警告: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * 对单个文件执行表头识别 + 匹配 + 富化
 * @returns 包含 matched/newEntries/updatedEntries/unmatched 的统计对象
 */
function processSingleBatchFile(filePath, bangumiSheet) {
    const fileName = extractFileName(filePath);
    const result = {
        filePath,
        fileName,
        headerRow: 0,
        matched: 0,
        addedEntries: 0,
        updatedEntries: 0,
        unmatched: 0,
        success: false,
    };
    let wb = null;
    try {
        const opened = openBatchSourceWorkbook(filePath, fileName);
        wb = opened.wb;
        enrichSingleBatchSource(filePath, fileName, opened.worksheet, bangumiSheet, result);
    }
    catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        bgmLog(LOG_LEVELS.ERROR, `[enrich-batch] ${fileName} 处理失败: ${result.error}`);
    }
    finally {
        if (wb)
            closeBatchSourceWorkbook(wb, fileName);
    }
    return result;
}
/** 批量富化主入口 */
export function batchStartEnrichment() {
    if (state.isBatchEnriching) {
        bgmLog(LOG_LEVELS.WARN, '[enrich-batch] 批量富化正在进行中，忽略重复请求');
        return;
    }
    if (state.batchFiles.length === 0) {
        BGM.Dialog.alert('提示', '请先选择至少一个新番表文件');
        return;
    }
    // 前置检查：目标 Bangumi 工作表已锁定
    let { bangumiSheet } = state;
    if (!bangumiSheet) {
        const locked = getLockedEnrichSheet();
        if (locked) {
            const [, lockedSheet] = locked;
            bangumiSheet = lockedSheet;
            state.bangumiSheet = lockedSheet;
            bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 使用锁定的目标工作表: ${lockedSheet.Name}`);
        }
    }
    if (!bangumiSheet) {
        BGM.Dialog.alert('提示', '请先选择并锁定目标 Bangumi 工作表（在上方"🎯 目标工作表"区域）');
        return;
    }
    // 清空之前的结果
    state.batchResults = [];
    state.enrichDetailGroups = [];
    state.batchIndex = 0;
    state.isBatchEnriching = true;
    state.batchCancelRequested = false;
    // 隐藏批量汇总及上一轮详情按钮
    const summaryElement = safeGetElement('batchSummary');
    if (summaryElement)
        summaryElement.style.display = 'none';
    // 禁用开始按钮
    const startButton = safeGetButton('batchStartBtn');
    if (startButton)
        startButton.disabled = true;
    // 确认
    // `false as boolean`：避免 TS 将闭包赋值忽略后把变量静态收窄为 false 字面量
    let isConfirmed = false;
    BGM.Dialog.confirm(`将依次对 ${String(state.batchFiles.length)} 个文件执行富化。\n目标工作表：${bangumiSheet.Name}\n是否继续？`, (isOk) => {
        isConfirmed = isOk;
    }, '开始批量富化');
    if (isConfirmed) {
        void runBatchEnrichment(bangumiSheet);
    }
    else {
        state.isBatchEnriching = false;
        if (startButton)
            startButton.disabled = false;
    }
}
/** 实际执行批量富化（避免阻塞 UI，循环中通过 await 让出主线程） */
async function runBatchEnrichment(bangumiSheet) {
    showBatchProgress();
    const total = state.batchFiles.length;
    for (let index = 0; index < total; index += 1) {
        // 取消在文件边界生效：当前文件已处理完的部分保留（统一在循环后提示）
        if (state.batchCancelRequested)
            break;
        state.batchIndex = index + 1;
        const filePath = state.batchFiles[index];
        if (filePath === undefined)
            break;
        const fileName = extractFileName(filePath);
        updateBatchProgressUI(state.batchIndex, total, fileName);
        // 让出主线程，给 UI 更新机会
        await new Promise((resolve) => {
            setTimeout(resolve, 30);
        });
        const result = processSingleBatchFile(filePath, bangumiSheet);
        state.batchResults.push(result);
        // 让出主线程，给 WPS 资源释放机会
        await new Promise((resolve) => {
            setTimeout(resolve, 50);
        });
    }
    state.isBatchEnriching = false;
    if (state.batchCancelRequested) {
        bgmLog(LOG_LEVELS.WARN, `[enrich-batch] 已按用户请求停止：完成 ${String(state.batchResults.length)}/${String(total)} 个文件`);
        showToast(`已停止批量富化，完成 ${String(state.batchResults.length)}/${String(total)} 个文件`, 'warning');
    }
    // 恢复 UI（浮动卡片切完成态保留摘要，由用户关闭或下一轮回收）
    finishBatchProgress(state.batchCancelRequested, total);
    const startButton = safeGetButton('batchStartBtn');
    if (startButton)
        startButton.disabled = false;
    // 全部文件富化完成后统一执行一次合并去重（避免逐文件清洗时行号漂移）
    maybeAutoCleanAfterEnrich();
    // 显示汇总
    renderBatchSummary();
    // 批量富化完成后显示「查看详细结果」按钮（数据已累积到 enrichDetailGroups）
    if (state.enrichDetailGroups.length > 0) {
        showEnrichDetailButton();
    }
    // 刷新富化记录
    try {
        getOrCreateEnrichRecordSheet();
        loadRecentRecords();
    }
    catch {
        // 忽略
    }
    bgmLog(LOG_LEVELS.INFO, `[enrich-batch] 批量富化结束: ${String(state.batchResults.filter((r) => r.success).length)}/${String(total)} 成功`);
}
/** 渲染批量富化最终汇总 */
function renderBatchSummary() {
    const summaryElement = safeGetElement('batchSummary');
    const contentElement = safeGetElement('batchSummaryContent');
    if (!summaryElement || !contentElement)
        return;
    const total = state.batchResults.length;
    const successCount = state.batchResults.filter((r) => r.success).length;
    const failCount = total - successCount;
    const totalMatched = state.batchResults.reduce((s, r) => s + r.matched, 0);
    const totalUpdated = state.batchResults.reduce((s, r) => s + r.updatedEntries, 0);
    const totalUnmatched = state.batchResults.reduce((s, r) => s + r.unmatched, 0);
    const fileRows = state.batchResults
        .map((r, index) => {
        const statusIcon = r.success ? '✅' : '❌';
        const detail = r.success
            ? `表头行 ${String(r.headerRow)} · 匹配 ${String(r.matched)} / 更新 ${String(r.updatedEntries)} / 未匹配 ${String(r.unmatched)}`
            : `失败：${escapeHtml(r.error || '未知错误')}`;
        return `
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px dashed #333;">
          <span style="color:#ddd;">${statusIcon} #${String(index + 1)} ${escapeHtml(r.fileName)}</span>
          <span style="color:${r.success ? '#a6e3a1' : '#f38ba8'};">${detail}</span>
        </div>
      `;
    })
        .join('');
    const html = `
    <div style="display:flex;gap:16px;margin-bottom:8px;font-size:13px;">
      <span>📄 <b>${String(total)}</b> 个文件</span>
      <span style="color:#a6e3a1;">✅ ${String(successCount)} 成功</span>
      ${failCount > 0 ? `<span style="color:#f38ba8;">❌ ${String(failCount)} 失败</span>` : ''}
    </div>
    <div style="display:flex;gap:16px;margin-bottom:10px;font-size:12px;color:#bac2de;">
      <span>匹配总数 <b style="color:#a6e3a1;">${String(totalMatched)}</b></span>
      <span>已更新 <b style="color:#89b4fa;">${String(totalUpdated)}</b></span>
      <span>未匹配 <b style="color:#f9e2af;">${String(totalUnmatched)}</b></span>
    </div>
    <div style="max-height:200px;overflow-y:auto;">${fileRows}</div>
  `;
    contentElement.innerHTML = sanitizeHtml(html);
    summaryElement.style.display = '';
}
// ========== 导出 ==========
export { state } from './enrich-page-context.js';
export { cancelEnrichment };
export { openEnrichRecordSheet, clearRecords } from './enrich-record-view.js';
export { previewMatch } from './enrich-preview-flow.js';
