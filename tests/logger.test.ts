//
// 说明：本文件全部是纯逻辑用例（环形缓冲区 / 脱敏 / 分级过滤），无 DOM 依赖，
// 因此跑默认的 node 环境即可。
// 日志的「导出到文件」不在本模块 —— 统一走 ui/handlers/data-export.ts 的注册表，
// 其浏览器下载路径（Blob + <a download>）由 tests/data-export.test.ts 覆盖。

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

  // P1-8 加固：键名覆盖范围从「仅 token」放宽到常见凭据命名（原实现只匹配 token= / token: / Bearer，access_token / client_secret / password 这类同样常见的写法会原样进日志）

  it.each([
    ['下划线变体 access_token', '请求体 access_token=abcdefghijklmnop&scope=read'],
    ['下划线变体 refresh_token', 'body refresh_token:zyxwvutsrqponml'],
    ['连字符变体 api-key', '头 api-key=abcdefghijklmnop'],
    ['client_secret', 'client_secret=abcdefghijklmnop'],
    ['password', 'password=abcdefghijklmnop'],
    ['passwd 简写', 'passwd=abcdefghijklmnop'],
  ])('应脱敏 %s', (_label, input) => {
    expect(maskSensitiveData(input)).not.toMatch(/abcdefghijklmnop|zyxwvutsrqponml/)
  })

  it('脱敏后仍保留可读的键名前缀（便于排查，不泄漏值）', () => {
    const result = maskSensitiveData('access_token=abcdefghijklmnop')
    expect(result.startsWith('access_token=')).toBe(true)
    expect(result).not.toContain('abcdefghijklmnop')
  })

  it('不得因放宽键名而误伤普通日志文案', () => {
    for (const message of [
      '普通日志消息',
      '[HTTP] 方法: POST',
      '[config] Token 已设置（长度: 64）',
      '[enrich] 富化完成: 12 条结果, 冲突 0 条',
      '[clean] 共删除 3 行，更新 5 个单元格',
    ]) {
      expect(maskSensitiveData(message), message).toBe(message)
    }
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
    for (let index = 0; index < 2000; index += 1) {
      logger.info(`log-${String(index)}`)
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
    const logMessage = logs[0]?.message ?? ''
    expect(logMessage).not.toContain('abcdefghijklmnop')
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
