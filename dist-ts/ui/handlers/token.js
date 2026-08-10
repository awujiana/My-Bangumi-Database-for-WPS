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
            showUserProfile();
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
                    showUserProfile();
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
        hideUserProfile();
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
                // 处理头像 URL：移除可能存在的反引号包裹
                const rawAvatarUrl = data.avatar?.large || data.avatar?.medium || data.avatar?.small || '';
                const cleanAvatarUrl = rawAvatarUrl.replace(/`/g, '').trim();
                if (cleanAvatarUrl) {
                    BGM.cache.avatarUrl = cleanAvatarUrl;
                    // 持久化头像 URL
                    try {
                        const app = getApp();
                        if (app?.PluginStorage) {
                            app.PluginStorage.setItem('bgm_avatar_url', cleanAvatarUrl);
                        }
                    }
                    catch {
                        // 静默处理
                    }
                    showUserProfile();
                }
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
            hideUserProfile();
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
// ========== 用户头像显示 ==========
/**
 * 显示用户头像和信息
 * 根据 BGM.cache 中的数据更新头像显示区域
 */
export function showUserProfile() {
    const profileEl = document.getElementById('userProfile');
    if (!profileEl)
        return;
    const avatarUrl = BGM.cache.avatarUrl;
    const username = BGM.cache.username;
    const userId = BGM.cache.userId;
    if (avatarUrl || username) {
        profileEl.style.display = 'flex';
        const avatarImg = document.getElementById('userAvatar');
        if (avatarImg) {
            if (avatarUrl) {
                avatarImg.src = avatarUrl;
                avatarImg.alt = username || _T.avatarDefault;
                avatarImg.onerror = () => {
                    avatarImg.style.display = 'none';
                    bgmLog(LOG_LEVELS.WARN, '[showUserProfile] 头像加载失败');
                };
                avatarImg.style.display = '';
            }
            else {
                avatarImg.style.display = 'none';
            }
        }
        const nameEl = document.getElementById('userNameDisplay');
        if (nameEl && username) {
            nameEl.textContent = username;
        }
        const idEl = document.getElementById('userIdDisplay');
        if (idEl && userId) {
            idEl.textContent = `ID: ${userId}`;
        }
    }
    else {
        profileEl.style.display = 'none';
    }
}
/**
 * 隐藏用户头像区域
 */
export function hideUserProfile() {
    const profileEl = document.getElementById('userProfile');
    if (profileEl) {
        profileEl.style.display = 'none';
    }
}
// ========== Token 续约 ==========
/**
 * 续约/刷新 Token
 * 通过测试现有 Token 的有效性，重新获取用户信息和头像
 * 如果 Token 已失效，提示用户重新输入
 *
 * 说明：Bangumi OAuth Token 本身没有"刷新租期"的概念，
 * 此操作的实质是"验证 Token 有效性"和"刷新用户缓存数据"。
 * 不会延长 Token 的有效期（Token 有效期由 Bangumi 服务端决定）。
 */
export function renewToken() {
    const token = loadBgToken();
    if (!token) {
        showAlert(_T.pleaseSetTokenFirst);
        return;
    }
    const startTime = Date.now();
    bgmLog(LOG_LEVELS.INFO, `[renewToken] ========== Token 续约流程开始 ==========`);
    bgmLog(LOG_LEVELS.INFO, `[renewToken] 触发时间: ${new Date().toLocaleString('zh-CN')}`);
    bgmLog(LOG_LEVELS.INFO, `[renewToken] 【重要说明】本操作≠延长Token有效期。Bangumi OAuth Token的有效期由官方服务器决定（代码端无法查询或修改剩余天数）。本操作实际执行的是：① 调用 /v0/me 接口验证Token是否仍然有效；② 若有效，重新拉取最新的用户头像、ID、用户名并刷新本地缓存。`);
    bgmLog(LOG_LEVELS.INFO, `[renewToken] 正在向 Bangumi API 发起验证请求...`);
    // 同时刷新用户信息和头像
    fetchBgmUserInfo()
        .then(({ userInfo, errorType }) => {
        const duration = Date.now() - startTime;
        if (userInfo?.username) {
            showUserProfile();
            bgmLog(LOG_LEVELS.INFO, `[renewToken] ✅ Token 验证通过，耗时: ${duration}ms | 用户: ${userInfo.username} (ID: ${userInfo.id}) | 头像已刷新 | 注意: 本次操作未延长Token有效期，剩余天数需登录Bangumi官网查看`);
            showToast(`Token 验证成功，用户: ${userInfo.username}`, 'success');
        }
        else if (errorType === 'http') {
            // Token 失效
            bgmLog(LOG_LEVELS.WARN, `[renewToken] Token 续约失败（HTTP错误），耗时: ${duration}ms`);
            showToast(_T.tokenRenewFailed, 'error');
            hideUserProfile();
        }
        else if (errorType === 'network') {
            bgmLog(LOG_LEVELS.WARN, `[renewToken] Token 续约失败（网络错误），耗时: ${duration}ms`);
            showToast('网络连接失败，无法验证 Token', 'warn');
        }
    })
        .catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        bgmLog(LOG_LEVELS.ERROR, `[renewToken] Token 续约异常: ${errMsg}`);
    });
}
