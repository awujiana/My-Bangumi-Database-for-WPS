/**
 * @fileoverview enrich-file-name 单测：从路径提取文件名
 *
 * `extractFileName` 原先埋在 `enrich-page.ts` 的「批量富化」区块里，被 6 处
 * 区块共用 —— 抽成叶子模块后顺手补测，锁住 Windows 反斜杠与「无分隔符」两条路径。
 */

import { describe, it, expect } from 'vitest'

import { extractFileName } from '../ts/panel/enrich-file-name.js'

describe('extractFileName', () => {
  it('取正斜杠路径的最后一段', () => {
    expect(extractFileName('D:/data/2026年4月新番表.xlsx')).toBe('2026年4月新番表.xlsx')
  })

  it('取反斜杠路径的最后一段（Windows 路径）', () => {
    expect(extractFileName(String.raw`D:\data\2026年4月新番表.xlsx`)).toBe('2026年4月新番表.xlsx')
  })

  it('两种分隔符混用时取**更靠后**的那个', () => {
    expect(extractFileName(String.raw`D:/data\sub/file.xlsx`)).toBe('file.xlsx')
    expect(extractFileName(String.raw`D:\data/sub\file.xlsx`)).toBe('file.xlsx')
  })

  it('无分隔符时原样返回', () => {
    expect(extractFileName('file.xlsx')).toBe('file.xlsx')
  })

  it('空串返回空串', () => {
    expect(extractFileName('')).toBe('')
  })

  it('根目录路径返回空串（分隔符后无内容）', () => {
    expect(extractFileName('/')).toBe('')
    expect(extractFileName('D:\\')).toBe('')
  })

  it('路径以分隔符结尾时返回空串', () => {
    expect(extractFileName('D:/data/')).toBe('')
  })
})
