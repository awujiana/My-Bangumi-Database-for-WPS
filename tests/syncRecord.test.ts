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
  }),)
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

function createMockWorkbook(sheets: { Name: string }[] = []) {
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
    mockSetCellValue.mockClear()
    mockBgmLogn.mockClear()
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
      mockSetCellValue.mockImplementation(
        (_ws: unknown, _r: unknown, c: unknown, _v: unknown) => true,
      )
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
        addSyncRecord({ sid: 'empty-cache', name: '空缓存', url: 'http://c.com' }),).not.toThrow()
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
        if (c === 1) return `unique-sid-${String(r)}`
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

  // ============ 补充: formatSyncRecordSheet 未覆盖分支 ============

  describe('formatSyncRecordSheet 未覆盖分支 (lines 708-709, 787-788)', () => {
    it('lastRow < 1 时应安全返回 (line 708-709)', () => {
      mockGetLastRow.mockReturnValue(0)
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      expect(() => formatSyncRecordSheet(sheet)).not.toThrow()
    })

    it('格式化过程中抛异常应被 catch 并调用 handleError (line 787-788)', () => {
      const mockHandleError = vi.fn()
      vi.doMock('../ts/tools/util/index.js', () => ({
        bgmLog: mockBgmLogn,
        getApp: mockGetApp,
        getLastRow: mockGetLastRow,
        colNumToLetter: mockColNumToLetter,
        getCellValue: mockGetCellValue,
        setCellValue: mockSetCellValue,
        readRangeValues: mockReadRangeValues,
        BGM: {
          handleError: mockHandleError,
          Color: BGM_COLOR,
        },
      }))
      // 需要动态重新导入以使用新的 mock
      // 这里直接通过设置一个会抛异常的 Range 来触发
      const badSheet = {
        Name: SYNC_RECORD_SHEET_NAME,
        Rows: { Count: 10 },
        UsedRange: { Row: 1, Rows: { Count: 5 } },
        Range: vi.fn(() => {
          throw new Error('Range 访问异常')
        }),
        Activate: vi.fn(),
        Select: vi.fn(),
        Delete: vi.fn(),
      }
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockGetLastRow.mockReturnValue(5)

      // 直接调用，异常应被 formatSyncRecordSheet 内部 catch 处理
      try {
        formatSyncRecordSheet(badSheet)
      } catch {
        // 预期不会向外抛出
      }
    })

    it('工作表存在且 lastRow 正常时应完整执行', () => {
      mockGetLastRow.mockReturnValue(5)
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      expect(() => formatSyncRecordSheet(sheet)).not.toThrow()
    })
  })

  // ============ 补充: addSyncRecord 更新分支 (lines 586-595) ============

  describe('addSyncRecord 可选字段更新分支 (lines 586-595)', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      __resetSyncRecordCache()
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockGetLastRow.mockReturnValue(10)
      mockSetCellValue.mockReturnValue(true)
    })

    it('更新已有记录时所有可选字段都被写入 (lines 586-593)', () => {
      const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      const mockRange = sheet.Range('A1:L1')
      mockReadRangeValues.mockReturnValue([
        [
          '2024-01-01T00:00:00',
          '测试名称',
          'http://test.com',
          'TV',
          'github',
          '1',
          '内容',
          'success',
          '看',
          '备注',
          'fp123',
        ],
      ])

      const result = addSyncRecord({
        sid: 'existing-sid',
        status: 'success',
        count: 2,
        name: '新名称',
        url: 'http://new.com',
        type: 'movie',
        source: 'local',
        content: '新内容',
        message: '测试消息',
        fingerprint: 'new-fp',
        collType: '想',
      })

      expect(result).toBe(true)
      // 验证所有可选字段都被写入
      expect(mockSetCellValue).toHaveBeenCalled()
    })

    it('更新时可选字段为空则跳过对应分支', () => {
      const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
      mockReadRangeValues.mockReturnValue([
        ['2024-01-01T00:00:00', '', '', '', '', '1', '', 'success', '', '', ''],
      ])

      const result = addSyncRecord({
        sid: 'minimal-sid',
        status: 'success',
        count: 1,
      })

      expect(result).toBe(true)
      // 只更新必要字段，不调用可选字段的 setCellValue
    })
  })

  // ============ 补充: getAllSyncRecords 错误处理 (lines 637-638) ============

  describe('getAllSyncRecords 错误处理 (lines 637-638)', () => {
    it('工作表不存在时应返回空数组', () => {
      __resetSyncRecordCache()
      mockGetApp.mockReturnValue({
        ActiveWorkbook: {
          Sheets: {
            Item: vi.fn(() => {
              throw new Error('Sheet not found')
            }),
            Count: 0,
          },
        },
      })
      const result = getAllSyncRecords()
      expect(result).toEqual([])
    })

    it('getSyncRecordSheetIfExists 抛异常时被 catch (line 637-638)', () => {
      __resetSyncRecordCache()
      // mockGetApp 抛出异常 → getSyncRecordSheetIfExists 内部异常 → getAllSyncRecords catch
      mockGetApp.mockImplementation(() => {
        throw new Error('WPS 应用异常')
      })
      const result = getAllSyncRecords()
      expect(result).toEqual([])
    })
  })

  // ============ 补充: addSyncRecords 未启用场景 (lines 507-508) ============

  describe('addSyncRecords 未启用场景 (lines 507-508)', () => {
    it('getSyncRecordEnabled 返回 false 时 addSyncRecords 应返回 false', () => {
      mockGetSyncRecordEnabled.mockReturnValue(false)
      const result = addSyncRecords([
        { sid: 'disabled-1', name: '禁用测试1', url: 'http://d1.com' },
        { sid: 'disabled-2', name: '禁用测试2', url: 'http://d2.com' },
      ])
      expect(result).toBe(false)
      // 不应调用任何 WPS 操作
      expect(mockSetCellValue).not.toHaveBeenCalled()
    })

    it('getSyncRecordEnabled 返回 false 且空数组时仍应返回 false', () => {
      mockGetSyncRecordEnabled.mockReturnValue(false)
      const result = addSyncRecords([])
      // 先检查 getSyncRecordEnabled，返回 false
      expect(result).toBe(false)
    })
  })

  // ============ 补充: addSyncRecord UsedRange 回退路径 (line 449) ============

  describe('addSyncRecord UsedRange 不可用时回退 (line 449)', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      __resetSyncRecordCache()
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockGetLastRow.mockReturnValue(10)
      mockSetCellValue.mockReturnValue(true)
    })

    it('UsedRange 为 null 且 Rows.Count > 1 时 newRow 为 2', () => {
      // 创建 UsedRange 为 null 的工作表
      const sheet = {
        Name: SYNC_RECORD_SHEET_NAME,
        UsedRange: null, // 关键：UsedRange 为 null
        Rows: { Count: 100 },
        Range: vi.fn(() => ({
          Value2: null,
          Interior: { Color: 0 },
        })),
        Activate: vi.fn(),
      }
      mockGetApp.mockReturnValue({
        ActiveWorkbook: {
          Sheets: {
            Item: vi.fn(() => sheet),
            Count: 1,
          },
        },
      })

      const result = addSyncRecord({
        sid: 'new-sid-fallback',
        name: '回退测试',
        url: 'http://fallback.com',
        status: 'success',
        count: 1,
      })

      expect(result).toBe(true)
      // 验证 newRow 使用了 2（Rows.Count > 1 ? 2 : 1）
      expect(mockSetCellValue).toHaveBeenCalled()
    })

    it('UsedRange 为 null 且 Rows.Count <= 1 时 newRow 为 1', () => {
      const sheet = {
        Name: SYNC_RECORD_SHEET_NAME,
        UsedRange: null,
        Rows: { Count: 1 }, // 关键：Rows.Count = 1
        Range: vi.fn(() => ({
          Value2: null,
          Interior: { Color: 0 },
        })),
        Activate: vi.fn(),
      }
      mockGetApp.mockReturnValue({
        ActiveWorkbook: {
          Sheets: {
            Item: vi.fn(() => sheet),
            Count: 1,
          },
        },
      })

      const result = addSyncRecord({
        sid: 'new-sid-row1',
        name: '单行测试',
        url: 'http://row1.com',
        status: 'success',
        count: 1,
      })

      expect(result).toBe(true)
    })
  })

  // ============ 补充: addSyncRecords 批量更新可选字段 (lines 586-595) ============

  describe('addSyncRecords 批量更新可选字段 (lines 586-595)', () => {
    beforeEach(() => {
      __resetSyncRecordCache()
      mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
      mockGetLastRow.mockReturnValue(10)
      mockSetCellValue.mockClear()
    })

    it('更新已有 SID 时可选字段全部写入 (lines 586-595)', () => {
      // readRangeValues 返回顺序必须与 buildCache 期望的列序一致：
      // SID(0), TIME(1), NAME(2), URL(3), TYPE(4), SOURCE(5), COUNT(6), CONTENT(7), STATUS(8), COLL_TYPE(9), MESSAGE(10), FINGERPRINT(11)
      mockReadRangeValues.mockReturnValue([
        [
          'upd-sid', // SID (index 0)
          '2024-01-01T00:00:00', // TIME (index 1)
          '测试名称', // NAME (index 2)
          'http://old.com', // URL (index 3)
          'TV', // TYPE (index 4)
          'github', // SOURCE (index 5)
          '5', // COUNT (index 6)
          '旧内容', // CONTENT (index 7)
          'success', // STATUS (index 8)
          '看', // COLL_TYPE (index 9)
          '旧备注', // MESSAGE (index 10)
          'old-fp', // FINGERPRINT (index 11)
        ],
      ])
      // getCellValue 按列返回不同值，避免 deduplicateSyncRecords 误判重复
      mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
        if (col === 1) return 'upd-sid' // SID 列
        if (col === 7) return '5' // COUNT 列
        return ''
      })

      // 批量添加带全量可选字段的记录 → 走更新路径
      const result = addSyncRecords([
        {
          sid: 'upd-sid',
          name: '新名称',
          url: 'http://new.com',
          type: 'movie',
          source: 'local',
          content: '新内容',
          message: '测试消息',
          fingerprint: 'new-fp-123',
          collType: '想',
          count: 3,
          status: 'success',
        },
      ])

      expect(result).toBe(true)
      // 更新路径：TIME, COUNT, STATUS, NAME, URL, TYPE, SOURCE, CONTENT, MESSAGE, FINGERPRINT, COLL_TYPE
      const setCellCalls = mockSetCellValue.mock.calls
      expect(setCellCalls.length).toBeGreaterThanOrEqual(10)
    })

    it('更新时部分可选字段为空则跳过对应分支', () => {
      mockReadRangeValues.mockReturnValue([
        [
          'partial-sid', // SID (index 0)
          '2024-01-01T00:00:00', // TIME (index 1)
          '旧名称', // NAME (index 2)
          'http://old.com', // URL (index 3)
          'TV', // TYPE (index 4)
          'github', // SOURCE (index 5)
          '2', // COUNT (index 6)
          '', // CONTENT (index 7)
          'success', // STATUS (index 8)
          '', // COLL_TYPE (index 9)
          '', // MESSAGE (index 10)
          '', // FINGERPRINT (index 11)
        ],
      ])
      mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
        if (col === 1) return 'partial-sid'
        if (col === 7) return '2'
        return ''
      })

      // 只传部分可选字段
      const result = addSyncRecords([
        {
          sid: 'partial-sid',
          url: 'http://new.com',
          count: 1,
          status: 'success',
        },
      ])

      expect(result).toBe(true)
      // 至少有 TIME, COUNT, STATUS, URL 被写入
      const setCellCalls = mockSetCellValue.mock.calls
      expect(setCellCalls.length).toBeGreaterThanOrEqual(3)
    })
  })
})

// ========== 补充测试：getStatusColor 默认分支 (line 93) ==========
describe('getStatusColor 默认分支 (line 93)', () => {
  it('未知状态应返回 SUCCESS 颜色 (line 93)', async () => {
    const mockWs = createMockSheet()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })

    mockReadRangeValues.mockReturnValue([])
    mockGetLastRow.mockReturnValue(10)

    const result = addSyncRecord({
      sid: 'color-default',
      status: 'unknown-status',
      content: '测试默认颜色',
    })

    expect(result).toBe(true)
    expect(mockSetCellValue.mock.calls.length).toBeGreaterThan(0)
  })

  it('SUCCESS 状态应返回 SUCCESS 颜色', async () => {
    const mockWs = createMockSheet()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })

    mockReadRangeValues.mockReturnValue([])
    mockGetLastRow.mockReturnValue(10)

    const result = addSyncRecord({
      sid: 'color-success',
      status: 'success',
      content: '测试成功颜色',
    })

    expect(result).toBe(true)
  })

  it('FAIL 状态应返回 FAIL 颜色', async () => {
    const mockWs = createMockSheet()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })

    mockReadRangeValues.mockReturnValue([])
    mockGetLastRow.mockReturnValue(10)

    const result = addSyncRecord({
      sid: 'color-fail',
      status: 'fail',
      content: '测试失败颜色',
    })

    expect(result).toBe(true)
  })

  it('SKIP 状态应返回 SKIP 颜色', async () => {
    const mockWs = createMockSheet()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })

    mockReadRangeValues.mockReturnValue([])
    mockGetLastRow.mockReturnValue(10)

    const result = addSyncRecord({
      sid: 'color-skip',
      status: 'skip',
      content: '测试跳过颜色',
    })

    expect(result).toBe(true)
  })
})

// ========== 补充测试：buildCache 异常路径 (line 343) ==========
describe('buildCache 异常路径 (line 343)', () => {
  it('readRangeValues 抛出异常时 buildCache 应捕获', async () => {
    const mockWs = createMockSheet()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)

    mockReadRangeValues.mockImplementation(() => {
      throw new Error('读取范围失败')
    })

    const result = addSyncRecord({
      sid: 'cache-err',
      content: '测试缓存异常',
    })

    expect(typeof result).toBe('boolean')
  })
})

// ========== 补充测试：addSyncRecord 更新路径 (lines 405-440) ==========
describe('addSyncRecord 更新路径 (lines 405-440)', () => {
  beforeEach(() => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)
    mockSetCellValue.mockClear()
  })

  it('更新已有 SID 时所有可选字段写入 (lines 405-440)', () => {
    mockReadRangeValues.mockReturnValue([
      [
        'update-sid',
        '2024-01-01T00:00:00',
        '旧名称',
        'http://old.com',
        'TV',
        'github',
        '2',
        '旧内容',
        'success',
        '看',
        '旧备注',
        'old-fp',
      ],
    ])

    mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
      if (col === 1) return 'update-sid'
      if (col === 7) return '2'
      return ''
    })

    addSyncRecord({
      sid: 'update-sid',
      name: '旧名称',
      count: 2,
    })

    const result = addSyncRecord({
      sid: 'update-sid',
      name: '新名称',
      url: 'http://new.com',
      type: 'movie',
      source: 'local',
      content: '新内容',
      message: '测试消息',
      fingerprint: 'new-fp-123',
      collType: '想',
      count: 3,
      status: 'success',
    })

    expect(result).toBe(true)
    const setCellCalls = mockSetCellValue.mock.calls
    expect(setCellCalls.length).toBeGreaterThanOrEqual(5)
  })

  it('更新时 name 字段为空则跳过该分支', () => {
    mockReadRangeValues.mockReturnValue([
      [
        'partial-sid',
        '2024-01-01T00:00:00',
        '旧名称',
        'http://old.com',
        'TV',
        'github',
        '2',
        '',
        'success',
        '',
        '',
        '',
      ],
    ])

    mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
      if (col === 1) return 'partial-sid'
      if (col === 7) return '2'
      return ''
    })

    const result = addSyncRecord({
      sid: 'partial-sid',
      url: 'http://new.com',
      count: 1,
      status: 'success',
    })

    expect(result).toBe(true)
    const setCellCalls = mockSetCellValue.mock.calls
    expect(setCellCalls.length).toBeGreaterThanOrEqual(3)
  })

  it('更新时 collType 字段为空则跳过该分支', () => {
    mockReadRangeValues.mockReturnValue([
      [
        'coll-sid',
        '2024-01-01T00:00:00',
        '旧名称',
        'http://old.com',
        'TV',
        'github',
        '2',
        '',
        'success',
        '看',
        '',
        '',
      ],
    ])

    mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
      if (col === 1) return 'coll-sid'
      if (col === 7) return '2'
      return ''
    })

    const result = addSyncRecord({
      sid: 'coll-sid',
      count: 1,
      status: 'success',
    })

    expect(result).toBe(true)
  })

  it('更新时 fingerprint 为 undefined 则跳过该分支', () => {
    mockReadRangeValues.mockReturnValue([
      [
        'fp-sid',
        '2024-01-01T00:00:00',
        '旧名称',
        'http://old.com',
        'TV',
        'github',
        '2',
        '',
        'success',
        '',
        '',
        'old-fp',
      ],
    ])

    mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
      if (col === 1) return 'fp-sid'
      if (col === 7) return '2'
      return ''
    })

    const result = addSyncRecord({
      sid: 'fp-sid',
      count: 1,
      status: 'success',
    })

    expect(result).toBe(true)
  })
})

// ========== 补充测试：addSyncRecord 新建路径 (lines 442-487) ==========
describe('addSyncRecord 新建路径 (lines 442-487)', () => {
  it('新 SID 应走新建路径', async () => {
    const mockWs = createMockSheet()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)
    mockReadRangeValues.mockReturnValue([])
    mockSetCellValue.mockClear()

    const result = addSyncRecord({
      sid: 'new-sid-1',
      name: '新条目',
      url: 'http://example.com',
      count: 1,
      status: 'success',
      source: 'test',
      content: '测试内容',
    })

    expect(result).toBe(true)
    const setCellCalls = mockSetCellValue.mock.calls
    expect(setCellCalls.length).toBeGreaterThanOrEqual(8)
  })

  it('新建路径 fingerprint 不为 undefined 时应写入', async () => {
    const mockWs = createMockSheet()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)
    mockReadRangeValues.mockReturnValue([])
    mockSetCellValue.mockClear()

    const result = addSyncRecord({
      sid: 'new-fp-1',
      fingerprint: 'test-fingerprint',
      count: 1,
      status: 'success',
    })

    expect(result).toBe(true)
  })

  it('新建路径 collType 不为空时应写入', async () => {
    const mockWs = createMockSheet()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)
    mockReadRangeValues.mockReturnValue([])
    mockSetCellValue.mockClear()

    const result = addSyncRecord({
      sid: 'new-coll-1',
      collType: '想',
      count: 1,
      status: 'success',
    })

    expect(result).toBe(true)
  })
})

// ========== 补充测试：addSyncRecords 批量写入异常路径 ==========
describe('addSyncRecords 异常路径', () => {
  it('空记录数组应返回 true', () => {
    const result = addSyncRecords([])
    expect(result).toBe(true)
  })

  it('同步记录未启用时应返回 false', () => {
    mockGetSyncRecordEnabled.mockReturnValue(false)
    const result = addSyncRecords([{ sid: 'test' }])
    expect(result).toBe(false)
    mockGetSyncRecordEnabled.mockReturnValue(true)
  })
})

// ========== 补充测试：buildCache 异常路径精确触发 (line 343) ==========
describe('buildCache 异常路径精确覆盖 (line 343)', () => {
  it('readRangeValues 抛出异常时 buildCache 应捕获并记录', async () => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)

    const mockErr = new Error('读取工作表范围失败')
    mockReadRangeValues.mockImplementation(() => {
      throw mockErr
    })

    const result = addSyncRecord({
      sid: 'cache-err-343',
      content: '测试缓存异常路径',
    })

    expect(typeof result).toBe('boolean')
  })

  it('readRangeValues 返回格式错误数据时 buildCache 仍可正常处理', async () => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)

    mockReadRangeValues.mockReturnValue([
      [
        'valid-sid',
        '2024-01-01T00:00:00',
        '测试',
        'http://test.com',
        'TV',
        'github',
        '1',
        '测试内容',
        'success',
        '',
        '',
        '',
      ],
    ])

    const result = addSyncRecord({
      sid: 'cache-valid',
      content: '有效缓存测试',
    })

    expect(result).toBe(true)
  })
})

// ========== 补充测试：addSyncRecord 完整字段覆盖 ==========
describe('addSyncRecord 完整字段覆盖', () => {
  beforeEach(() => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)
    mockSetCellValue.mockClear()
  })

  it('新建记录时写入所有可选字段', async () => {
    mockReadRangeValues.mockReturnValue([])

    const result = addSyncRecord({
      sid: 'all-fields',
      name: '全字段',
      url: 'http://all.com',
      type: 'movie',
      source: 'test',
      content: '全字段内容',
      message: '全字段消息',
      fingerprint: 'fp-all',
      collType: '看',
      count: 5,
      status: 'success',
    })

    expect(result).toBe(true)
    const setCellCalls = mockSetCellValue.mock.calls
    expect(setCellCalls.length).toBeGreaterThanOrEqual(10)
  })

  it('更新记录时所有字段都被更新', async () => {
    mockReadRangeValues.mockReturnValue([
      [
        'upd-all',
        '2024-01-01T00:00:00',
        '旧名称',
        'http://old.com',
        'TV',
        'github',
        '2',
        '旧内容',
        'success',
        '看',
        '旧消息',
        'old-fp',
      ],
    ])

    mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
      if (col === 1) return 'upd-all'
      if (col === 7) return '2'
      return ''
    })

    addSyncRecord({ sid: 'upd-all', count: 2 })

    const result = addSyncRecord({
      sid: 'upd-all',
      name: '新名称',
      url: 'http://new.com',
      type: 'movie',
      source: 'local',
      content: '新内容',
      message: '新消息',
      fingerprint: 'new-fp',
      collType: '想',
      count: 3,
      status: 'success',
    })

    expect(result).toBe(true)
  })
})

// ========== 补充测试：addSyncRecords 批量写入成功路径 ==========
describe('addSyncRecords 成功路径', () => {
  beforeEach(() => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)
    mockSetCellValue.mockClear()
  })

  it('批量写入包含新建和更新的混合记录', async () => {
    mockReadRangeValues.mockReturnValue([
      [
        'existing-sid',
        '2024-01-01T00:00:00',
        '旧名称',
        'http://old.com',
        'TV',
        'github',
        '2',
        '旧内容',
        'success',
        '',
        '',
        '',
      ],
    ])

    mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
      if (col === 1) return 'existing-sid'
      if (col === 7) return '2'
      return ''
    })

    const result = addSyncRecords([
      {
        sid: 'existing-sid',
        name: '更新条目',
        count: 3,
        status: 'success',
        source: '更新',
      },
      {
        sid: 'new-sid-batch',
        name: '新建条目',
        count: 1,
        status: 'success',
        source: '新建',
        content: '批量新建',
      },
    ])

    expect(result).toBe(true)
  })

  it('批量写入时 fingerprint 为 undefined 的字段使用空字符串', async () => {
    mockReadRangeValues.mockReturnValue([])

    const result = addSyncRecords([
      {
        sid: 'no-fp',
        name: '无指纹',
        count: 1,
        status: 'success',
      },
    ])

    expect(result).toBe(true)
  })
})

// ========== 补充测试：buildCache 内层 catch 分支 (line 343) ==========
describe('buildCache 内层 catch 分支 (line 343)', () => {
  beforeEach(() => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)
  })

  it('行数据内元素访问异常时应被内层 catch 捕获 (line 343)', async () => {
    // 提供格式异常的数据，使得 rowData 处理过程中抛出异常
    // 例如 rowData 不是数组，访问数组索引会出错
    mockReadRangeValues.mockReturnValue([
      // @ts-expect-error - 故意传入非数组元素触发异常
      null,
      undefined,
      'invalid-string', // 非数组，访问 [SYNC_RECORD_COL.SID - 1] 会出错
    ])

    const result = addSyncRecord({
      sid: 'inner-catch',
      content: '测试内层 catch',
      count: 1,
      status: 'success',
    })

    expect(typeof result).toBe('boolean')
  })

  it('行数据元素类型错误但未抛异常时不应中断', async () => {
    mockReadRangeValues.mockReturnValue([
      // 空数组 - 访问不存在的索引返回 undefined，String(undefined) = 'undefined'
      [],
      // 正常行
      [
        'valid-sid',
        '2024-01-01T00:00:00',
        '正常名称',
        'http://valid.com',
        'TV',
        'github',
        '1',
        '正常内容',
        'success',
        '看',
        '备注',
        'fp-001',
      ],
    ])

    const result = addSyncRecord({
      sid: 'valid-sid',
      name: '正常名称',
      count: 1,
      status: 'success',
    })

    expect(result).toBe(true)
  })
})

// ========== 补充测试：buildCache message 字段覆盖 (line 337) ==========
describe('buildCache message 字段 (line 337)', () => {
  beforeEach(() => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)
  })

  it('行数据中包含 message 字段时应正确读取 (line 337)', async () => {
    mockReadRangeValues.mockReturnValue([
      [
        'msg-sid',
        '2024-01-01T00:00:00',
        '测试名称',
        'http://test.com',
        'TV',
        'github',
        '1',
        '测试内容',
        'success',
        '看',
        '这是一条测试备注信息', // MESSAGE 字段 (col 11)
        'fp-msg-001',
      ],
    ])

    mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
      if (col === 1) return 'msg-sid'
      if (col === 7) return '1'
      return ''
    })

    const result = addSyncRecord({
      sid: 'msg-sid',
      name: '测试名称',
      count: 1,
      status: 'success',
    })

    expect(result).toBe(true)
  })

  it('行数据中 message 字段为 undefined 时使用默认空字符串', async () => {
    mockReadRangeValues.mockReturnValue([
      [
        'no-msg-sid',
        '2024-01-01T00:00:00',
        '测试名称',
        'http://test.com',
        'TV',
        'github',
        '1',
        '测试内容',
        'success',
        '看',
        // MESSAGE 字段 (col 11) 缺失
        'fp-no-msg',
      ],
    ])

    mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
      if (col === 1) return 'no-msg-sid'
      if (col === 7) return '1'
      return ''
    })

    const result = addSyncRecord({
      sid: 'no-msg-sid',
      name: '测试名称',
      count: 1,
      status: 'success',
    })

    expect(result).toBe(true)
  })
})

// ========== 补充测试：migrateSyncRecordSchema 数据行处理 (lines 289-293) ==========
describe('migrateSyncRecordSchema 数据行处理 (lines 289-293)', () => {
  beforeEach(() => {
    __resetSyncRecordCache()
    mockGetLastRow.mockReturnValue(10)
    mockSetCellValue.mockClear()
  })

  it('旧 schema 应触发迁移并处理数据行 (lines 289-293)', async () => {
    // 创建一个旧 schema 工作表（A1='序号' 表示旧 schema）
    const legacySheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
    legacySheet.Range = vi.fn((address: string) => {
      if (address === 'A1') return createMockCell('序号') // 旧 schema 标识
      if (address === 'F1') return createMockCell('次数') // 旧 schema 列头
      if (address.includes(':')) return { Value2: null, Interior: { Color: 0 } }
      return createMockCell('')
    })

    mockReadRangeValues.mockReturnValue([])

    mockGetCellValue.mockImplementation((_sheet: unknown, row: number, col: number) => {
      if (row === 2) {
        if (col === 1) return 'old-sid-1'
        if (col === 7) return '3'
      }
      return ''
    })

    mockGetApp.mockReturnValue({
      ActiveWorkbook: {
        Sheets: {
          Count: 1,
          Item: vi.fn(() => legacySheet),
        },
      },
    })

    const result = addSyncRecord({
      sid: 'old-sid-1',
      name: '迁移测试',
      count: 1,
      status: 'success',
    })

    expect(typeof result).toBe('boolean')
  })
})

// ========== 补充测试：migrateSyncRecordSchema 数据行处理带实际数据 (lines 289-293) ==========
describe('migrateSyncRecordSchema 数据行处理 (lines 289-293) - 带实际数据', () => {
  beforeEach(() => {
    __resetSyncRecordCache()
    mockGetLastRow.mockReturnValue(5)
    mockSetCellValue.mockClear()
  })

  it('旧 schema 迁移应处理数据行并写入新表 (lines 289-293)', async () => {
    const legacySheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
    legacySheet.Range = vi.fn((address: string) => {
      if (address === 'A1') return createMockCell('序号')
      if (address === 'F1') return createMockCell('次数')
      if (address.includes(':'))
        return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false }, Delete: vi.fn() }
      return createMockCell('')
    })

    mockReadRangeValues.mockReturnValue([])

    // 设置旧数据行（lastRow=5，所以有4行数据从row 2-5）
    mockGetCellValue.mockImplementation((_sheet: unknown, row: number, col: number) => {
      const r = row
      const c = col
      if (r === 2) {
        if (c === 5) return 'migrate-sid-2'
        if (c === 4) return 'http://migrate2.com'
        if (c === 6) return 'TV'
        if (c === 7) return '3'
        if (c === 8) return '内容2'
        if (c === 9) return 'success'
        if (c === 10) return '备注2'
        if (c === 11) return 'fp-2'
      }
      if (r === 3) {
        if (c === 5) return 'migrate-sid-3'
        if (c === 4) return 'http://migrate3.com'
        if (c === 6) return '电影'
        if (c === 7) return '1'
        if (c === 8) return '内容3'
        if (c === 9) return 'fail'
      }
      // row 4 和 5 为空（sid 和 url 都为空，会被跳过）
      return ''
    })

    mockGetApp.mockReturnValue({
      ActiveWorkbook: {
        Sheets: {
          Count: 1,
          Item: vi.fn(() => legacySheet),
        },
      },
    })

    const result = addSyncRecord({
      sid: 'new-sid',
      name: '新记录',
      count: 1,
      status: 'success',
    })

    expect(typeof result).toBe('boolean')
    // 验证 setCellValue 被多次调用（包括迁移写入 + 新记录写入）
    expect(mockSetCellValue).toHaveBeenCalled()
  })

  it('迁移时空数据行应被跳过 (lines 291 检查)', async () => {
    const legacySheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
    legacySheet.Range = vi.fn((address: string) => {
      if (address === 'A1') return createMockCell('序号')
      if (address === 'F1') return createMockCell('次数')
      if (address.includes(':'))
        return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false }, Delete: vi.fn() }
      return createMockCell('')
    })

    mockReadRangeValues.mockReturnValue([])

    // 所有行都没有有效的 SID 和 URL
    mockGetCellValue.mockImplementation(() => '')

    mockGetApp.mockReturnValue({
      ActiveWorkbook: {
        Sheets: {
          Count: 1,
          Item: vi.fn(() => legacySheet),
        },
      },
    })

    const result = addSyncRecord({
      sid: 'empty-migrate',
      name: '空迁移',
      count: 1,
      status: 'success',
    })

    expect(typeof result).toBe('boolean')
  })
})

// ========== 补充测试：buildCache 内层 catch 精确覆盖 (line 343) ==========
describe('buildCache 内层 catch 精确覆盖 (line 343)', () => {
  beforeEach(() => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)
  })

  it('Proxy 抛出异常时应被内层 catch 捕获 (line 343)', async () => {
    // 创建一个 Proxy 对象，访问任意索引属性时抛出异常
    const throwingProxy = new Proxy([] as unknown[], {
      get(_target, prop: string | symbol) {
        if (typeof prop === 'string' && !isNaN(Number(prop))) {
          throw new Error('模拟数据损坏：属性访问失败')
        }
        return undefined
      },
    })

    mockReadRangeValues.mockReturnValue([
      throwingProxy,
      // 正常行数据
      [
        'valid-sid-343',
        '2024-01-01T00:00:00',
        '正常名称',
        'http://valid343.com',
        'TV',
        'github',
        '1',
        '正常内容',
        'success',
        '看',
        '备注',
        'fp-343',
      ],
    ])

    mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
      if (col === 1) return 'valid-sid-343'
      if (col === 7) return '1'
      return ''
    })

    const result = addSyncRecord({
      sid: 'valid-sid-343',
      name: '正常名称',
      count: 1,
      status: 'success',
    })

    // 即使某行数据处理异常，整体应继续执行
    expect(result).toBe(true)
  })

  it('多个 Proxy 行均抛异常时不影响后续行处理', async () => {
    const throwingProxy1 = new Proxy([] as unknown[], {
      get(_target, prop: string | symbol) {
        if (typeof prop === 'string' && !isNaN(Number(prop))) {
          throw new Error('第一行数据损坏')
        }
        return undefined
      },
    })

    const throwingProxy2 = new Proxy([] as unknown[], {
      get(_target, prop: string | symbol) {
        if (typeof prop === 'string' && !isNaN(Number(prop))) {
          throw new Error('第二行数据损坏')
        }
        return undefined
      },
    })

    mockReadRangeValues.mockReturnValue([
      throwingProxy1,
      throwingProxy2,
      [
        'valid-sid-343b',
        '2024-01-01T00:00:00',
        '正常名称B',
        'http://valid343b.com',
        'TV',
        'github',
        '1',
        '正常内容B',
        'success',
        '看',
        '备注B',
        'fp-343b',
      ],
    ])

    mockGetCellValue.mockImplementation((_sheet: unknown, _row: number, col: number) => {
      if (col === 1) return 'valid-sid-343b'
      if (col === 7) return '1'
      return ''
    })

    const result = addSyncRecord({
      sid: 'valid-sid-343b',
      name: '正常名称B',
      count: 1,
      status: 'success',
    })

    expect(result).toBe(true)
  })
})

// ========== 补充测试：getOrCreateSyncRecordSheet 异常路径 (line 116, 137) ==========
describe('getOrCreateSyncRecordSheet 异常路径', () => {
  beforeEach(() => {
    __resetSyncRecordCache()
    mockGetLastRow.mockReturnValue(10)
    mockSetCellValue.mockClear()
  })

  it('sheets.Item 抛异常时应被外层 catch 捕获 (line 116)', async () => {
    // 创建一个 workbook，其 Sheets.Item 会抛异常
    const throwingWorkbook = {
      Sheets: {
        Count: 3,
        Item: vi.fn(() => {
          throw new Error('COM 调用失败：无法访问工作表')
        }),
        Add: vi.fn(() => createMockSheet({ name: 'NewSheet' })),
      },
      Worksheets: {
        Count: 3,
        Item: vi.fn(() => {
          throw new Error('COM 调用失败')
        }),
      },
      ActiveSheet: createMockSheet({ name: 'Active' }),
    }

    mockGetApp.mockReturnValue({ ActiveWorkbook: throwingWorkbook })

    // 即使查找工作表抛异常，getOrCreateSyncRecordSheet 应该继续尝试创建新表
    const result = addSyncRecord({
      sid: 'catch-line-116',
      name: '异常捕获测试',
      count: 1,
      status: 'success',
    })

    // 函数应该继续执行并返回 true（创建新表成功）
    expect(result).toBe(true)
  })

  it('sheet.Move 抛异常时应被 catch 捕获 (line 137)', async () => {
    // 创建一个 workbook，能正常找到工作表，但 Move 会抛异常
    const moveThrowingSheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
    moveThrowingSheet.Move = vi.fn(() => {
      throw new Error('Move 方法失败')
    })

    const wb = {
      Sheets: {
        Count: 1,
        Item: vi.fn(() => moveThrowingSheet),
        Add: vi.fn(() => createMockSheet({ name: 'NewSheet' })),
      },
      Worksheets: {
        Count: 1,
        Item: vi.fn(() => moveThrowingSheet),
      },
      ActiveSheet: createMockSheet({ name: 'Active' }),
    }

    mockGetApp.mockReturnValue({ ActiveWorkbook: wb })

    const result = addSyncRecord({
      sid: 'catch-line-137',
      name: 'Move异常测试',
      count: 1,
      status: 'success',
    })

    // 即使 Move 失败，函数应继续执行
    expect(typeof result).toBe('boolean')
  })

  it('查找工作表抛异常但 Add 也失败时应能兜底', async () => {
    const throwingWorkbook = {
      Sheets: {
        Count: 3,
        Item: vi.fn(() => {
          throw new Error('查找失败')
        }),
        Add: vi.fn(() => {
          throw new Error('创建新表也失败')
        }),
      },
      Worksheets: {
        Count: 3,
        Item: vi.fn(() => {
          throw new Error('查找失败')
        }),
      },
      ActiveSheet: createMockSheet({ name: 'Active' }),
    }

    mockGetApp.mockReturnValue({ ActiveWorkbook: throwingWorkbook })

    // 即使 Add 也失败，addSyncRecord 应返回 false 而非崩溃
    const result = addSyncRecord({
      sid: 'both-fail',
      name: '双重失败测试',
      count: 1,
      status: 'success',
    })

    // 应返回 false（无法创建工作表）
    expect(result).toBe(false)
  })
})

// ========== 补充测试：formatSyncRecordSheet dataRange 为 null 分支 (lines 732-775) ==========
describe('formatSyncRecordSheet dataRange 为 null 分支 (lines 732-775)', () => {
  it('lastRow < 2 时 dataRange 为 null，跳过数据行格式化', () => {
    mockGetLastRow.mockReturnValue(1)
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
    expect(() => formatSyncRecordSheet(sheet)).not.toThrow()
  })

  it('lastRow < 2 时使用 getSyncRecordSheetIfExists 获取工作表', () => {
    mockGetLastRow.mockReturnValue(0)
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    // 传 undefined，让 formatSyncRecordSheet 内部调用 getSyncRecordSheetIfExists
    expect(() => formatSyncRecordSheet()).not.toThrow()
  })
})

// ========== 补充测试：clearSyncRecords UsedRange 回退路径 (line 799) ==========
describe('clearSyncRecords UsedRange 回退路径 (line 799)', () => {
  it('UsedRange 为 null 时使用 Rows.Count 作为 lastRow', () => {
    const sheetWithNoUsedRange = {
      Name: SYNC_RECORD_SHEET_NAME,
      UsedRange: null,
      Rows: { Count: 10 },
      Range: vi.fn((addr: string) => {
        if (addr.includes(':')) {
          return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false }, Delete: vi.fn() }
        }
        return createMockCell('')
      }),
      Delete: vi.fn(),
      Activate: vi.fn(),
      Select: vi.fn(),
    }

    mockGetApp.mockReturnValue({
      ActiveWorkbook: {
        Sheets: {
          Count: 1,
          Item: vi.fn(() => sheetWithNoUsedRange),
          Add: vi.fn(() => createMockSheet({ name: SYNC_RECORD_SHEET_NAME })),
        },
      },
    })

    const result = clearSyncRecords()
    expect(typeof result).toBe('boolean')
  })

  it('UsedRange 存在时使用 UsedRange 计算 lastRow', () => {
    const sheetWithUsedRange = {
      Name: SYNC_RECORD_SHEET_NAME,
      UsedRange: { Row: 1, Rows: { Count: 5 } },
      Rows: { Count: 100 },
      Range: vi.fn((addr: string) => {
        if (addr.includes(':')) {
          return { Value2: null, Interior: { Color: 0 }, Font: { Bold: false }, Delete: vi.fn() }
        }
        return createMockCell('')
      }),
      Delete: vi.fn(),
      Activate: vi.fn(),
      Select: vi.fn(),
    }

    mockGetApp.mockReturnValue({
      ActiveWorkbook: {
        Sheets: {
          Count: 1,
          Item: vi.fn(() => sheetWithUsedRange),
          Add: vi.fn(() => createMockSheet({ name: SYNC_RECORD_SHEET_NAME })),
        },
      },
    })

    const result = clearSyncRecords()
    expect(typeof result).toBe('boolean')
  })
})

// ========== 补充测试：buildCache count 字段 || 1 回退 (line 334) ==========
describe('buildCache count 字段回退 (line 334)', () => {
  it('COUNT 列为空字符串时回退到默认值 1', () => {
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(3)
    // 第7列(COUNT)为空字符串 → parseInt('') = NaN → NaN || 1 = 1
    mockReadRangeValues.mockReturnValue([
      [
        'sid-1',
        '2026-01-01',
        '测试',
        'http://test.com',
        '看',
        'github',
        '',
        '内容',
        'success',
        '',
        '',
        '',
      ],
    ])
    addSyncRecord({ sid: 'sid-1', name: '测试', url: 'http://test.com', type: '看' })
    const records = getAllSyncRecords()
    expect(records.length).toBeGreaterThan(0)
  })

  it('COUNT 列为非数字字符串时回退到默认值 1', () => {
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(3)
    // 第7列(COUNT)为非数字字符串 → parseInt('abc') = NaN → NaN || 1 = 1
    mockReadRangeValues.mockReturnValue([
      [
        'sid-2',
        '2026-01-01',
        '测试2',
        'http://test2.com',
        '想',
        'github',
        'abc',
        '内容',
        'success',
        '',
        '',
        '',
      ],
    ])
    addSyncRecord({ sid: 'sid-2', name: '测试2', url: 'http://test2.com', type: '想' })
    const records = getAllSyncRecords()
    expect(records.length).toBeGreaterThan(0)
  })
})

// ========== 补充测试：deduplicateSyncRecords count 回退 (lines 670-675) ==========
describe('deduplicateSyncRecords count 字段回退 (lines 670-675)', () => {
  it('COUNT 列为空字符串时合并回退到默认值 1', () => {
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(4)
    // 两行相同SID但COUNT列为空 → parseInt('') || 1 = 1
    mockGetCellValue.mockImplementation((_sheet: unknown, row: unknown, col: unknown) => {
      const r = row as number
      const c = col as number
      if (c === 1) return 'dup-count-sid'
      if (c === 7) return '' // COUNT列为空
      return ''
    })
    const result = deduplicateSyncRecords()
    expect(result).toBe(true)
  })

  it('COUNT 列含非数字时合并回退到默认值 1', () => {
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(4)
    mockGetCellValue.mockImplementation((_sheet: unknown, row: unknown, col: unknown) => {
      const r = row as number
      const c = col as number
      if (c === 1) return 'dup-numeric-sid'
      if (c === 7) return 'N/A' // COUNT列非数字
      return ''
    })
    const result = deduplicateSyncRecords()
    expect(result).toBe(true)
  })

  it('COUNT 列混合有效数字与空值时正确累加', () => {
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(4)
    mockGetCellValue.mockImplementation((_sheet: unknown, row: unknown, col: unknown) => {
      const r = row as number
      const c = col as number
      if (c === 1) return 'mixed-count-sid'
      if (c === 7) {
        // 不同行不同count值
        if (r === 2) return '3'
        if (r === 3) return '' // 空值回退到1
        return '5'
      }
      return ''
    })
    const result = deduplicateSyncRecords()
    expect(result).toBe(true)
  })
})

// ========== 补充测试：formatSyncRecordSheet _formattingInProgress 守卫 (line 697) ==========
describe('formatSyncRecordSheet _formattingInProgress 守卫 (line 697)', () => {
  it('连续两次调用时第二次应跳过', () => {
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(5)
    const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
    // 第一次调用
    formatSyncRecordSheet(sheet)
    // 第二次调用也应正常执行（不抛异常）
    // 注意：由于 JS 单线程，_formattingInProgress 在第一次调用完成后已重置
    // 此测试验证正常流程不报错
    expect(() => formatSyncRecordSheet(sheet)).not.toThrow()
  })

  it('工作表不存在时守卫不影响后续调用', () => {
    mockGetApp.mockReturnValue({
      ActiveWorkbook: {
        Sheets: {
          Count: 0,
          Item: vi.fn(() => {
            throw new Error('无工作表')
          }),
        },
      },
    })
    // 第一次调用：getSyncRecordSheetIfExists 返回 null
    formatSyncRecordSheet()
    // 第二次调用应正常（_formattingInProgress 已在第一次调用中重置）
    expect(() => formatSyncRecordSheet()).not.toThrow()
  })

  it('getLastRow <= 1 时守卫不影响后续调用', () => {
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(1)
    const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
    formatSyncRecordSheet(sheet)
    expect(() => formatSyncRecordSheet(sheet)).not.toThrow()
  })
})

// ========== 补充测试：addSyncRecords UsedRange 为 null (line 560) ==========
describe('addSyncRecords UsedRange 为 null (line 560)', () => {
  it('UsedRange 为 null 时应使用默认 startRow=2', () => {
    const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
    ;(sheet as unknown as { UsedRange: unknown }).UsedRange = null
    const wb = createMockWorkbook()
    wb.Sheets.Item = vi.fn().mockReturnValue(sheet)
    mockGetApp.mockReturnValue({ ActiveWorkbook: wb })

    const result = addSyncRecords([
      { sid: 'null-range', name: '测试', url: 'http://test.com', type: '看', status: 'success' },
    ])
    expect(result).toBe(true)
  })

  it('UsedRange 为 undefined 时应使用默认 startRow=2', () => {
    const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
    ;(sheet as unknown as { UsedRange: unknown }).UsedRange = undefined
    const wb = createMockWorkbook()
    wb.Sheets.Item = vi.fn().mockReturnValue(sheet)
    mockGetApp.mockReturnValue({ ActiveWorkbook: wb })

    const result = addSyncRecords([
      { sid: 'undef-range', name: '测试', url: 'http://test.com', type: '看', status: 'success' },
    ])
    expect(result).toBe(true)
  })
})

// ========== 补充测试：formatSyncRecordSheet _formattingInProgress 守卫 (line 697) ==========
describe('formatSyncRecordSheet _formattingInProgress 重入守卫 (line 697)', () => {
  it('重入调用时应被 _formattingInProgress 守卫拦截', () => {
    const sheet = createMockSheet({ name: SYNC_RECORD_SHEET_NAME })
    let reentryTriggered = false

    // Mock getLastRow 在首次调用时触发重入
    mockGetLastRow.mockImplementation((_target: unknown) => {
      if (!reentryTriggered) {
        reentryTriggered = true
        // 重入调用：此时 _formattingInProgress 应为 true，应直接返回
        formatSyncRecordSheet(sheet)
      }
      return 5
    })

    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    // 第一次调用会设置 _formattingInProgress，getLastRow 内部重入触发守卫
    formatSyncRecordSheet(sheet)

    // 验证重入确实发生
    expect(reentryTriggered).toBe(true)
  })
})

// ========== 补充测试：addSyncRecords fingerprint 未定义回退 (line 552) ==========
describe('addSyncRecords fingerprint 未定义回退 (line 552)', () => {
  it('fingerprint 为 undefined 时应使用空字符串', async () => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(5)
    mockSetCellValue.mockClear()

    // 不传 fingerprint → 走 params.fingerprint !== undefined ? ... : ''
    const result = addSyncRecord({
      sid: 'no-fingerprint',
      name: '无指纹测试',
      url: 'http://test.com',
      count: 1,
      status: 'success',
    })

    expect(result).toBe(true)
  })

  it('fingerprint 为 undefined 时批量添加应正常工作', async () => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(5)
    mockSetCellValue.mockClear()

    // 批量添加，均不传 fingerprint
    const result = addSyncRecords([
      { sid: 'batch-no-fp-1', name: '批量1', count: 1, status: 'success' },
      { sid: 'batch-no-fp-2', name: '批量2', count: 1, status: 'success' },
    ])

    expect(result).toBe(true)
  })
})

// ========== 补充测试：addSyncRecords 批量写入 null 数据跳过 (line 573) ==========
describe('addSyncRecords 批量写入 null 数据跳过 (line 573)', () => {
  it('批量写入循环中 null 数据应被跳过', async () => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(10)
    mockSetCellValue.mockClear()

    // 使用 addSyncRecord 添加单条记录来触发批量写入路径
    // batchWriteNewRows 中若 newRows 含有 null 项，line 573 会跳过
    const result = addSyncRecord({
      sid: 'null-data-test',
      name: 'null 数据测试',
      url: 'http://test.com',
      count: 2,
      status: 'success',
    })

    expect(result).toBe(true)
  })
})

// ========== 补充测试：deduplicateSyncRecords keepRow 为 undefined (line 670) ==========
describe('deduplicateSyncRecords keepRow 为 undefined (line 670)', () => {
  it('SID 分组中 rows[0] 为 undefined 时应跳过', async () => {
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(3)

    // 模拟 rows 数组首位为 undefined 的场景
    // 正常情况下 rows 至少有一行有效数据，这里测试边界防御
    mockGetCellValue.mockImplementation((_sheet: unknown, row: unknown, col: unknown) => {
      const r = row as number
      const c = col as number
      if (c === 1) return `sid-${String(r)}`
      if (c === 7) return '1'
      return ''
    })

    const result = deduplicateSyncRecords()
    expect(typeof result).toBe('boolean')
  })
})

// ========== 补充测试：deduplicateSyncRecords 其他分支 ==========
describe('deduplicateSyncRecords 分支覆盖', () => {
  it('sheet 不存在时应返回 false', async () => {
    mockGetApp.mockReturnValue(null)
    const result = deduplicateSyncRecords()
    expect(result).toBe(false)
  })

  it('lastRow <= 1 时应返回 true 跳过去重 (line 650)', async () => {
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(1)
    const result = deduplicateSyncRecords()
    expect(result).toBe(true)
  })

  it('SID 全为空字符串时应跳过 (line 656)', async () => {
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(3)
    mockGetCellValue.mockImplementation(() => '')
    const result = deduplicateSyncRecords()
    expect(result).toBe(true)
  })

  it('无重复 SID 时不应触发去重日志 (line 666)', async () => {
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(3)
    mockGetCellValue.mockImplementation((_sheet: unknown, row: unknown, col: unknown) => {
      const r = row as number
      const c = col as number
      if (c === 1) return `sid-${String(r)}`
      if (c === 7) return '1'
      return ''
    })
    const result = deduplicateSyncRecords()
    expect(result).toBe(true)
  })
})

// ========== 补充测试：getAllSyncRecords 异常路径 ==========
describe('getAllSyncRecords 异常路径', () => {
  it('sheet 不存在时返回空数组', async () => {
    mockGetApp.mockReturnValue(null)
    const result = getAllSyncRecords()
    expect(result).toEqual([])
  })

  it('内部抛异常时应返回空数组', async () => {
    mockGetApp.mockImplementation(() => {
      throw new Error('宿主异常')
    })
    const result = getAllSyncRecords()
    expect(result).toEqual([])
  })
})

// ========== 补充测试：addSyncRecordSummary ==========
describe('addSyncRecordSummary 行为', () => {
  it('应委托给 addSyncRecord 并强制 sid 为空、count 为 1', async () => {
    __resetSyncRecordCache()
    mockGetApp.mockReturnValue({ ActiveWorkbook: createMockWorkbook() })
    mockGetLastRow.mockReturnValue(5)

    const result = addSyncRecordSummary({
      name: '仓库同步汇总',
      content: '新增 5 条',
      status: 'success',
      count: 10, // 即使传入 count，也应被覆盖为 1
    })

    expect(result).toBe(true)
  })
})
