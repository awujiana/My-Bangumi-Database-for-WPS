import { describe, it, expect } from 'vitest'
import { z } from '../ts/tools/zod-compat.js'

// zod-compat 的 lite 工厂返回 `any` 形态 schema；用最小接口把调用面收成类型安全，
// 避免 no-unsafe-* 全家桶。这是「刻意的 any → 已知形态」边界转换（见项目约定）。
type LiteResult =
  | { success: true; data: unknown }
  | { success: false; error: { issues: { path?: unknown }[] } }

interface LiteSchema {
  safeParse(value: unknown): LiteResult
  parse(value: unknown): unknown
  optional(): LiteSchema
  nullable(): LiteSchema
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
