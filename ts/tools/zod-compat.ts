/**
 * @fileoverview Zod 兼容层
 * @module tools/zodCompat
 * @description 为 wpsjs debug 纯静态模式（浏览器原生 ES module，无打包器、无 importmap）
 *              提供 Zod 的降级兼容：优先使用 `window.z`（若通过 <script> 预加载真正的 zod），
 *              缺失时返回结构近似 + 运行时类型断言的最小 safeParse 实现，保证模块加载
 *              不卡死、核心功能不中断。
 *
 *              注意：降级版并非完整 Zod —— safeParse 只做保守校验（字符串最小长度、
 *              对象 shape、枚举、字面量、默认值、optional 等核心行为），链式调用
 *              （int/positive/min/max/url/passthrough 等）在降级版仅作为 fluent 接口
 *              存在，不在运行时增加额外限制；若需要精确校验请在 index.html 预加载
 *              真实 zod UMD 到 window.z。
 */

// 类间**双向惰性引用**是该兼容层的固有结构：
// 前组 schema 类（LiteString/LiteNumber/…/LiteArray）的 fluent 方法
// （optional()/nullable()/default()）引用后组的 LiteOptional/LiteNullable/LiteWithDefault，
// 而后组类的辅助字段（array() 等）又回引前组 —— 静态上互为 use-before-define。
// 运行时安全论证：所有引用都位于方法体/字段初始化器内**惰性求值**，
// 实例化仅发生在文件尾部的 resolveZod()（此时全部类已完成定义），TDZ 不可能触发。
// 移动类定义无法解环（双向引用），故按文件级豁免处理。
/* eslint-disable no-use-before-define, @typescript-eslint/no-use-before-define */

// 必须导出：schemas/*.ts 导出的 Schema 变量类型签名经由 ParseResult 传递引用到本类型，
// declaration emit（.d.ts）需要按名字引用它，未导出会报 TS4023 "cannot be named"。
export interface _ZodIssue {
  message: string
  path?: (string | number)[]
}

type _ZodLikeParseResult<T> =
  { success: true; data: T } | { success: false; error: { issues: _ZodIssue[] } }
type ParseResult<T> = _ZodLikeParseResult<T>

function ok<T>(data: T): ParseResult<T> {
  return { success: true, data }
}
function fail<T>(message: string, path?: (string | number)[]): ParseResult<T> {
  // exactOptionalPropertyTypes: path 为 undefined 时不能把 undefined 赋值给 ? 属性，
  // 因此只有 path 真正有值时才附加该字段
  const issue: { message: string; path?: (string | number)[] } = { message }
  if (path !== undefined && path.length > 0) issue.path = path
  return { success: false, error: { issues: [issue] } }
}

/** schema 链式返回类型：足够松，避免 exactOptionalPropertyTypes 下自引用条件类型爆炸 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = any

// ============================================================
//  ZodSchema：对外形状
// ============================================================

export interface ZodSchema<T> {
  safeParse(input: unknown): ParseResult<T>
  parse(input: unknown): T
  optional(): AnySchema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default(d: any): AnySchema
  readonly _type?: T
  readonly _output?: T
  readonly __isZodLite?: true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any
}

// ============================================================
//  No-op Fluent 注入
// ============================================================

const NOOP_FLUENTS: readonly string[] = [
  'int',
  'integer',
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
  'coerce',
  'finite',
  'nonempty',
  'nonmax',
  'nonmin',
]

/** 在 target 对象的同一实例上挂 noop fluent，返回原实例的精确类型 */
function flu<T extends object>(target: T): T {
  const rec = target as unknown as Record<string, unknown>
  for (const function_ of NOOP_FLUENTS) {
    if (typeof rec[function_] !== 'function') {
      rec[function_] = function (): T {
        return flu(target)
      }
    }
  }
  return target
}

// ============================================================
//  运行时实现（类字段均不加 private，避免 declaration 导出时报 private class 字段错）
// ============================================================

class LiteString implements ZodSchema<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any

  readonly __isZodLite = true as const

  /** @internal */ readonly _min: number

  /** @internal */ readonly _max: number

  constructor(min = 0, max = Infinity) {
    this._min = min
    this._max = max
  }

  min(n: number): LiteString {
    return flu(new LiteString(n, this._max))
  }

  max(n: number): LiteString {
    return flu(new LiteString(this._min, n))
  }

  length(n: number): LiteString {
    return flu(new LiteString(n, n))
  }

  optional(): ZodSchema<string | undefined> {
    return flu(new LiteOptional<string>(this))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default(d: any): AnySchema {
    return flu(new LiteWithDefault<string, unknown>(this, d))
  }

  safeParse(input: unknown): ParseResult<string> {
    if (typeof input !== 'string') return fail<string>('expected string')
    if (input.length < this._min) return fail<string>('string shorter than min')
    if (input.length > this._max) return fail<string>('string longer than max')
    return ok(input)
  }

  parse(input: unknown): string {
    const r = this.safeParse(input)
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'parse failed')
    return r.data
  }
}

type LiteNumberSign = 'positive' | 'nonnegative' | 'negative' | 'nonpositive'

class LiteNumber implements ZodSchema<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any

  readonly __isZodLite = true as const

  /** @internal */ readonly _min: number

  /** @internal */ readonly _max: number

  /** @internal */ readonly _int: boolean

  /** @internal */ readonly _sign: LiteNumberSign | undefined

  constructor(min = -Infinity, max = Infinity, isInt = false, sign?: LiteNumberSign) {
    this._min = min
    this._max = max
    this._int = isInt
    this._sign = sign
  }

  min(n: number): LiteNumber {
    return flu(new LiteNumber(Math.max(this._min, n), this._max, this._int, this._sign))
  }

  max(n: number): LiteNumber {
    return flu(new LiteNumber(this._min, Math.min(this._max, n), this._int, this._sign))
  }

  int(): LiteNumber {
    return flu(new LiteNumber(this._min, this._max, true, this._sign))
  }

  positive(): LiteNumber {
    return flu(new LiteNumber(this._min, this._max, this._int, 'positive'))
  }

  nonnegative(): LiteNumber {
    return flu(new LiteNumber(this._min, this._max, this._int, 'nonnegative'))
  }

  negative(): LiteNumber {
    return flu(new LiteNumber(this._min, this._max, this._int, 'negative'))
  }

  nonpositive(): LiteNumber {
    return flu(new LiteNumber(this._min, this._max, this._int, 'nonpositive'))
  }

  optional(): ZodSchema<number | undefined> {
    return flu(new LiteOptional<number>(this))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default(d: any): AnySchema {
    return flu(new LiteWithDefault<number, unknown>(this, d))
  }

  safeParse(input: unknown): ParseResult<number> {
    if (typeof input === 'bigint') return fail<number>('unexpected bigint')
    if (typeof input !== 'number' || !Number.isFinite(input))
      return fail<number>('expected finite number')
    if (this._int && !Number.isInteger(input)) return fail<number>('expected integer')
    if (this._sign === 'positive' && !(input > 0)) return fail<number>('expected positive number')
    if (this._sign === 'nonnegative' && input < 0)
      return fail<number>('expected nonnegative number')
    if (this._sign === 'negative' && !(input < 0)) return fail<number>('expected negative number')
    if (this._sign === 'nonpositive' && input > 0)
      return fail<number>('expected nonpositive number')
    if (input < this._min) return fail<number>('number below min')
    if (input > this._max) return fail<number>('number above max')
    return ok(input)
  }

  parse(input: unknown): number {
    const r = this.safeParse(input)
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'parse failed')
    return r.data
  }
}

class LiteBoolean implements ZodSchema<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any

  readonly __isZodLite = true as const

  optional(): ZodSchema<boolean | undefined> {
    return flu(new LiteOptional<boolean>(this))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default(d: any): AnySchema {
    return flu(new LiteWithDefault<boolean, unknown>(this, d))
  }

  safeParse(input: unknown): ParseResult<boolean> {
    if (typeof input === 'boolean') return ok(input)
    return fail<boolean>('expected boolean')
  }

  parse(input: unknown): boolean {
    const r = this.safeParse(input)
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'parse failed')
    return r.data
  }
}

class LiteLiteral<V extends string | number | boolean> implements ZodSchema<V> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any

  readonly __isZodLite = true as const

  /** @internal */ readonly _val: V

  constructor(value: V) {
    this._val = value
  }

  optional(): ZodSchema<V | undefined> {
    return flu(new LiteOptional<V>(this))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default(d: any): AnySchema {
    return flu(new LiteWithDefault<V, unknown>(this, d))
  }

  safeParse(input: unknown): ParseResult<V> {
    if (input === this._val) return ok(this._val)
    return fail<V>(`expected literal ${String(this._val)}`)
  }

  parse(input: unknown): V {
    const r = this.safeParse(input)
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'parse failed')
    return r.data
  }
}

class LiteEnum<V extends string> implements ZodSchema<V> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any

  readonly __isZodLite = true as const

  /** @internal */ readonly _vals: readonly string[]

  constructor(vals: readonly string[]) {
    this._vals = vals
  }

  optional(): ZodSchema<V | undefined> {
    return flu(new LiteOptional<V>(this))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default(d: any): AnySchema {
    return flu(new LiteWithDefault<V, unknown>(this, d))
  }

  safeParse(input: unknown): ParseResult<V> {
    if (typeof input !== 'string') return fail<V>('enum value must be string')
    if (!this._vals.includes(input)) return fail<V>(`not in enum: ${input}`)
    return ok(input as V)
  }

  parse(input: unknown): V {
    const r = this.safeParse(input)
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'parse failed')
    return r.data
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
class LiteArray<T = any> implements ZodSchema<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any

  readonly __isZodLite = true as const

  /** @internal */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly _item: ZodSchema<any>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(item: ZodSchema<any>) {
    this._item = item
  }

  optional(): ZodSchema<T[] | undefined> {
    return flu(new LiteOptional<T[]>(this))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default(d: any): AnySchema {
    return flu(new LiteWithDefault<T[], unknown>(this, d))
  }

  safeParse(input: unknown): ParseResult<T[]> {
    if (!Array.isArray(input)) return fail<T[]>('expected array')
    const out: T[] = []
    for (let index = 0; index < input.length; index += 1) {
      const r = this._item.safeParse(input[index])
      if (!r.success) {
        const issue = r.error.issues[0]
        return fail<T[]>(`[${String(index)}]: ${issue?.message ?? 'invalid'}`, [
          index,
          ...(issue?.path ?? []),
        ])
      }

      out.push(r.data as T)
    }
    return ok(out)
  }

  parse(input: unknown): T[] {
    const r = this.safeParse(input)
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'parse failed')
    return r.data
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
class LiteObject<T = any> implements ZodSchema<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any

  readonly __isZodLite = true as const

  /** @internal */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly _shape: Record<string, ZodSchema<any>>

  /** @internal */ readonly _passthrough: boolean

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shape: Record<string, ZodSchema<any>>,
    shouldPassthrough = false,
  ) {
    this._shape = shape
    this._passthrough = shouldPassthrough
  }

  passthrough(): LiteObject<T> {
    return flu(new LiteObject<T>(this._shape, true))
  }

  strict(): LiteObject<T> {
    return flu(new LiteObject<T>(this._shape, false))
  }

  optional(): ZodSchema<T | undefined> {
    return flu(new LiteOptional<T>(this))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default(d: any): AnySchema {
    return flu(new LiteWithDefault<T, unknown>(this, d))
  }

  safeParse(input: unknown): ParseResult<T> {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
      return fail<T>('expected object')
    const source = input as Record<string, unknown>
    const out: Record<string, unknown> = {}
    if (this._passthrough) for (const k of Object.keys(source)) out[k] = source[k]
    for (const key of Object.keys(this._shape)) {
      const schema = this._shape[key]
      if (schema) {
        const isHas = Object.hasOwn(source, key)
        const rawValue = isHas ? source[key] : undefined
        const r = schema.safeParse(rawValue)
        if (!r.success) {
          const issue = r.error.issues[0]
          return fail<T>(`key "${key}": ${issue?.message ?? 'invalid'}`, [
            key,
            ...(issue?.path ?? []),
          ])
        }
        if (r.data !== undefined || isHas) out[key] = r.data
      }
    }
    return ok(out as T)
  }

  parse(input: unknown): T {
    const r = this.safeParse(input)
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'parse failed')
    return r.data
  }
}

class LiteOptional<T> implements ZodSchema<T | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any

  readonly __isZodLite = true as const

  /** @internal */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly _inner: ZodSchema<any>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(inner: ZodSchema<any>) {
    this._inner = inner
  }

  optional(): ZodSchema<T | undefined> {
    return this
  }

  nullable(): ZodSchema<T | null | undefined> {
    return flu(new LiteNullable<T>(this._inner, true, true))
  }

  nullish(): ZodSchema<T | null | undefined> {
    return flu(new LiteNullable<T>(this._inner, true, true))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default(d: any): AnySchema {
    return flu(new LiteWithDefault<T | undefined, unknown>(this, d))
  }

  safeParse(input: unknown): ParseResult<T | undefined> {
    if (input === undefined) return ok(undefined)
    return this._inner.safeParse(input)
  }

  parse(input: unknown): T | undefined {
    const r = this.safeParse(input)
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'parse failed')
    return r.data
  }
}

class LiteNullable<T> implements ZodSchema<T | null | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any

  readonly __isZodLite = true as const

  /** @internal */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly _inner: ZodSchema<any>

  /** @internal */ readonly _allowNull: boolean

  /** @internal */ readonly _allowUndefined: boolean

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inner: ZodSchema<any>,
    shouldAllowNull = true,
    shouldAllowUndefined = true,
  ) {
    this._inner = inner
    this._allowNull = shouldAllowNull
    this._allowUndefined = shouldAllowUndefined
  }

  optional(): ZodSchema<T | undefined | null> {
    return flu(new LiteNullable<T>(this._inner, this._allowNull, true))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default(d: any): AnySchema {
    return flu(new LiteWithDefault<T | null | undefined, unknown>(this, d))
  }

  safeParse(input: unknown): ParseResult<T | null | undefined> {
    if (this._allowUndefined && input === undefined) return ok(undefined)
    if (this._allowNull && input === null) return ok(null)
    return this._inner.safeParse(input)
  }

  parse(input: unknown): T | null | undefined {
    const r = this.safeParse(input)
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'parse failed')
    return r.data
  }
}

class LiteWithDefault<T, D> implements ZodSchema<T | D> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any

  readonly __isZodLite = true as const

  /** @internal */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly _inner: ZodSchema<any>

  /** @internal */ readonly _def: D

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inner: ZodSchema<any>,
    definition: D,
  ) {
    this._inner = inner
    this._def = definition
  }

  optional(): ZodSchema<(T | D) | undefined> {
    return flu(new LiteOptional<T | D>(this as unknown as ZodSchema<T | D>))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default(definition: any): AnySchema {
    return flu(new LiteWithDefault<T | D, unknown>(this as unknown as ZodSchema<T | D>, definition))
  }

  safeParse(input: unknown): ParseResult<T | D> {
    if (input === undefined) return ok<T | D>(this._def)
    const r = this._inner.safeParse(input)
    if (!r.success) return fail(r.error.issues[0]?.message ?? 'invalid')
    return r
  }

  parse(input: unknown): T | D {
    const r = this.safeParse(input)
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'parse failed')
    return r.data
  }
}

// ============================================================
//  顶层 z
// ============================================================

interface LiteZod {
  string(): LiteString
  number(): LiteNumber
  boolean(): LiteBoolean
  literal<V extends string | number | boolean>(v: V): LiteLiteral<V>
  enum<V extends readonly string[]>(vs: V): LiteEnum<V[number]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  object<Shape extends Record<string, ZodSchema<any>>>(
    shape: Shape,
  ): LiteObject<{ [K in keyof Shape]: Shape[K] extends ZodSchema<infer U> ? U : never }>
  array<T>(item: ZodSchema<T>): LiteArray<T>
}

const LiteZodImpl: LiteZod = {
  string: (): LiteString => flu(new LiteString()),
  number: (): LiteNumber => flu(new LiteNumber()),
  boolean: (): LiteBoolean => flu(new LiteBoolean()),
  literal: <V extends string | number | boolean>(v: V): LiteLiteral<V> =>
    flu(new LiteLiteral<V>(v)),
  enum: <V extends readonly string[]>(vs: V): LiteEnum<V[number]> =>
    flu(new LiteEnum<V[number]>(vs)),
  object: <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Shape extends Record<string, ZodSchema<any>>,
  >(
    shape: Shape,
  ): LiteObject<{ [K in keyof Shape]: Shape[K] extends ZodSchema<infer U> ? U : never }> =>
    flu(
      new LiteObject<{
        [K in keyof Shape]: Shape[K] extends ZodSchema<infer U> ? U : never
      }>(shape),
    ),
  array: <T>(item: ZodSchema<T>): LiteArray<T> => flu(new LiteArray<T>(item)),
}

type ExtendedWindow = typeof globalThis & { z?: unknown }

function resolveZod(): LiteZod {
  const w = globalThis as ExtendedWindow
  const cand = w.z
  if (
    cand &&
    typeof cand === 'object' &&
    typeof (cand as { string?: unknown }).string === 'function' &&
    typeof (cand as { object?: unknown }).object === 'function'
  ) {
    return cand as LiteZod
  }
  return LiteZodImpl
}

export const z = resolveZod()

/** z.infer<S>：从 schema 取推断结果 */
export type infer<S> = S extends ZodSchema<infer U> ? U : never
