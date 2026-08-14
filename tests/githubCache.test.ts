// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockBgmLog = vi.hoisted(() => vi.fn())

vi.mock('../ts/tools/util.js', () => ({
  bgmLog: mockBgmLog,
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}))

import {
  computeTextHash,
  loadCache,
  saveCache,
  clearCache,
  isCacheValid,
  buildCache,
  getCacheAge,
} from '../ts/sync/githubCache.js'

describe('computeTextHash', () => {
  it('相同字符串应产生相同哈希', () => {
    expect(computeTextHash('hello')).toBe(computeTextHash('hello'))
  })

  it('不同字符串应产生不同哈希', () => {
    expect(computeTextHash('hello')).not.toBe(computeTextHash('world'))
  })

  it('应返回 8 位十六进制字符串', () => {
    const hash = computeTextHash('test')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('空字符串应产生有效哈希', () => {
    const hash = computeTextHash('')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('长字符串应产生稳定哈希', () => {
    const longStr = 'x'.repeat(10000)
    const hash = computeTextHash(longStr)
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('Cache 操作', () => {
  const testUrl = 'https://example.com/data.jsonl'
  const testEntries = [
    { sid: '123', name: 'Test' },
    { sid: '456', name: 'Test 2' },
  ]

  beforeEach(() => {
    clearCache()
  })

  describe('buildCache', () => {
    it('应构建缓存对象', () => {
      const rawText = '{"sid":"123"}\n{"sid":"456"}'
      const cache = buildCache(testEntries, rawText, testUrl)
      expect(cache.entries).toEqual(testEntries)
      expect(cache.url).toBe(testUrl)
      expect(cache.hash).toBeDefined()
      expect(cache.textLength).toBe(rawText.length)
      expect(cache.fetchedAt).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('saveCache / loadCache', () => {
    it('应保存和加载缓存', () => {
      const cache = buildCache(testEntries, 'test text', testUrl)
      saveCache(cache)
      const loaded = loadCache(testUrl)
      expect(loaded).not.toBeNull()
      expect(loaded?.entries).toEqual(testEntries)
      expect(loaded?.url).toBe(testUrl)
      expect(loaded?.hash).toBe(cache.hash)
    })

    it('URL 不匹配时应返回 null', () => {
      const cache = buildCache(testEntries, 'test', testUrl)
      saveCache(cache)
      const loaded = loadCache('https://other-url.com/data.jsonl')
      expect(loaded).toBeNull()
    })

    it('缓存结构不完整时应返回 null', () => {
      localStorage.setItem(
        'bgm_github_data_cache',
        JSON.stringify({
          entries: 'not-an-array',
        }),
      )
      const loaded = loadCache(testUrl)
      expect(loaded).toBeNull()
    })

    it('JSON 解析失败时应返回 null', () => {
      localStorage.setItem('bgm_github_data_cache', 'not-valid-json')
      const loaded = loadCache(testUrl)
      expect(loaded).toBeNull()
    })
  })

  describe('clearCache', () => {
    it('应清除缓存', () => {
      const cache = buildCache(testEntries, 'test', testUrl)
      saveCache(cache)
      clearCache()
      const loaded = loadCache(testUrl)
      expect(loaded).toBeNull()
    })
  })

  describe('isCacheValid', () => {
    it('24 小时内的缓存应有效', () => {
      const cache = buildCache([], 'test', testUrl)
      expect(isCacheValid(cache)).toBe(true)
    })

    it('超过 24 小时的缓存应无效', () => {
      const cache = buildCache([], 'test', testUrl)
      cache.fetchedAt = Date.now() - 25 * 60 * 60 * 1000
      expect(isCacheValid(cache)).toBe(false)
    })
  })

  describe('getCacheAge', () => {
    it('1 分钟内应返回"刚刚"', () => {
      const cache = buildCache([], 'test', testUrl)
      cache.fetchedAt = Date.now() - 30 * 1000
      expect(getCacheAge(cache)).toBe('刚刚')
    })

    it('1 小时内应返回分钟', () => {
      const cache = buildCache([], 'test', testUrl)
      cache.fetchedAt = Date.now() - 5 * 60 * 1000
      expect(getCacheAge(cache)).toContain('分钟前')
    })

    it('1 天内应返回小时', () => {
      const cache = buildCache([], 'test', testUrl)
      cache.fetchedAt = Date.now() - 3 * 60 * 60 * 1000
      expect(getCacheAge(cache)).toContain('小时前')
    })

    it('超过 1 天应返回天', () => {
      const cache = buildCache([], 'test', testUrl)
      cache.fetchedAt = Date.now() - 2 * 24 * 60 * 60 * 1000
      expect(getCacheAge(cache)).toContain('天前')
    })
  })

  // ========== 补充测试：saveCache catch 分支 (lines 116-117) ==========
  describe('saveCache catch 分支 (lines 116-117)', () => {
    it('JSON.stringify 抛异常时应记录 WARN 日志', () => {
      mockBgmLog.mockClear()
      const circular: Record<string, unknown> = {}
      circular.self = circular
      const cache = buildCache(testEntries, 'test', testUrl)
      const badCache = { ...cache, entries: circular as unknown as typeof testEntries }
      saveCache(badCache)
      expect(mockBgmLog).toHaveBeenCalledWith('WARN', expect.stringContaining('缓存保存失败'))
    })

    it('捕获非 Error 实例异常时应使用 String(e) 格式化 (line 116)', () => {
      mockBgmLog.mockClear()
      const origStringify = JSON.stringify
      vi.spyOn(JSON, 'stringify').mockImplementation(() => {
        throw '一个字符串异常，不是 Error 实例'
      })
      try {
        const cache = buildCache(testEntries, 'test', testUrl)
        saveCache(cache)
        expect(mockBgmLog).toHaveBeenCalledWith('WARN', expect.stringContaining('一个字符串异常'))
      } finally {
        vi.restoreAllMocks()
      }
    })
  })
})
