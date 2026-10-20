// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

// 直接从 pure-utilities.ts 导入（避免副作用链）
import { getSeqColumnIndex, addTagsFromString, buildTagsArray } from '../ts/sync/pure-utilities.js'

describe('pure-utilities', () => {
  // ========== getSeqColumnIndex 测试 ==========
  describe('getSeqColumnIndex', () => {
    it('无 columnMap 时返回默认值 4', () => {
      expect(getSeqColumnIndex(undefined)).toBe(4)
    })

    it('columnMap 中有"序列号"键时返回对应索引', () => {
      const columnMap = new Map<string, number>([['序列号', 5]])
      expect(getSeqColumnIndex(columnMap)).toBe(5)
    })

    it('columnMap 中无"序列号"键时返回默认值 4', () => {
      const columnMap = new Map<string, number>([
        ['名称', 2],
        ['集数', 3],
      ])
      expect(getSeqColumnIndex(columnMap)).toBe(4)
    })

    it('空 columnMap 时返回默认值 4', () => {
      const columnMap = new Map<string, number>()
      expect(getSeqColumnIndex(columnMap)).toBe(4)
    })

    it('columnMap 中"序列号"值为 0 时返回默认值（|| 运算符特性）', () => {
      // 注意：JavaScript 的 || 运算符对 0 返回右侧值
      const columnMap = new Map<string, number>([['序列号', 0]])
      expect(getSeqColumnIndex(columnMap)).toBe(4)
    })
  })

  // ========== addTagsFromString 测试 ==========
  describe('addTagsFromString', () => {
    it('空字符串不添加任何标签', () => {
      const tagSet = new Set<string>()
      addTagsFromString(tagSet, '')
      expect(tagSet.size).toBe(0)
    })

    it('undefined/null 处理：空值不添加标签', () => {
      const tagSet = new Set<string>()
      addTagsFromString(tagSet, '')
      expect(tagSet.size).toBe(0)
    })

    it('英文逗号分隔', () => {
      const tagSet = new Set<string>()
      addTagsFromString(tagSet, '治愈,日常,萌系')
      expect(tagSet.has('治愈')).toBe(true)
      expect(tagSet.has('日常')).toBe(true)
      expect(tagSet.has('萌系')).toBe(true)
      expect(tagSet.size).toBe(3)
    })

    it('中文逗号分隔', () => {
      const tagSet = new Set<string>()
      addTagsFromString(tagSet, '治愈，日常，萌系')
      expect(tagSet.size).toBe(3)
    })

    it('分号分隔', () => {
      const tagSet = new Set<string>()
      addTagsFromString(tagSet, '治愈;日常;萌系')
      expect(tagSet.size).toBe(3)
    })

    it('竖线分隔', () => {
      const tagSet = new Set<string>()
      addTagsFromString(tagSet, '治愈|日常|萌系')
      expect(tagSet.size).toBe(3)
    })

    it('混合分隔符', () => {
      const tagSet = new Set<string>()
      addTagsFromString(tagSet, '治愈,日常;萌系|热血')
      expect(tagSet.size).toBe(4)
    })

    it('去除空白标签', () => {
      const tagSet = new Set<string>()
      addTagsFromString(tagSet, '治愈, ,日常,')
      expect(tagSet.has('治愈')).toBe(true)
      expect(tagSet.has('日常')).toBe(true)
      expect(tagSet.size).toBe(2)
    })

    it('标签去重（Set 自动去重）', () => {
      const tagSet = new Set<string>()
      addTagsFromString(tagSet, '治愈,治愈,日常')
      expect(tagSet.size).toBe(2)
    })

    it('标签会被 trim 处理', () => {
      const tagSet = new Set<string>()
      addTagsFromString(tagSet, ' 治愈 , 日常 ')
      expect(tagSet.has('治愈')).toBe(true)
      expect(tagSet.has('日常')).toBe(true)
      expect(tagSet.has(' 治愈 ')).toBe(false)
    })

    it('纯符号标签会被过滤', () => {
      const tagSet = new Set<string>()
      addTagsFromString(tagSet, '|,;，；')
      expect(tagSet.size).toBe(0)
    })
  })

  // ========== buildTagsArray 测试 ==========
  describe('buildTagsArray', () => {
    it('空字符串返回空数组', () => {
      expect(buildTagsArray('')).toEqual([])
    })

    it('单个标签', () => {
      expect(buildTagsArray('治愈')).toEqual(['治愈'])
    })

    it('多个标签用逗号分隔', () => {
      const result = buildTagsArray('治愈,日常,萌系')
      expect(result).toEqual(['治愈', '日常', '萌系'])
    })

    it('自动去重', () => {
      const result = buildTagsArray('治愈,治愈,日常')
      expect(result.length).toBe(2)
      expect(result).toContain('治愈')
      expect(result).toContain('日常')
    })

    it('支持所有分隔符', () => {
      const result = buildTagsArray('治愈|日常;萌系，热血')
      expect(result.length).toBe(4)
    })

    it('空白字符串返回空数组', () => {
      expect(buildTagsArray(' '.repeat(3))).toEqual([])
    })

    it('标签包含空格时会被 trim', () => {
      const result = buildTagsArray(' 治愈 , 日常 ')
      expect(result).toEqual(['治愈', '日常'])
    })

    it('返回值为数组类型', () => {
      const result = buildTagsArray('test')
      expect(Array.isArray(result)).toBe(true)
    })
  })
})
