/**
 * 同步收藏模块
 * @module sync/scraping
 * @description 从 Bangumi API 获取收藏列表、Token 验证
 */

import { bgmLog, BGM, LOG_LEVELS, BGM_CONFIG, sleep } from '../util.js';
import { setStatus } from '../ui/message.js';

// ========== Token 验证 ==========

/**
 * 同步验证 Token 有效性
 * @param {string} token - Access Token
 * @returns {{ valid: boolean, userId: string, username: string, message: string }}
 */
export function _verifyToken(token) {
    if (!token) return { valid: false, userId: '', username: '', message: 'Token \u4E3A\u7A7A' };
    try {
        let xhr = new XMLHttpRequest();
        xhr.open("GET", "https://api.bgm.tv/v0/me", false);
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.send();

        if (xhr.status === 200) {
            let data = JSON.parse(xhr.responseText);
            return {
                valid: true,
                userId: String(data.id || ''),
                username: data.nickname || data.username || '\u672A\u77E5',
                message: 'Token \u6709\u6548'
            };
        }
        if (xhr.status === 401) {
            return { valid: false, userId: '', username: '', message: 'Token \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF08HTTP 401\uFF09' };
        }
        return { valid: false, userId: '', username: '', message: `Token \u9A8C\u8BC1\u5931\u8D25\uFF08HTTP ${xhr.status}\uFF09` };
    } catch (e) {
        return { valid: false, userId: '', username: '', message: 'Token \u9A8C\u8BC1\u8BF7\u6C42\u5931\u8D25: ' + e.message };
    }
}

// ========== 同步 API 获取收藏（所有类型）==========

/**
 * 通过 API 同步获取用户所有类型收藏
 * @param {string} token - Access Token
 * @returns {Array} 收藏条目数组，设置 lastError 属性
 */
export function fetchAllUserCollectionsSync(token) {
    let allCollections = [];
    let maxPages = 50;
    let limit = 100;
    let lastError = null;
    let userPath = '';

    // 获取用户 API 路径
    if (typeof _getUserApiPath === 'function') {
        userPath = _getUserApiPath();
    } else if (BGM.cache.userId) {
        userPath = BGM.cache.userId;
    }

    // 要获取的所有类型：书籍、动画、音乐、游戏、真人剧
    let subjectTypes = [1, 2, 3, 4, 6];
    let BGM_SUBJECT_TYPES = (typeof window !== 'undefined' && window.BGM_SUBJECT_TYPES) ?
        window.BGM_SUBJECT_TYPES : { 1: "\u4E66\u7C4D", 2: "\u52A8\u753B", 3: "\u97F3\u4E50", 4: "\u6E38\u620F", 6: "\u771F\u4EBA\u5267" };

    try {
        for (let typeIdx = 0; typeIdx < subjectTypes.length; typeIdx++) {
            let subjectType = subjectTypes[typeIdx];
            let typeName = BGM_SUBJECT_TYPES[subjectType] || "\u672A\u77E5";
            let page = 1;

            bgmLog(LOG_LEVELS.INFO, "\u5F00\u59CB\u83B7\u53D6\u300C" + typeName + "\u300D\u7C7B\u578B\u6536\u85CF (type=" + subjectType + ")");

            while (page <= maxPages) {
                let xhr = new XMLHttpRequest();
                let url = `https://api.bgm.tv/v0/users/${userPath}/collections?subject_type=${subjectType}&limit=${limit}&offset=${(page - 1) * limit}`;
                xhr.open("GET", url, false);
                xhr.setRequestHeader("Authorization", "Bearer " + token);

                xhr.send();

                bgmLog(LOG_LEVELS.DEBUG, "\u83B7\u53D6\u300C" + typeName + "\u300D\u7B2C " + page + " \u9875 - \u72B6\u6001\u7801: " + xhr.status);

                if (xhr.status === 401) {
                    lastError = { type: "auth", message: "Token \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u8BBE\u7F6E Token" };
                    break;
                }
                if (xhr.status === 403) {
                    lastError = { type: "forbidden", message: "\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u6536\u85CF\u5217\u8868\uFF0C\u8BF7\u68C0\u67E5 Token \u6743\u9650" };
                    break;
                }
                if (xhr.status === 404) {
                    bgmLog(LOG_LEVELS.DEBUG, "\u300C" + typeName + "\u300D\u7C7B\u578B\u6536\u85CF\u4E0D\u5B58\u5728\u6216\u4E3A\u7A7A");
                    break;
                }
                if (xhr.status !== 200) {
                    lastError = { type: "http", code: xhr.status, message: `HTTP \u9519\u8BEF: ${xhr.status}` };
                    break;
                }

                let raw;
                try { raw = JSON.parse(xhr.responseText); } catch (e) {
                    lastError = { type: "parse", message: "\u54CD\u5E94\u6570\u636E\u683C\u5F0F\u9519\u8BEF" };
                    break;
                }

                let items = Array.isArray(raw) ? raw : (raw.data || []);
                if (!Array.isArray(items) || items.length === 0) break;

                for (let i = 0; i < items.length; i++) allCollections.push(items[i]);
                if (items.length < limit) break;

                page++;
            }

            if (lastError) break;
            sleep(500);
        }
    } catch (e) {
        if (!lastError) {
            lastError = { type: "exception", message: e.message };
        }
        bgmLog(LOG_LEVELS.ERROR, "\u83B7\u53D6\u6536\u85CF\u5217\u8868\u51FA\u9519: " + e.message);
    }

    bgmLog(LOG_LEVELS.INFO, "\u5171\u83B7\u53D6 " + allCollections.length + " \u6761\u6536\u85CF\u8BB0\u5F55");

    fetchAllUserCollectionsSync.lastError = lastError;
    return allCollections;
}

// ========== 异步 API 获取收藏（兼容旧接口）==========

/**
 * 通过 API 获取用户收藏（异步回调版本，仅动画 type=2）
 */
export function fetchAllUserCollections(token, userId, onSuccess, onError) {
    bgmLog(LOG_LEVELS.DEBUG, "fetchAllUserCollections(async) \u5F00\u59CB, userId=" + userId);

    let allCollections = [];
    let page = 1;
    let maxPages = 50;

    function fetchPage() {
        if (page > maxPages) {
            if (onSuccess) onSuccess(allCollections);
            return;
        }

        setStatus("\u6B63\u5728\u83B7\u53D6\u7B2C " + page + " \u9875...", "info");

        let xhr = new XMLHttpRequest();
        let offset = (page - 1) * 30;
        let url = BGM_CONFIG.API_BASE + "/user/" + userId + "/collection?type=2&offset=" + offset + "&limit=30";

        xhr.open("GET", url, true);
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.setRequestHeader("Content-Type", "application/json");

        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    let data = JSON.parse(xhr.responseText);
                    if (data.data && data.data.length > 0) {
                        data.data.forEach(item => {
                            allCollections.push({
                                sid: String(item.subject_id),
                                name: item.subject ? item.subject.name : "",
                                type: item.type,
                                rate: item.rate || "",
                                tags: item.tags || [],
                                comment: item.comment || "",
                                lastModified: item.lastmodified
                            });
                        });
                        page++;
                        setTimeout(fetchPage, BGM_CONFIG.REQUEST_DELAY);
                    } else {
                        if (onSuccess) onSuccess(allCollections);
                    }
                } catch (e) {
                    if (onError) onError("\u89E3\u6790\u6570\u636E\u5931\u8D25: " + e.message);
                }
            } else if (xhr.status === 401) {
                if (onError) onError("Token \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF01");
            } else if (xhr.status === 404) {
                if (onError) onError("\u7528\u6237\u4E0D\u5B58\u5728\uFF01");
            } else if (xhr.status === 429) {
                setTimeout(fetchPage, 2000);
            } else {
                if (onError) onError("\u83B7\u53D6\u5931\u8D25\uFF0C\u72B6\u6001\u7801\uFF1A" + xhr.status);
            }
        };
        xhr.onerror = function() { if (onError) onError("\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF01"); };
        xhr.send();
    }
    fetchPage();
}

// ========== Promise 风格 API ==========
export function fetchAllUserCollectionsAsync(token, userId) {
    return new Promise((resolve, reject) => {
        fetchAllUserCollections(token, userId, resolve, reject);
    });
}

// ========== 挂载到 window ==========
if (typeof window !== 'undefined') {
    window._verifyToken = _verifyToken;
    window.fetchAllUserCollectionsSync = fetchAllUserCollectionsSync;

    window.fetchAllUserCollections = fetchAllUserCollections;
    window.fetchAllUserCollectionsAsync = fetchAllUserCollectionsAsync;
}
