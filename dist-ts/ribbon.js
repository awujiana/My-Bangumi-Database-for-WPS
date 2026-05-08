/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */
import { WPS_ENUM } from './core/constants.js';
import { loadBgToken, storeBgToken, _setBgmUserId, showBangumiPanel } from './tools/util.js';
import { SyncToBangumi, clearRowColors, testTokenValidityForRibbon } from './sync/exceltobangumi.js';
import { openUserCollection } from './ui/handlers.js';
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
 * 通知任务窗格面板刷新状态
 */
function notifyTaskpane(method) {
    const app = window.Application;
    const taskPaneId = app?.PluginStorage?.getItem('taskpane_id');
    if (taskPaneId) {
        try {
            const taskPane = app.GetTaskPane(taskPaneId);
            if (taskPane?.Visible && taskPane?.WebBrowser?.ExecScript) {
                taskPane.WebBrowser.ExecScript(`if(typeof ${method}==='function')${method}()`);
            }
        }
        catch (e) {
            // 面板未打开或不支持，忽略
        }
    }
}
export function OnAction(control) {
    console.log('[BGM] OnAction:', control.Id);
    try {
        switch (control.Id) {
            case 'btnShowPanel':
                showBangumiPanel();
                break;
            case 'btnSyncBangumi':
                SyncToBangumi?.();
                break;
            case 'btnSetToken': {
                const currentToken = loadBgToken() || '';
                const app = window.Application;
                if (app?.InputBox) {
                    const newToken = app.InputBox('请输入 Access Token', '设置 Token', currentToken, 2);
                    if (newToken && newToken !== false && typeof newToken === 'string') {
                        const saved = storeBgToken(newToken);
                        if (saved) {
                            // 使用运行时检查确保函数存在，避免 TS2774 警告
                            if (typeof testTokenValidityForRibbon === 'function') {
                                testTokenValidityForRibbon(newToken);
                            }
                            notifyTaskpane('updateTokenStatus');
                            alert('Token 已保存，已自动验证');
                        }
                        else {
                            alert('Token 保存失败，请检查插件存储权限');
                        }
                    }
                }
                else {
                    console.warn('无法使用 WPS InputBox，设置 Token 功能不可用');
                }
                break;
            }
            case 'btnTestToken': {
                const token = loadBgToken();
                if (token) {
                    testTokenValidityForRibbon(token);
                    // 验证完成后更新面板（不管成功失败，状态可能变化）
                    setTimeout(() => notifyTaskpane('updateTokenStatus'), 500);
                }
                else {
                    alert('请先设置 Token！');
                }
                break;
            }
            case 'btnSetUserId': {
                const app = window.Application;
                if (app?.InputBox) {
                    const userId = app.InputBox('请输入用户 ID（数字）', '设置用户 ID', '', 2);
                    if (userId && userId !== false) {
                        _setBgmUserId(String(userId).trim());
                        alert('用户 ID 已保存');
                        notifyTaskpane('updateUserIdStatus'); // 通知面板更新
                    }
                }
                else {
                    console.warn('无法使用 WPS InputBox，设置用户 ID 功能不可用');
                }
                break;
            }
            case 'btnOpenCollection':
                openUserCollection();
                break;
            case 'btnClearColors':
                clearRowColors?.();
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
