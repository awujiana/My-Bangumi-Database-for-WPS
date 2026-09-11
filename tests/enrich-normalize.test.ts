/**
 * @fileoverview enrich-normalize 单测：纯文本工具簇 + 噪声过滤
 *
 * 这些函数是从 `enrich-engine.ts` 迁出的唯一不碰 WPS COM 的一簇，
 * 被预览 / 富化 / 设置页共用，因此逐条锁死其行为。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 只隔离 tools/config.js：噪声关键词的自定义部分来自配置存储。
vi.mock('../ts/tools/config.js', () => ({
  getConfig: vi.fn(),
  CONFIG_KEYS: {
    ENRICH_FILTER_KEYWORDS: 'bgm_enrich_filter_keywords',
  },
}))

import { getConfig, CONFIG_KEYS } from '../ts/tools/config.js'
import {
  TAG_SEPARATOR,
  FEATURE_SEPARATOR,
  normalizeName,
  splitAliases,
  splitTags,
  mergeTags,
  appendFeatures,
  resetNoiseKeywordCache,
  shouldFilterNoise,
} from '../ts/sync/enrich-normalize.js'

const store = new Map<string, string>()

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  resetNoiseKeywordCache()
  ;(getConfig as ReturnType<typeof vi.fn>).mockImplementation(
    (key: string, defaultValue = ''): string => store.get(key) ?? defaultValue,
  )
})

describe('分隔符常量', () => {
  it('标签与特点分隔符均为 " | "', () => {
    expect(TAG_SEPARATOR).toBe(' | ')
    expect(FEATURE_SEPARATOR).toBe(' | ')
  })
})

describe('normalizeName', () => {
  it('去空格 + 转小写', () => {
    expect(normalizeName('  Hello World ')).toBe('helloworld')
  })

  it('全角转半角（！-～ 区间）', () => {
    expect(normalizeName('ＡＢＣ')).toBe('abc')
    expect(normalizeName('１２３')).toBe('123')
  })

  it('空串返回空串', () => {
    expect(normalizeName('')).toBe('')
  })

  it('混合全角空格也被压缩', () => {
    expect(normalizeName('Ａ　Ｂ')).toBe('ab')
  })
})

describe('splitAliases', () => {
  it('按 | / ; ， 、 / 分割并去空白', () => {
    expect(splitAliases('a|b/c;d，e、f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('空串返回空数组', () => {
    expect(splitAliases('')).toEqual([])
  })

  it('过滤纯分隔符产生的空项', () => {
    expect(splitAliases('a||b')).toEqual(['a', 'b'])
  })
})

describe('splitTags', () => {
  it('按 | 、 , ; / 分割', () => {
    expect(splitTags('a|b、c,d;e/f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('空串返回空数组', () => {
    expect(splitTags('')).toEqual([])
  })
})

describe('mergeTags', () => {
  it('去重后以 TAG_SEPARATOR 连接', () => {
    expect(mergeTags('a | b', 'b | c')).toBe('a | b | c')
  })

  it('旧值为空时直接返回新值（不产生前导分隔符）', () => {
    expect(mergeTags('', 'x')).toBe('x')
  })

  it('新值为空时原样保留旧值', () => {
    expect(mergeTags('a | b', '')).toBe('a | b')
  })

  it('两端都为空时返回空串', () => {
    expect(mergeTags('', '')).toBe('')
  })
})

describe('appendFeatures', () => {
  it('去重后以 FEATURE_SEPARATOR 连接', () => {
    expect(appendFeatures('x | y', 'y | z')).toBe('x | y | z')
  })

  it('旧值为空直接返回新值', () => {
    expect(appendFeatures('', 'y')).toBe('y')
  })

  it('新值为空原样返回旧值', () => {
    expect(appendFeatures('x', '')).toBe('x')
  })

  it('忽略重复项（含首尾空格）', () => {
    expect(appendFeatures('x', ' x ')).toBe('x')
  })
})

describe('shouldFilterNoise', () => {
  it('空串与纯空白视为噪声', () => {
    expect(shouldFilterNoise('')).toBe(true)
    expect(shouldFilterNoise(' '.repeat(3))).toBe(true)
  })

  it('命中内置关键词（署名行）视为噪声', () => {
    expect(shouldFilterNoise('新番表 by Hazx')).toBe(true)
    expect(shouldFilterNoise('这里是（示例）')).toBe(true)
  })

  it('普通文本不视为噪声', () => {
    expect(shouldFilterNoise('原作')).toBe(false)
  })

  it('命中设置页自定义关键词（子串匹配）视为噪声', () => {
    store.set(CONFIG_KEYS.ENRICH_FILTER_KEYWORDS, '宣传语,STAFF')
    expect(shouldFilterNoise('这里是宣传语')).toBe(true)
    expect(shouldFilterNoise('STAFF 名单')).toBe(true)
    expect(shouldFilterNoise('原作')).toBe(false)
  })

  it('自定义关键词支持换行分隔，且空项被丢弃', () => {
    store.set(CONFIG_KEYS.ENRICH_FILTER_KEYWORDS, '宣传语\n\n  \nSTAFF')
    expect(shouldFilterNoise('宣传语')).toBe(true)
    expect(shouldFilterNoise('原作')).toBe(false)
  })

  it('resetNoiseKeywordCache 后重读配置（缓存不会粘住旧值）', () => {
    store.set(CONFIG_KEYS.ENRICH_FILTER_KEYWORDS, '宣传语')
    expect(shouldFilterNoise('宣传语')).toBe(true)

    store.set(CONFIG_KEYS.ENRICH_FILTER_KEYWORDS, '别的词')
    resetNoiseKeywordCache()
    expect(shouldFilterNoise('宣传语')).toBe(false)
    expect(shouldFilterNoise('别的词')).toBe(true)
  })

  it('getConfig 抛错时降级为「无自定义关键词」，不抛给调用方', () => {
    ;(getConfig as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    expect(shouldFilterNoise('原作')).toBe(false)
    expect(shouldFilterNoise('')).toBe(true)
  })
})
