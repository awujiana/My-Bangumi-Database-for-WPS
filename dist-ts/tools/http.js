/**
 * BGM HTTP 请求模块
 * @module http
 * @description 支持异步请求、进度回调、自动重试、限流处理
 */
import { Result, BgmError, BGM_CONFIG, LOG_LEVELS, bgmLog, BGM } from '../index.js';
const VALID_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
// ========== 内部工具函数 ==========
/**
 * 验证并标准化 HTTP 方法
 */
function validateMethod(method) {
    const upper = method.toUpperCase();
    if (!VALID_METHODS.includes(upper)) {
        throw new BgmError(`无效的 HTTP 方法: ${method}`, 'INVALID_METHOD');
    }
    return upper;
}
/**
 * 验证 endpoint 安全性（防止路径遍历）
 */
function validateEndpoint(endpoint) {
    if (!endpoint || typeof endpoint !== 'string') {
        throw new BgmError('endpoint 无效', 'INVALID_ENDPOINT');
    }
    if (endpoint.includes('..') || endpoint.startsWith('http')) {
        throw new BgmError('endpoint 包含非法字符', 'INVALID_ENDPOINT');
    }
}
/**
 * 异步延迟
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * 根据 HTTP 状态码返回中文错误描述
 */
function getErrorMessage(status) {
    const statusMessages = {
        400: '请求参数错误',
        401: 'Token 无效或已过期',
        403: '没有权限访问该资源',
        404: '请求的资源不存在',
        429: '请求过于频繁，已被限流',
        500: '服务器内部错误',
        502: '网关错误',
        503: '服务暂时不可用',
    };
    return statusMessages[status] || `HTTP 错误 (${status})`;
}
/**
 * 异步发送 HTTP 请求（支持自动重试和进度回调）
 *
 * 类型说明：
 * - 默认 T = unknown，函数不会"伪装"知道响应结构。
 * - 若调用方需要类型化的响应，必须通过 options.zodSchema 提供运行时校验，
 *   否则 data 字段为 unknown，调用方需自行做类型守卫。
 *
 * @returns Promise<Result<{ status: number, data: T | null }>>
 */
export async function httpRequest(endpoint, options = {}) {
    const { method = 'GET', body = null, token, timeout = 30000, retries = BGM_CONFIG.MAX_RETRIES, onProgress, zodSchema, signal, } = options;
    // 输入验证
    try {
        validateEndpoint(endpoint);
        validateMethod(method);
    }
    catch (error) {
        BGM.handleError(error, { context: 'httpRequest', showAlert: false });
        const err = error instanceof BgmError ? error : new BgmError(String(error), 'VALIDATION_ERROR');
        return Result.fail(err);
    }
    // 如果 signal 已 aborted，立即失败，不进入重试循环
    if (signal?.aborted) {
        return Result.fail(new BgmError('请求被取消', 'ABORTED'));
    }
    const validMethod = validateMethod(method);
    let attempt = 0;
    while (attempt <= retries) {
        // 每次重试前再次检查 signal 是否已 aborted
        if (signal?.aborted) {
            return Result.fail(new BgmError('请求被取消', 'ABORTED'));
        }
        try {
            const response = await executeXhrRequest(BGM_CONFIG.API_BASE + endpoint, {
                method: validMethod,
                body,
                timeout,
                ...(token !== undefined && { token }),
                ...(onProgress !== undefined && { onProgress }),
                ...(signal !== undefined && { signal }),
            });
            if (response.status === 204) {
                return Result.ok({ status: 204, data: null });
            }
            if (response.status >= 200 && response.status < 300) {
                // 边界处运行时校验：若提供 zodSchema，则解析得到类型化的 T；
                // 否则保留 unknown，由调用方负责类型守卫。
                if (zodSchema) {
                    try {
                        const parsed = zodSchema.parse(response.data);
                        return Result.ok({ status: response.status, data: parsed });
                    }
                    catch (error) {
                        BGM.handleError(error, { context: 'httpRequest', showAlert: false });
                        const errMsg = error instanceof Error ? error.message : String(error);
                        bgmLog(LOG_LEVELS.WARN, `[HTTP] 响应数据校验失败: ${errMsg}`);
                        return Result.fail(new BgmError(`响应数据校验失败: ${errMsg}`, 'SCHEMA_VALIDATION_ERROR', {
                            endpoint,
                            status: response.status,
                        }));
                    }
                }
                // TODO: 此处 unknown -> T 的单层断言仅为兼容未提供 zodSchema 的调用方。
                //       后续应要求所有调用方提供 zodSchema，从而完全移除此断言。
                return Result.ok({ status: response.status, data: response.data });
            }
            if (response.status === 429 && attempt < retries) {
                attempt++;
                const delayMs = BGM_CONFIG.RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
                bgmLog(LOG_LEVELS.WARN, `API 限流 (429)，第 ${attempt} 次重试，等待 ${delayMs}ms`);
                await sleep(delayMs);
                continue;
            }
            const errorMessage = getErrorMessage(response.status);
            return Result.fail(new BgmError(errorMessage, 'HTTP_ERROR', { status: response.status }));
        }
        catch (error) {
            // 取消导致的失败不重试，直接返回
            if (signal?.aborted) {
                return Result.fail(new BgmError('请求被取消', 'ABORTED'));
            }
            BGM.handleError(error, { context: 'httpRequest', showAlert: false });
            if (attempt < retries) {
                attempt++;
                const delayMs = BGM_CONFIG.RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
                bgmLog(LOG_LEVELS.WARN, `网络错误，第 ${attempt} 次重试，等待 ${delayMs}ms`);
                await sleep(delayMs);
                continue;
            }
            const errMsg = error instanceof Error ? error.message : String(error);
            return Result.fail(new BgmError(errMsg, 'NETWORK_ERROR'));
        }
    }
    return Result.fail(new BgmError('超过最大重试次数', 'MAX_RETRIES_EXCEEDED', { retries, endpoint }));
}
/**
 * 执行单次 XHR 请求并返回响应
 *
 * 注意：此函数返回的 data 类型为 unknown，因为 XHR 响应体本质上是不可信的外部数据，
 * 无法在类型层面保证其结构。调用方（httpRequest）需通过 zodSchema 或类型守卫进行校验。
 */
function executeXhrRequest(url, options) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        bgmLog(LOG_LEVELS.INFO, `[HTTP] ========== 开始请求 ==========`);
        bgmLog(LOG_LEVELS.INFO, `[HTTP] URL: ${url}`);
        bgmLog(LOG_LEVELS.INFO, `[HTTP] 方法: ${options.method}`);
        bgmLog(LOG_LEVELS.INFO, `[HTTP] 超时: ${options.timeout}ms`);
        if (options.token) {
            bgmLog(LOG_LEVELS.INFO, `[HTTP] 请求头: Authorization: Bearer ${options.token.substring(0, 8)}...`);
        }
        if (options.body) {
            bgmLog(LOG_LEVELS.INFO, `[HTTP] 请求体: ${options.body.length > 200 ? options.body.substring(0, 200) + '...' : options.body}`);
        }
        const xhr = new XMLHttpRequest();
        xhr.open(options.method, url, true);
        xhr.timeout = options.timeout;
        // AbortSignal 支持：已 aborted 立即 reject；否则监听 abort 事件
        if (options.signal) {
            if (options.signal.aborted) {
                reject(new Error('请求被取消'));
                return;
            }
            options.signal.addEventListener('abort', () => {
                xhr.abort();
            });
        }
        // 设置请求头
        if (options.token) {
            xhr.setRequestHeader('Authorization', `Bearer ${options.token}`);
        }
        if (options.body) {
            xhr.setRequestHeader('Content-Type', 'application/json');
            bgmLog(LOG_LEVELS.INFO, `[HTTP] 请求头: Content-Type: application/json`);
        }
        // 响应处理
        xhr.onload = () => {
            const duration = Date.now() - startTime;
            bgmLog(LOG_LEVELS.INFO, `[HTTP] ========== 请求完成 ==========`);
            bgmLog(LOG_LEVELS.INFO, `[HTTP] URL: ${url}`);
            bgmLog(LOG_LEVELS.INFO, `[HTTP] HTTP 状态码: ${xhr.status} (${xhr.statusText})`);
            bgmLog(LOG_LEVELS.INFO, `[HTTP] 请求耗时: ${duration}ms`);
            if (xhr.getAllResponseHeaders()) {
                bgmLog(LOG_LEVELS.INFO, `[HTTP] 响应头: ${xhr.getAllResponseHeaders()}`);
            }
            // data 始终为 unknown：JSON.parse 的返回值或原始 responseText 均不可信，
            // 必须由上层 httpRequest 通过 zodSchema 校验后才能缩窄为具体类型。
            let data = null;
            if (xhr.responseText && xhr.responseText.length > 0) {
                try {
                    data = JSON.parse(xhr.responseText);
                    bgmLog(LOG_LEVELS.INFO, `[HTTP] 响应数据: ${JSON.stringify(data).length > 500 ? JSON.stringify(data).substring(0, 500) + '...' : JSON.stringify(data)}`);
                }
                catch (error) {
                    BGM.handleError(error, { context: 'executeXhrRequest', showAlert: false });
                    bgmLog(LOG_LEVELS.WARN, `[HTTP] 解析响应失败，返回原始文本: ${xhr.responseText.length > 200 ? xhr.responseText.substring(0, 200) + '...' : xhr.responseText}`);
                    // responseText 是 string，可直接赋值给 unknown，无需任何断言
                    data = xhr.responseText;
                }
            }
            if (xhr.status >= 200 && xhr.status < 300) {
                bgmLog(LOG_LEVELS.INFO, `[HTTP] 请求成功`);
            }
            else {
                bgmLog(LOG_LEVELS.WARN, `[HTTP] 请求失败，状态码: ${xhr.status}`);
            }
            resolve({ status: xhr.status, xhr, data });
        };
        // 错误处理
        xhr.onerror = () => {
            const duration = Date.now() - startTime;
            bgmLog(LOG_LEVELS.ERROR, `[HTTP] 请求发生网络错误，URL: ${url}，耗时: ${duration}ms`);
            reject(new Error(`网络请求失败: ${url}`));
        };
        xhr.ontimeout = () => {
            const duration = Date.now() - startTime;
            bgmLog(LOG_LEVELS.WARN, `[HTTP] 请求超时，URL: ${url}，耗时: ${duration}ms`);
            reject(new Error(`请求超时 (${options.timeout}ms): ${url}`));
        };
        // 上传进度
        if (options.onProgress && xhr.upload) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    options.onProgress(e.loaded, e.total);
                    const progress = Math.round((e.loaded / e.total) * 100);
                    bgmLog(LOG_LEVELS.INFO, `[HTTP] 上传进度: ${progress}% (${e.loaded}/${e.total})`);
                }
            };
        }
        // 发送请求
        try {
            bgmLog(LOG_LEVELS.INFO, `[HTTP] 正在发送请求...`);
            xhr.send(options.body);
        }
        catch (error) {
            BGM.handleError(error, { context: 'executeXhrRequest', showAlert: false });
            const errMsg = error instanceof Error ? error.message : String(error);
            bgmLog(LOG_LEVELS.ERROR, `[HTTP] 发送请求失败: ${errMsg}`);
            reject(new Error(`发送请求失败: ${errMsg}`));
        }
    });
}
// ========== 便捷方法 ==========
/**
 * GET 请求
 * @example httpGet<UserInfo>('/v0/me', token)
 */
export const httpGet = (endpoint, token) => httpRequest(endpoint, { method: 'GET', ...(token !== undefined && { token }) });
/**
 * POST 请求
 * @example httpPost('/v0/users/123/collections', jsonBody, token)
 */
export const httpPost = (endpoint, body, token) => httpRequest(endpoint, { method: 'POST', body, ...(token !== undefined && { token }) });
/**
 * PUT 请求
 */
export const httpPut = (endpoint, body, token) => httpRequest(endpoint, { method: 'PUT', body, ...(token !== undefined && { token }) });
/**
 * DELETE 请求
 */
export const httpDelete = (endpoint, token) => httpRequest(endpoint, { method: 'DELETE', ...(token !== undefined && { token }) });
