/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */
import { WPS_ENUM, showBangumiPanel, BGM, getIncrementalSync, getSkipConflicts, setIncrementalSync, setSkipConflicts, listenToRibbonConfigUpdates } from './index.js';
import * as RibbonService from './services/ribbonService.js';
// 启动时接收来自侧边栏的配置更新
listenToRibbonConfigUpdates((data) => {
    console.log(`[Ribbon] ========== 收到配置更新通知 ==========`);
    console.log(`[Ribbon] 配置键: ${data.key}`);
    console.log(`[Ribbon] 新值: ${data.value}`);
    console.log(`[Ribbon] 尝试刷新 Ribbon UI...`);
    const ribbonUI = window.Application?.ribbonUI;
    if (ribbonUI) {
        console.log(`[Ribbon] ribbonUI 可用，刷新控件状态`);
        ribbonUI.InvalidateControl('chkIncrementalSync');
        ribbonUI.InvalidateControl('chkSkipConflicts');
        console.log(`[Ribbon] 控件状态已刷新`);
    }
    else {
        console.warn(`[Ribbon] ribbonUI 不可用，无法刷新控件状态`);
    }
});
/**
 * 获取"跳过冲突"复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetSkipConflictsPressed(control) {
    const result = getSkipConflicts();
    console.log(`[Ribbon] GetSkipConflictsPressed: ${result}`);
    return result;
}
/**
 * 当"跳过冲突"复选框被点击时，保存状态
 */
export function OnSkipConflictsChange(control) {
    const newValue = control.Pressed;
    console.log(`[Ribbon] OnSkipConflictsChange: ${newValue}`);
    setSkipConflicts(newValue);
    console.log(`[Ribbon] 跳过冲突状态已保存到 PluginStorage`);
    return true;
}
/**
 * 获取增量同步复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetIncrementalSyncPressed(control) {
    const result = getIncrementalSync();
    console.log(`[Ribbon] GetIncrementalSyncPressed: ${result}`);
    return result;
}
/**
 * 当增量同步复选框被点击时，保存状态
 */
export function OnIncrementalSyncChange(control) {
    const newValue = control.Pressed;
    console.log(`[Ribbon] OnIncrementalSyncChange: ${newValue}`);
    setIncrementalSync(newValue);
    console.log(`[Ribbon] 增量同步状态已保存到 PluginStorage`);
    return true;
}
// ========== Ribbon 回调 ==========
export function OnAddinLoad(ribbonUI) {
    if (typeof window.Application.ribbonUI !== 'object') {
        window.Application.ribbonUI = ribbonUI;
    }
    if (typeof window.Application.Enum !== 'object') {
        window.Application.Enum = WPS_ENUM;
    }
    window.Application.PluginStorage.setItem('EnableFlag', false);
    window.Application.PluginStorage.setItem('ApiEventFlag', false);
    return true;
}
/**
 * 统一的 Ribbon 按钮点击处理函数
 * 根据按钮 ID 分发到具体的处理函数
 */
export function OnAction(control) {
    console.log('[BGM] OnAction:', control.Id);
    try {
        switch (control.Id) {
            case 'btnShowPanel':
                showBangumiPanel();
                break;
            case 'btnSyncBangumi':
                RibbonService.syncWithConfirmation();
                break;
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
                console.warn('[BGM] 未知按钮:', control.Id);
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
window._bgmRibbonReady?.(OnAddinLoad, OnAction, GetBangumiImage);
// 挂载 Ribbon 复选框回调到全局（WPS Ribbon XML 只能调用 window 上的函数）
window.GetIncrementalSyncPressed = GetIncrementalSyncPressed;
window.GetSkipConflictsPressed = GetSkipConflictsPressed;
window.OnIncrementalSyncChange = OnIncrementalSyncChange;
window.OnSkipConflictsChange = OnSkipConflictsChange;
