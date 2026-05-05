/**
 * BGM 结果类型
 * @module types/result
 * @description 统一的操作结果类型，避免错误处理不一致
 */
/**
 * 操作结果基类
 */
export declare class Result<T> {
    readonly success: boolean;
    readonly data: T | null;
    readonly error: BgmResultError | null;
    private constructor();
    static ok<T>(data: T): Result<T>;
    static fail<T>(error: BgmResultError): Result<T>;
    static fromCode<T>(code: number, data?: T | null): Result<T>;
    isOk(): boolean;
    isFail(): boolean;
    unwrap(): T;
    unwrapOr(defaultValue: T): T;
    map<U>(fn: (data: T) => U): Result<U>;
    mapErr(fn: (error: BgmResultError) => BgmResultError): Result<T>;
}
/**
 * BGM 错误类
 */
export declare class BgmResultError {
    readonly code: number;
    readonly message: string;
    readonly details?: Record<string, unknown>;
    constructor(code: number, message: string, details?: Record<string, unknown>);
    toString(): string;
    static fromXhr(xhr: XMLHttpRequest): BgmResultError;
    static fromError(error: unknown): BgmResultError;
}
/**
 * 同步结果（保持向后兼容）
 */
export interface SyncResult {
    code: number;
    message: string;
    data?: unknown;
}
export declare function toSyncResult<T>(result: Result<T>): SyncResult;
