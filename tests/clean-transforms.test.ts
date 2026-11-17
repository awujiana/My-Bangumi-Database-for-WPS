import { describe, it, expect } from 'vitest'

import {
  estimateUtf8Bytes,
  splitTagValue,
  isNoiseTag,
  transformCellValue,
} from '../ts/panel/clean-transforms.js'

// ========== estimateUtf8Bytes ==========

describe('estimateUtf8Bytes', () => {
  it('ASCII 每字符 1 字节', () => {
    expect(estimateUtf8Bytes('abc')).toBe(3)
  })

  it('中日韩字符每字符 3 字节', () => {
    expect(estimateUtf8Bytes('漫画')).toBe(6)
  })

  it('拉丁扩展 / 西里尔等 2 字节区（U+0080–U+07FF）每字符 2 字节', () => {
    // 覆盖 bytes += 2 分支：é(U+00E9)、ñ(U+00F1)、д(U+0434) 都落在两字节区
    expect(estimateUtf8Bytes('é')).toBe(2)
    expect(estimateUtf8Bytes('ñ')).toBe(2)
    expect(estimateUtf8Bytes('д')).toBe(2)
    expect(estimateUtf8Bytes('aé漫')).toBe(1 + 2 + 3)
  })

  it('emoji（代理对）合计 4 字节', () => {
    expect(estimateUtf8Bytes('🎵')).toBe(4)
  })

  it('混合文本按码点区间累加', () => {
    // 1 + 3 + 1 = 5
    expect(estimateUtf8Bytes('a漫b')).toBe(5)
  })

  it('空串为 0', () => {
    expect(estimateUtf8Bytes('')).toBe(0)
  })
})

// ========== splitTagValue ==========

describe('splitTagValue', () => {
  it('按半角 | 拆分并去空', () => {
    expect(splitTagValue('a | b|c')).toEqual(['a', 'b', 'c'])
  })

  it('兼容全角 ｜ 分隔', () => {
    expect(splitTagValue('漫画｜游戏改')).toEqual(['漫画', '游戏改'])
  })

  it('空段与纯空格段被剔除', () => {
    expect(splitTagValue(' a | | b ')).toEqual(['a', 'b'])
  })

  it('无分隔符时返回单元素', () => {
    expect(splitTagValue('漫画改')).toEqual(['漫画改'])
  })
})

// ========== isNoiseTag ==========

describe('isNoiseTag', () => {
  it('词表全等命中', () => {
    expect(isNoiseTag('B站')).toBe(true)
    expect(isNoiseTag('待定档')).toBe(true)
  })

  it('子串不算命中（全等匹配）', () => {
    expect(isNoiseTag('B站独播')).toBe(false)
  })

  it('纯年份 / 年月类正则命中', () => {
    expect(isNoiseTag('2020')).toBe(true)
    expect(isNoiseTag('2020年')).toBe(true)
    expect(isNoiseTag('2020年4月')).toBe(true)
  })

  it('普通标签不命中', () => {
    expect(isNoiseTag('漫画改')).toBe(false)
    expect(isNoiseTag('科幻')).toBe(false)
  })
})

// ========== transformCellValue ==========

describe('transformCellValue · stripNoiseTags', () => {
  it('移除噪声标签并保留正常标签', () => {
    const outcome = transformCellValue('stripNoiseTags', 'B站 | 漫画改 | 2020', { name: '' })
    expect(outcome).toEqual({ value: '漫画改', changed: true, removed: 2 })
  })

  it('全部为噪声时清空单元格', () => {
    const outcome = transformCellValue('stripNoiseTags', '已看 | 想看', { name: '' })
    expect(outcome).toEqual({ value: '', changed: true, removed: 2 })
  })

  it('无噪声时不变更', () => {
    const outcome = transformCellValue('stripNoiseTags', '漫画改 | 科幻', { name: '' })
    expect(outcome).toEqual({ value: '漫画改 | 科幻', changed: false, removed: 0 })
  })
})

describe('transformCellValue · normalizeTagSeparator', () => {
  it('统一分隔符并去重', () => {
    const outcome = transformCellValue('normalizeTagSeparator', 'a|b | a', { name: '' })
    expect(outcome).toEqual({ value: 'a | b', changed: true, removed: 1 })
  })

  it('已规范时不变更', () => {
    const outcome = transformCellValue('normalizeTagSeparator', 'a | b', { name: '' })
    expect(outcome).toEqual({ value: 'a | b', changed: false, removed: 0 })
  })
})

describe('transformCellValue · stripCategoryNumberPrefix', () => {
  it('去除数字|前缀', () => {
    expect(transformCellValue('stripCategoryNumberPrefix', '12|TV', { name: '' })).toEqual({
      value: 'TV',
      changed: true,
      removed: 1,
    })
  })

  it('无前缀时不变更', () => {
    expect(transformCellValue('stripCategoryNumberPrefix', 'TV', { name: '' })).toEqual({
      value: 'TV',
      changed: false,
      removed: 0,
    })
  })
})

describe('transformCellValue · dedupAliasAgainstName', () => {
  it('移除与名称重复的别名', () => {
    const outcome = transformCellValue('dedupAliasAgainstName', '作品名 | 别名A', {
      name: '作品名',
    })
    expect(outcome).toEqual({ value: '别名A', changed: true, removed: 1 })
  })

  it('名称为空时不移除任何条目', () => {
    const outcome = transformCellValue('dedupAliasAgainstName', '作品名 | 别名A', { name: '' })
    expect(outcome.value).toBe('作品名 | 别名A')
    expect(outcome.changed).toBe(false)
  })
})

describe('transformCellValue · normalizeOriginalTag', () => {
  it('变体映射 + 国家合并：漫改 + 日本 → 日本漫画改', () => {
    const outcome = transformCellValue('normalizeOriginalTag', '日本 | 漫改', { name: '' })
    expect(outcome.value).toBe('日本漫画改')
    expect(outcome.changed).toBe(true)
  })

  it('优先级去重：轻小说改 > 小说改', () => {
    const outcome = transformCellValue('normalizeOriginalTag', '轻小说改 | 小说改', { name: '' })
    expect(outcome.value).toBe('轻小说改')
  })

  it('特例规则：中国 + 网文改 → 中国网文改', () => {
    const outcome = transformCellValue('normalizeOriginalTag', '中国 | 网文', { name: '' })
    expect(outcome.value).toBe('中国网文改')
  })

  it('无改类型标签时保守不变更', () => {
    const outcome = transformCellValue('normalizeOriginalTag', '日本 | 原创', { name: '' })
    expect(outcome).toEqual({ value: '日本 | 原创', changed: false, removed: 0 })
  })

  it('存在自定义（非标准）改类型时丢弃标准改类型，只保留自定义', () => {
    // 「广播剧改」既不在 baseGaiTypes、也不在国家表里 → customAdapt 非空 →
    // 标准改类型「漫画改」被丢弃，避免把非标准类型降级成标准类型。
    // 结果被合并为「日本广播剧改」：国家只有 1 个、改类型也只剩 1 个。
    const outcome = transformCellValue('normalizeOriginalTag', '日本 | 漫画改 | 广播剧改', {
      name: '',
    })
    expect(outcome.value).toBe('日本广播剧改')
    expect(outcome.changed).toBe(true)
  })

  it('只有标准改类型时不走自定义优先分支（标准类型全部保留）', () => {
    const outcome = transformCellValue('normalizeOriginalTag', '日本 | 游戏改 | 漫画改', {
      name: '',
    })
    expect(outcome.value).toBe('日本 | 游戏改 | 漫画改')
  })
})

describe('transformCellValue · 边界', () => {
  it('空值返回未变更', () => {
    const blanks = ' '.repeat(3)
    expect(transformCellValue('stripNoiseTags', blanks, { name: '' })).toEqual({
      value: blanks,
      changed: false,
      removed: 0,
    })
  })

  it('未知变换 ID 兜底为未变更（绝不抛错）', () => {
    const outcome = transformCellValue('nonexistent' as 'stripNoiseTags', 'a | b', { name: '' })
    expect(outcome).toEqual({ value: 'a | b', changed: false, removed: 0 })
  })
})
