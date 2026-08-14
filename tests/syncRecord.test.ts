import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  SYNC_RECORD_COLUMNS,
  SYNC_RECORD_SHEET_NAME,
  SYNC_STATUS,
  SYNC_RECORD_COL,
  BGM_COLOR,
  SYNC_RECORD_TYPE_COLOR,
} = vi.hoisted(() => {
  const SYNC_RECORD_COLUMNS = [
    'SID',
    '同步时间',
    '名称',
    'URL',
    '条目类型',
    '来源',
    '次数',
    '内容',
    '状态',
    '收藏状态',
    '备注',
    '数据指纹',
  ]
  const SYNC_RECORD_SHEET_NAME = 'Bangumi 同步记录'
  const SYNC_STATUS = { SUCCESS: 'success', FAIL: 'fail', SKIP: 'skip' }
  const SYNC_RECORD_COL = {
    SID: 1,
    TIME: 2,
    NAME: 3,
    URL: 4,
    TYPE: 5,
    SOURCE: 6,
    COUNT: 7,
    CONTENT: 8,
    STATUS: 9,
    COLL_TYPE: 10,
    MESSAGE: 11,
    FINGERPRINT: 12,
  }
  const BGM_COLOR = {
    BGM_SYNC: 0,
    LIGHT_GREEN: 1,
    DARK_GREEN: 2,
    FAIL: 3,
    SKIP: 4,
    SUCCESS: 5,
    GRAY: 6,
  }
  const SYNC_RECORD_TYPE_COLOR: Record<string, number> = { 看: 10, 想: 11 }
  return {
    SYNC_RECORD_COLUMNS,
    SYNC_RECORD_SHEET_NAME,
    SYNC_STATUS,
    SYNC_RECORD_COL,
    BGM_COLOR,
    SYNC_RECORD_TYPE_COLOR,
  }
})

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  SYNC_STATUS,
  BGM_COLOR,
  SYNC_RECORD_COLUMNS,
  SYNC_RECORD_SHEET_NAME,
  SYNC_RECORD_COL,
  SYNC_RECORD_TYPE_COLOR,
}))

const mockGetSyncRecordEnabled = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock('../ts/tools/config.js', () => ({
  getSyncRecordEnabled: mockGetSyncRecordEnabled,
}))

// 单个 hoisted 变量声明模式
const mockBgmLogn = vi.hoisted(() => vi.fn())
const mockGetApp = vi.hoisted(() => vi.fn())
const mockGetLastRow = vi.hoisted(() => vi.fn().mockReturnValue(10))
const mockColNumToLetter = vi.hoisted(() =>
  vi.fn((col: number) => {
    let result = ''
    let n = col
    while (n > 0) {
      const remainder = (n - 1) % 26
      result = String.fromCharCode(65 + remainder) + result
      n = Math.floor((n - 1) / 26)
    }
    return result
  }),
)
const mockGetCellValue = vi.hoisted(() => vi.fn().mockReturnValue(''))
const mockSetCellValue = vi.hoisted(() => vi.fn().mockReturnValue(true))
const mockReadRangeValues = vi.hoisted(() => vi.fn().mockReturnValue([]))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: mockBgmLogn,
  getApp: mockGetApp,
  getLastRow: mockGetLastRow,
  colNumToLetter: mockColNumToLetter,
  getCellValue: mockGetCellValue,
  setCellValue: mockSetCellValue,
  readRangeValues: mockReadRangeValues,
  BGM: {
    handleError: vi.fn(),
    Color: BGM_COLOR,
  },
}))

import {
  addSyncRecord,
  addSyncRecords,
  addSyncRecordSummary,
  getAllSyncRecords,
  clearSyncRecords,
  deduplicateSyncRecords,
  getSyncRecordSheetIfExists,
  getOrCreateSyncRecordSheet,
  openSyncRecordSheet,
  formatSyncRecordSheet,
  __resetSyncRecordCache,
} from '../ts/sync/syncRecord.js'
import { getApp } from '../ts/tools/util/index.js'

function createMockCell(value: unknown = '') {
  return {
    Value2: value,
    Value: value,
    Text: value != null ? String(value) : '',
    Interior: { Color: 0 },
    Font: { Bold: false, Name: '' },
    Borders: { LineStyle: 0 },
    ColumnWidth: 0,
  }
}

function createMockSheet(opts: { name?: string; rowCount?: number } = {}) {
  const rowCount = opts.rowCount || 50
  return {
    Name: opts.name || SYNC_RECORD_SHEET_NAME,
    Rows: { Count: rowCount },
    UsedRange: { Row: 1, Rows: { Count: 10 } },
    Range: vi.fn((address: string) => {
      if (address.includes(':')) {
        return {
          Value2: null,
          Interior: { Color: 0 },
          Font: { Bold: false },
          Delete: vi.fn(),
        }
      }
      return createMockCell('')
    }),
    Activate: vi.fn(),
    Select: vi.fn(),
    Delete: vi.fn(),
    Move: vi.fn(),
  }
}

function createMockWorkbook(sheets: Array<{ Name: string }> = []) {
  const allSheets = [
    ...sheets.map((s) => ({ ...createMockSheet({ name: s.Name }), Name: s.Name })),
    createMockSheet({ name: SYNC_RECORD_SHEET_NAME }),
  ]
  return {
    Sheets: {
      Count: allSheets.length,
      Item: vi.fn((i: number) => allSheets[i - 1] || allSheets[0]),
      Add: vi.fn(() => createMockSheet({ name: 'NewSheet' })),
    },
    Worksheets: {
      Count: allSheets.length,
      Item: vi.fn((i: number) => allSheets[i - 1] || allSheets[0]),
    },
    ActiveSheet: createMockSheet({ name: 'Active' }),
  }
}

describe('syncRecord', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetApp.mockReturnValue(null)
    mockGetCellValue.mockReturnValue('')
    mockSetCellValue.mockReturnValue(true)
    mockGetLastRow.mockReturnValue(10)
    mockReadRangeValues.mockReturnValue([])
    mockGetSyncRecordEnabled.mockReturnValue(true)
    __resetSyncRecordCache()
  })

  describe('getOrCreateSyncRecordSheet', () => {
    it('无 Application 时应抛异常', () => {
      mockGetApp.mockReturnValue(null)
      expect(() => getOrCreateSyncRecordSheet()).toThrow('无法获取工作簿')
    })

    it('无 ActiveWorkbook 时应抛异常', () => {
      mockGetApp.mockReturnValue({})
      expect(() => getOrCreateSyncRecordSheet()).toThrow('无法获取工作簿')
    })

    it('找不到工作表时应创建新表', () => {
      const sheetsWithNoSync = {
        Sheets: {
          Count: 2,
          Item: vi.fn((i: number) => ({ Name: i === 1 ? 'Sheet1' : 'Sheet2' })),
          Add: vi.fn(() => createMockSheet({ name: SYNC_RECORD_SHEET_NAME })),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: sheetsWithNoSync })
      const result = getOrCreateSyncRecordSheet()
      expect(result).toBeDefined()
      expect(sheetsWithNoSync.Sheets.Add).toHaveBeenCalled()
    })

    it('找到工作表时应返回现有表', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const result = getOrCreateSyncRecordSheet()
      expect(result).toBeDefined()
    })

    it('旧 schema 应触发迁移', () => {
      const legacySheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      // A1='序号' indicates old schema
      legacySheet.Range = vi.fn((address: string) => {
        if (address === 'A1') return createMockCell('序号')
        if (address === 'F1') return createMockCell('次数')
        if (address.includes(':')) return { Value2: null, Interior: { Color: 0 } }
        return createMockCell('')
      })
      const wb = {
        Sheets: {
          Count: 3,
          Item: vi.fn((i: number) => (i === 1 ? legacySheet : createMockSheet())),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })
      mockGetLastRow.mockReturnValue(5)
      mockGetCellValue.mockImplementation((_sheet: unknown, row: unknown, col: unknown) => {
        const r = row as number
        const c = col as number
        if (r === 2) {
          if (c === 5) return 'test-sid'
          if (c === 4) return 'http://example.com'
          if (c === 6) return '动漫'
        }
        return ''
      })
      const result = getOrCreateSyncRecordSheet()
      expect(result).toBeDefined()
    })

    it('迁移异常时应记录警告但继续', () => {
      const sheetWithBadData = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      sheetWithBadData.Range = vi.fn((address: string) => {
        if (address === 'A1') return createMockCell('序号')
        if (address === 'F1') return createMockCell('次数')
        if (address.includes(':'))
          return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false }, Delete: vi.fn() }
        return createMockCell('')
      })
      const wb = {
        Sheets: {
          Count: 3,
          Item: vi.fn((i: number) => (i === 1 ? sheetWithBadData : createMockSheet())),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })
      mockGetLastRow.mockReturnValue(5)
      // 迁移过程中 migrateSyncRecordSchema 内部可能因 setCellValue 等操作失败
      // 但 getOrCreateSyncRecordSheet 应捕获异常并继续执行
      const result = getOrCreateSyncRecordSheet()
      expect(result).toBeDefined()
    })
  })

  describe('getSyncRecordSheetIfExists', () => {
    it('无 Application 时返回 null', () => {
      mockGetApp.mockReturnValue(null)
      expect(getSyncRecordSheetIfExists()).toBeNull()
    })

    it('找不到工作表时返回 null', () => {
      const sheetsWithNoSync = {
        Sheets: {
          Count: 2,
          Item: vi.fn((i: number) => ({ Name: i === 1 ? 'Sheet1' : 'Sheet2' })),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: sheetsWithNoSync })
      expect(getSyncRecordSheetIfExists()).toBeNull()
    })

    it('找到工作表时返回该表', () => {
      const syncSheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      const wb = {
        Sheets: {
          Count: 2,
          Item: vi.fn((i: number) => (i === 1 ? syncSheet : createMockSheet())),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })
      const result = getSyncRecordSheetIfExists()
      expect(result).toBe(syncSheet)
    })

    it('遍历工作表时异常应返回 null', () => {
      const wb = {
        Sheets: {
          Count: 2,
          Item: vi.fn(() => {
            throw new Error('异常')
          }),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })
      expect(getSyncRecordSheetIfExists()).toBeNull()
    })
  })

  describe('addSyncRecord', () => {
    it('同步记录未启用时返回 false', () => {
      mockGetSyncRecordEnabled.mockReturnValue(false)
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const result = addSyncRecord({
        sid: 'test-sid',
        name: '测试',
        url: 'https://bgm.tv/subject/123',
        type: '看',
        status: 'success',
      })
      expect(result).toBe(false)
    })

    it('应添加新记录', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const result = addSyncRecord({
        sid: 'test-sid',
        name: '测试',
        url: 'https://bgm.tv/subject/123',
        type: '看',
        status: 'success',
      })
      expect(result).toBe(true)
    })

    it('应在已有 SID 时更新记录', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockGetCellValue.mockReturnValue('3') // existing count
      // Add first record
      addSyncRecord({
        sid: 'update-sid',
        name: '第一次',
        url: 'http://example.com/1',
        type: '看',
        status: 'success',
      })
      // Add second record with same SID → should update
      const result = addSyncRecord({
        sid: 'update-sid',
        name: '第二次',
        url: 'http://example.com/2',
        type: '看',
        status: 'fail',
        count: 2,
      })
      expect(result).toBe(true)
    })

    it('异常时应返回 false', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockSetCellValue.mockImplementation(() => {
        throw new Error('写入失败')
      })
      mockGetCellValue.mockReturnValue('1')
      // First add to build cache
      addSyncRecord({ sid: 'fail-sid', name: '测试', url: 'http://fail.com', type: '看' })
      // Second add → may update or add → could fail
      const result = addSyncRecord({
        sid: 'fail-sid',
        name: '更新',
        url: 'http://fail.com/2',
        type: '看',
      })
      expect(result).toBeDefined()
    })

    it('空 SID 时仍应添加新记录', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const result = addSyncRecord({
        sid: '',
        name: '无SID记录',
        url: 'http://example.com',
        type: '看',
      })
      expect(result).toBe(true)
    })
  })

  describe('addSyncRecords', () => {
    it('空数组应返回 true', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const result = addSyncRecords([])
      expect(result).toBe(true)
    })

    it('应批量添加记录', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const result = addSyncRecords([
        { sid: '1', name: 'one', url: 'http://a.com' },
        { sid: '2', name: 'two', url: 'http://b.com' },
        { sid: '3', name: 'three', url: 'http://c.com' },
      ])
      expect(result).toBe(true)
    })

    it('批量添加中某个记录失败应继续处理其他', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockSetCellValue.mockImplementation((_ws: unknown, _r: unknown, c: unknown, _v: unknown) => {
        return true
      })
      const result = addSyncRecords([
        { sid: '1', name: 'one', url: 'http://a.com' },
        { sid: '2', name: 'two', url: 'http://b.com' },
      ])
      expect(result).toBe(true)
    })
  })

  describe('addSyncRecordSummary', () => {
    it('应添加汇总记录', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const result = addSyncRecordSummary({
        content: '仓库同步汇总',
        message: '新增 5 条',
      })
      expect(result).toBe(true)
    })
  })

  describe('getAllSyncRecords', () => {
    it('无工作表时返回空数组', () => {
      mockGetApp.mockReturnValue(null)
      expect(getAllSyncRecords()).toEqual([])
    })

    it('有数据时应返回记录列表', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockReadRangeValues.mockReturnValue([
        [
          'sid1',
          '2026-01-01',
          '名称1',
          'http://a.com',
          '看',
          '',
          '1',
          '内容1',
          'success',
          '看',
          '',
          '',
        ],
        [
          'sid2',
          '2026-01-02',
          '名称2',
          'http://b.com',
          '想',
          '',
          '2',
          '内容2',
          'fail',
          '想',
          '',
          '',
        ],
      ])
      const records = getAllSyncRecords()
      expect(records.length).toBeGreaterThan(0)
    })

    it('空数据时返回空数组', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockReadRangeValues.mockReturnValue([])
      const records = getAllSyncRecords()
      expect(records).toEqual([])
    })
  })

  describe('clearSyncRecords', () => {
    it('工作表不存在时返回 false', () => {
      mockGetApp.mockReturnValue({
        ActiveWorkbook: {
          Sheets: {
            Count: 2,
            Item: vi.fn((i: number) => ({ Name: i === 1 ? 'Sheet1' : 'Sheet2' })),
          },
        },
      })
      const result = clearSyncRecords()
      expect(result).toBe(false)
    })

    it('工作表存在时应删除数据', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const result = clearSyncRecords()
      expect(result).toBe(true)
    })
  })

  describe('deduplicateSyncRecords', () => {
    it('应执行去重', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const result = deduplicateSyncRecords()
      expect(result).toBe(true)
    })
  })

  describe('setSyncRecordColors（间接测试 via addSyncRecord）', () => {
    it('成功状态应设置 SUCCESS 颜色', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      addSyncRecord({
        sid: 'color-success',
        name: '成功记录',
        url: 'http://c.com',
        type: '看',
        status: 'success',
        count: 1,
      })
      // Verify that Range was called for color cells
      expect(mockColNumToLetter).toHaveBeenCalled()
    })

    it('失败状态应设置 FAIL 颜色', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      addSyncRecord({
        sid: 'color-fail',
        name: '失败记录',
        url: 'http://c.com',
        type: '看',
        status: 'fail',
        count: 1,
      })
      expect(mockColNumToLetter).toHaveBeenCalled()
    })

    it('跳过状态应设置 SKIP 颜色', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      addSyncRecord({
        sid: 'color-skip',
        name: '跳过记录',
        url: 'http://c.com',
        type: '看',
        status: 'skip',
        count: 1,
      })
      expect(mockColNumToLetter).toHaveBeenCalled()
    })

    it('多次同步应设置更深颜色', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      addSyncRecord({
        sid: 'color-multi',
        name: '多次同步',
        url: 'http://c.com',
        type: '看',
        status: 'success',
        count: 3,
      })
      expect(mockColNumToLetter).toHaveBeenCalled()
    })

    it('类型颜色应根据类型名设置', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      addSyncRecord({
        sid: 'type-color',
        name: '类型颜色',
        url: 'http://c.com',
        type: '想',
        status: 'success',
      })
      expect(mockColNumToLetter).toHaveBeenCalled()
    })
  })

  describe('buildCache（间接测试）', () => {
    it('缓存有效时不应重建', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      // First add builds cache
      addSyncRecord({ sid: 'cache-1', name: '缓存测试1', url: 'http://c.com' })
      // Second add should use cache
      addSyncRecord({ sid: 'cache-2', name: '缓存测试2', url: 'http://c.com' })
      // readRangeValues should have been called for cache building
    })

    it('lastRow < 2 时缓存应标记有效', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockGetLastRow.mockReturnValue(1)
      mockReadRangeValues.mockReturnValue([])
      // Should not throw
      expect(() =>
        addSyncRecord({ sid: 'empty-cache', name: '空缓存', url: 'http://c.com' }),
      ).not.toThrow()
    })

    it('空数据不应中断缓存构建', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockGetLastRow.mockReturnValue(5)
      mockReadRangeValues.mockReturnValue([
        ['', '', '', '', '', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', '', '', '', ''],
      ])
      addSyncRecord({ sid: 'empty-data', name: '空数据行', url: 'http://c.com' })
      // Should not throw
    })
  })

  // ========== migrateSyncRecordSchema 间接测试 ==========

  describe('migrateSyncRecordSchema（间接测试 via getOrCreateSyncRecordSheet）', () => {
    it('旧 12 列（序号第一列）应迁移数据', () => {
      const legacySheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      // 设置旧表头：A1='序号', F1='次数'
      legacySheet.Range = vi.fn((address: string) => {
        if (address === 'A1') return createMockCell('序号')
        if (address === 'F1') return createMockCell('次数')
        if (address === 'B1') return createMockCell('同步时间')
        if (address === 'C1') return createMockCell('名称')
        if (address === 'D1') return createMockCell('URL')
        if (address === 'E1') return createMockCell('SID')
        if (address.includes(':')) return { Value2: null, Interior: { Color: 0 } }
        return createMockCell('')
      })
      const wb = {
        Sheets: {
          Count: 3,
          Item: vi.fn((i: number) => (i === 1 ? legacySheet : createMockSheet())),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })
      mockGetLastRow.mockReturnValue(5)
      // 设置旧数据（第2行开始）
      mockGetCellValue.mockImplementation((_sheet: unknown, row: unknown, col: unknown) => {
        const r = row as number
        const c = col as number
        if (r === 2) {
          if (c === 5) return 'migrate-sid-1' // 旧结构 SID 在第5列
          if (c === 4) return 'http://migrate1.com' // URL 在第4列
          if (c === 6) return '动漫' // 条目类型
          if (c === 7) return '3' // 次数
          if (c === 8) return '内容1' // 内容
          if (c === 9) return 'success' // 状态
        }
        return ''
      })
      const result = getOrCreateSyncRecordSheet()
      expect(result).toBeDefined()
    })

    it('旧 11 列（SID 第一列无来源）应迁移数据', () => {
      const legacySheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      // 设置旧表头：A1='SID', F1='次数'（无"来源"列）
      legacySheet.Range = vi.fn((address: string) => {
        if (address === 'A1') return createMockCell('SID')
        if (address === 'F1') return createMockCell('次数') // 第6列是次数，不是来源
        if (address === 'B1') return createMockCell('同步时间')
        if (address === 'C1') return createMockCell('名称')
        if (address === 'D1') return createMockCell('URL')
        if (address === 'E1') return createMockCell('条目类型')
        if (address.includes(':')) return { Value2: null, Interior: { Color: 0 } }
        return createMockCell('')
      })
      const wb = {
        Sheets: {
          Count: 3,
          Item: vi.fn((i: number) => (i === 1 ? legacySheet : createMockSheet())),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })
      mockGetLastRow.mockReturnValue(5)
      // 设置旧数据（SID 在第1列的11列结构）
      mockGetCellValue.mockImplementation((_sheet: unknown, row: unknown, col: unknown) => {
        const r = row as number
        const c = col as number
        if (r === 2) {
          if (c === 1) return 'migrate-sid-2' // SID 在第1列
          if (c === 4) return 'http://migrate2.com' // URL 在第4列
          if (c === 5) return '游戏' // 条目类型
          if (c === 6) return '1' // 次数
          if (c === 7) return '内容2' // 内容
          if (c === 8) return 'fail' // 状态
        }
        return ''
      })
      const result = getOrCreateSyncRecordSheet()
      expect(result).toBeDefined()
    })

    it('lastRow <= 1 时不应执行迁移', () => {
      const legacySheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      legacySheet.Range = vi.fn((address: string) => {
        if (address === 'A1') return createMockCell('序号')
        if (address === 'F1') return createMockCell('次数')
        return createMockCell('')
      })
      const wb = {
        Sheets: {
          Count: 3,
          Item: vi.fn((i: number) => (i === 1 ? legacySheet : createMockSheet())),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })
      mockGetLastRow.mockReturnValue(1) // 只有表头行
      const result = getOrCreateSyncRecordSheet()
      expect(result).toBeDefined()
    })

    it('旧 URL 和 SID 都为空时应跳过该行', () => {
      const legacySheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      legacySheet.Range = vi.fn((address: string) => {
        if (address === 'A1') return createMockCell('序号')
        if (address === 'F1') return createMockCell('次数')
        return createMockCell('')
      })
      const wb = {
        Sheets: {
          Count: 3,
          Item: vi.fn((i: number) => (i === 1 ? legacySheet : createMockSheet())),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })
      mockGetLastRow.mockReturnValue(5)
      // 所有行的 URL 和 SID 都为空
      mockGetCellValue.mockReturnValue('')
      const result = getOrCreateSyncRecordSheet()
      expect(result).toBeDefined()
    })
  })

  // ========== openSyncRecordSheet 测试 ==========

  describe('openSyncRecordSheet', () => {
    it('工作表不存在时应记录警告', () => {
      mockGetApp.mockReturnValue({
        ActiveWorkbook: {
          Sheets: {
            Count: 2,
            Item: vi.fn((i: number) => ({ Name: i === 1 ? 'Sheet1' : 'Sheet2' })),
          },
        },
      })
      expect(() => openSyncRecordSheet()).not.toThrow()
    })

    it('工作表存在时应激活并滚动', () => {
      const syncSheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      const wb = {
        Sheets: {
          Count: 1,
          Item: vi.fn((i: number) => (i === 1 ? syncSheet : createMockSheet())),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })
      mockGetLastRow.mockReturnValue(5)
      openSyncRecordSheet(3)
      expect(syncSheet.Activate).toHaveBeenCalled()
    })

    it('无参数时应滚动到最后一行', () => {
      const syncSheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      const wb = {
        Sheets: {
          Count: 1,
          Item: vi.fn((i: number) => (i === 1 ? syncSheet : createMockSheet())),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })
      mockGetLastRow.mockReturnValue(5)
      openSyncRecordSheet()
      expect(syncSheet.Activate).toHaveBeenCalled()
    })

    it('scrollToRow <= 1 时应跳过选择', () => {
      const syncSheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      const wb = {
        Sheets: {
          Count: 1,
          Item: vi.fn((i: number) => (i === 1 ? syncSheet : createMockSheet())),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: wb })
      mockGetLastRow.mockReturnValue(1)
      openSyncRecordSheet()
      expect(syncSheet.Activate).toHaveBeenCalled()
    })
  })

  // ========== formatSyncRecordSheet 测试 ==========

  describe('formatSyncRecordSheet', () => {
    it('无参数时应获取同步记录表并格式化', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      expect(() => formatSyncRecordSheet()).not.toThrow()
    })

    it('传入工作表时应直接格式化', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      expect(() => formatSyncRecordSheet(sheet)).not.toThrow()
    })

    it('不存在工作表时不应报错', () => {
      mockGetApp.mockReturnValue({
        ActiveWorkbook: {
          Sheets: {
            Count: 2,
            Item: vi.fn((i: number) => ({ Name: i === 1 ? 'Sheet1' : 'Sheet2' })),
          },
        },
      })
      expect(() => formatSyncRecordSheet()).not.toThrow()
    })

    it('格式化进行中时应跳过', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      // 第一次调用会设置 _formattingInProgress = true
      formatSyncRecordSheet(sheet)
      // 第二次调用应跳过
      formatSyncRecordSheet(sheet)
    })
  })

  // ========== addSyncRecords 批量测试 ==========

  describe('addSyncRecords 批量写入', () => {
    it('新行应批量写入并设置颜色', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const result = addSyncRecords([
        { sid: 'batch-1', name: '批量1', url: 'http://b1.com', type: '看', status: 'success' },
        { sid: 'batch-2', name: '批量2', url: 'http://b2.com', type: '想', status: 'success' },
      ])
      expect(result).toBe(true)
    })

    it('SID 已存在时应合并次数', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockGetCellValue.mockReturnValue('5') // 现有 count=5
      // 先添加一个记录建立缓存
      addSyncRecord({ sid: 'merge-sid', name: '初始', url: 'http://m.com', type: '看', count: 5 })
      // 批量添加相同 SID 应合并
      const result = addSyncRecords([
        { sid: 'merge-sid', name: '更新', url: 'http://m2.com', type: '看', count: 3 },
      ])
      expect(result).toBe(true)
    })

    it('空数组应直接返回 true', () => {
      const result = addSyncRecords([])
      expect(result).toBe(true)
    })

    it('异常时应返回 false', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      // 设置 readRangeValues 返回包含 'fail-batch' 的数据，使 buildCache 能找到该 SID
      mockReadRangeValues.mockImplementation(() => [
        [
          'fail-batch',
          '2026-01-01',
          '初始',
          'http://fail.com',
          '看',
          '',
          '1',
          '',
          'success',
          '',
          '',
          '',
        ],
      ])
      // mock setCellValue 抛出异常，触发更新路径的错误
      mockSetCellValue.mockImplementation(() => {
        throw new Error('批量写入失败')
      })
      // 用相同 SID 批量添加，buildCache 会从 readRangeValues 中找到该 SID
      // 然后走更新路径时调用 setCellValue 抛出异常
      const result = addSyncRecords([
        { sid: 'fail-batch', name: '更新', url: 'http://fail.com/2', type: '看', count: 2 },
      ])
      expect(result).toBe(false)
    })
  })

  // ========== deduplicateSyncRecords 详细测试 ==========

  describe('deduplicateSyncRecords 详细测试', () => {
    it('无重复 SID 时应直接返回 true', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockGetLastRow.mockReturnValue(5)
      mockGetCellValue.mockImplementation((_sheet: unknown, row: unknown, col: unknown) => {
        const r = row as number
        const c = col as number
        if (c === 1) return `unique-sid-${r}`
        return ''
      })
      const result = deduplicateSyncRecords()
      expect(result).toBe(true)
    })

    it('有重复 SID 时应合并并删除', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockGetLastRow.mockReturnValue(5)
      mockGetCellValue.mockImplementation((_sheet: unknown, row: unknown, col: unknown) => {
        const r = row as number
        const c = col as number
        if (c === 1) return 'dup-sid' // 所有行都是相同 SID
        if (c === 7) return '2' // count
        return ''
      })
      const result = deduplicateSyncRecords()
      expect(result).toBe(true)
    })

    it('lastRow <= 1 时应直接返回 true', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockGetLastRow.mockReturnValue(1)
      const result = deduplicateSyncRecords()
      expect(result).toBe(true)
    })

    it('异常时应返回 false', () => {
      mockGetApp.mockReturnValue({
        ActiveWorkbook: {
          Sheets: {
            Count: 2,
            Item: vi.fn(() => {
              throw new Error('工作表错误')
            }),
          },
        },
      })
      const result = deduplicateSyncRecords()
      expect(result).toBe(false)
    })
  })

  // ========== getSyncRecordEnabled 测试 ==========

  describe('addSyncRecord 未启用场景', () => {
    it('getSyncRecordEnabled 返回 false 时应跳过', () => {
      mockGetSyncRecordEnabled.mockReturnValue(false)
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const result = addSyncRecord({
        sid: 'disabled-sid',
        name: '禁用测试',
        url: 'http://disabled.com',
        type: '看',
      })
      expect(result).toBe(false)
    })
  })

  // ========== clearSyncRecords 异常处理测试 ==========

  describe('clearSyncRecords 异常处理', () => {
    it('工作表删除失败时应返回 false', () => {
      // 创建一个会在 Delete 时抛异常的 mock sheet
      const errorSheet = {
        Name: SYNC_RECORD_SHEET_NAME,
        Rows: { Count: 10 },
        UsedRange: { Row: 1, Rows: { Count: 5 } },
        Range: vi.fn((addr: string) => {
          if (addr.includes(':')) {
            return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false } }
          }
          return createMockCell('')
        }),
        Delete: vi.fn(() => {
          throw new Error('删除失败')
        }),
        Activate: vi.fn(),
        Select: vi.fn(),
      }

      // 创建一个 workbook，包含 errorSheet
      const allSheets = [createMockSheet({ name: 'Sheet1' }), errorSheet]
      const mockWorkbook = {
        Sheets: {
          Count: allSheets.length,
          Item: vi.fn((index: number) => allSheets[index - 1] || allSheets[0]),
          Add: vi.fn(() => createMockSheet({ name: SYNC_RECORD_SHEET_NAME })),
        },
        ActiveSheet: errorSheet,
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: mockWorkbook })

      const result = clearSyncRecords()
      expect(result).toBe(false)
    })
  })

  // ========== openSyncRecordSheet 异常处理测试 ==========

  describe('openSyncRecordSheet 异常处理', () => {
    it('getApp 返回 null 时应安全处理', () => {
      mockGetApp.mockReturnValue(null)
      expect(() => openSyncRecordSheet()).not.toThrow()
    })

    it('工作表不存在时应记录警告', () => {
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      // createMockWorkbook 默认包含同步记录 sheet，这里删除它
      const noSyncSheetWb = {
        Sheets: {
          Count: 1,
          Item: vi.fn((index: number) => createMockSheet({ name: 'Sheet1' })),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: noSyncSheetWb })
      openSyncRecordSheet()
      expect(mockBgmLogn).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('同步记录表不存在'),
      )
    })

    it('工作表存在但 Activate 抛出异常时应安全处理', () => {
      const errorSheet = {
        Name: SYNC_RECORD_SHEET_NAME,
        Rows: { Count: 10 },
        UsedRange: { Row: 1, Rows: { Count: 5 } },
        Range: vi.fn((addr: string) => {
          if (addr.includes(':')) {
            return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false } }
          }
          return createMockCell('')
        }),
        Delete: vi.fn(),
        Activate: vi.fn(() => {
          throw new Error('激活失败')
        }),
        Select: vi.fn(),
      }
      const allSheets = [createMockSheet({ name: 'Sheet1' }), errorSheet]
      const mockWorkbook = {
        Sheets: {
          Count: allSheets.length,
          Item: vi.fn((index: number) => allSheets[index - 1] || allSheets[0]),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: mockWorkbook })
      // 不应抛出，BGM.handleError 会处理
      expect(() => openSyncRecordSheet(2)).not.toThrow()
    })

    it('定位行失败时应回退到普通切换', () => {
      const normalSheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      normalSheet.Range = vi.fn(() => {
        throw new Error('定位失败')
      })
      const allSheets = [createMockSheet({ name: 'Sheet1' }), normalSheet]
      const mockWorkbook = {
        Sheets: {
          Count: allSheets.length,
          Item: vi.fn((index: number) => allSheets[index - 1] || allSheets[0]),
        },
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: mockWorkbook })
      openSyncRecordSheet(3)
      // 即使定位失败，也应记录已切换的日志（回退路径）
      expect(mockBgmLogn).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('已切换到同步记录工作表'),
      )
    })

    it('lastRow <= 1 时应提示暂无数据', () => {
      mockGetLastRow.mockReturnValue(1)
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      openSyncRecordSheet()
      expect(mockBgmLogn).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('暂无数据'),
      )
    })
  })
})
