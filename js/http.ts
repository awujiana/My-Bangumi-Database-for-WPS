/**
 * BGM HTTP 请求模块 - 支持异步和进度回调
 */
import { BGM_CONFIG } from './core/constants.js';
import { Result, BgmError, SyncResult } from './types/result.js';
import { bgmLog, LOG_LEVELS } from './util.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type SyncProgressCallback = (current: number, total: number, message: string) => void;

const VALID_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

function validateMethod(method: string): HttpMethod {
    const upper = method.toUpperCase() as HttpMethod;
    if (!VALID_METHODS.includes(upper)) throw new BgmError(0, `无效的 HTTP 方法: ${method}`);
    return upper;
}

function validateEndpoint(endpoint: string): void {
    if (!endpoint || typeof endpoint !== 'string') throw new BgmError(0, 'endpoint 无效');
    if (endpoint.includes('..') || endpoint.startsWith('http')) throw new BgmError(0, 'endpoint 包含非法字符');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== 异步 HTTP 请求 ==========
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
    const { method = 'GET', body = null, token, timeout = 30000, retries = BGM_CONFIG.MAX_RETRIES, onProgress } = options;

    validateEndpoint(endpoint);
    const validMethod = validateMethod(method);
    let attempt = 0;

    while (attempt <= retries) {
        try {
            const response = await fetchWithProgress<T>(BGM_CONFIG.API_BASE + endpoint, {
                method: validMethod, body, token, timeout, onProgress
            });

            if (response.status === 204) return Result.ok({ status: 204, data: null });
            if (response.status >= 200 && response.status < 300) return Result.ok(response);

            if (response.status === 429 && attempt < retries) {
                attempt++;
                await sleep(BGM_CONFIG.RETRY_DELAY_BASE * Math.pow(2, attempt - 1));
                continue;
            }

            return Result.fail(BgmError.fromXhr(response.xhr));
        } catch (error) {
            if (attempt < retries) {
                attempt++;
                continue;
            }
            return Result.fail(BgmError.fromError(error));
        }
    }
    return Result.fail(new BgmError(0, '超过最大重试次数'));
}

function fetchWithProgress<T>(url: string, options: {
    method: string; body: string | null; token?: string;
    timeout: number; onProgress?: (current: number, total: number) => void;
}): Promise<{ status: number; xhr: XMLHttpRequest; data: T | null }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(options.method, url, true);
        xhr.timeout = options.timeout;
        if (options.token) xhr.setRequestHeader("Authorization", "Bearer " + options.token);
        xhr.setRequestHeader("Content-Type", "application/json");

        xhr.onload = () => {
            let data: T | null = null;
            if (xhr.responseText) {
                try { data = JSON.parse(xhr.responseText); } catch { data = xhr.responseText as unknown as T; }
            }
            resolve({ status: xhr.status, xhr, data });
        };
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.ontimeout = () => reject(new Error('请求超时'));

        if (options.onProgress) {
            xhr.upload.onprogress = (e) => { if (e.lengthComputable) options.onProgress!(e.loaded, e.total); };
        }

        xhr.send(options.body);
    });
}

// ========== 便捷方法 ==========
export const httpGet = <T = unknown>(endpoint: string, token?: string) => httpRequest<T>(endpoint, { method: 'GET', token });
export const httpPost = <T = unknown>(endpoint: string, body: string, token?: string) => httpRequest<T>(endpoint, { method: 'POST', body, token });
export const httpPut = <T = unknown>(endpoint: string, body: string, token?: string) => httpRequest<T>(endpoint, { method: 'PUT', body, token });
export const httpDelete = <T = unknown>(endpoint: string, token?: string) => httpRequest<T>(endpoint, { method: 'DELETE', token });

// ========== 同步版本（向后兼容）==========
export function httpRequestSync(method: string, endpoint: string, body: string | null, token: string, options: { retries?: number } = {}): SyncResult {
    validateEndpoint(endpoint);
    const validMethod = validateMethod(method);
    let retriesCount = 0;
    const retries = options.retries ?? BGM_CONFIG.MAX_RETRIES;

    while (retriesCount <= retries) {
        const xhr = new XMLHttpRequest();
        xhr.open(validMethod, BGM_CONFIG.API_BASE + endpoint, false);
        xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.setRequestHeader("Content-Type", "application/json");
        try {
            xhr.send(body);
            if (xhr.status === 204) return { code: 204, message: "OK" };
            if (xhr.status >= 200 && xhr.status < 300) return { code: xhr.status, message: xhr.responseText };
            if (xhr.status === 429 && retriesCount < retries) {
                retriesCount++;
                sleep(BGM_CONFIG.RETRY_DELAY_BASE * Math.pow(2, retriesCount - 1));
                continue;
            }
            return { code: xhr.status, message: xhr.responseText || "Error" };
        } catch (err) {
            return { code: 0, message: "Error: " + (err as Error).message };
        }
    }
    return { code: 429, message: `超过最大重试次数(${retries}次)` };
}

export { toSyncResult } from './types/result.js';
