/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */
import { WPS_ENUM, showBangumiPanel, BGM, getIncrementalSync, getSkipConflicts, setIncrementalSync, setSkipConflicts, bgmLog, LOG_LEVELS, getApp } from './index.js';
import * as RibbonService from './services/ribbonService.js';
// 在 Ribbon 启动时（例如 OnAddinLoad 中或文件顶部立即执行）
// 【正确】监听侧边栏发来的配置更新，刷新 Ribbon UI
function initRibbonMessageListener() {
    if (typeof window === 'undefined')
        return;
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (data?.type === 'BGM:configUpdated') {
            const key = data.data?.key;
            if (key === 'bgm_skip_conflicts' || key === 'bgm_incremental_sync') {
                const app = getApp();
                const ribbonUI = app?.ribbonUI;
                if (ribbonUI) {
                    const controlId = key === 'bgm_skip_conflicts' ? 'chkSkipConflicts' : 'chkIncrementalSync';
                    ribbonUI.InvalidateControl(controlId);
                }
            }
        }
    });
}
initRibbonMessageListener();
/**
 * 获取"跳过冲突"复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- WPS Ribbon 控件无 @types
export function GetSkipConflictsPressed(control) {
    const result = getSkipConflicts();
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] GetSkipConflictsPressed: ${result}`);
    return result;
}
/**
 * 当"跳过冲突"复选框被点击时，保存状态
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- WPS Ribbon 控件无 @types
export function OnSkipConflictsChange(control) {
    const newValue = control.Pressed;
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] OnSkipConflictsChange: control.Pressed = ${newValue}`);
    // 如果 control.Pressed 是 undefined，则切换当前状态
    let finalValue;
    if (typeof newValue === 'boolean') {
        finalValue = newValue;
    }
    else {
        finalValue = !getSkipConflicts();
        bgmLog(LOG_LEVELS.INFO, `[Ribbon] control.Pressed 不可用，切换状态为: ${finalValue}`);
    }
    // 保存到 PluginStorage
    setSkipConflicts(finalValue);
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] 跳过冲突状态已保存到 PluginStorage: ${finalValue}`);
    return true; // 必须返回 boolean
}
/**
 * 获取增量同步复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- WPS Ribbon 控件无 @types
export function GetIncrementalSyncPressed(control) {
    const result = getIncrementalSync();
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] GetIncrementalSyncPressed: ${result}`);
    return result;
}
/**
 * 当增量同步复选框被点击时，保存状态
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- WPS Ribbon 控件无 @types
export function OnIncrementalSyncChange(control) {
    const newValue = control.Pressed;
    let finalValue;
    if (typeof newValue === 'boolean') {
        finalValue = newValue;
    }
    else {
        finalValue = !getIncrementalSync();
        bgmLog(LOG_LEVELS.INFO, `[Ribbon] control.Pressed 不可用，切换状态为: ${finalValue}`);
    }
    setIncrementalSync(finalValue);
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] 增量同步状态已保存到 PluginStorage: ${finalValue}`);
    return true;
}
// ========== Ribbon 回调 ==========
export function OnAddinLoad(ribbonUI) {
    const app = getApp();
    if (!app)
        return true;
    if (typeof app.ribbonUI !== 'object') {
        app.ribbonUI = ribbonUI;
    }
    if (typeof app.Enum !== 'object') {
        app.Enum = WPS_ENUM;
    }
    app.PluginStorage?.setItem('EnableFlag', false);
    app.PluginStorage?.setItem('ApiEventFlag', false);
    return true;
}
/**
 * 统一的 Ribbon 按钮点击处理函数
 * 根据按钮 ID 分发到具体的处理函数
 */
export function OnAction(control) {
    bgmLog(LOG_LEVELS.INFO, `[BGM] OnAction: ${control.Id}`);
    try {
        switch (control.Id) {
            case 'btnShowPanel':
                showBangumiPanel();
                break;
            case 'btnSyncBangumi': {
                // syncWithConfirmation 是 async 函数，需要 .catch() 防止未处理的 Promise rejection
                RibbonService.syncWithConfirmation().catch((e) => {
                    bgmLog(LOG_LEVELS.ERROR, `[OnAction] syncWithConfirmation 异常: ${e?.message || String(e)}`);
                    BGM.handleError(e, { showAlert: true, level: BGM.ErrorLevel.ERROR, context: 'Ribbon btnSyncBangumi' });
                });
                break;
            }
            case 'btnSetToken':
                RibbonService.setTokenForRibbon();
                break;
            case 'btnTestToken':
                RibbonService.testTokenForRibbon();
                break;
            case 'btnSetUserId':
                RibbonService.setUserIdForRibbon();
                break;
            case 'btnOpenCollection':
                RibbonService.openCollectionForRibbon();
                break;
            default:
                bgmLog(LOG_LEVELS.WARN, `[BGM] 未知按钮: ${control.Id}`);
        }
    }
    catch (e) {
        BGM.handleError(e, { showAlert: true, level: BGM.ErrorLevel.ERROR, context: 'Ribbon OnAction' });
    }
    return true;
}
/**
* 获取按钮图标（占位函数，实际图标由 CSS 或图片提供）
*/
export function GetBangumiImage(control) {
    const icons = {
        btnShowPanel: 'images/panel.svg',
        btnSyncBangumi: 'images/sync.svg',
        btnSetToken: 'images/token.svg',
        btnTestToken: 'images/key.svg',
        btnSetUserId: 'images/user.svg',
        btnOpenCollection: 'images/link.svg',
        btnClearColors: 'images/cleartags.svg',
    };
    return icons[control.Id] || 'images/newFromTemp.svg';
}
// 通知 index.html 早期占位：真实实现已就绪
const ribbonWindow = window;
ribbonWindow._bgmRibbonReady?.(OnAddinLoad, OnAction, GetBangumiImage);
// 挂载 Ribbon 复选框回调到全局（WPS Ribbon XML 只能调用 window 上的函数）
ribbonWindow.GetIncrementalSyncPressed = GetIncrementalSyncPressed;
ribbonWindow.GetSkipConflictsPressed = GetSkipConflictsPressed;
ribbonWindow.OnIncrementalSyncChange = OnIncrementalSyncChange;
ribbonWindow.OnSkipConflictsChange = OnSkipConflictsChange;
