/**
 * 同步收藏模块（优化版）
 * @module sync/scraping
 * @description 从 Bangumi API 获取收藏列表、Token 验证
 */

import { bgmLog, LOG_LEVELS } from '../util.js';

// ========== 配置 ==========
const CONFIG = {
    API_BASE: 'https://api.bgm.tv/v0',
    MAX_PAGES: 50,
    LIMIT: 100,
    RETRY_DELAY: 2000,          // 429 限流重试等待
    RETRY_MAX: 3,               // 最大重试次数
    REQUEST_DELAY: 500          // 类型切换时冷却（避免短时间大量请求）
};

// 所有要抓取的条目类型
const SUBJECT_TYPES = [1, 2, 3, 4, 6];   // 书籍、动画、音乐、游戏、真人剧
const TYPE_LABELS = {
    1: '书籍',
    2: '动画',
    3: '音乐',
    4: '游戏',
    6: '真人剧'
};

// ========== 内部工具函数 ==========

/**
 * 延迟 Promise 封装
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 通用 API 异步请求（支持自动重试 429）
 * @param {string} path - 以 / 开头的路径（如 /v0/me）
 * @param {string} token - Access Token
 * @returns {Promise<{ status: number, data: any }>}
 */
async function apiRequest(path, token) {
    const url = CONFIG.API_BASE + path;
    let retries = 0;

    while (retries <= CONFIG.RETRY_MAX) {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 429) {
            retries++;
            bgmLog(LOG_LEVELS.WARN, `遇到限流 (429)，${CONFIG.RETRY_DELAY/1000}s 后重试 (${retries}/${CONFIG.RETRY_MAX})`);
            await delay(CONFIG.RETRY_DELAY);
            continue;
        }

        let data = null;
        try {
            data = await response.json();
        } catch (_) {
            // 无 JSON 响应时 data 保持 null
        }

        return { status: response.status, data };
    }

    throw new Error(`请求失败：连续 ${retries} 次 429 限流`);
}

// ========== Token 验证（异步） ==========

/**
 * 异步验证 Token 有效性
 * @param {string} token
 * @returns {Promise<{ valid: boolean, userId: string, username: string, message: string }>}
 */
export async function verifyToken(token) {
    if (!token) return { valid: false, userId: '', username: '', message: 'Token 为空' };

    try {
        const { status, data } = await apiRequest('/v0/me', token);

        if (status === 200) {
            return {
                valid: true,
                userId: String(data.id || ''),
                username: data.nickname || data.username || '未知',
                message: 'Token 有效'
            };
        }
        if (status === 401) {
            return { valid: false, userId: '', username: '', message: 'Token 无效或已过期（HTTP 401）' };
        }
        return { valid: false, userId: '', username: '', message: `Token 验证失败（HTTP ${status}）` };
    } catch (e) {
        return { valid: false, userId: '', username: '', message: 'Token 验证请求失败: ' + e.message };
    }
}

// ========== 收藏列表获取（异步，全类型） ==========

/**
 * 异步获取用户所有类型收藏（主函数）
 * @param {string} token - Access Token
 * @param {string} [userId] - 用户 ID，若未提供则从 Token 自动获取
 * @returns {Promise<Array>} 收藏条目数组
 */
export async function fetchAllUserCollections(token, userId) {
    // 自动获取用户 ID
    if (!userId) {
        const authResult = await verifyToken(token);
        if (!authResult.valid) {
            throw new Error('Token 无效，无法获取用户 ID');
        }
        userId = authResult.userId;
    }

    const allCollections = [];
    let lastError = null;

    bgmLog(LOG_LEVELS.INFO, `开始获取用户 ${userId} 的全部收藏`);

    for (const type of SUBJECT_TYPES) {
        const typeName = TYPE_LABELS[type] || '未知';
        let page = 1;
        let hasMore = true;

        bgmLog(LOG_LEVELS.INFO, `获取「${typeName}」类型收藏 (type=${type})`);

        while (page <= CONFIG.MAX_PAGES && hasMore) {
            try {
                const offset = (page - 1) * CONFIG.LIMIT;
                const path = `/v0/users/${userId}/collections?subject_type=${type}&limit=${CONFIG.LIMIT}&offset=${offset}`;
                const { status, data } = await apiRequest(path, token);

                if (status === 401) {
                    throw new Error('Token 无效或已过期');
                }
                if (status === 403) {
                    throw new Error('没有权限访问收藏列表，请检查 Token 权限');
                }
                if (status === 404) {
                    bgmLog(LOG_LEVELS.DEBUG, `「${typeName}」类型收藏不存在或为空`);
                    break;  // 该类型无数据，跳到下一个类型
                }
                if (status !== 200) {
                    throw new Error(`HTTP 错误: ${status}`);
                }

                const items = Array.isArray(data) ? data : (data.data || []);
                if (!Array.isArray(items) || items.length === 0) {
                    hasMore = false;
                    break;
                }

                allCollections.push(...items);
                page++;

                // 最后一页判断
                if (items.length < CONFIG.LIMIT) {
                    hasMore = false;
                }
            } catch (e) {
                lastError = e;
                bgmLog(LOG_LEVELS.ERROR, `获取「${typeName}」第 ${page} 页失败: ${e.message}`);
                // 中断全部获取（单一类型失败视为整体失败）
                throw e;
            }
        }

        // 类型间稍作冷却，避免触发限流
        if (type !== SUBJECT_TYPES[SUBJECT_TYPES.length - 1]) {
            await delay(CONFIG.REQUEST_DELAY);
        }
    }

    bgmLog(LOG_LEVELS.INFO, `共获取 ${allCollections.length} 条收藏记录`);
    return allCollections;
}



// ========== 挂载到 window（向后兼容） ==========
if (typeof window !== 'undefined') {
    window.verifyToken = verifyToken;
    window._verifyToken = _verifyToken;
    window.fetchAllUserCollections = fetchAllUserCollections;
   
}