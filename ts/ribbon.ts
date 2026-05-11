/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */

import { WPS_ENUM, showBangumiPanel } from './index.js';
import * as RibbonService from './services/ribbonService.js';




/**
 * 获取“跳过冲突”复选框的初始按下状态
 * 从 PluginStorage 读取上次保存的设置，默认未选中
 */
export function GetSkipConflictsPressed(control: any): boolean {
    const app = (window as any).Application;
    if (app?.PluginStorage) {
        const saved = app.PluginStorage.getItem('bgm_skip_conflicts');
        return saved === 'true';
    }
    return false;
}

/**
 * 当“跳过冲突”复选框被点击时，保存状态
 */
export function OnSkipConflictsChange(control: any) {
    const app = (window as any).Application;
    if (app?.PluginStorage) {
        app.PluginStorage.setItem('bgm_skip_conflicts', control.Pressed ? 'true' : 'false');
    }
}
export function GetIncrementalSyncPressed(control: any): boolean {
    const app = (window as any).Application;
    if (app?.PluginStorage) {
        return app.PluginStorage.getItem('bgm_incremental_sync') === 'true';
    }
    return false;
}

export function OnIncrementalSyncChange(control: any) {
    const app = (window as any).Application;
    app?.PluginStorage?.setItem('bgm_incremental_sync', control.Pressed ? 'true' : 'false');
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
            case 'btnClearColors':
                RibbonService.clearColorsForRibbon();
                break;
            default:
                console.warn('[BGM] 未知按钮:', control.Id);
        }
    } catch (e: any) {
        console.error('[BGM] OnAction error:', e);
        alert('操作失败: ' + e.message);
    }
    return true;
}

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