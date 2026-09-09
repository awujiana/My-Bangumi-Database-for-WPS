/**
 * 富化平台聚合与简介识别辅助函数测试
 * 覆盖：工作簿月份标签解析、噪声过滤内置规则、噪声缓存重置。
 * @module tests/enrich-platform-intro.test
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { monthLabelFromWorkbookName } from '../ts/sync/workbook-auto-detect.js'
import { resetNoiseKeywordCache, shouldFilterNoise } from '../ts/sync/enrich-engine.js'

describe('monthLabelFromWorkbookName', () => {
  it('4 位年份 + 去扩展名 → yy年m月', () => {
    expect(monthLabelFromWorkbookName('2026年4月新番表 v2.13.xlsx')).toBe('26年4月')
  })

  it('两位数月份不补零', () => {
    expect(monthLabelFromWorkbookName('2026年10月新番表.xlsx')).toBe('26年10月')
  })

  it('已是两位年份时保持原样', () => {
    expect(monthLabelFromWorkbookName('26年7月新番表.xlsx')).toBe('26年7月')
  })

  it('无月份时返回去扩展名的文件名', () => {
    expect(monthLabelFromWorkbookName('我的收藏表.xlsx')).toBe('我的收藏表')
  })

  it('无扩展名时原样返回', () => {
    expect(monthLabelFromWorkbookName('2026年4月新番简介')).toBe('26年4月')
  })
})

describe('shouldFilterNoise', () => {
  it('正常平台名不过滤', () => {
    expect(shouldFilterNoise('bilibili')).toBe(false)
    expect(shouldFilterNoise('AcFun')).toBe(false)
    expect(shouldFilterNoise('B站港澳台')).toBe(false)
  })

  it('内置署名与示例文本过滤', () => {
    expect(shouldFilterNoise('新番表 by Hazx.')).toBe(true)
    expect(shouldFilterNoise('版权平台标注示例')).toBe(true)
    expect(shouldFilterNoise('播放平台示例')).toBe(true)
    expect(shouldFilterNoise('标注示例')).toBe(true)
    expect(shouldFilterNoise('示例')).toBe(true)
  })

  it('空白文本视为噪声', () => {
    expect(shouldFilterNoise('')).toBe(true)
    expect(shouldFilterNoise(' '.repeat(3))).toBe(true)
  })

  it('重置缓存后行为一致', () => {
    resetNoiseKeywordCache()
    expect(shouldFilterNoise('bilibili')).toBe(false)
  })
})
