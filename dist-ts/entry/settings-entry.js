/**
 * Settings 显式入口模块
 * @module entry/settings-entry
 * @description 设置面板的统一启动入口。
 *
 * 职责：
 *  1. 显式调用 initHandlers()，复用已有的事件处理逻辑。
 *  2. 调用 initSettingsPage() 加载已保存的配置到表单。
 *  3. 仅在浏览器上下文且当前页面为 settings.html 时自动启动。
 */
import { initHandlers } from '../ui/handlers/index.js';
/**
 * 设置页面初始化：加载已保存的配置到表单元素。
 *  - Token 状态（updateTokenStatus）
 *  - 用户信息（updateUserIdStatus）
 *  - 同步偏好（增量同步、跳过冲突、启用同步记录）
 *  - GitHub 配置（owner/repo/branch/path/strategy）
 *  - 收藏回写数据源
 */
function initSettingsPage() {
    // 1. 加载 Token 和用户信息状态
    // 这些函数使用 DOM ID 查找元素，settings.html 已使用与 panel.html 相同的 ID
    import('../ui/handlers/token.js')
        .then(({ updateTokenStatus, updateUserIdStatus }) => {
        updateTokenStatus();
        updateUserIdStatus();
    })
        .catch(() => {
        // 静默处理，token 状态在 initHandlers 中也会初始化
    });
    // 2. 加载同步偏好设置
    import('../tools/config.js')
        .then(({ getIncrementalSync, getSkipConflicts, getSyncRecordEnabled, getConfig }) => {
        // 设置复选框
        const chkIncremental = document.getElementById('chkIncrementalSync');
        if (chkIncremental)
            chkIncremental.checked = getIncrementalSync(true);
        const chkSkip = document.getElementById('chkSkipConflicts');
        if (chkSkip)
            chkSkip.checked = getSkipConflicts(true);
        const chkSyncRecord = document.getElementById('chkEnableSyncRecord');
        if (chkSyncRecord)
            chkSyncRecord.checked = getSyncRecordEnabled(true);
        // 设置冲突策略下拉
        const strategySelect = document.getElementById('githubStrategy');
        if (strategySelect) {
            const savedStrategy = getConfig('bgm_conflict_strategy', 'skip', true);
            strategySelect.value = savedStrategy;
        }
        // 设置收藏回写数据源下拉
        const sourceSelect = document.getElementById('writebackSourceType');
        if (sourceSelect) {
            const savedSource = getConfig('bgm_writeback_source', 'api', true);
            sourceSelect.value = savedSource;
        }
    })
        .catch(() => {
        // 静默处理
    });
    // 3. 加载 GitHub 配置
    import('../index.js')
        .then(({ getGithubConfig }) => {
        const cfg = getGithubConfig();
        const ownerInput = document.getElementById('githubOwner');
        if (ownerInput)
            ownerInput.value = cfg.owner || '';
        const repoInput = document.getElementById('githubRepo');
        if (repoInput)
            repoInput.value = cfg.repo || '';
        const branchInput = document.getElementById('githubBranch');
        if (branchInput)
            branchInput.value = cfg.branch || '';
        const pathInput = document.getElementById('githubPath');
        if (pathInput)
            pathInput.value = cfg.path || '';
    })
        .catch(() => {
        // 静默处理
    });
}
/**
 * 启动设置面板：执行 UI 事件处理初始化 + 设置页面初始化。
 */
export function startSettings() {
    initHandlers();
    initSettingsPage();
}
// 仅在浏览器上下文且当前页面为 settings.html 时自动启动
if (typeof window !== 'undefined' && window.location.pathname.includes('settings.html')) {
    startSettings();
}
