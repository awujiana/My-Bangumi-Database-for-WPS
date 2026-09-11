import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖：auto-fill-url.ts 从 '../index.js' 桶导入 10 个符号。
// 受测的 _splitAliases / _buildNameUrlMap 仅用到 getCellValue 与 trim，
// 其余符号以 vi.fn() 占位，避免模块加载期 undefined 访问。
vi.mock('../ts/index.js', () => ({
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

import { _splitAliases, _buildNameUrlMap } from '../ts/tools/auto-fill-url.js'
import { getCellValue, trim } from '../ts/index.js'

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
        (_ws: unknown, row: number, col: number) => data[row]?.[col] ?? '',
      )
      vi.mocked(trim).mockImplementation((value: string) => value.trim())
    })

    it('从有 URL 的同行收集 名称/别名 → URL 映射', () => {
      const colMap = new Map<string, number>([
        ['名称', 1],
        ['Bangumi_URL', 2],
        ['别名', 3],
      ])
      const map = _buildNameUrlMap({} as never, 1, 3, colMap)
      expect(map).toEqual({
        NameA: 'http://a',
        AliasA1: 'http://a',
        Aia2: 'http://a',
        NameB: 'http://b',
      })
    })

    it('缺少 URL 列或名称列时返回空映射', () => {
      const colMap = new Map<string, number>([['其他', 1]])
      const map = _buildNameUrlMap({} as never, 1, 3, colMap)
      expect(map).toEqual({})
    })

    it('同名条目只保留首次出现的 URL（Object.hasOwn 去重）', () => {
      const dup: Record<number, Record<number, string>> = {
        2: { 1: 'X', 2: 'u1' },
        3: { 1: 'X', 2: 'u2' },
      }
      vi.mocked(getCellValue).mockImplementation(
        (_ws: unknown, row: number, col: number) => dup[row]?.[col] ?? '',
      )
      const colMap = new Map<string, number>([
        ['名称', 1],
        ['Bangumi_URL', 2],
      ])
      const map = _buildNameUrlMap({} as never, 1, 3, colMap)
      expect(map).toEqual({ X: 'u1' })
    })
  })
})
