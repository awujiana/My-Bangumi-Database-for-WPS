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
 * throw new BgmError('Token已过期', { code: 'TOKEN_EXPIRED', details: { expiredAt: '2024-01-01' } });
 */

/** BgmError 构造选项 */
export interface BgmErrorOptions {
  /** 错误码，用于程序化识别错误类型，默认 'UNKNOWN' */
  code?: string
  /** 额外的错误详情，默认 {} */
  details?: Record<string, unknown>
  /** 原始错误原因（与原生 ErrorOptions.cause 对齐，供 super() 透传） */
  cause?: unknown
}

export class BgmError extends Error {
  /**
   * 错误码
   * 用于程序化识别错误类型
   * @type {string}
   * @example 'TOKEN_INVALID', 'NETWORK_ERROR', 'API_RATE_LIMIT'
   */
  code: string

  /**
   * 错误详情对象
   * 存储与错误相关的额外上下文信息
   * @type {Record<string, unknown>}
   * @example { expiredAt: '2024-01-01', userId: 123 }
   */
  details: Record<string, unknown>

  /**
   * 错误发生时间的ISO格式字符串
   * @type {string}
   * @example '2024-01-15T10:30:00.000Z'
   */
  timestamp: string

  /**
   * 创建BgmError实例
   *
   * @constructor
   * @param {string} message - 人类可读的错误消息
   * @param {BgmErrorOptions} [options={}] - 错误选项（code 默认 'UNKNOWN'）
   *
   * @example
   * // 基本用法
   * const err = new BgmError('网络请求失败', { code: 'NETWORK_ERROR' });
   *
   * // 带详细信息的用法
   * const err = new BgmError('API调用失败', {
   *     code: 'API_ERROR',
   *     details: {
   *         endpoint: '/v0/me',
   *         statusCode: 401,
   *         retryCount: 3
   *     }
   * });
   */

  constructor(message: string, options: BgmErrorOptions = {}) {
    super(message, options)
    this.name = 'BgmError'
    this.code = options.code ?? 'UNKNOWN'
    this.details = options.details ?? {}
    this.timestamp = new Date().toISOString()
  }

  /**
   * 将错误转换为字符串格式
   * 输出格式：[错误码] 错误消息
   *
   * @method toString
   * @returns {string} 格式化的错误字符串
   *
   * @example
   * const err = new BgmError('Token无效', { code: 'TOKEN_INVALID' });
   * console.log(err.toString()); // '[TOKEN_INVALID] Token无效'
   */
  toString(): string {
    return `[${this.code}] ${this.message}`
  }
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
 *         return Result.fail(new BgmError('用户不存在', { code: 'USER_NOT_FOUND' }));
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
export class Result<T> {
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
  static ok<T>(data: T): Result<T> {
    return new Result(true, data, null)
  }

  /**
   * 创建表示失败的结果
   *
   * @static
   * @template T
   * @param {BgmError} error - 错误信息
   * @returns {Result<T>} 包装了错误的Result实例
   *
   * @example
   * return Result.fail(new BgmError('网络错误', { code: 'NETWORK_ERROR' }));
   */
  static fail<T>(error: BgmError): Result<T> {
    return new Result<T>(false, null, error)
  }

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
  static okVoid(): Result<void> {
    return new Result<void>(true, undefined, null)
  }

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
   * return Result.failVoid(new BgmError('配置不完整', { code: 'CONFIG_INCOMPLETE' }));
   */
  static failVoid(error: BgmError): Result<void> {
    return new Result<void>(false, null, error)
  }

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
  static fromCode<T>(code: number, data?: T | null): Result<T> {
    if (code >= 200 && code < 300) {
      return this.ok(data ?? (null as T))
    }
    return this.fail(new BgmError('API Error', { code: String(code) }))
  }

  /**
   * 操作是否成功
   * @type {boolean}
   */
  readonly success: boolean

  /**
   * 成功时的数据，失败时为null
   * @type {T | null}
   */
  readonly data: T | null

  /**
   * 失败时的错误信息，成功时为null
   * @type {BgmError | null}
   */
  readonly error: BgmError | null

  /**
   * 私有构造函数，通过静态工厂方法创建实例
   *
   * @private
   * @constructor
   * @param {boolean} isSuccess - 是否成功
   * @param {T | null} data - 成功时的数据
   * @param {BgmError | null} error - 失败时的错误
   */
  private constructor(isSuccess: boolean, data: T | null, error: BgmError | null) {
    this.success = isSuccess
    this.data = data
    this.error = error
  }

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
  isOk(): boolean {
    return this.success
  }

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
  isFail(): boolean {
    return !this.success
  }

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
  unwrap(): T {
    if (!this.success) {
      throw new Error(this.error?.message ?? 'Result is Fail')
    }
    return this.data as T
  }

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
  unwrapOr(defaultValue: T): T {
    return this.success ? (this.data as T) : defaultValue
  }

  /**
   * 转换成功时的数据
   * 如果操作失败则保持原样返回失败的Result
   *
   * @method map
   * @template U - 转换后的数据类型
   * @param {(data: T) => U} function_ - 转换函数
   * @returns {Result<U>} 转换后的Result
   *
   * @example
   * const nameResult = userResult.map(user => user.name);
   */
  map<U>(function_: (data: T) => U): Result<U> {
    if (this.success) {
      return Result.ok(function_(this.data as T))
    }
    return Result.fail(this.error ?? new BgmError('Result 失败但缺少错误信息', { code: 'UNKNOWN' }))
  }

  /**
   * 转换失败时的错误信息
   * 如果操作成功则保持原样返回成功的Result
   *
   * @method mapErr
   * @param {(error: BgmError) => BgmError} function_ - 错误转换函数
   * @returns {Result<T>} 转换后的Result
   *
   * @example
   * const result = apiResult.mapErr(err => {
   *     return new BgmError(err.message, 'WRAPPED_' + err.code);
   * });
   */
  mapErr(function_: (error: BgmError) => BgmError): Result<T> {
    const { error } = this
    if (error !== null && !this.success) {
      return Result.fail(function_(error))
    }
    return this
  }
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
  success: number

  /**
   * 同步失败的数量
   * @type {number}
   */
  fail: number

  /**
   * 跳过的数量（如数据无效或无需更新）
   * @type {number}
   */
  skip: number
}
