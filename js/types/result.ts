/**
 * BGM 结果类型
 * @module types/result
 * @description 统一的操作结果类型，避免错误处理不一致
 */

/**
 * 操作结果基类
 */
export class Result<T> {
    readonly success: boolean;
    readonly data: T | null;
    readonly error: BgmResultError | null;

    private constructor(success: boolean, data: T | null, error: BgmResultError | null) {
        this.success = success;
        this.data = data;
        this.error = error;
    }

    static ok<T>(data: T): Result<T> {
        return new Result(true, data, null);
    }

    static fail<T>(error: BgmResultError): Result<T> {
        return new Result<T>(false, null, error);
    }

    static fromCode<T>(code: number, data?: T | null): Result<T> {
        if (code >= 200 && code < 300) {
            return Result.ok(data ?? null as T);
        }
        return Result.fail(new BgmResultError(code, 'API Error'));
    }

    isOk(): boolean {
        return this.success;
    }

    isFail(): boolean {
        return !this.success;
    }

    unwrap(): T {
        if (!this.success) {
            throw new Error(this.error?.message ?? 'Result is Fail');
        }
        return this.data as T;
    }

    unwrapOr(defaultValue: T): T {
        return this.success ? (this.data as T) : defaultValue;
    }

    map<U>(fn: (data: T) => U): Result<U> {
        if (this.success) {
            return Result.ok(fn(this.data as T));
        }
        return Result.fail(this.error!);
    }

    mapErr(fn: (error: BgmResultError) => BgmResultError): Result<T> {
        if (!this.success) {
            return Result.fail(fn(this.error!));
        }
        return this;
    }
}

/**
 * BGM 错误类
 */
export class BgmResultError {
    readonly code: number;
    readonly message: string;
    readonly details?: Record<string, unknown>;

    constructor(code: number, message: string, details?: Record<string, unknown>) {
        this.code = code;
        this.message = message;
        this.details = details;
    }

    toString(): string {
        return `[${this.code}] ${this.message}`;
    }

    static fromXhr(xhr: XMLHttpRequest): BgmResultError {
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

    static fromError(error: unknown): BgmResultError {
        if (error instanceof Error) {
            return new BgmResultError(0, error.message);
        }
        return new BgmResultError(0, String(error));
    }
}

/**
 * 同步结果（保持向后兼容）
 */
export interface SyncResult {
    code: number;
    message: string;
    data?: unknown;
}

export function toSyncResult<T>(result: Result<T>): SyncResult {
    if (result.success) {
        return { code: 200, message: 'OK', data: result.data };
    }
    return { code: result.error?.code ?? 0, message: result.error?.message ?? 'Unknown error' };
}
