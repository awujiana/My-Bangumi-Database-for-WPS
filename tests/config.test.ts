import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock 依赖：完全隔离 tools/config.ts，避免加载 util/index 等 barrel 的副作用链。
// config.ts 仅用到本模块真实使用的 3 个外部符号：getApp / bgmLog（来自 util/index）
// 以及 eventBus / BGM_EVENTS（来自 events）。
vi.mock('../ts/tools/util/index.js', () => ({
  getApp: vi.fn(),
  bgmLog: vi.fn(),
}))

vi.mock('../ts/tools/events.js', () => ({
  eventBus: { emit: vi.fn() },
  BGM_EVENTS: { CONFIG_UPDATED: 'config:updated' },
}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { WARN: 'warn', INFO: 'info', ERROR: 'error' },
}))

import {
  setConfig,
  getConfig,
  removeConfig,
  setIncrementalSync,
  isIncrementalSyncEnabled,
  setSkipConflicts,
  isSkipConflictsEnabled,
  setSyncRecordEnabled,
  isSyncRecordEnabled,
  setNavIconsOnly,
  areNavIconsOnly,
  setTheme,
  getTheme,
  setListType,
  getListType,
  setTimeFilter,
  getTimeFilter,
  setRefreshInterval,
  getRefreshInterval,
  setExportPath,
  getExportPath,
  setImportPath,
  getImportPath,
  CONFIG_KEYS,
} from '../ts/tools/config.js'
import { getApp } from '../ts/tools/util/index.js'
import { eventBus } from '../ts/tools/events.js'

// 受控的 PluginStorage 实现，基于 Map 便于断言读写。
function createFakeStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

describe('tools/config', () => {
  let storage: ReturnType<typeof createFakeStorage>

  beforeEach(() => {
    vi.clearAllMocks()
    storage = createFakeStorage()
    ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({ PluginStorage: storage })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('setConfig', () => {
    it('写入成功时返回 true 并触发事件', () => {
      const isSet = setConfig('bgm_theme', 'dark')
      expect(isSet).toBe(true)
      expect(storage.getItem('bgm_theme')).toBe('dark')
      expect(eventBus.emit).toHaveBeenCalledWith('config:updated', {
        key: 'bgm_theme',
        value: 'dark',
      })
    })

    it('PluginStorage 不可用时返回 false 且不写入', () => {
      // 无 PluginStorage
      ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({})
      const isSet = setConfig('bgm_theme', 'dark')
      expect(isSet).toBe(false)
    })

    it('值未变化时仍写入并返回 true', () => {
      setConfig('k', 'v')
      const isSet = setConfig('k', 'v')
      expect(isSet).toBe(true)
      expect(storage.getItem('k')).toBe('v')
    })

    it('值变化时通过 postMessage 跨文档广播', () => {
      const parent = { postMessage: vi.fn() }
      const top = { postMessage: vi.fn() }
      const selfWindow = { parent, top, postMessage: vi.fn() }
      vi.stubGlobal('window', selfWindow)

      setConfig('broadcast_key', 'value-a')

      expect(parent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'BGM:configUpdated' }),
        '*',
      )
      expect(top.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'BGM:configUpdated' }),
        '*',
      )
      expect(selfWindow.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'BGM:configUpdated' }),
        '*',
      )
    })
  })

  describe('getConfig', () => {
    it('返回已存储的值', () => {
      storage.setItem('bgm_theme', 'light')
      expect(getConfig('bgm_theme')).toBe('light')
    })

    it('未存储时返回默认值', () => {
      expect(getConfig('bgm_theme', 'dark')).toBe('dark')
    })

    it('PluginStorage 不可用时返回默认值', () => {
      ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({})
      expect(getConfig('bgm_theme', 'dark')).toBe('dark')
    })

    it('isSilent 不影响返回值', () => {
      storage.setItem('k', 'v')
      expect(getConfig('k', '', true)).toBe('v')
    })
  })

  describe('removeConfig', () => {
    it('删除成功返回 true 并触发事件', () => {
      storage.setItem('k', 'v')
      const isRemoved = removeConfig('k')
      expect(isRemoved).toBe(true)
      expect(storage.getItem('k')).toBeNull()
      expect(eventBus.emit).toHaveBeenCalledWith('config:updated', { key: 'k', value: '' })
    })

    it('PluginStorage 不可用时返回 false', () => {
      ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({})
      expect(removeConfig('k')).toBe(false)
    })
  })

  describe('布尔开关（增量同步 / 跳过冲突 / 同步记录 / 仅图标）', () => {
    it('setIncrementalSync 写入 "true"/"false"', () => {
      expect(setIncrementalSync(true)).toBe(true)
      expect(storage.getItem(CONFIG_KEYS.INCREMENTAL_SYNC)).toBe('true')
      expect(setIncrementalSync(false)).toBe(true)
      expect(storage.getItem(CONFIG_KEYS.INCREMENTAL_SYNC)).toBe('false')
    })

    it('isIncrementalSyncEnabled 解析布尔', () => {
      setIncrementalSync(true)
      expect(isIncrementalSyncEnabled(true)).toBe(true)
      setIncrementalSync(false)
      expect(isIncrementalSyncEnabled(true)).toBe(false)
    })

    it('setSkipConflicts / isSkipConflictsEnabled', () => {
      setSkipConflicts(true)
      expect(isSkipConflictsEnabled(true)).toBe(true)
      setSkipConflicts(false)
      expect(isSkipConflictsEnabled(true)).toBe(false)
    })

    it('setSyncRecordEnabled / isSyncRecordEnabled', () => {
      setSyncRecordEnabled(true)
      expect(isSyncRecordEnabled(true)).toBe(true)
      setSyncRecordEnabled(false)
      expect(isSyncRecordEnabled(true)).toBe(false)
    })

    it('setNavIconsOnly / areNavIconsOnly', () => {
      setNavIconsOnly(true)
      expect(areNavIconsOnly(true)).toBe(true)
      setNavIconsOnly(false)
      expect(areNavIconsOnly(true)).toBe(false)
    })
  })

  describe('主题 / 列表类型 / 时间筛选', () => {
    it('setTheme 合法值写入，非法值忽略并返回 false', () => {
      expect(setTheme('light')).toBe(true)
      expect(storage.getItem(CONFIG_KEYS.THEME)).toBe('light')
      expect(setTheme('neon')).toBe(false)
      // 非法值被忽略，原值保持
      expect(storage.getItem(CONFIG_KEYS.THEME)).toBe('light')
    })

    it('getTheme 非法存储值回落 dark', () => {
      storage.setItem(CONFIG_KEYS.THEME, 'bogus')
      expect(getTheme(true)).toBe('dark')
      storage.setItem(CONFIG_KEYS.THEME, 'light')
      expect(getTheme(true)).toBe('light')
    })

    it('setListType / getListType', () => {
      expect(setListType('wish')).toBe(true)
      expect(getListType(true)).toBe('wish')
      expect(setListType('nope')).toBe(false)
    })

    it('setTimeFilter / getTimeFilter', () => {
      expect(setTimeFilter('month')).toBe(true)
      expect(getTimeFilter(true)).toBe('month')
      expect(setTimeFilter('century')).toBe(false)
    })
  })

  describe('刷新间隔（分钟）', () => {
    it('合法范围写入四舍五入后的整数', () => {
      expect(setRefreshInterval(30.7)).toBe(true)
      expect(storage.getItem(CONFIG_KEYS.REFRESH_INTERVAL)).toBe('31')
    })

    it('越界 / 非有限值忽略并返回 false', () => {
      expect(setRefreshInterval(-1)).toBe(false)
      expect(setRefreshInterval(2000)).toBe(false)
      expect(setRefreshInterval(NaN)).toBe(false)
    })

    it('getRefreshInterval 解析整数，非法回落 0', () => {
      storage.setItem(CONFIG_KEYS.REFRESH_INTERVAL, '45')
      expect(getRefreshInterval(true)).toBe(45)
      storage.setItem(CONFIG_KEYS.REFRESH_INTERVAL, 'abc')
      expect(getRefreshInterval(true)).toBe(0)
    })
  })

  describe('默认导出/导入路径', () => {
    it('setExportPath / getExportPath', () => {
      expect(setExportPath('C:/out')).toBe(true)
      expect(getExportPath(true)).toBe('C:/out')
    })

    it('setImportPath / getImportPath', () => {
      expect(setImportPath('C:/in')).toBe(true)
      expect(getImportPath(true)).toBe('C:/in')
    })
  })
})
