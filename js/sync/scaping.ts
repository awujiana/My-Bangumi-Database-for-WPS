/**
 * 同步收藏模块（TypeScript 版）
 * @module sync/scraping
 * @description 从 Bangumi API 获取收藏列表、Token 验证
 */

import { bgmLog, LOG_LEVELS } from '../../generated-types/types/util.js';
import  {  TokenVerifyResult, BgmError, ApiResonance,BangumiUserData ,} from '../../generated-types/types/index.js';


// ========== 配置 ==========
const CONFIG = {
    API_BASE: 'https://api.bgm.tv/v0',
    MAX_PAGES: 50,
    LIMIT: 100,
    RETRY_DELAY: 2000,
    RETRY_MAX: 3,
    REQUEST_DELAY: 500
} as const;

// 所有要抓取的条目类型
const SUBJECT_TYPES: number[] = [1, 2, 3, 4, 6];
const TYPE_LABELS: Record<number, string> = {
    1: '书籍',
    2: '动画',
    3: '音乐',
    4: '游戏',
    6: '真人剧'
};

// ========== 内部工具函数 ==========

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiRequest(path: string, token: string): Promise<ApiResponse> {
    const url = CONFIG.API_BASE + path;
    let retries = 0;

    while (retries <= CONFIG.RETRY_MAX) {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 429) {
            retries++;
            bgmLog(LOG_LEVELS.WARN, `遇到限流 (429)，${CONFIG.RETRY_DELAY / 1000}s 后重试 (${retries}/${CONFIG.RETRY_MAX})`);
            await delay(CONFIG.RETRY_DELAY);
            continue;
        }

        let data: unknown = null;
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

export async function verifyToken(token: string): Promise<TokenVerifyResult> {
    if (!token) return { valid: false, userId: '', username: '', message: 'Token 为空' };

    try {
        const { status, data } = await apiRequest('/v0/me', token);

        if (status === 200) {
            const userData = data as BangumiUserData;
            return {
                valid: true,
                userId: String(userData.id || ''),
                username: userData.nickname || userData.username || '未知',
                message: 'Token 有效'
            };
        }
        if (status === 401) {
            return { valid: false, userId: '', username: '', message: 'Token 无效或已过期（HTTP 401）' };
        }
        return { valid: false, userId: '', username: '', message: `Token 验证失败（HTTP ${status}）` };
    } catch (e) {
        const err = e as Error;
        return { valid: false, userId: '', username: '', message: 'Token 验证请求失败: ' + err.message };
    }
}

// ========== 收藏列表获取（异步，全类型） ==========

export async function fetchAllUserCollections(token: string, userId?: string): Promise<unknown[]> {
    // 自动获取用户 ID
    if (!userId) {
        const authResult = await verifyToken(token);
        if (!authResult.valid) {
            throw new Error('Token 无效，无法获取用户 ID');
        }
        userId = authResult.userId;
    }

    const allCollections: unknown[] = [];

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
                    break;
                }
                if (status !== 200) {
                    throw new Error(`HTTP 错误: ${status}`);
                }

                const items = Array.isArray(data) ? data : (data as { data?: unknown[] }).data || [];
                if (!Array.isArray(items) || items.length === 0) {
                    hasMore = false;
                    break;
                }

                allCollections.push(...items);
                page++;

                if (items.length < CONFIG.LIMIT) {
                    hasMore = false;
                }
            } catch (e) {
                const err = e as Error;
                bgmLog(LOG_LEVELS.ERROR, `获取「${typeName}」第 ${page} 页失败: ${err.message}`);
                throw e;
            }
        }

        if (type !== SUBJECT_TYPES[SUBJECT_TYPES.length - 1]) {
            await delay(CONFIG.REQUEST_DELAY);
        }
    }

    bgmLog(LOG_LEVELS.INFO, `共获取 ${allCollections.length} 条收藏记录`);
    return allCollections;
}

// ========== 向后兼容 ==========
if (typeof window !== 'undefined') {
    (window as any).verifyToken = verifyToken;
    (window as any).fetchAllUserCollections = fetchAllUserCollections;
}