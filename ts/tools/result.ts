/**
 * BGM 结果类型
 * @module types/result
 * @description 统一的操作结果类型和错误处理
 */

export class BgmError extends Error {
    code: string;
    details: Record<string, any>;
    timestamp: string;

    constructor(message: string, code: string = 'UNKNOWN', details: Record<string, any> = {}) {
        super(message);
        this.name = 'BgmError';
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }

    toString(): string {
        return `[${this.code}] ${this.message}`;
    }
}

export type BgmResultError = BgmError;


// ========== Result 类型 ==========
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
        return Result.fail(new BgmError('API Error', String(code)));
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

    mapErr(fn: (error: BgmError) => BgmError): Result<T> {
        if (!this.success) {
            return Result.fail(fn(this.error!));
        }
        return this;
    }
}

// ========== 向后兼容接口 ==========
export interface SyncResult {
    code: number;
    message: string;
    data?: unknown;
}

export function toSyncResult<T>(result: Result<T>): SyncResult {
    if (result.success) {
        return { code: 200, message: 'OK', data: result.data };
    }
    return {
        code: result.error?.code ? parseInt(result.error.code) || 0 : 0,
        message: result.error?.message ?? 'Unknown error'
    };
}