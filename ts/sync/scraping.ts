/**
 * @fileoverview Bangumi数据拉取模块
 * @module sync/scraping
 * @description 从Bangumi API获取用户收藏数据并同步到Excel的工作逻辑。
 *              支持Token验证、收藏列表获取等功能。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */

import { BGM_CONFIG, LOG_LEVELS, bgmLog, Result, BgmError, fetchBgmUserInfo, _getBgmUserId, _setBgmUserId } from '../index.js';

/**
 * Token验证结果接口
 *
 * @interface TokenVerifyResult
 */
export interface TokenVerifyResult {
    /** 验证是否通过 */
    valid: boolean;
    /** 验证消息 */
    message: string;
    /** 用户ID（如果验证成功） */
    userId?: string;
    /** 用户名（如果验证成功） */
    username?: string;
}

/**
 * Bangumi用户数据接口
 *
 * @interface BangumiUserData
 */
export interface BangumiUserData {
    /** 用户ID */
    id: number;
    /** 用户名 */
    username: string;
    /** 昵称 */
    nickname?: string;
    /** 头像URL */
    avatar?: {
        /** 大头像 */
        large: string;
        /** 中头像 */
        medium: string;
        /** 小头像 */
        small: string;
    };
}

/**
 * API响应结构接口
 *
 * @interface ApiResponse
 */
export interface ApiResponse<T = any> {
    /** 响应数据 */
    data: T | null;
    /** HTTP状态码 */
    status: number;
    /** 响应消息 */
    message: string;
}

/**
 * 验证Bangumi API Token的有效性
 *
 * @async
 * @function verifyToken
 * @param {string} token - 待验证的API Token
 * @returns {Promise<TokenVerifyResult>} 验证结果
 *
 * @description
 * 通过调用 /v0/me 接口验证Token是否有效。
 * 如果Token有效，会自动更新缓存中的用户信息。
 *
 * @example
 * const result = await verifyToken('your-token-here');
 * if (result.valid) {
 *     console.log(`欢迎，${result.username}！`);
 * }
 */
export async function verifyToken(token: string): Promise<TokenVerifyResult> {
    const result: TokenVerifyResult = {
        valid: false,
        userId: '',           // 确保始终为字符串
        username: '',         // 确保始终为字符串
        message: ''
    };

    if (!token) {
        result.message = 'Token 不能为空';
        return result;
    }

    try {
        const xhr = new XMLHttpRequest();

        const response = await new Promise<{ status: number; data: any }>((resolve, reject) => {
            xhr.open('GET', `${BGM_CONFIG.API_BASE}/v0/me`, true);
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.setRequestHeader('Content-Type', 'application/json');

            xhr.onload = () => {
                try {
                    resolve({
                        status: xhr.status,
                        data: xhr.responseText ? JSON.parse(xhr.responseText) : null
                    });
                } catch (e) {
                    reject(new Error('解析响应失败'));
                }
            };

            xhr.onerror = () => reject(new Error('网络错误'));
            xhr.send();
        });

        if (response.status === 200) {
            result.valid = true;
            result.message = 'Token 有效';

            if (response.data) {
                result.userId = String(response.data.id || '');
                result.username = response.data.username || response.data.nickname || '';
            }
        } else if (response.status === 401) {
            result.message = 'Token 无效或已过期';
        } else {
            result.message = `验证失败 (HTTP ${response.status})`;
        }

    } catch (e: any) {
        result.message = e.message || '验证过程出错';
        bgmLog(LOG_LEVELS.ERROR, 'verifyToken error: ' + (e.message || e));
    }

    return result;
}

/**
 * 获取用户的收藏列表
 *
 * @async
 * @function fetchAllUserCollections
 * @param {string} token - API Token
 * @param {string} [userId] - 用户ID（可选，不提供则从Token自动获取）
 * @param {Object} [options] - 可选参数
 * @param {number} [options.limit=30] - 每页数量
 * @param {number} [options.maxTotal=1000] - 最大获取数量
 * @param {Function} [options.onProgress] - 进度回调
 * @returns {Promise<any[]>} 收藏列表
 *
 * @description
 * 从Bangumi API获取用户的收藏列表，支持自动分页。
 * 默认最多获取1000条记录，每页30条。
 *
 * @example
 * const collections = await fetchAllUserCollections(token, '123456', {
 *     onProgress: (page, total) => console.log(`获取第${page}页，共${total}页`)
 * });
 * console.log(`共获取 ${collections.length} 条收藏`);
 */
export async function fetchAllUserCollections(
    token: string,
    userId?: string,
    options?: {
        limit?: number;
        maxTotal?: number;
        onProgress?: (page: number, total: number) => void;
    }
): Promise<any[]> {
    const limit = options?.limit || 30;
    const maxTotal = options?.maxTotal || 1000;

    // 如果没有提供userId，先验证Token获取用户信息
    if (!userId) {
        const verifyResult = await verifyToken(token);
        if (!verifyResult.valid) {
            bgmLog(LOG_LEVELS.ERROR, 'fetchAllUserCollections: Token无效');
            return [];
        }
        userId = verifyResult.userId;
    }

    if (!userId) {
        bgmLog(LOG_LEVELS.ERROR, 'fetchAllUserCollections: 无法获取用户ID');
        return [];
    }

    const allCollections: any[] = [];
    let offset = 0;
    let total = 0;
    let page = 0;

    bgmLog(LOG_LEVELS.INFO, `开始获取用户 ${userId} 的收藏列表`);

    while (offset < maxTotal) {
        page++;

        try {
            const url = `${BGM_CONFIG.API_BASE}/v0/users/${userId}/collections?limit=${limit}&offset=${offset}`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                if (response.status === 429) {
                    // 限流，等待后重试
                    bgmLog(LOG_LEVELS.WARN, 'API限流，等待重试...');
                    await new Promise(resolve => setTimeout(resolve, BGM_CONFIG.REQUEST_DELAY * 2));
                    continue;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            // 首次请求获取总数
            if (total === 0 && data.total) {
                total = Math.min(data.total, maxTotal);
                bgmLog(LOG_LEVELS.INFO, `收藏总数: ${total}`);
            }

            // 添加到结果集
            if (data.data && Array.isArray(data.data)) {
                allCollections.push(...data.data);
                offset += data.data.length;

                // 进度回调
                if (options?.onProgress) {
                    options.onProgress(page, Math.ceil(total / limit));
                }

                // 如果没有更多数据，退出循环
                if (data.data.length < limit || offset >= total) {
                    break;
                }
            } else {
                break;
            }

            // 请求间隔（防止限流）
            await new Promise(resolve => setTimeout(resolve, BGM_CONFIG.REQUEST_DELAY));

        } catch (e: any) {
           bgmLog(LOG_LEVELS.ERROR, 'fetchSubjectCollection error: ' + (e.message || String(e)));
            break;
        }
    }

    bgmLog(LOG_LEVELS.INFO, `获取收藏完成，共 ${allCollections.length} 条`);
    return allCollections;
}

/**
 * 获取单个条目的收藏状态
 *
 * @async
 * @function fetchSubjectCollection
 * @param {string} token - API Token
 * @param {string} subjectId - 条目ID
 * @returns {Promise<ApiResponse>} API响应
 *
 * @description
 * 获取当前用户对特定条目的收藏状态
 *
 * @example
 * const result = await fetchSubjectCollection(token, '123456');
 * if (result.data) {
 *     console.log(`当前状态: ${result.data.type}`);
 * }
 */
export async function fetchSubjectCollection(
    token: string,
    subjectId: string
): Promise<ApiResponse> {
    const result: ApiResponse = {
        data: null,
        status: 0,
        message: ''
    };

    try {
        const response = await fetch(`${BGM_CONFIG.API_BASE}/v0/users/-/collections/${subjectId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        result.status = response.status;

        if (response.ok) {
            result.data = await response.json();
            result.message = 'success';
        } else {
            result.message = `HTTP ${response.status}`;
        }

    } catch (e: any) {
        result.message = e.message || '请求失败';
        bgmLog(LOG_LEVELS.ERROR, 'fetchSubjectCollection error: ' + (e.message || String(e)));
    }

    return result;
}