/**
 * @fileoverview ensureBangumiColumns 列添加原子性测试（P2-6）
 *
 * 覆盖生产语义：新增列必须「写入表头 → 读回校验通过」才进入返回的列映射。
 *
 * 原实现在 try 内逐个 set 映射、catch 里静默返回，等于把「表头可能没写成」的列
 * 当成已存在 —— 下游按映射往空列写值，用户看到的是表头缺失 + 数据错位。本文件
 * 锁死三件事：
 *   1. 校验通过 → 新列进入映射；
 *   2. 校验不通过 / 写入抛错 → 映射里**没有**新列，且提示用户；
 *   3. 读回本身失败（空结果）不据此判失败（与 buildCache 同一降级口径）。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  toast: vi.fn<(message: string, type?: string) => void>(),
  /** 模拟读回结果：`[]` 表示读取失败（COM 异常），`[[...]]` 表示读到的表头 */
  readBack: [] as string[][],
}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
  PANEL_CONFIG: { MAX_SCAN_ROWS: 100 },
  HEADER_KEYWORDS: [],
  COLUMN_RULES: {},
  STANDARD_HEADERS: [],
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: mocks.bgmLog,
  BGM: { handleError: vi.fn(), ErrorLevel: { ERROR: 'ERROR' } },
  getCellValue: () => '',
  setCellValue: vi.fn(),
  getLastRow: () => 1,
  findHeaderRow: () => 1,
  getColumnMap: () => new Map<string, number>(),
  readRangeValues: () => mocks.readBack,
  isEmptyValue: (value: string | null | undefined) => !value || value.trim() === '',
}))

vi.mock('../ts/sync/enrich-record.js', () => ({
  addEnrichRecord: vi.fn(),
  addEnrichRecords: vi.fn(() => true),
}))

vi.mock('../ts/core/ui-bridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/core/ui-bridge.js')>()
  return {
    ...actual,
    getNotifyApi: () => ({ ...actual.getNotifyApi(), toast: mocks.toast }),
  }
})

import { ensureBangumiColumns } from '../ts/sync/enrich-engine.js'

// ========== 测试替身 ==========

interface RangeStub {
  Font: { Name: string; Size: number; Bold: boolean; Color: number }
  Interior: { Color: number }
  Value?: string[][]
}

/**
 * 范围桩：`Value` 可写（供断言写入内容），也可配置为写入即抛错。
 * `Font` / `Interior` 供样式模板与样式复制路径读写。
 */
function createRange(shouldThrowOnWrite = false): RangeStub {
  const range: RangeStub = {
    Font: { Name: '', Size: 0, Bold: false, Color: 0 },
    Interior: { Color: 0 },
  }
  let stored: string[][] | undefined
  Object.defineProperty(range, 'Value', {
    get: () => stored,
    set: (values: string[][]) => {
      if (shouldThrowOnWrite) throw new Error('COM 写入失败')
      stored = values
    },
  })
  return range
}

/** 工作表桩：所有 Range() 都返回同一个范围桩（本用例只关心表头那一行） */
function createSheet(range: RangeStub): never {
  return { Name: 'Bangumi', Range: () => range } as never
}

/** 已有列：名称(1) / 别名(2)，因此新列应从第 3 列开始 */
function createColumnMap(): Map<string, number> {
  return new Map<string, number>([
    ['名称', 1],
    ['别名', 2],
  ])
}

const HEADER_ROW = 1
const REQUIRED_FIELDS: Record<string, string> = { 导演: '导演', 脚本: '脚本' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readBack = []
})

// ========== 测试套件 ==========

describe('ensureBangumiColumns 新增列全成或全不成 (P2-6)', () => {
  it('表头写入并读回校验通过：新列进入映射且不提示', () => {
    mocks.readBack = [['导演', '脚本']]
    const range = createRange()

    const result = ensureBangumiColumns(
      createSheet(range),
      createColumnMap(),
      REQUIRED_FIELDS,
      HEADER_ROW,
    )

    expect(result.get('导演')).toBe(3)
    expect(result.get('脚本')).toBe(4)
    // 表头确实写到了第 3、4 列
    expect(range.Value).toEqual([['导演', '脚本']])
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('读回为空（表头没落盘）：新列不进入映射并提示用户', () => {
    mocks.readBack = [['', '']]

    const result = ensureBangumiColumns(
      createSheet(createRange()),
      createColumnMap(),
      REQUIRED_FIELDS,
      HEADER_ROW,
    )

    expect(result.has('导演')).toBe(false)
    expect(result.has('脚本')).toBe(false)
    // 原有映射不受影响
    expect(result.get('名称')).toBe(1)
    expect(result.get('别名')).toBe(2)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('读回列数不足同样判为失败', () => {
    mocks.readBack = [['导演']]

    const result = ensureBangumiColumns(
      createSheet(createRange()),
      createColumnMap(),
      REQUIRED_FIELDS,
      HEADER_ROW,
    )

    expect(result.has('导演')).toBe(false)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('写入抛错：同样不部分提交并提示用户', () => {
    const result = ensureBangumiColumns(
      createSheet(createRange(true)),
      createColumnMap(),
      REQUIRED_FIELDS,
      HEADER_ROW,
    )

    expect(result.has('导演')).toBe(false)
    expect(result.get('名称')).toBe(1)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('读回本身失败（空结果）不据此判失败：保持原有语义', () => {
    mocks.readBack = []

    const result = ensureBangumiColumns(
      createSheet(createRange()),
      createColumnMap(),
      REQUIRED_FIELDS,
      HEADER_ROW,
    )

    expect(result.get('导演')).toBe(3)
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('没有缺失列时不写表头也不提示', () => {
    const range = createRange()

    const result = ensureBangumiColumns(
      createSheet(range),
      new Map<string, number>([
        ['名称', 1],
        ['导演', 2],
      ]),
      { 导演: '导演' },
      HEADER_ROW,
    )

    expect(result.get('导演')).toBe(2)
    expect(range.Value).toBeUndefined()
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})
