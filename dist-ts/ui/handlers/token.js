/**
 * UI 事件处理模块 - Token 相关函数
 * @module ui/handlers/token
 * @description Token 设置、用户 ID 设置、Token 有效性测试、用户信息展示等。
 */
import { LOG_LEVELS, bgmLog, BGM, loadBgToken, storeBgToken, storeTokenExpires, loadTokenExpires, clearTokenExpires, getTokenRemainingTime, _getBgmUserId, _setBgmUserId, _getBgmUsername, _setBgmUsername, getApp, fetchBgmUserInfo, showAlert, showInput, showError, showToast, } from '../../index.js';
import { _T } from './_constants.js';
// ========== 业务对话框 ==========
export function showTokenDialog(currentToken) {
    const defaultVal = currentToken || loadBgToken() || '';
    showInput(_T.setBgmToken, _T.inputToken, defaultVal, (value) => {
        if (value) {
            storeBgToken(value);
            // 新 Token 保存时清除旧的过期信息，等待下次查询刷新
            clearTokenExpires();
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
            // 后台静默查询 Token 状态
            void queryTokenStatus(token).catch(() => {
                // 静默失败，不影响主流程
            });
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
                    // 后台静默查询 Token 状态
                    void queryTokenStatus(token).catch(() => {
                        // 静默失败
                    });
                }
                else if (errorType === 'network') {
                    // 网络错误：Token 本身可能有效，但无法连接到 BGM API
                    // 常见原因：被 GFW 墙、断网、DNS 失败
                    tokenStatus.style.color = '#ff9800'; // 橙色警告
                    tokenStatus.textContent = _T.set + ' (' + token.substring(0, 4) + '...) ⚠ 网络无法连接';
                    bgmLog(LOG_LEVELS.WARN, '[updateTokenStatus] 网络错误：无法连接到 BGM API（可能被 GFW 墙）');
                    showToast('Token 已设置，但无法连接到 Bangumi API\n可能原因：网络被墙（GFW）或断网\nToken 本身可能有效，请在网络恢复后重试', 'warn');
                    // 离线时仍显示本地缓存的过期信息
                    const cachedExpires = loadTokenExpires();
                    if (cachedExpires) {
                        showTokenExpiryInfo(cachedExpires);
                    }
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
        clearTokenExpires();
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
                // 查询 Token 有效期，完成后显示剩余天数
                void queryTokenStatus(token)
                    .then(({ expires }) => {
                    const remaining = getTokenRemainingTime(expires);
                    bgmLog(LOG_LEVELS.INFO, `[testTokenValidity] 📅 Token 剩余时间: ${remaining.label} | 过期时间: ${new Date(expires * 1000).toLocaleString('zh-CN')}`);
                    showToast(`✅ Token 有效 | 用户: ${nickname} | ${remaining.label}`, 'success');
                })
                    .catch(() => {
                    bgmLog(LOG_LEVELS.WARN, '[testTokenValidity] Token 状态查询失败，不影响主流程');
                    showToast(`✅ Token 有效 | 用户: ${nickname}`, 'success');
                });
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
// ========== Token 有效期查询 ==========
/**
 * 查询 Token 状态（有效期、过期时间）
 *
 * 通过 POST /oauth/token_status 接口获取 Access Token 的过期时间戳。
 * Bangumi API 返回 expires 字段（Unix 时间戳，秒），据此可计算剩余天数。
 *
 * @param token - Bangumi Access Token
 * @returns Promise  resolving to { expires: number, userId: string }
 */
export function queryTokenStatus(token) {
    return new Promise((resolve, reject) => {
        const apiUrl = 'https://bgm.tv/oauth/token_status';
        const startTime = Date.now();
        bgmLog(LOG_LEVELS.INFO, `[queryTokenStatus] ========== 查询 Token 状态 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[queryTokenStatus] API 路由: ${apiUrl}`);
        bgmLog(LOG_LEVELS.INFO, `[queryTokenStatus] 请求方法: POST`);
        bgmLog(LOG_LEVELS.INFO, `[queryTokenStatus] 请求体: access_token=${token.substring(0, 8)}...`);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl, true);
        xhr.timeout = 15000;
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onload = () => {
            const duration = Date.now() - startTime;
            bgmLog(LOG_LEVELS.INFO, `[queryTokenStatus] HTTP 状态码: ${xhr.status}，耗时: ${duration}ms`);
            if (xhr.status === 200) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (typeof data.expires === 'number' && data.expires > 0) {
                        const expires = data.expires;
                        const userId = String(data.user_id ?? '');
                        storeTokenExpires(expires);
                        const remaining = getTokenRemainingTime(expires);
                        bgmLog(LOG_LEVELS.INFO, `[queryTokenStatus] Token 过期时间: ${new Date(expires * 1000).toLocaleString('zh-CN')} | ${remaining.label} | 状态: ${remaining.status}`);
                        // 更新 UI 显示过期信息
                        showTokenExpiryInfo(expires);
                        // 过期提醒（P1）
                        checkTokenExpiryWarning(expires);
                        resolve({ expires, userId });
                    }
                    else {
                        bgmLog(LOG_LEVELS.WARN, '[queryTokenStatus] 响应中缺少有效的 expires 字段');
                        reject(new Error('Invalid response: missing expires field'));
                    }
                }
                catch (e) {
                    const errMsg = e instanceof Error ? e.message : String(e);
                    bgmLog(LOG_LEVELS.ERROR, `[queryTokenStatus] 解析响应失败: ${errMsg}`);
                    reject(new Error('Failed to parse token status response'));
                }
            }
            else if (xhr.status === 400 || xhr.status === 401) {
                bgmLog(LOG_LEVELS.WARN, `[queryTokenStatus] Token 状态查询失败，HTTP ${xhr.status}（Token 可能已失效）`);
                reject(new Error(`Token invalid or expired (HTTP ${xhr.status})`));
            }
            else {
                bgmLog(LOG_LEVELS.ERROR, `[queryTokenStatus] 请求失败，HTTP ${xhr.status}`);
                reject(new Error(`HTTP ${xhr.status}`));
            }
        };
        xhr.onerror = () => {
            const duration = Date.now() - startTime;
            bgmLog(LOG_LEVELS.ERROR, `[queryTokenStatus] 网络错误，耗时: ${duration}ms`);
            reject(new Error('Network error'));
        };
        xhr.ontimeout = () => {
            bgmLog(LOG_LEVELS.WARN, '[queryTokenStatus] 请求超时（15s）');
            reject(new Error('Request timeout'));
        };
        bgmLog(LOG_LEVELS.INFO, `[queryTokenStatus] 正在发送请求...`);
        xhr.send(`access_token=${encodeURIComponent(token)}`);
    });
}
/**
 * 在 UI 上显示 Token 过期信息
 *
 * 更新 tokenExpiresDisplay 元素，显示剩余天数和状态。
 * 同时更新 tokenStatus 颜色以反映过期紧迫程度。
 *
 * @param expires - Unix 时间戳（秒）
 */
export function showTokenExpiryInfo(expires) {
    const remaining = getTokenRemainingTime(expires);
    const expiresEl = document.getElementById('tokenExpiresDisplay');
    const tokenStatusEl = document.getElementById('tokenStatus');
    // 更新过期信息显示元素
    if (expiresEl) {
        expiresEl.textContent = `${_T.tokenExpiresLabel}: ${remaining.label}`;
        expiresEl.style.display = '';
        // 根据状态设置颜色
        let color = '#4CAF50'; // green
        if (remaining.status === 'warning')
            color = '#ffc107'; // yellow
        else if (remaining.status === 'danger')
            color = '#ff9800'; // orange
        else if (remaining.status === 'expired')
            color = '#f44336'; // red
        expiresEl.style.color = color;
    }
    // 更新 tokenStatus 状态颜色
    if (tokenStatusEl) {
        let color = '#4CAF50';
        if (remaining.status === 'warning')
            color = '#ffc107';
        else if (remaining.status === 'danger')
            color = '#ff9800';
        else if (remaining.status === 'expired')
            color = '#f44336';
        tokenStatusEl.style.color = color;
    }
    // 如果有用户头像区域，也在那里显示过期信息
    const profileExpiresEl = document.getElementById('profileExpiresDisplay');
    if (profileExpiresEl) {
        let icon = '✅';
        if (remaining.status === 'warning')
            icon = '⚠️';
        else if (remaining.status === 'danger')
            icon = '🔴';
        else if (remaining.status === 'expired')
            icon = '⛔';
        profileExpiresEl.textContent = `${icon} ${remaining.label}`;
        profileExpiresEl.style.display = '';
        let color = '#4CAF50';
        if (remaining.status === 'warning')
            color = '#ffc107';
        else if (remaining.status === 'danger')
            color = '#ff9800';
        else if (remaining.status === 'expired')
            color = '#f44336';
        profileExpiresEl.style.color = color;
    }
}
/**
 * 检查 Token 过期并发送提醒（P1）
 *
 * - expired: 红色 Toast，强烈建议重新获取
 * - danger (<3天): 红色 Toast，提醒尽快获取
 * - warning (<7天): 黄色 Toast，建议关注
 *
 * @param expires - Unix 时间戳（秒）
 */
export function checkTokenExpiryWarning(expires) {
    const remaining = getTokenRemainingTime(expires);
    if (remaining.status === 'expired') {
        showToast(_T.tokenExpiredWarning, 'error');
        bgmLog(LOG_LEVELS.ERROR, `[checkTokenExpiryWarning] ${_T.tokenExpiredWarning}`);
    }
    else if (remaining.status === 'danger') {
        const msg = _T.tokenExpiringCritical.replace('{}', remaining.label);
        showToast(msg, 'error');
        bgmLog(LOG_LEVELS.WARN, `[checkTokenExpiryWarning] ${msg}`);
    }
    else if (remaining.status === 'warning') {
        const msg = _T.tokenExpiringSoon.replace('{}', remaining.label);
        showToast(msg, 'warn');
        bgmLog(LOG_LEVELS.WARN, `[checkTokenExpiryWarning] ${msg}`);
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
        // 如果有缓存的过期信息，显示它
        const cachedExpires = loadTokenExpires();
        if (cachedExpires) {
            showTokenExpiryInfo(cachedExpires);
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
    // 隐藏过期信息显示
    const expiresEl = document.getElementById('tokenExpiresDisplay');
    if (expiresEl) {
        expiresEl.style.display = 'none';
        expiresEl.textContent = '';
    }
    const profileExpiresEl = document.getElementById('profileExpiresDisplay');
    if (profileExpiresEl) {
        profileExpiresEl.style.display = 'none';
        profileExpiresEl.textContent = '';
    }
}
// ========== Token 续约（已合并到测试） ==========
/**
 * Token 续约（已合并到 testTokenValidity）
 *
 * @deprecated 此函数保留用于向后兼容，内部委托给 testTokenValidity。
 * 测试和续约功能已统一：点击「测试」按钮即可同时验证 Token 并显示剩余天数。
 */
export function renewToken() {
    bgmLog(LOG_LEVELS.INFO, '[renewToken] 已合并到 testTokenValidity，调用测试流程');
    testTokenValidity();
}
//# sourceMappingURL=token.js.map