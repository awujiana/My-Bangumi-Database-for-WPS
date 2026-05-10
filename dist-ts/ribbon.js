/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */
import { WPS_ENUM, showBangumiPanel } from './index.js';
import * as RibbonService from './services/ribbonService.js';
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
            case 'btnClearColors':
                RibbonService.clearColorsForRibbon();
                break;
            default:
                console.warn('[BGM] 未知按钮:', control.Id);
        }
    }
    catch (e) {
        console.error('[BGM] OnAction error:', e);
        alert('操作失败: ' + e.message);
    }
    return true;
}
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
