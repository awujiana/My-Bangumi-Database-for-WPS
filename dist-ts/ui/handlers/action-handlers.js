/**
 * 面板按钮操作分发表
 * @module ui/handlers/action-handlers
 * @description 从 handlers/index.ts 抽出：`handleActionClick` 的事件解析 + `ACTION_HANDLERS`
 *              大表（按 data-action 分发到各业务入口），以及同步指标纯函数。
 */
import { BGM, LOG_LEVELS, _getBgmUserId, bgmLog, buildRawUrl, clearBgToken, clearSyncRecords, closeDetailModal, copyTokenToClipboard, deduplicateSyncRecords, enlargePreview, formatSyncRecordSheet, getApp, getExportPath, getGithubConfig, getImportPath, getSyncSourceType, getSyncStrategy, removeConfig, applyLogLevel, isGithubConfigComplete, isIncrementalSyncEnabled, isSkipConflictsEnabled, isSyncRecordEnabled, loadBgToken, openBangumiTokenPage, openSyncRecordSheet, previewSyncContent, readLocalFileContent, refreshData, refreshSheets, refreshWorkbooks, setExportPath, setGithubConfig, setImportPath, setIncrementalSync, setNavIconsOnly, setSkipConflicts, setSyncRecordEnabled, setSyncSourceType, setSyncStrategy, showAlert, showCleanPanel, showConfirm, showInput, showSettingsPanel, showToast, storeBgToken, syncSelectedRows, toggleSheetLock, } from '../../index.js';
import { exportConfig, importConfig } from '../../services/config-service.js';
import { executeUndoLastSync } from '../../services/ribbon-service.js';
import { clearLogs } from '../../tools/logger.js';
import { exportData } from './data-export.js';
import { hideConnectionTestDialog, showConnectionTestDialog } from '../github-config-dialog.js';
import { _T } from './_constants.js';
import { copyTextToClipboard } from './clipboard.js';
import { getResettableConfigKeys } from './config-reset-keys.js';
import { reloadEnrichPreviewSettings, saveEnrichPreviewSettings, } from './enrich-preview-settings.js';
import { saveHighlightSettings, reloadHighlightSettings } from './highlight-settings.js';
import { findMissingConfigField, readGithubConfigForm, refreshGithubConfigInputs, } from './github-settings.js';
import { renderLogEntries } from './log-panel.js';
import { selectDefaultFolder, updatePathDisplay } from './path-controls.js';
// 「数据同步」动作主体（284 行，占原分发表近 1/5）
import { runRemoteSyncAction } from './remote-sync-action.js';
import { cleanLockedDataSheet, selectFailedRowsFromLastSync } from './sheet.js';
import { syncCollectionFromBgm, syncFromPanel } from './sync.js';
import { openUserCollection, showTokenDialog, showUserIdDialog, testDebugConnection, testTokenValidity, updateTokenStatus, updateUserIdStatus, } from './token.js';
export const ACTION_HANDLERS = {
    // 核心操作
    sync: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行同步操作');
        void syncFromPanel();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 同步操作已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    testSelected: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行选中行同步');
        if (typeof syncSelectedRows === 'function') {
            void syncSelectedRows();
            bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 选中行同步已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
        }
        else {
            bgmLog(LOG_LEVELS.WARN, '[handleActionClick] syncSelectedRows 函数未定义');
        }
    },
    // 重试失败行：只选中上次失败的那几行，同步仍走「👆 选中行同步」
    selectFailedRows: () => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 选中上次同步失败的行');
        selectFailedRowsFromLastSync();
    },
    clear: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新数据');
        showConfirm(_T.confirmClearMarks, (confirmed) => {
            if (confirmed) {
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户确认刷新数据');
                if (typeof refreshData === 'function')
                    refreshData();
                bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 刷新数据完成，耗时: ${String(Date.now() - context.startTime)}ms`);
            }
            else {
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户取消刷新数据');
            }
        });
    },
    previewSyncContent: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行预览同步内容');
        if (typeof previewSyncContent === 'function') {
            void previewSyncContent();
            bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 预览同步内容已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
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
    setToken: (context) => {
        // 已废弃，由 showTokenDialog 替代，保留兼容
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开 Token 设置对话框');
        showTokenDialog(loadBgToken() ?? '');
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] Token 设置对话框已打开，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 快捷按钮
    showTokenDialog: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 显示 Token 设置对话框');
        showTokenDialog(loadBgToken() ?? '');
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] Token 设置对话框已显示，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    clearToken: (context) => {
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
        catch (error) {
            BGM.handleError(error, { showAlert: true, level: BGM.ErrorLevel.WARN, context: 'clearToken' });
        }
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 清除 Token 操作完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    copyToken: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 复制 Token 到剪贴板');
        try {
            const isOk = copyTokenToClipboard();
            if (isOk) {
                showToast('Token 已复制到剪贴板', 'success');
            }
            else {
                showToast('复制失败，可能未设置 Token 或浏览器不支持', 'error');
            }
        }
        catch (error) {
            BGM.handleError(error, { showAlert: true, level: BGM.ErrorLevel.WARN, context: 'copyToken' });
        }
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 复制 Token 操作完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    testToken: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始测试 Token 有效性');
        testTokenValidity();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] Token 测试已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 关闭连接测试弹窗
    closeConnectionTest: () => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭连接测试弹窗');
        hideConnectionTestDialog();
    },
    showUserIdDialog: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 显示用户ID设置对话框');
        showUserIdDialog();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 用户ID设置对话框已显示，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    openUserCollection: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 尝试打开收藏页面');
        openUserCollection();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 收藏页面打开操作已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    openTokenPage: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开 Token 申请页面');
        openBangumiTokenPage();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] Token 申请页面已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    syncCollectionFromBgm: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始从 BGM 同步收藏');
        syncCollectionFromBgm();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 收藏同步已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    refreshSheets: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新工作表（自动匹配当前活动工作表）');
        refreshSheets({ autoSelectActive: true });
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 工作表刷新已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    refreshWorkbooks: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新工作簿列表');
        refreshWorkbooks();
        refreshSheets({ autoSelectActive: true });
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 工作簿刷新已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    refreshData: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新数据');
        refreshData();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 数据刷新已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    toggleSheetLock: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 切换工作表锁定状态');
        toggleSheetLock();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 工作表锁定状态已切换，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    clearSyncRecords: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始清除同步记录');
        clearSyncRecords();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 同步记录清除已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    deduplicateSyncRecords: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始去重同步记录');
        deduplicateSyncRecords();
        showToast('去重完成', 'success');
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 同步记录去重已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    formatSyncRecordSheet: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始设置同步记录表格式');
        formatSyncRecordSheet();
        showToast('格式设置完成', 'success');
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 同步记录表格式设置已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    cleanLockedDataSheet: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始清洗锁定数据表');
        cleanLockedDataSheet();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 数据清洗完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    openSyncRecordSheet: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开同步记录工作表');
        openSyncRecordSheet();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 同步记录工作表已打开，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    testDebugConnection: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 测试调试连接');
        testDebugConnection();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 调试连接测试已完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 模态框操作
    closeDetailModal: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭详情模态框');
        closeDetailModal();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 详情模态框已关闭，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 弹窗快捷调用（参数形式）
    showToast: (context) => {
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 显示 Toast 消息: ${context.args[0] ?? ''}`);
        showToast(context.args[0] ?? '', context.args[1] ?? '');
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] Toast 已显示，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    showAlert: (context) => {
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 显示警告框: ${context.args[0] ?? ''}`);
        showAlert(context.args[0] ?? '', context.args[1] ?? '');
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 警告框已显示，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    requestStopSync: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求停止同步');
        BGM.sync.requestStop();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 停止同步请求已发送，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    pauseSync: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求暂停同步');
        BGM.sync.pause();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 暂停同步请求已发送，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    resumeSync: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求恢复同步');
        BGM.sync.resume();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 恢复同步请求已发送，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // GitHub 仓库同步：保存配置（含策略与同步源类型）
    saveGithubConfig: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 保存 GitHub 配置');
        // 手动保存要求这三个输入框存在：缺失说明页面结构变了，直接报错而不是静默存空值
        // （防抖自动保存走 saveGithubConfigFromDom，缺元素时是「跳过」而非报错）
        const ownerInput = document.getElementById('githubOwner');
        const repoInput = document.getElementById('githubRepo');
        const pathInput = document.getElementById('githubPath');
        if (!ownerInput || !repoInput || !pathInput) {
            showToast('UI 元素缺失', 'error');
            return;
        }
        const form = readGithubConfigForm();
        const missing = findMissingConfigField(form);
        if (missing === 'path') {
            showToast('本地文件路径不能为空', 'warn');
            return;
        }
        if (missing === 'gistId') {
            showToast('Gist ID 不能为空', 'warn');
            return;
        }
        if (missing === 'ownerRepoPath') {
            showToast('owner / repo / path 不能为空', 'warn');
            return;
        }
        const isOkConfig = setGithubConfig({
            owner: form.owner,
            repo: form.repo,
            branch: form.branch,
            path: form.path,
            sourceType: form.sourceType,
            gistId: form.gistId,
        });
        const isOkStrategy = setSyncStrategy(form.strategy);
        const isOkSourceType = setSyncSourceType(form.sourceType);
        if (isOkConfig && isOkStrategy && isOkSourceType) {
            showToast(`配置已保存（策略：${form.strategy}，同步源：${form.sourceType}）`, 'success');
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] GitHub 配置已保存: ${form.owner}/${form.repo}/${form.branch}/${form.path}, 策略: ${form.strategy}, 同步源: ${form.sourceType}${form.gistId ? `, gistId: ${form.gistId}` : ''}`);
        }
        else {
            showToast('保存失败：PluginStorage 不可用', 'error');
        }
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 保存 GitHub 配置完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // GitHub 仓库同步：立即同步（异步，按当前策略）
    // 主体已抽到 ./remote-sync-action.ts（284 行，占原分发表近 1/5）
    // 包一层箭头而不是直接写 `syncFromGithub: runRemoteSyncAction`：分发表在**模块顶层**
    // 求值，直接引用会在初始化期读取还没完成求值的绑定（remote-sync-action → index
    // → 本模块的环），check:cycles 会判为致命环。包一层后读取推迟到点击时。
    syncFromGithub: (context) => {
        runRemoteSyncAction(context);
    },
    // GitHub 仓库同步：测试配置（构造 URL 并提示）
    testGithubConfig: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 测试 GitHub 配置');
        if (!isGithubConfigComplete()) {
            showToast('请先填写并保存 GitHub 配置', 'warn');
            return;
        }
        let url;
        try {
            url = buildRawUrl();
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            showToast(`配置错误：${errorMessage}`, 'error');
            showConnectionTestDialog({
                success: false,
                statusCode: null,
                responseTime: 0,
                url: 'N/A',
                sourceType: getSyncSourceType(),
                errorMessage,
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
        xhr.timeout = 10_000;
        xhr.addEventListener('load', () => {
            const responseTime = Date.now() - testStartTs;
            const statusCode = xhr.status;
            const isSuccess = statusCode >= 200 && statusCode < 400;
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 连接测试完成: status=${String(statusCode)}, time=${String(responseTime)}ms, url=${url}`);
            showConnectionTestDialog({
                success: isSuccess,
                statusCode,
                responseTime,
                url,
                sourceType,
                errorMessage: isSuccess ? undefined : `HTTP ${String(statusCode)}`,
            });
        });
        xhr.addEventListener('error', () => {
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
        });
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
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 测试 GitHub 配置已发起，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 本地文件源：选择本地 JSONL/JSON 文件
    browseLocalFile: (context) => {
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
            // 文件过滤器：分片清单（JSON）优先，其余为兼容手动选择
            const selected = wpsApp.GetOpenFilename('分片清单 (*.json),*.json,JSONL 文件 (*.jsonlines;*.jsonl),*.jsonlines;*.jsonl,所有文件 (*.*),*.*', '选择分片清单（anime.manifest.json）');
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
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            showToast(`选择文件失败：${errorMessage}`, 'error');
            bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 选择本地文件失败: ${errorMessage}`);
        }
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 选择本地文件完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // GitHub 仓库同步：撤销最近一次同步（按单元格逆序恢复旧值）
    undoLastSync: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 撤销最近一次 GitHub 同步');
        void (async () => {
            try {
                await executeUndoLastSync();
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 撤销同步失败: ${errorMessage}`);
                showToast(`撤销失败：${errorMessage}`, 'error');
            }
        })();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 撤销同步已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 系统日志：打开日志面板
    showLogPanel: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开系统日志面板');
        const modal = document.getElementById('logModal');
        if (modal) {
            modal.style.display = 'block';
            renderLogEntries();
        }
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 系统日志面板已打开，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 系统日志：关闭日志面板
    closeLogModal: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭系统日志面板');
        const modal = document.getElementById('logModal');
        if (modal)
            modal.style.display = 'none';
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 系统日志面板已关闭，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 系统日志：导出日志到文件
    // 走统一的导出源注册表（等价于 exportData('systemLogs', 'txt')），
    // 这样「系统日志」与其它数据源共用同一套文件命名与空数据校验。
    //
    // 顶部级别下拉框对导出同样生效：用户选了「仅 ERROR」再点导出，
    // 拿到的就该只有 ERROR —— 否则导出内容与眼前所见不一致，看起来像功能坏了。
    exportLogs: (context) => {
        const filterSelect = document.getElementById('logLevelFilter');
        // 空串表示「全部级别」，须显式判空转成 undefined
        // （`??` 会保留空串，把筛选条件误设成一个恒假的级别）
        const selectedLevel = filterSelect?.value ?? '';
        const logLevel = selectedLevel === '' ? undefined : selectedLevel;
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 导出系统日志到文件${logLevel ? `（仅 ${logLevel}）` : ''}`);
        exportData('systemLogs', 'txt', { logLevel });
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 日志导出完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    /**
     * 通用数据导出：`<button data-action="exportData" data-args='["cleanLogs","csv"]'>`
     *
     * 8 个导出入口（4 个数据源 × CSV/TXT）共用一个 action —— 散成 8 个
     * handler 必然出现漏改，且新增数据源要多处登记。
     */
    exportData: (context) => {
        const [key, format] = context.args;
        if (!key) {
            bgmLog(LOG_LEVELS.WARN, '[handleActionClick] exportData 缺少数据源参数');
            return;
        }
        exportData(key, format === 'txt' ? 'txt' : 'csv');
    },
    // 系统日志：清空日志缓冲区
    clearLogs: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 清空系统日志');
        clearLogs();
        renderLogEntries();
        showToast('日志已清空', 'info');
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 系统日志已清空，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 重置全部配置：清空所有已保存偏好（含 Token / 仓库配置 / 排序 / 各偏好键），仅保留会话态
    resetAllConfig: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 重置全部配置');
        showConfirm('确定要清空所有已保存配置吗？此操作会清除 Token、仓库地址、模块排序等全部偏好，且不可撤销。', (confirmed) => {
            if (!confirmed) {
                showToast('已取消重置', 'info');
                return;
            }
            // 会话态键不参与重置：当前锁定的工作表/工作簿是用户的工作状态，
            // 清掉会让下次打开「追踪表」时丢失目标表选择（config-service 也不把它们入档）
            let removed = 0;
            for (const key of getResettableConfigKeys()) {
                try {
                    if (removeConfig(key))
                        removed += 1;
                }
                catch {
                    // 单个键失败不影响其余键
                }
            }
            // 内存中的日志级别回到默认（否则刷新前仍按旧级别过滤）
            applyLogLevel();
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 已重置 ${String(removed)} 项配置`);
            showToast(`已重置 ${String(removed)} 项配置，正在重新加载…`, 'success');
            // 重新加载页面，让所有表单回到默认值
            if (typeof window !== 'undefined') {
                window.setTimeout(() => {
                    window.location.reload();
                }, 600);
            }
        });
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 重置全部配置操作完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 同步策略使用引导：显示/隐藏同步策略详细说明
    showSyncGuide: (context) => {
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
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 同步策略引导已打开，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 使用引导：显示/隐藏详细操作说明
    toggleUsageGuide: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 切换使用引导详情');
        const detail = document.getElementById('usageGuideDetail');
        const button = document.getElementById('toggleUsageGuideBtn');
        if (detail && button) {
            const isHidden = detail.style.display === 'none';
            detail.style.display = isHidden ? 'block' : 'none';
            button.textContent = isHidden ? '📖 收起详细操作' : '📖 显示详细操作';
        }
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 使用引导已${detail?.style.display === 'none' ? '隐藏' : '显示'}，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 保存所有配置：重新保存当前所有配置项到 PluginStorage
    saveAllConfig: (context) => {
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
            const ghConfig = getGithubConfig();
            if (ghConfig.owner && ghConfig.repo) {
                setGithubConfig(ghConfig);
                parts.push(`GitHub: ${ghConfig.owner}/${ghConfig.repo}`);
            }
            // 4. 同步偏好（重新持久化）
            const isIncremental = isIncrementalSyncEnabled();
            setIncrementalSync(isIncremental);
            parts.push(`增量同步: ${isIncremental ? '开' : '关'}`);
            const isSkipConflicts = isSkipConflictsEnabled();
            setSkipConflicts(isSkipConflicts);
            parts.push(`冲突策略: ${isSkipConflicts ? '跳过' : '覆盖'}`);
            const isSyncRecord = isSyncRecordEnabled();
            setSyncRecordEnabled(isSyncRecord);
            parts.push(`同步记录: ${isSyncRecord ? '开' : '关'}`);
            // 5. 同步策略
            const strategy = getSyncStrategy();
            setSyncStrategy(strategy);
            parts.push(`同步策略: ${strategy}`);
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 配置已保存: ${parts.join('; ')}`);
            showToast('所有配置已保存', 'success');
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 保存配置失败: ${errorMessage}`);
            showToast(`保存失败：${errorMessage}`, 'error');
        }
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 保存配置操作完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // ===== 默认路径记忆：导出位置 / 导入文件夹 =====
    selectExportPath: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 选择默认导出位置');
        const path = selectDefaultFolder('选择默认导出位置（文件夹）');
        if (path) {
            const isOk = setExportPath(path);
            updatePathDisplay('exportPathDisplay', path);
            if (isOk) {
                showToast('已设置默认导出位置', 'success');
                bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 已设置默认导出位置: ${path}`);
            }
        }
        else {
            showToast('已取消选择导出位置', 'info');
        }
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 选择导出位置操作完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    clearExportPath: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 清除默认导出位置');
        if (getExportPath(true)) {
            setExportPath('');
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 已清除默认导出位置');
        }
        updatePathDisplay('exportPathDisplay', '');
        showToast('已清除默认导出位置', 'info');
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 清除导出位置操作完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    selectImportPath: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 选择默认导入文件夹');
        const path = selectDefaultFolder('选择默认导入文件夹');
        if (path) {
            const isOk = setImportPath(path);
            updatePathDisplay('importPathDisplay', path);
            if (isOk) {
                showToast('已设置默认导入文件夹', 'success');
                bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 已设置默认导入文件夹: ${path}`);
            }
        }
        else {
            showToast('已取消选择导入文件夹', 'info');
        }
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 选择导入文件夹操作完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    clearImportPath: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 清除默认导入文件夹');
        if (getImportPath(true)) {
            setImportPath('');
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 已清除默认导入文件夹');
        }
        updatePathDisplay('importPathDisplay', '');
        showToast('已清除默认导入文件夹', 'info');
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 清除导入文件夹操作完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 配置导入导出：导出全部配置为 JSON 文件并复制到剪贴板
    exportConfig: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 导出配置');
        try {
            // 读取记忆的默认导出位置（仅作提示与记录，WPS 浏览器下载无法指定保存目录）
            const defaultExportPath = getExportPath(true);
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
            copyTextToClipboard(json);
            // 浏览器下载无法指定保存目录，这里只能把记忆的位置「提示」给用户
            const suffix = defaultExportPath ? `默认位置：${defaultExportPath}` : '未设置默认位置';
            showToast(`配置已导出，请手动保存到该位置（${suffix}）`, 'success');
            bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 配置导出完成（${suffix}）`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 配置导出失败: ${errorMessage}`);
            showToast(`配置导出失败：${errorMessage}`, 'error');
        }
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 导出配置操作完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 配置导入导出：从默认导入文件夹选择配置文件或粘贴 JSON 导入
    importConfig: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 导入配置');
        const defaultImportPath = getImportPath(true);
        const performImport = (json) => {
            const result = importConfig(json);
            if (result.isOk()) {
                showToast('配置导入成功', 'success');
                bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 配置导入成功');
                // 导入可能带来新的日志级别；只写存储不会改变内存过滤阈值，须重新套用
                applyLogLevel();
                // 刷新 UI 以反映新配置
                updateTokenStatus();
                updateUserIdStatus();
                refreshGithubConfigInputs();
            }
            else {
                const rawError = result.error;
                let errorMessage;
                if (rawError instanceof Error) {
                    errorMessage = rawError.message;
                }
                else if (typeof rawError === 'string') {
                    errorMessage = rawError;
                }
                else if (rawError == null) {
                    errorMessage = '未知错误';
                }
                else {
                    // 非 Error 非字符串的其余值：JSON 序列化展示（避免默认的 [object Object]）
                    errorMessage = JSON.stringify(rawError);
                }
                bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 配置导入失败: ${errorMessage}`);
                showToast(`导入失败：${errorMessage}`, 'error');
            }
        };
        // 优先通过 WPS 对话框从文件导入（JSON 过滤器）；用户取消则回退到粘贴
        const app = window.wps;
        const wpsApp = app?.Application;
        if (wpsApp && typeof wpsApp.GetOpenFilename === 'function') {
            // 文件选择框不支持指定初始目录，位置只能写进标题作提示
            const title = defaultImportPath
                ? `选择配置文件 JSON（导入位置提示：${defaultImportPath}）`
                : '选择配置文件 JSON';
            const selected = wpsApp.GetOpenFilename('JSON 文件 (*.json),*.json,所有文件 (*.*),*.*', title);
            if (typeof selected === 'string' && selected !== '') {
                const filePath = selected;
                bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 从文件导入配置: ${filePath}`);
                void (async () => {
                    try {
                        const content = await readLocalFileContent(filePath);
                        performImport(content);
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 读取配置文件失败: ${errorMessage}`);
                        showToast(`读取配置文件失败：${errorMessage}`, 'error');
                    }
                })();
                bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 已选择配置文件，读取中，耗时: ${String(Date.now() - context.startTime)}ms`);
                return;
            }
            bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户取消文件选择，回退到粘贴');
        }
        showInput('导入配置', '请粘贴配置 JSON（可从导出的 bgm-config.json 文件中复制）', '', (value) => {
            if (!value || value.trim() === '') {
                showToast('未提供配置 JSON，已取消导入', 'info');
                return;
            }
            performImport(value.trim());
        });
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 导入配置对话框已显示，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 关闭主面板（panel）
    closePanel: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭主面板');
        const app = getApp();
        if (!app) {
            bgmLog(LOG_LEVELS.WARN, '[handleActionClick] 无法获取 Application 对象');
            return;
        }
        const tsId = app.PluginStorage?.getItem('panel_id');
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
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 关闭主面板操作完成，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 打开/切换设置面板
    openSettings: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开设置面板');
        showSettingsPanel();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 设置面板操作已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 打开/切换通用数据清理面板
    openCleanPanel: (context) => {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开数据清理面板');
        showCleanPanel();
        bgmLog(LOG_LEVELS.DEBUG, `[handleActionClick] 数据清理面板操作已触发，耗时: ${String(Date.now() - context.startTime)}ms`);
    },
    // 设置页面：切换增量同步开关
    toggleIncrementalSync: (_context) => {
        const checkbox = document.getElementById('chkIncrementalSync');
        const isEnabled = checkbox?.checked ?? false;
        setIncrementalSync(isEnabled);
        showToast(`增量同步已${isEnabled ? '开启' : '关闭'}`, 'success');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 增量同步: ${isEnabled ? '开启' : '关闭'}`);
    },
    // 设置页面：切换跳过冲突开关
    toggleSkipConflicts: (_context) => {
        const checkbox = document.getElementById('chkSkipConflicts');
        const isEnabled = checkbox?.checked ?? false;
        setSkipConflicts(isEnabled);
        showToast(`冲突处理: ${isEnabled ? '跳过冲突' : 'Excel覆盖'}`, 'success');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 跳过冲突: ${isEnabled ? '开启' : '关闭'}`);
    },
    // 设置页面：切换启用同步记录开关
    toggleEnableSyncRecord: (_context) => {
        const checkbox = document.getElementById('chkEnableSyncRecord');
        const isEnabled = checkbox?.checked ?? false;
        setSyncRecordEnabled(isEnabled);
        showToast(`同步记录已${isEnabled ? '开启' : '关闭'}`, 'success');
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 启用同步记录: ${isEnabled ? '开启' : '关闭'}`);
    },
    toggleNavIconsOnly: (_context) => {
        const checkbox = document.getElementById('chkNavIconsOnly');
        const isEnabled = checkbox?.checked ?? false;
        setNavIconsOnly(isEnabled);
        showToast(`导航模式: ${isEnabled ? '仅图标' : '图标+文字'}`, 'success');
        if (typeof document !== 'undefined') {
            document.body.classList.toggle('nav-icons-only', isEnabled);
        }
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 导航模式: ${isEnabled ? '仅图标' : '图标+文字'}`);
    },
    // 设置页「🎨 富化预览」：保存 / 放弃修改
    saveEnrichPreviewSettings: () => {
        saveEnrichPreviewSettings();
    },
    reloadEnrichPreviewSettings: () => {
        reloadEnrichPreviewSettings();
    },
    // 设置页「⚙️ 功能开关」：保存 / 放弃修改
    saveHighlightSettings: () => {
        saveHighlightSettings();
    },
    reloadHighlightSettings: () => {
        reloadHighlightSettings();
    },
};
export function handleActionClick(event) {
    const target = event.currentTarget;
    const { action } = target.dataset;
    if (!action)
        return;
    // 解析可能的参数（如：<button data-action="markUploadedItems" data-args='["动画"]'>）
    let arguments_ = [];
    if (target.dataset.args) {
        try {
            arguments_ = JSON.parse(target.dataset.args);
        }
        catch (error) {
            BGM.handleError(error, {
                showAlert: false,
                level: BGM.ErrorLevel.WARN,
                context: 'handleActionClick',
            });
        }
    }
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] ========== 按钮点击事件 ==========`);
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 操作类型: ${action}`);
    if (arguments_.length > 0) {
        bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 参数: ${JSON.stringify(arguments_)}`);
    }
    const startTime = Date.now();
    try {
        const handler = ACTION_HANDLERS[action];
        if (handler) {
            handler({ args: arguments_, startTime });
        }
        else {
            bgmLog(LOG_LEVELS.WARN, `[handleActionClick] 未知操作类型: ${action}`);
        }
    }
    catch (error) {
        bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 操作执行失败: ${action}, 错误: ${error.message}`);
        BGM.handleError(error, { context: `handleActionClick:${action}`, showAlert: true });
    }
}
