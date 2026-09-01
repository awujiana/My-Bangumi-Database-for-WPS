import { describe, it, expect, beforeEach } from 'vitest'
import {
  logger,
  getRecentLogs,
  clearLogs,
  maskToken,
  maskSensitiveData,
} from '../ts/tools/logger.js'

describe('maskToken', () => {
  it('短于 4 字符时全掩码', () => {
    expect(maskToken('abc')).toBe('***')
  })

  it('4 字符时全掩码', () => {
    expect(maskToken('abcd')).toBe('****')
  })

  it('长 token 保留后 4 位', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const masked = maskToken(token)
    expect(masked.endsWith('6789')).toBe(true)
    expect(masked.length).toBe(28)
  })

  it('超长 token 只掩码最多 24 位前缀', () => {
    const token = 'a'.repeat(100)
    const masked = maskToken(token)
    expect(masked.endsWith('aaaa')).toBe(true)
  })
})

describe('maskSensitiveData', () => {
  it('应脱敏 token=xxx 模式', () => {
    const result = maskSensitiveData('请求 token=abcdefghijklmnop 返回结果')
    expect(result).not.toContain('abcdefghijklmnop')
    expect(result).toContain('token=')
  })

  it('应脱敏 token:xxx 模式', () => {
    const result = maskSensitiveData('认证 token:abcdefgh12345678')
    expect(result).not.toContain('abcdefgh12345678')
  })

  it('应脱敏 Bearer xxx 模式', () => {
    const result = maskSensitiveData('Authorization: Bearer abcdefghijklmn')
    expect(result).not.toContain('abcdefghijklmn')
    expect(result).toContain('Bearer ')
  })

  it('应保留不含敏感信息的字符串', () => {
    const result = maskSensitiveData('普通日志消息')
    expect(result).toBe('普通日志消息')
  })

  it('应处理多个敏感信息', () => {
    const result = maskSensitiveData('token=abcdefghijklmn 和 Bearer qrstuvwx12345678')
    expect(result).not.toContain('abcdefghijklmn')
    expect(result).not.toContain('qrstuvwx12345678')
  })
})

describe('logger', () => {
  beforeEach(() => {
    clearLogs()
  })

  it('应记录 info 日志', () => {
    logger.info('test info message')
    const logs = getRecentLogs('INFO')
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]?.level).toBe('INFO')
    expect(logs[0]?.message).toContain('test info message')
  })

  it('应记录 warn 日志', () => {
    logger.warn('test warn message')
    const logs = getRecentLogs('WARN')
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]?.level).toBe('WARN')
  })

  it('应记录 error 日志', () => {
    logger.error('test error message')
    const logs = getRecentLogs('ERROR')
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]?.level).toBe('ERROR')
  })

  it('应记录 debug 日志', () => {
    logger.debug('test debug message')
    const logs = getRecentLogs('DEBUG')
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]?.level).toBe('DEBUG')
  })

  it('getRecentLogs 应按级别过滤', () => {
    logger.info('info1')
    logger.warn('warn1')
    logger.error('error1')
    logger.info('info2')

    const infoLogs = getRecentLogs('INFO')
    expect(infoLogs.length).toBe(2)

    const errorLogs = getRecentLogs('ERROR')
    expect(errorLogs.length).toBe(1)

    const allLogs = getRecentLogs(undefined)
    expect(allLogs.length).toBe(4)
  })

  it('getRecentLogs 应按 limit 限制数量', () => {
    for (let i = 0; i < 2000; i += 1) {
      logger.info(`log-${String(i)}`)
    }
    const logs = getRecentLogs('INFO', 50)
    expect(logs.length).toBeLessThanOrEqual(50)
  })

  it('clearLogs 应清空所有日志', () => {
    logger.info('test')
    clearLogs()
    const logs = getRecentLogs()
    expect(logs.length).toBe(0)
  })

  it('应自动脱敏日志中的 token', () => {
    logger.info('使用 token=abcdefghijklmnop 进行认证')
    const logs = getRecentLogs('INFO')
    const logMsg = logs[0]?.message || ''
    expect(logMsg).not.toContain('abcdefghijklmnop')
  })

  it('日志条目应包含时间戳', () => {
    const before = Date.now()
    logger.info('timestamp test')
    const after = Date.now()
    const logs = getRecentLogs('INFO')
    const ts = logs[0]?.timestamp
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
})
