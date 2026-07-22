/**
 * @fileoverview 结果类型和错误处理模块
 * @module core/result
 * @description 提供统一的操作结果包装类型和错误处理机制。
 *              BgmError类用于表示业务逻辑错误，Result<T>泛型类
 *              用于包装可能成功或失败的操作返回值。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
/**
 * Bangumi业务错误类
 * 继承自Error，并扩展了错误码、详细信息和时间戳。
 *
 * @class BgmError
 * @extends Error
 * @example
 * throw new BgmError('Token已过期', 'TOKEN_EXPIRED', { expiredAt: '2024-01-01' });
 */
export declare class BgmError extends Error {
    /**
     * 错误码
     * 用于程序化识别错误类型
     * @type {string}
     * @example 'TOKEN_INVALID', 'NETWORK_ERROR', 'API_RATE_LIMIT'
     */
    code: string;
    /**
     * 错误详情对象
     * 存储与错误相关的额外上下文信息
     * @type {Record<string, unknown>}
     * @example { expiredAt: '2024-01-01', userId: 123 }
     */
    details: Record<string, unknown>;
    /**
     * 错误发生时间的ISO格式字符串
     * @type {string}
     * @example '2024-01-15T10:30:00.000Z'
     */
    timestamp: string;
    /**
     * 创建BgmError实例
     *
     * @constructor
     * @param {string} message - 人类可读的错误消息
     * @param {string} [code='UNKNOWN'] - 错误代码，用于程序化处理
     * @param {Record<string, unknown>} [details={}] - 额外的错误详情
     *
     * @example
     * // 基本用法
     * const err = new BgmError('网络请求失败', 'NETWORK_ERROR');
     *
     * // 带详细信息的用法
     * const err = new BgmError('API调用失败', 'API_ERROR', {
     *     endpoint: '/v0/me',
     *     statusCode: 401,
     *     retryCount: 3
     * });
     */
    constructor(message: string, code?: string, details?: Record<string, unknown>);
    /**
     * 将错误转换为字符串格式
     * 输出格式：[错误码] 错误消息
     *
     * @method toString
     * @returns {string} 格式化的错误字符串
     *
     * @example
     * const err = new BgmError('Token无效', 'TOKEN_INVALID');
     * console.log(err.toString()); // '[TOKEN_INVALID] Token无效'
     */
    toString(): string;
}
/**
 * 操作结果泛型类
 * 用于统一包装可能成功或失败的操作返回值，
 * 避免使用try-catch或直接抛错来处理可预期的失败情况。
 *
 * @class Result
 * @template T - 成功时返回的数据类型
 *
 * @example
 * // 函数返回Result类型
 * async function fetchUser(id: number): Promise<Result<User>> {
 *     const response = await fetch(`/api/users/${id}`);
 *     if (!response.ok) {
 *         return Result.fail(new BgmError('用户不存在', 'USER_NOT_FOUND'));
 *     }
 *     const user = await response.json();
 *     return Result.ok(user);
 * }
 *
 * // 调用方处理结果
 * const result = await fetchUser(123);
 * if (result.isOk()) {
 *     console.log(result.unwrap().name);
 * } else {
 *     console.error(result.error.message);
 * }
 */
export declare class Result<T> {
    /**
     * 操作是否成功
     * @type {boolean}
     */
    readonly success: boolean;
    /**
     * 成功时的数据，失败时为null
     * @type {T | null}
     */
    readonly data: T | null;
    /**
     * 失败时的错误信息，成功时为null
     * @type {BgmError | null}
     */
    readonly error: BgmError | null;
    /**
     * 私有构造函数，通过静态工厂方法创建实例
     *
     * @private
     * @constructor
     * @param {boolean} success - 是否成功
     * @param {T | null} data - 成功时的数据
     * @param {BgmError | null} error - 失败时的错误
     */
    private constructor();
    /**
     * 创建表示成功的结果
     *
     * @static
     * @template T
     * @param {T} data - 成功时返回的数据
     * @returns {Result<T>} 包装了成功数据的Result实例
     *
     * @example
     * return Result.ok({ id: 1, name: '张三' });
     */
    static ok<T>(data: T): Result<T>;
    /**
     * 创建表示失败的结果
     *
     * @static
     * @template T
     * @param {BgmError} error - 错误信息
     * @returns {Result<T>} 包装了错误的Result实例
     *
     * @example
     * return Result.fail(new BgmError('网络错误', 'NETWORK_ERROR'));
     */
    static fail<T>(error: BgmError): Result<T>;
    /**
     * 创建表示成功但无返回值的结果（Result<void>）
     * 用于配置校验、写入操作等"成功时无数据"的场景，
     * 避免 Result.ok<void>(undefined) 触发 no-invalid-void-type 规则。
     *
     * @static
     * @returns {Result<void>} 包装了 undefined 的成功 Result
     *
     * @example
     * return Result.okVoid();
     */
    static okVoid(): Result<void>;
    /**
     * 创建表示失败且无返回值类型的结果（Result<void>）
     * 用于配置校验等返回 Result<void> 的场景，
     * 避免 Result.fail<void>(error) 触发 no-invalid-void-type 规则。
     *
     * @static
     * @param {BgmError} error - 错误信息
     * @returns {Result<void>} 包装了错误的 Result<void> 实例
     *
     * @example
     * return Result.failVoid(new BgmError('配置不完整', 'CONFIG_INCOMPLETE'));
     */
    static failVoid(error: BgmError): Result<void>;
    /**
     * 根据HTTP状态码创建结果
     * 2xx状态码视为成功，其他视为失败
     *
     * @static
     * @template T
     * @param {number} code - HTTP状态码
     * @param {T | null} [data] - 可选的成功数据
     * @returns {Result<T>} 根据状态码创建的结果
     *
     * @example
     * return Result.fromCode(response.status, await response.json());
     */
    static fromCode<T>(code: number, data?: T | null): Result<T>;
    /**
     * 判断操作是否成功
     *
     * @method isOk
     * @returns {boolean} 成功返回true，失败返回false
     *
     * @example
     * if (result.isOk()) {
     *     process(result.unwrap());
     * }
     */
    isOk(): boolean;
    /**
     * 判断操作是否失败
     *
     * @method isFail
     * @returns {boolean} 失败返回true，成功返回false
     *
     * @example
     * if (result.isFail()) {
     *     handleError(result.error);
     * }
     */
    isFail(): boolean;
    /**
     * 获取成功时的数据
     * 如果操作失败则抛出异常
     *
     * @method unwrap
     * @returns {T} 成功时的数据
     * @throws {Error} 如果操作失败则抛出包含错误消息的Error
     *
     * @example
     * try {
     *     const user = result.unwrap();
     *     console.log(user.name);
     * } catch (e: unknown) {
     *     console.error('获取用户失败:', (e as Error).message);
     * }
     */
    unwrap(): T;
    /**
     * 获取成功时的数据，失败时返回默认值
     *
     * @method unwrapOr
     * @param {T} defaultValue - 失败时返回的默认值
     * @returns {T} 成功时返回数据，失败时返回默认值
     *
     * @example
     * const userId = result.unwrapOr({ id: 0 }).id;
     */
    unwrapOr(defaultValue: T): T;
    /**
     * 转换成功时的数据
     * 如果操作失败则保持原样返回失败的Result
     *
     * @method map
     * @template U - 转换后的数据类型
     * @param {(data: T) => U} fn - 转换函数
     * @returns {Result<U>} 转换后的Result
     *
     * @example
     * const nameResult = userResult.map(user => user.name);
     */
    map<U>(fn: (data: T) => U): Result<U>;
    /**
     * 转换失败时的错误信息
     * 如果操作成功则保持原样返回成功的Result
     *
     * @method mapErr
     * @param {(error: BgmError) => BgmError} fn - 错误转换函数
     * @returns {Result<T>} 转换后的Result
     *
     * @example
     * const result = apiResult.mapErr(err => {
     *     return new BgmError(err.message, 'WRAPPED_' + err.code);
     * });
     */
    mapErr(fn: (error: BgmError) => BgmError): Result<T>;
}
/**
 * 批量同步结果接口
 * 用于描述同步操作的整体结果统计
 *
 * @interface BatchSyncResult
 * @description 记录批量同步操作的成功、失败和跳过数量
 *
 * @example
 * const result: BatchSyncResult = {
 *     success: 95,
 *     fail: 3,
 *     skip: 2
 * };
 */
export interface BatchSyncResult {
    /**
     * 成功同步的数量
     * @type {number}
     */
    success: number;
    /**
     * 同步失败的数量
     * @type {number}
     */
    fail: number;
    /**
     * 跳过的数量（如数据无效或无需更新）
     * @type {number}
     */
    skip: number;
}
//# sourceMappingURL=result.d.ts.map