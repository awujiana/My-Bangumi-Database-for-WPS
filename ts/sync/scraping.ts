/**
 * 同步收藏模块（TypeScript 版）
 * @module sync/scraping
 */

import { BGM ,bgmLog ,LOG_LEVELS, } from '../index.js';


// ========== 局部常量配置 ==========
 const CONFIG = {
    API_BASE: 'https://api.bgm.tv/v0',
    MAX_PAGES: 50,
    LIMIT: 100,
    RETRY_DELAY: 2000,
    RETRY_MAX: 3,
    REQUEST_DELAY: 500
} as const;

const SUBJECT_TYPES: number[] = [1, 2, 3, 4, 6];
const TYPE_LABELS: Record<number, string> = {
    1: '书籍', 2: '动画', 3: '音乐', 4: '游戏', 6: '真人剧'
};

// ========== 导出接口定义 ==========
export interface TokenVerifyResult {
    valid: boolean;
    userId: string;
    username: string;
    message: string;
}

export interface ApiResponse {
    status: number;
    data: any;
}

export interface BangumiUserData {
    id?: string | number;
    nickname?: string;
    username?: string;
}

// ========== 内部工具 ==========

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiRequest(path: string, token: string): Promise<{ status: number; data: unknown }> {
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
        try { data = await response.json(); } catch (_) {}

        return { status: response.status, data };
    }

    throw new Error(`请求失败：连续 ${retries} 次 429 限流`);
}




// ========== Token 验证 ==========

export async function verifyToken(token: string): Promise<{ valid: boolean; userId: string; username: string; message: string }> {
    if (!token) return { valid: false, userId: '', username: '', message: 'Token 为空' };

    try {
        const { status, data } = await apiRequest('/v0/me', token);

        if (status === 200) {
            const userData = data as { id?: string; nickname?: string; username?: string };
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
        BGM.handleError(e, { context: 'verifyToken' });
        return { valid: false, userId: '', username: '', message: 'Token 验证请求失败: ' + (e as Error).message };
    }
}

// ========== 收藏列表获取 ==========

export async function fetchAllUserCollections(token: string, userId?: string): Promise<unknown[]> {
    if (!userId) {
        const authResult = await verifyToken(token);
        if (!authResult.valid) {
            BGM.handleError(new Error('Token 无效，无法获取用户 ID'), { context: 'fetchAllUserCollections', showDialog: true });
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

                if (status === 401) throw new Error('Token 无效或已过期');
                if (status === 403) throw new Error('没有权限访问收藏列表');
                if (status === 404) break;
                if (status !== 200) throw new Error(`HTTP 错误: ${status}`);

                const items = Array.isArray(data) ? data : (data as { data?: unknown[] }).data || [];
                if (!items.length) { hasMore = false; break; }

                allCollections.push(...items);
                page++;
                if (items.length < CONFIG.LIMIT) hasMore = false;
            } catch (e) {
                BGM.handleError(e, { context: `fetchAllUserCollections: ${typeName} 第${page}页`, showDialog: true });
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

