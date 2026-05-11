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
export function GetSkipConflictsPressed(control) {
    const app = window.Application;
    if (app?.PluginStorage) {
        const saved = app.PluginStorage.getItem('bgm_skip_conflicts');
        return saved === 'true';
    }
    return false;
}
/**
 * 当“跳过冲突”复选框被点击时，保存状态
 */
export function OnSkipConflictsChange(control) {
    const app = window.Application;
    if (app?.PluginStorage) {
        app.PluginStorage.setItem('bgm_skip_conflicts', control.Pressed ? 'true' : 'false');
    }
}
export function GetIncrementalSyncPressed(control) {
    const app = window.Application;
    if (app?.PluginStorage) {
        return app.PluginStorage.getItem('bgm_incremental_sync') === 'true';
    }
    return false;
}
export function OnIncrementalSyncChange(control) {
    const app = window.Application;
    app?.PluginStorage?.setItem('bgm_incremental_sync', control.Pressed ? 'true' : 'false');
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
