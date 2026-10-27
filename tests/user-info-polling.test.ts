// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/user-info-polling.ts`（面板用户信息轮询）单元测试。
 *
 * 依赖形状（决定 mock 策略）：
 *   - `../index.js` **barrel**（13 个符号）→ 单点 mock。工厂里只
 *     `await import('core/constants.js')` 取真实 `LOG_LEVELS`。
 *     **绝不能**换成 `importOriginal()`：barrel 与 `ribbon-service` / `handlers/sync`
 *     互相 re-export，会死锁并让 vitest 静默回退真实现（见 `REF-testing.md`）。
 *   - `./panel-lifecycle.js` → 4 个刷新函数，单点 mock，用来断言「何时触发了刷新」。
 *   - `tools/events.js` → **不 mock**：它是自洽叶子，直接用真实 `eventBus` 的 spy，
 *     从而对**真实** `BGM_EVENTS` 常量断言，而不是对自造字符串断言。
 *
 * 轮询是 `setInterval(pollOnce, 2000)`：用 `vi.useFakeTimers()` + `advanceTimersByTime`
 * 按 tick 精确驱动，`pollOnce` 内部各条「检测到变化」分支才能逐条打到位。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  bgmLog: vi.fn<(level: unknown, message: string) => void>(),
  getApp: vi.fn((): unknown => null),
  loadBgToken: vi.fn((): string | null => null),
  findWorkbookByName: vi.fn<(name: string) => unknown>(() => null),
  getBgmUserId: vi.fn((): string | null => null),
  getBgmUsername: vi.fn((): string | null => null),
  updateTokenStatus: vi.fn(),
  updateUserIdStatus: vi.fn(),
  isSkipConflictsEnabled: vi.fn((): boolean => false),
  isSyncRecordEnabled: vi.fn((): boolean => false),
}))

/** `BGM.cache` 会被真实实现直接赋值，用同一份引用断言；PluginStorage 用可变字典模拟 */
const { bgmStub, storage } = vi.hoisted(() => {
  const store: Record<string, string | null> = {}
  return {
    storage: store,
    bgmStub: {
      cache: { userId: null as string | null, username: null as string | null },
      abortController: { abort: vi.fn() },
      // 工作表锁定态：轮询的工作簿变化处理要读它（锁定态跳过自动检测）
      sheet: {
        lockedIndex: null as number | null,
        lockedName: null as string | null,
        isLocked: false,
        lockedWorkbookName: null as string | null,
      },
    },
  }
})

const lifecycle = vi.hoisted(() => ({
  refreshWorkbooks: vi.fn(),
  refreshSheets: vi.fn(),
  refreshData: vi.fn(),
  autoDetectAndLockSheet: vi.fn(),
}))

vi.mock('../ts/index.js', async () => {
  const constants = await import('../ts/core/constants.js')
  return {
    LOG_LEVELS: constants.LOG_LEVELS,
    bgmLog: m.bgmLog,
    getApp: m.getApp,
    BGM: bgmStub,
    loadBgToken: m.loadBgToken,
    findWorkbookByName: m.findWorkbookByName,
    _getBgmUserId: m.getBgmUserId,
    _getBgmUsername: m.getBgmUsername,
    updateTokenStatus: m.updateTokenStatus,
    updateUserIdStatus: m.updateUserIdStatus,
    isSkipConflictsEnabled: m.isSkipConflictsEnabled,
    isSyncRecordEnabled: m.isSyncRecordEnabled,
  }
})

vi.mock('../ts/panel/panel-lifecycle.js', () => ({
  refreshWorkbooks: lifecycle.refreshWorkbooks,
  refreshSheets: lifecycle.refreshSheets,
  refreshData: lifecycle.refreshData,
  autoDetectAndLockSheet: lifecycle.autoDetectAndLockSheet,
}))

import { LOG_LEVELS } from '../ts/core/constants.js'
import { BGM_EVENTS, eventBus } from '../ts/tools/events.js'
import {
  WORKBOOK_CHANGE_DEBOUNCE_MS,
  restoreUserInfoFromStorage,
  startUserInfoPolling,
} from '../ts/panel/user-info-polling.js'

/** 真实单例上的 spy：每个用例只清调用记录，不 restore（restore 后后续用例就没 spy 了） */
const emitSpy = vi.spyOn(eventBus, 'emit')

// ========== 宿主与 DOM 辅助 ==========

interface HostApp {
  Workbooks: { Count: number }
  ActiveWorkbook: { Name: string | null }
  PluginStorage: { getItem: (key: string) => string | null }
}

/**
 * 装配宿主应用桩。返回**可变引用**：用例可以直接改
 * `app.Workbooks.Count` / `app.ActiveWorkbook.Name` 来模拟用户开/关工作簿、
 * 切活动工作簿，再推一次 tick 观察轮询反应。
 */
function mountApp(options: { workbooks?: number; activeName?: string | null } = {}): HostApp {
  const app: HostApp = {
    Workbooks: { Count: options.workbooks ?? 1 },
    ActiveWorkbook: { Name: options.activeName === undefined ? 'Book1.xlsx' : options.activeName },
    PluginStorage: { getItem: (key: string) => storage[key] ?? null },
  }
  m.getApp.mockReturnValue(app)
  return app
}

/** 宿主存在但完全没有 PluginStorage（旧版 WPS / 受限环境） */
function mountAppWithoutStorage(): void {
  m.getApp.mockReturnValue({
    Workbooks: { Count: 1 },
    ActiveWorkbook: { Name: 'Book1.xlsx' },
  })
}

function mountInput(id: string): HTMLInputElement {
  const input = document.createElement('input')
  input.id = id
  document.body.append(input)
  return input
}

/**
 * 挂载带选项的 select。**必须有同名 option**：与浏览器一致，jsdom 里给
 * `select.value` 赋一个不存在的 option 值会被静默丢弃，用例会得到「看似没生效」的假失败。
 */
function mountSelect(id: string, values: string[] = ['skip', 'excel']): HTMLSelectElement {
  const select = document.createElement('select')
  select.id = id
  for (const value of values) {
    const option = document.createElement('option')
    option.value = value
    select.append(option)
  }
  document.body.append(select)
  return select
}

const POLL_INTERVAL_MS = 2000

/** 推进 `times` 个轮询周期 */
function tick(times = 1): void {
  vi.advanceTimersByTime(POLL_INTERVAL_MS * times)
}

// ========== 日志辅助 ==========

/**
 * 取全部日志消息体。`LOG_LEVELS.INFO` 是**数字**而非字符串，
 * 首参不能用 `expect.any(String)` 匹配，因此统一取第二个参数。
 */
function logMessages(): string[] {
  return m.bgmLog.mock.calls.map((call) => call[1])
}

function hasLog(fragment: string): boolean {
  return logMessages().some((message) => message.includes(fragment))
}

function hasLogAtLevel(level: number, fragment: string): boolean {
  return m.bgmLog.mock.calls.some((call) => call[0] === level && call[1].includes(fragment))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  emitSpy.mockClear()
  document.body.replaceChildren()
  for (const key of Object.keys(storage)) delete storage[key]
  bgmStub.cache.userId = null
  bgmStub.cache.username = null
  // 默认值集中锚定：resetAllMocks 清掉了实现，这里把基线重新压回去
  m.getApp.mockReturnValue(null)
  m.loadBgToken.mockReturnValue(null)
  m.getBgmUserId.mockReturnValue(null)
  m.getBgmUsername.mockReturnValue(null)
  m.isSkipConflictsEnabled.mockReturnValue(false)
  m.isSyncRecordEnabled.mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

// ========== restoreUserInfoFromStorage ==========

describe('restoreUserInfoFromStorage', () => {
  it('无宿主 → 记 INFO 并直接返回', () => {
    restoreUserInfoFromStorage()

    expect(hasLogAtLevel(LOG_LEVELS.INFO, 'PluginStorage 不可用')).toBe(true)
    expect(m.updateUserIdStatus).not.toHaveBeenCalled()
  })

  it('宿主存在但无 PluginStorage → 同样早退', () => {
    mountAppWithoutStorage()

    restoreUserInfoFromStorage()

    expect(hasLog('PluginStorage 不可用')).toBe(true)
    expect(m.updateUserIdStatus).not.toHaveBeenCalled()
  })

  it('userId / username 都在 → 双双回填缓存并刷新状态', () => {
    mountApp()
    storage.bgm_user_id = 'u-42'
    storage.bgm_username = 'momo'

    restoreUserInfoFromStorage()

    expect(bgmStub.cache.userId).toBe('u-42')
    expect(bgmStub.cache.username).toBe('momo')
    expect(hasLog('恢复 userId: u-42')).toBe(true)
    expect(hasLog('恢复 username: momo')).toBe(true)
    expect(m.updateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('只有 userId → 只回填 userId，不覆盖 username', () => {
    mountApp()
    storage.bgm_user_id = 'u-42'
    bgmStub.cache.username = '旧名字'

    restoreUserInfoFromStorage()

    expect(bgmStub.cache.userId).toBe('u-42')
    expect(bgmStub.cache.username).toBe('旧名字')
    expect(hasLog('恢复 username')).toBe(false)
    expect(m.updateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('只有 username → 只回填 username', () => {
    mountApp()
    storage.bgm_username = 'momo'

    restoreUserInfoFromStorage()

    expect(bgmStub.cache.userId).toBeNull()
    expect(bgmStub.cache.username).toBe('momo')
    expect(hasLog('恢复 userId')).toBe(false)
    expect(m.updateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('两个键都为空 → 不写缓存也不刷新状态', () => {
    mountApp()

    restoreUserInfoFromStorage()

    expect(bgmStub.cache.userId).toBeNull()
    expect(bgmStub.cache.username).toBeNull()
    expect(m.updateUserIdStatus).not.toHaveBeenCalled()
    expect(m.bgmLog).not.toHaveBeenCalled()
  })

  it('读取抛错 → 落 WARN 且不向上抛', () => {
    m.getApp.mockReturnValue({
      PluginStorage: {
        getItem: () => {
          throw new Error('PluginStorage 崩了')
        },
      },
    })

    expect(() => {
      restoreUserInfoFromStorage()
    }).not.toThrow()

    expect(hasLogAtLevel(LOG_LEVELS.WARN, '恢复失败: PluginStorage 崩了')).toBe(true)
  })
})

// ========== startUserInfoPolling · 基线 ==========

describe('startUserInfoPolling · 基线', () => {
  it('首轮 tick 只建立基线：不触发刷新、不发事件', () => {
    mountApp()

    startUserInfoPolling()
    tick()

    expect(lifecycle.refreshWorkbooks).not.toHaveBeenCalled()
    expect(lifecycle.refreshSheets).not.toHaveBeenCalled()
    expect(lifecycle.autoDetectAndLockSheet).not.toHaveBeenCalled()
    expect(emitSpy).not.toHaveBeenCalled()
  })

  it('无变化的后续 tick → 不再产生任何日志', () => {
    mountApp()

    startUserInfoPolling()
    tick()
    const logsAfterFirstTick = m.bgmLog.mock.calls.length

    tick(2)

    expect(m.bgmLog.mock.calls.length).toBe(logsAfterFirstTick)
    expect(emitSpy).not.toHaveBeenCalled()
  })

  it('配置读取走「静默」模式（第三参不传日志）', () => {
    mountApp()

    startUserInfoPolling()
    tick()

    expect(m.isSkipConflictsEnabled).toHaveBeenCalledWith(true)
    expect(m.isSyncRecordEnabled).toHaveBeenCalledWith(true)
  })
})

// ========== startUserInfoPolling · 工作簿 ==========

describe('startUserInfoPolling · 工作簿数量与活动工作簿', () => {
  it('工作簿数量变化 → 刷新列表并自动检测锁定表头', () => {
    const app = mountApp({ workbooks: 1 })

    startUserInfoPolling()
    tick()
    app.Workbooks.Count = 2
    tick()
    // 防抖：处理推迟 WORKBOOK_CHANGE_DEBOUNCE_MS。注意 vitest 的
    // advanceTimersByTime 不触发「本轮 tick 执行期间注册」的 timer，
    // 必须再推进一次防抖时长才能看到处理落地。
    vi.advanceTimersByTime(WORKBOOK_CHANGE_DEBOUNCE_MS)

    expect(hasLog('检测到工作簿数量变化: 1 → 2（打开新工作簿或关闭）')).toBe(true)
    expect(lifecycle.refreshWorkbooks).toHaveBeenCalledTimes(1)
    expect(lifecycle.refreshSheets).toHaveBeenCalledWith({ autoSelectActive: true })
    expect(lifecycle.autoDetectAndLockSheet).toHaveBeenCalledTimes(1)
  })

  it('活动工作簿切换 → 同样刷新 + 检测表头', () => {
    const app = mountApp({ activeName: 'Book1.xlsx' })

    startUserInfoPolling()
    tick()
    app.ActiveWorkbook.Name = 'Book2.xlsx'
    tick()
    vi.advanceTimersByTime(WORKBOOK_CHANGE_DEBOUNCE_MS)

    expect(hasLog('检测到活动工作簿切换: Book1.xlsx → Book2.xlsx')).toBe(true)
    expect(lifecycle.refreshWorkbooks).toHaveBeenCalledTimes(1)
    expect(lifecycle.refreshSheets).toHaveBeenCalledWith({ autoSelectActive: true })
    expect(lifecycle.autoDetectAndLockSheet).toHaveBeenCalledTimes(1)
  })

  it('已锁定且目标簿还在 → 不 force（autoDetectAndLockSheet 内部短路）', () => {
    const app = mountApp({ workbooks: 1 })
    bgmStub.sheet.isLocked = true
    bgmStub.sheet.lockedName = '番剧'
    bgmStub.sheet.lockedWorkbookName = 'BGM.xlsx'
    m.findWorkbookByName.mockReturnValue({ Name: 'BGM.xlsx' })

    startUserInfoPolling()
    tick()
    app.Workbooks.Count = 2
    tick()
    vi.advanceTimersByTime(WORKBOOK_CHANGE_DEBOUNCE_MS)

    // 列表照刷（新簿要进下拉），但不 force：锁定态由被调方内部短路
    expect(lifecycle.refreshWorkbooks).toHaveBeenCalledTimes(1)
    expect(lifecycle.autoDetectAndLockSheet).toHaveBeenCalledTimes(1)
    expect(lifecycle.autoDetectAndLockSheet).toHaveBeenCalledWith({})
  })

  it('锁定目标正是被关掉的簿 → 传 force 重检测（否则同步指向已消失的表）', () => {
    const app = mountApp({ workbooks: 1 })
    bgmStub.sheet.isLocked = true
    bgmStub.sheet.lockedName = '番剧'
    bgmStub.sheet.lockedWorkbookName = 'BGM.xlsx'
    // findWorkbookByName 默认返回 null = 目标簿已关

    startUserInfoPolling()
    tick()
    app.Workbooks.Count = 0
    tick()
    vi.advanceTimersByTime(WORKBOOK_CHANGE_DEBOUNCE_MS)

    expect(lifecycle.autoDetectAndLockSheet).toHaveBeenCalledWith({ force: true })
    expect(hasLog('锁定的工作簿「BGM.xlsx」已关闭，强制重新检测')).toBe(true)
  })

  it('活动工作簿变为「无」→ 日志右侧落空串而非 undefined', () => {
    const app = mountApp({ activeName: 'Book1.xlsx' })

    startUserInfoPolling()
    tick()
    app.ActiveWorkbook.Name = null
    tick()

    expect(hasLog('检测到活动工作簿切换: Book1.xlsx → ')).toBe(true)
    expect(hasLog('undefined')).toBe(false)
  })

  it('宿主完全不可用 → 以 0 / null 兜底，不抛错也不刷新', () => {
    expect(() => {
      startUserInfoPolling()
      tick(3)
    }).not.toThrow()

    expect(lifecycle.refreshWorkbooks).not.toHaveBeenCalled()
    expect(emitSpy).not.toHaveBeenCalled()
  })
})

// ========== startUserInfoPolling · 用户信息与 Token ==========

describe('startUserInfoPolling · 用户信息与 Token', () => {
  it('userId 变更 → 回填缓存并刷新状态', () => {
    mountApp()
    m.getBgmUserId.mockReturnValue('u-new')

    startUserInfoPolling()
    tick()

    expect(hasLog('检测到用户信息变更: userId=u-new, username=(无)')).toBe(true)
    expect(bgmStub.cache.userId).toBe('u-new')
    expect(m.updateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('username 变更 → 回填缓存并刷新状态', () => {
    mountApp()
    m.getBgmUsername.mockReturnValue('momo')

    startUserInfoPolling()
    tick()

    expect(hasLog('检测到用户信息变更: userId=(无), username=momo')).toBe(true)
    expect(bgmStub.cache.username).toBe('momo')
    expect(m.updateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('用户信息被清空 → 只更新基线，不用空值覆盖缓存', () => {
    mountApp()
    bgmStub.cache.userId = 'u-old'
    bgmStub.cache.username = 'old-name'
    m.getBgmUserId.mockReturnValue('')
    m.getBgmUsername.mockReturnValue('')

    startUserInfoPolling()
    tick()

    expect(hasLog('检测到用户信息变更: userId=(无), username=(无)')).toBe(true)
    // `if (currentUserId)` 为假：缓存保持旧值，UI 刷新交给 updateUserIdStatus 自己兜底
    expect(bgmStub.cache.userId).toBe('u-old')
    expect(bgmStub.cache.username).toBe('old-name')
    expect(m.updateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('Token 由空变有 → 刷新 Token 与用户状态', () => {
    mountApp()

    startUserInfoPolling()
    tick()
    // 基线建立后再注入：startUserInfoPolling 会在启动瞬间快照一次 loadBgToken()
    m.loadBgToken.mockReturnValue('tok-1')
    tick()

    expect(hasLog('检测到 Token 变更: 已设置')).toBe(true)
    expect(m.updateTokenStatus).toHaveBeenCalledTimes(1)
    expect(m.updateUserIdStatus).toHaveBeenCalledTimes(1)
    expect(bgmStub.cache.userId).toBeNull()
  })

  it('Token 被清除 → 同时清空用户信息缓存', () => {
    mountApp()
    m.loadBgToken.mockReturnValue('tok-1')
    bgmStub.cache.userId = 'u-1'
    bgmStub.cache.username = 'momo'

    startUserInfoPolling()
    tick()
    m.loadBgToken.mockReturnValue('')
    bgmStub.cache.userId = 'u-1'
    bgmStub.cache.username = 'momo'
    tick()

    expect(hasLog('检测到 Token 变更: 已清除')).toBe(true)
    expect(bgmStub.cache.userId).toBeNull()
    expect(bgmStub.cache.username).toBeNull()
    expect(m.updateTokenStatus).toHaveBeenCalledTimes(1)
  })
})

// ========== startUserInfoPolling · 配置同步 ==========

describe('startUserInfoPolling · Ribbon 配置同步', () => {
  // 「增量同步复选框同步」用例已随死分支删除：panel.html 的「仅同步变更」
  // 复选框已收拢到「设置」页（panel.html 说明文案），主面板没有
  // #chkIncremental，user-info-polling 里的同步分支是空转死代码。
  it('跳过冲突变更 + select 存在 → 同步下拉值', () => {
    mountApp()
    m.isSkipConflictsEnabled.mockReturnValue(true)
    const select = mountSelect('conflictStrategy')

    startUserInfoPolling()
    tick()

    expect(hasLog('检测到跳过冲突配置变更: 跳过')).toBe(true)
    expect(select.value).toBe('skip')
    expect(hasLog('冲突策略 select 已同步: skip')).toBe(true)
  })

  it('跳过冲突关闭 + select 存在 → 同步为 excel', () => {
    mountApp()
    const select = mountSelect('conflictStrategy')
    select.value = 'skip'

    startUserInfoPolling()
    tick()

    expect(select.value).toBe('excel')
    expect(hasLog('检测到跳过冲突配置变更: Excel覆盖')).toBe(true)
  })

  it('跳过冲突变更 + select 不存在 → 静默跳过', () => {
    mountApp()
    m.isSkipConflictsEnabled.mockReturnValue(true)

    expect(() => {
      startUserInfoPolling()
      tick()
    }).not.toThrow()

    expect(hasLog('冲突策略 select 已同步')).toBe(false)
  })

  it('同步记录开关变更 + 复选框存在 → 同步勾选状态', () => {
    mountApp()
    m.isSyncRecordEnabled.mockReturnValue(true)
    const checkbox = mountInput('chkEnableSyncRecord')

    startUserInfoPolling()
    tick()

    expect(hasLog('检测到同步记录开关变更: 开启')).toBe(true)
    expect(checkbox.checked).toBe(true)
    expect(hasLog('启用同步记录 checkbox 已同步: 开启')).toBe(true)
  })

  it('同步记录保持关闭 + 复选框存在 → 同步为未勾选', () => {
    mountApp()
    const checkbox = mountInput('chkEnableSyncRecord')
    checkbox.checked = true

    startUserInfoPolling()
    tick()

    expect(hasLog('检测到同步记录开关变更: 关闭')).toBe(true)
    expect(checkbox.checked).toBe(false)
    expect(hasLog('启用同步记录 checkbox 已同步: 关闭')).toBe(true)
  })

  it('同步记录开关变更 + 复选框不存在 → 静默跳过', () => {
    mountApp()
    m.isSyncRecordEnabled.mockReturnValue(true)

    expect(() => {
      startUserInfoPolling()
      tick()
    }).not.toThrow()

    expect(hasLog('启用同步记录 checkbox 已同步')).toBe(false)
  })
})

// ========== startUserInfoPolling · 跨上下文信号 ==========

describe('startUserInfoPolling · Ribbon 跨上下文信号', () => {
  it('面板显示信号 → 刷新工作簿 / 工作表 / 数据预览', () => {
    mountApp()

    startUserInfoPolling()
    tick()
    storage.bgm_panel_shown_at = '1710000000000'
    tick()

    expect(hasLog('检测到面板显示信号: 1710000000000')).toBe(true)
    expect(lifecycle.refreshWorkbooks).toHaveBeenCalledTimes(1)
    expect(lifecycle.refreshSheets).toHaveBeenCalledWith({ autoSelectActive: true })
    expect(lifecycle.refreshData).toHaveBeenCalledTimes(1)
  })

  it('数据同步请求信号 → 通过内部 eventBus 触发 handler', () => {
    mountApp()

    startUserInfoPolling()
    tick()
    storage.bgm_request_github_sync = 'ts-1'
    tick()

    expect(hasLog('检测到数据同步请求信号: ts-1')).toBe(true)
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.REQUEST_GITHUB_SYNC, undefined)
  })

  it('撤销同步请求信号 → 通过内部 eventBus 触发 handler', () => {
    mountApp()

    startUserInfoPolling()
    tick()
    storage.bgm_request_undo_sync = 'ts-2'
    tick()

    expect(hasLog('检测到撤销同步请求信号: ts-2')).toBe(true)
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.REQUEST_UNDO_LAST_SYNC, undefined)
  })

  it('信号为空 → 不发任何事件', () => {
    mountApp()

    startUserInfoPolling()
    tick(3)

    expect(emitSpy).not.toHaveBeenCalled()
  })

  it('信号值未变 → 只触发一次（时间戳去重）', () => {
    mountApp()

    startUserInfoPolling()
    tick()
    storage.bgm_request_github_sync = 'ts-1'
    tick(3)

    expect(emitSpy).toHaveBeenCalledTimes(1)
  })
})

// ========== startUserInfoPolling · 容错与清理 ==========

describe('startUserInfoPolling · 容错与清理', () => {
  it('轮询体内抛错 → 被 setInterval 回调静默吞掉，不冒泡', () => {
    mountApp()

    startUserInfoPolling()
    tick()
    m.getApp.mockImplementation(() => {
      throw new Error('COM 已卸载')
    })

    expect(() => {
      tick(3)
    }).not.toThrow()
  })

  it('beforeunload → 清定时器并中止挂起的 HTTP 请求', () => {
    mountApp()
    const addSpy = vi.spyOn(window, 'addEventListener')

    startUserInfoPolling()
    tick()

    // 只调用**本次**注册的那个 handler：window 上的 beforeunload 监听器
    // 会跨用例累积（每次 startUserInfoPolling 都注册一个且不摘除），
    // 直接 window.dispatchEvent 会把历史上所有用例的 handler 一起打中。
    const beforeUnload = addSpy.mock.calls.find((call) => call[0] === 'beforeunload')?.[1]
    expect(typeof beforeUnload).toBe('function')
    if (typeof beforeUnload !== 'function') throw new Error('未注册 beforeunload 监听器')
    beforeUnload(new Event('beforeunload'))

    m.bgmLog.mockClear()
    tick(3)

    expect(bgmStub.abortController.abort).toHaveBeenCalledTimes(1)
    // 定时器已清：后续时间推进不再进入 pollOnce
    expect(m.bgmLog).not.toHaveBeenCalled()
  })
})
