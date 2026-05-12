/**
 * BGM HTTP 请求模块
 * @module http
 * @description 支持异步请求、进度回调、自动重试、限流处理
 */


import { Result, BgmError, BGM_CONFIG, LOG_LEVELS, bgmLog, BGM } from '../index.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type SyncProgressCallback = (current: number, total: number, message: string) => void;

const VALID_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

// ========== 内部工具函数 ==========

/**
 * 验证并标准化 HTTP 方法
 */
function validateMethod(method: string): HttpMethod {
    const upper = method.toUpperCase() as HttpMethod;
    if (!VALID_METHODS.includes(upper)) {
        throw new BgmError(`无效的 HTTP 方法: ${method}`, 'INVALID_METHOD');
    }
    return upper;
}

/**
 * 验证 endpoint 安全性（防止路径遍历）
 */

function validateEndpoint(endpoint: string): void {
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
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 根据 HTTP 状态码返回中文错误描述
 */
function getErrorMessage(status: number): string {
    const statusMessages: Record<number, string> = {
        400: '请求参数错误',
        401: 'Token 无效或已过期',
        403: '没有权限访问该资源',
        404: '请求的资源不存在',
        429: '请求过于频繁，已被限流',
        500: '服务器内部错误',
        502: '网关错误',
        503: '服务暂时不可用'
    };
    return statusMessages[status] || `HTTP 错误 (${status})`;
}

// ========== 异步 HTTP 请求（带进度） ==========

/**
 * 异步发送 HTTP 请求（支持自动重试和进度回调）
 * @returns Promise<Result<{ status: number, data: T | null }>>
 */
export async function httpRequest<T = unknown>(
    endpoint: string,
    options: {
        method?: HttpMethod;
        body?: string | null;
        token?: string;
        timeout?: number;
        retries?: number;
        onProgress?: (current: number, total: number) => void;
    } = {}
): Promise<Result<{ status: number; data: T | null }>> {
    const {
        method = 'GET',
        body = null,
        token,
        timeout = 30000,
        retries = BGM_CONFIG.MAX_RETRIES,
        onProgress
    } = options;

    // 输入验证
    try {
        validateEndpoint(endpoint);
        validateMethod(method);
    } catch (error: any) {
        BGM.handleError(error, { context: 'httpRequest', showAlert: false });
        const err = error instanceof BgmError ? error : new BgmError(String(error), 'VALIDATION_ERROR');
        return Result.fail(err);

    }

    const validMethod = validateMethod(method);
    let attempt = 0;

    while (attempt <= retries) {
        try {
            const response = await executeXhrRequest<T>(BGM_CONFIG.API_BASE + endpoint, {
                method: validMethod, body, token, timeout, onProgress
            });

            if (response.status === 204) {
                return Result.ok({ status: 204, data: null });
            }
            if (response.status >= 200 && response.status < 300) {
                return Result.ok(response);
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

        } catch (error: any) {
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
 */
function executeXhrRequest<T>(
    url: string,
    options: {
        method: string;
        body: string | null;
        token?: string;
        timeout: number;
        onProgress?: (current: number, total: number) => void;
    }
): Promise<{ status: number; xhr: XMLHttpRequest; data: T | null }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(options.method, url, true);
        xhr.timeout = options.timeout;

        // 设置请求头
        if (options.token) {
            xhr.setRequestHeader('Authorization', `Bearer ${options.token}`);
        }
        if (options.body) {
            xhr.setRequestHeader('Content-Type', 'application/json');
        }

        // 响应处理
        xhr.onload = () => {
            let data: T | null = null;
            if (xhr.responseText && xhr.responseText.length > 0) {
                try {
                    data = JSON.parse(xhr.responseText);
                } catch (error: any) {
                    BGM.handleError(error, { context: 'executeXhrRequest', showAlert: false });
                    data = xhr.responseText as unknown as T;
                }
            }
            resolve({ status: xhr.status, xhr, data });
        };

        // 错误处理
        xhr.onerror = () => {
            reject(new Error(`网络请求失败: ${url}`));
        };

        xhr.ontimeout = () => {
            reject(new Error(`请求超时 (${options.timeout}ms): ${url}`));
        };

        // 上传进度
        if (options.onProgress && xhr.upload) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    options.onProgress!(e.loaded, e.total);
                }
            };
        }

        // 发送请求
        try {
            xhr.send(options.body);
        } catch (error: any) {
            BGM.handleError(error, { context: 'executeXhrRequest', showAlert: false });
            reject(new Error(`发送请求失败: ${error.message}`));
        }
    });
}

// ========== 便捷方法 ==========

/**
 * GET 请求
 * @example httpGet<UserInfo>('/v0/me', token)
 */
export const httpGet = <T = unknown>(endpoint: string, token?: string) =>
    httpRequest<T>(endpoint, { method: 'GET', token });

/**
 * POST 请求
 * @example httpPost('/v0/users/123/collections', jsonBody, token)
 */
export const httpPost = <T = unknown>(endpoint: string, body: string, token?: string) =>
    httpRequest<T>(endpoint, { method: 'POST', body, token });

/**
 * PUT 请求
 */
export const httpPut = <T = unknown>(endpoint: string, body: string, token?: string) =>
    httpRequest<T>(endpoint, { method: 'PUT', body, token });

/**
 * DELETE 请求
 */
export const httpDelete = <T = unknown>(endpoint: string, token?: string) =>
    httpRequest<T>(endpoint, { method: 'DELETE', token });

