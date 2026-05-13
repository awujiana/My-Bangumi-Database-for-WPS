/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */

import { WPS_ENUM, showBangumiPanel,BGM, getIncrementalSync, getSkipConflicts, setIncrementalSync, setSkipConflicts,listenToRibbonConfigUpdates } from './index.js';
import * as RibbonService from './services/ribbonService.js';

// 启动时接收来自侧边栏的配置更新
listenToRibbonConfigUpdates((data) => {
    console.log(`[Ribbon] 配置更新: ${data.key} = ${data.value}`);
    // 如果 Ribbon 有 UI 控件，可刷新状态，例如复选框的 Pressed 状态
    const ribbonUI = (window as any).Application?.ribbonUI;
    if (ribbonUI) {
        ribbonUI.InvalidateControl('chkIncrementalSync');  // 使按钮刷新
        ribbonUI.InvalidateControl('chkSkipConflicts');
    }
});
/**
 * 获取"跳过冲突"复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetSkipConflictsPressed(control: any): boolean {
    return getSkipConflicts();
}

/**
 * 当"跳过冲突"复选框被点击时，保存状态
 */
export function OnSkipConflictsChange(control: any): boolean {
    setSkipConflicts(control.Pressed);
    return true;  // 必须返回 boolean
}

/**
 * 获取增量同步复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetIncrementalSyncPressed(control: any): boolean {
    return getIncrementalSync();
}

/**
 * 当增量同步复选框被点击时，保存状态
 */
export function OnIncrementalSyncChange(control: any): boolean {
    setIncrementalSync(control.Pressed);
    return true;  // 必须返回 boolean，否则 WPS 警告
}



// ========== Ribbon 回调 ==========

export function OnAddinLoad(ribbonUI: any): boolean {
    if (typeof (window as any).Application.ribbonUI !== 'object') {
        (window as any).Application.ribbonUI = ribbonUI;
    }
    if (typeof (window as any).Application.Enum !== 'object') {
        (window as any).Application.Enum = WPS_ENUM;
    }
    (window as any).Application.PluginStorage.setItem('EnableFlag', false);
    (window as any).Application.PluginStorage.setItem('ApiEventFlag', false);
    return true;
}



/**
 * 统一的 Ribbon 按钮点击处理函数
 * 根据按钮 ID 分发到具体的处理函数
 */

export function OnAction(control: { Id: string }): boolean {
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
                        } catch (e: any) {
                            BGM.handleError(e, { showAlert: true, level: BGM.ErrorLevel.ERROR, context: 'Ribbon OnAction' });
                        }
                        return true;
                    }
                    /**
 * 获取按钮图标（占位函数，实际图标由 CSS 或图片提供）
 */

                    export function GetBangumiImage(control: { Id: string }): string {
                        const icons: Record<string, string> = {
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
                    (window as any)._bgmRibbonReady?.(OnAddinLoad, OnAction, GetBangumiImage);
                    // 挂载 Ribbon 复选框回调到全局（WPS Ribbon XML 只能调用 window 上的函数）
                    (window as any).GetIncrementalSyncPressed = GetIncrementalSyncPressed;
(window as any).GetSkipConflictsPressed = GetSkipConflictsPressed;
(window as any).OnIncrementalSyncChange = OnIncrementalSyncChange;
(window as any).OnSkipConflictsChange = OnSkipConflictsChange;
