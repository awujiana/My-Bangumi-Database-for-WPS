import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖：仅隔离 tools/config.js。enrich-page-state.ts 对 sync/enrich-engine.js 的
// 引用是 `import type`（运行期被 esbuild 抹除），无需 mock，避免加载 3787 行 enrich-page 的副作用链。
vi.mock('../ts/tools/config.js', () => ({
  getConfig: vi.fn(),
  CONFIG_KEYS: {
    ENRICH_EP_SINGLE: 'bgm_enrich_ep_single',
    ENRICH_EP_FULL: 'bgm_enrich_ep_full',
    ENRICH_TAGS_COLOR: 'bgm_enrich_tags_color',
    ENRICH_PREMIERE_COLOR: 'bgm_enrich_premiere_color',
    ENRICH_PLATFORM_COLOR: 'bgm_enrich_platform_color',
    ENRICH_AUTO_CLEAN: 'bgm_enrich_auto_clean',
  },
}))

import { getConfig, CONFIG_KEYS } from '../ts/tools/config.js'
import {
  getEnrichPreviewConfig,
  resetEnrichPreviewConfig,
  COLUMN_MAPPING_FIELDS,
  DEFAULT_ENRICH_PREVIEW_CONFIG,
} from '../ts/panel/enrich-page-state.js'

// 受控配置存储，按 key 读取；未设置时回退 getConfig 的 defaultValue（与原实现一致）。
const store = new Map<string, string>()

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  resetEnrichPreviewConfig()
  ;(getConfig as ReturnType<typeof vi.fn>).mockImplementation(
    (key: string, defaultValue = ''): string => store.get(key) ?? defaultValue,
  )
})

describe('enrich-page-state', () => {
  describe('getEnrichPreviewConfig 默认值与懒加载', () => {
    it('无存储时返回完整默认值', () => {
      const config = getEnrichPreviewConfig()
      expect(config).toEqual({
        epSingle: 1,
        epFull: 12,
        tagsColor: true,
        premiereColor: true,
        platformColor: true,
        autoCleanDuplicates: true,
      })
    })

    it('第二次调用返回缓存对象（同一引用，不重读存储）', () => {
      const first = getEnrichPreviewConfig()
      // 变更存储后再次读取，应命中缓存而非重新解析
      store.set(CONFIG_KEYS.ENRICH_EP_SINGLE, '9')
      const second = getEnrichPreviewConfig()
      expect(second).toBe(first)
      expect(second.epSingle).toBe(1)
    })
  })

  describe('阈值解析（epSingle / epFull）', () => {
    it('正整数覆盖默认阈值', () => {
      store.set(CONFIG_KEYS.ENRICH_EP_SINGLE, '5')
      store.set(CONFIG_KEYS.ENRICH_EP_FULL, '24')
      const config = getEnrichPreviewConfig()
      expect(config.epSingle).toBe(5)
      expect(config.epFull).toBe(24)
    })

    it('小数按 Math.trunc 取整', () => {
      store.set(CONFIG_KEYS.ENRICH_EP_SINGLE, '5.9')
      store.set(CONFIG_KEYS.ENRICH_EP_FULL, '12.4')
      const config = getEnrichPreviewConfig()
      expect(config.epSingle).toBe(5)
      expect(config.epFull).toBe(12)
    })

    it('非正数 / 非有限值回落默认阈值', () => {
      store.set(CONFIG_KEYS.ENRICH_EP_SINGLE, '-3')
      store.set(CONFIG_KEYS.ENRICH_EP_FULL, 'abc')
      const config = getEnrichPreviewConfig()
      expect(config.epSingle).toBe(DEFAULT_ENRICH_PREVIEW_CONFIG.epSingle)
      expect(config.epFull).toBe(DEFAULT_ENRICH_PREVIEW_CONFIG.epFull)
    })

    it('"0" 视为无效阈值，回落默认', () => {
      store.set(CONFIG_KEYS.ENRICH_EP_SINGLE, '0')
      expect(getEnrichPreviewConfig().epSingle).toBe(DEFAULT_ENRICH_PREVIEW_CONFIG.epSingle)
    })
  })

  describe('布尔开关（tagsColor / premiereColor / platformColor / autoCleanDuplicates）', () => {
    it('显式 "false" 关闭对应开关', () => {
      store.set(CONFIG_KEYS.ENRICH_TAGS_COLOR, 'false')
      store.set(CONFIG_KEYS.ENRICH_PREMIERE_COLOR, 'false')
      store.set(CONFIG_KEYS.ENRICH_PLATFORM_COLOR, 'false')
      store.set(CONFIG_KEYS.ENRICH_AUTO_CLEAN, 'false')
      const config = getEnrichPreviewConfig()
      expect(config.tagsColor).toBe(false)
      expect(config.premiereColor).toBe(false)
      expect(config.platformColor).toBe(false)
      expect(config.autoCleanDuplicates).toBe(false)
    })

    it('显式 "true" 或空值均视为开启（默认开）', () => {
      store.set(CONFIG_KEYS.ENRICH_TAGS_COLOR, 'true')
      // premiereColor / platformColor / autoCleanDuplicates 未设置 → 回退默认值 "true"
      const config = getEnrichPreviewConfig()
      expect(config.tagsColor).toBe(true)
      expect(config.premiereColor).toBe(true)
      expect(config.platformColor).toBe(true)
      expect(config.autoCleanDuplicates).toBe(true)
    })

    it('存储读取抛异常时四个开关按「失败开放」处理（默认开启）', () => {
      // 存储异常不能把功能误关掉：isToggleEnabled 的 catch 显式返回 true。
      // 阈值读取各有自己的 catch，同样回落默认，因此整份配置等于出厂默认。
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('PluginStorage 读取失败')
      })

      expect(getEnrichPreviewConfig()).toEqual({
        epSingle: 1,
        epFull: 12,
        tagsColor: true,
        premiereColor: true,
        platformColor: true,
        autoCleanDuplicates: true,
      })
    })
  })

  describe('resetEnrichPreviewConfig 清缓存', () => {
    it('清缓存后重读存储中的新值', () => {
      const before = getEnrichPreviewConfig()
      store.set(CONFIG_KEYS.ENRICH_EP_FULL, '36')
      resetEnrichPreviewConfig()
      const after = getEnrichPreviewConfig()
      expect(after).not.toBe(before)
      expect(after.epFull).toBe(36)
    })
  })

  describe('COLUMN_MAPPING_FIELDS 形状', () => {
    it('为 8 个字段的数组，首字段为必填 nameColumn，且不含 platformExtraCols', () => {
      expect(Array.isArray(COLUMN_MAPPING_FIELDS)).toBe(true)
      expect(COLUMN_MAPPING_FIELDS).toHaveLength(8)
      const first = COLUMN_MAPPING_FIELDS[0]
      expect(first?.key).toBe('nameColumn')
      expect(first?.required).toBe(true)
      const keys = COLUMN_MAPPING_FIELDS.map((f) => f.key)
      expect(keys).not.toContain('platformExtraCols')
      for (const f of COLUMN_MAPPING_FIELDS) {
        expect(typeof f.key).toBe('string')
        expect(typeof f.label).toBe('string')
        expect(typeof f.required).toBe('boolean')
      }
    })
  })

  describe('DEFAULT_ENRICH_PREVIEW_CONFIG 常量', () => {
    it('提供所有字段的出厂默认', () => {
      expect(DEFAULT_ENRICH_PREVIEW_CONFIG).toEqual({
        epSingle: 1,
        epFull: 12,
        tagsColor: true,
        premiereColor: true,
        platformColor: true,
        autoCleanDuplicates: true,
      })
    })
  })
})
