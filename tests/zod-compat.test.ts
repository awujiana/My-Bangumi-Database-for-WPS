import { describe, it, expect, vi } from 'vitest'
import { z } from '../ts/tools/zod-compat.js'

// zod-compat 的 lite 工厂返回 `any` 形态 schema；用最小接口把调用面收成类型安全，
// 避免 no-unsafe-* 全家桶。这是「刻意的 any → 已知形态」边界转换（见项目约定）。
/** 单个 issue：lite-zod 保证 message 为字符串、path 为「索引/键名」数组（元素类型放宽为 unknown） */
interface LiteIssue {
  message?: string
  path?: readonly unknown[]
}

type LiteResult =
  | { success: true; data: unknown }
  | { success: false; error: { issues: readonly LiteIssue[] } }

interface LiteSchema {
  safeParse(value: unknown): LiteResult
  parse(value: unknown): unknown
  optional(): LiteSchema
  nullable(): LiteSchema
  nullish(): LiteSchema
  default(value: unknown): LiteSchema
  min(n: number): LiteSchema
  max(n: number): LiteSchema
  length(n: number): LiteSchema
  int(): LiteSchema
  positive(): LiteSchema
  negative(): LiteSchema
  nonnegative(): LiteSchema
  nonpositive(): LiteSchema
  finite(): LiteSchema
  trim(): LiteSchema
  email(): LiteSchema
  strict(): LiteSchema
  passthrough(): LiteSchema
}

const Z = z as unknown as {
  string(): LiteSchema
  number(): LiteSchema
  boolean(): LiteSchema
  literal(value: unknown): LiteSchema
  enum(values: readonly string[]): LiteSchema
  array(schema: LiteSchema): LiteSchema
  object(shape: Record<string, LiteSchema>): LiteSchema
}

/** 「字符串 + optional」这一条链，供包装类组合用例复用 */
const optionalString = (): LiteSchema => Z.string().optional()

/**
 * 重置模块注册表后重新 import，用于观察 `resolveZod()` 在模块求值时的分支。
 * `z` 只在模块顶层求值一次，不 resetModules 就只能看到同一条路径。
 */
async function importFresh(injected: unknown): Promise<typeof z> {
  vi.resetModules()
  if (injected === undefined) Reflect.deleteProperty(globalThis, 'z')
  else Reflect.set(globalThis, 'z', injected)
  try {
    const fresh = await import('../ts/tools/zod-compat.js')
    return fresh.z
  } finally {
    Reflect.deleteProperty(globalThis, 'z')
    vi.resetModules()
  }
}

describe('zod-compat 降级实现（纯函数，无 DOM/WPS）', () => {
  describe('z.string', () => {
    it('非字符串失败', () => {
      expect(Z.string().safeParse(123).success).toBe(false)
    })
    it('min/max/length 边界', () => {
      expect(Z.string().min(3).safeParse('ab').success).toBe(false)
      expect(Z.string().min(3).safeParse('abc').success).toBe(true)
      expect(Z.string().max(3).safeParse('abcd').success).toBe(false)
      expect(Z.string().max(3).safeParse('abc').success).toBe(true)
      expect(Z.string().length(2).safeParse('ab').success).toBe(true)
      expect(Z.string().length(2).safeParse('a').success).toBe(false)
    })
    it('optional / default', () => {
      expect(Z.string().optional().safeParse(undefined).success).toBe(true)
      const d1 = Z.string().default('x').safeParse(undefined)
      expect(d1.success).toBe(true)
      if (d1.success) expect(d1.data).toBe('x')
      const d2 = Z.string().default('x').safeParse('y')
      expect(d2.success).toBe(true)
      if (d2.success) expect(d2.data).toBe('y')
    })
    it('parse 失败时抛错', () => {
      expect(() => Z.string().parse(1)).toThrow()
    })
  })

  describe('z.number', () => {
    it('基础校验：非数字 / 非有限 / bigint', () => {
      expect(Z.number().safeParse('5').success).toBe(false)
      expect(Z.number().safeParse(Infinity).success).toBe(false)
      expect(Z.number().safeParse(5n).success).toBe(false)
    })
    it('int 约束', () => {
      expect(Z.number().int().safeParse(5.5).success).toBe(false)
      expect(Z.number().int().safeParse(5).success).toBe(true)
    })
    it('符号约束 positive/negative/nonnegative/nonpositive', () => {
      expect(Z.number().positive().safeParse(-1).success).toBe(false)
      expect(Z.number().positive().safeParse(1).success).toBe(true)
      expect(Z.number().positive().safeParse(0).success).toBe(false)
      expect(Z.number().negative().safeParse(1).success).toBe(false)
      expect(Z.number().negative().safeParse(-1).success).toBe(true)
      expect(Z.number().nonnegative().safeParse(-1).success).toBe(false)
      expect(Z.number().nonnegative().safeParse(0).success).toBe(true)
      expect(Z.number().nonpositive().safeParse(1).success).toBe(false)
      expect(Z.number().nonpositive().safeParse(0).success).toBe(true)
    })
    it('min/max 边界', () => {
      const s = Z.number().min(2).max(10)
      expect(s.safeParse(1).success).toBe(false)
      expect(s.safeParse(11).success).toBe(false)
      expect(s.safeParse(5).success).toBe(true)
    })
    it('optional / default / parse 抛错', () => {
      expect(Z.number().optional().safeParse(undefined).success).toBe(true)
      const d = Z.number().default(7).safeParse(undefined)
      expect(d.success).toBe(true)
      if (d.success) expect(d.data).toBe(7)
      expect(() => Z.number().parse('x')).toThrow()
    })
  })

  describe('z.boolean / literal / enum', () => {
    it('boolean', () => {
      expect(Z.boolean().safeParse(true).success).toBe(true)
      expect(Z.boolean().safeParse('true').success).toBe(false)
      expect(Z.boolean().optional().safeParse(undefined).success).toBe(true)
    })
    it('literal', () => {
      expect(Z.literal('a').safeParse('a').success).toBe(true)
      expect(Z.literal('a').safeParse('b').success).toBe(false)
      expect(Z.literal(1).safeParse(1).success).toBe(true)
      expect(Z.literal(1).safeParse(2).success).toBe(false)
    })
    it('enum', () => {
      const enumSchema = Z.enum(['a', 'b'])
      expect(enumSchema.safeParse('a').success).toBe(true)
      expect(enumSchema.safeParse('c').success).toBe(false)
      expect(enumSchema.safeParse(1).success).toBe(false)
    })
  })

  describe('z.array', () => {
    it('非数组失败', () => {
      expect(Z.array(Z.string()).safeParse('x').success).toBe(false)
    })
    it('元素逐项校验，失败带索引 path', () => {
      expect(Z.array(Z.string()).safeParse(['a', 'b']).success).toBe(true)
      const r = Z.array(Z.string()).safeParse([1])
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues[0]?.path?.[0]).toBe(0)
    })
    it('嵌套对象数组', () => {
      const s = Z.array(Z.object({ name: Z.string() }))
      expect(s.safeParse([{ name: 'a' }]).success).toBe(true)
      expect(s.safeParse([{ name: 1 }]).success).toBe(false)
    })
  })

  describe('z.object', () => {
    const userSchema = Z.object({ name: Z.string(), age: Z.number() })
    it('正常对象', () => {
      expect(userSchema.safeParse({ name: 'a', age: 1 }).success).toBe(true)
    })
    it('非对象失败', () => {
      expect(userSchema.safeParse('x').success).toBe(false)
    })
    it('字段校验失败带 key path', () => {
      const r = userSchema.safeParse({ name: 1, age: 1 })
      expect(r.success).toBe(false)
      if (!r.success) expect(r.error.issues[0]?.path?.[0]).toBe('name')
    })
    it('非 passthrough 丢弃多余键；passthrough 保留', () => {
      const r1 = userSchema.safeParse({ name: 'a', age: 1, extra: 9 })
      expect(r1.success).toBe(true)
      if (r1.success) expect((r1.data as Record<string, unknown>).extra).toBeUndefined()
      const p = Z.object({ name: Z.string() }).passthrough()
      const r2 = p.safeParse({ name: 'a', extra: 9 })
      expect(r2.success).toBe(true)
      if (r2.success) expect((r2.data as Record<string, unknown>).extra).toBe(9)
    })
    it('optional / default', () => {
      expect(userSchema.optional().safeParse(undefined).success).toBe(true)
      const r = userSchema.default({ name: 'x', age: 0 }).safeParse(undefined)
      expect(r.success).toBe(true)
      if (r.success) expect(r.data).toEqual({ name: 'x', age: 0 })
    })
  })

  describe('nullable（经 optional().nullable() 得到真实 LiteNullable）', () => {
    it('允许 null / undefined 或委托内层', () => {
      const n = Z.string().optional().nullable()
      expect(n.safeParse(null).success).toBe(true)
      expect(n.safeParse(undefined).success).toBe(true)
      expect(n.safeParse('ok').success).toBe(true)
      expect(n.safeParse(1).success).toBe(false)
    })
  })

  describe('noop fluent 链式不抛错', () => {
    it('int/positive/min/url/transform 等仅作 fluent', () => {
      expect(() => Z.string().min(1).max(5).trim().email()).not.toThrow()
      expect(() => Z.number().int().positive().min(1).max(9).finite()).not.toThrow()
      expect(() => Z.object({}).strict().passthrough()).not.toThrow()
    })
  })
})

// ============================================================
//  包装类 API 面（optional / nullable / nullish / default / parse）
// ============================================================
//
// 补这一组的原因：降级实现的「包装类」（LiteOptional / LiteNullable / LiteWithDefault）
// 各自还有一层自己的 optional / default / parse，叶子类型（string / number / boolean /
// literal / enum / array）也各有一份 parse。只测「实际用得到的那几条链」时，这些方法体在
// 覆盖率报告里恒为 0 —— 而它们恰恰是 `optional().nullable().default()` 这类组合链会走到的
// 代码。断言全部打在 safeParse 的 success / data 与 parse 的抛错上，不引入任何 mock。

describe('包装类的 full API 面', () => {

  it('LiteOptional.optional() 语义等价于自身：放行 undefined，仍拦截非法值', () => {
    expect(optionalString().optional().safeParse(undefined).success).toBe(true)
    expect(optionalString().optional().safeParse('x').success).toBe(true)
    expect(optionalString().optional().safeParse(1).success).toBe(false)
  })

  it('LiteOptional.nullish() 等价于 nullable()：null / undefined 都放行', () => {
    const nullish = optionalString().nullish()
    expect(nullish.safeParse(null).success).toBe(true)
    expect(nullish.safeParse(undefined).success).toBe(true)
    expect(nullish.safeParse('ok').success).toBe(true)
    expect(nullish.safeParse(1).success).toBe(false)
  })

  it('LiteOptional.parse：成功返回原值（含 undefined），失败抛内层消息', () => {
    expect(optionalString().parse('a')).toBe('a')
    expect(optionalString().parse(undefined)).toBeUndefined()
    expect(() => optionalString().parse(1)).toThrow('expected string')
  })

  it('LiteNullable.optional() 放行 undefined；default() 仅在 undefined 时给默认值', () => {
    const nullable = optionalString().nullable()
    expect(nullable.optional().safeParse(null).success).toBe(true)
    expect(nullable.optional().safeParse(undefined).success).toBe(true)
    expect(nullable.optional().safeParse(1).success).toBe(false)

    const withDefault = nullable.default('兜底')
    expect(withDefault.safeParse(undefined)).toEqual({ success: true, data: '兜底' })
    expect(withDefault.safeParse('given')).toEqual({ success: true, data: 'given' })
    expect(withDefault.safeParse(1).success).toBe(false)
  })

  it('LiteNullable.parse：null 原样返回，非法值抛错', () => {
    const nullable = optionalString().nullable()
    expect(nullable.parse(null)).toBeNull()
    expect(nullable.parse('x')).toBe('x')
    expect(() => nullable.parse(1)).toThrow('expected string')
  })

  it('LiteWithDefault 再叠加 optional() / default() 时内层链不被破坏', () => {
    const base = Z.string().default('d1')

    const optionalSchema = base.optional()
    expect(optionalSchema.safeParse(undefined).success).toBe(true)
    expect(optionalSchema.safeParse('x')).toEqual({ success: true, data: 'x' })
    expect(optionalSchema.safeParse(1).success).toBe(false)

    const nested = base.default('d2')
    expect(nested.safeParse(undefined)).toEqual({ success: true, data: 'd2' })
  })

  it('LiteWithDefault.parse：有值走内层、undefined 走默认值、非法值抛错', () => {
    const base = Z.string().default('d1')
    expect(base.parse('v')).toBe('v')
    expect(base.parse(undefined)).toBe('d1')
    expect(() => base.parse(1)).toThrow('expected string')
  })

  it('叶子类型的 parse 成功路径', () => {
    expect(Z.string().parse('s')).toBe('s')
    expect(Z.number().parse(3.5)).toBe(3.5)
    expect(Z.boolean().parse(true)).toBe(true)
    expect(Z.literal('a').parse('a')).toBe('a')
    expect(Z.enum(['a', 'b']).parse('b')).toBe('b')
    expect(Z.array(Z.string()).parse(['a'])).toEqual(['a'])
  })

  it('叶子类型的 parse 失败路径一律抛错', () => {
    expect(() => Z.boolean().parse('true')).toThrow()
    expect(() => Z.literal('a').parse('b')).toThrow()
    expect(() => Z.enum(['a']).parse('z')).toThrow()
    expect(() => Z.array(Z.string()).parse('not-array')).toThrow()
  })

  it('叶子类型的 optional() / default()', () => {
    expect(Z.boolean().optional().safeParse(undefined).success).toBe(true)
    expect(Z.boolean().default(false).safeParse(undefined)).toEqual({ success: true, data: false })

    const literal = Z.literal('a')
    expect(literal.optional().safeParse(undefined).success).toBe(true)
    expect(literal.default('a').safeParse(undefined)).toEqual({ success: true, data: 'a' })

    expect(Z.enum(['a']).default('a').safeParse(undefined)).toEqual({ success: true, data: 'a' })

    const array = Z.array(Z.string())
    expect(array.optional().safeParse(undefined).success).toBe(true)
    expect(array.default([]).safeParse(undefined)).toEqual({ success: true, data: [] })
  })

  it('内层失败带 path 时，数组把索引拼在内层 path 之前', () => {
    const result = Z.array(Z.object({ name: Z.string() })).safeParse([{ name: 1 }])
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([0, 'name'])
  })

  it('异构 schema（失败但 issues 为空）时，数组 / 对象仍给出兜底文案与退化 path', () => {
    // 真实 zod 或自定义校验器完全可能在失败时给出空 issues。
    // 降级实现此时必须仍产出可读 message，并让 path 退化为「只有索引」/「只有键名」。
    const bare = {
      safeParse: () => ({ success: false, error: { issues: [] } }),
    } as unknown as LiteSchema

    const arrayResult = Z.array(bare).safeParse(['x'])
    expect(arrayResult.success).toBe(false)
    if (!arrayResult.success) {
      expect(arrayResult.error.issues[0]?.message).toBe('[0]: invalid')
      expect(arrayResult.error.issues[0]?.path).toEqual([0])
    }

    const objectResult = Z.object({ key: bare }).safeParse({ key: 1 })
    expect(objectResult.success).toBe(false)
    if (!objectResult.success) {
      expect(objectResult.error.issues[0]?.message).toBe('key "key": invalid')
      expect(objectResult.error.issues[0]?.path).toEqual(['key'])
    }
  })
})

// ============================================================
//  resolveZod：globalThis.z 探测
// ============================================================
//
// `export const z = resolveZod()` 只在模块求值时执行一次，因此必须
// `vi.resetModules()` 后重新 import 才能观察到不同分支。

describe('resolveZod 对 globalThis.z 的探测', () => {

  it('提供形状合法的 z（string 与 object 都是函数）时直接采用它', async () => {
    const fakeZod = { string: (): unknown => ({}), object: (): unknown => ({}) }
    expect(await importFresh(fakeZod)).toBe(fakeZod)
  })

  it('z 为假值 / 非对象 / string 非函数 / 缺 object 时一律回退到内置降级实现', async () => {
    for (const injected of [undefined, 0, 'zod', { string: 'nope' }, { string: () => {} }]) {
      const resolved = await importFresh(injected)
      expect(resolved).not.toBe(injected)
      // 内置实现的特征：string().safeParse('x') 通过
      expect(resolved.string().safeParse('x').success).toBe(true)
    }
  })
})
