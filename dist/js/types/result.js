/**
 * BGM 结果类型
 * @module types/result
 * @description 统一的操作结果类型，避免错误处理不一致
 */
/**
 * 操作结果基类
 */
export class Result {
    constructor(success, data, error) {
        this.success = success;
        this.data = data;
        this.error = error;
    }
    static ok(data) {
        return new Result(true, data, null);
    }
    static fail(error) {
        return new Result(false, null, error);
    }
    static fromCode(code, data) {
        if (code >= 200 && code < 300) {
            return Result.ok(data ?? null);
        }
        return Result.fail(new BgmResultError(code, 'API Error'));
    }
    isOk() {
        return this.success;
    }
    isFail() {
        return !this.success;
    }
    unwrap() {
        if (!this.success) {
            throw new Error(this.error?.message ?? 'Result is Fail');
        }
        return this.data;
    }
    unwrapOr(defaultValue) {
        return this.success ? this.data : defaultValue;
    }
    map(fn) {
        if (this.success) {
            return Result.ok(fn(this.data));
        }
        return Result.fail(this.error);
    }
    mapErr(fn) {
        if (!this.success) {
            return Result.fail(fn(this.error));
        }
        return this;
    }
}
/**
 * BGM 错误类
 */
export class BgmResultError {
    constructor(code, message, details) {
        this.code = code;
        this.message = message;
        this.details = details;
    }
    toString() {
        return `[${this.code}] ${this.message}`;
    }
    static fromXhr(xhr) {
        if (xhr.status === 0) {
            return new BgmResultError(0, '网络错误或请求被阻止');
        }
        if (xhr.status === 429) {
            return new BgmResultError(429, '请求过于频繁，请稍后重试');
        }
        if (xhr.status === 401) {
            return new BgmResultError(401, 'Token 无效或已过期');
        }
        if (xhr.status === 403) {
            return new BgmResultError(403, '没有权限执行此操作');
        }
        if (xhr.status === 404) {
            return new BgmResultError(404, '请求的资源不存在');
        }
        if (xhr.status >= 500) {
            return new BgmResultError(xhr.status, '服务器错误，请稍后重试');
        }
        return new BgmResultError(xhr.status, `请求失败: ${xhr.statusText}`);
    }
    static fromError(error) {
        if (error instanceof Error) {
            return new BgmResultError(0, error.message);
        }
        return new BgmResultError(0, String(error));
    }
}
export function toSyncResult(result) {
    if (result.success) {
        return { code: 200, message: 'OK', data: result.data };
    }
    return { code: result.error?.code ?? 0, message: result.error?.message ?? 'Unknown error' };
}
