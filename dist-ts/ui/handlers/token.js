/**
 * UI 事件处理模块 - Token 相关函数
 * @module ui/handlers/token
 * @description Token 设置、用户 ID 设置、Token 有效性测试、用户信息展示等。
 */
import { LOG_LEVELS, bgmLog, BGM, loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId, _getBgmUsername, _setBgmUsername, getApp, fetchBgmUserInfo, showAlert, showInput, showSuccess, showError, showToast, } from '../../index.js';
import { _T } from './_constants.js';
// ========== 业务对话框 ==========
export function showTokenDialog(currentToken) {
    const defaultVal = currentToken || loadBgToken() || '';
    showInput(_T.setBgmToken, _T.inputToken, defaultVal, (value) => {
        if (value) {
            storeBgToken(value);
            updateTokenStatus();
            showToast(_T.tokenSaved, 'success');
        }
        else {
            showToast('Token 不能为空', 'warn');
        }
    });
}
export function showUserIdDialog() {
    const currentId = _getBgmUserId() || '';
    showInput(_T.setBgmUserId, _T.inputUserId, currentId, (value) => {
        if (value && value.trim() !== '') {
            _setBgmUserId(value.trim());
            updateUserIdStatus();
            showToast(_T.userIdSaved, 'success');
        }
        else {
            showToast('用户 ID 不能为空', 'warn');
        }
    });
}
export function updateTokenStatus() {
    const tokenStatus = document.getElementById('tokenStatus');
    if (!tokenStatus)
        return;
    const token = loadBgToken();
    if (token && token.length > 10) {
        tokenStatus.style.color = '#4CAF50';
        // 如果已经有用户名缓存，直接显示
        if (BGM.cache.username) {
            tokenStatus.textContent = _T.set + ': ' + BGM.cache.username;
        }
        else {
            tokenStatus.textContent = _T.set + ' (' + token.substring(0, 4) + '...)';
            // 尝试获取用户信息（但不阻塞 UI 更新）
            // 注意：这里可能会因为 CORS 或网络问题失败
            fetchBgmUserInfo()
                .then(({ userInfo, errorType }) => {
                if (userInfo?.username) {
                    tokenStatus.style.color = '#4CAF50';
                    tokenStatus.textContent = _T.set + ': ' + userInfo.username;
                    updateUserIdStatus();
                }
                else if (errorType === 'network') {
                    // 网络错误：Token 本身可能有效，但无法连接到 BGM API
                    // 常见原因：被 GFW 墙、断网、DNS 失败
                    tokenStatus.style.color = '#ff9800'; // 橙色警告
                    tokenStatus.textContent = _T.set + ' (' + token.substring(0, 4) + '...) ⚠ 网络无法连接';
                    bgmLog(LOG_LEVELS.WARN, '[updateTokenStatus] 网络错误：无法连接到 BGM API（可能被 GFW 墙）');
                    showToast('Token 已设置，但无法连接到 Bangumi API\n可能原因：网络被墙（GFW）或断网\nToken 本身可能有效，请在网络恢复后重试', 'warn');
                }
                else if (errorType === 'http') {
                    // HTTP 错误（如 401）：Token 失效
                    tokenStatus.style.color = '#f44336';
                    tokenStatus.textContent = _T.set + ' (Token 可能失效)';
                    bgmLog(LOG_LEVELS.WARN, '[updateTokenStatus] HTTP 错误：Token 可能已失效');
                }
                // errorType === 'parse' 或 'none'：保持原显示
            })
                .catch((err) => {
                const errMsg = err instanceof Error ? err.message : String(err);
                bgmLog(LOG_LEVELS.ERROR, '[handlers] updateTokenStatus 获取用户信息失败: ' + errMsg);
                BGM.handleError(err);
            });
        }
    }
    else {
        tokenStatus.textContent = _T.notSet;
        tokenStatus.style.color = '#f44336';
        BGM.cache.userId = null;
        BGM.cache.username = null;
    }
}
// 缓存上次更新的状态，避免重复日志和 DOM 操作
let _lastUserIdSnapshot = undefined;
export function updateUserIdStatus() {
    const userIdStatus = document.getElementById('userIdStatus');
    if (!userIdStatus)
        return;
    const userId = _getBgmUserId();
    const username = _getBgmUsername();
    const snapshot = `${userId ?? 'null'}|${username ?? 'null'}`;
    // 去重：状态未变化时跳过
    if (_lastUserIdSnapshot === snapshot)
        return;
    _lastUserIdSnapshot = snapshot;
    bgmLog(LOG_LEVELS.INFO, `[updateUserIdStatus] userId: ${userId}, username: ${username}`);
    if (userId) {
        const display = username ? username + ' (' + userId + ')' : userId;
        userIdStatus.textContent = _T.set + ': ' + display;
        userIdStatus.style.color = '#4CAF50';
    }
    else {
        userIdStatus.textContent = _T.notSet;
        userIdStatus.style.color = '#f44336';
    }
}
export function openUserCollection() {
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, '[openUserCollection] ========== 打开用户收藏页面 ==========');
    const userId = _getBgmUserId();
    bgmLog(LOG_LEVELS.INFO, `[openUserCollection] 获取用户ID: ${userId || '(未设置)'}`);
    if (!userId) {
        bgmLog(LOG_LEVELS.ERROR, '[openUserCollection] 用户ID未设置，无法打开收藏页面');
        showAlert(_T.pleaseSetUserIdFirst);
        return;
    }
    const collectionUrl = `https://bgm.tv/user/${userId}/collection`;
    bgmLog(LOG_LEVELS.INFO, `[openUserCollection] 生成收藏页面URL: ${collectionUrl}`);
    bgmLog(LOG_LEVELS.INFO, `[openUserCollection] 正在打开收藏页面...`);
    window.open(collectionUrl, '_blank');
    bgmLog(LOG_LEVELS.INFO, `[openUserCollection] 收藏页面已在新标签页打开，耗时: ${Date.now() - startTime}ms`);
}
export function testTokenValidity() {
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetTokenFirst);
        return;
    }
    const apiUrl = 'https://api.bgm.tv/v0/me';
    const requestStartTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] ========== 开始测试 Token ==========`);
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] API 路由: ${apiUrl}`);
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 请求方法: GET`);
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 请求头: Authorization: Bearer ${token.substring(0, 8)}...`);
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 请求头: Content-Type: application/json`);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', apiUrl, true);
    xhr.timeout = 15000; // 15 秒超时，防止网络挂起导致 Token 测试按钮无限期等待
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => {
        const requestEndTime = Date.now();
        const duration = requestEndTime - requestStartTime;
        bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] ========== 请求完成 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] HTTP 状态码: ${xhr.status} (${xhr.statusText})`);
        bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 请求耗时: ${duration}ms`);
        if (xhr.getAllResponseHeaders()) {
            bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 响应头: ${xhr.getAllResponseHeaders()}`);
        }
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                bgmLog(LOG_LEVELS.INFO, '[testTokenValidity] 响应数据: ' + JSON.stringify(data));
                const nickname = data.nickname || data.username || _T.unknownUser;
                const userId = String(data.id || '');
                bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] Token 验证成功！用户名: ${nickname}, 用户ID: ${userId}`);
                showSuccess(_T.tokenValid, _T.user + nickname);
                _setBgmUserId(userId);
                _setBgmUsername(nickname);
            }
            catch (e) {
                bgmLog(LOG_LEVELS.ERROR, `[testTokenValidity] 解析响应失败: ${e.message}`);
                showError(_T.parseFailed, _T.cannotParseResponse);
                BGM.handleError(e, {
                    showAlert: false,
                    level: BGM.ErrorLevel.WARN,
                    context: 'testTokenValidity',
                });
            }
        }
        else if (xhr.status === 401) {
            bgmLog(LOG_LEVELS.WARN, '[testTokenValidity] Token 无效或已过期');
            showError(_T.tokenInvalid, _T.tokenExpired);
        }
        else {
            bgmLog(LOG_LEVELS.ERROR, `[testTokenValidity] Token 验证失败，HTTP 状态码: ${xhr.status}`);
            bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 响应内容: ${xhr.responseText}`);
            showError('错误', `Token验证失败 (HTTP ${xhr.status})`);
        }
    };
    xhr.onerror = () => {
        const requestEndTime = Date.now();
        const duration = requestEndTime - requestStartTime;
        bgmLog(LOG_LEVELS.ERROR, `[testTokenValidity] 请求发生网络错误，耗时: ${duration}ms`);
        bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] XHR 状态: ${xhr.readyState}`);
        showError(_T.networkError, _T.cannotConnectBgm);
    };
    xhr.ontimeout = () => {
        const requestEndTime = Date.now();
        const duration = requestEndTime - requestStartTime;
        bgmLog(LOG_LEVELS.WARN, `[testTokenValidity] 请求超时（15s），耗时: ${duration}ms`);
        showError('网络超时，请重试', '超时');
    };
    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 正在发送请求...`);
    xhr.send();
}
export function testDebugConnection() {
    // 通过统一的 getApp() 获取 WPS Application 对象，避免直接访问 window 全局
    if (getApp() !== null) {
        showToast(_T.debugConnOk, 'success');
    }
    else {
        showToast(_T.debugConnFail, 'error');
    }
}
