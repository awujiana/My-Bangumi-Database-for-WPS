/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */

import { WPS_ENUM, showBangumiPanel,BGM, getIncrementalSync, getSkipConflicts, setIncrementalSync, setSkipConflicts } from './index.js';
import * as RibbonService from './services/ribbonService.js';


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
export function OnSkipConflictsChange(control: any) {
    setSkipConflicts(control.Pressed);
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
export function OnIncrementalSyncChange(control: any) {
    setIncrementalSync(control.Pressed);
}

/**
 * 统一的 Ribbon 按钮点击处理函数
 * 根据按钮 ID 分发到具体的处理函数
 */
export function OnAction(control: any) {
    const buttonId = control?.Id || control?.id;
    console.log(`[BGM] Ribbon 按钮点击: ${buttonId}`);

    try {
        switch (buttonId) {
            case 'btnShowPanel':
                showBangumiPanel();
                break;

            case 'btnSyncBangumi':
                RibbonService.syncWithConfirmation();
                break;

            case 'btnSetToken':
                RibbonService.setUserIdForRibbon();
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
                console.warn(`[BGM] 未知的 Ribbon 按钮 ID: ${buttonId}`);
                break;
        }
    } catch (error) {
        console.error(`[BGM] 处理 Ribbon 按钮 ${buttonId} 时出错:`, error);
    }
}

/**
 * 获取按钮图标（占位函数，实际图标由 CSS 或图片提供）
 */
export function GetBangumiImage(control: any) {
    return '';
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

// ========== 全局函数挂载 ==========
// 将 Ribbon 回调函数挂载到全局作用域，使其可以被 ribbon.xml 引用

if (typeof window !== 'undefined') {
    (window as any).GetSkipConflictsPressed = GetSkipConflictsPressed;
    (window as any).OnSkipConflictsChange = OnSkipConflictsChange;
    (window as any).GetIncrementalSyncPressed = GetIncrementalSyncPressed;
    (window as any).OnIncrementalSyncChange = OnIncrementalSyncChange;
    (window as any).OnAddinLoad = OnAddinLoad;
    (window as any).OnAction = OnAction;
    (window as any).GetBangumiImage = GetBangumiImage;

    console.log('[BGM] Ribbon 回调函数已挂载到全局作用域');
}
