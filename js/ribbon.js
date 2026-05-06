/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */

// 导入工具函数
import { WPS_Enum } from './util.js';
import { getApp, loadBgToken, showBangumiPanel } from './util.js';
import { SyncToBangumi, clearRowColors, testTokenValidityForRibbon } from './sync/exceltobangumi.js';
import { openUserCollection } from './ui/handlers.js';
import { showTokenDialog, showUserIdDialog } from './ui/handlers.js';

// ========== Ribbon 回调 ==========

/**
 * 加载项初始化回调
 * @param {object} ribbonUI - Ribbon UI 对象
 */
export function OnAddinLoad(ribbonUI) {
    if (typeof (window.Application.ribbonUI) != "object") {
        window.Application.ribbonUI = ribbonUI;
    }
    
    if (typeof (window.Application.Enum) != "object") {
        window.Application.Enum = WPS_Enum;
    }

    window.Application.PluginStorage.setItem("EnableFlag", false);
    window.Application.PluginStorage.setItem("ApiEventFlag", false);
    return true;
}

/**
 * Ribbon 按钮点击处理
 * @param {object} control - 按钮控件
 */
export function OnAction(control) {
    console.log("OnAction called with:", control.Id);
    const eleId = control.Id;
    try {
        switch (eleId) {
            case "btnShowPanel":
                showBangumiPanel();
                break;
            case "btnSyncBangumi":
                if (typeof SyncToBangumi === 'function') {
                    SyncToBangumi();
                }
                break;
            case "btnSetToken":
                if (typeof showTokenDialog === 'function') {
                    showTokenDialog(loadBgToken());
                }
                break;
            case "btnTestToken":
                if (typeof testTokenValidityForRibbon === 'function') {
                    testTokenValidityForRibbon(loadBgToken());
                }
                break;
            case "btnSetUserId":
                if (typeof showUserIdDialog === 'function') {
                    showUserIdDialog();
                }
                break;
            case "btnOpenCollection":
                if (typeof openUserCollection === 'function') {
                    openUserCollection();
                }
                break;
            case "btnClearColors":
                if (typeof clearRowColors === 'function') {
                    clearRowColors();
                }
                break;
            default:
                break;
        }
    } catch (e) {
        console.error("OnAction error:", e);
        if (typeof showDialogRibbon === 'function') {
            showDialogRibbon("\u6267\u884C\u51FA\u9519", e.message);
        }
    }
    return true;
}

/**
 * 获取按钮图标
 * @param {object} control - 按钮控件
 */
export function GetBangumiImage(control) {
    const id = control.Id;
    switch (id) {
        case "btnShowPanel":     return "images/panel.svg";
        case "btnSyncBangumi":   return "images/sync.svg";
        case "btnSetToken":      return "images/key.svg";
        case "btnTestToken":     return "images/key.svg";  // 使用 key 图标
        case "btnSetUserId":     return "images/user.svg";
        case "btnOpenCollection": return "images/link.svg";
        case "btnClearColors":   return "images/delete.svg";
        default:                return "images/newFromTemp.svg";
    }
}

// ========== 向后兼容别名 ==========

function showDialogRibbon(title, message) {
    if (typeof BGM !== 'undefined' && BGM.showDialog) {
        BGM.showDialog(title, message);
    } else if (typeof window.BGMAlert === 'function') {
        window.BGMAlert(message, title);
    } else {
        window.alert(message);
    }
}

// 挂载到 window（向后兼容）
window.OnAddinLoad = OnAddinLoad;
window.OnAction = OnAction;
window.GetBangumiImage = GetBangumiImage;
window.showDialogRibbon = showDialogRibbon;
