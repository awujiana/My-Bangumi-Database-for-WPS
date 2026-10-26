/**
 * @fileoverview Bangumi数据拉取模块
 * @module sync/scraping
 * @description 从Bangumi API获取用户收藏数据并同步到Excel的工作逻辑。
 *              支持Token验证、收藏列表获取等功能。
 *
 * @author BGM Development Team
 * @version 1.1.0 (优化版)
 */
import { BGM_CONFIG, LOG_LEVELS } from '../core/constants.js';
import { bgmLog } from '../tools/util/index.js';
import { requestBgmMeRaw } from '../tools/util/bgm-me.js';
/**
 * 执行HTTP请求的通用Promise封装
 * @param xhr 已配置好的 XMLHttpRequest 对象
 * @param signal 可选 AbortSignal，用于取消请求
 */
function requestPromise(xhr, signal) {
    const startTime = Date.now();
    if (!xhr.timeout)
        xhr.timeout = 30_000;
    return new Promise((resolve, reject) => {
        // 如果 signal 已 aborted，立即 reject
        if (signal?.aborted) {
            reject(new Error('请求被取消'));
            return;
        }
        // AbortSignal 支持：监听 abort 事件触发 xhr.abort()，并在请求结束后移除监听器。
        // 只 add 不 remove 会泄漏：同一 signal 被反复取消/重试时监听器持续累积
        // （修法同 sync/jsonl-response.ts 的 createRawTextFetcher）。
        let abortHandler = null;
        const removeAbortHandler = () => {
            if (!(abortHandler && signal)) {
                return;
            }
            signal.removeEventListener('abort', abortHandler);
            abortHandler = null;
        };
        if (signal) {
            abortHandler = () => {
                xhr.abort();
            };
            signal.addEventListener('abort', abortHandler);
        }
        xhr.addEventListener('load', () => {
            removeAbortHandler();
            const duration = Date.now() - startTime;
            bgmLog(LOG_LEVELS.INFO, `[scraping] HTTP ${String(xhr.status)} (${xhr.statusText}), 耗时: ${String(duration)}ms`);
            try {
                const responseData = xhr.responseText ? JSON.parse(xhr.responseText) : null;
                resolve({ status: xhr.status, data: responseData, responseText: xhr.responseText });
            }
            catch {
                reject(new Error('解析响应失败'));
            }
        });
        xhr.addEventListener('error', () => {
            removeAbortHandler();
            // 如果是 abort 导致的 onerror，归类为取消
            reject(new Error(signal?.aborted ? '请求被取消' : '网络错误'));
        });
        xhr.ontimeout = () => {
            removeAbortHandler();
            reject(new Error('请求超时'));
        };
        xhr.send();
    });
}
function xhrGet(url, token, signal) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 30_000;
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    return requestPromise(xhr, signal);
}
/** 管道失败分类 → 旧 `requestPromise` 的 `Error.message`（`verifyToken` catch 文案逐字保留） */
const RAW_FAILURE_MESSAGES = {
    aborted: '请求被取消',
    network: '网络错误',
    timeout: '请求超时',
};
/**
 * 验证Bangumi API Token的有效性
 *
 * @async
 * @function verifyToken
 * @param {string} token - 待验证的API Token
 * @param {AbortSignal} [signal] - 可选 AbortSignal，用于取消请求
 * @returns {Promise<TokenVerifyResult>} 验证结果
 *
 * @description
 * 通过调用 /v0/me 接口验证Token是否有效。
 * 如果Token有效，会自动更新缓存中的用户信息。
 *
 * **§5.6 C2**：`GET /v0/me` 的 XHR 管道委托 `requestBgmMeRaw`（与 `fetchBgmMe`
 * 共用唯一实现），但**必须显式传入待验证的 token**——`fetchBgmMe` 读的是
 * 「已存 token」，而本函数验证的可能是尚未保存的测试 Token；这正是两处长期没能
 * 合并的语义差异，靠参数化保留。超时 30s 沿用原 `requestPromise` 的默认值，
 * 失败文案与其 `Error.message` 逐字一致。
 */
export async function verifyToken(token, signal) {
    const result = { valid: false, message: '' };
    if (!token) {
        result.message = 'Token 不能为空';
        return result;
    }
    const apiUrl = `${BGM_CONFIG.API_BASE}/v0/me`;
    bgmLog(LOG_LEVELS.INFO, `[scraping/verifyToken] 验证 Token: ${apiUrl}`);
    let raw;
    try {
        raw = await requestBgmMeRaw(token, { timeout: 30_000, signal });
    }
    catch (error) {
        // 宿主在请求建立阶段同步抛错（如 setRequestHeader 抛非 Error）：沿用旧 catch 口径
        const errorMessage = error instanceof Error ? error.message : '';
        result.message = errorMessage || '验证过程出错';
        bgmLog(LOG_LEVELS.ERROR, `[scraping/verifyToken] error: ${result.message}`);
        return result;
    }
    if (raw.kind === 'ok') {
        try {
            // 200 但响应体为空 → null（与旧 requestPromise 的 `responseText ? JSON.parse : null` 一致）
            const userData = raw.responseText
                ? JSON.parse(raw.responseText)
                : null;
            result.valid = true;
            result.message = 'Token 有效';
            bgmLog(LOG_LEVELS.INFO, `[scraping/verifyToken] Token 验证成功，用户ID: ${String(userData?.id ?? '未知')}`);
            if (userData) {
                result.userId = String(userData.id || '');
                result.username = (userData.username || userData.nickname) ?? '';
            }
        }
        catch {
            // 200 但响应体不是合法 JSON：与旧 requestPromise 的 reject('解析响应失败') 一致
            result.message = '解析响应失败';
            bgmLog(LOG_LEVELS.ERROR, `[scraping/verifyToken] error: ${result.message}`);
        }
        return result;
    }
    if (raw.kind === 'http') {
        if (raw.status === 401) {
            result.message = 'Token 无效或已过期';
            bgmLog(LOG_LEVELS.WARN, `[scraping/verifyToken] Token 无效或已过期`);
        }
        else {
            result.message = `验证失败 (HTTP ${String(raw.status)})`;
            bgmLog(LOG_LEVELS.ERROR, `[scraping/verifyToken] 验证失败，HTTP ${String(raw.status)}`);
        }
        return result;
    }
    result.message = RAW_FAILURE_MESSAGES[raw.kind];
    bgmLog(LOG_LEVELS.ERROR, `[scraping/verifyToken] error: ${result.message}`);
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
    const limit = options?.limit ?? 30;
    const maxTotal = options?.maxTotal ?? 1000;
    const typeMap = { wish: 1, collect: 2, do: 3 };
    const typeNumber = options?.type ? typeMap[options.type] : null;
    let resolvedUserId = userId;
    if (!resolvedUserId) {
        const verifyResult = await verifyToken(token);
        if (!verifyResult.valid) {
            bgmLog(LOG_LEVELS.ERROR, '[fetchAllUserCollections] Token无效');
            return [];
        }
        resolvedUserId = verifyResult.userId;
    }
    if (!resolvedUserId) {
        bgmLog(LOG_LEVELS.ERROR, '[fetchAllUserCollections] 无法获取用户ID');
        return [];
    }
    const allCollections = [];
    let offset = 0;
    let total = 0;
    let retryCount = 0;
    const MAX_RETRY_COUNT = BGM_CONFIG.MAX_RETRIES;
    bgmLog(LOG_LEVELS.INFO, `[fetchAllUserCollections] 开始获取用户 ${resolvedUserId} 的收藏列表`);
    // 单页请求逻辑（从 while 循环中上提，避免每次迭代重建闭包）
    const fetchCollectionsPage = async () => {
        const typeParameter = typeNumber === null ? '' : `&type=${String(typeNumber ?? '')}`;
        const url = `${BGM_CONFIG.API_BASE}/v0/users/${resolvedUserId}/collections?limit=${String(limit)}&offset=${String(offset)}${typeParameter}`;
        const xhrResult = await xhrGet(url, token);
        const isHttpError = xhrResult.status < 200 || xhrResult.status >= 300;
        const isRateLimited = xhrResult.status === 429;
        if (isHttpError) {
            if (isRateLimited && retryCount < MAX_RETRY_COUNT) {
                retryCount += 1;
                const delayMs = BGM_CONFIG.RETRY_DELAY_BASE * 2 ** (retryCount - 1);
                bgmLog(LOG_LEVELS.WARN, `[fetchAllUserCollections] API限流，第 ${String(retryCount)} 次重试，等待 ${String(delayMs)}ms...`);
                await new Promise((resolve) => {
                    setTimeout(resolve, delayMs);
                });
                // 限流重试：保持 offset 不变，直接进入下一轮重新请求同一分页，
                // 且不走末尾的 REQUEST_DELAY（重试延时已单独等待）。原为 continue。
            }
            else if (isRateLimited) {
                throw new Error(`HTTP 429：请求过于频繁，已超过最大重试次数`);
            }
            else {
                throw new Error(`HTTP ${String(xhrResult.status)}`);
            }
        }
        else {
            // 成功请求后重置重试计数
            retryCount = 0;
            const data = xhrResult.data;
            if (total === 0 && data.total) {
                total = Math.min(data.total, maxTotal);
                bgmLog(LOG_LEVELS.INFO, `[fetchAllUserCollections] 收藏总数: ${String(total)}`);
            }
            if (data.data && Array.isArray(data.data)) {
                allCollections.push(...data.data);
                offset += data.data.length;
                if (options?.onProgress) {
                    options.onProgress(Math.ceil(offset / limit), Math.ceil(total / limit));
                }
                if (data.data.length < limit || offset >= total) {
                    return 'break';
                }
            }
            else {
                return 'break';
            }
            await new Promise((resolve) => {
                setTimeout(resolve, BGM_CONFIG.REQUEST_DELAY);
            });
        }
        return undefined;
    };
    while (offset < maxTotal) {
        try {
            if ((await fetchCollectionsPage()) === 'break')
                break;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : undefined;
            bgmLog(LOG_LEVELS.ERROR, `[fetchAllUserCollections] 请求失败: ${errorMessage ?? ''}`);
            break;
        }
    }
    bgmLog(LOG_LEVELS.INFO, `[fetchAllUserCollections] 获取完成，共 ${String(allCollections.length)} 条`);
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
        const xhrResult = await xhrGet(url, token);
        result.status = xhrResult.status;
        if (xhrResult.status >= 200 && xhrResult.status < 300) {
            result.data = xhrResult.data;
            result.message = 'success';
        }
        else {
            result.message = `HTTP ${String(xhrResult.status)}`;
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : '';
        result.message = errorMessage || '请求失败';
        bgmLog(LOG_LEVELS.ERROR, `[fetchSubjectCollection] 请求失败: ${result.message}`);
    }
    return result;
}
