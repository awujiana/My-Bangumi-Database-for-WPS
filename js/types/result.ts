/**
 * BGM 结果类型
 * @module types/result
 * @description 统一的操作结果类型和错误处理，避免错误处理不一致
 */

// ========== 错误级别枚举 ==========
export const ErrorLevel = {
    SILENT: 0,
    WARN: 1,
    ERROR: 2,
    THROW: 3
} as const;
export type ErrorLevel = typeof ErrorLevel[keyof typeof ErrorLevel];

// ========== 统一的 BGM 错误类 ==========
/**
 * BGM 统一错误类
 * @extends Error
 */
export class BgmError extends Error {
    /** 错误代码（如 'NETWORK_ERROR', 'API_ERROR' 等） */
    code: string;
    /** 额外错误详情 */
    details: Record<string, any>;
    /** 错误发生时间 */
    timestamp: string;

    /**
     * @param message - 错误消息
     * @param code - 错误代码，默认 'UNKNOWN'
     * @param details - 额外详情
     */
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

// ========== 向后兼容类型别名 ==========
/** @deprecated 使用 BgmError 替代 */
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