/**
 * Settings 显式入口模块
 * @module entry/settings-entry
 * @description 设置面板的统一启动入口。
 *
 * 职责：
 *  1. 显式调用 initializeHandlers()，复用已有的事件处理逻辑。
 *  2. 调用 initializeSettingsPage() 加载已保存的配置到表单。
 *  3. 仅在浏览器上下文且当前页面为 settings.html 时自动启动。
 */
import { initializeTheme, startThemeSync } from '../tools/theme.js';
import { startNavModeSync } from '../tools/nav-mode.js';
import { startModuleStateSync } from '../tools/module-state.js';
import { startNavOrderSync } from '../tools/nav-order.js';
import { initializeHandlers } from '../ui/handlers/index.js';
import { markSettingsPaneLoaded } from '../tools/util/index.js';
import { initializeShellNav } from '../panel/shell-nav.js';
/**
 * 判断当前是否为设置页面上下文（宽松匹配）。
 * 覆盖 WPS Task Pane 中可能的 URL 格式：
 *   - wps-local://.../settings.html
 *   - file:///.../settings.html
 *   - http://localhost/settings.html
 * 以及 document.title 包含 "设置" 的情况。
 */
function isSettingsContext() {
    if (typeof window === 'undefined')
        return false;
    const loc = window.location;
    if (loc.pathname.includes('settings.html'))
        return true;
    if (loc.href.includes('settings.html'))
        return true;
    if (document.title.includes('设置'))
        return true;
    return false;
}
/**
 * 设置页面初始化：加载已保存的配置到表单元素。
 *  - Token 状态（updateTokenStatus）
 *  - 用户信息（updateUserIdStatus）
 *  - 同步偏好（增量同步、跳过冲突、启用同步记录）
 *  - GitHub 配置（owner/repo/branch/path/strategy）
 */
function initializeSettingsPage() {
    // 1. 加载 Token 和用户信息状态
    // 这些函数使用 DOM ID 查找元素，settings.html 已使用与 panel.html 相同的 ID
    void (async () => {
        try {
            const { updateTokenStatus, updateUserIdStatus } = await import('../ui/handlers/token.js');
            updateTokenStatus();
            updateUserIdStatus();
        }
        catch {
            // 静默处理，token 状态在 initializeHandlers 中也会初始化
        }
    })();
    // 2. 加载同步偏好设置
    void (async () => {
        try {
            const { isIncrementalSyncEnabled, isSkipConflictsEnabled, isSyncRecordEnabled, areNavIconsOnly, applyLogLevel, getLogLevel, } = await import('../tools/config.js');
            // 设置复选框
            const chkIncremental = document.getElementById('chkIncrementalSync');
            if (chkIncremental)
                chkIncremental.checked = isIncrementalSyncEnabled(true);
            const chkSkip = document.getElementById('chkSkipConflicts');
            if (chkSkip)
                chkSkip.checked = isSkipConflictsEnabled(true);
            const chkSyncRecord = document.getElementById('chkEnableSyncRecord');
            if (chkSyncRecord)
                chkSyncRecord.checked = isSyncRecordEnabled(true);
            const chkNavIcons = document.getElementById('chkNavIconsOnly');
            if (chkNavIcons)
                chkNavIcons.checked = areNavIconsOnly(true);
            // 应用全局日志级别到内存（bgmLog 依赖 BGM.LOG_LEVEL 过滤），并预填下拉
            applyLogLevel();
            const logLevelSelect = document.getElementById('logLevelSelect');
            if (logLevelSelect)
                logLevelSelect.value = String(getLogLevel(true));
        }
        catch {
            // 静默处理
        }
    })();
}
/**
 * 应用外观主题与导航显示模式，并初始化外壳导航（吸顶偏移 + 滚动高亮）。
 * 滚动高亮逻辑已抽到 panel/shell-nav.ts 由三页面共享。
 */
function applyAppearance() {
    if (typeof document === 'undefined')
        return;
    // 主题：从配置读取并应用（含跟随系统监听）
    initializeTheme();
    // 跨页主题同步：监听其他页面（panel / enrich）的主题变更并重应用
    startThemeSync();
    // 跨页导航模式同步：监听「导航仅显示图标」配置变更并切换布局
    startNavModeSync();
    // 跨页模块排序同步：其它页面（或本页编辑器）改动排序后即时重排本页侧栏与主区
    startNavOrderSync('settings');
    // 模块折叠 / 隐藏：注入右上角折叠按钮 + 应用状态 + 轮询跨页同步
    startModuleStateSync('settings');
    // 吸顶偏移测量 + 滚动高亮（共享模块，修复侧栏被顶栏遮挡 / 锚点跳转错位）
    initializeShellNav();
}
/**
 * 启动设置面板：执行 UI 事件处理初始化 + 设置页面初始化。
 * 完成后触发 bgm:modulesReady 事件，通知 panel/settingsBootstrap 入口启用按钮。
 */
export function startSettings() {
    applyAppearance();
    // 记录设置页已成功加载，供 showSettingsPanel 判断缓存的面板 ID 是否有效
    markSettingsPaneLoaded();
    initializeHandlers();
    initializeSettingsPage();
    // 通知模块就绪，启用按钮（与 panelPage.ts 的 initializePanelCore 对齐）。
    // 必须异步派发：本模块在 settingsBootstrap 的 import 阶段被求值，若同步派发，
    // settingsBootstrap 中注册的 bgm:modulesReady 监听器尚未挂载，按钮会一直禁用
    // 直到 5s 兜底超时。queueMicrotask 在模块求值完成后、settingsBootstrap 主体
    // 注册监听器之后再派发，保证按钮立即启用。
    if (typeof document !== 'undefined') {
        queueMicrotask(() => {
            document.dispatchEvent(new CustomEvent('bgm:modulesReady'));
            // eslint-disable-next-line no-console -- console 是日志后端/启动兜底的唯一输出通道（启动日志，logger 初始化前可能执行）
            console.log('[BGM Settings] startSettings() 完成，bgm:modulesReady 已触发');
        });
    }
}
// 仅在浏览器上下文且当前页面为设置页面时自动启动
if (isSettingsContext()) {
    startSettings();
}
