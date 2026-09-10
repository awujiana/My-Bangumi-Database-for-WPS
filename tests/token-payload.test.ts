/**
 * @fileoverview Token 校验与完整性验证模块单元测试
 *
 * 测试目标：
 *   - calcChecksum：空串/ASCII/Unicode/超长串/顺序敏感
 *   - buildPayload：格式 version:checksum:token
 *   - extractToken：合法/非法版本/校验和不匹配/格式不完整
 *
 * 模块依赖说明：
 *   - crypto.ts 导入 '../index.js'，触发 index → ui/handlers 的副作用链，
 *     handlers.ts 顶层访问 document.readyState 并通过 trackedSetTimeout 调度延迟回调。
 *   - 使用 vi.hoisted() 在所有 import 之前启用 fake timers，
 *     使 handlers.ts 模块加载时调度的 setTimeout 进入 fake 队列而不会真实触发。
 *   - 需要 jsdom 环境以提供 document/window。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

import { calcChecksum, buildPayload, extractToken } from '../ts/core/token-payload.js'
import { TOKEN_CONFIG } from '../ts/core/constants.js'

// 清空模块加载期间累积的 fake timers，避免它们在测试中被意外触发
vi.clearAllTimers()

afterEach(() => {
  vi.clearAllTimers()
})

afterAll(() => {
  vi.useRealTimers()
})

// ========== calcChecksum ==========
describe('calcChecksum', () => {
  it('空字符串返回 0（循环不执行）', () => {
    expect(calcChecksum('')).toBe(0)
  })

  it('ASCII 字符串返回稳定的校验和（0-255）', () => {
    const cs1 = calcChecksum('hello')
    const cs2 = calcChecksum('hello')
    expect(cs1).toBe(cs2)
    expect(cs1).toBeGreaterThanOrEqual(0)
    expect(cs1).toBeLessThan(256)
  })

  it('不同字符串返回不同校验和（大概率）', () => {
    const cs1 = calcChecksum('hello')
    const cs2 = calcChecksum('world')
    expect(cs1).not.toBe(cs2)
  })

  it('Unicode 字符串（中文）返回有效校验和', () => {
    const cs = calcChecksum('你好世界')
    expect(cs).toBeGreaterThanOrEqual(0)
    expect(cs).toBeLessThan(256)
  })

  it('Emoji 字符串返回有效校验和', () => {
    const cs = calcChecksum('🎉🎊🎈')
    expect(cs).toBeGreaterThanOrEqual(0)
    expect(cs).toBeLessThan(256)
  })

  it('超长字符串（10000 字符）返回有效且稳定的校验和', () => {
    const longString = 'a'.repeat(10_000)
    const cs1 = calcChecksum(longString)
    const cs2 = calcChecksum(longString)
    expect(cs1).toBe(cs2)
    expect(cs1).toBeGreaterThanOrEqual(0)
    expect(cs1).toBeLessThan(256)
  })

  it('顺序敏感：abc 与 cba 返回不同校验和', () => {
    expect(calcChecksum('abc')).not.toBe(calcChecksum('cba'))
  })

  it('单字符与多字符返回不同校验和', () => {
    expect(calcChecksum('a')).not.toBe(calcChecksum('aa'))
  })
})

// ========== buildPayload ==========
describe('buildPayload', () => {
  it('格式为 version:checksum:token', () => {
    const payload = buildPayload('mytoken')
    const parts = payload.split(':')
    expect(parts.length).toBeGreaterThanOrEqual(3)
    expect(parts[0]).toBe(TOKEN_CONFIG.VERSION)
    expect(parts[1]).toBe(String(calcChecksum('mytoken')))
    expect(parts.slice(2).join(':')).toBe('mytoken')
  })

  it('空 token 也能构建 payload', () => {
    const payload = buildPayload('')
    expect(payload).toBe(`${TOKEN_CONFIG.VERSION}:${String(calcChecksum(''))}:`)
  })

  it('含冒号的 token 保持完整', () => {
    const payload = buildPayload('secret:with:colons')
    const parts = payload.split(':')
    expect(parts[0]).toBe(TOKEN_CONFIG.VERSION)
    expect(parts.slice(2).join(':')).toBe('secret:with:colons')
  })

  it('Unicode token 也能构建 payload', () => {
    const payload = buildPayload('中文token')
    const parts = payload.split(':')
    expect(parts[0]).toBe(TOKEN_CONFIG.VERSION)
    expect(parts.slice(2).join(':')).toBe('中文token')
  })
})

// ========== extractToken ==========
describe('extractToken', () => {
  it('合法 payload 提取 token', () => {
    const payload = buildPayload('valid-token-123')
    expect(extractToken(payload)).toBe('valid-token-123')
  })

  it('payload 包含冒号的 token 仍能正确提取', () => {
    const payload = buildPayload('secret:with:colons')
    expect(extractToken(payload)).toBe('secret:with:colons')
  })

  it('版本号不匹配返回 null', () => {
    const payload = `99:${String(calcChecksum('token'))}:token`
    expect(extractToken(payload)).toBeNull()
  })

  it('校验和不匹配返回 null', () => {
    const payload = `${TOKEN_CONFIG.VERSION}:999:mytoken`
    expect(extractToken(payload)).toBeNull()
  })

  it('格式不完整（少于3段）返回 null', () => {
    expect(extractToken('1:123')).toBeNull()
    expect(extractToken('1')).toBeNull()
    expect(extractToken('')).toBeNull()
  })

  it('空字符串返回 null', () => {
    expect(extractToken('')).toBeNull()
  })

  it('校验和为非数字字符串时返回 null', () => {
    const payload = `${TOKEN_CONFIG.VERSION}:abc:mytoken`
    expect(extractToken(payload)).toBeNull()
  })

  it('Unicode token 提取正确', () => {
    const payload = buildPayload('中文token-🔑')
    expect(extractToken(payload)).toBe('中文token-🔑')
  })
})

// ========== 综合场景 ==========
describe('crypto 综合场景', () => {
  it('完整流程：token → buildPayload → extract', () => {
    const original = 'ghp_abc123XYZ'
    const payload = buildPayload(original)
    const extracted = extractToken(payload)
    expect(extracted).toBe(original)
  })

  it('多次往返：buildPayload → extract 重复验证', () => {
    const original = `token-${String(Date.now())}`
    for (let index = 0; index < 5; index += 1) {
      const payload = buildPayload(original)
      const extracted = extractToken(payload)
      expect(extracted).toBe(original)
    }
  })
})
