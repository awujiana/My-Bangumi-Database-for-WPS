/**
 * @fileoverview Bangumi数据拉取模块
 * @module sync/scraping
 * @description 从Bangumi API获取用户收藏数据并同步到Excel的工作逻辑。
 *              支持Token验证、收藏列表获取等功能。
 *
 * @author BGM Development Team
 * @version 1.1.0 (优化版)
 */
import { BGM_CONFIG, LOG_LEVELS, bgmLog } from '../index.js';
/**
 * 提取响应消息
 */
function extractResponseMessage(data) {
    return data?.msg || data?.message || data?.error || 'success';
}
/**
 * 执行HTTP请求的通用Promise封装
 */
function requestPromise(xhr) {
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
        xhr.onload = () => {
            const duration = Date.now() - startTime;
            bgmLog(LOG_LEVELS.INFO, `[scraping] HTTP ${xhr.status} (${xhr.statusText}), 耗时: ${duration}ms`);
            try {
                const responseData = xhr.responseText ? JSON.parse(xhr.responseText) : null;
                resolve({ status: xhr.status, data: responseData, responseText: xhr.responseText });
            }
            catch {
                reject(new Error('解析响应失败'));
            }
        };
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.ontimeout = () => reject(new Error('请求超时'));
        xhr.send();
    });
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
 */
export async function verifyToken(token) {
    const result = { valid: false, message: '' };
    if (!token) {
        result.message = 'Token 不能为空';
        return result;
    }
    try {
        const apiUrl = `${BGM_CONFIG.API_BASE}/v0/me`;
        bgmLog(LOG_LEVELS.INFO, `[scraping/verifyToken] 验证 Token: ${apiUrl}`);
        const xhr = new XMLHttpRequest();
        xhr.open('GET', apiUrl, true);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Content-Type', 'application/json');
        const response = await requestPromise(xhr);
        if (response.status === 200) {
            result.valid = true;
            result.message = 'Token 有效';
            bgmLog(LOG_LEVELS.INFO, `[scraping/verifyToken] Token 验证成功，用户ID: ${response.data?.id || '未知'}`);
            if (response.data) {
                result.userId = String(response.data.id || '');
                result.username = response.data.username || response.data.nickname || '';
            }
        }
        else if (response.status === 401) {
            result.message = 'Token 无效或已过期';
            bgmLog(LOG_LEVELS.WARN, `[scraping/verifyToken] Token 无效或已过期`);
        }
        else {
            result.message = `验证失败 (HTTP ${response.status})`;
            bgmLog(LOG_LEVELS.ERROR, `[scraping/verifyToken] 验证失败，HTTP ${response.status}`);
        }
    }
    catch (e) {
        result.message = e.message || '验证过程出错';
        bgmLog(LOG_LEVELS.ERROR, `[scraping/verifyToken] error: ${result.message}`);
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
 * @returns {Promise<CollectionItem[]>} 收藏列表
 */
export async function fetchAllUserCollections(token, userId, options) {
    const limit = options?.limit || 30;
    const maxTotal = options?.maxTotal || 1000;
    if (!userId) {
        const verifyResult = await verifyToken(token);
        if (!verifyResult.valid) {
            bgmLog(LOG_LEVELS.ERROR, '[fetchAllUserCollections] Token无效');
            return [];
        }
        userId = verifyResult.userId;
    }
    if (!userId) {
        bgmLog(LOG_LEVELS.ERROR, '[fetchAllUserCollections] 无法获取用户ID');
        return [];
    }
    const allCollections = [];
    let offset = 0;
    let total = 0;
    bgmLog(LOG_LEVELS.INFO, `[fetchAllUserCollections] 开始获取用户 ${userId} 的收藏列表`);
    while (offset < maxTotal) {
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
                    bgmLog(LOG_LEVELS.WARN, '[fetchAllUserCollections] API限流，等待重试...');
                    await new Promise(resolve => setTimeout(resolve, BGM_CONFIG.REQUEST_DELAY * 2));
                    continue;
                }
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            if (total === 0 && data.total) {
                total = Math.min(data.total, maxTotal);
                bgmLog(LOG_LEVELS.INFO, `[fetchAllUserCollections] 收藏总数: ${total}`);
            }
            if (data.data && Array.isArray(data.data)) {
                allCollections.push(...data.data);
                offset += data.data.length;
                if (options?.onProgress) {
                    options.onProgress(Math.ceil(offset / limit), Math.ceil(total / limit));
                }
                if (data.data.length < limit || offset >= total) {
                    break;
                }
            }
            else {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, BGM_CONFIG.REQUEST_DELAY));
        }
        catch (e) {
            bgmLog(LOG_LEVELS.ERROR, `[fetchAllUserCollections] 请求失败: ${e.message}`);
            break;
        }
    }
    bgmLog(LOG_LEVELS.INFO, `[fetchAllUserCollections] 获取完成，共 ${allCollections.length} 条`);
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
 */
export async function fetchSubjectCollection(token, subjectId) {
    const result = { data: null, status: 0, message: '' };
    try {
        const url = `${BGM_CONFIG.API_BASE}/v0/users/-/collections/${subjectId}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        result.status = response.status;
        if (response.ok) {
            result.data = await response.json();
            result.message = 'success';
        }
        else {
            result.message = `HTTP ${response.status}`;
        }
    }
    catch (e) {
        result.message = e.message || '请求失败';
        bgmLog(LOG_LEVELS.ERROR, `[fetchSubjectCollection] 请求失败: ${result.message}`);
    }
    return result;
}
