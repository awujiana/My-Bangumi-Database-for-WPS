// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface MockState {
  syncRecords: Record<string, unknown>[]
  systemLogs: Record<string, unknown>[]
  enrichRecords: Record<string, unknown>[]
  cleanLogs: Record<string, unknown>[]
  throwOnSync: boolean
  /** 记录 getRecentLogs 收到的 [level, limit]，用于验证级别筛选是否透传 */
  logCalls: (string | number | undefined)[][]
  exportCalls: {
    baseName: string
    headers: readonly string[]
    rows: unknown[][]
    format: string
  }[]
  toasts: string[]
}

const h = vi.hoisted((): MockState => ({
  syncRecords: [],
  systemLogs: [],
  enrichRecords: [],
  cleanLogs: [],
  throwOnSync: false,
  logCalls: [],
  exportCalls: [],
  toasts: [],
}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: (): void => {
    /* 测试不关心日志输出 */
  },
}))

vi.mock('../ts/ui/dialog.js', () => ({
  showToast: (message: string): void => {
    h.toasts.push(message)
  },
}))

vi.mock('../ts/tools/file-export.js', () => ({
  exportRows: (
    baseName: string,
    headers: readonly string[],
    rows: unknown[][],
    format: string,
  ): number => {
    h.exportCalls.push({ baseName, headers, rows, format })
    return rows.length
  },
}))

vi.mock('../ts/sync/sync-record.js', () => ({
  getAllSyncRecords: (): unknown => {
    if (h.throwOnSync) throw new Error('读取同步记录表失败')
    return h.syncRecords
  },
}))

vi.mock('../ts/sync/enrich-record.js', () => ({
  getAllEnrichRecords: (): unknown => h.enrichRecords,
}))

vi.mock('../ts/tools/logger.js', () => ({
  getRecentLogs: (level?: string, limit?: number): unknown => {
    h.logCalls.push([level, limit])
    return h.systemLogs
  },
}))

vi.mock('../ts/tools/operation-log.js', () => ({
  CLEAN_LOG_SCOPE: 'clean',
  getOperationLogs: (scope: string): unknown => (scope === 'clean' ? h.cleanLogs : []),
}))

import { EXPORT_SOURCES, getExportSource, exportData } from '../ts/ui/handlers/data-export.js'

beforeEach(() => {
  h.syncRecords = []
  h.systemLogs = []
  h.enrichRecords = []
  h.cleanLogs = []
  h.throwOnSync = false
  h.logCalls.length = 0
  h.exportCalls.length = 0
  h.toasts.length = 0
})

describe('EXPORT_SOURCES 注册表', () => {
  it('登记了四个数据源，key 唯一', () => {
    expect(EXPORT_SOURCES.map((source) => source.key)).toEqual([
      'syncRecords',
      'systemLogs',
      'enrichRecords',
      'cleanLogs',
    ])
  })

  it('每个源都有中文名与表头', () => {
    for (const source of EXPORT_SOURCES) {
      expect(source.label.length).toBeGreaterThan(0)
      expect(source.headers.length).toBeGreaterThan(0)
    }
  })

  it('getExportSource 能按 key 找到，未知 key 返回 undefined', () => {
    expect(getExportSource('cleanLogs')?.label).toBe('清理日志')
    expect(getExportSource('nope')).toBeUndefined()
  })
})

describe('exportData 主流程', () => {
  it('有数据时按格式调用 exportRows 并返回行数', () => {
    h.cleanLogs = [
      { timestamp: new Date(2026, 8, 13, 5, 4, 3).getTime(), level: 'ok', message: '删除 3 行' },
      { timestamp: new Date(2026, 8, 13, 5, 4, 4).getTime(), level: 'info', message: '完成' },
    ]
    const count = exportData('cleanLogs', 'csv')
    expect(count).toBe(2)
    expect(h.exportCalls).toHaveLength(1)
    expect(h.exportCalls[0]?.baseName).toBe('清理日志')
    expect(h.exportCalls[0]?.format).toBe('csv')
  })

  it('日志时间戳格式化为 YYYY-MM-DD HH:mm:ss', () => {
    h.cleanLogs = [
      { timestamp: new Date(2026, 8, 13, 5, 4, 3).getTime(), level: 'ok', message: 'm' },
    ]
    exportData('cleanLogs', 'txt')
    expect(h.exportCalls[0]?.rows[0]?.[0]).toBe('2026-09-13 05:04:03')
  })

  it('同步记录按表头顺序映射字段', () => {
    h.syncRecords = [
      {
        time: '2026-09-13 05:00:00',
        name: '葬送的芙莉莲',
        type: '动画',
        collType: '想看',
        status: '成功',
        count: 1,
        subjectId: '123',
        url: 'https://bgm.tv/subject/123',
        source: 'api',
        message: '',
      },
    ]
    exportData('syncRecords', 'csv')
    expect(h.exportCalls[0]?.rows[0]).toEqual([
      '2026-09-13 05:00:00',
      '葬送的芙莉莲',
      '动画',
      '想看',
      '成功',
      1,
      '123',
      'https://bgm.tv/subject/123',
      'api',
      '',
    ])
  })

  it('富化记录包含富化前后值', () => {
    h.enrichRecords = [
      {
        timestamp: '2026-09-13 05:00:00',
        matchType: '精确',
        name: 'A',
        row: 5,
        enrichedField: '首播日期',
        oldValue: '',
        updatedValue: '2026-04-01',
        action: 'fill',
        note: undefined,
      },
    ]
    exportData('enrichRecords', 'csv')
    expect(h.exportCalls[0]?.rows[0]).toEqual([
      '2026-09-13 05:00:00',
      '精确',
      'A',
      5,
      '首播日期',
      '',
      '2026-04-01',
      'fill',
      '',
    ])
  })

  it('导出成功后弹提示', () => {
    h.cleanLogs = [{ timestamp: Date.now(), level: 'info', message: 'm' }]
    exportData('cleanLogs', 'csv')
    expect(h.toasts[0]).toContain('已导出 1 条清理日志')
    expect(h.toasts[0]).toContain('CSV')
  })
})

describe('exportData 异常与边界', () => {
  it('未知数据源不导出，返回 0', () => {
    expect(exportData('nope', 'csv')).toBe(0)
    expect(h.exportCalls).toHaveLength(0)
  })

  it('无数据时不落文件，只提示「暂无」', () => {
    expect(exportData('cleanLogs', 'csv')).toBe(0)
    expect(h.exportCalls).toHaveLength(0)
    expect(h.toasts[0]).toContain('暂无清理日志')
  })

  it('取数抛错时提示失败，不导出', () => {
    h.throwOnSync = true
    expect(exportData('syncRecords', 'csv')).toBe(0)
    expect(h.exportCalls).toHaveLength(0)
    expect(h.toasts[0]).toContain('导出失败')
  })

  it('系统日志限取最近 1000 条（由 getRecentLogs 负责，此处仅验证透传）', () => {
    h.systemLogs = Array.from({ length: 3 }, () => ({
      timestamp: Date.now(),
      level: 'INFO',
      message: 'm',
    }))
    expect(exportData('systemLogs', 'txt')).toBe(3)
    expect(h.logCalls[0]).toEqual([undefined, 1000])
    expect(h.exportCalls[0]?.headers).toEqual(['时间', '级别', '消息'])
  })

  it('系统日志：级别筛选透传给 getRecentLogs，并写进文件名与提示', () => {
    h.systemLogs = [{ timestamp: Date.now(), level: 'ERROR', message: 'boom' }]
    expect(exportData('systemLogs', 'txt', { logLevel: 'ERROR' })).toBe(1)
    expect(h.logCalls[0]).toEqual(['ERROR', 1000])
    expect(h.exportCalls[0]?.baseName).toBe('系统日志-ERROR')
    expect(h.toasts[0]).toContain('（仅 ERROR）')
  })

  it('系统日志：不传筛选时文件名不带级别后缀', () => {
    h.systemLogs = [{ timestamp: Date.now(), level: 'INFO', message: 'm' }]
    exportData('systemLogs', 'txt')
    expect(h.exportCalls[0]?.baseName).toBe('系统日志')
    expect(h.toasts[0]).not.toContain('仅')
  })

  it('系统日志：筛选后无数据时，「暂无」提示里带上筛选条件', () => {
    expect(exportData('systemLogs', 'txt', { logLevel: 'DEBUG' })).toBe(0)
    expect(h.exportCalls).toHaveLength(0)
    expect(h.toasts[0]).toContain('暂无系统日志可导出（仅 DEBUG）')
  })

  it('筛选只对系统日志生效，其它数据源忽略该选项', () => {
    h.cleanLogs = [{ timestamp: Date.now(), level: 'info', message: 'm' }]
    expect(exportData('cleanLogs', 'csv', { logLevel: 'ERROR' })).toBe(1)
    expect(h.exportCalls[0]?.baseName).toBe('清理日志')
  })
})
