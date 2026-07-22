/**
 * Excel→Bangumi 同步模块 - API 请求层
 * @module sync/exceltobangumi/api
 * @description Bangumi API 请求封装、Token 测试、用户信息通知等。
 */
import { BGM_CONFIG, LOG_LEVELS, bgmLog, getApp, loadBgToken, storeBgToken, _setBgmUserId, _setBgmUsername, BGM, } from '../../index.js';
import { showAlert, showSuccess, showError, } from '../../ui/dialog.js';
/**
 * 提取HTTP请求结果消息
 */
export function extractResponseMessage(data) {
    if (data && typeof data === 'object') {
        const d = data;
        return d.msg || d.message || d.error || d.description || 'success';
    }
    return 'success';
}
/**
 * 处理请求错误响应
 */
export function parseErrorResponse(xhr) {
    try {
        const errData = JSON.parse(xhr.responseText);
        return errData.error || errData.description || `HTTP ${xhr.status}`;
    }
    catch {
        return xhr.statusText || `HTTP ${xhr.status}`;
    }
}
/**
 * 打开Bangumi Token申请页面
 *
 * @function openBangumiTokenPage
 */
export function openBangumiTokenPage() {
    // 使用统一的 getApp() 获取 WPS Application 对象，避免直接访问 window.Application
    const app = getApp();
    if (app?.OAAssist?.ShellExecute) {
        app.OAAssist.ShellExecute('https://next.bgm.tv/demo/access-token');
    }
    else {
        window.open('https://next.bgm.tv/demo/access-token', '_blank');
    }
}
/**
 * 测试Token有效性（Ribbon版本）
 *
 * @function testTokenValidityForRibbon
 * @param {string} [token] - 要测试的Token，不提供则自动加载
 * @param {AbortSignal} [signal] - 可选 AbortSignal，用于取消请求
 */
export function testTokenValidityForRibbon(token, signal) {
    const testToken = token || loadBgToken();
    if (!testToken) {
        showAlert('请先设置 Token！', '提示');
        return;
    }
    // 如果 signal 已 aborted，立即返回
    if (signal?.aborted) {
        bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 请求被取消（signal 已 aborted）`);
        return;
    }
    const apiUrl = `${BGM_CONFIG.API_BASE}/v0/me`;
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] ========== 开始测试 Token ==========`);
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] API 路由: ${apiUrl}`);
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 请求方法: GET`);
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 请求头: Authorization: Bearer ${testToken.substring(0, 8)}...`);
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 请求头: Content-Type: application/json`);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', apiUrl, true);
    xhr.timeout = 30000;
    xhr.setRequestHeader('Authorization', 'Bearer ' + testToken);
    xhr.setRequestHeader('Content-Type', 'application/json');
    // AbortSignal 支持：监听 abort 事件触发 xhr.abort()
    if (signal) {
        signal.addEventListener('abort', () => {
            xhr.abort();
        });
    }
    xhr.onload = () => {
        const duration = Date.now() - startTime;
        bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] ========== 请求完成 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] HTTP 状态码: ${xhr.status} (${xhr.statusText})`);
        bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 请求耗时: ${duration}ms`);
        if (xhr.getAllResponseHeaders()) {
            bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 响应头: ${xhr.getAllResponseHeaders()}`);
        }
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 响应数据: ${JSON.stringify(data).length > 300 ? JSON.stringify(data).substring(0, 300) + '...' : JSON.stringify(data)}`);
                const nickname = data.nickname || data.username || '未知用户';
                const userId = String(data.id || '未知ID');
                bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] Token 验证成功！用户名: ${nickname}, 用户ID: ${userId}`);
                showSuccess(`Token有效！\n\n用户名: ${nickname}\n用户ID: ${userId}`, '验证成功');
                notifyUserInfoUpdated(nickname, userId);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.ERROR, `[exceltobangumi/testTokenValidityForRibbon] 解析响应失败: ${e instanceof Error ? e.message : String(e)}`);
                BGM.handleError(e, { context: 'testTokenValidityForRibbon', showAlert: false });
                showError('Token有效，但解析响应失败', '错误');
            }
        }
        else if (xhr.status === 401) {
            bgmLog(LOG_LEVELS.WARN, `[exceltobangumi/testTokenValidityForRibbon] Token 无效或已过期`);
            showError('Token无效或已过期，请重新获取', '验证失败');
        }
        else {
            bgmLog(LOG_LEVELS.ERROR, `[exceltobangumi/testTokenValidityForRibbon] Token验证失败，HTTP 状态码: ${xhr.status}`);
            bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 响应内容: ${xhr.responseText}`);
            showError(`Token验证失败 (HTTP ${xhr.status})`, '错误');
        }
    };
    xhr.onerror = () => {
        const duration = Date.now() - startTime;
        bgmLog(LOG_LEVELS.ERROR, `[exceltobangumi/testTokenValidityForRibbon] 网络错误，耗时: ${duration}ms`);
        showError('网络错误，无法连接到 Bangumi API\n\n可能原因：\n• 网络被墙（GFW）\n• 断网或 DNS 失败\n• API 服务器不可达\n\nToken 本身可能有效，请在网络恢复后重试', '网络错误');
    };
    xhr.ontimeout = () => {
        const duration = Date.now() - startTime;
        bgmLog(LOG_LEVELS.WARN, `[exceltobangumi/testTokenValidityForRibbon] 请求超时，耗时: ${duration}ms`);
        showError('请求超时（30s）\n\n可能网络受限或被墙，Token 本身可能有效', '超时');
    };
    bgmLog(LOG_LEVELS.INFO, `[exceltobangumi/testTokenValidityForRibbon] 正在发送请求...`);
    xhr.send();
}
/**
 * 通知面板用户信息已更新
 */
export function notifyUserInfoUpdated(username, userId) {
    try {
        bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated] 开始通知用户信息更新:`);
        bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated]   用户名: ${username}`);
        bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated]   用户ID: ${userId}`);
        // 更新内存缓存 + 持久化到 PluginStorage
        _setBgmUserId(userId);
        _setBgmUsername(username);
        BGM.cache.username = username;
        BGM.cache.userId = userId;
        bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated] 用户信息已持久化到 PluginStorage`);
        // 尝试通过 GetTaskPane 直接通知 Taskpane 刷新 UI
        // 如果 GetTaskPane.contentWindow 不可用（不同 WPS 版本或安全限制），
        // Taskpane 的轮询机制会在 1-2 秒内检测到变更
        try {
            const app = getApp();
            const tsId = app?.PluginStorage?.getItem('taskpane_id');
            if (tsId) {
                // GetTaskPane 返回的 WpsTaskPane 在 WPS 实际运行时还包含 contentWindow 等 COM 属性
                const pane = app?.GetTaskPane?.(tsId);
                if (pane?.contentWindow?.refreshTaskpaneUI) {
                    pane.contentWindow.refreshTaskpaneUI();
                    bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated] 已通过 GetTaskPane 通知 Taskpane 刷新`);
                }
            }
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `[notifyUserInfoUpdated] GetTaskPane 通知失败（轮询兜底）: ${e instanceof Error ? e.message : String(e)}`);
        }
        bgmLog(LOG_LEVELS.INFO, `[notifyUserInfoUpdated] 通知完成`);
    }
    catch (e) {
        bgmLog(LOG_LEVELS.WARN, '通知用户信息更新失败: ' + (e instanceof Error ? e.message : String(e)));
    }
}
/**
 * 发送Bangumi同步请求
 *
 * @function bgmRequestSync
 * @param {string} method - HTTP方法（POST/PUT/DELETE）
 * @param {string} endpoint - API端点
 * @param {string} jsonBody - JSON请求体
 * @param {string} token - API Token
 * @param {AbortSignal} [signal] - 可选 AbortSignal，用于取消请求
 * @returns {{ code: number; message: string }} 请求结果
 */
export async function bgmRequestSync(method, endpoint, jsonBody, token, signal) {
    const fullUrl = `${BGM_CONFIG.API_BASE}${endpoint}`;
    bgmLog(LOG_LEVELS.INFO, `[bgmRequestSync] ${method} ${fullUrl} 请求体长度: ${jsonBody.length}`);
    // 如果 signal 已 aborted，立即返回
    if (signal?.aborted) {
        bgmLog(LOG_LEVELS.INFO, `[bgmRequestSync] 请求被取消（signal 已 aborted）: ${fullUrl}`);
        return { code: 0, message: '请求被取消' };
    }
    try {
        return await new Promise((resolve) => {
            const result = { code: 0, message: '' };
            const xhr = new XMLHttpRequest();
            xhr.open(method.toUpperCase(), fullUrl, true);
            xhr.timeout = 30000;
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.setRequestHeader('Content-Type', 'application/json');
            // AbortSignal 支持：监听 abort 事件触发 xhr.abort()
            if (signal) {
                signal.addEventListener('abort', () => {
                    xhr.abort();
                });
            }
            xhr.onload = function () {
                result.code = xhr.status;
                if (xhr.status >= 200 && xhr.status < 300) {
                    result.message = 'success';
                    if (xhr.responseText) {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            result.message = extractResponseMessage(data);
                        }
                        catch (e) {
                            bgmLog(LOG_LEVELS.WARN, '[exceltobangumi] bgmRequestSync 解析响应 JSON 失败: ' + (e instanceof Error ? e.message : String(e)));
                        }
                    }
                }
                else if (xhr.status === 429) {
                    result.message = 'Rate limited';
                }
                else {
                    result.message = parseErrorResponse(xhr);
                }
                resolve(result);
            };
            xhr.onerror = function () {
                result.code = 0;
                // 如果是 abort 导致的 onerror，归类为取消
                result.message = signal?.aborted ? '请求被取消' : 'Network error';
                resolve(result);
            };
            xhr.ontimeout = function () {
                result.code = 0;
                result.message = 'Request timeout';
                resolve(result);
            };
            xhr.send(jsonBody);
        });
    }
    catch (e) {
        bgmLog(LOG_LEVELS.ERROR, `[bgmRequestSync] 异常: ${e instanceof Error ? e.message : String(e)}`);
        return { code: 0, message: e instanceof Error ? e.message : 'Network error' };
    }
}
/**
 * 设置Bangumi Token
 *
 * @function setBangumiToken
 * @param {string} token - Token字符串
 * @returns {boolean} 是否保存成功
 */
export function setBangumiToken(token) {
    if (!token)
        return false;
    try {
        storeBgToken(token);
        bgmLog(LOG_LEVELS.INFO, 'Token已保存');
        return true;
    }
    catch (e) {
        BGM.handleError(e, { context: 'setBangumiToken', showAlert: false });
        return false;
    }
}
