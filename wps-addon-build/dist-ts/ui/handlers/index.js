/**
 * UI 事件处理模块 - 入口与聚合
 * @module ui/handlers/index
 * @description 资源追踪、按钮监听、ACTION_HANDLERS 分发、消息监听、事件总线监听、
 *              配置 UI 回填等。同时 re-export 子模块的公开 API，保持原 handlers.ts 的外部接口。
 */
import { LOG_LEVELS, bgmLog, BGM, loadBgToken, clearBgToken, copyTokenToClipboard, _setBgmUserId, _setBgmUsername, getApp, showAlert, showConfirm, showInput, showToast, setStatus, refreshData, refreshSheets, toggleSheetLock, clearSyncRecords, deduplicateSyncRecords, formatSyncRecordSheet, openSyncRecordSheet, closeDetailModal, previewSyncContent, syncSelectedRows, openBangumiTokenPage, setSyncRecordEnabled, getIncrementalSync, setIncrementalSync, getSkipConflicts, setSkipConflicts, getGithubConfig, setGithubConfig, isGithubConfigComplete, getSyncStrategy, setSyncStrategy, getSyncSourceType, setSyncSourceType, syncFromGithub, buildRawUrl, updateSyncProgressDialog, } from '../../index.js';
import { BGM_EVENTS, eventBus } from '../../tools/events.js';
import { debounce } from '../../tools/debounce.js';
import { undoLastSyncForRibbon } from '../../services/ribbonService.js';
import { exportConfig, importConfig } from '../../services/configService.js';
import { getRecentLogs, exportLogsToFile, clearLogs } from '../../tools/logger.js';
// 子模块
import { _T } from './_constants.js';
import { showTokenDialog, showUserIdDialog, updateTokenStatus, updateUserIdStatus, openUserCollection, testTokenValidity, testDebugConnection, } from './token.js';
import { syncFromPanel, syncCollectionFromBgm, } from './sync.js';
import { cleanLockedDataSheet } from './sheet.js';
// 子模块 re-export（保持原 handlers.ts 的对外 API）
export { showTokenDialog, showUserIdDialog, updateTokenStatus, updateUserIdStatus, openUserCollection, testTokenValidity, testDebugConnection, } from './token.js';
export { syncFromPanel, syncCollectionFromBgm, syncFromBgmByAPI, } from './sync.js';
export { cleanLockedDataSheet } from './sheet.js';
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
// ========== 事件监听 ==========
export function setupButtonListeners() {
    document.querySelectorAll('[data-action]').forEach(button => {
        button.removeEventListener('click', handleActionClick);
        button.addEventListener('click', handleActionClick);
    });
    // 启用同步记录 开关
    const chkEnableSyncRecord = document.getElementById('chkEnableSyncRecord');
    if (chkEnableSyncRecord) {
        chkEnableSyncRecord.addEventListener('change', () => {
            const checked = chkEnableSyncRecord.checked;
            bgmLog(LOG_LEVELS.INFO, `[handlers] 启用同步记录开关切换: ${checked ? '开启' : '关闭'}`);
            setSyncRecordEnabled(checked);
            showToast(checked ? '已启用同步记录功能' : '已关闭同步记录功能', 'info');
        });
        bgmLog(LOG_LEVELS.INFO, '[handlers] 启用同步记录 checkbox 监听器已注册');
    }
    // GitHub 配置：面板加载时自动填充已保存的值（含策略与同步源类型）
    try {
        const cfg = getGithubConfig();
        const ownerInput = document.getElementById('githubOwner');
        const repoInput = document.getElementById('githubRepo');
        const branchInput = document.getElementById('githubBranch');
        const pathInput = document.getElementById('githubPath');
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
        // 回填策略
        const savedStrategy = getSyncStrategy();
        if (strategySelect)
            strategySelect.value = savedStrategy;
        // 回填同步源类型
        const savedSourceType = getSyncSourceType();
        if (sourceTypeSelect)
            sourceTypeSelect.value = savedSourceType;
        if (cfg.owner || cfg.repo || cfg.path) {
            bgmLog(LOG_LEVELS.INFO, `[handlers] GitHub 配置已加载: ${cfg.owner}/${cfg.repo}/${cfg.branch}/${cfg.path}, 策略: ${savedStrategy}, 同步源: ${savedSourceType}`);
        }
        // 为 GitHub 配置输入框添加防抖自动保存（300ms），
        // 用户输入时静默保存，避免每次按键都触发 PluginStorage 写入。
        // 注意：按钮点击 "保存配置"（saveGithubConfig action）不走此路径，
        // 仍保留同步保存 + Toast 反馈，确保用户主动保存的即时确认体验。
        const debouncedSaveGithubConfig = debounce(() => {
            try {
                const owner = (ownerInput?.value ?? '').trim();
                const repo = (repoInput?.value ?? '').trim();
                const branch = (branchInput?.value ?? '').trim() || 'main';
                const path = (pathInput?.value ?? '').trim();
                const strategy = strategySelect?.value || 'add-update';
                const sourceType = sourceTypeSelect?.value || 'github';
                // 本地文件源仅需 path 字段；远程源要求 owner/repo/path 均非空
                // 用户可能正在输入，必填项未完成时跳过自动保存
                if (sourceType === 'local') {
                    if (!path)
                        return;
                }
                else {
                    if (!owner || !repo || !path)
                        return;
                }
                const okConfig = setGithubConfig({ owner, repo, branch, path, sourceType });
                const okStrategy = setSyncStrategy(strategy);
                const okSourceType = setSyncSourceType(sourceType);
                if (okConfig && okStrategy && okSourceType) {
                    bgmLog(LOG_LEVELS.INFO, `[handlers] GitHub 配置已自动保存: ${owner}/${repo}/${branch}/${path}, 策略: ${strategy}, 同步源: ${sourceType}`);
                }
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, `[handlers] GitHub 配置自动保存失败: ${e.message}`);
            }
        }, 300);
        if (ownerInput)
            ownerInput.addEventListener('input', debouncedSaveGithubConfig);
        if (repoInput)
            repoInput.addEventListener('input', debouncedSaveGithubConfig);
        if (branchInput)
            branchInput.addEventListener('input', debouncedSaveGithubConfig);
        if (pathInput)
            pathInput.addEventListener('input', debouncedSaveGithubConfig);
        if (strategySelect)
            strategySelect.addEventListener('change', debouncedSaveGithubConfig);
        if (sourceTypeSelect)
            sourceTypeSelect.addEventListener('change', debouncedSaveGithubConfig);
        bgmLog(LOG_LEVELS.INFO, '[handlers] GitHub 配置输入框防抖自动保存监听器已注册');
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, `[handlers] 加载 GitHub 配置失败: ${e.message}`);
    }
    // 系统日志：级别筛选下拉框变化时重新渲染日志列表
    const logLevelFilter = document.getElementById('logLevelFilter');
    if (logLevelFilter) {
        logLevelFilter.addEventListener('change', () => {
            renderLogEntries();
        });
        bgmLog(LOG_LEVELS.INFO, '[handlers] 日志级别筛选 change 监听器已注册');
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
        const strategySelect = document.getElementById('githubStrategy');
        const sourceTypeSelect = document.getElementById('syncSourceType');
        if (!ownerInput || !repoInput || !pathInput) {
            showToast('UI 元素缺失', 'error');
            return;
        }
        const sourceType = sourceTypeSelect?.value || 'github';
        const config = {
            owner: ownerInput.value.trim(),
            repo: repoInput.value.trim(),
            branch: branchInput?.value.trim() || 'main',
            path: pathInput.value.trim(),
            sourceType,
        };
        // 本地文件源仅需 path 字段（不需要 owner/repo/branch）
        // 远程源（github/gitlab/gitee）要求 owner/repo/path 均非空
        if (sourceType === 'local') {
            if (!config.path) {
                showToast('本地文件路径不能为空', 'warn');
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
            showToast(`GitHub 配置已保存（策略：${strategy}，同步源：${sourceType}）`, 'success');
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] GitHub 配置已保存: ${config.owner}/${config.repo}/${config.branch}/${config.path}, 策略: ${strategy}, 同步源: ${sourceType}`);
        }
        else {
            showToast('保存失败：PluginStorage 不可用', 'error');
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 保存 GitHub 配置完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // GitHub 仓库同步：立即同步（异步，按当前策略）
    syncFromGithub: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始从 GitHub 同步');
        // 读取同步源类型：优先用下拉框当前值，兜底用已保存的值
        const sourceTypeSelect = document.getElementById('syncSourceType');
        const currentSourceType = sourceTypeSelect?.value || getSyncSourceType();
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
            showToast('请先填写并保存 GitHub 配置', 'warn');
            return;
        }
        // 读取策略：优先用下拉框当前值（未保存也能即时生效），兜底用已保存的策略
        const strategySelect = document.getElementById('githubStrategy');
        const strategy = strategySelect?.value || getSyncStrategy();
        const strategyLabel = {
            'add-update': '新增+更新（不删除）',
            'add-only': '仅新增',
            'update-only': '仅更新',
            'mirror': '镜像同步（含删除）',
            'force-overwrite': '强制覆盖',
        }[strategy];
        // 同步源类型对应的来源描述（本地文件 vs GitHub 仓库）
        const sourceLabel = currentSourceType === 'local' ? '本地文件' : 'GitHub 仓库';
        showConfirm(`将从${sourceLabel}读取 JSON 并按策略【${strategyLabel}】合并到当前工作表。\n是否继续？`, (confirmed) => {
            if (!confirmed) {
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户取消 GitHub 同步');
                return;
            }
            syncFromGithub((current, total, message) => {
                if (total > 0) {
                    setStatus(`GitHub 同步 ${current}/${total}: ${message}`);
                }
            }, strategy)
                .then((result) => {
                const summary = `GitHub 同步完成：远程 ${result.remoteTotal}，新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}，失败 ${result.failed}`;
                bgmLog(LOG_LEVELS.INFO, `[handleActionClick] ${summary}`);
                showToast(summary, result.failed > 0 ? 'warn' : 'success');
            })
                .catch((e) => {
                const errMsg = e instanceof Error ? e.message : String(e);
                bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] GitHub 同步失败: ${errMsg}`);
                showToast(`GitHub 同步失败：${errMsg}`, 'error');
            });
        });
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] GitHub 同步已触发（策略: ${strategy}），耗时: ${Date.now() - ctx.startTime}ms`);
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
            return;
        }
        showToast(`Raw URL：\n${url}`, 'info');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] GitHub Raw URL: ${url}`);
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 测试 GitHub 配置完成，耗时: ${Date.now() - ctx.startTime}ms`);
    },
    // GitHub 仓库同步：撤销最近一次同步（按单元格逆序恢复旧值）
    undoLastSync: (ctx) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 撤销最近一次 GitHub 同步');
        undoLastSyncForRibbon().catch((e) => {
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
    logs.forEach(entry => {
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
            BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'handleActionClick' });
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
        setupButtonListeners();
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
        if (strategySelect)
            strategySelect.value = getSyncStrategy();
        if (sourceTypeSelect)
            sourceTypeSelect.value = getSyncSourceType();
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
// ========== 事件监听（用于接收事件总线通知）==========
function setupEventListeners() {
    eventBus.on(BGM_EVENTS.TOKEN_UPDATED, () => {
        bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 TOKEN_UPDATED 事件');
        updateTokenStatus();
        updateUserIdStatus();
    });
    eventBus.on(BGM_EVENTS.USER_ID_UPDATED, () => {
        bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 USER_ID_UPDATED 事件');
        updateUserIdStatus();
    });
    eventBus.on(BGM_EVENTS.USER_NAME_UPDATED, () => {
        bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 USER_NAME_UPDATED 事件');
        updateUserIdStatus();
    });
    // 配置更新事件（用于同步增量同步和跳过冲突状态）
    eventBus.on(BGM_EVENTS.CONFIG_UPDATED, (data) => {
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
    });
    // 同步进度事件（更新到同步进度弹窗，若弹窗未打开则忽略）
    eventBus.on(BGM_EVENTS.SYNC_PROGRESS, (data) => {
        updateSyncProgressDialog(data.current, data.total, data.message);
    });
    // 同步状态变更事件（开始/暂停/恢复/停止/空闲）
    eventBus.on(BGM_EVENTS.SYNC_STATE_CHANGED, (payload) => {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 同步状态变更: ${payload.state}${payload.row ? `, 行: ${payload.row}` : ''}`);
        // 可选：根据状态刷新按钮禁用态
        const syncButtons = document.querySelectorAll('button[data-action="sync"], button[data-action="syncCollectionFromBgm"], button[data-action="previewSyncContent"]');
        syncButtons.forEach(btn => {
            const el = btn;
            el.disabled = payload.state === 'running' || payload.state === 'paused';
        });
    });
}
// 尝试更新增量同步复选框（带重试机制）
function tryUpdateIncrementalCheckbox(checked, attempts = 0) {
    if (!isTaskpaneContext())
        return;
    let chkIncremental = document.getElementById('chkIncremental');
    if (chkIncremental) {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 chkIncremental 元素`);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 当前状态: ${chkIncremental.checked ? '开启' : '关闭'}`);
        chkIncremental.checked = checked;
        bgmLog(LOG_LEVELS.INFO, `[handlers] 增量同步复选框已更新: ${checked ? '开启' : '关闭'}`);
    }
    else if (attempts < 3) { // 最多重试3次
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
    let conflictStrategySelect = document.getElementById('conflictStrategy');
    if (conflictStrategySelect) {
        bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 conflictStrategy select 元素`);
        bgmLog(LOG_LEVELS.INFO, `[handlers] 当前值: ${conflictStrategySelect.value}`);
        conflictStrategySelect.value = skipConflicts ? 'skip' : 'excel';
        bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略 select 已更新: ${conflictStrategySelect.value}`);
        return;
    }
    else if (attempts < 3) { // 最多重试3次
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
    chkIncremental.addEventListener('change', () => {
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
    });
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
        BGM.handleError(e, { showAlert: false, level: BGM.ErrorLevel.WARN, context: 'initSkipConflictsFromRibbon' });
    }
    // 监听冲突策略 select 的变化（侧边栏使用的是 select 下拉框）
    const conflictStrategySelect = document.getElementById('conflictStrategy');
    if (conflictStrategySelect) {
        conflictStrategySelect.addEventListener('change', () => {
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
        });
        bgmLog(LOG_LEVELS.INFO, `[handlers] 已注册冲突策略 select 变化监听器`);
        return;
    }
    // 备用：查找并监听 radio 按钮
    const skipRadio = document.querySelector('input[name="conflictStrategy"][value="skip"]');
    const overwriteRadio = document.querySelector('input[name="conflictStrategy"][value="overwrite"]');
    if (skipRadio && overwriteRadio) {
        skipRadio.addEventListener('change', () => {
            if (skipRadio.checked) {
                setSkipConflicts(true);
                bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已更新: 跳过冲突`);
            }
        });
        overwriteRadio.addEventListener('change', () => {
            if (overwriteRadio.checked) {
                setSkipConflicts(false);
                bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已更新: Excel覆盖`);
            }
        });
        return;
    }
    // 备用：如果是 checkbox
    const chkSkipConflicts = document.getElementById('chkSkipConflicts');
    if (chkSkipConflicts) {
        chkSkipConflicts.addEventListener('change', () => {
            const checked = chkSkipConflicts.checked;
            try {
                setSkipConflicts(checked);
                bgmLog(LOG_LEVELS.INFO, `[handlers] 跳过冲突状态已更新: ${checked ? '跳过冲突' : 'Excel覆盖'}`);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.WARN, `[handlers] 更新跳过冲突状态失败: ${e.message}`);
            }
        });
    }
}
