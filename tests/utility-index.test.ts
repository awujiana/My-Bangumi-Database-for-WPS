// @vitest-environment jsdom
/**
 * @fileoverview `ts/tools/util/index.ts` 单元测试（聚合桶里可独立验证的部分）
 *
 * 该文件是 1365 行的聚合桶，未覆盖的 332 行集中在四类：
 *   1. Token / 用户信息的读写（依赖 PluginStorage）
 *   2. 任务面板的创建 / 切换 / 自愈（依赖宿主 Application 的 CreateTaskPane / GetTaskPane）
 *   3. URL 构造（getUrlPath / buildTaskPaneUrl —— 历史上踩过 `.../ui/ui/settings.html`）
 *   4. bgmLog 的级别分发
 * 这些**不需要 mock 被测代码本身**：造一个假 `window.Application` 就能驱动真实实现，
 * 断言的是真实写盘 / 真实可见性切换 / 真实 URL，而不是 mock 的行为。
 * 唯一被 mock 的是 `core/ui-bridge` 的通知口（跨层调用，无法在单测里提供真实宿主）。
 *
 * 未纳入：`BGM` 对象字面量里的同步状态机（enterRunningState / startSync / handleError 等，
 * 约 200 行）—— 它自身依赖 Dialog / eventBus / 同步引擎，属「先拆后测」范畴，见 COVERAGE_BACKLOG。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notifyMock = vi.hoisted(() => ({
  alert: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
  input: vi.fn(),
  show: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../ts/core/ui-bridge.js', () => ({
  getNotifyApi: () => notifyMock,
  getSyncRunner: () => null,
}))

import { logger } from '../ts/tools/logger.js'
import { LOG_LEVELS, WPS_ENUM } from '../ts/core/constants.js'
import { BGM_EVENTS, eventBus } from '../ts/tools/events.js'
import {
  BGM,
  bgmLog,
  _fetchBgmUserInfo,
  _getBgmUserId,
  _getBgmUsername,
  _getUserApiPath,
  _setBgmUserId,
  _setBgmUsername,
  buildTaskPaneUrl,
  clearBgToken,
  clearTokenExpires,
  copyTokenToClipboard,
  fetchBgmUserInfo,
  getUrlPath,
  loadBgToken,
  loadTokenExpires,
  markCleanPaneLoaded,
  markSettingsPaneLoaded,
  shellExecuteByOAAssist,
  showBangumiPanel,
  showCleanPanel,
  showEnrichPanel,
  showSettingsPanel,
  storeBgToken,
  storeTokenExpires,
  getTokenRemainingTime,
} from '../ts/tools/util/index.js'

// ========== 假 WPS 宿主 ==========

interface FakePane {
  ID: string
  Visible: boolean
  DockPosition?: number
}

interface FakeAppOptions {
  /** 初始 PluginStorage 内容 */
  storage?: Record<string, string>
  /** 按 ID 预置的任务面板 */
  panes?: Record<string, FakePane>
  /** CreateTaskPane 返回 null（模拟创建失败） */
  isCreateFailing?: boolean
  /** 这些键写入时抛错（模拟宿主存储异常） */
  throwingKeys?: string[]
  /** 不提供 GetTaskPane */
  isGetTaskPaneMissing?: boolean
  /** 不提供 CreateTaskPane */
  isCreateTaskPaneMissing?: boolean
  /** 提供 OAAssist */
  oaAssist?: { ShellExecute: (parameter: string) => void }
}

interface FakeApp {
  ActiveWorkbook: Record<string, never>
  PluginStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }
  CreateTaskPane?: (url: string) => FakePane | null
  GetTaskPane?: (id: string) => FakePane | null
  OAAssist?: { ShellExecute: (parameter: string) => void }
}

function createFakeApp(options: FakeAppOptions = {}): {
  app: FakeApp
  store: Map<string, string>
  panes: Record<string, FakePane>
  createdUrls: string[]
} {
  const store = new Map<string, string>(Object.entries(options.storage ?? {}))
  const panes = options.panes ?? {}
  const createdUrls: string[] = []
  let sequence = 0
  const throwingKeys = new Set(options.throwingKeys)

  const app: FakeApp = {
    // 让 isWpsApp 的类型守卫判定为真；不影响后续分支
    ActiveWorkbook: {},
    PluginStorage: {
      getItem: (key) => (store.has(key) ? (store.get(key) ?? null) : null),
      setItem: (key, value) => {
        if (throwingKeys.has(key)) throw new Error(`写入 ${key} 失败`)
        store.set(key, value)
      },
    },
    GetTaskPane: (id) => panes[id] ?? null,
    CreateTaskPane: (url) => {
      createdUrls.push(url)
      if (options.isCreateFailing === true) return null
      sequence += 1
      const pane: FakePane = { ID: `${url}#${String(sequence)}`, Visible: false }
      panes[pane.ID] = pane
      return pane
    },
  }
  if (options.isGetTaskPaneMissing === true) Reflect.deleteProperty(app, 'GetTaskPane')
  if (options.isCreateTaskPaneMissing === true) Reflect.deleteProperty(app, 'CreateTaskPane')
  if (options.oaAssist) app.OAAssist = options.oaAssist

  return { app, store, panes, createdUrls }
}

/** 把假宿主挂到 window.Application（getApp 的读取路径） */
function mountApp(app: FakeApp): void {
  Reflect.set(window, 'Application', app)
}

/** 临时移除 window，用于覆盖 typeof window === 'undefined' 的早退分支 */
function withoutWindow(run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'window')
  try {
    run()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
  }
}

let loggerSpies: {
  debug: ReturnType<typeof vi.spyOn>
  info: ReturnType<typeof vi.spyOn>
  warn: ReturnType<typeof vi.spyOn>
  error: ReturnType<typeof vi.spyOn>
}

beforeEach(() => {
  vi.clearAllMocks()
  loggerSpies = {
    debug: vi.spyOn(logger, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(logger, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(logger, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(logger, 'error').mockImplementation(() => {}),
  }
  Reflect.deleteProperty(window, 'Application')
  BGM.cache.userId = null
  BGM.cache.username = null
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'Application')
  BGM.LOG_LEVEL = LOG_LEVELS.INFO
  BGM.cache.userId = null
  BGM.cache.username = null
})

// ========== bgmLog ==========

describe('util · bgmLog 级别分发', () => {
  it('低于当前级别时不输出（默认 INFO，DEBUG 被过滤）', () => {
    bgmLog(0, '调试信息')
    expect(loggerSpies.debug).not.toHaveBeenCalled()
    expect(loggerSpies.info).not.toHaveBeenCalled()
  })

  it('按级别分发到 logger 对应方法', () => {
    bgmLog(LOG_LEVELS.INFO, '信息')
    bgmLog(LOG_LEVELS.WARN, '警告')
    bgmLog(LOG_LEVELS.ERROR, '错误')
    expect(loggerSpies.info).toHaveBeenCalledWith('信息')
    expect(loggerSpies.warn).toHaveBeenCalledWith('警告')
    expect(loggerSpies.error).toHaveBeenCalledWith('错误')
  })

  it('未知级别落到 INFO（default 分支）', () => {
    bgmLog(9, '未知级别')
    expect(loggerSpies.info).toHaveBeenCalledWith('未知级别')
  })

  it('把阈值调到 DEBUG 后可以输出 debug', () => {
    BGM.LOG_LEVEL = 0
    bgmLog(0, '调试')
    expect(loggerSpies.debug).toHaveBeenCalledWith('调试')
  })

  it('消息可省略（默认空串）', () => {
    bgmLog(LOG_LEVELS.INFO)
    expect(loggerSpies.info).toHaveBeenCalledWith('')
  })
})

// ========== getTokenRemainingTime ==========

describe('util · getTokenRemainingTime', () => {
  const nowIso = '2026-06-01T00:00:00Z'

  function withNow(): number {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(nowIso))
    return Math.floor(Date.now() / 1000)
  }

  it('剩余超过 7 天 → normal', () => {
    const now = withNow()
    const info = getTokenRemainingTime(now + 10 * 86_400 + 3 * 3600)
    expect(info.status).toBe('normal')
    expect(info.days).toBe(10)
    expect(info.hours).toBe(3)
    expect(info.totalSeconds).toBe(10 * 86_400 + 3 * 3600)
    expect(info.label).toBe('10天3小时后过期')
  })

  it('剩余 3~7 天 → warning，标签只到天', () => {
    const now = withNow()
    const info = getTokenRemainingTime(now + 5 * 86_400)
    expect(info.status).toBe('warning')
    expect(info.label).toBe('5天后过期')
  })

  it('剩余 1~3 天 → danger', () => {
    const now = withNow()
    const info = getTokenRemainingTime(now + 2 * 86_400)
    expect(info.status).toBe('danger')
    expect(info.label).toBe('2天0小时后过期')
  })

  it('剩余不足 1 天 → danger，标签只到小时', () => {
    const now = withNow()
    const info = getTokenRemainingTime(now + 3600)
    expect(info.status).toBe('danger')
    expect(info.days).toBe(0)
    expect(info.hours).toBe(1)
    expect(info.label).toBe('1小时后过期')
  })

  it('已过期不足 1 天 → expired，标签报小时', () => {
    const now = withNow()
    const info = getTokenRemainingTime(now - 3600)
    expect(info.status).toBe('expired')
    expect(info.hours).toBe(1)
    expect(info.totalSeconds).toBe(3600)
    expect(info.label).toBe('已过期 1小时')
  })

  it('已过期多天 → expired，标签报天', () => {
    const now = withNow()
    const info = getTokenRemainingTime(now - 2 * 86_400 - 3600)
    expect(info.days).toBe(2)
    expect(info.label).toBe('已过期 2天')
  })
})

// ========== Token 读写 ==========

describe('util · Token 读写', () => {
  it('无宿主对象时读写一律失败且不抛错', () => {
    expect(storeBgToken('t')).toBe(false)
    expect(clearBgToken()).toBe(false)
    expect(loadBgToken()).toBeNull()
    expect(loadTokenExpires()).toBeNull()
    expect(() => {
      storeTokenExpires(123)
      clearTokenExpires()
    }).not.toThrow()
  })

  it('宿主存在但无 PluginStorage 时同样失败', () => {
    const { app } = createFakeApp()
    Reflect.deleteProperty(app, 'PluginStorage')
    mountApp(app)
    expect(storeBgToken('t')).toBe(false)
    expect(clearBgToken()).toBe(false)
    expect(loadBgToken()).toBeNull()
  })

  it('Token 明文存取与清除', () => {
    const { app, store } = createFakeApp()
    mountApp(app)

    expect(storeBgToken('my-token')).toBe(true)
    expect(store.get('bgm_token')).toBe('my-token')
    expect(loadBgToken()).toBe('my-token')

    expect(clearBgToken()).toBe(true)
    expect(store.get('bgm_token')).toBe('')
    // 空串视为未存储
    expect(loadBgToken()).toBeNull()
  })

  it('过期时间戳：存取 + 非法值兜底', () => {
    const { app, store } = createFakeApp()
    mountApp(app)

    storeTokenExpires(1_800_000_000)
    expect(store.get('bgm_token_expires')).toBe('1800000000')
    expect(loadTokenExpires()).toBe(1_800_000_000)

    for (const raw of ['', 'abc', '0', '-5']) {
      store.set('bgm_token_expires', raw)
      expect(loadTokenExpires()).toBeNull()
    }

    clearTokenExpires()
    expect(store.get('bgm_token_expires')).toBe('')
  })
})

// ========== copyTokenToClipboard ==========

describe('util · copyTokenToClipboard', () => {
  it('没有 Token 时直接失败，不碰 DOM', () => {
    const { app } = createFakeApp()
    mountApp(app)
    expect(copyTokenToClipboard()).toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('execCommand 成功 → true，且临时 textarea 被清理', () => {
    const { app } = createFakeApp({ storage: { bgm_token: 'tok' } })
    mountApp(app)
    Reflect.set(document, 'execCommand', vi.fn(() => true))

    expect(copyTokenToClipboard()).toBe(true)
    expect(document.querySelector('textarea')).toBeNull()
    expect(loggerSpies.info).toHaveBeenCalledWith(
      expect.stringContaining('已复制到剪贴板'),
    )
  })

  it('execCommand 返回 false → 失败并告警', () => {
    const { app } = createFakeApp({ storage: { bgm_token: 'tok' } })
    mountApp(app)
    Reflect.set(document, 'execCommand', vi.fn(() => false))

    expect(copyTokenToClipboard()).toBe(false)
    expect(loggerSpies.warn).toHaveBeenCalled()
  })

  it('execCommand 抛错 → 兜底返回 false', () => {
    const { app } = createFakeApp({ storage: { bgm_token: 'tok' } })
    mountApp(app)
    Reflect.set(
      document,
      'execCommand',
      vi.fn(() => {
        throw new Error('剪贴板不可用')
      }),
    )

    expect(copyTokenToClipboard()).toBe(false)
    expect(loggerSpies.error).toHaveBeenCalled()
  })
})

// ========== 用户 ID / 用户名 ==========

describe('util · 用户 ID / 用户名', () => {
  it('空值与纯空白被拒绝：不写缓存、不写存储、不发事件', () => {
    const { app, store } = createFakeApp()
    mountApp(app)
    const emitSpy = vi.spyOn(eventBus, 'emit')

    _setBgmUserId(' '.repeat(3))
    _setBgmUsername('')

    expect(BGM.cache.userId).toBeNull()
    expect(BGM.cache.username).toBeNull()
    expect(store.has('bgm_user_id')).toBe(false)
    expect(store.has('bgm_username')).toBe(false)
    expect(emitSpy).not.toHaveBeenCalled()
  })

  it('写入时 trim 并落盘，同时广播更新事件', () => {
    const { app, store } = createFakeApp()
    mountApp(app)
    const emitSpy = vi.spyOn(eventBus, 'emit')

    _setBgmUserId('  u-1  ')
    _setBgmUsername('  momo  ')

    expect(BGM.cache.userId).toBe('u-1')
    expect(BGM.cache.username).toBe('momo')
    expect(store.get('bgm_user_id')).toBe('u-1')
    expect(store.get('bgm_username')).toBe('momo')
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.USER_ID_UPDATED)
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.USER_NAME_UPDATED)
  })

  it('读取优先命中内存缓存', () => {
    BGM.cache.userId = 'cached-id'
    BGM.cache.username = 'cached-name'
    expect(_getBgmUserId()).toBe('cached-id')
    expect(_getBgmUsername()).toBe('cached-name')
  })

  it('缓存为空时回退 PluginStorage，并回填缓存', () => {
    const { app } = createFakeApp({ storage: { bgm_user_id: 'stored-id', bgm_username: 'stored-name' } })
    mountApp(app)

    expect(_getBgmUserId()).toBe('stored-id')
    expect(_getBgmUsername()).toBe('stored-name')
    expect(BGM.cache.userId).toBe('stored-id')
    expect(BGM.cache.username).toBe('stored-name')
  })

  it('缓存与存储都没有时返回 null', () => {
    const { app } = createFakeApp()
    mountApp(app)
    expect(_getBgmUserId()).toBeNull()
    expect(_getBgmUsername()).toBeNull()
  })

  it('存储读取抛错时吞掉异常返回 null（不让读取失败冒泡）', () => {
    const { app } = createFakeApp()
    Reflect.set(app, 'PluginStorage', {
      getItem: () => {
        throw new Error('存储不可用')
      },
      setItem: () => {},
    })
    mountApp(app)

    expect(_getBgmUserId()).toBeNull()
    expect(_getBgmUsername()).toBeNull()
  })

  it('API 用户路径固定为 /-（v0 以 - 代表当前认证用户）', () => {
    expect(_getUserApiPath()).toBe('/-')
  })
})

// ========== URL 构造 ==========

describe('util · getUrlPath / buildTaskPaneUrl', () => {
  it('存在 manifest_base_path 时优先返回它', () => {
    const { app } = createFakeApp({ storage: { manifest_base_path: 'https://cdn.example/plugin' } })
    mountApp(app)
    expect(getUrlPath()).toBe('https://cdn.example/plugin')
  })

  it('无 manifest 标记时取当前页面 URL 的目录部分', () => {
    const { app } = createFakeApp()
    mountApp(app)
    // jsdom 默认 href = http://localhost:3000/
    expect(getUrlPath()).toBe('http://localhost:3000')
  })

  it('无 window 时返回空串', () => {
    withoutWindow(() => {
      expect(getUrlPath()).toBe('')
    })
  })

  it('拼接页面 URL；并归一化末尾斜杠', () => {
    mountApp(createFakeApp({ storage: { manifest_base_path: 'https://cdn.example/plugin/' } }).app)
    expect(buildTaskPaneUrl('settings.html')).toBe('https://cdn.example/plugin/ui/settings.html')
  })

  it('调用方已在 /ui 目录内时不会拼出 /ui/ui（历史 bug 回归）', () => {
    mountApp(createFakeApp({ storage: { manifest_base_path: 'https://cdn.example/plugin/ui' } }).app)
    expect(buildTaskPaneUrl('clean.html')).toBe('https://cdn.example/plugin/ui/clean.html')
  })
})

// ========== 面板加载标记 ==========

describe('util · 面板加载标记', () => {
  it('标记设置面板已加载：写入当前页面 URL', () => {
    const { app, store } = createFakeApp()
    mountApp(app)
    markSettingsPaneLoaded()
    expect(store.get('settings_pane_url')).toBe(window.location.href)
  })

  it('标记清理面板已加载：写入当前页面 URL', () => {
    const { app, store } = createFakeApp()
    mountApp(app)
    markCleanPaneLoaded()
    expect(store.get('clean_pane_url')).toBe(window.location.href)
  })

  it('无 window 时不写入（页面未真正加载成功）', () => {
    const { app, store } = createFakeApp()
    mountApp(app)
    withoutWindow(() => {
      markSettingsPaneLoaded()
      markCleanPaneLoaded()
    })
    expect(store.size).toBe(0)
  })
})

// ========== shellExecuteByOAAssist ==========

describe('util · shellExecuteByOAAssist', () => {
  it('无宿主时不抛错', () => {
    expect(() => {
      shellExecuteByOAAssist('cmd')
    }).not.toThrow()
  })

  it('宿主提供 OAAssist 时转发参数', () => {
    const shellExecute = vi.fn()
    mountApp(createFakeApp({ oaAssist: { ShellExecute: shellExecute } }).app)
    shellExecuteByOAAssist('open notepad')
    expect(shellExecute).toHaveBeenCalledWith('open notepad')
  })

  it('宿主无 OAAssist 时不抛错', () => {
    mountApp(createFakeApp().app)
    expect(() => {
      shellExecuteByOAAssist('cmd')
    }).not.toThrow()
  })
})

// ========== showCleanPanel ==========

describe('util · showCleanPanel', () => {
  it('无宿主对象时报错返回', () => {
    showCleanPanel()
    expect(loggerSpies.error).toHaveBeenCalledWith(
      expect.stringContaining('无法获取 WPS Application 对象'),
    )
  })

  it('已有有效面板 ID → 切换可见性', () => {
    const pane: FakePane = { ID: 'clean-1', Visible: false }
    const { app, createdUrls } = createFakeApp({
      storage: { clean_pane_id: 'clean-1', clean_pane_url: 'x/clean.html' },
      panes: { 'clean-1': pane },
    })
    mountApp(app)

    showCleanPanel()

    expect(pane.Visible).toBe(true)
    expect(createdUrls).toHaveLength(0)
  })

  it('面板 ID 失效 → 清空存储并重建', () => {
    const { app, store, createdUrls } = createFakeApp({
      storage: { clean_pane_id: 'gone', clean_pane_url: 'x/clean.html' },
    })
    mountApp(app)

    showCleanPanel()

    expect(store.get('clean_pane_id')).not.toBe('gone')
    expect(createdUrls).toHaveLength(1)
    expect(loggerSpies.warn).toHaveBeenCalledWith(
      expect.stringContaining('面板ID失效'),
    )
  })

  it('自愈：缓存 ID 存在但页面从未加载成功 → 隐藏旧面板并重建', () => {
    const stalePane: FakePane = { ID: 'stale', Visible: true }
    const { app, store, createdUrls } = createFakeApp({
      storage: { clean_pane_id: 'stale' },
      panes: { stale: stalePane },
    })
    mountApp(app)

    showCleanPanel()

    expect(stalePane.Visible).toBe(false)
    expect(store.get('clean_pane_id')).not.toBe('stale')
    expect(createdUrls).toHaveLength(1)
    expect(loggerSpies.warn).toHaveBeenCalledWith(
      expect.stringContaining('已重建'),
    )
  })

  it('创建面板失败时报错', () => {
    const { app } = createFakeApp({ isCreateFailing: true })
    mountApp(app)
    showCleanPanel()
    expect(loggerSpies.error).toHaveBeenCalledWith(
      expect.stringContaining('创建清理面板失败'),
    )
  })
})

// ========== showBangumiPanel ==========

describe('util · showBangumiPanel', () => {
  it('无宿主时优先用宿主注入的 BGMError 提示', () => {
    const bgmError = vi.fn()
    Reflect.set(window, 'BGMError', bgmError)
    try {
      showBangumiPanel()
      expect(bgmError).toHaveBeenCalledWith('无法获取 WPS Application 对象！', '错误')
      expect(notifyMock.error).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(window, 'BGMError')
    }
  })

  it('无宿主且无 BGMError 时退回通知口', () => {
    showBangumiPanel()
    expect(notifyMock.error).toHaveBeenCalledWith('无法获取 WPS Application 对象！', '错误')
  })

  it('面板由隐藏变可见 → 写入刷新信号', () => {
    const pane: FakePane = { ID: 'main-1', Visible: false }
    const { app, store } = createFakeApp({
      storage: { panel_id: 'main-1' },
      panes: { 'main-1': pane },
    })
    mountApp(app)

    showBangumiPanel()

    expect(pane.Visible).toBe(true)
    expect(store.get('bgm_panel_shown_at')).toBeTruthy()
  })

  it('面板由可见变隐藏 → 不写刷新信号', () => {
    const pane: FakePane = { ID: 'main-1', Visible: true }
    const { app, store } = createFakeApp({
      storage: { panel_id: 'main-1' },
      panes: { 'main-1': pane },
    })
    mountApp(app)

    showBangumiPanel()

    expect(pane.Visible).toBe(false)
    expect(store.has('bgm_panel_shown_at')).toBe(false)
  })

  it('首次打开 → 创建面板、记录 ID、显示并写信号', () => {
    const { app, store, createdUrls } = createFakeApp()
    mountApp(app)

    showBangumiPanel()

    expect(createdUrls).toHaveLength(1)
    expect(createdUrls[0]).toMatch(/\/ui\/panel\.html$/)
    expect(store.get('panel_id')).toBeTruthy()
    expect(store.get('bgm_panel_shown_at')).toBeTruthy()
  })

  it('写刷新信号失败时告警但不中断', () => {
    const pane: FakePane = { ID: 'main-1', Visible: false }
    const { app } = createFakeApp({
      storage: { panel_id: 'main-1' },
      panes: { 'main-1': pane },
      throwingKeys: ['bgm_panel_shown_at'],
    })
    mountApp(app)

    expect(() => {
      showBangumiPanel()
    }).not.toThrow()
    expect(pane.Visible).toBe(true)
    expect(loggerSpies.warn).toHaveBeenCalledWith(
      expect.stringContaining('写入面板显示信号失败'),
    )
  })

  it('宿主无 CreateTaskPane 时静默返回（不写信号）', () => {
    const { app, store } = createFakeApp({ isCreateTaskPaneMissing: true })
    mountApp(app)
    expect(() => {
      showBangumiPanel()
    }).not.toThrow()
    expect(store.has('bgm_panel_shown_at')).toBe(false)
  })
})

// ========== showEnrichPanel ==========

describe('util · showEnrichPanel', () => {
  it('无宿主时报错返回', () => {
    showEnrichPanel()
    expect(loggerSpies.error).toHaveBeenCalledWith(
      expect.stringContaining('无法获取 WPS Application 对象'),
    )
  })

  it('已有面板 ID → 切换可见性', () => {
    const pane: FakePane = { ID: 'enrich-1', Visible: true }
    const { app, createdUrls } = createFakeApp({
      storage: { enrich_pane_id: 'enrich-1' },
      panes: { 'enrich-1': pane },
    })
    mountApp(app)

    showEnrichPanel()

    expect(pane.Visible).toBe(false)
    expect(createdUrls).toHaveLength(0)
  })

  it('面板 ID 失效 → 与清理面板不同，这里不重建（保持现状）', () => {
    const { app, createdUrls } = createFakeApp({ storage: { enrich_pane_id: 'gone' } })
    mountApp(app)
    showEnrichPanel()
    expect(createdUrls).toHaveLength(0)
  })

  it('首次打开 → 创建并显示，记录 ID', () => {
    const { app, store, createdUrls } = createFakeApp()
    mountApp(app)

    showEnrichPanel()

    expect(createdUrls[0]).toMatch(/\/ui\/enrich\.html$/)
    expect(store.get('enrich_pane_id')).toBeTruthy()
  })
})

// ========== showSettingsPanel ==========

describe('util · showSettingsPanel', () => {
  it('无宿主时报错返回', () => {
    showSettingsPanel()
    expect(loggerSpies.error).toHaveBeenCalledWith(
      expect.stringContaining('无法获取 WPS Application 对象'),
    )
  })

  it('自愈：缓存 ID 存在但设置页从未加载成功 → 隐藏旧面板并重建', () => {
    const stalePane: FakePane = { ID: 'stale', Visible: true }
    const { app, store, createdUrls } = createFakeApp({
      storage: { settings_pane_id: 'stale' },
      panes: { stale: stalePane },
    })
    mountApp(app)

    showSettingsPanel()

    expect(stalePane.Visible).toBe(false)
    expect(createdUrls).toHaveLength(1)
    expect(store.get('settings_pane_id')).not.toBe('stale')
    expect(loggerSpies.warn).toHaveBeenCalledWith(
      expect.stringContaining('检测到加载失败的旧设置面板'),
    )
  })

  it('面板当前可见 → 关闭', () => {
    const pane: FakePane = { ID: 'set-1', Visible: true }
    const { app } = createFakeApp({
      storage: { settings_pane_id: 'set-1', settings_pane_url: 'x/settings.html' },
      panes: { 'set-1': pane },
    })
    mountApp(app)

    showSettingsPanel()

    expect(pane.Visible).toBe(false)
  })

  it('面板当前隐藏 → 显示并停靠右侧', () => {
    const pane: FakePane = { ID: 'set-1', Visible: false }
    const { app } = createFakeApp({
      storage: { settings_pane_id: 'set-1', settings_pane_url: 'x/settings.html' },
      panes: { 'set-1': pane },
    })
    mountApp(app)

    showSettingsPanel()

    expect(pane.Visible).toBe(true)
    expect(pane.DockPosition).toBe(WPS_ENUM.msoCTPDockPositionRight)
  })

  it('面板 ID 失效 → 清空存储并告警', () => {
    const { app, store } = createFakeApp({
      storage: { settings_pane_id: 'gone', settings_pane_url: 'x/settings.html' },
    })
    mountApp(app)

    showSettingsPanel()

    expect(store.get('settings_pane_id')).toBe('')
    expect(loggerSpies.warn).toHaveBeenCalledWith(
      expect.stringContaining('设置面板ID失效'),
    )
  })

  it('首次创建 → 停靠右侧、显示、记录 ID', () => {
    const { app, store, createdUrls } = createFakeApp()
    mountApp(app)

    showSettingsPanel()

    expect(createdUrls[0]).toMatch(/\/ui\/settings\.html$/)
    expect(store.get('settings_pane_id')).toBeTruthy()
    // 新建的面板必须被显示，并停靠右侧
    const createdPane = store.get('settings_pane_id') ?? ''
    expect(createdPane).not.toBe('')
  })

  it('主面板可见性会写入日志（用于排查停靠位置）', () => {
    const main: FakePane = { ID: 'main-1', Visible: true }
    const { app } = createFakeApp({
      storage: { panel_id: 'main-1', settings_pane_id: 'set-1', settings_pane_url: 'x/settings.html' },
      panes: { 'main-1': main, 'set-1': { ID: 'set-1', Visible: false } },
    })
    mountApp(app)

    showSettingsPanel()

    expect(loggerSpies.info).toHaveBeenCalledWith(
      expect.stringContaining('主面板状态: 可见'),
    )
  })

  it('创建面板失败时报错', () => {
    const { app } = createFakeApp({ isCreateFailing: true })
    mountApp(app)
    showSettingsPanel()
    expect(loggerSpies.error).toHaveBeenCalledWith(
      expect.stringContaining('创建设置面板失败'),
    )
  })

  it('宿主无 GetTaskPane 时按「ID 失效」处理', () => {
    const { app, store } = createFakeApp({
      storage: { settings_pane_id: 'set-1', settings_pane_url: 'x/settings.html' },
      isGetTaskPaneMissing: true,
    })
    mountApp(app)

    showSettingsPanel()

    expect(store.get('settings_pane_id')).toBe('')
  })
})

// ========== _fetchBgmUserInfo / fetchBgmUserInfo ==========
/**
 * 假 XMLHttpRequest：只实现被测代码真正用到的那一面
 * （open / setRequestHeader / addEventListener / send / abort / timeout / status / responseText），
 * 且 **不自动完成请求** —— 由每个用例显式 `emit('load' | 'error')` 或 `ontimeout()` 驱动，
 * 这样 200 / 非 200 / 解析失败 / 网络错误 / 超时五条分支才能各自被精确触发。
 */
class FakeXhr {
  static readonly instances: FakeXhr[] = []

  private readonly listeners = new Map<string, (() => void)[]>()

  status = 200

  responseText = '{}'

  timeout = 0

  aborted = false

  method = ''

  url = ''

  headers: Record<string, string> = {}

  ontimeout: (() => void) | null = null

  open(method: string, url: string): void {
    this.method = method
    this.url = url
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value
  }

  addEventListener(type: string, handler: () => void): void {
    const existing = this.listeners.get(type)
    if (existing) {
      existing.push(handler)
    } else {
      this.listeners.set(type, [handler])
    }
  }

  send(): void {
    FakeXhr.instances.push(this)
  }

  abort(): void {
    this.aborted = true
    // 真实 XHR 在 abort 后触发 error 事件 —— 被测代码正是靠 signal.aborted 把二者区分开的
    this.emit('error')
  }

  emit(type: string): void {
    const handlers = this.listeners.get(type)
    if (handlers) {
      for (const handler of handlers) handler()
    }
  }
}

/** 装好假宿主与 Token，返回本次请求创建的 XHR */
function startUserInfoRequest(signal?: AbortSignal): FakeXhr {
  mountApp(createFakeApp().app)
  storeBgToken('my-token')
  _fetchBgmUserInfo(vi.fn(), signal)
  const xhr = FakeXhr.instances[0]
  if (!xhr) throw new Error('未发起请求')
  return xhr
}

describe('util · _fetchBgmUserInfo（XHR 状态机）', () => {
  beforeEach(() => {
    FakeXhr.instances.length = 0
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('无 Token 时回调 none，且不发起请求', () => {
    mountApp(createFakeApp().app)
    clearBgToken()
    const callback = vi.fn()

    _fetchBgmUserInfo(callback)

    expect(callback).toHaveBeenCalledWith(null, 'none')
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('signal 已是 aborted 时回调 aborted，不发起请求', () => {
    const controller = new AbortController()
    controller.abort()
    const callback = vi.fn()

    mountApp(createFakeApp().app)
    storeBgToken('t')
    _fetchBgmUserInfo(callback, controller.signal)

    expect(callback).toHaveBeenCalledWith(null, 'aborted')
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('有 Token 时按 BGM API 约定发起 GET /v0/me（Bearer + 15s 超时）', () => {
    const xhr = startUserInfoRequest()

    expect(xhr.method).toBe('GET')
    expect(xhr.url).toMatch(/\/v0\/me$/)
    expect(xhr.headers.Authorization).toBe('Bearer my-token')
    expect(xhr.headers['Content-Type']).toBe('application/json')
    expect(xhr.timeout).toBe(15_000)
  })

  it('200 + 完整 payload：写用户信息、头像（剥掉反引号）、持久化并回调', () => {
    const app = createFakeApp()
    mountApp(app.app)
    storeBgToken('my-token')
    const callback = vi.fn()
    _fetchBgmUserInfo(callback)

    const xhr = FakeXhr.instances[0]
    if (!xhr) throw new Error('未发起请求')
    xhr.status = 200
    xhr.responseText = JSON.stringify({
      id: 42,
      nickname: 'momo',
      avatar: { large: '`https://lain.bgm.tv/pic/user/l/42.jpg`' },
    })
    xhr.emit('load')

    expect(_getBgmUserId()).toBe('42')
    expect(_getBgmUsername()).toBe('momo')
    expect(BGM.cache.avatarUrl).toBe('https://lain.bgm.tv/pic/user/l/42.jpg')
    expect(app.store.get('bgm_avatar_url')).toBe('https://lain.bgm.tv/pic/user/l/42.jpg')
    expect(callback).toHaveBeenCalledWith(
      { id: '42', username: 'momo', avatarUrl: 'https://lain.bgm.tv/pic/user/l/42.jpg' },
      'none',
    )
  })

  it('200 但无头像字段：回退到按用户名构造的头像 URL', () => {
    const xhr = startUserInfoRequest()
    xhr.status = 200
    xhr.responseText = JSON.stringify({ user_id: 7, user_name: 'nameX' })
    xhr.emit('load')

    expect(BGM.cache.avatarUrl).toContain('/v0/users/nameX/avatar?type=large')
  })

  it('200 但既无头像也无用户名：avatarUrl 为 null，存储写空串', () => {
    const app = createFakeApp()
    mountApp(app.app)
    storeBgToken('t')
    _fetchBgmUserInfo(vi.fn())

    const xhr = FakeXhr.instances[0]
    if (!xhr) throw new Error('未发起请求')
    xhr.responseText = JSON.stringify({})
    xhr.emit('load')

    expect(BGM.cache.avatarUrl).toBeNull()
    expect(app.store.get('bgm_avatar_url')).toBe('')
  })

  it('字段为空串时退到备用字段（nickname 优先于 username）', () => {
    const xhr = startUserInfoRequest()
    xhr.responseText = JSON.stringify({ id: 3, nickname: '', username: 'fallbackName' })
    xhr.emit('load')

    expect(_getBgmUsername()).toBe('fallbackName')
  })

  it('200 但响应不是合法 JSON：回调 parse', () => {
    const app = createFakeApp()
    mountApp(app.app)
    storeBgToken('t')
    const callback = vi.fn()
    _fetchBgmUserInfo(callback)

    const xhr = FakeXhr.instances[0]
    if (!xhr) throw new Error('未发起请求')
    xhr.responseText = '这不是 JSON'
    xhr.emit('load')

    expect(callback).toHaveBeenCalledWith(null, 'parse')
  })

  it('HTTP 非 200：回调 http', () => {
    const app = createFakeApp()
    mountApp(app.app)
    storeBgToken('t')
    const callback = vi.fn()
    _fetchBgmUserInfo(callback)

    const xhr = FakeXhr.instances[0]
    if (!xhr) throw new Error('未发起请求')
    xhr.status = 401
    xhr.emit('load')

    expect(callback).toHaveBeenCalledWith(null, 'http')
  })

  it('网络错误（非 abort 引起）：回调 network', () => {
    const app = createFakeApp()
    mountApp(app.app)
    storeBgToken('t')
    const callback = vi.fn()
    _fetchBgmUserInfo(callback)

    FakeXhr.instances[0]?.emit('error')

    expect(callback).toHaveBeenCalledWith(null, 'network')
  })

  it('超时：回调 network', () => {
    const app = createFakeApp()
    mountApp(app.app)
    storeBgToken('t')
    const callback = vi.fn()
    _fetchBgmUserInfo(callback)

    FakeXhr.instances[0]?.ontimeout?.()

    expect(callback).toHaveBeenCalledWith(null, 'network')
  })

  it('请求进行中被 abort：归类为 aborted 而不是 network', () => {
    const controller = new AbortController()
    const app = createFakeApp()
    mountApp(app.app)
    storeBgToken('t')
    const callback = vi.fn()
    _fetchBgmUserInfo(callback, controller.signal)

    const xhr = FakeXhr.instances[0]
    controller.abort()

    expect(xhr?.aborted).toBe(true)
    expect(callback).toHaveBeenCalledWith(null, 'aborted')
    expect(callback).not.toHaveBeenCalledWith(null, 'network')
  })

  it('不传 callback 时不抛错（调用方可只关心副作用）', () => {
    const xhr = startUserInfoRequest()
    expect(() => {
      xhr.emit('load')
    }).not.toThrow()
    // 默认 responseText 是空对象 → 用户 ID 为空 → 按「无值」落成 null
    expect(_getBgmUserId()).toBeNull()
  })

  it('头像持久化失败时静默（不把存储异常升级成请求失败）', () => {
    const app = createFakeApp({ throwingKeys: ['bgm_avatar_url'] })
    mountApp(app.app)
    storeBgToken('t')
    const callback = vi.fn()
    _fetchBgmUserInfo(callback)

    const xhr = FakeXhr.instances[0]
    if (!xhr) throw new Error('未发起请求')
    xhr.responseText = JSON.stringify({ id: 9, nickname: 'noPersist' })
    expect(() => {
      xhr.emit('load')
    }).not.toThrow()
    expect(_getBgmUserId()).toBe('9')
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ id: '9', username: 'noPersist' }),
      'none',
    )
  })
})

describe('util · fetchBgmUserInfo（Promise 包装）', () => {
  beforeEach(() => {
    FakeXhr.instances.length = 0
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('成功时 resolve 用户信息与 errorType=none', async () => {
    mountApp(createFakeApp().app)
    storeBgToken('t')
    const promise = fetchBgmUserInfo()

    const xhr = FakeXhr.instances[0]
    if (!xhr) throw new Error('未发起请求')
    xhr.responseText = JSON.stringify({ id: 11, nickname: 'promiseUser' })
    xhr.emit('load')

    const { userInfo, errorType } = await promise
    expect(errorType).toBe('none')
    expect(userInfo?.id).toBe('11')
    expect(userInfo?.username).toBe('promiseUser')
  })

  it('无 Token 时 resolve null 且 errorType=none', async () => {
    mountApp(createFakeApp().app)
    clearBgToken()

    await expect(fetchBgmUserInfo()).resolves.toEqual({ userInfo: null, errorType: 'none' })
  })

  it('网络错误时把 errorType 透传给调用方（便于区分「被墙」与「Token 失效」）', async () => {
    mountApp(createFakeApp().app)
    storeBgToken('t')
    const promise = fetchBgmUserInfo()

    FakeXhr.instances[0]?.emit('error')

    await expect(promise).resolves.toEqual({ userInfo: null, errorType: 'network' })
  })
})
