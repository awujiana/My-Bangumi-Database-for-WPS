import { BGM_CONFIG, LOG_LEVELS } from './core/constants.js';
import { bgmLog } from './util.js';
import { Result, BgmError, toSyncResult } from './types/index.js';
const VALID_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
function validateMethod(method) {
    const upper = method.toUpperCase();
    if (!VALID_METHODS.includes(upper)) {
        throw new BgmError(`无效的 HTTP 方法: ${method}`, 'INVALID_METHOD');
    }
    return upper;
}
function validateEndpoint(endpoint) {
    if (!endpoint || typeof endpoint !== 'string') {
        throw new BgmError('endpoint 无效', 'INVALID_ENDPOINT');
    }
    if (endpoint.includes('..') || endpoint.startsWith('http')) {
        throw new BgmError('endpoint 包含非法字符', 'INVALID_ENDPOINT');
    }
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function getErrorMessage(status) {
    const statusMessages = {
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
export async function httpRequest(endpoint, options = {}) {
    const { method = 'GET', body = null, token, timeout = 30000, retries = BGM_CONFIG.MAX_RETRIES, onProgress } = options;
    try {
        validateEndpoint(endpoint);
        validateMethod(method);
    }
    catch (error) {
        return Result.fail(error instanceof BgmError ? error : new BgmError(String(error), 'VALIDATION_ERROR'));
    }
    const validMethod = validateMethod(method);
    let attempt = 0;
    while (attempt <= retries) {
        try {
            const response = await executeXhrRequest(BGM_CONFIG.API_BASE + endpoint, {
                method: validMethod,
                body,
                token,
                timeout,
                onProgress
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
            const details = { status: response.status };
            if (response.xhr) {
                details.xhrStatus = response.xhr.status;
            }
            return Result.fail(new BgmError(errorMessage, 'HTTP_ERROR', details));
        }
        catch (error) {
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
    return Result.fail(new BgmError('超过最大重试次数', 'MAX_RETRIES_EXCEEDED', {
        retries,
        endpoint
    }));
}
function executeXhrRequest(url, options) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(options.method, url, true);
        xhr.timeout = options.timeout;
        if (options.token) {
            xhr.setRequestHeader('Authorization', `Bearer ${options.token}`);
        }
        if (options.body) {
            xhr.setRequestHeader('Content-Type', 'application/json');
        }
        xhr.onload = () => {
            let data = null;
            if (xhr.responseText && xhr.responseText.length > 0) {
                try {
                    data = JSON.parse(xhr.responseText);
                }
                catch {
                    data = xhr.responseText;
                }
            }
            resolve({ status: xhr.status, xhr, data });
        };
        xhr.onerror = () => {
            reject(new Error(`网络请求失败: ${url}`));
        };
        xhr.ontimeout = () => {
            reject(new Error(`请求超时 (${options.timeout}ms): ${url}`));
        };
        if (options.onProgress && xhr.upload) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    options.onProgress(e.loaded, e.total);
                }
            };
        }
        try {
            xhr.send(options.body);
        }
        catch (error) {
            reject(new Error(`发送请求失败: ${error.message}`));
        }
    });
}
export const httpGet = (endpoint, token) => httpRequest(endpoint, { method: 'GET', token });
export const httpPost = (endpoint, body, token) => httpRequest(endpoint, { method: 'POST', body, token });
export const httpPut = (endpoint, body, token) => httpRequest(endpoint, { method: 'PUT', body, token });
export const httpDelete = (endpoint, token) => httpRequest(endpoint, { method: 'DELETE', token });
export function httpRequestSync(method, endpoint, body, token, options = {}) {
    try {
        validateEndpoint(endpoint);
        validateMethod(method);
    }
    catch (error) {
        return {
            code: 0,
            message: error instanceof Error ? error.message : String(error)
        };
    }
    const validMethod = validateMethod(method);
    let retriesCount = 0;
    const maxRetries = options.retries ?? BGM_CONFIG.MAX_RETRIES;
    while (retriesCount <= maxRetries) {
        const xhr = new XMLHttpRequest();
        xhr.open(validMethod, BGM_CONFIG.API_BASE + endpoint, false);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        if (body) {
            xhr.setRequestHeader('Content-Type', 'application/json');
        }
        try {
            xhr.send(body);
            if (xhr.status === 204) {
                return { code: 204, message: 'OK' };
            }
            if (xhr.status >= 200 && xhr.status < 300) {
                return { code: xhr.status, message: xhr.responseText };
            }
            if (xhr.status === 429 && retriesCount < maxRetries) {
                retriesCount++;
                const delayMs = BGM_CONFIG.RETRY_DELAY_BASE * Math.pow(2, retriesCount - 1);
                bgmLog(LOG_LEVELS.WARN, `同步请求限流(429)，第 ${retriesCount} 次重试，等待 ${delayMs}ms`);
                const end = Date.now() + delayMs;
                while (Date.now() < end) { }
                continue;
            }
            const errorMessage = getErrorMessage(xhr.status);
            return {
                code: xhr.status,
                message: errorMessage + (xhr.responseText ? `: ${xhr.responseText}` : '')
            };
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            return { code: 0, message: `请求异常: ${errorMsg}` };
        }
    }
    return { code: 429, message: `超过最大重试次数 (${maxRetries} 次)` };
}
export { toSyncResult };
