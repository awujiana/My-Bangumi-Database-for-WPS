/**
 * @fileoverview 工作簿自动识别通用模块纯函数测试
 *
 * 覆盖：
 *   - isAnimeFilename 文件名关键词预筛
 *   - extractFileNameFromPath 路径解析
 *   - mergeDetectCandidates 候选合并（实时扫描优先 / 持久化兜底 / 去重 / 仍打开校验）
 *   - 检测器注册：新番表 / Bangumi 数据表键互斥、名称预筛
 */

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

import {
  isAnimeFilename,
  extractFileNameFromPath,
  mergeDetectCandidates,
  ANIME_SOURCE_DETECTOR,
  BANGUMI_TARGET_DETECTOR,
  ALL_DETECTORS,
} from '../ts/sync/enrich-auto-detect.js'
import type { WpsWorkbook, WpsWorksheet } from '../ts/tools/wps.js'

describe('isAnimeFilename', () => {
  it('命中「新番」关键词', () => {
    expect(isAnimeFilename('2026年10月新番表 v2.15.xlsx')).toBe(true)
    expect(isAnimeFilename('新番表.xlsx')).toBe(true)
    expect(isAnimeFilename('新番合集.xls')).toBe(true)
  })

  it('命中「番组」关键词', () => {
    expect(isAnimeFilename('番组表.xlsx')).toBe(true)
    expect(isAnimeFilename('2026年7月番组表 v1.0.xlsx')).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(isAnimeFilename('XINFAN.xlsx')).toBe(true)
    expect(isAnimeFilename('2026年10月新番表.xlsx')).toBe(true)
  })

  it('命中拼音「xinfan」关键词', () => {
    expect(isAnimeFilename('xinfan-2026-10.xlsx')).toBe(true)
  })

  it('未命中普通文件名', () => {
    expect(isAnimeFilename('Bangumi 追踪表.xlsx')).toBe(false)
    expect(isAnimeFilename('2026年7月表.xlsx')).toBe(false)
    expect(isAnimeFilename('')).toBe(false)
    expect(isAnimeFilename(' '.repeat(3))).toBe(false)
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

describe('mergeDetectCandidates', () => {
  it('实时扫描结果优先于持久化记录', () => {
    const persisted = [String.raw`C:\old.xlsx`]
    const live = [String.raw`C:\new.xlsx`]
    const result = mergeDetectCandidates(persisted, live, openPredicate(live))
    expect(result).toEqual([String.raw`C:\new.xlsx`])
  })

  it('持久化中仍打开且未被实时扫描覆盖的作为兜底追加', () => {
    const persisted = [String.raw`C:\a.xlsx`, String.raw`C:\b.xlsx`]
    const live = [String.raw`C:\b.xlsx`]
    const open = [String.raw`C:\a.xlsx`, String.raw`C:\b.xlsx`]
    const result = mergeDetectCandidates(persisted, live, openPredicate(open))
    expect(result).toEqual([String.raw`C:\b.xlsx`, String.raw`C:\a.xlsx`])
  })

  it('持久化中已关闭的工作簿不加入', () => {
    const persisted = [String.raw`C:\closed.xlsx`]
    const live: string[] = []
    const result = mergeDetectCandidates(persisted, live, openPredicate([]))
    expect(result).toEqual([])
  })

  it('重复路径去重（实时扫描内部重复 + 与持久化重复）', () => {
    const persisted = [String.raw`C:\a.xlsx`]
    const live = [String.raw`C:\a.xlsx`, String.raw`C:\a.xlsx`]
    const result = mergeDetectCandidates(persisted, live, openPredicate([String.raw`C:\a.xlsx`]))
    expect(result).toEqual([String.raw`C:\a.xlsx`])
  })

  it('全部为空返回空数组', () => {
    expect(mergeDetectCandidates([], [], () => true)).toEqual([])
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
