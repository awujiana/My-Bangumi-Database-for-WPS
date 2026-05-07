/**
 * BGM 结果类型
 * @module types/result
 * @description 统一的操作结果类型和错误处理
 */
export declare class BgmError extends Error {
    code: string;
    details: Record<string, any>;
    timestamp: string;
    constructor(message: string, code?: string, details?: Record<string, any>);
    toString(): string;
}
export type BgmResultError = BgmError;
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
    mapErr(fn: (error: BgmError) => BgmError): Result<T>;
}
export interface SyncResult {
    code: number;
    message: string;
    data?: unknown;
}
export declare function toSyncResult<T>(result: Result<T>): SyncResult;
//# sourceMappingURL=result.d.ts.map