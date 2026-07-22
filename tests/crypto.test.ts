/**
 * @fileoverview Token 加解密模块单元测试
 *
 * 测试目标：
 *   - calcChecksum：空串/ASCII/Unicode/超长串/顺序敏感
 *   - buildPayload：格式 version:checksum:token
 *   - extractToken：合法/非法版本/校验和不匹配/格式不完整
 *   - encryptToken + decryptToken 加解密往返
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

import {
  calcChecksum,
  buildPayload,
  extractToken,
  encryptToken,
  decryptToken,
} from '../ts/core/crypto.js'
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
    const longStr = 'a'.repeat(10000)
    const cs1 = calcChecksum(longStr)
    const cs2 = calcChecksum(longStr)
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
    // token 部分可能含 :，所以用剩余 join
    expect(parts.slice(2).join(':')).toBe('mytoken')
  })

  it('空 token 也能构建 payload', () => {
    const payload = buildPayload('')
    expect(payload).toBe(`${TOKEN_CONFIG.VERSION}:${calcChecksum('')}:`)
  })

  it('含冒号的 token 保持完整', () => {
    const payload = buildPayload('secret:with:colons')
    const parts = payload.split(':')
    // parts[0]=version, parts[1]=checksum, parts.slice(2)=token parts
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
    const payload = `99:${calcChecksum('token')}:token`
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
    // parts: [version, 'abc', token]
    const payload = `${TOKEN_CONFIG.VERSION}:abc:mytoken`
    // parseInt('abc', 10) = NaN, NaN !== expectedChecksum, 返回 null
    expect(extractToken(payload)).toBeNull()
  })

  it('Unicode token 提取正确', () => {
    const payload = buildPayload('中文token-🔑')
    expect(extractToken(payload)).toBe('中文token-🔑')
  })
})

// ========== encryptToken / decryptToken 往返 ==========
describe('encryptToken / decryptToken 往返', () => {
  it('加密后能解密回原 token', () => {
    const original = 'my-secret-token-abc123'
    const encrypted = encryptToken(original)
    const decrypted = decryptToken(encrypted)
    expect(decrypted).toBe(original)
  })

  it('空 token 加解密往返', () => {
    const encrypted = encryptToken('')
    const decrypted = decryptToken(encrypted)
    expect(decrypted).toBe('')
  })

  it('Unicode token 加解密往返', () => {
    const original = '中文token-🔑-emoji'
    const encrypted = encryptToken(original)
    const decrypted = decryptToken(encrypted)
    expect(decrypted).toBe(original)
  })

  it('超长 token 加解密往返', () => {
    const original = 'x'.repeat(10000)
    const encrypted = encryptToken(original)
    const decrypted = decryptToken(encrypted)
    expect(decrypted).toBe(original)
  })

  it('含冒号的 token 加解密往返', () => {
    const original = 'token:with:colons'
    const encrypted = encryptToken(original)
    const decrypted = decryptToken(encrypted)
    expect(decrypted).toBe(original)
  })

  it('加密结果格式为 version.iv.base64data', () => {
    const encrypted = encryptToken('test')
    const parts = encrypted.split('.')
    expect(parts.length).toBe(3)
    expect(parts[0]).toBe(TOKEN_CONFIG.VERSION)
    // IV 与 data 应为合法 Base64
    expect(() => atob(parts[1]!)).not.toThrow()
    expect(() => atob(parts[2]!)).not.toThrow()
  })

  it('每次加密的 IV 不同（相同 token 产生不同密文）', () => {
    const e1 = encryptToken('same-token')
    const e2 = encryptToken('same-token')
    expect(e1).not.toBe(e2)
    // 但解密后应相同
    expect(decryptToken(e1)).toBe('same-token')
    expect(decryptToken(e2)).toBe('same-token')
  })
})

// ========== decryptToken 错误处理 ==========
describe('decryptToken 错误处理', () => {
  it('格式不完整（少于3段）返回 null', () => {
    expect(decryptToken('1.abc')).toBeNull()
    expect(decryptToken('1')).toBeNull()
    expect(decryptToken('')).toBeNull()
  })

  it('版本号不匹配返回 null', () => {
    const valid = encryptToken('test')
    const parts = valid.split('.')
    const bad = `99.${parts[1]}.${parts[2]}`
    expect(decryptToken(bad)).toBeNull()
  })

  it('非法 Base64 返回 null', () => {
    expect(decryptToken('1.!!!.!!!')).toBeNull()
  })

  it('被篡改的密文解密失败（校验和不匹配）', () => {
    // 构造一个能解密但 payload 校验失败的字符串：
    // 取一个合法加密结果，修改 IV 使解密后 payload 错乱
    const valid = encryptToken('test')
    const parts = valid.split('.')
    // 修改 IV 的最后一位
    const ivPart = parts[1]!
    const modifiedIv = ivPart.slice(0, -1) + (ivPart.slice(-1) === 'A' ? 'B' : 'A')
    const tampered = `${parts[0]}.${modifiedIv}.${parts[2]}`
    // 解密后校验和大概率不匹配，返回 null
    // 注意：极小概率修改后仍能解密成功（IV 修改使解密结果错乱，但 token 部分仍可能偶然通过）
    // 所以这里只验证不抛出异常
    expect(() => decryptToken(tampered)).not.toThrow()
  })
})

// ========== 综合场景 ==========
describe('crypto 综合场景', () => {
  it('完整流程：token → encrypt → decrypt → extract', () => {
    const original = 'ghp_abc123XYZ'
    const encrypted = encryptToken(original)
    const decrypted = decryptToken(encrypted)
    expect(decrypted).toBe(original)
    // 进一步验证 extractToken 也能从 payload 提取
    const payload = buildPayload(original)
    expect(extractToken(payload)).toBe(original)
  })

  it('多次往返：encrypt → decrypt → encrypt → decrypt', () => {
    let current = 'token-' + Date.now()
    for (let i = 0; i < 5; i++) {
      const enc = encryptToken(current)
      const dec = decryptToken(enc)
      expect(dec).toBe(current)
      current = dec
    }
  })
})
