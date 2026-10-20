// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖：auto-fill-url.ts 从 '../index.js' 桶导入 10 个符号。
// 受测的 _splitAliases / _buildNameUrlMap 仅用到 getCellValue 与 trim，
// 其余符号以 vi.fn() 占位，避免模块加载期 undefined 访问。
// `...await importOriginal()` 保证将来 barrel 新增导出时本 mock 不会静默变 undefined
// （真实 barrel 只能在 jsdom 下加载：panel-page.ts 模块级挂 window，node 环境会抛）。
vi.mock('../ts/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ts/index.js')>()),
  getDataSheet: vi.fn(),
  getCellValue: vi.fn(),
  setCellValue: vi.fn(),
  getColumnMap: vi.fn(),
  findHeaderRow: vi.fn(),
  getLastRow: vi.fn(),
  bgmLog: vi.fn(),
  LOG_LEVELS: { INFO: 'info', WARN: 'warn', ERROR: 'error' },
  BGM: { Dialog: { alert: vi.fn(), confirm: vi.fn() }, handleError: vi.fn() },
  trim: vi.fn((value: string) => value.trim()),
}))

import {
  _splitAliases,
  _buildNameUrlMap,
  autoFillUrls,
  showAutoFillUrlDialog,
} from '../ts/tools/auto-fill-url.js'
import {
  BGM,
  findHeaderRow,
  getCellValue,
  getColumnMap,
  getDataSheet,
  getLastRow,
  setCellValue,
  trim,
} from '../ts/index.js'

/** 工作表桩：只经过被 mock 的访问器读取，形状无需真实 */
const SHEET = {} as never

/** 名称 / URL / 别名三列的标准列映射 */
const COLUMN_MAP = new Map<string, number>([
  ['名称', 1],
  ['Bangumi_URL', 2],
  ['别名', 3],
])

/** 桩一个「表头在第 1 行」的工作表；`cells` 的键是 `行:列`，缺省为空串 */
function stubSheet(cells: Record<string, string>, lastRow: number): void {
  vi.mocked(getDataSheet).mockReturnValue(SHEET)
  vi.mocked(findHeaderRow).mockReturnValue(1)
  vi.mocked(getColumnMap).mockReturnValue(COLUMN_MAP)
  vi.mocked(getLastRow).mockReturnValue(lastRow)
  vi.mocked(trim).mockImplementation((value) => (value ?? '').trim())
  vi.mocked(getCellValue).mockImplementation(
    (_worksheet: unknown, row: number, column: number) =>
      cells[`${String(row)}:${String(column)}`] ?? '',
  )
}

/** 让「确认框」按用户的选择回调（false = 用户取消） */
function stubConfirm(isConfirmed: boolean): void {
  vi.mocked(BGM.Dialog.confirm).mockImplementation(
    (_message: string, callback: (isConfirmed: boolean) => void) => {
      callback(isConfirmed)
    },
  )
}

describe('tools/auto-fill-url', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('_splitAliases', () => {
    it('空字符串返回空数组', () => {
      expect(_splitAliases('')).toEqual([])
    })

    it('单个名称返回单元素数组', () => {
      expect(_splitAliases('名A')).toEqual(['名A'])
    })

    it('按 | ｜ / ／ 四种分隔符拆分', () => {
      expect(_splitAliases('A|B｜C/D／E')).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('逐项 trim 并过滤空串', () => {
      expect(_splitAliases('  A  |  B  | | C')).toEqual(['A', 'B', 'C'])
    })
  })

  describe('_buildNameUrlMap', () => {
    // 行号 → (列号 → 单元格值)
    const data: Record<number, Record<number, string>> = {
      2: { 1: 'NameA', 2: 'http://a', 3: 'AliasA1|Aia2' },
      3: { 1: 'NameB', 2: 'http://b', 3: '' },
    }

    beforeEach(() => {
      vi.mocked(getCellValue).mockImplementation(
        (_worksheet: unknown, row: number, column: number) => data[row]?.[column] ?? '',
      )
      vi.mocked(trim).mockImplementation((value) => (value ?? '').trim())
    })

    it('从有 URL 的同行收集 名称/别名 → URL 映射', () => {
      const columnMap = new Map<string, number>([
        ['名称', 1],
        ['Bangumi_URL', 2],
        ['别名', 3],
      ])
      const map = _buildNameUrlMap({} as never, 1, 3, columnMap)
      expect(map).toEqual({
        NameA: 'http://a',
        AliasA1: 'http://a',
        Aia2: 'http://a',
        NameB: 'http://b',
      })
    })

    it('缺少 URL 列或名称列时返回空映射', () => {
      const columnMap = new Map<string, number>([['其他', 1]])
      const map = _buildNameUrlMap({} as never, 1, 3, columnMap)
      expect(map).toEqual({})
    })

    it('同名条目只保留首次出现的 URL（Object.hasOwn 去重）', () => {
      const dup: Record<number, Record<number, string>> = {
        2: { 1: 'X', 2: 'u1' },
        3: { 1: 'X', 2: 'u2' },
      }
      vi.mocked(getCellValue).mockImplementation(
        (_worksheet: unknown, row: number, column: number) => dup[row]?.[column] ?? '',
      )
      const columnMap = new Map<string, number>([
        ['名称', 1],
        ['Bangumi_URL', 2],
      ])
      const map = _buildNameUrlMap({} as never, 1, 3, columnMap)
      expect(map).toEqual({ X: 'u1' })
    })
  })

  describe('autoFillUrls：前置校验（每条失败路径都要有明确提示，不能静默返回 0）', () => {
    it('取不到工作表 → 提示并返回 0/0', () => {
      vi.mocked(getDataSheet).mockReturnValue(null)
      expect(autoFillUrls()).toEqual({ filled: 0, mappedNames: 0 })
      expect(vi.mocked(BGM.Dialog.alert)).toHaveBeenCalledWith('无法获取工作表', '提示')
    })

    it('表头行无效（0 行）→ 提示', () => {
      vi.mocked(getDataSheet).mockReturnValue(SHEET)
      vi.mocked(findHeaderRow).mockReturnValue(0)
      expect(autoFillUrls()).toEqual({ filled: 0, mappedNames: 0 })
      expect(vi.mocked(BGM.Dialog.alert)).toHaveBeenCalledWith('未找到表头行', '提示')
    })

    it('缺 Bangumi_URL 或名称列 → 提示', () => {
      vi.mocked(getDataSheet).mockReturnValue(SHEET)
      vi.mocked(findHeaderRow).mockReturnValue(1)
      vi.mocked(getColumnMap).mockReturnValue(new Map([['名称', 1]]))
      expect(autoFillUrls()).toEqual({ filled: 0, mappedNames: 0 })
      expect(vi.mocked(BGM.Dialog.alert)).toHaveBeenCalledWith(
        '未找到 "Bangumi_URL" 或 "名称" 列',
        '提示',
      )
    })

    it('没有数据行 → 提示', () => {
      stubSheet({}, 1)
      expect(autoFillUrls()).toEqual({ filled: 0, mappedNames: 0 })
      expect(vi.mocked(BGM.Dialog.alert)).toHaveBeenCalledWith('没有数据行需要补全', '提示')
    })

    it('数据行里一个 URL 都没有（建不出映射）→ 提示', () => {
      stubSheet({ '2:1': 'NameA', '3:1': 'NameB' }, 3)
      expect(autoFillUrls()).toEqual({ filled: 0, mappedNames: 0 })
      expect(vi.mocked(BGM.Dialog.alert)).toHaveBeenCalledWith(
        '没有找到有效的 URL 映射，请先填写一些条目',
        '提示',
      )
    })

    it('读工作表抛错 → 交给 handleError，不向外抛', () => {
      vi.mocked(getDataSheet).mockImplementation(() => {
        throw new Error('COM 炸了')
      })
      expect(() => autoFillUrls()).not.toThrow()
      expect(vi.mocked(BGM.handleError)).toHaveBeenCalledWith(expect.any(Error), {
        context: 'autoFillUrls',
        showAlert: true,
      })
    })
  })

  describe('autoFillUrls：补全主流程', () => {
    it('按同名条目补全缺失 URL，已有 URL 的行不动', () => {
      stubSheet(
        {
          // 第 2 行：已有 URL，提供映射，自己不需要补
          '2:1': 'NameA',
          '2:2': 'http://a',
          // 第 3 行：同名但缺 URL → 应补成 http://a
          '3:1': 'NameA',
          // 第 4 行：没有任何同名条目 → 无处可补
          '4:1': 'NameZ',
        },
        4,
      )
      const result = autoFillUrls()
      expect(result).toEqual({ filled: 1, mappedNames: 1 })
      expect(vi.mocked(setCellValue)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(setCellValue)).toHaveBeenCalledWith(SHEET, 3, 2, 'http://a')
    })

    it('别名也能作为匹配键（别名行补到同一条目的 URL）', () => {
      stubSheet(
        {
          '2:1': 'NameA',
          '2:2': 'http://a',
          '2:3': 'A1|A2',
          '3:1': 'A2',
        },
        3,
      )
      const result = autoFillUrls()
      expect(result.filled).toBe(1)
      expect(vi.mocked(setCellValue)).toHaveBeenCalledWith(SHEET, 3, 2, 'http://a')
    })

    it('名称列为空的行跳过（没名字就无从匹配）', () => {
      stubSheet({ '2:1': 'NameA', '2:2': 'http://a', '3:1': '' }, 3)
      const result = autoFillUrls()
      expect(result).toEqual({ filled: 0, mappedNames: 1 })
      expect(vi.mocked(setCellValue)).not.toHaveBeenCalled()
    })

    it('别名与已有名称 / 别名重复时不覆盖先出现的 URL', () => {
      stubSheet(
        {
          '2:1': 'NameA',
          '2:2': 'http://first',
          // 别名里带着刚加过的 NameA → 走「已存在则保留先出现」分支
          '2:3': 'NameA|AliasX',
        },
        2,
      )
      expect(_buildNameUrlMap(SHEET, 1, 2, COLUMN_MAP)).toEqual({
        NameA: 'http://first',
        AliasX: 'http://first',
      })
    })

    it('首行同名的多个 URL 只认第一个（映射去重，补全结果稳定）', () => {
      stubSheet(
        {
          '2:1': 'NameA',
          '2:2': 'http://first',
          '3:1': 'NameA',
          '3:2': 'http://second',
          '6:1': 'NameA',
        },
        6,
      )
      const result = autoFillUrls()
      expect(result.filled).toBe(1)
      expect(vi.mocked(setCellValue)).toHaveBeenCalledWith(SHEET, 6, 2, 'http://first')
    })
  })

  describe('showAutoFillUrlDialog', () => {
    it('取不到工作表 → 什么都不弹', () => {
      vi.mocked(getDataSheet).mockReturnValue(null)
      showAutoFillUrlDialog()
      expect(vi.mocked(BGM.Dialog.alert)).not.toHaveBeenCalled()
      expect(vi.mocked(BGM.Dialog.confirm)).not.toHaveBeenCalled()
    })

    it('表头行无效 → 提示', () => {
      vi.mocked(getDataSheet).mockReturnValue(SHEET)
      vi.mocked(findHeaderRow).mockReturnValue(-1)
      showAutoFillUrlDialog()
      expect(vi.mocked(BGM.Dialog.alert)).toHaveBeenCalledWith('未找到表头行', '提示')
    })

    it('缺列 → 提示无法执行', () => {
      vi.mocked(getDataSheet).mockReturnValue(SHEET)
      vi.mocked(findHeaderRow).mockReturnValue(1)
      vi.mocked(getColumnMap).mockReturnValue(new Map([['名称', 1]]))
      showAutoFillUrlDialog()
      expect(vi.mocked(BGM.Dialog.alert)).toHaveBeenCalledWith(
        '未找到 "Bangumi_URL" 或 "名称" 列，无法执行',
        '提示',
      )
      expect(vi.mocked(BGM.Dialog.confirm)).not.toHaveBeenCalled()
    })

    it('只缺名称列（有 URL 列）→ 同样停在提示，不进确认框', () => {
      vi.mocked(getDataSheet).mockReturnValue(SHEET)
      vi.mocked(findHeaderRow).mockReturnValue(1)
      vi.mocked(getColumnMap).mockReturnValue(new Map([['Bangumi_URL', 2]]))
      showAutoFillUrlDialog()
      expect(vi.mocked(BGM.Dialog.alert)).toHaveBeenCalledWith(
        '未找到 "Bangumi_URL" 或 "名称" 列，无法执行',
        '提示',
      )
      expect(vi.mocked(BGM.Dialog.confirm)).not.toHaveBeenCalled()
    })

    it('确认后执行并展示补全结果', () => {
      stubSheet({ '2:1': 'NameA', '2:2': 'http://a', '3:1': 'NameA' }, 3)
      stubConfirm(true)
      showAutoFillUrlDialog()
      expect(vi.mocked(BGM.Dialog.alert)).toHaveBeenCalledWith(
        '补全完成！\n已建立 1 个名称/别名映射\n补全了 1 行的缺失 URL',
        '结果',
      )
    })

    it('确认但没有可补的项 → 提示「没有需要补全的 URL」', () => {
      stubSheet({ '2:1': 'NameA', '2:2': 'http://a' }, 2)
      stubConfirm(true)
      showAutoFillUrlDialog()
      expect(vi.mocked(BGM.Dialog.alert)).toHaveBeenCalledWith('没有需要补全的 URL', '提示')
    })

    it('取消 → 一行都不写', () => {
      stubSheet({ '2:1': 'NameA', '2:2': 'http://a', '3:1': 'NameA' }, 3)
      stubConfirm(false)
      showAutoFillUrlDialog()
      expect(vi.mocked(setCellValue)).not.toHaveBeenCalled()
      expect(vi.mocked(BGM.Dialog.alert)).not.toHaveBeenCalled()
    })
  })
})
