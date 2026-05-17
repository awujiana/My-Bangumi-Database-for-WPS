/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */

import { WPS_ENUM, showBangumiPanel, BGM, getIncrementalSync, getSkipConflicts, setIncrementalSync, setSkipConflicts, bgmLog, LOG_LEVELS, getApp } from './index.js';
import * as RibbonService from './services/ribbonService.js';

// 在 Ribbon 启动时（例如 OnAddinLoad 中或文件顶部立即执行）
// 【正确】监听侧边栏发来的配置更新，刷新 Ribbon UI
function initRibbonMessageListener(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (data?.type === 'BGM:configUpdated') {
            const key = data.data?.key;
            if (key === 'bgm_skip_conflicts' || key === 'bgm_incremental_sync') {
                const ribbonUI = (window as any).Application?.ribbonUI;
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
export function GetSkipConflictsPressed(control: any): boolean {
    const result = getSkipConflicts();
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] GetSkipConflictsPressed: ${result}`);
    return result;
}

/**
 * 当"跳过冲突"复选框被点击时，保存状态
 */
export function OnSkipConflictsChange(control: any): boolean {
    const newValue = control.Pressed;
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] OnSkipConflictsChange: control.Pressed = ${newValue}`);
    
    // 如果 control.Pressed 是 undefined，则切换当前状态
    let finalValue: boolean;
    if (typeof newValue === 'boolean') {
        finalValue = newValue;
    } else {
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
export function GetIncrementalSyncPressed(control: any): boolean {
    const result = getIncrementalSync();
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] GetIncrementalSyncPressed: ${result}`);
    return result;
}

/**
 * 当增量同步复选框被点击时，保存状态
 */
export function OnIncrementalSyncChange(control: any): boolean {
    const newValue = control.Pressed;
    let finalValue: boolean;
    if (typeof newValue === 'boolean') {
        finalValue = newValue;
    } else {
        finalValue = !getIncrementalSync();
        bgmLog(LOG_LEVELS.INFO, `[Ribbon] control.Pressed 不可用，切换状态为: ${finalValue}`);
    }
    setIncrementalSync(finalValue);
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] 增量同步状态已保存到 PluginStorage: ${finalValue}`);
    return true;
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
    bgmLog(LOG_LEVELS.INFO, `[BGM] OnAction: ${control.Id}`);
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
                                bgmLog(LOG_LEVELS.WARN, `[BGM] 未知按钮: ${control.Id}`);
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
