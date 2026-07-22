/**
 * @fileoverview Result<T> 与 BgmError 单元测试
 *
 * 测试目标：
 *   - Result.ok / Result.fail / Result.fromCode 工厂方法
 *   - isOk / isFail / unwrap / unwrapOr 访问器
 *   - map / mapErr 转换方法
 *   - 边界场景：null/undefined/空字符串/0/false 作为成功值、链式调用
 *
 * 模块依赖说明：
 *   - core/result.ts 是纯类型/类模块，无副作用链，可在 Node 环境直接 import。
 *   - 注意：源码 Result 类没有 orElse 方法（任务描述提到，但实际 API 是 unwrapOr）。
 */

import { describe, it, expect, vi } from 'vitest'
import { Result, BgmError } from '../ts/core/result.js'

// ========== Result.ok ==========
describe('Result.ok', () => {
  it('包装成功值并返回 Result 实例', () => {
    const result = Result.ok(42)
    expect(result).toBeInstanceOf(Result)
    expect(result.isOk()).toBe(true)
    expect(result.isFail()).toBe(false)
    expect(result.success).toBe(true)
  })

  it('unwrap 返回包装的值', () => {
    const result = Result.ok('hello')
    expect(result.unwrap()).toBe('hello')
  })

  it('data 字段持有成功值，error 字段为 null', () => {
    const obj = { id: 1, name: 'test' }
    const result = Result.ok(obj)
    expect(result.data).toEqual(obj)
    expect(result.error).toBeNull()
  })
})

// ========== Result.fail ==========
describe('Result.fail', () => {
  it('包装错误并返回 Result 实例', () => {
    const err = new BgmError('失败', 'FAIL_CODE')
    const result = Result.fail<number>(err)
    expect(result).toBeInstanceOf(Result)
    expect(result.isOk()).toBe(false)
    expect(result.isFail()).toBe(true)
    expect(result.success).toBe(false)
  })

  it('unwrap 抛出包含错误消息的异常', () => {
    const err = new BgmError('失败原因', 'FAIL_CODE')
    const result = Result.fail<number>(err)
    expect(() => result.unwrap()).toThrow(/失败原因/)
  })

  it('error 字段持有 BgmError，data 字段为 null', () => {
    const err = new BgmError('错误', 'CODE')
    const result = Result.fail<number>(err)
    expect(result.error).toBe(err)
    expect(result.data).toBeNull()
  })
})

// ========== Result.fromCode ==========
describe('Result.fromCode', () => {
  it('200 状态码返回成功', () => {
    const r = Result.fromCode(200, { ok: true })
    expect(r.isOk()).toBe(true)
    expect(r.unwrap()).toEqual({ ok: true })
  })

  it('201 状态码返回成功', () => {
    const r = Result.fromCode(201, 'created')
    expect(r.isOk()).toBe(true)
    expect(r.unwrap()).toBe('created')
  })

  it('204 状态码（无内容）返回成功且 data 为 null', () => {
    const r = Result.fromCode<null>(204)
    expect(r.isOk()).toBe(true)
    expect(r.unwrap()).toBeNull()
  })

  it('4xx 状态码返回失败且错误码为状态码字符串', () => {
    const r = Result.fromCode(404)
    expect(r.isFail()).toBe(true)
    expect(r.error?.code).toBe('404')
    expect(r.error?.message).toBe('API Error')
  })

  it('5xx 状态码返回失败', () => {
    const r = Result.fromCode(500)
    expect(r.isFail()).toBe(true)
    expect(r.error?.code).toBe('500')
  })

  it('未提供 data 时 2xx 仍返回成功（值为 null）', () => {
    const r = Result.fromCode<null>(200)
    expect(r.isOk()).toBe(true)
    expect(r.unwrap()).toBeNull()
  })

  it('临界值：199 与 300 视为失败', () => {
    expect(Result.fromCode(199).isFail()).toBe(true)
    expect(Result.fromCode(300).isFail()).toBe(true)
  })
})

// ========== Result.map ==========
describe('Result.map', () => {
  it('对成功值应用转换函数', () => {
    const r = Result.ok(5)
    const mapped = r.map((x) => x * 2)
    expect(mapped.isOk()).toBe(true)
    expect(mapped.unwrap()).toBe(10)
  })

  it('转换函数可改变值类型', () => {
    const r = Result.ok(42)
    const mapped = r.map((x) => `数字是 ${x}`)
    expect(mapped.isOk()).toBe(true)
    expect(mapped.unwrap()).toBe('数字是 42')
  })

  it('失败结果不调用 fn 且保持失败状态', () => {
    const err = new BgmError('失败', 'CODE')
    const r = Result.fail<number>(err)
    const fn = vi.fn((x: number) => x * 2)
    const mapped = r.map(fn)
    expect(mapped.isFail()).toBe(true)
    expect(fn).not.toHaveBeenCalled()
    expect(mapped.error).toBe(err)
  })
})

// ========== Result.mapErr ==========
describe('Result.mapErr', () => {
  it('对失败错误应用转换函数', () => {
    const err = new BgmError('原始错误', 'ORIGINAL')
    const r = Result.fail<number>(err)
    const mapped = r.mapErr((e) => new BgmError(`包装: ${e.message}`, `WRAPPED_${e.code}`))
    expect(mapped.isFail()).toBe(true)
    expect(mapped.error?.message).toBe('包装: 原始错误')
    expect(mapped.error?.code).toBe('WRAPPED_ORIGINAL')
  })

  it('成功结果不调用 fn 且保持成功状态', () => {
    const r = Result.ok(42)
    const fn = vi.fn((e: BgmError) => new BgmError(e.message, e.code))
    const mapped = r.mapErr(fn)
    expect(mapped.isOk()).toBe(true)
    expect(fn).not.toHaveBeenCalled()
    expect(mapped.unwrap()).toBe(42)
  })
})

// ========== Result.unwrapOr ==========
describe('Result.unwrapOr', () => {
  it('成功时返回包装值（不使用默认值）', () => {
    const r = Result.ok('value')
    expect(r.unwrapOr('default')).toBe('value')
  })

  it('失败时返回默认值', () => {
    const r = Result.fail<string>(new BgmError('失败', 'CODE'))
    expect(r.unwrapOr('default')).toBe('default')
  })

  it('默认值可以是复杂对象', () => {
    const r = Result.fail<{ id: number }>(new BgmError('失败', 'CODE'))
    expect(r.unwrapOr({ id: 0 })).toEqual({ id: 0 })
  })

  it('默认值 null 也可被返回', () => {
    const r = Result.fail<null>(new BgmError('失败', 'CODE'))
    expect(r.unwrapOr(null)).toBeNull()
  })
})

// ========== 边界场景 ==========
describe('Result 边界场景', () => {
  it('null 可作为成功值被包装', () => {
    const r = Result.ok<null>(null)
    expect(r.isOk()).toBe(true)
    expect(r.unwrap()).toBeNull()
  })

  it('undefined 可作为成功值被包装', () => {
    const r = Result.ok<undefined>(undefined)
    expect(r.isOk()).toBe(true)
    expect(r.unwrap()).toBeUndefined()
  })

  it('空字符串可作为成功值', () => {
    const r = Result.ok('')
    expect(r.isOk()).toBe(true)
    expect(r.unwrap()).toBe('')
  })

  it('数字 0 可作为成功值', () => {
    const r = Result.ok(0)
    expect(r.isOk()).toBe(true)
    expect(r.unwrap()).toBe(0)
  })

  it('false 可作为成功值', () => {
    const r = Result.ok(false)
    expect(r.isOk()).toBe(true)
    expect(r.unwrap()).toBe(false)
  })

  it('链式 map 调用：ok → map → map → unwrap', () => {
    const r = Result.ok(5)
      .map((x) => x + 1)
      .map((x) => x * 2)
      .map((x) => `结果: ${x}`)
    expect(r.unwrap()).toBe('结果: 12')
  })

  it('链式 map 在失败时短路（不调用后续 fn）', () => {
    const err = new BgmError('失败', 'CODE')
    const fn1 = vi.fn((x: number) => x + 1)
    const fn2 = vi.fn((x: number) => x * 2)
    const r = Result.fail<number>(err).map(fn1).map(fn2)
    expect(r.isFail()).toBe(true)
    expect(r.error).toBe(err)
    expect(fn1).not.toHaveBeenCalled()
    expect(fn2).not.toHaveBeenCalled()
  })

  it('mapErr 链式调用：fail → mapErr → mapErr', () => {
    const r = Result.fail<number>(new BgmError('原始', 'A'))
      .mapErr((e) => new BgmError(`${e.message}-1`, `${e.code}B`))
      .mapErr((e) => new BgmError(`${e.message}-2`, `${e.code}C`))
    expect(r.isFail()).toBe(true)
    expect(r.error?.message).toBe('原始-1-2')
    expect(r.error?.code).toBe('ABC')
  })

  it('unwrapOr 链式：失败后返回默认值（不调用后续 map fn）', () => {
    const fn = vi.fn((x: number) => x * 2)
    const r = Result.fail<number>(new BgmError('失败', 'CODE'))
      .map(fn)
      .mapErr((e) => e)
    expect(r.unwrapOr(-1)).toBe(-1)
    expect(fn).not.toHaveBeenCalled()
  })

  it('ok 与 fail 不可互换：isOk 与 isFail 互斥', () => {
    const ok = Result.ok(1)
    const fail = Result.fail<number>(new BgmError('e', 'C'))
    expect(ok.isOk()).not.toBe(ok.isFail())
    expect(fail.isOk()).not.toBe(fail.isFail())
  })
})

// ========== BgmError ==========
describe('BgmError', () => {
  it('默认 code 为 UNKNOWN', () => {
    const e = new BgmError('消息')
    expect(e.code).toBe('UNKNOWN')
    expect(e.message).toBe('消息')
    expect(e.name).toBe('BgmError')
    expect(e instanceof Error).toBe(true)
  })

  it('details 默认为空对象', () => {
    const e = new BgmError('消息', 'CODE')
    expect(e.details).toEqual({})
  })

  it('timestamp 为合法 ISO 格式字符串', () => {
    const e = new BgmError('消息', 'CODE')
    expect(typeof e.timestamp).toBe('string')
    expect(() => new Date(e.timestamp).toISOString()).not.toThrow()
  })

  it('toString 输出 [code] message 格式', () => {
    const e = new BgmError('出错了', 'MY_CODE')
    expect(e.toString()).toBe('[MY_CODE] 出错了')
  })

  it('可携带 details 上下文', () => {
    const e = new BgmError('失败', 'CODE', { userId: 123, endpoint: '/api' })
    expect(e.details.userId).toBe(123)
    expect(e.details.endpoint).toBe('/api')
  })

  it('BgmError 可被 instanceof Error 识别', () => {
    const e = new BgmError('msg', 'CODE')
    expect(e instanceof Error).toBe(true)
    expect(e instanceof BgmError).toBe(true)
  })

  it('类型守卫：isError 模式（unknown 缩窄）', () => {
    function isBgmError(value: unknown): value is BgmError {
      return value instanceof BgmError
    }
    const e: unknown = new BgmError('msg', 'CODE')
    expect(isBgmError(e)).toBe(true)
    expect(isBgmError(new Error('plain'))).toBe(false)
    expect(isBgmError('string')).toBe(false)
    expect(isBgmError(null)).toBe(false)
  })
})
