/**
 * @fileoverview 已打开工作簿自动识别模块测试
 *
 * 覆盖：
 *   - isAnimeSourceFilename 文件名关键词预筛
 *   - extractFileNameFromPath 路径解析
 *   - mergeCandidatePaths 候选路径合并（实时扫描优先 / 持久化兜底 / 去重 / 仍打开校验）
 *   - 检测器注册：新番表 / Bangumi 数据表键互斥、名称预筛
 *   - scanMatchingWorkbooks 边界：Workbooks 枚举与活动工作簿不一致时的兜底
 *   - describeOpenWorkbooks 诊断文案
 *   - mergeDetectedPathsIntoStorage 持久化并入（保留仍打开 / 剔除已关闭）
 */

// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'

import {
  isAnimeSourceFilename,
  extractFileNameFromPath,
  mergeCandidatePaths,
  scanMatchingWorkbooks,
  describeOpenWorkbooks,
  mergeDetectedPathsIntoStorage,
  loadDetectedPaths,
  ANIME_SOURCE_DETECTOR,
  BANGUMI_TARGET_DETECTOR,
  ALL_DETECTORS,
} from '../ts/sync/workbook-auto-detect.js'
import type { WorkbookDetector } from '../ts/sync/workbook-auto-detect.js'
import type { WpsWorkbook, WpsWorksheet } from '../ts/tools/wps.js'

describe('isAnimeSourceFilename', () => {
  it('命中「新番」关键词', () => {
    expect(isAnimeSourceFilename('2026年10月新番表 v2.15.xlsx')).toBe(true)
    expect(isAnimeSourceFilename('新番表.xlsx')).toBe(true)
    expect(isAnimeSourceFilename('新番合集.xls')).toBe(true)
  })

  it('命中「番组」关键词', () => {
    expect(isAnimeSourceFilename('番组表.xlsx')).toBe(true)
    expect(isAnimeSourceFilename('2026年7月番组表 v1.0.xlsx')).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(isAnimeSourceFilename('XINFAN.xlsx')).toBe(true)
    expect(isAnimeSourceFilename('2026年10月新番表.xlsx')).toBe(true)
  })

  it('命中拼音「xinfan」关键词', () => {
    expect(isAnimeSourceFilename('xinfan-2026-10.xlsx')).toBe(true)
  })

  it('未命中普通文件名', () => {
    expect(isAnimeSourceFilename('Bangumi 追踪表.xlsx')).toBe(false)
    expect(isAnimeSourceFilename('2026年7月表.xlsx')).toBe(false)
    expect(isAnimeSourceFilename('')).toBe(false)
    expect(isAnimeSourceFilename(' '.repeat(3))).toBe(false)
  })
})

describe('extractFileNameFromPath', () => {
  it('Windows 路径', () => {
    expect(extractFileNameFromPath(String.raw`D:\文档\2026年10月新番表.xlsx`)).toBe(
      '2026年10月新番表.xlsx',
    )
  })

  it('POSIX 路径', () => {
    expect(extractFileNameFromPath('/home/user/新番表.xlsx')).toBe('新番表.xlsx')
  })

  it('无目录的纯文件名', () => {
    expect(extractFileNameFromPath('新番表.xlsx')).toBe('新番表.xlsx')
  })

  it('空字符串', () => {
    expect(extractFileNameFromPath('')).toBe('')
  })
})

function openPredicate(openPaths: readonly string[]): (path: string) => boolean {
  return (path: string): boolean => openPaths.includes(path)
}

describe('mergeCandidatePaths', () => {
  it('实时扫描结果优先于持久化记录', () => {
    const persisted = [String.raw`C:\old.xlsx`]
    const live = [String.raw`C:\new.xlsx`]
    const result = mergeCandidatePaths(persisted, live, openPredicate(live))
    expect(result).toEqual([String.raw`C:\new.xlsx`])
  })

  it('持久化中仍打开且未被实时扫描覆盖的作为兜底追加', () => {
    const persisted = [String.raw`C:\a.xlsx`, String.raw`C:\b.xlsx`]
    const live = [String.raw`C:\b.xlsx`]
    const open = [String.raw`C:\a.xlsx`, String.raw`C:\b.xlsx`]
    const result = mergeCandidatePaths(persisted, live, openPredicate(open))
    expect(result).toEqual([String.raw`C:\b.xlsx`, String.raw`C:\a.xlsx`])
  })

  it('持久化中已关闭的工作簿不加入', () => {
    const persisted = [String.raw`C:\closed.xlsx`]
    const live: string[] = []
    const result = mergeCandidatePaths(persisted, live, openPredicate([]))
    expect(result).toEqual([])
  })

  it('重复路径去重（实时扫描内部重复 + 与持久化重复）', () => {
    const persisted = [String.raw`C:\a.xlsx`]
    const live = [String.raw`C:\a.xlsx`, String.raw`C:\a.xlsx`]
    const result = mergeCandidatePaths(persisted, live, openPredicate([String.raw`C:\a.xlsx`]))
    expect(result).toEqual([String.raw`C:\a.xlsx`])
  })

  it('全部为空返回空数组', () => {
    expect(mergeCandidatePaths([], [], () => true)).toEqual([])
  })
})

// ========== 检测器注册与名称预筛 ==========

/** 构造最小工作簿 mock（仅满足名称预筛读取 Name 属性） */
function makeMockWorkbook(sheetNames: string[]): WpsWorkbook {
  const sheets: WpsWorksheet[] = sheetNames.map((name) => ({ Name: name }) as WpsWorksheet)
  const worksheets = {
    Count: sheets.length,
    Item: (index: number): WpsWorksheet => {
      if (index < 1 || index > sheets.length) throw new RangeError('下标越界')
      const sheet = sheets[index - 1]
      if (!sheet) throw new RangeError('下标越界')
      return sheet
    },
  }
  return {
    Name: 'mock.xlsx',
    FullName: String.raw`C:\mock.xlsx`,
    Worksheets: worksheets,
    Sheets: worksheets,
    ActiveSheet: sheets[0] ?? ({} as WpsWorksheet),
  }
}

describe('检测器注册', () => {
  it('新番表与 Bangumi 数据表使用不同的持久化键', () => {
    expect(ANIME_SOURCE_DETECTOR.key).not.toBe(BANGUMI_TARGET_DETECTOR.key)
    expect(ANIME_SOURCE_DETECTOR.key).toBe('bgm_enrich_auto_detect')
    expect(BANGUMI_TARGET_DETECTOR.key).toBe('bgm_enrich_auto_detect_bangumi')
  })

  it('ALL_DETECTORS 包含两种检测器', () => {
    expect(ALL_DETECTORS).toEqual([ANIME_SOURCE_DETECTOR, BANGUMI_TARGET_DETECTOR])
  })

  it('新番表名称预筛：文件名命中关键词才通过', () => {
    const hit = makeMockWorkbook(['Sheet1'])
    hit.Name = '2026年10月新番表.xlsx'
    const miss = makeMockWorkbook(['Sheet1'])
    miss.Name = '普通工作簿.xlsx'
    expect(ANIME_SOURCE_DETECTOR.isNameMatch?.(hit)).toBe(true)
    expect(ANIME_SOURCE_DETECTOR.isNameMatch?.(miss)).toBe(false)
  })

  it('Bangumi 名称预筛：任一工作表名命中关键词才通过', () => {
    const hit = makeMockWorkbook(['Sheet1', 'Bangumi 追踪表'])
    const miss = makeMockWorkbook(['Sheet1', '数据'])
    expect(BANGUMI_TARGET_DETECTOR.isNameMatch?.(hit)).toBe(true)
    expect(BANGUMI_TARGET_DETECTOR.isNameMatch?.(miss)).toBe(false)
  })
})

// ========== 扫描边界：Workbooks 集合与活动工作簿不一致 ==========

/** 只按「是否存在工作表」判定的测试用检测器（不做名称预筛、不读单元格） */
const ANY_WORKBOOK_DETECTOR: WorkbookDetector = {
  key: 'test_any_workbook',
  label: '任意工作簿',
  findFirstMatchingSheet: (wb: WpsWorkbook): WpsWorksheet | null =>
    wb.Worksheets.Count > 0 ? wb.Worksheets.Item(1) : null,
}

/** 构造 mock WPS Application（Workbooks 集合 + 可选活动工作簿 + 内存版 PluginStorage） */
function makeMockApp(
  workbooks: WpsWorkbook[],
  activeWorkbook: WpsWorkbook | null = null,
  windows: WpsWorkbook[] = [],
): void {
  const storage = new Map<string, string>()
  ;(window as { Application?: unknown }).Application = {
    Workbooks: {
      Count: workbooks.length,
      Item: (index: number): WpsWorkbook => {
        const wb = workbooks[index - 1]
        if (!wb) throw new RangeError('下标越界')
        return wb
      },
    },
    Windows: {
      Count: windows.length,
      Item: (index: number): unknown => {
        const wb = windows[index - 1]
        if (!wb) throw new RangeError('窗口下标越界')
        return { Workbook: wb, ActiveSheet: wb.ActiveSheet, Parent: wb }
      },
    },
    ActiveWorkbook: activeWorkbook,
    PluginStorage: {
      getItem: (key: string): string => storage.get(key) ?? '',
      setItem: (key: string, value: string): void => {
        storage.set(key, value)
      },
    },
  }
}

function clearMockApp(): void {
  delete (window as { Application?: unknown }).Application
}

describe('scanMatchingWorkbooks 边界', () => {
  afterEach(() => {
    clearMockApp()
  })

  it('活动工作簿未出现在 Workbooks 枚举中时作为兜底纳入扫描', () => {
    const enumerated = makeMockWorkbook(['数据'])
    enumerated.Name = '新番表.xlsx'
    const active = makeMockWorkbook(['数据'])
    active.Name = '娱乐影视游戏记录.xlsx'

    makeMockApp([enumerated], active)
    const found = scanMatchingWorkbooks(ANY_WORKBOOK_DETECTOR)

    expect(found.map((wb) => wb.Name)).toEqual(['娱乐影视游戏记录.xlsx', '新番表.xlsx'])
  })

  it('活动工作簿已在枚举结果中时不重复计入', () => {
    const first = makeMockWorkbook(['数据'])
    first.Name = 'a.xlsx'
    const second = makeMockWorkbook(['数据'])
    second.Name = 'b.xlsx'

    makeMockApp([first, second], second, [second])
    const found = scanMatchingWorkbooks(ANY_WORKBOOK_DETECTOR)

    expect(found.map((wb) => wb.Name)).toEqual(['b.xlsx', 'a.xlsx'])
  })

  it('Workbooks 仅返回一个时，从 Windows 集合补齐同一实例的其他工作簿', () => {
    const listed = makeMockWorkbook(['数据'])
    listed.Name = '工作簿1.xlsx'
    const target = makeMockWorkbook(['数据'])
    target.Name = '娱乐影视游戏记录.xlsx'

    makeMockApp([listed], listed, [listed, target])
    const found = scanMatchingWorkbooks(ANY_WORKBOOK_DETECTOR)

    expect(found.map((wb) => wb.Name)).toEqual(['工作簿1.xlsx', '娱乐影视游戏记录.xlsx'])
  })

  it('活动工作簿不满足检测条件时不计入', () => {
    const hit = makeMockWorkbook(['数据'])
    hit.Name = 'a.xlsx'
    const empty = makeMockWorkbook([])
    empty.Name = 'b.xlsx'

    makeMockApp([hit], empty)
    const found = scanMatchingWorkbooks(ANY_WORKBOOK_DETECTOR)

    expect(found.map((wb) => wb.Name)).toEqual(['a.xlsx'])
  })

  it('无 Application 时返回空数组', () => {
    clearMockApp()
    expect(scanMatchingWorkbooks(ANY_WORKBOOK_DETECTOR)).toEqual([])
  })
})

describe('describeOpenWorkbooks', () => {
  afterEach(() => {
    clearMockApp()
  })

  it('列出全部工作簿名称与活动工作簿', () => {
    const first = makeMockWorkbook(['数据'])
    first.Name = 'a.xlsx'
    const second = makeMockWorkbook(['数据'])
    second.Name = 'b.xlsx'

    makeMockApp([first, second], second)
    const text = describeOpenWorkbooks()

    expect(text).toContain('2 个')
    expect(text).toContain('a.xlsx')
    expect(text).toContain('b.xlsx')
    expect(text).toContain('活动工作簿 b.xlsx')
  })

  it('Application 不可用时给出占位说明', () => {
    clearMockApp()
    expect(describeOpenWorkbooks()).toBe('Application 不可用')
  })
})

describe('mergeDetectedPathsIntoStorage', () => {
  afterEach(() => {
    clearMockApp()
  })

  it('实时扫描未命中时保留仍打开的持久化记录（不覆盖历史）', () => {
    // 无工作表 → 检测不命中
    const target = makeMockWorkbook([])
    target.Name = '娱乐影视游戏记录.xlsx'
    target.FullName = String.raw`C:\娱乐影视游戏记录.xlsx`
    makeMockApp([target])

    // 预置持久化记录指向仍打开的工作簿
    const app = (
      window as { Application: { PluginStorage: { setItem: (k: string, v: string) => void } } }
    ).Application
    app.PluginStorage.setItem(BANGUMI_TARGET_DETECTOR.key, JSON.stringify([target.FullName]))

    mergeDetectedPathsIntoStorage()

    expect(loadDetectedPaths(BANGUMI_TARGET_DETECTOR)).toEqual([target.FullName])
  })

  it('持久化记录中已关闭的工作簿会被剔除', () => {
    makeMockApp([])
    const app = (
      window as { Application: { PluginStorage: { setItem: (k: string, v: string) => void } } }
    ).Application
    app.PluginStorage.setItem(
      BANGUMI_TARGET_DETECTOR.key,
      JSON.stringify([String.raw`C:\closed.xlsx`]),
    )

    mergeDetectedPathsIntoStorage()

    expect(loadDetectedPaths(BANGUMI_TARGET_DETECTOR)).toEqual([])
  })

  it('无 Application 时不抛错', () => {
    clearMockApp()
    expect(() => mergeDetectedPathsIntoStorage()).not.toThrow()
  })
})
