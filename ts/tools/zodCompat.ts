/**
 * @fileoverview Zod 兼容层
 * @module tools/zodCompat
 * @description 为 wpsjs debug 纯静态模式（浏览器原生 ES module，无打包器、无 importmap）
 *              提供 Zod 的降级兼容：优先使用 `window.z`（若通过 <script src="./libs/zod.umd.js">
 *              或 CDN 预先挂载真正的 zod），缺失时返回结构近似 + 运行时类型断言的
 *              最小 safeParse 实现，保证模块加载不卡死、核心功能不中断。
 *
 *              注意：降级版并非完整 Zod —— safeParse 只做保守校验（字符串最小长度、
 *              对象 shape、枚举、字面量、默认值、optional 等核心行为），链式调用
 *              （int/positive/min/max/url/array/passthrough 等）在降级版仅作为 fluent
 *              接口存在，不在运行时增加额外限制；若需要精确校验请在 index.html 预加载
 *              真实 zod UMD 到 window.z。
 *
 *              在 Vite 构建环境可通过 importmap 将此文件指向真正的 zod。
 */

type ZodLikeParseResult<T> =
  { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } }

/** ZodSchema：项目里用的最小 API（optional/default/safeParse + z.infer） */
export interface ZodSchema<T> {
  optional(): ZodSchema<T | undefined>
  default<D>(d: D): ZodSchema<T extends undefined ? D : T | D>
  safeParse(input: unknown): ZodLikeParseResult<T>
  readonly _output?: T
  readonly _type?: T
  /** 仅降级版 schema 需要的内部标记 */
  readonly __isZodLite?: true
}

// ---------- 辅助工具 ----------

function ok<T>(data: T): ZodLikeParseResult<T> {
  return { success: true, data }
}
function fail<T>(msg: string): ZodLikeParseResult<T> {
  return { success: false, error: { issues: [{ message: msg }] } }
}

/** 包装一个 schema 并在其之上叠加 no-op fluent 调用（int/positive/min/max/url 等），
 *  以便在降级模式下不报错（这些约束仅用真实 zod 才执行）。 */
function withNoopFluent<T, S extends ZodSchema<T> & Record<string, unknown>>(base: S): S {
  const NOOP_FLUENTS = [
    'int',
    'positive',
    'negative',
    'nonnegative',
    'nonpositive',
    'min',
    'max',
    'gt',
    'lt',
    'gte',
    'lte',
    'length',
    'email',
    'url',
    'uuid',
    'cuid',
    'regex',
    'startsWith',
    'endsWith',
    'trim',
    'datetime',
    'date',
    'time',
    'ip',
    'array',
    'passthrough',
    'strip',
    'strict',
    'safe',
    'brand',
    'transform',
    'pipe',
    'or',
    'and',
    'refine',
    'superRefine',
    'describe',
    'catch',
    'nullable',
    'nullish',
  ] as const
  const proxy = base as unknown as Record<string, unknown>
  for (const fn of NOOP_FLUENTS) {
    if (typeof proxy[fn] !== 'function') {
      proxy[fn] = function (this: S): S {
        return withNoopFluent(this)
      }
    }
  }
  return proxy as S
}

// ---------- 核心实现 ----------

class SString implements ZodSchema<string> {
  readonly __isZodLite = true as const
  constructor(
    private _minLen = 0,
    private _maxLen = Infinity,
  ) {}
  min(n: number): SString {
    return withNoopFluent(new SString(n, this._maxLen))
  }
  max(n: number): SString {
    return withNoopFluent(new SString(this._minLen, n))
  }
  length(n: number): SString {
    return withNoopFluent(new SString(n, n))
  }
  optional(): ZodSchema<string | undefined> {
    return withNoopFluent(new SOptional<string>(this))
  }
  default<D>(d: D): ZodSchema<string | D> {
    return withNoopFluent(new SWithDefault<string, D>(this, d))
  }
  safeParse(input: unknown): ZodLikeParseResult<string> {
    if (typeof input !== 'string') return fail<string>('expected string')
    if (input.length < this._minLen) return fail<string>('string shorter than min')
    if (input.length > this._maxLen) return fail<string>('string longer than max')
    return ok(input)
  }
}

class SNumber implements ZodSchema<number> {
  readonly __isZodLite = true as const
  private _min = -Infinity
  private _max = Infinity
  withBounds(min: number, max: number): SNumber {
    const n = new SNumber()
    n._min = min
    n._max = max
    return withNoopFluent(n)
  }
  min(n: number): SNumber {
    return this.withBounds(Math.max(this._min, n), this._max)
  }
  max(n: number): SNumber {
    return this.withBounds(this._min, Math.min(this._max, n))
  }
  optional(): ZodSchema<number | undefined> {
    return withNoopFluent(new SOptional<number>(this))
  }
  default<D>(d: D): ZodSchema<number | D> {
    return withNoopFluent(new SWithDefault<number, D>(this, d))
  }
  safeParse(input: unknown): ZodLikeParseResult<number> {
    if (typeof input === 'bigint') return fail<number>('unexpected bigint')
    if (typeof input !== 'number' || !Number.isFinite(input))
      return fail<number>('expected finite number')
    if (input < this._min) return fail<number>('number below min')
    if (input > this._max) return fail<number>('number above max')
    return ok(input)
  }
}

class SBoolean implements ZodSchema<boolean> {
  readonly __isZodLite = true as const
  optional(): ZodSchema<boolean | undefined> {
    return withNoopFluent(new SOptional<boolean>(this))
  }
  default<D>(d: D): ZodSchema<boolean | D> {
    return withNoopFluent(new SWithDefault<boolean, D>(this, d))
  }
  safeParse(input: unknown): ZodLikeParseResult<boolean> {
    if (typeof input === 'boolean') return ok(input)
    return fail<boolean>('expected boolean')
  }
}

class SLiteral<V extends string | number | boolean> implements ZodSchema<V> {
  readonly __isZodLite = true as const
  constructor(private _val: V) {}
  optional(): ZodSchema<V | undefined> {
    return withNoopFluent(new SOptional<V>(this))
  }
  default<D>(d: D): ZodSchema<V | D> {
    return withNoopFluent(new SWithDefault<V, D>(this, d))
  }
  safeParse(input: unknown): ZodLikeParseResult<V> {
    if (input === this._val) return ok(this._val)
    return fail<V>(`expected literal ${String(this._val)}`)
  }
}

class SEnum<V extends string> implements ZodSchema<V> {
  readonly __isZodLite = true as const
  constructor(private _vals: readonly string[]) {}
  optional(): ZodSchema<V | undefined> {
    return withNoopFluent(new SOptional<V>(this))
  }
  default<D>(d: D): ZodSchema<V | D> {
    return withNoopFluent(new SWithDefault<V, D>(this, d))
  }
  safeParse(input: unknown): ZodLikeParseResult<V> {
    if (typeof input !== 'string') return fail<V>('enum value must be string')
    if (!this._vals.includes(input)) return fail<V>(`not in enum: ${input}`)
    return ok(input as V)
  }
}

class SArraySchema<T> implements ZodSchema<T[]> {
  readonly __isZodLite = true as const
  constructor(private _item: ZodSchema<T>) {}
  optional(): ZodSchema<T[] | undefined> {
    return withNoopFluent(new SOptional<T[]>(this))
  }
  default<D>(d: D): ZodSchema<T[] | D> {
    return withNoopFluent(new SWithDefault<T[], D>(this, d))
  }
  safeParse(input: unknown): ZodLikeParseResult<T[]> {
    if (!Array.isArray(input)) return fail<T[]>('expected array')
    const out: T[] = []
    for (let i = 0; i < input.length; i++) {
      const r = this._item.safeParse(input[i])
      if (!r.success) return fail<T[]>(`[${i}]: ${r.error.issues[0]?.message ?? 'invalid'}`)
      out.push(r.data)
    }
    return ok(out)
  }
}

class SObject<T> implements ZodSchema<T> {
  readonly __isZodLite = true as const
  constructor(
    private _shape: Record<string, ZodSchema<unknown>>,
    /** passthrough = 保留未知字段；默认 strip（与 zod 默认一致） */
    private _passthrough = false,
  ) {}
  passthrough(): SObject<T> {
    return withNoopFluent(new SObject<T>(this._shape, true))
  }
  strict(): SObject<T> {
    return withNoopFluent(new SObject<T>(this._shape, false))
  }
  optional(): ZodSchema<T | undefined> {
    return withNoopFluent(new SOptional<T>(this))
  }
  default<D>(d: D): ZodSchema<T | D> {
    return withNoopFluent(new SWithDefault<T, D>(this, d))
  }
  safeParse(input: unknown): ZodLikeParseResult<T> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return fail<T>('expected object')
    }
    const src = input as Record<string, unknown>
    const out: Record<string, unknown> = {}
    // 先 passthrough：若启用，拷贝所有字段（然后覆盖 shape 中对应 key）
    if (this._passthrough) {
      for (const k of Object.keys(src)) out[k] = src[k]
    }
    // 处理已知 shape
    for (const key of Object.keys(this._shape)) {
      const schema = this._shape[key]
      const has = Object.prototype.hasOwnProperty.call(src, key)
      const rawVal = has ? src[key] : undefined
      const r = schema.safeParse(rawVal)
      if (!r.success) {
        return fail<T>(`key "${key}": ${r.error.issues[0]?.message ?? 'invalid'}`)
      }
      if (r.data !== undefined || has) {
        out[key] = r.data
      }
    }
    return ok(out as T)
  }
}

class SOptional<T> implements ZodSchema<T | undefined> {
  readonly __isZodLite = true as const
  constructor(private _inner: ZodSchema<T>) {}
  optional(): ZodSchema<T | undefined> {
    return this
  }
  nullable(): ZodSchema<T | undefined | null> {
    return withNoopFluent(new SNullable<T>(this._inner, true, true))
  }
  nullish(): ZodSchema<T | undefined | null> {
    return withNoopFluent(new SNullable<T>(this._inner, true, true))
  }
  default<D>(d: D): ZodSchema<T extends undefined ? D : T | D> {
    return withNoopFluent(new SWithDefault<T | undefined, D>(this, d))
  }
  safeParse(input: unknown): ZodLikeParseResult<T | undefined> {
    if (input === undefined) return ok(undefined)
    return this._inner.safeParse(input) as ZodLikeParseResult<T | undefined>
  }
}

class SNullable<T> implements ZodSchema<T | null | undefined> {
  readonly __isZodLite = true as const
  constructor(
    private _inner: ZodSchema<T>,
    private _allowNull = true,
    private _allowUndefined = true,
  ) {}
  optional(): ZodSchema<T | undefined | null> {
    return withNoopFluent(new SNullable<T>(this._inner, this._allowNull, true))
  }
  default<D>(d: D): ZodSchema<T | null | D> {
    return withNoopFluent(new SWithDefault<T | null | undefined, D>(this, d))
  }
  safeParse(input: unknown): ZodLikeParseResult<T | null | undefined> {
    if (this._allowUndefined && input === undefined) return ok(undefined)
    if (this._allowNull && input === null) return ok(null)
    return this._inner.safeParse(input) as ZodLikeParseResult<T | null | undefined>
  }
}

class SWithDefault<T, D> implements ZodSchema<T extends undefined ? D : T | D> {
  readonly __isZodLite = true as const
  constructor(
    private _inner: ZodSchema<T>,
    private _def: D,
  ) {}
  optional(): ZodSchema<(T extends undefined ? D : T | D) | undefined> {
    return withNoopFluent(new SOptional<T extends undefined ? D : T | D>(this))
  }
  default<DD>(d: DD): ZodSchema<(T extends undefined ? D : T | D) | DD> {
    return withNoopFluent(new SWithDefault<T extends undefined ? D : T | D, DD>(this, d))
  }
  safeParse(input: unknown): ZodLikeParseResult<T extends undefined ? D : T | D> {
    if (input === undefined) return ok(this._def as T extends undefined ? D : T | D)
    const r = this._inner.safeParse(input)
    if (!r.success) return fail(r.error.issues[0]?.message ?? 'invalid')
    return ok(r.data as T extends undefined ? D : T | D)
  }
}

// ---------- Zod Lite 顶层对象 z ----------

interface ZodLite {
  string(): SString
  number(): SNumber
  boolean(): SBoolean
  literal<V extends string | number | boolean>(v: V): SLiteral<V>
  enum<V extends readonly string[]>(vs: V): SEnum<V[number]>
  object<Shape extends Record<string, ZodSchema<unknown>>>(
    shape: Shape,
  ): SObject<{
    [K in keyof Shape]: Shape[K] extends ZodSchema<infer U> ? U : never
  }>
  array<T>(item: ZodSchema<T>): SArraySchema<T>
}

const LiteZod: ZodLite = {
  string: () => withNoopFluent(new SString()),
  number: () => withNoopFluent(new SNumber()),
  boolean: () => withNoopFluent(new SBoolean()),
  literal: <V extends string | number | boolean>(v: V) => withNoopFluent(new SLiteral<V>(v)),
  enum: <V extends readonly string[]>(vs: V) => withNoopFluent(new SEnum<V[number]>(vs)),
  object: <Shape extends Record<string, ZodSchema<unknown>>>(shape: Shape) =>
    withNoopFluent(
      new SObject<{ [K in keyof Shape]: Shape[K] extends ZodSchema<infer U> ? U : never }>(shape),
    ),
  array: <T>(item: ZodSchema<T>) => withNoopFluent(new SArraySchema<T>(item)),
}

// ---------- 暴露与解析：优先 window.z（真正的 zod），否则降级 ----------

type ExtendedWindow = typeof globalThis & {
  z?: unknown
}

function resolveZod(): ZodLite {
  const w = globalThis as ExtendedWindow
  const cand = w.z
  if (
    cand &&
    typeof cand === 'object' &&
    typeof (cand as { string?: unknown }).string === 'function' &&
    typeof (cand as { object?: unknown }).object === 'function'
  ) {
    // 真实 zod 也应支持 z.enum/z.literal/z.array/z.number/z.string
    return cand as ZodLite
  }
  return LiteZod
}

export const z = resolveZod()

/** z.infer<S> 类型推断：从 schema 的类型参数拿推断结果 */
export type infer<S> = S extends ZodSchema<infer U> ? U : never

/** 给外部需要 `ZodSchema` 类型参数引用的工具（如 http.ts 的 type import）导一个别名 */
export type { ZodSchema }
