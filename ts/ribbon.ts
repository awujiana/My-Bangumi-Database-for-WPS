/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */

import { WPS_ENUM } from './core/constants.js';
import { loadBgToken, showBangumiPanel } from './tools/util.js';
import { SyncToBangumi, clearRowColors, testTokenValidityForRibbon } from './sync/exceltobangumi.js';
import { openUserCollection, showTokenDialog, showUserIdDialog } from './ui/handlers.js';

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
                SyncToBangumi?.();
                break;
            case 'btnSetToken':
                showTokenDialog(loadBgToken() || '');
                break;
            case 'btnTestToken': {
                const token = loadBgToken();
                if (token) testTokenValidityForRibbon(token);
                else console.warn('[BGM] 没有 Token，无法测试');
                break;
            }
            case 'btnSetUserId':
                showUserIdDialog();
                break;
            case 'btnOpenCollection':
                openUserCollection();
                break;
            case 'btnClearColors':
                clearRowColors?.();
                break;
            default:
                console.warn('[BGM] 未知按钮:', control.Id);
        }
    } catch (e) {
        console.error('[BGM] OnAction error:', e);
    }
    return true;
}

export function GetBangumiImage(control: { Id: string }): string {
    const icons: Record<string, string> = {
        btnShowPanel: 'images/panel.svg',
        btnSyncBangumi:'images/sync.svg',
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