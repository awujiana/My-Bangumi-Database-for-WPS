/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */
import { WPS_ENUM, loadBgToken, storeBgToken, showBangumiPanel, findHeaderRow, getColumnMap, getLastRow, getDataSheet, SyncToBangumiAsync, clearRowColors, testTokenValidityForRibbon, openUserCollection, BGM } from './index.js';
import { getSyncPreviewtoRibbon } from './sync/exceltobangumi.js';
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
            case 'btnSyncBangumi': {
                const app = window.Application;
                if (!app?.ActiveWorkbook) {
                    app?.MessageBox?.('请先打开一个 Excel 工作簿', 0, 64);
                    break;
                }
                const ws = getDataSheet();
                if (!ws) {
                    app?.MessageBox?.('未找到数据工作表，请先锁定一个工作表', 0, 64);
                    break;
                }
                const token = loadBgToken();
                if (!token) {
                    app?.MessageBox?.('请先设置 Bangumi Token', 0, 48);
                    break;
                }
                const headerRow = findHeaderRow(ws) || 1;
                const lastRow = getLastRow(ws);
                const colMap = getColumnMap(ws, headerRow);
                if (!colMap.has("Bangumi_URL")) {
                    app?.MessageBox?.('未找到 Bangumi URL 列', 0, 48);
                    break;
                }
                // ---------- 新增：获取预览统计 ----------
                const preview = getSyncPreviewtoRibbon(ws, colMap, lastRow, headerRow);
                const previewMsg = `数据预览：\n` +
                    `总行数：${preview.total}\n` +
                    `有效条目：${preview.valid}\n` +
                    `已上传（跳过）：${preview.alreadyUploaded}\n` +
                    `待同步：${preview.willSync}\n` +
                    `不上传（状态跳过）：${preview.willSkip}\n` +
                    `无效（无SID）：${preview.total - preview.valid}\n\n` +
                    `是否继续同步？`;
                const confirmResult = app?.MessageBox?.(previewMsg, 4 + 32); // Yes/No + 问号图标
                if (confirmResult !== 6)
                    break; // 6 = Yes
                // 执行实际同步（异步）
                (async () => {
                    try {
                        const result = await SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, {
                            onProgress: (current, total, message) => {
                                if (app.StatusBar !== undefined) {
                                    app.StatusBar = `[${current}/${total}] ${message}`;
                                }
                            }
                        });
                        app.StatusBar = false;
                        app?.MessageBox?.(`同步完成！\n成功: ${result.success} 条\n失败: ${result.fail} 条\n跳过: ${result.skip} 条`, 0, 64);
                    }
                    catch (err) {
                        app.StatusBar = false;
                        BGM.handleError(err, { context: 'Ribbon同步', showAlert: true });
                    }
                })();
                break;
            }
            case 'btnSetToken': {
                const currentToken = loadBgToken() || '';
                const app = window.Application;
                if (app?.InputBox) {
                    const newToken = app.InputBox('请输入 Access Token', '设置 Token', currentToken, 2);
                    if (newToken && newToken !== false && typeof newToken === 'string') {
                        const saved = storeBgToken(newToken);
                        if (saved) {
                            // 使用新的状态变更方法通知面板更新
                            BGM.notifyTokenUpdated();
                            if (typeof testTokenValidityForRibbon === 'function') {
                                testTokenValidityForRibbon(newToken);
                            }
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
                    // 验证完成后更新面板状态
                    setTimeout(() => BGM.notifyTokenUpdated(), 500);
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
                        // 使用新的状态变更方法，内部自动持久化并通知面板
                        BGM.setUserId(String(userId).trim());
                        alert('用户 ID 已保存');
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
