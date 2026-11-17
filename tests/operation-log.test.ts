import { describe, it, expect, beforeEach } from 'vitest'
import {
  appendOperationLog,
  getOperationLogs,
  clearOperationLogs,
  CLEAN_LOG_SCOPE,
} from '../ts/tools/operation-log.js'

beforeEach(() => {
  // each：各用例之间互不影响（模块内是全局 Map）
  clearOperationLogs(CLEAN_LOG_SCOPE)
  clearOperationLogs('other')
})

describe('operation-log 基础读写', () => {
  it('未写入时返回空数组', () => {
    expect(getOperationLogs('fresh')).toEqual([])
  })

  it('追加后可读回，默认级别为 info', () => {
    appendOperationLog(CLEAN_LOG_SCOPE, '开始扫描')
    const logs = getOperationLogs(CLEAN_LOG_SCOPE)
    expect(logs).toHaveLength(1)
    expect(logs[0]?.message).toBe('开始扫描')
    expect(logs[0]?.level).toBe('info')
    expect(typeof logs[0]?.timestamp).toBe('number')
  })

  it('可指定级别', () => {
    appendOperationLog(CLEAN_LOG_SCOPE, '删除失败', 'error')
    expect(getOperationLogs(CLEAN_LOG_SCOPE)[0]?.level).toBe('error')
  })

  it('按写入顺序返回', () => {
    appendOperationLog(CLEAN_LOG_SCOPE, 'a')
    appendOperationLog(CLEAN_LOG_SCOPE, 'b')
    expect(getOperationLogs(CLEAN_LOG_SCOPE).map((entry) => entry.message)).toEqual(['a', 'b'])
  })
})

describe('operation-log 作用域隔离', () => {
  it('不同 scope 互不影响', () => {
    appendOperationLog(CLEAN_LOG_SCOPE, 'clean 日志')
    appendOperationLog('other', 'other 日志')
    expect(getOperationLogs(CLEAN_LOG_SCOPE).map((entry) => entry.message)).toEqual(['clean 日志'])
    expect(getOperationLogs('other').map((entry) => entry.message)).toEqual(['other 日志'])
  })

  it('清空只影响指定 scope', () => {
    appendOperationLog(CLEAN_LOG_SCOPE, 'a')
    appendOperationLog('other', 'b')
    clearOperationLogs(CLEAN_LOG_SCOPE)
    expect(getOperationLogs(CLEAN_LOG_SCOPE)).toEqual([])
    expect(getOperationLogs('other')).toHaveLength(1)
  })
})

describe('operation-log 返回值安全', () => {
  it('返回副本，外部改动不影响内部存储', () => {
    appendOperationLog(CLEAN_LOG_SCOPE, '原始消息')
    const logs = getOperationLogs(CLEAN_LOG_SCOPE)
    if (logs[0]) logs[0].message = '被篡改'
    expect(getOperationLogs(CLEAN_LOG_SCOPE)[0]?.message).toBe('原始消息')
  })
})

describe('operation-log 容量上限', () => {
  it('超过 2000 条时丢弃最旧的，保留最新的', () => {
    for (let index = 0; index < 2005; index += 1) {
      appendOperationLog(CLEAN_LOG_SCOPE, `第 ${String(index)} 条`)
    }
    const logs = getOperationLogs(CLEAN_LOG_SCOPE)
    expect(logs).toHaveLength(2000)
    expect(logs[0]?.message).toBe('第 5 条')
    expect(logs[1999]?.message).toBe('第 2004 条')
  })
})
