// @vitest-environment jsdom
/**
 * @fileoverview `BGM` 全局命名空间（ts/tools/util/index.ts 的 BGM 对象）单测
 *
 * 这个对象是插件对外的统一 API 面，覆盖三块：
 *   1. `BGM.Dialog` 的**降级链**：宿主注入的 `BGMDialog` → 旧版 `BGMAlert/BGMError/BGMInput`
 *      函数 → 自定义通知口。降级链错一环，用户点按钮就「什么都不发生」，且不报错。
 *   2. `handleError` / `safeExecute` 的错误分级（SILENT / WARN / ERROR / THROW / 未知级别）。
 *   3. 同步状态机（`BGM.sync`）：运行标志、暂停/停止标志与事件广播的一致性 ——
 *      这些标志一旦不同步，同步会卡在「显示进行中但实际没跑」的状态。
 *
 * 宿主注入物通过 `window` 上的全局函数提供（与生产一致），无需 mock 被测模块本身。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  // getSyncRunner 返回的是「同步执行体函数」本身，不是 Promise —— 写成 Promise 会与真实接口脱节
  getSyncRunner: vi.fn<() => (() => Promise<void>) | null>(() => null),
  notify: {
    alert: vi.fn<(message: string, title: string) => void>(),
    confirm: vi.fn<
      (message: string, callback: (isConfirmed: boolean) => void, title?: string) => void
    >(),
    error: vi.fn<(message: string, title: string) => void>(),
    input: vi.fn<
      (
        title: string,
        prompt: string,
        defaultValue?: string,
        onOk?: (value: string) => void,
        onCancel?: () => void,
      ) => void
    >(),
    show: vi.fn(),
    toast: vi.fn<(message: string, kind?: string) => void>(),
  },
}))

vi.mock('../ts/core/ui-bridge.js', () => ({
  getNotifyApi: () => mocks.notify,
  getSyncRunner: mocks.getSyncRunner,
}))

import { LOG_LEVELS, ErrorLevel } from '../ts/core/constants.js'
import type { ErrorOptions } from '../ts/core/constants.js'
import { BgmError } from '../ts/core/result.js'
import { logger } from '../ts/tools/logger.js'
import { colNumberToLetter } from '../ts/tools/string-utilities.js'
import { BGM_EVENTS, eventBus } from '../ts/tools/events.js'
import type { WpsWorksheet } from '../ts/tools/wps.js'
import { BGM } from '../ts/tools/util/index.js'

/** 宿主注入的 BGMDialog 替身；签名与生产调用保持一致，避免 mock.calls 退化成 any */
function createFakeDialog() {
  return {
    alert: vi.fn<(title: string, message: string) => void>(),
    error: vi.fn<(title: string, message: string) => void>(),
    input: vi.fn<
      (
        title: string,
        prompt: string,
        defaultValue: string,
        onOk?: (value: string) => void,
        onCancel?: () => void,
      ) => void
    >(),
    show: vi.fn<(type: string, title: string, message: string, options?: { onOk?: () => void }) => void>(),
  }
}

/** 只提供被测代码会用到的 Range/Select 两个成员 */
function createFakeSheet(select: () => void, isRangeThrowing = false): WpsWorksheet {
  return {
    Range: (address: string) => {
      void address
      if (isRangeThrowing) throw new Error('无此单元格')
      return { Select: select }
    },
  } as unknown as WpsWorksheet
}

let loggerSpies: {
  debug: ReturnType<typeof vi.spyOn>
  info: ReturnType<typeof vi.spyOn>
  warn: ReturnType<typeof vi.spyOn>
  error: ReturnType<typeof vi.spyOn>
}

/** 清掉宿主注入的全局函数（每个用例从「无宿主注入」开始） */
function clearHostGlobals(): void {
  for (const key of ['BGMDialog', 'BGMAlert', 'BGMError', 'BGMInput']) {
    Reflect.deleteProperty(window, key)
  }
}

function resetSyncState(): void {
  BGM.sync.isRunning = false
  BGM.sync.shouldStop = false
  BGM.sync.isPaused = false
  BGM.sync.lastSyncTime = null
  BGM.sync.currentRow = 0
  BGM.sync.currentCol = 0
  BGM.sync.currentSheet = null
}

/** 让 startSync 内部 `void (async () => ...)()` 的异步体跑完 */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSyncRunner.mockReturnValue(null)
  loggerSpies = {
    debug: vi.spyOn(logger, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(logger, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(logger, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(logger, 'error').mockImplementation(() => {}),
  }
  clearHostGlobals()
  resetSyncState()
  BGM.LOG_LEVEL = LOG_LEVELS.INFO
  BGM.cache.userId = null
  BGM.cache.username = null
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  clearHostGlobals()
  resetSyncState()
})

// ========== BGM.Dialog 降级链 ==========

describe('BGM.Dialog · alert / error 降级链', () => {
  it('alert：优先用宿主注入的 BGMDialog，且不再走通知口', () => {
    const dialog = createFakeDialog()
    Reflect.set(window, 'BGMDialog', dialog)

    BGM.Dialog.alert('标题', '内容')

    expect(dialog.alert).toHaveBeenCalledWith('标题', '内容')
    expect(mocks.notify.alert).not.toHaveBeenCalled()
  })

  it('alert：无 BGMDialog 时退回旧版 BGMAlert（参数顺序为 message, title）', () => {
    const bgmAlert = vi.fn()
    Reflect.set(window, 'BGMAlert', bgmAlert)

    BGM.Dialog.alert('标题', '内容')

    expect(bgmAlert).toHaveBeenCalledWith('内容', '标题')
    expect(mocks.notify.alert).not.toHaveBeenCalled()
  })

  it('alert：两者都没有时走通知口（参数顺序为 message, title）', () => {
    BGM.Dialog.alert('标题', '内容')
    expect(mocks.notify.alert).toHaveBeenCalledWith('内容', '标题')
  })

  it('error：宿主注入 BGMDialog 时优先', () => {
    const dialog = createFakeDialog()
    Reflect.set(window, 'BGMDialog', dialog)

    BGM.Dialog.error('出错了', '详情')

    expect(dialog.error).toHaveBeenCalledWith('出错了', '详情')
    expect(mocks.notify.error).not.toHaveBeenCalled()
  })

  it('error：退回旧版 BGMError 函数', () => {
    const bgmError = vi.fn()
    Reflect.set(window, 'BGMError', bgmError)

    BGM.Dialog.error('出错了', '详情')

    expect(bgmError).toHaveBeenCalledWith('详情', '出错了')
  })

  it('error：都没有时走通知口', () => {
    BGM.Dialog.error('出错了', '详情')
    expect(mocks.notify.error).toHaveBeenCalledWith('详情', '出错了')
  })
})

describe('BGM.Dialog · input / confirm', () => {
  it('input：宿主 BGMDialog 收到默认值兜底后的 5 个参数', () => {
    const dialog = createFakeDialog()
    Reflect.set(window, 'BGMDialog', dialog)
    const onOk = vi.fn()

    BGM.Dialog.input('标题', '提示', undefined, onOk, undefined)

    expect(dialog.input).toHaveBeenCalledWith('标题', '提示', '', onOk, undefined)
  })

  it('input：退回旧版 BGMInput 函数', () => {
    const bgmInput = vi.fn()
    Reflect.set(window, 'BGMInput', bgmInput)

    BGM.Dialog.input('标题', '提示', '默认')

    expect(bgmInput).toHaveBeenCalledWith('标题', '提示', '默认', undefined, undefined)
  })

  it('input：通知口收到的 onOk 只转发有值的输入（空值不误伤）', () => {
    const onOk = vi.fn()

    BGM.Dialog.input('标题', '提示', '默认', onOk)

    // 通知口的 onOk 参数在类型上不收 undefined；这里刻意越界传入以覆盖防御分支
    const forwarded = mocks.notify.input.mock.calls[0]?.[3] as unknown as
      | ((value?: string) => void)
      | undefined
    expect(typeof forwarded).toBe('function')
    forwarded?.('用户输入')
    expect(onOk).toHaveBeenCalledWith('用户输入')

    forwarded?.(undefined)
    expect(onOk).toHaveBeenCalledTimes(1)
  })

  it('confirm：直接透传通知口（含自定义标题）', () => {
    const callback = vi.fn()
    BGM.Dialog.confirm('确定吗', callback, '确认')
    expect(mocks.notify.confirm).toHaveBeenCalledWith('确定吗', callback, '确认')
  })
})

describe('BGM.Dialog · show 的类型分发', () => {
  it('宿主 BGMDialog 存在时整体透传', () => {
    const dialog = createFakeDialog()
    Reflect.set(window, 'BGMDialog', dialog)

    BGM.Dialog.show('confirm', '标题', '内容', { onOk: vi.fn() })

    expect(dialog.show).toHaveBeenCalledTimes(1)
    expect(dialog.show.mock.calls[0]?.[3]?.onOk).toBeTypeOf('function')
    expect(mocks.notify.confirm).not.toHaveBeenCalled()
  })

  it('type=confirm：确认/取消分别回调对应钩子', () => {
    const onOk = vi.fn()
    const onCancel = vi.fn()

    BGM.Dialog.show('confirm', '标题', '内容', { onOk, onCancel })

    const forwarded = mocks.notify.confirm.mock.calls[0]?.[1]
    forwarded?.(true)
    expect(onOk).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    forwarded?.(false)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('type=input 走 input 分支', () => {
    BGM.Dialog.show('input', '标题', '提示', { defaultValue: 'd' })
    expect(mocks.notify.input).toHaveBeenCalledWith('标题', '提示', 'd', expect.any(Function), undefined)
  })

  it('type=error 走 error 分支', () => {
    BGM.Dialog.show('error', '标题', '内容')
    expect(mocks.notify.error).toHaveBeenCalledWith('内容', '标题')
  })

  it('未知 type 落到 alert 分支', () => {
    BGM.Dialog.show('alert', '标题', '内容')
    expect(mocks.notify.alert).toHaveBeenCalledWith('内容', '标题')
  })
})

describe('BGM · showAlert / showConfirm', () => {
  it('showAlert 委托给 Dialog.alert', () => {
    BGM.showAlert('标题', '内容')
    expect(mocks.notify.alert).toHaveBeenCalledWith('内容', '标题')
  })

  it('showConfirm：确认时调 onConfirm，取消时调 onCancel', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    BGM.showConfirm('标题', '内容', onConfirm, onCancel)

    const forwarded = mocks.notify.confirm.mock.calls[0]?.[1]
    forwarded?.(true)
    expect(onConfirm).toHaveBeenCalledTimes(1)

    forwarded?.(false)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('showConfirm：两个回调都可省略', () => {
    BGM.showConfirm('标题', '内容')
    expect(() => {
      mocks.notify.confirm.mock.calls[0]?.[1]?.(true)
      mocks.notify.confirm.mock.calls[0]?.[1]?.(false)
    }).not.toThrow()
  })
})

// ========== handleError / safeExecute ==========

describe('BGM · handleError 错误分级', () => {
  it('传入 BgmError 时原样返回（不重新包装，保留 code）', () => {
    const original = new BgmError('原始错误', { code: 'TOKEN_INVALID' })
    const result = BGM.handleError(original, { level: ErrorLevel.SILENT })
    expect(result).toBe(original)
    expect(result.code).toBe('TOKEN_INVALID')
  })

  it('普通 Error → code=JS_ERROR，并保留 name / stack', () => {
    const error = new TypeError('类型不对')
    const result = BGM.handleError(error, { level: ErrorLevel.SILENT })

    expect(result.code).toBe('JS_ERROR')
    expect(result.message).toBe('类型不对')
    expect(result.details.name).toBe('TypeError')
    expect(result.details.stack).toBe(error.stack)
  })

  it('非 Error 值 → code=UNKNOWN，消息取 String()', () => {
    const result = BGM.handleError('炸了', { level: ErrorLevel.SILENT })
    expect(result.code).toBe('UNKNOWN')
    expect(result.message).toBe('炸了')
  })

  it('显式 context 会写进 details', () => {
    const result = BGM.handleError(new Error('x'), {
      level: ErrorLevel.SILENT,
      context: 'syncFromGithub',
    })
    expect(result.details.context).toBe('syncFromGithub')
  })

  it('省略 context 时不填 —— 默认空串让 ??= 短路，自动取名分支实际不可达', () => {
    // 实现里 options_ 的默认值是 `context: ''`，而 `??=` 只认 null/undefined，
    // 因此 `options_.context ??= getCallerFunctionName()` 永不触发、
    // 后面的 `if (options_.context)` 也恒为假 —— 注释宣称的「自动获取调用函数名」并未生效。
    const result = BGM.handleError(new Error('x'), { level: ErrorLevel.SILENT })
    expect(result.details.context).toBeUndefined()
  })

  it('显式传 context: undefined 才会走进自动取名分支', () => {
    const options = { level: ErrorLevel.SILENT, context: undefined } as unknown as ErrorOptions
    const result = BGM.handleError(new Error('x'), options)
    expect(typeof result.details.context).toBe('string')
    expect(String(result.details.context).length).toBeGreaterThan(0)
  })

  it('level=SILENT 完全不输出', () => {
    BGM.handleError(new Error('x'), { level: ErrorLevel.SILENT })
    expect(loggerSpies.error).not.toHaveBeenCalled()
    expect(loggerSpies.warn).not.toHaveBeenCalled()
  })

  it('level=WARN 只写警告日志，不弹窗', () => {
    BGM.handleError(new Error('x'), { level: ErrorLevel.WARN })
    expect(loggerSpies.warn).toHaveBeenCalledTimes(1)
    expect(mocks.notify.alert).not.toHaveBeenCalled()
  })

  it('level=ERROR（默认）写错误日志；showAlert 为真时额外弹窗', () => {
    BGM.handleError(new Error('同步失败'), { showAlert: true })
    expect(loggerSpies.error).toHaveBeenCalledTimes(1)
    expect(mocks.notify.alert).toHaveBeenCalledWith('同步失败', '错误')
  })

  it('level=THROW 抛出包装后的 BgmError', () => {
    let caught: unknown = null
    try {
      BGM.handleError(new Error('致命'), { level: ErrorLevel.THROW })
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBeInstanceOf(BgmError)
    expect((caught as BgmError).message).toBe('致命')
    expect(loggerSpies.error).toHaveBeenCalledTimes(1)
  })

  it('未知级别（INFO=4）不输出错误日志（保持原 fall-through 行为）', () => {
    BGM.handleError(new Error('x'), { level: ErrorLevel.INFO })
    expect(loggerSpies.error).not.toHaveBeenCalled()
    expect(loggerSpies.warn).not.toHaveBeenCalled()
  })
})

describe('BGM · safeExecute', () => {
  it('正常执行时返回函数结果', () => {
    expect(BGM.safeExecute(() => 42)).toBe(42)
  })

  it('抛错时返回 BgmError 而不是中断调用方', () => {
    const result = BGM.safeExecute(() => {
      throw new Error('内部炸了')
    }, 'myJob')
    expect(result).toBeInstanceOf(BgmError)
    expect(result.message).toBe('内部炸了')
    expect(result.details.context).toBe('myJob')
  })
})

// ========== 状态便捷方法 ==========

describe('BGM · 状态便捷方法', () => {
  it('setUserId(null) 清缓存并发事件，但不写存储', () => {
    BGM.cache.userId = 'old'
    const emitSpy = vi.spyOn(eventBus, 'emit')

    BGM.setUserId(null)

    expect(BGM.cache.userId).toBeNull()
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.USER_ID_UPDATED)
  })

  it('setUserId(值) 委托给 _setBgmUserId（写缓存）', () => {
    const emitSpy = vi.spyOn(eventBus, 'emit')
    BGM.setUserId('u-9')
    expect(BGM.cache.userId).toBe('u-9')
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.USER_ID_UPDATED)
  })

  it('setUsername(null) 清缓存并发事件；setUsername(值) 写缓存', () => {
    BGM.cache.username = 'old'
    const emitSpy = vi.spyOn(eventBus, 'emit')

    BGM.setUsername(null)
    expect(BGM.cache.username).toBeNull()
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.USER_NAME_UPDATED)

    BGM.setUsername('momo')
    expect(BGM.cache.username).toBe('momo')
  })

  it('notifyTokenUpdated / setSyncProgress / setSyncComplete / setSyncError 广播对应事件', () => {
    const emitSpy = vi.spyOn(eventBus, 'emit')

    BGM.notifyTokenUpdated()
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.TOKEN_UPDATED)

    BGM.setSyncProgress(3, 10, '进行中')
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.SYNC_PROGRESS, {
      current: 3,
      total: 10,
      message: '进行中',
    })

    BGM.setSyncComplete({ success: 1, fail: 0, skip: 2 })
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.SYNC_COMPLETED, { success: 1, fail: 0, skip: 2 })

    BGM.setSyncComplete()
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.SYNC_COMPLETED, undefined)

    BGM.setSyncError('boom')
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.SYNC_ERROR, 'boom')
  })

  it('resetAbortController 换新实例，旧实例不受影响', () => {
    const previous = BGM.abortController
    BGM.resetAbortController()

    expect(BGM.abortController).not.toBe(previous)
    expect(previous.signal.aborted).toBe(false)
    BGM.abortController.abort()
    expect(BGM.abortController.signal.aborted).toBe(true)
  })
})

// ========== 同步状态机 ==========

describe('BGM.sync · 运行状态', () => {
  it('enterRunningState：空闲时置位并广播 running', () => {
    const emitSpy = vi.spyOn(eventBus, 'emit')

    expect(BGM.sync.enterRunningState()).toBe(true)

    expect(BGM.sync.isRunning).toBe(true)
    expect(BGM.sync.lastSyncTime).toBeTruthy()
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'running' })
  })

  it('enterRunningState：已在运行时提示并返回 false，且不重复广播', () => {
    BGM.sync.isRunning = true
    const emitSpy = vi.spyOn(eventBus, 'emit')

    expect(BGM.sync.enterRunningState()).toBe(false)

    expect(mocks.notify.alert).toHaveBeenCalledWith('提示', '同步正在进行中，请稍后')
    expect(emitSpy).not.toHaveBeenCalled()
  })

  it('exitRunningState：清标志、清停止标志并广播 idle', () => {
    BGM.sync.isRunning = true
    BGM.sync.shouldStop = true
    const emitSpy = vi.spyOn(eventBus, 'emit')

    BGM.sync.exitRunningState()

    expect(BGM.sync.isRunning).toBe(false)
    expect(BGM.sync.shouldStop).toBe(false)
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'idle' })
  })
})

describe('BGM.sync · startSync 三条路径', () => {
  it('已在运行时只提示，不弹确认框', () => {
    BGM.sync.isRunning = true

    BGM.sync.startSync()

    expect(mocks.notify.alert).toHaveBeenCalledWith('提示', '同步正在进行中，请稍后')
    expect(mocks.notify.confirm).not.toHaveBeenCalled()
  })

  it('用户取消确认 → 不进入运行状态', () => {
    BGM.sync.startSync()
    const confirmCallback = mocks.notify.confirm.mock.calls[0]?.[1]

    confirmCallback?.(false)

    expect(BGM.sync.isRunning).toBe(false)
  })

  it('确认后界面未就绪（runner 为 null）→ 提示并退回空闲状态', async () => {
    mocks.getSyncRunner.mockReturnValue(null)

    BGM.sync.startSync()
    mocks.notify.confirm.mock.calls[0]?.[1]?.(true)
    await flushMicrotasks()

    expect(mocks.notify.alert).toHaveBeenCalledWith('提示', '同步功能当前不可用（界面未就绪）')
    expect(BGM.sync.isRunning).toBe(false)
  })

  it('runner 期间被请求停止 → 完成后提示「同步已停止」', async () => {
    mocks.getSyncRunner.mockReturnValue(async () => {
      BGM.sync.shouldStop = true
    })

    BGM.sync.startSync()
    mocks.notify.confirm.mock.calls[0]?.[1]?.(true)
    await flushMicrotasks()

    expect(mocks.notify.alert).toHaveBeenCalledWith('提示', '同步已停止')
    expect(BGM.sync.isRunning).toBe(false)
  })

  it('runner 抛错 → 走统一错误处理并退回空闲状态', async () => {
    mocks.getSyncRunner.mockReturnValue(async () => {
      throw new Error('上传中断')
    })

    BGM.sync.startSync()
    mocks.notify.confirm.mock.calls[0]?.[1]?.(true)
    await flushMicrotasks()

    expect(loggerSpies.error).toHaveBeenCalled()
    expect(BGM.sync.isRunning).toBe(false)
    expect(BGM.sync.shouldStop).toBe(false)
  })
})

describe('BGM.sync · 停止与暂停', () => {
  it('requestStop：未运行时静默返回（不广播 stopped）', () => {
    const emitSpy = vi.spyOn(eventBus, 'emit')
    BGM.sync.requestStop()
    expect(BGM.sync.shouldStop).toBe(false)
    expect(emitSpy).not.toHaveBeenCalled()
  })

  it('requestStop：运行中置停止标志、清暂停标志并广播 stopped', () => {
    BGM.sync.isRunning = true
    BGM.sync.isPaused = true
    const emitSpy = vi.spyOn(eventBus, 'emit')

    BGM.sync.requestStop()

    expect(BGM.sync.shouldStop).toBe(true)
    expect(BGM.sync.isPaused).toBe(false)
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'stopped' })
  })

  it('pause：未运行 / 已暂停 / 已请求停止 三种情况都静默返回', () => {
    const emitSpy = vi.spyOn(eventBus, 'emit')

    BGM.sync.pause()
    expect(BGM.sync.isPaused).toBe(false)

    BGM.sync.isRunning = true
    BGM.sync.isPaused = true
    BGM.sync.pause()

    BGM.sync.isPaused = false
    BGM.sync.shouldStop = true
    BGM.sync.pause()
    expect(BGM.sync.isPaused).toBe(false)

    expect(emitSpy).not.toHaveBeenCalled()
  })

  it('pause：定位失败时额外 toast 提醒（不假装已定位）', () => {
    BGM.sync.isRunning = true
    BGM.sync.currentRow = 0
    const emitSpy = vi.spyOn(eventBus, 'emit')

    BGM.sync.pause()

    expect(BGM.sync.isPaused).toBe(true)
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.SYNC_STATE_CHANGED, {
      state: 'paused',
      row: 0,
    })
    expect(mocks.notify.toast).toHaveBeenCalledWith('已暂停，但无法定位到当前单元格', 'warn')
  })

  it('pause：定位成功时不 toast，并标出当前行', () => {
    const select = vi.fn()
    BGM.sync.isRunning = true
    BGM.sync.currentRow = 4
    BGM.sync.currentCol = 2
    BGM.sync.currentSheet = createFakeSheet(select)

    BGM.sync.pause()

    expect(select).toHaveBeenCalledTimes(1)
    expect(mocks.notify.toast).not.toHaveBeenCalled()
  })

  it('resume：非暂停时无操作；暂停中清除标志并广播 resumed', () => {
    const emitSpy = vi.spyOn(eventBus, 'emit')

    BGM.sync.resume()
    expect(emitSpy).not.toHaveBeenCalled()

    BGM.sync.isPaused = true
    BGM.sync.resume()

    expect(BGM.sync.isPaused).toBe(false)
    expect(emitSpy).toHaveBeenCalledWith(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'resumed' })
  })

  it('checkShouldStop / checkPaused 如实反映标志', () => {
    BGM.sync.shouldStop = true
    BGM.sync.isPaused = true
    expect(BGM.sync.checkShouldStop()).toBe(true)
    expect(BGM.sync.checkPaused()).toBe(true)
  })

  it('resetStopFlag 清空停止标志与位置信息', () => {
    BGM.sync.shouldStop = true
    BGM.sync.isPaused = true
    BGM.sync.currentRow = 9
    BGM.sync.currentCol = 3
    BGM.sync.currentSheet = createFakeSheet(vi.fn())

    BGM.sync.resetStopFlag()

    expect(BGM.sync.shouldStop).toBe(false)
    expect(BGM.sync.isPaused).toBe(false)
    expect(BGM.sync.currentRow).toBe(0)
    expect(BGM.sync.currentCol).toBe(0)
    expect(BGM.sync.currentSheet).toBeNull()
  })
})

describe('BGM.sync · 等待恢复与定位', () => {
  it('waitForResume：未暂停时立即返回', async () => {
    await expect(BGM.sync.waitForResume()).resolves.toBeUndefined()
  })

  it('waitForResume：请求停止后不再等待', async () => {
    BGM.sync.isPaused = true
    BGM.sync.shouldStop = true
    await expect(BGM.sync.waitForResume()).resolves.toBeUndefined()
  })

  it('waitForResume：暂停期间按 50ms 轮询，恢复后返回', async () => {
    vi.useFakeTimers()
    BGM.sync.isPaused = true
    const waiting = BGM.sync.waitForResume()
    BGM.sync.isPaused = false

    await vi.advanceTimersByTimeAsync(50)
    await waiting

    expect(BGM.sync.isPaused).toBe(false)
  })

  it('locateCurrentCell：行号无效或无工作表时返回 false', () => {
    expect(BGM.sync.locateCurrentCell()).toBe(false)

    BGM.sync.currentRow = 5
    expect(BGM.sync.locateCurrentCell()).toBe(false)

    BGM.sync.currentRow = 0
    BGM.sync.currentSheet = createFakeSheet(vi.fn())
    expect(BGM.sync.locateCurrentCell()).toBe(false)
  })

  it('locateCurrentCell：列为 0 时退回第 1 列，地址按列号转字母', () => {
    const select = vi.fn()
    const rangeAddresses: string[] = []
    BGM.sync.currentSheet = {
      Range: (address: string) => {
        rangeAddresses.push(address)
        return { Select: select }
      },
    } as unknown as WpsWorksheet
    BGM.sync.currentRow = 12
    BGM.sync.currentCol = 0

    expect(BGM.sync.locateCurrentCell()).toBe(true)
    expect(rangeAddresses).toEqual([`${colNumberToLetter(1)}12`])
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('locateCurrentCell：Range 抛错时告警并返回 false（不中断同步）', () => {
    BGM.sync.currentRow = 7
    BGM.sync.currentSheet = createFakeSheet(() => {}, true)

    expect(BGM.sync.locateCurrentCell()).toBe(false)
    expect(loggerSpies.warn).toHaveBeenCalled()
    expect(mocks.notify.toast).toHaveBeenCalledWith('定位单元格失败: 无此单元格', 'error')
  })

  it('locateCurrentCell：非 Error 抛出物也能取到消息', () => {
    BGM.sync.currentRow = 7
    BGM.sync.currentSheet = {
      Range: () => {
        throw '裸字符串错误'
      },
    } as unknown as WpsWorksheet

    expect(BGM.sync.locateCurrentCell()).toBe(false)
    expect(mocks.notify.toast).toHaveBeenCalledWith('定位单元格失败: 裸字符串错误', 'error')
  })

  it('updatePosition：非法行号忽略；undefined 保留原工作表；col<=0 不更新', () => {
    const sheet = createFakeSheet(vi.fn())
    BGM.sync.currentSheet = sheet
    BGM.sync.updatePosition(sheet, 1.5)
    expect(BGM.sync.currentRow).toBe(0)

    BGM.sync.updatePosition(sheet, -1)
    expect(BGM.sync.currentRow).toBe(0)

    BGM.sync.updatePosition(undefined, 6)
    expect(BGM.sync.currentRow).toBe(6)
    expect(BGM.sync.currentSheet).toBe(sheet)

    BGM.sync.updatePosition(undefined, 6, 0)
    expect(BGM.sync.currentCol).toBe(0)

    BGM.sync.updatePosition(undefined, 6, 4)
    expect(BGM.sync.currentCol).toBe(4)
  })
})
