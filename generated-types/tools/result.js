/**
 * BGM 结果类型
 * @module types/result
 * @description 统一的操作结果类型和错误处理
 */
export class BgmError extends Error {
    code;
    details;
    timestamp;
    constructor(message, code = 'UNKNOWN', details = {}) {
        super(message);
        this.name = 'BgmError';
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }
    toString() {
        return `[${this.code}] ${this.message}`;
    }
}
// ========== Result 类型 ==========
/**
 * 操作结果基类
 */
export class Result {
    success;
    data;
    error;
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
        return Result.fail(new BgmError('API Error', String(code)));
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
export function toSyncResult(result) {
    if (result.success) {
        return { code: 200, message: 'OK', data: result.data };
    }
    return {
        code: result.error?.code ? parseInt(result.error.code) || 0 : 0,
        message: result.error?.message ?? 'Unknown error'
    };
}
