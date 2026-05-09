/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */

import {findHeaderRow, getColumnMap, getLastRow, openUserCollection,SyncToBangumiAsync, clearRowColors, testTokenValidityForRibbon,loadBgToken, storeBgToken, _setBgmUserId,showBangumiPanel,  WPS_ENUM,getDataSheet,BGM } from './index.js';

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
 * 通知任务窗格面板刷新状态
 */
function notifyTaskpane(method: string): void {
    const app = (window as any).Application;
    const taskPaneId = app?.PluginStorage?.getItem('taskpane_id');
    if (taskPaneId) {
        try {
            const taskPane = app.GetTaskPane(taskPaneId);
            if (taskPane?.Visible && taskPane?.WebBrowser?.ExecScript) {
                taskPane.WebBrowser.ExecScript(`if(typeof ${method}==='function')${method}()`);
            }
        } catch (e) {
            // 面板未打开或不支持，忽略
        }
    }
}


export function OnAction(control: { Id: string }): boolean {
    console.log('[BGM] OnAction:', control.Id);
    try {
        switch (control.Id) {
            case 'btnShowPanel':
                showBangumiPanel();
                break;
            case 'btnSyncBangumi':
                    (async () => {
                        const app = (window as any).Application;
                        if (!app?.ActiveWorkbook) {
                            app?.MessageBox?.('请先打开一个 Excel 工作簿', 0, 64);
                            return;
                        }
                        const ws = getDataSheet();
                        if (!ws) {
                            app?.MessageBox?.('未找到数据工作表，请先锁定一个工作表', 0, 64);
                            return;
                        }
                        const token = loadBgToken();
                        if (!token) {
                            app?.MessageBox?.('请先设置 Bangumi Token', 0, 48);
                            return;
                        }
                        const headerRow = findHeaderRow(ws);
                        const lastRow = getLastRow(ws);
                        const colMap = getColumnMap(ws, headerRow);
                        if (!colMap.has("Bangumi_URL")) {
                            app?.MessageBox?.('未找到 Bangumi URL 列', 0, 48);
                            return;
                        }
                    
                        try {
                            const result = await SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, {
                                onProgress: (current, total, message) => {
                                    if (app.StatusBar !== undefined) {
                                        app.StatusBar = `[${current}/${total}] ${message}`;
                                    }
                                }
                            });
                            app.StatusBar = false;
                            app?.MessageBox?.(
                                `同步完成！\n成功: ${result.success} 条\n失败: ${result.fail} 条\n跳过: ${result.skip}              条`,
                                0, 64
                            );
                        } catch (err: any) {
                            app.StatusBar = false;
                            BGM.handleError(err, { context: 'Ribbon同步', showAlert: true });
                        }
                    })();
            break;
            case 'btnSetToken': {
                  const currentToken = loadBgToken() || '';
                  const app = (window as any).Application;
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
                          } else {
                              alert('Token 保存失败，请检查插件存储权限');
                          }
                      }
                  } else {
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
                    } else {
                        alert('请先设置 Token！');
                    }
                    break;
                }
            case 'btnSetUserId': {
                    const app = (window as any).Application;
                    if (app?.InputBox) {
                        const userId = app.InputBox('请输入用户 ID（数字）', '设置用户 ID', '', 2);
                        if (userId && userId !== false) {
                            _setBgmUserId(String(userId).trim());
                            alert('用户 ID 已保存');
                            notifyTaskpane('updateUserIdStatus');        // 通知面板更新
                        }
                    } else {
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