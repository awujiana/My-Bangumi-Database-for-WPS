/**
 * UI 事件处理模块 - 入口与聚合
 * @module ui/handlers/index
 * @description 资源追踪、按钮监听、ACTION_HANDLERS 分发、消息监听、事件总线监听、
 *              配置 UI 回填等。同时 re-export 子模块的公开 API，保持原 handlers.ts 的外部接口。
 */
import { LOG_LEVELS, bgmLog, BGM, loadBgToken, storeBgToken, clearBgToken, copyTokenToClipboard, _setBgmUserId, _getBgmUserId, _setBgmUsername, getApp, getLastRow, getSyncRecordSheetIfExists, showAlert, showConfirm, showInput, showToast, refreshData, refreshSheets, refreshWorkbooks, toggleSheetLock, enlargePreview, clearSyncRecords, deduplicateSyncRecords, formatSyncRecordSheet, openSyncRecordSheet, closeDetailModal, previewSyncContent, syncSelectedRows, openBangumiTokenPage, setSyncRecordEnabled, getSyncRecordEnabled, getIncrementalSync, setIncrementalSync, getSkipConflicts, setSkipConflicts, getGithubConfig, setGithubConfig, isGithubConfigComplete, getSyncStrategy, setSyncStrategy, getSyncSourceType, setSyncSourceType, syncFromRemote, buildRawUrl, showSyncProgressDialog, buildSyncConfig, updateSyncProgressDialog, completeSyncProgressDialog, hideSyncProgressDialog, showSyncResultDialog, formatDuration, showSettingsPanel, } from '../../index.js';
import { exportConfig, importConfig } from '../../services/configService.js';
import { executeUndoLastSync } from '../../services/ribbonService.js';
import { debounce } from '../../tools/debounce.js';
import { BGM_EVENTS, eventBus } from '../../tools/events.js';
import { getRecentLogs, exportLogsToFile, clearLogs } from '../../tools/logger.js';
import { showConnectionTestDialog, hideConnectionTestDialog } from '../githubConfigDialog.js';
// 子模块
import { _T } from './_constants.js';
import { cleanLockedDataSheet } from './sheet.js';
import { syncFromPanel, syncCollectionFromBgm } from './sync.js';
import { showTokenDialog, showUserIdDialog, updateTokenStatus, updateUserIdStatus, openUserCollection, testTokenValidity, testDebugConnection, renewToken, } from './token.js';
// 子模块 re-export（保持原 handlers.ts 的对外 API）
export { showTokenDialog, showUserIdDialog, updateTokenStatus, updateUserIdStatus, openUserCollection, testTokenValidity, testDebugConnection, showUserProfile, hideUserProfile, renewToken, } from './token.js';
export { syncFromPanel, syncCollectionFromBgm, syncFromBgmByAPI } from './sync.js';
export { cleanLockedDataSheet } from './sheet.js';
// 连接测试弹窗
export { showConnectionTestDialog, hideConnectionTestDialog };
// ========== 模块级资源追踪（防止事件监听器与定时器泄漏） ==========
const _pendingTimeouts = new Set();
/**
 * 受追踪的 setTimeout：将 timeoutId 加入模块级 Set，便于统一清理。
 * 回调执行时自动从 Set 中移除。
 */
function trackedSetTimeout(fn, delay) {
    const id = setTimeout(() => {
        _pendingTimeouts.delete(id);
        fn();
    }, delay);
    _pendingTimeouts.add(id);
    return id;
}
/**
 * 清理所有仍在等待的 setTimeout，防止面板关闭后回调仍被触发。
 */
export function clearAllPendingTimeouts() {
    for (const id of _pendingTimeouts) {
        clearTimeout(id);
    }
    _pendingTimeouts.clear();
}
const _trackedListeners = [];
/**
 * 清理所有已追踪的监听器。
 * 在 initHandlers 重新初始化前调用，防止同一面板内重复注册。
 */
function clearTrackedListeners() {
    for (const item of _trackedListeners) {
        if (item.kind === 'dom') {
            item.element.removeEventListener(item.type, item.handler);
        }
        else {
            eventBus.off(item.eventName, item.handler);
        }
    }
    _trackedListeners.length = 0;
}
/**
 * 受追踪的 addEventListener：自动记录，便于统一清理。
 */
function trackedAddEventListener(element, type, handler) {
    element.addEventListener(type, handler);
    _trackedListeners.push({ kind: 'dom', element, type, handler });
}
/**
 * 受追踪的 eventBus.on：自动记录，便于统一清理。
 */
function trackedEventBusOn(eventName, handler) {
    eventBus.on(eventName, handler);
    _trackedListeners.push({ kind: 'eventBus', eventName, handler: handler });
}
// ========== 面板操作分发 ==========
export function onAction(action) {
    switch (action) {
        case 'sync':
            syncFromPanel();
            break;
        case 'clear':
            showConfirm(_T.confirmClearMarks, (confirmed) => {
                if (confirmed) {
                    if (typeof refreshData === 'function')
                        refreshData();
                }
            });
            break;
        case 'setToken':
            showTokenDialog(loadBgToken() || '');
            break;
        case 'preview':
            if (typeof previewSyncContent === 'function')
                previewSyncContent();
            break;
        case 'showUserIdDialog':
            showUserIdDialog();
            break;
        case 'showClearConfirm':
            showConfirm(_T.confirmClearMarks, (confirmed) => {
                if (confirmed) {
                    if (typeof refreshData === 'function')
                        refreshData();
                }
            });
            break;
        case 'tokenUpdated':
            updateTokenStatus();
            break;
        case 'userIdUpdated':
            updateUserIdStatus();
            break;
        case 'requestStopSync':
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求停止同步');
            BGM.sync.requestStop();
            break;
        case 'pauseSync':
            bgmLog(LOG_LEVELS.INFO, '用户请求暂停同步');
            BGM.sync.pause();
            break;
        case 'resumeSync':
            bgmLog(LOG_LEVELS.INFO, '用户请求恢复同步');
            BGM.sync.resume();
            break;
    }
}
// ========== 事件处理器（模块级，便于追踪与去重） ==========
const handleEnableSyncRecordChange = () => {
    const chkEnableSyncRecord = document.getElementById('chkEnableSyncRecord');
    if (!chkEnableSyncRecord)
        return;
    const checked = chkEnableSyncRecord.checked;
    bgmLog(LOG_LEVELS.INFO, `[handlers] 启用同步记录开关切换: ${checked ? '开启' : '关闭'}`);
    setSyncRecordEnabled(checked);
    showToast(checked ? '已启用同步记录功能' : '已关闭同步记录功能', 'info');
};
const handleLogLevelFilterChange = () => {
    renderLogEntries();
};
/**
 * GitHub 配置输入框防抖自动保存（300ms）。
 * 每次从 DOM 实时读取值，避免闭包持有过时的元素引用。
 */
const debouncedSaveGithubConfig = debounce(() => {
    try {
        const ownerInput = document.getElementById('githubOwner');
        const repoInput = document.getElementById('githubRepo');
        const branchInput = document.getElementById('githubBranch');
        const pathInput = document.getElementById('githubPath');
        const localFilePathInput = document.getElementById('localFilePath');
        const gistIdInput = document.getElementById('gistId');
        const strategySelect = document.getElementById('githubStrategy');
        const sourceTypeSelect = document.getElementById('syncSourceType');
        const owner = (ownerInput?.value ?? '').trim();
        const repo = (repoInput?.value ?? '').trim();
        const branch = (branchInput?.value ?? '').trim() || 'main';
        const strategy = strategySelect?.value || 'add-update';
        const sourceType = sourceTypeSelect?.value || 'github';
        // 按数据源类型读取对应字段值
        // - local: 复用 githubConfig.path 字段存储本地文件路径（与远程源 path 字段互斥复用）
        // - gist: 使用独立的 gistId 字段
        // - github/gitlab/gitee: 使用 owner/repo/branch/path
        let path;
        let gistId;
        if (sourceType === 'local') {
            path = (localFilePathInput?.value ?? '').trim();
        }
        else {
            path = (pathInput?.value ?? '').trim();
        }
        if (sourceType === 'gist') {
            gistId = (gistIdInput?.value ?? '').trim() || undefined;
        }
        // 必填项校验：用户可能正在输入，未完成时跳过自动保存
        if (sourceType === 'local') {
            if (!path)
                return;
        }
        else if (sourceType === 'gist') {
            if (!gistId)
                return;
        }
        else {
            if (!owner || !repo || !path)
                return;
        }
        const okConfig = setGithubConfig({ owner, repo, branch, path, sourceType, gistId });
        const okStrategy = setSyncStrategy(strategy);
        const okSourceType = setSyncSourceType(sourceType);
        if (okConfig && okStrategy && okSourceType) {
            bgmLog(LOG_LEVELS.INFO, `[handlers] GitHub 配置已自动保存: ${owner}/${repo}/${branch}/${path}, 策略: ${strategy}, 同步源: ${sourceType}${gistId ? `, gistId: ${gistId}` : ''}`);
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] GitHub 配置自动保存失败: ${e.message}`);
    }
}, 300);
/**
 * 按同步源类型切换 UI 字段显示/隐藏
 *
 * - github/gitlab/gitee: 显示 owner/repo/branch/path（#remoteSourceFields）
 * - local: 显示本地文件路径输入框 + 选择按钮（#localFileFields）
 * - gist: 显示 gistId 输入框（#gistFields）
 *
 * @param sourceType 同步源类型
 */
function toggleSourceFields(sourceType) {
    const remoteFields = document.getElementById('remoteSourceFields');
    const localFields = document.getElementById('localFileFields');
    const gistFields = document.getElementById('gistFields');
    if (remoteFields) {
        remoteFields.style.display = sourceType === 'local' || sourceType === 'gist' ? 'none' : '';
    }
    if (localFields) {
        localFields.style.display = sourceType === 'local' ? '' : 'none';
    }
    if (gistFields) {
        gistFields.style.display = sourceType === 'gist' ? '' : 'none';
    }
}
// ========== 事件监听 ==========
export function setupButtonListeners() {
    document.querySelectorAll('[data-action]').forEach((button) => {
        trackedAddEventListener(button, 'click', handleActionClick);
    });
    // 启用同步记录 开关：从 config 读取初始状态 + 注册 change 监听器
    const chkEnableSyncRecord = document.getElementById('chkEnableSyncRecord');
    if (chkEnableSyncRecord) {
        // 从 config 读取初始状态（与 chkIncremental/chkSkipConflicts 一致的双向同步机制）
        try {
            const enabled = getSyncRecordEnabled();
            chkEnableSyncRecord.checked = enabled;
            bgmLog(LOG_LEVELS.INFO, `[handlers] 从配置读取同步记录状态: ${enabled ? '开启' : '关闭'}`);
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `[handlers] 读取同步记录状态失败: ${e.message}`);
        }
        trackedAddEventListener(chkEnableSyncRecord, 'change', handleEnableSyncRecordChange);
        bgmLog(LOG_LEVELS.INFO, '[handlers] 启用同步记录 checkbox 监听器已注册');
    }
    // GitHub 配置：面板加载时自动填充已保存的值（含策略与同步源类型）
    try {
        const cfg = getGithubConfig();
        const ownerInput = document.getElementById('githubOwner');
        const repoInput = document.getElementById('githubRepo');
        const branchInput = document.getElementById('githubBranch');
        const pathInput = document.getElementById('githubPath');
        const localFilePathInput = document.getElementById('localFilePath');
        const gistIdInput = document.getElementById('gistId');
        const strategySelect = document.getElementById('githubStrategy');
        const sourceTypeSelect = document.getElementById('syncSourceType');
        if (ownerInput)
            ownerInput.value = cfg.owner;
        if (repoInput)
            repoInput.value = cfg.repo;
        if (branchInput)
            branchInput.value = cfg.branch;
        if (pathInput)
            pathInput.value = cfg.path;
        // 本地文件路径复用 githubConfig.path 字段，回填到独立输入框
        if (localFilePathInput)
            localFilePathInput.value = cfg.path;
        // Gist ID 回填
        if (gistIdInput && cfg.gistId)
            gistIdInput.value = cfg.gistId;
        // 回填策略
        const savedStrategy = getSyncStrategy();
        if (strategySelect)
            strategySelect.value = savedStrategy;
        // 回填同步源类型，并触发字段显示/隐藏切换
        const savedSourceType = getSyncSourceType();
        if (sourceTypeSelect)
            sourceTypeSelect.value = savedSourceType;
        toggleSourceFields(savedSourceType);
        if (cfg.owner || cfg.repo || cfg.path) {
            bgmLog(LOG_LEVELS.INFO, `[handlers] GitHub 配置已加载: ${cfg.owner}/${cfg.repo}/${cfg.branch}/${cfg.path}, 策略: ${savedStrategy}, 同步源: ${savedSourceType}`);
        }
        // 为 GitHub 配置输入框添加防抖自动保存（300ms），
        // 用户输入时静默保存，避免每次按键都触发 PluginStorage 写入。
        // 注意：按钮点击 "保存配置"（saveGithubConfig action）不走此路径，
        // 仍保留同步保存 + Toast 反馈，确保用户主动保存的即时确认体验。
        if (ownerInput)
            trackedAddEventListener(ownerInput, 'input', debouncedSaveGithubConfig);
        if (repoInput)
            trackedAddEventListener(repoInput, 'input', debouncedSaveGithubConfig);
        if (branchInput)
            trackedAddEventListener(branchInput, 'input', debouncedSaveGithubConfig);
        if (pathInput)
            trackedAddEventListener(pathInput, 'input', debouncedSaveGithubConfig);
        if (localFilePathInput)
            trackedAddEventListener(localFilePathInput, 'input', debouncedSaveGithubConfig);
        if (gistIdInput)
            trackedAddEventListener(gistIdInput, 'input', debouncedSaveGithubConfig);
        if (strategySelect)
            trackedAddEventListener(strategySelect, 'change', debouncedSaveGithubConfig);
        if (sourceTypeSelect) {
            // sourceType 切换时：1) 触发字段显示/隐藏；2) 触发防抖保存
            trackedAddEventListener(sourceTypeSelect, 'change', () => {
                const newSourceType = sourceTypeSelect.value || 'github';
                toggleSourceFields(newSourceType);
                debouncedSaveGithubConfig();
            });
        }
        bgmLog(LOG_LEVELS.INFO, '[handlers] GitHub 配置输入框防抖自动保存监听器已注册');
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 加载 GitHub 配置失败: ${e.message}`);
    }
    // 系统日志：级别筛选下拉框变化时重新渲染日志列表
    const logLevelFilter = document.getElementById('logLevelFilter');
    if (logLevelFilter) {
        trackedAddEventListener(logLevelFilter, 'change', handleLogLevelFilterChange);
        bgmLog(LOG_LEVELS.INFO, '[handlers] 日志级别筛选 change 监听器已注册');
    }
}
// ========== 时间筛选 UI 控制 ==========
/**
 * 初始化时间筛选控件的显示/隐藏逻辑
 * - 勾选「启用时间筛选」时显示筛选控件区域
 * - 筛选范围切换时显示/隐藏季度/月份下拉框
 * - 选择「预告/未来动漫」时隐藏年份/季度/月份，显示提示
 */
function setupTimeFilterControls() {
    const chkTimeFilter = document.getElementById('chkTimeFilter');
    const timeFilterControls = document.getElementById('timeFilterControls');
    const rangeSelect = document.getElementById('timeFilterRange');
    const yearRow = document.getElementById('yearRow');
    const quarterRow = document.getElementById('quarterRow');
    const monthRow = document.getElementById('monthRow');
    const futureHintRow = document.getElementById('futureHintRow');
    if (!chkTimeFilter || !timeFilterControls)
        return;
    // 复选框切换：显示/隐藏筛选控件
    chkTimeFilter.addEventListener('change', () => {
        timeFilterControls.style.display = chkTimeFilter.checked ? 'block' : 'none';
    });
    // 筛选范围切换：显示/隐藏年份/季度/月份/提示行
    if (rangeSelect && yearRow && quarterRow && monthRow) {
        rangeSelect.addEventListener('change', () => {
            const isFuture = rangeSelect.value === 'future';
            yearRow.style.display = isFuture ? 'none' : '';
            quarterRow.style.display = rangeSelect.value === 'quarter' ? '' : 'none';
            monthRow.style.display = rangeSelect.value === 'month' ? '' : 'none';
            if (futureHintRow) {
                futureHintRow.style.display = isFuture ? '' : 'none';
            }
        });
    }
}
const ACTION_HANDLERS = {
    // 核心操作
    sync: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行同步操作');
        syncFromPanel();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步操作已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    testSelected: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行选中行同步');
        if (typeof syncSelectedRows === 'function') {
            syncSelectedRows();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 选中行同步已触发，耗时: ${Date.now() - ctx.startTime}ms`);
        }
        else {
            bgmLog(LOG_LEVELS.WARN, '[handleActionClick] syncSelectedRows 函数未定义');
        }
    },
    clear: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新数据');
        showConfirm(_T.confirmClearMarks, (confirmed) => {
            if (confirmed) {
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户确认刷新数据');
                if (typeof refreshData === 'function')
                    refreshData();
                bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 刷新数据完成，耗时: ${Date.now() - ctx.startTime}ms`);
            }
            else {
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户取消刷新数据');
            }
        });
    },
    previewSyncContent: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行预览同步内容');
        if (typeof previewSyncContent === 'function') {
            previewSyncContent();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 预览同步内容已触发，耗时: ${Date.now() - ctx.startTime}ms`);
        }
        else {
            bgmLog(LOG_LEVELS.WARN, '[handleActionClick] previewSyncContent 函数未定义');
        }
    },
    enlargePreview: () => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 放大预览表格');
        if (typeof enlargePreview === 'function') {
            enlargePreview();
        }
        else {
            bgmLog(LOG_LEVELS.WARN, '[handleActionClick] enlargePreview 函数未定义');
        }
    },
    setToken: (ctx) => {
        // 已废弃，由 showTokenDialog 替代，保留兼容
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开 Token 设置对话框');
        showTokenDialog(loadBgToken() || '');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] Token 设置对话框已打开，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 快捷按钮
    showTokenDialog: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 显示 Token 设置对话框');
        showTokenDialog(loadBgToken() || '');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] Token 设置对话框已显示，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    clearToken: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 清除 Token 设置');
        try {
            clearBgToken();
            BGM.cache.userId = null;
            BGM.cache.username = null;
            const app = getApp();
            if (app?.PluginStorage) {
                app.PluginStorage.setItem('bgm_user_id', '');
                app.PluginStorage.setItem('bgm_username', '');
            }
            updateTokenStatus();
            updateUserIdStatus();
            showToast('Token 已清除', 'info');
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] Token 已清除');
        }
        catch (e) {
            BGM.handleError(e, { showAlert: true, level: BGM.ErrorLevel.WARN, context: 'clearToken' });
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 清除 Token 操作完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    copyToken: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 复制 Token 到剪贴板');
        try {
            const ok = copyTokenToClipboard();
            if (ok) {
                showToast('Token 已复制到剪贴板', 'success');
            }
            else {
                showToast('复制失败，可能未设置 Token 或浏览器不支持', 'error');
            }
        }
        catch (e) {
            BGM.handleError(e, { showAlert: true, level: BGM.ErrorLevel.WARN, context: 'copyToken' });
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 复制 Token 操作完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    testToken: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始测试 Token 有效性');
        testTokenValidity();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] Token 测试已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // Token 续约：刷新用户信息和头像
    renewToken: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] Token 续约');
        renewToken();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] Token 续约已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 关闭连接测试弹窗
    closeConnectionTest: () => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭连接测试弹窗');
        hideConnectionTestDialog();
    },
    showUserIdDialog: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 显示用户ID设置对话框');
        showUserIdDialog();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 用户ID设置对话框已显示，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    openUserCollection: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 尝试打开收藏页面');
        openUserCollection();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 收藏页面打开操作已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    openTokenPage: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开 Token 申请页面');
        openBangumiTokenPage();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] Token 申请页面已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    syncCollectionFromBgm: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始从 BGM 同步收藏');
        syncCollectionFromBgm();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 收藏同步已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    refreshSheets: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新工作表（自动匹配当前活动工作表）');
        refreshSheets({ autoSelectActive: true });
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 工作表刷新已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    refreshWorkbooks: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新工作簿列表');
        refreshWorkbooks();
        refreshSheets({ autoSelectActive: true });
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 工作簿刷新已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    refreshData: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新数据');
        refreshData();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 数据刷新已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    toggleSheetLock: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 切换工作表锁定状态');
        toggleSheetLock();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 工作表锁定状态已切换，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    clearSyncRecords: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始清除同步记录');
        clearSyncRecords();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步记录清除已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    deduplicateSyncRecords: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始去重同步记录');
        deduplicateSyncRecords();
        showToast('去重完成', 'success');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步记录去重已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    formatSyncRecordSheet: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始设置同步记录表格式');
        formatSyncRecordSheet();
        showToast('格式设置完成', 'success');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步记录表格式设置已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    cleanLockedDataSheet: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始清洗锁定数据表');
        cleanLockedDataSheet();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 数据清洗完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    openSyncRecordSheet: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开同步记录工作表');
        openSyncRecordSheet();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步记录工作表已打开，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    testDebugConnection: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 测试调试连接');
        testDebugConnection();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 调试连接测试已完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 模态框操作
    closeDetailModal: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭详情模态框');
        closeDetailModal();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 详情模态框已关闭，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 弹窗快捷调用（参数形式）
    showToast: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 显示 Toast 消息: ${ctx.args[0] || ''}`);
        showToast(ctx.args[0] ?? '', ctx.args[1] ?? '');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] Toast 已显示，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    showAlert: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 显示警告框: ${ctx.args[0] || ''}`);
        showAlert(ctx.args[0] ?? '', ctx.args[1] ?? '');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 警告框已显示，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    requestStopSync: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求停止同步');
        BGM.sync.requestStop();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 停止同步请求已发送，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    pauseSync: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求暂停同步');
        BGM.sync.pause();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 暂停同步请求已发送，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    resumeSync: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求恢复同步');
        BGM.sync.resume();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 恢复同步请求已发送，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // GitHub 仓库同步：保存配置（含策略与同步源类型）
    saveGithubConfig: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 保存 GitHub 配置');
        const ownerInput = document.getElementById('githubOwner');
        const repoInput = document.getElementById('githubRepo');
        const branchInput = document.getElementById('githubBranch');
        const pathInput = document.getElementById('githubPath');
        const localFilePathInput = document.getElementById('localFilePath');
        const gistIdInput = document.getElementById('gistId');
        const strategySelect = document.getElementById('githubStrategy');
        const sourceTypeSelect = document.getElementById('syncSourceType');
        if (!ownerInput || !repoInput || !pathInput) {
            showToast('UI 元素缺失', 'error');
            return;
        }
        const sourceType = sourceTypeSelect?.value || 'github';
        // 按数据源类型读取对应字段
        let path;
        let gistId;
        if (sourceType === 'local') {
            path = (localFilePathInput?.value ?? '').trim();
        }
        else {
            path = pathInput.value.trim();
        }
        if (sourceType === 'gist') {
            gistId = (gistIdInput?.value ?? '').trim() || undefined;
        }
        const config = {
            owner: ownerInput.value.trim(),
            repo: repoInput.value.trim(),
            branch: branchInput?.value.trim() || 'main',
            path,
            sourceType,
            gistId,
        };
        // 必填项校验
        if (sourceType === 'local') {
            if (!config.path) {
                showToast('本地文件路径不能为空', 'warn');
                return;
            }
        }
        else if (sourceType === 'gist') {
            if (!gistId) {
                showToast('Gist ID 不能为空', 'warn');
                return;
            }
        }
        else {
            if (!config.owner || !config.repo || !config.path) {
                showToast('owner / repo / path 不能为空', 'warn');
                return;
            }
        }
        const strategy = strategySelect?.value || 'add-update';
        const okConfig = setGithubConfig(config);
        const okStrategy = setSyncStrategy(strategy);
        const okSourceType = setSyncSourceType(sourceType);
        if (okConfig && okStrategy && okSourceType) {
            showToast(`配置已保存（策略：${strategy}，同步源：${sourceType}）`, 'success');
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] GitHub 配置已保存: ${config.owner}/${config.repo}/${config.branch}/${config.path}, 策略: ${strategy}, 同步源: ${sourceType}${gistId ? `, gistId: ${gistId}` : ''}`);
        }
        else {
            showToast('保存失败：PluginStorage 不可用', 'error');
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 保存 GitHub 配置完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // GitHub 仓库同步：立即同步（异步，按当前策略）
    syncFromGithub: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始数据同步（远程仓库 → Excel）');
        // 读取同步源类型：优先用下拉框当前值，兜底用已保存的值
        const sourceTypeSelect = document.getElementById('syncSourceType');
        const currentSourceType = sourceTypeSelect?.value || getSyncSourceType();
        // 读取「仅同步选中行」开关
        const chkSelectedOnly = document.getElementById('chkSyncSelectedOnly');
        const selectedRowsOnly = chkSelectedOnly?.checked === true;
        // 读取时间筛选配置
        const chkTimeFilter = document.getElementById('chkTimeFilter');
        const timeFilterEnabled = chkTimeFilter?.checked === true;
        let timeFilter;
        if (timeFilterEnabled) {
            const yearSelect = document.getElementById('timeFilterYear');
            const rangeSelect = document.getElementById('timeFilterRange');
            const quarterSelect = document.getElementById('timeFilterQuarter');
            const monthSelect = document.getElementById('timeFilterMonth');
            const year = parseInt(yearSelect?.value || '2026', 10);
            const range = rangeSelect?.value || 'year';
            timeFilter = {
                enabled: true,
                year,
                range,
                ...(range === 'quarter'
                    ? { quarter: parseInt(quarterSelect?.value || '1', 10) }
                    : {}),
                ...(range === 'month' ? { month: parseInt(monthSelect?.value || '1', 10) } : {}),
            };
        }
        // 本地文件源仅需 path 字段；远程源（github/gitlab/gitee）要求 owner/repo/path
        // 本地文件路径复用 #githubPath 输入框（用户可手动粘贴绝对路径，UI 后续可扩展文件选择对话框）
        if (currentSourceType === 'local') {
            const pathInput = document.getElementById('githubPath');
            if (!pathInput?.value.trim()) {
                showToast('请先填写本地文件路径', 'warn');
                return;
            }
        }
        else if (!isGithubConfigComplete()) {
            showToast('请先填写并保存远程仓库配置', 'warn');
            return;
        }
        // 读取策略：优先用下拉框当前值（未保存也能即时生效），兜底用已保存的策略
        const strategySelect = document.getElementById('githubStrategy');
        const strategy = strategySelect?.value || getSyncStrategy();
        const strategyLabel = {
            'add-update': '新增+更新（不删除）',
            'add-only': '仅新增',
            'update-only': '仅更新',
            mirror: '镜像同步（含删除）',
            'force-overwrite': '强制覆盖',
        }[strategy];
        // 同步源类型对应的来源描述（本地文件 vs 远程仓库）
        const sourceLabel = currentSourceType === 'local' ? '本地文件' : '远程仓库';
        // 构建时间筛选描述
        let timeFilterDesc = '';
        if (timeFilter) {
            timeFilterDesc =
                timeFilter.range === 'future'
                    ? `\n🔮 时间筛选：预告/未来动漫（无开播日期）`
                    : timeFilter.range === 'year'
                        ? `\n📅 时间筛选：${timeFilter.year}年全年`
                        : timeFilter.range === 'quarter'
                            ? `\n📅 时间筛选：${timeFilter.year}年${timeFilter.quarter}月新番`
                            : `\n📅 时间筛选：${timeFilter.year}年${timeFilter.month}月`;
        }
        showConfirm(`将从${sourceLabel}下载数据并按策略【${strategyLabel}】合并到当前工作表。\n（远程仓库 → Excel，与上传同步方向相反）${selectedRowsOnly ? '\n⚠️ 仅同步选中行' : ''}${timeFilterDesc}\n是否继续？`, (confirmed) => {
            if (!confirmed) {
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户取消数据同步');
                return;
            }
            // 使用模块化进度弹窗（与「同步到 Bangumi」「选中行同步」保持一致）
            // AbortController 支持：用户点击「停止」时取消下载阶段（applyDiffToSheet 为同步函数，不支持取消）
            const abortController = new AbortController();
            // 构建配置摘要，显示在同步进度弹窗顶部
            const configCtx = {
                source: sourceLabel,
                strategy: strategyLabel,
                direction: '远程仓库 → Excel',
                selectedRowsOnly,
            };
            if (timeFilter) {
                const tfCtx = {
                    range: timeFilter.range === 'all' ? 'year' : timeFilter.range,
                    year: timeFilter.year,
                };
                if (timeFilter.quarter !== undefined)
                    tfCtx.quarter = timeFilter.quarter;
                if (timeFilter.month !== undefined)
                    tfCtx.month = timeFilter.month;
                configCtx.timeFilter = tfCtx;
            }
            const configSummary = buildSyncConfig(configCtx);
            showSyncProgressDialog(`正在同步 - 数据同步（${sourceLabel} → Excel）`, {
                onPause: () => {
                    bgmLog(LOG_LEVELS.INFO, '[syncFromGithub] 数据同步不支持暂停');
                },
                onResume: () => {
                    bgmLog(LOG_LEVELS.INFO, '[syncFromGithub] 数据同步不支持恢复');
                },
                onStop: () => {
                    bgmLog(LOG_LEVELS.INFO, '[syncFromGithub] 用户请求停止数据同步');
                    abortController.abort();
                },
            }, configSummary);
            // 状态栏同步更新（与 syncFromPanel 行为一致）
            const app = getApp();
            // 性能追踪：记录同步开始时间，用于计算总耗时
            const syncStartTime = Date.now();
            syncFromRemote((current, total, message, eta) => {
                // message 写入日志区，eta 独立传入 ETA 区
                updateSyncProgressDialog(current, total, message, message, eta);
                if (app?.StatusBar !== undefined) {
                    const statusMsg = eta ? `${message} | ${eta}` : message;
                    app.StatusBar = `[${current}/${total}] ${statusMsg}`;
                }
            }, strategy, abortController.signal, selectedRowsOnly, undefined, // conflictResolution
            timeFilter)
                .then((result) => {
                const totalElapsed = Date.now() - syncStartTime;
                const totalProcessed = result.added + result.updated + result.deleted;
                const avgSpeed = totalProcessed > 0 && totalElapsed > 0
                    ? Math.round((totalProcessed / totalElapsed) * 1000)
                    : 0;
                const efficiency = totalProcessed > 0 || result.unchanged > 0
                    ? Math.round((totalProcessed / (totalProcessed + result.unchanged)) * 100)
                    : 0;
                const etaMs = avgSpeed > 0 && result.remoteTotal > totalProcessed
                    ? Math.round(((result.remoteTotal - totalProcessed) / avgSpeed) * 1000)
                    : 0;
                const summary = `远程 ${result.remoteTotal} 条 → ✅${result.added} 🔄${result.updated} ❌${result.deleted} ⏭️${result.unchanged} ⚠️${result.failed} | 耗时 ${formatDuration(totalElapsed)} | ${avgSpeed > 0 ? avgSpeed : '?'} 行/秒 | 效率 ${efficiency}%`;
                const details = [
                    `📥 远程数据总量: ${result.remoteTotal}`,
                    `➕ 新增: ${result.added}`,
                    `✏️ 更新: ${result.updated}`,
                    `🗑️ 删除: ${result.deleted}`,
                    `⏭️ 无变更: ${result.unchanged}`,
                    `❌ 失败: ${result.failed}`,
                    `🔍 跳过: ${result.skipped}`,
                    `📊 实际处理: ${totalProcessed} 条`,
                    `⏱️ 总耗时: ${formatDuration(totalElapsed)}`,
                    `⚡ 平均速度: ${avgSpeed > 0 ? avgSpeed + ' 行/秒' : '--'}`,
                    `📈 处理效率: ${efficiency}%`,
                    `${etaMs > 0 ? `🔮 预计剩余: ${formatDuration(etaMs)}` : '✅ 全部完成'}`,
                ];
                const stats = {
                    added: result.added,
                    updated: result.updated,
                    deleted: result.deleted,
                    unchanged: result.unchanged,
                    failed: result.failed,
                    skipped: result.skipped,
                    remoteTotal: result.remoteTotal,
                    elapsedMs: totalElapsed,
                    avgSpeed,
                    strategyLabel: strategyLabel ?? '未知策略',
                };
                completeSyncProgressDialog(summary, details, false, () => {
                    let scrollToRow;
                    try {
                        const recordSheet = getSyncRecordSheetIfExists();
                        if (recordSheet) {
                            scrollToRow = getLastRow(recordSheet);
                        }
                    }
                    catch {
                        // ignore
                    }
                    const options = {
                        result,
                        elapsedMs: totalElapsed,
                        avgSpeed,
                        strategyLabel: strategyLabel ?? '未知策略',
                        stopped: false,
                    };
                    if (scrollToRow !== undefined) {
                        options.scrollToRow = scrollToRow;
                    }
                    showSyncResultDialog(options);
                }, stats);
                bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步完成 | 远程:${result.remoteTotal} ✅:${result.added} 🔄:${result.updated} ❌:${result.deleted} ⏭️:${result.unchanged} ⚠️:${result.failed} 🔍:${result.skipped} | 耗时:${formatDuration(totalElapsed)} | 速度:${avgSpeed > 0 ? avgSpeed + '/s' : '?'} | 效率:${efficiency}%`);
                if (app?.StatusBar !== undefined)
                    app.StatusBar = false;
            })
                .catch((e) => {
                const errMsg = e instanceof Error ? e.message : String(e);
                const isAborted = abortController.signal.aborted;
                if (isAborted) {
                    showSyncResultDialog({
                        result: {
                            remoteTotal: 0,
                            added: 0,
                            updated: 0,
                            deleted: 0,
                            unchanged: 0,
                            failed: 0,
                        },
                        elapsedMs: Date.now() - syncStartTime,
                        avgSpeed: 0,
                        strategyLabel: strategyLabel ?? '未知策略',
                        stopped: true,
                    });
                    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 数据同步被用户停止');
                }
                else {
                    hideSyncProgressDialog();
                    bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 数据同步失败: ${errMsg}`);
                    showToast(`数据同步失败：${errMsg}`, 'error');
                }
                if (app?.StatusBar !== undefined)
                    app.StatusBar = false;
            });
        });
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 数据同步已触发（策略: ${strategy}），耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // GitHub 仓库同步：测试配置（构造 URL 并提示）
    testGithubConfig: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 测试 GitHub 配置');
        if (!isGithubConfigComplete()) {
            showToast('请先填写并保存 GitHub 配置', 'warn');
            return;
        }
        let url;
        try {
            url = buildRawUrl();
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            showToast(`配置错误：${errMsg}`, 'error');
            showConnectionTestDialog({
                success: false,
                statusCode: null,
                responseTime: 0,
                url: 'N/A',
                sourceType: getSyncSourceType(),
                errorMessage: errMsg,
            });
            return;
        }
        // 显示测试中提示
        showToast('正在测试连接...', 'info');
        // 获取数据源类型
        const sourceType = getSyncSourceType();
        // 发送 HEAD 请求测试连接
        const testStartTs = Date.now();
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', url, true);
        xhr.timeout = 10000;
        xhr.onload = () => {
            const responseTime = Date.now() - testStartTs;
            const statusCode = xhr.status;
            const success = statusCode >= 200 && statusCode < 400;
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 连接测试完成: status=${statusCode}, time=${responseTime}ms, url=${url}`);
            showConnectionTestDialog({
                success,
                statusCode,
                responseTime,
                url,
                sourceType,
                errorMessage: !success ? `HTTP ${statusCode}` : undefined,
            });
        };
        xhr.onerror = () => {
            const responseTime = Date.now() - testStartTs;
            bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 连接测试失败: ${url}`);
            showConnectionTestDialog({
                success: false,
                statusCode: null,
                responseTime,
                url,
                sourceType,
                errorMessage: '网络错误：无法连接到服务器',
            });
        };
        xhr.ontimeout = () => {
            const responseTime = Date.now() - testStartTs;
            bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 连接测试超时: ${url}`);
            showConnectionTestDialog({
                success: false,
                statusCode: null,
                responseTime,
                url,
                sourceType,
                errorMessage: '请求超时（10秒）',
            });
        };
        xhr.send();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 测试 GitHub 配置已发起，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 本地文件源：选择本地 JSONL/JSON 文件
    browseLocalFile: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 选择本地文件');
        try {
            // 通过 WPS Application.GetOpenFilename 弹出文件选择对话框
            const app = window.wps;
            const wpsApp = app?.Application;
            if (!wpsApp || typeof wpsApp.GetOpenFilename !== 'function') {
                // 降级：提示用户手动输入路径
                const input = document.getElementById('localFilePath');
                if (input) {
                    input.focus();
                    input.placeholder = 'WPS 文件对话框不可用，请手动输入绝对路径';
                }
                showToast('WPS 文件对话框不可用，请手动输入路径', 'warn');
                return;
            }
            // 文件过滤器：JSONL / JSON / 所有文件
            const selected = wpsApp.GetOpenFilename('JSONL 文件 (*.jsonl),*.jsonl,JSON 文件 (*.json),*.json,所有文件 (*.*),*.*', '选择 JSONL/JSON 文件');
            // GetOpenFilename 返回 false 表示用户取消
            if (typeof selected === 'boolean' || selected === false) {
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户取消文件选择');
                return;
            }
            const filePath = String(selected);
            const input = document.getElementById('localFilePath');
            if (input) {
                input.value = filePath;
                // 触发 input 事件，激活防抖自动保存
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            showToast(`已选择：${filePath}`, 'success');
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 已选择本地文件: ${filePath}`);
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            showToast(`选择文件失败：${errMsg}`, 'error');
            bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 选择本地文件失败: ${errMsg}`);
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 选择本地文件完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // GitHub 仓库同步：撤销最近一次同步（按单元格逆序恢复旧值）
    undoLastSync: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 撤销最近一次 GitHub 同步');
        executeUndoLastSync().catch((e) => {
            const errMsg = e instanceof Error ? e.message : String(e);
            bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 撤销同步失败: ${errMsg}`);
            showToast(`撤销失败：${errMsg}`, 'error');
        });
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 撤销同步已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 系统日志：打开日志面板
    showLogPanel: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开系统日志面板');
        const modal = document.getElementById('logModal');
        if (modal) {
            modal.style.display = 'block';
            renderLogEntries();
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 系统日志面板已打开，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 系统日志：关闭日志面板
    closeLogModal: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭系统日志面板');
        const modal = document.getElementById('logModal');
        if (modal)
            modal.style.display = 'none';
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 系统日志面板已关闭，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 系统日志：导出日志到文件
    exportLogs: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 导出系统日志到文件');
        try {
            exportLogsToFile();
            showToast('日志已导出', 'success');
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 导出日志失败: ${errMsg}`);
            showToast(`导出日志失败：${errMsg}`, 'error');
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 日志导出完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 系统日志：清空日志缓冲区
    clearLogs: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 清空系统日志');
        clearLogs();
        renderLogEntries();
        showToast('日志已清空', 'info');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 系统日志已清空，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 同步策略使用引导：显示/隐藏同步策略详细说明
    showSyncGuide: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开同步策略使用引导');
        const note = document.getElementById('mirrorSyncNote');
        const strategySelect = document.getElementById('githubStrategy');
        const strategy = strategySelect?.value ?? '';
        if (note) {
            // 根据所选策略更新说明文案
            const strategyLabels = {
                'add-update': '新增+更新：不删除本地数据，仅同步新增和有差异的条目。',
                'add-only': '仅新增：不更新本地已有条目，仅同步远程新增的 SID。',
                'update-only': '仅更新：不新增本地不存在的 SID，仅同步已有条目的变更。',
                mirror: '镜像同步：新增+更新+删除本地多余行（建议先备份或使用「新工作簿」以完全与远程一致）。',
                'force-overwrite': '强制覆盖：无视字段比对，远程值全部覆盖本地（含空值）。',
            };
            const prefix = strategyLabels[strategy] ?? '';
            note.innerHTML = `
        <strong>📘 同步策略说明</strong><br>
        ${prefix ? `<em>当前策略：</em>${prefix}<br><br>` : ''}
        <strong>通用规则</strong><br>
        • <strong>新增条目</strong>（writeAll=true）：正常写入所有字段<br>
        • <strong>更新条目</strong>：名称追加到「别名」列、标签追加到「标签/分级」列（以 <code> | </code> 分隔），其他字段直接覆盖<br>
        • <strong>制作公司/动画制作公司</strong>：远程「动画制作公司」字段会同步到本地「制作公司」和「动画制作公司」两列<br>
        • <strong>完全镜像</strong>：要完全与远程一致，需先删除本地全部数据后再同步，或选择新建工作簿同步<br>
      `;
            note.style.display = note.style.display === 'block' ? 'none' : 'block';
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 同步策略引导已打开，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 使用引导：显示/隐藏详细操作说明
    toggleUsageGuide: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 切换使用引导详情');
        const detail = document.getElementById('usageGuideDetail');
        const btn = document.getElementById('toggleUsageGuideBtn');
        if (detail && btn) {
            const isHidden = detail.style.display === 'none';
            detail.style.display = isHidden ? 'block' : 'none';
            btn.textContent = isHidden ? '📖 收起详细操作' : '📖 显示详细操作';
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 使用引导已${detail?.style.display === 'none' ? '隐藏' : '显示'}，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 保存所有配置：重新保存当前所有配置项到 PluginStorage
    saveAllConfig: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 保存所有配置');
        try {
            const parts = [];
            // 1. Token
            const token = loadBgToken();
            if (token) {
                storeBgToken(token);
                parts.push('Token');
            }
            // 2. 用户 ID
            const userId = _getBgmUserId();
            if (userId) {
                parts.push(`用户ID: ${userId}`);
            }
            // 3. GitHub 配置
            const ghCfg = getGithubConfig();
            if (ghCfg.owner && ghCfg.repo) {
                setGithubConfig(ghCfg);
                parts.push(`GitHub: ${ghCfg.owner}/${ghCfg.repo}`);
            }
            // 4. 同步偏好（重新持久化）
            const incremental = getIncrementalSync();
            setIncrementalSync(incremental);
            parts.push(`增量同步: ${incremental ? '开' : '关'}`);
            const skipConflicts = getSkipConflicts();
            setSkipConflicts(skipConflicts);
            parts.push(`冲突策略: ${skipConflicts ? '跳过' : '覆盖'}`);
            const syncRecord = getSyncRecordEnabled();
            setSyncRecordEnabled(syncRecord);
            parts.push(`同步记录: ${syncRecord ? '开' : '关'}`);
            // 5. 同步策略
            const strategy = getSyncStrategy();
            setSyncStrategy(strategy);
            parts.push(`同步策略: ${strategy}`);
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 配置已保存: ${parts.join('; ')}`);
            showToast('所有配置已保存', 'success');
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 保存配置失败: ${errMsg}`);
            showToast(`保存失败：${errMsg}`, 'error');
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 保存配置操作完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 配置导入导出：导出全部配置为 JSON 文件并复制到剪贴板
    exportConfig: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 导出配置');
        try {
            const json = exportConfig();
            // 下载为 JSON 文件
            const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bgm-config-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            // 同时复制到剪贴板，便于直接粘贴到其他环境
            _copyTextToClipboard(json);
            showToast('配置已导出（已下载文件并复制到剪贴板）', 'success');
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 配置导出完成');
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 配置导出失败: ${errMsg}`);
            showToast(`配置导出失败：${errMsg}`, 'error');
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 导出配置操作完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 配置导入导出：从粘贴的 JSON 导入配置
    importConfig: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 导入配置');
        showInput('导入配置', '请粘贴配置 JSON（可从导出的 bgm-config.json 文件中复制）', '', (value) => {
            if (!value || value.trim() === '') {
                showToast('未提供配置 JSON，已取消导入', 'info');
                return;
            }
            const result = importConfig(value.trim());
            if (result.isOk()) {
                showToast('配置导入成功', 'success');
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 配置导入成功');
                // 刷新 UI 以反映新配置
                updateTokenStatus();
                updateUserIdStatus();
                refreshGithubConfigInputs();
            }
            else {
                const errMsg = result.error?.message ?? '未知错误';
                bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 配置导入失败: ${errMsg}`);
                showToast(`导入失败：${errMsg}`, 'error');
            }
        });
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 导入配置对话框已显示，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 关闭主面板（taskpane）
    closePanel: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭主面板');
        const app = getApp();
        if (!app) {
            bgmLog(LOG_LEVELS.WARN, '[handleActionClick] 无法获取 Application 对象');
            return;
        }
        const tsId = app.PluginStorage?.getItem('taskpane_id');
        if (tsId) {
            const tskpane = app.GetTaskPane?.(tsId);
            if (tskpane) {
                tskpane.Visible = false;
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 主面板已关闭');
                showToast('面板已关闭', 'info');
            }
        }
        else {
            bgmLog(LOG_LEVELS.WARN, '[handleActionClick] 未找到主面板ID');
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 关闭主面板操作完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 打开/切换设置面板
    openSettings: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开设置面板');
        showSettingsPanel();
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 设置面板操作已触发，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // 设置页面：切换增量同步开关
    toggleIncrementalSync: (_ctx) => {
        const checkbox = document.getElementById('chkIncrementalSync');
        const enabled = checkbox?.checked ?? false;
        setIncrementalSync(enabled);
        showToast(`增量同步已${enabled ? '开启' : '关闭'}`, 'success');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 增量同步: ${enabled ? '开启' : '关闭'}`);
    },
    // 设置页面：切换跳过冲突开关
    toggleSkipConflicts: (_ctx) => {
        const checkbox = document.getElementById('chkSkipConflicts');
        const enabled = checkbox?.checked ?? false;
        setSkipConflicts(enabled);
        showToast(`冲突处理: ${enabled ? '跳过冲突' : 'Excel覆盖'}`, 'success');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 跳过冲突: ${enabled ? '开启' : '关闭'}`);
    },
    // 设置页面：切换启用同步记录开关
    toggleEnableSyncRecord: (_ctx) => {
        const checkbox = document.getElementById('chkEnableSyncRecord');
        const enabled = checkbox?.checked ?? false;
        setSyncRecordEnabled(enabled);
        showToast(`同步记录已${enabled ? '开启' : '关闭'}`, 'success');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 启用同步记录: ${enabled ? '开启' : '关闭'}`);
    },
};
/** 渲染日志条目到日志面板 */
function renderLogEntries() {
    const body = document.getElementById('logModalBody');
    if (!body)
        return;
    const filterSelect = document.getElementById('logLevelFilter');
    const level = filterSelect?.value || undefined;
    const logs = getRecentLogs(level, 100);
    body.innerHTML = '';
    if (logs.length === 0) {
        body.textContent = '暂无日志';
        return;
    }
    logs.forEach((entry) => {
        const div = document.createElement('div');
        div.className = `log-entry log-${entry.level.toLowerCase()}`;
        const time = new Date(entry.timestamp).toLocaleString();
        div.textContent = `[${time}] [${entry.level}] ${entry.message}`;
        body.appendChild(div);
    });
    // 滚动到底部，展示最新日志
    body.scrollTop = body.scrollHeight;
}
function handleActionClick(event) {
    const target = event.currentTarget;
    const action = target.dataset.action;
    if (!action)
        return;
    // 解析可能的参数（如：<button data-action="markUploadedItems" data-args='["动画"]'>）
    let args = [];
    if (target.dataset.args) {
        try {
            args = JSON.parse(target.dataset.args);
        }
        catch (e) {
            BGM.handleError(e, {
                showAlert: false,
                level: BGM.ErrorLevel.WARN,
                context: 'handleActionClick',
            });
        }
    }
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] ========== 按钮点击事件 ==========`);
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 操作类型: ${action}`);
    if (args.length > 0) {
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 参数: ${JSON.stringify(args)}`);
    }
    const startTime = Date.now();
    try {
        const handler = ACTION_HANDLERS[action];
        if (handler) {
            handler({ args, startTime });
        }
        else {
            bgmLog(LOG_LEVELS.WARN, `[handleActionClick] 未知操作类型: ${action}`);
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 操作执行失败: ${action}, 错误: ${e.message}`);
        BGM.handleError(e, { context: `handleActionClick:${action}`, showAlert: true });
    }
}
/**
 * 初始化 UI 事件处理模块。
 *
 * 显式入口函数，由 `ts/entry/taskpane-entry.ts` 调用。
 * 不在模块加载时自动执行，避免：
 *  - 模块加载期间触发 trackedSetTimeout(setupButtonListeners, 0)
 *  - 在测试环境（无 DOM/BGM 全局对象）下意外触发副作用
 *
 * 行为：
 *  - 根据 document.readyState 决定同步执行还是延迟到 DOMContentLoaded
 *  - 调用 setupButtonListeners() 注册按钮点击监听
 *  - 注册消息监听器（接收 token/userId 等更新通知）
 *  - 注册事件总线监听器（接收配置变更与同步进度通知）
 *  - 从配置恢复增量同步、跳过冲突 UI 状态
 */
export function initHandlers() {
    const start = () => {
        // 先清理旧监听器，防止面板重新初始化时重复注册
        clearTrackedListeners();
        setupButtonListeners();
        setupTimeFilterControls();
        setupMessageListener();
        setupEventListeners();
        initIncrementalSyncFromRibbon();
        bgmLog(LOG_LEVELS.INFO, '[handlers] initHandlers 完成');
    };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => start());
        }
        else {
            start();
        }
    }
    else {
        // 无 DOM 环境（如 Node 测试环境）下同步执行
        start();
    }
}
function isTaskpaneContext() {
    return typeof window !== 'undefined' && window.location.pathname.includes('taskpane.html');
}
/**
 * 将文本复制到剪贴板（使用临时 textarea + execCommand）
 * @returns 是否复制成功
 */
function _copyTextToClipboard(text) {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[_copyTextToClipboard] 复制失败: ${e.message}`);
        return false;
    }
}
/**
 * 从 PluginStorage 重新读取 GitHub 配置并填充到面板输入框
 * 用于配置导入后刷新 UI 显示
 */
function refreshGithubConfigInputs() {
    try {
        const cfg = getGithubConfig();
        const ownerInput = document.getElementById('githubOwner');
        const repoInput = document.getElementById('githubRepo');
        const branchInput = document.getElementById('githubBranch');
        const pathInput = document.getElementById('githubPath');
        const localFilePathInput = document.getElementById('localFilePath');
        const gistIdInput = document.getElementById('gistId');
        const strategySelect = document.getElementById('githubStrategy');
        const sourceTypeSelect = document.getElementById('syncSourceType');
        if (ownerInput)
            ownerInput.value = cfg.owner;
        if (repoInput)
            repoInput.value = cfg.repo;
        if (branchInput)
            branchInput.value = cfg.branch;
        if (pathInput)
            pathInput.value = cfg.path;
        if (localFilePathInput)
            localFilePathInput.value = cfg.path;
        if (gistIdInput && cfg.gistId)
            gistIdInput.value = cfg.gistId;
        if (strategySelect)
            strategySelect.value = getSyncStrategy();
        const sourceType = getSyncSourceType();
        if (sourceTypeSelect)
            sourceTypeSelect.value = sourceType;
        toggleSourceFields(sourceType);
        bgmLog(LOG_LEVELS.INFO, `[refreshGithubConfigInputs] 已刷新 GitHub 配置输入框: ${cfg.owner}/${cfg.repo}/${cfg.branch}/${cfg.path}`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[refreshGithubConfigInputs] 刷新 GitHub 配置输入框失败: ${e.message}`);
    }
}
// ========== 消息监听 ==========
let _messageHandler = null;
function setupMessageListener() {
    if (typeof window !== 'undefined') {
        // 防止重复注册：先移除旧监听器
        if (_messageHandler) {
            window.removeEventListener('message', _messageHandler);
        }
        _messageHandler = (event) => {
            // origin 白名单校验（防止跨域消息注入）
            const allowedOrigins = ['null', '', window.location.origin];
            if (!allowedOrigins.includes(event.origin)) {
                bgmLog(LOG_LEVELS.WARN, `[message] 拒绝非预期 origin: ${event.origin}`);
                return;
            }
            const data = event.data;
            if (!data || typeof data !== 'object')
                return;
            bgmLog(LOG_LEVELS.INFO, '[handlers] 收到消息: ' + JSON.stringify(data));
            switch (data.type) {
                case 'BGM:tokenUpdated':
                    bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 Token 更新通知');
                    updateTokenStatus();
                    updateUserIdStatus();
                    break;
                case 'BGM:userIdUpdated':
                    bgmLog(LOG_LEVELS.INFO, `[handlers] 收到用户ID更新通知: ${data.userId}`);
                    if (data.userId) {
                        BGM.cache.userId = data.userId;
                        _setBgmUserId(data.userId);
                        bgmLog(LOG_LEVELS.INFO, `[handlers] 已更新 BGM.cache.userId: ${BGM.cache.userId}`);
                    }
                    updateUserIdStatus();
                    break;
                case 'BGM:userInfoUpdated':
                    bgmLog(LOG_LEVELS.INFO, `[handlers] 收到用户信息更新通知: 用户名=${data.username}, 用户ID=${data.userId}`);
                    if (data.username) {
                        BGM.cache.username = data.username;
                        _setBgmUsername(data.username);
                        bgmLog(LOG_LEVELS.INFO, `[handlers] 已更新 BGM.cache.username: ${BGM.cache.username}`);
                    }
                    if (data.userId) {
                        BGM.cache.userId = data.userId;
                        _setBgmUserId(data.userId);
                        bgmLog(LOG_LEVELS.INFO, `[handlers] 已更新 BGM.cache.userId 和用户ID配置: ${BGM.cache.userId}`);
                    }
                    updateUserIdStatus();
                    break;
                case 'tokenUpdated':
                case 'userIdUpdated':
                    // 兼容旧格式
                    if (data.type === 'tokenUpdated') {
                        updateTokenStatus();
                    }
                    else if (data.type === 'userIdUpdated') {
                        updateUserIdStatus();
                    }
                    break;
            }
        };
        window.addEventListener('message', _messageHandler);
        bgmLog(LOG_LEVELS.INFO, '[handlers] 消息监听器已注册');
    }
}
/**
 * 移除消息监听器，防止面板关闭后内存泄漏
 */
export function removeMessageListener() {
    if (_messageHandler) {
        window.removeEventListener('message', _messageHandler);
        _messageHandler = null;
        bgmLog(LOG_LEVELS.INFO, '[handlers] 消息监听器已移除');
    }
}
// ========== 事件总线处理器（模块级，便于追踪与去重） ==========
const handleTokenUpdatedEvent = () => {
    bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 TOKEN_UPDATED 事件');
    updateTokenStatus();
    updateUserIdStatus();
};
const handleUserIdUpdatedEvent = () => {
    bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 USER_ID_UPDATED 事件');
    updateUserIdStatus();
};
const handleUserNameUpdatedEvent = () => {
    bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 USER_NAME_UPDATED 事件');
    updateUserIdStatus();
};
const handleConfigUpdatedEvent = (data) => {
    if (!isTaskpaneContext())
        return;
    bgmLog(LOG_LEVELS.INFO, `[handlers] 收到 CONFIG_UPDATED 事件: key=${data.key}, value=${data.value}`);
    if (data.key === 'bgm_incremental_sync') {
        bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新增量同步复选框 ==========`);
        tryUpdateIncrementalCheckbox(data.value === 'true');
    }
    else if (data.key === 'bgm_skip_conflicts') {
        bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新跳过冲突 UI ==========`);
        tryUpdateSkipConflictsUI(data.value === 'true');
    }
    else if (data.key === 'bgm_enable_sync_record') {
        bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新启用同步记录复选框 ==========`);
        tryUpdateEnableSyncRecordUI(data.value === 'true');
    }
};
const handleSyncProgressEvent = (data) => {
    updateSyncProgressDialog(data.current, data.total, data.message);
};
const handleSyncStateChangedEvent = (payload) => {
    bgmLog(LOG_LEVELS.INFO, `[handlers] 同步状态变更: ${payload.state}${payload.row ? `, 行: ${payload.row}` : ''}`);
    // 可选：根据状态刷新按钮禁用态
    const syncButtons = document.querySelectorAll('button[data-action="sync"], button[data-action="syncCollectionFromBgm"], button[data-action="previewSyncContent"], button[data-action="enlargePreview"]');
    syncButtons.forEach((btn) => {
        const el = btn;
        el.disabled = payload.state === 'running' || payload.state === 'paused';
    });
};
// ========== 事件监听（用于接收事件总线通知）==========
function setupEventListeners() {
    trackedEventBusOn(BGM_EVENTS.TOKEN_UPDATED, handleTokenUpdatedEvent);
    trackedEventBusOn(BGM_EVENTS.USER_ID_UPDATED, handleUserIdUpdatedEvent);
    trackedEventBusOn(BGM_EVENTS.USER_NAME_UPDATED, handleUserNameUpdatedEvent);
    trackedEventBusOn(BGM_EVENTS.CONFIG_UPDATED, handleConfigUpdatedEvent);
    trackedEventBusOn(BGM_EVENTS.SYNC_PROGRESS, handleSyncProgressEvent);
    trackedEventBusOn(BGM_EVENTS.SYNC_STATE_CHANGED, handleSyncStateChangedEvent);
    // Ribbon 按钮触发数据同步：复用 taskpane handler，显示模块化进度弹窗
    trackedEventBusOn(BGM_EVENTS.REQUEST_GITHUB_SYNC, () => {
        bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 Ribbon 数据同步请求，触发 syncFromGithub handler');
        const handler = ACTION_HANDLERS['syncFromGithub'];
        if (handler) {
            handler({ args: [], startTime: Date.now() });
        }
        else {
            bgmLog(LOG_LEVELS.ERROR, '[handlers] syncFromGithub handler 未注册');
        }
    });
    // Ribbon 按钮触发撤销同步：通过 eventBus 调用 taskpane 的 undoLastSync handler
    // 在 taskpane 环境中执行，可访问 undoStack 中的实际会话数据
    trackedEventBusOn(BGM_EVENTS.REQUEST_UNDO_LAST_SYNC, () => {
        bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 Ribbon 撤销同步请求，触发 undoLastSync handler');
        const handler = ACTION_HANDLERS['undoLastSync'];
        if (handler) {
            handler({ args: [], startTime: Date.now() });
        }
        else {
            bgmLog(LOG_LEVELS.ERROR, '[handlers] undoLastSync handler 未注册');
        }
    });
}
// 尝试更新增量同步复选框（带重试机制）
function tryUpdateIncrementalCheckbox(checked, attempts = 0) {
    if (!isTaskpaneContext())
        return;
    const chkIncremental = document.getElementById('chkIncremental');
    if (chkIncremental) {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 chkIncremental 元素`);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 当前状态: ${chkIncremental.checked ? '开启' : '关闭'}`);
        chkIncremental.checked = checked;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 增量同步复选框已更新: ${checked ? '开启' : '关闭'}`);
    }
    else if (attempts < 3) {
        // 最多重试3次
        bgmLog(LOG_LEVELS.WARN, `[handlers] 未找到 chkIncremental 元素，延迟重试 (${attempts + 1}/3)...`);
        trackedSetTimeout(() => tryUpdateIncrementalCheckbox(checked, attempts + 1), 100);
    }
    else {
        bgmLog(LOG_LEVELS.ERROR, `[handlers] 重试3次后仍未找到 chkIncremental 元素，放弃更新`);
    }
}
// 尝试更新跳过冲突 UI（带重试机制）
function tryUpdateSkipConflictsUI(skipConflicts, attempts = 0) {
    if (!isTaskpaneContext())
        return;
    bgmLog(LOG_LEVELS.INFO, `[handlers] 目标状态: ${skipConflicts ? '跳过冲突' : 'Excel覆盖'}`);
    const conflictStrategySelect = document.getElementById('conflictStrategy');
    if (conflictStrategySelect) {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 conflictStrategy select 元素`);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 当前值: ${conflictStrategySelect.value}`);
        conflictStrategySelect.value = skipConflicts ? 'skip' : 'excel';
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略 select 已更新: ${conflictStrategySelect.value}`);
        return;
    }
    else if (attempts < 3) {
        // 最多重试3次
        bgmLog(LOG_LEVELS.WARN, `[handlers] 未找到 conflictStrategy select 元素，延迟重试 (${attempts + 1}/3)...`);
        trackedSetTimeout(() => tryUpdateSkipConflictsUI(skipConflicts, attempts + 1), 100);
        return;
    }
    bgmLog(LOG_LEVELS.ERROR, `[handlers] 重试3次后仍未找到 conflictStrategy select 元素，尝试查找其他控件`);
    // 如果找不到，尝试查找其他类型的控件
    // 备用：查找 radio 按钮
    const skipRadio = document.querySelector('input[name="conflictStrategy"][value="skip"]');
    const overwriteRadio = document.querySelector('input[name="conflictStrategy"][value="overwrite"]');
    if (skipRadio && overwriteRadio) {
        skipRadio.checked = skipConflicts;
        overwriteRadio.checked = !skipConflicts;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略 radio 已更新`);
        return;
    }
    // 备用：如果是 checkbox
    const chkSkipConflicts = document.getElementById('chkSkipConflicts');
    if (chkSkipConflicts) {
        chkSkipConflicts.checked = skipConflicts;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 跳过冲突复选框已更新`);
    }
}
// 尝试更新启用同步记录复选框（带重试机制，与另外两个开关保持一致）
function tryUpdateEnableSyncRecordUI(enabled, attempts = 0) {
    if (!isTaskpaneContext())
        return;
    const chkEnableSyncRecord = document.getElementById('chkEnableSyncRecord');
    if (chkEnableSyncRecord) {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 chkEnableSyncRecord 元素`);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 当前状态: ${chkEnableSyncRecord.checked ? '开启' : '关闭'}，目标状态: ${enabled ? '开启' : '关闭'}`);
        chkEnableSyncRecord.checked = enabled;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 启用同步记录复选框已更新: ${enabled ? '开启' : '关闭'}`);
    }
    else if (attempts < 3) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 未找到 chkEnableSyncRecord 元素，延迟重试 (${attempts + 1}/3)...`);
        trackedSetTimeout(() => tryUpdateEnableSyncRecordUI(enabled, attempts + 1), 100);
    }
    else {
        bgmLog(LOG_LEVELS.ERROR, `[handlers] 重试3次后仍未找到 chkEnableSyncRecord 元素，放弃更新`);
    }
}
const handleIncrementalChange = () => {
    const chkIncremental = document.getElementById('chkIncremental');
    if (!chkIncremental)
        return;
    const checked = chkIncremental.checked;
    bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 增量同步状态变更 ==========`);
    bgmLog(LOG_LEVELS.INFO, `[handlers] 新状态: ${checked ? '开启' : '关闭'}`);
    try {
        const result = setIncrementalSync(checked);
        if (result) {
            bgmLog(LOG_LEVELS.INFO, `[handlers] 增量同步状态已成功同步到配置和 Ribbon`);
        }
        else {
            bgmLog(LOG_LEVELS.WARN, `[handlers] 增量同步状态同步失败`);
        }
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 更新增量同步状态失败: ${e.message}`);
    }
};
const handleConflictStrategyChange = () => {
    const conflictStrategySelect = document.getElementById('conflictStrategy');
    if (!conflictStrategySelect)
        return;
    const selectedValue = conflictStrategySelect.value;
    const isSkip = selectedValue === 'skip';
    bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 冲突策略变更 ==========`);
    bgmLog(LOG_LEVELS.INFO, `[handlers] 当前值: ${selectedValue}`);
    bgmLog(LOG_LEVELS.INFO, `[handlers] 策略类型: ${isSkip ? '跳过冲突（保留Bangumi数据）' : 'Excel覆盖（用Excel数据覆盖）'}`);
    const result = setSkipConflicts(isSkip);
    if (result) {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已成功同步到配置和 Ribbon`);
    }
    else {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 冲突策略同步失败`);
    }
};
const handleSkipRadioChange = () => {
    const skipRadio = document.querySelector('input[name="conflictStrategy"][value="skip"]');
    if (skipRadio?.checked) {
        setSkipConflicts(true);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已更新: 跳过冲突`);
    }
};
const handleOverwriteRadioChange = () => {
    const overwriteRadio = document.querySelector('input[name="conflictStrategy"][value="overwrite"]');
    if (overwriteRadio?.checked) {
        setSkipConflicts(false);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已更新: Excel覆盖`);
    }
};
const handleChkSkipConflictsChange = () => {
    const chkSkipConflicts = document.getElementById('chkSkipConflicts');
    if (!chkSkipConflicts)
        return;
    const checked = chkSkipConflicts.checked;
    try {
        setSkipConflicts(checked);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 跳过冲突状态已更新: ${checked ? '跳过冲突' : 'Excel覆盖'}`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 更新跳过冲突状态失败: ${e.message}`);
    }
};
// 从配置读取增量同步状态并初始化 checkbox
function initIncrementalSyncFromRibbon() {
    if (!isTaskpaneContext())
        return;
    const chkIncremental = document.getElementById('chkIncremental');
    if (!chkIncremental)
        return;
    try {
        const isIncremental = getIncrementalSync();
        chkIncremental.checked = isIncremental;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 从配置读取增量同步状态: ${isIncremental ? '开启' : '关闭'}`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 读取增量同步状态失败: ${e.message}`);
    }
    // 监听 checkbox 变化，同步到配置
    trackedAddEventListener(chkIncremental, 'change', handleIncrementalChange);
    // 同时初始化跳过冲突选项
    initSkipConflictsFromRibbon();
}
// 从配置读取跳过冲突状态并初始化 UI
function initSkipConflictsFromRibbon() {
    if (!isTaskpaneContext())
        return;
    try {
        const skipConflicts = getSkipConflicts();
        tryUpdateSkipConflictsUI(skipConflicts);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 从配置读取跳过冲突状态: ${skipConflicts ? '跳过冲突' : 'Excel覆盖'}`);
    }
    catch (e) {
        BGM.handleError(e, {
            showAlert: false,
            level: BGM.ErrorLevel.WARN,
            context: 'initSkipConflictsFromRibbon',
        });
    }
    // 监听冲突策略 select 的变化（侧边栏使用的是 select 下拉框）
    const conflictStrategySelect = document.getElementById('conflictStrategy');
    if (conflictStrategySelect) {
        trackedAddEventListener(conflictStrategySelect, 'change', handleConflictStrategyChange);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 已注册冲突策略 select 变化监听器`);
        return;
    }
    // 备用：查找并监听 radio 按钮
    const skipRadio = document.querySelector('input[name="conflictStrategy"][value="skip"]');
    const overwriteRadio = document.querySelector('input[name="conflictStrategy"][value="overwrite"]');
    if (skipRadio && overwriteRadio) {
        trackedAddEventListener(skipRadio, 'change', handleSkipRadioChange);
        trackedAddEventListener(overwriteRadio, 'change', handleOverwriteRadioChange);
        return;
    }
    // 备用：如果是 checkbox
    const chkSkipConflicts = document.getElementById('chkSkipConflicts');
    if (chkSkipConflicts) {
        trackedAddEventListener(chkSkipConflicts, 'change', handleChkSkipConflictsChange);
    }
}
