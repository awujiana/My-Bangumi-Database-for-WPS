// @vitest-environment jsdom
/**
 * @fileoverview 面板消息监听与事件总线订阅单测（handlers/panel-events.ts）
 *
 * 这两条链路是「静默失效」的高发区：message 监听器被 origin 白名单挡掉、
 * 事件总线的处理函数漏注册，都只会表现为「界面上什么都不发生」，没有任何报错。
 * 因此逐条断言到「最终副作用」（token 状态刷新 / 缓存写入 / toast 文案 / 按钮禁用）。
 *
 * 覆盖：
 *  - setupMessageListener：无 window 早退、重复注册先移除旧的、origin 白名单拒绝、
 *    data 非对象忽略、4 种 BGM:* 消息 + 2 种旧格式、未知类型忽略
 *  - removeMessageListener：未注册时早退、注册后移除并置空
 *  - setupEventListeners：注册 10 个事件，逐个验副作用
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 动作处理器上下文（与 ACTION_HANDLERS 的签名保持一致） */
interface ActionContext {
  args: string[]
  startTime: number
}

const mockReferences = vi.hoisted(() => {
  const actionHandlers: Record<string, (context: ActionContext) => void> = {}
  return {
    mockBgmLog: vi.fn(),
    mockShowToast: vi.fn(),
    mockUpdateSyncProgressDialog: vi.fn(),
    mockSetBgmUserId: vi.fn(),
    mockSetBgmUsername: vi.fn(),
    mockUpdateTokenStatus: vi.fn(),
    mockUpdateUserIdStatus: vi.fn(),
    mockTryUpdateIncrementalCheckbox: vi.fn(),
    mockTryUpdateSkipConflictsUI: vi.fn(),
    mockTryUpdateEnableSyncRecordUI: vi.fn(),
    mockIsPanelContext: vi.fn(() => true),
    busHandlers: new Map<string, (payload: unknown) => void>(),
    actionHandlers,
  }
})

/** 与被测模块内 mock 的 LOG_LEVELS 保持同一份取值，避免断言与工厂漂移 */
const LEVELS = vi.hoisted(() => ({ DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' }))

/** 共享 BGM 状态：被测模块写 cache，测试读 cache */
const sharedBGM = vi.hoisted(() => {
  const cache: { userId?: string; username?: string } = { userId: '', username: '' }
  return { cache }
})

vi.mock('../ts/index.js', () => ({
  BGM: sharedBGM,
  LOG_LEVELS: LEVELS,
  bgmLog: mockReferences.mockBgmLog,
  showToast: mockReferences.mockShowToast,
  updateSyncProgressDialog: mockReferences.mockUpdateSyncProgressDialog,
  _setBgmUserId: mockReferences.mockSetBgmUserId,
  _setBgmUsername: mockReferences.mockSetBgmUsername,
}))

vi.mock('../ts/ui/handlers/resource-tracking.js', () => ({
  trackedEventBusOn: (eventName: string, handler: (payload: unknown) => void): void => {
    mockReferences.busHandlers.set(eventName, handler)
  },
}))

vi.mock('../ts/ui/handlers/action-handlers.js', () => ({
  ACTION_HANDLERS: mockReferences.actionHandlers,
}))

vi.mock('../ts/ui/handlers/token.js', () => ({
  updateTokenStatus: mockReferences.mockUpdateTokenStatus,
  updateUserIdStatus: mockReferences.mockUpdateUserIdStatus,
}))

vi.mock('../ts/ui/handlers/panel-context.js', () => ({
  isPanelContext: mockReferences.mockIsPanelContext,
}))

vi.mock('../ts/ui/handlers/incremental-bindings.js', () => ({
  tryUpdateIncrementalCheckbox: mockReferences.mockTryUpdateIncrementalCheckbox,
  tryUpdateSkipConflictsUI: mockReferences.mockTryUpdateSkipConflictsUI,
  tryUpdateEnableSyncRecordUI: mockReferences.mockTryUpdateEnableSyncRecordUI,
}))

import { BGM_EVENTS } from '../ts/tools/events.js'
import {
  setupMessageListener,
  removeMessageListener,
  setupEventListeners,
} from '../ts/ui/handlers/panel-events.js'

// ========== window 监听器捕获（替代 spy，避开 addEventListener 重载的类型噪音）==========

interface ListenerRecord {
  type: string
  handler: (event: MessageEvent) => void
}

let addedListeners: ListenerRecord[] = []
let removedListeners: ListenerRecord[] = []
let originalAddEventListener: typeof window.addEventListener
let originalRemoveEventListener: typeof window.removeEventListener

function recordListener(record: ListenerRecord, target: ListenerRecord[]): void {
  target.push(record)
}

/** 取最近一次注册的 message 处理器 */
function lastMessageHandler(): (event: MessageEvent) => void {
  const records = addedListeners.filter((item) => item.type === 'message')
  const last = records.at(-1)
  if (!last) throw new Error('未注册 message 监听器')
  return last.handler
}

/** 用给定 origin / data 触发消息监听器 */
function invokeMessage(origin: string, data: unknown): void {
  // 刻意构造最小的 MessageEvent 形状：被测代码只读 origin 与 data 两个字段
  const event = { origin, data } as unknown as MessageEvent
  lastMessageHandler()(event)
}

/** 触发事件总线上已注册的处理器 */
function emitBusEvent(eventName: string, payload?: unknown): void {
  const handler = mockReferences.busHandlers.get(eventName)
  if (!handler) throw new Error(`事件 ${eventName} 未注册`)
  handler(payload)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReferences.busHandlers.clear()
  mockReferences.mockIsPanelContext.mockReturnValue(true)
  sharedBGM.cache = { userId: '', username: '' }
  document.body.replaceChildren()

  addedListeners = []
  removedListeners = []
  originalAddEventListener = window.addEventListener
  originalRemoveEventListener = window.removeEventListener
  Reflect.set(window, 'addEventListener', (type: string, handler: unknown) => {
    recordListener({ type, handler: handler as (event: MessageEvent) => void }, addedListeners)
  })
  Reflect.set(window, 'removeEventListener', (type: string, handler: unknown) => {
    recordListener({ type, handler: handler as (event: MessageEvent) => void }, removedListeners)
  })
  // 清掉上一个用例遗留的模块级监听器，保证每个用例从「未注册」开始
  removeMessageListener()
  addedListeners = []
  removedListeners = []
})

afterEach(() => {
  removeMessageListener()
  Reflect.set(window, 'addEventListener', originalAddEventListener)
  Reflect.set(window, 'removeEventListener', originalRemoveEventListener)
})

describe('ui/handlers/panel-events · setupMessageListener', () => {
  it('无 window 时静默返回', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'window')
    try {
      expect(() => {
        setupMessageListener()
      }).not.toThrow()
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
    }
  })

  it('注册 message 监听器，并记录一条日志', () => {
    setupMessageListener()
    expect(addedListeners.filter((item) => item.type === 'message')).toHaveLength(1)
    expect(mockReferences.mockBgmLog).toHaveBeenCalledWith(
      LEVELS.INFO,
      expect.stringContaining('消息监听器已注册'),
    )
  })

  it('重复调用时先移除旧监听器（防重复注册）', () => {
    setupMessageListener()
    const first = lastMessageHandler()
    setupMessageListener()
    expect(removedListeners.filter((item) => item.type === 'message')).toHaveLength(1)
    expect(removedListeners[0]?.handler).toBe(first)
    expect(addedListeners.filter((item) => item.type === 'message')).toHaveLength(2)
  })

  it('拒绝非预期 origin，并告警', () => {
    setupMessageListener()
    invokeMessage('https://evil.example', { type: 'BGM:tokenUpdated' })
    expect(mockReferences.mockUpdateTokenStatus).not.toHaveBeenCalled()
    expect(mockReferences.mockBgmLog).toHaveBeenCalledWith(
      LEVELS.WARN,
      expect.stringContaining('拒绝非预期 origin'),
    )
  })

  it('data 非对象（字符串 / null）时忽略', () => {
    setupMessageListener()
    invokeMessage(window.location.origin, 'not-an-object')
    invokeMessage(window.location.origin, null)
    expect(mockReferences.mockUpdateUserIdStatus).not.toHaveBeenCalled()
    expect(mockReferences.mockUpdateTokenStatus).not.toHaveBeenCalled()
  })

  it('BGM:tokenUpdated → 刷新 token 与用户 ID 状态', () => {
    setupMessageListener()
    invokeMessage(window.location.origin, { type: 'BGM:tokenUpdated' })
    expect(mockReferences.mockUpdateTokenStatus).toHaveBeenCalledTimes(1)
    expect(mockReferences.mockUpdateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('BGM:userIdUpdated 带 userId → 写缓存 + 落盘 + 刷新状态', () => {
    setupMessageListener()
    invokeMessage(window.location.origin, { type: 'BGM:userIdUpdated', userId: 'u-42' })
    expect(sharedBGM.cache.userId).toBe('u-42')
    expect(mockReferences.mockSetBgmUserId).toHaveBeenCalledWith('u-42')
    expect(mockReferences.mockUpdateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('BGM:userIdUpdated 缺 userId → 只刷新状态，不写缓存', () => {
    setupMessageListener()
    invokeMessage(window.location.origin, { type: 'BGM:userIdUpdated' })
    expect(mockReferences.mockSetBgmUserId).not.toHaveBeenCalled()
    expect(mockReferences.mockUpdateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('BGM:userInfoUpdated 同时带用户名与 ID → 两者都更新', () => {
    setupMessageListener()
    invokeMessage(window.location.origin, {
      type: 'BGM:userInfoUpdated',
      username: 'momo',
      userId: 'u-7',
    })
    expect(sharedBGM.cache.username).toBe('momo')
    expect(sharedBGM.cache.userId).toBe('u-7')
    expect(mockReferences.mockSetBgmUsername).toHaveBeenCalledWith('momo')
    expect(mockReferences.mockSetBgmUserId).toHaveBeenCalledWith('u-7')
  })

  it('BGM:userInfoUpdated 只带用户名 → 不碰 userId', () => {
    setupMessageListener()
    invokeMessage(window.location.origin, { type: 'BGM:userInfoUpdated', username: 'momo' })
    expect(sharedBGM.cache.username).toBe('momo')
    expect(sharedBGM.cache.userId).toBe('')
    expect(mockReferences.mockSetBgmUserId).not.toHaveBeenCalled()
    expect(mockReferences.mockSetBgmUsername).toHaveBeenCalledWith('momo')
  })

  it('BGM:userInfoUpdated 只带 userId → 不碰用户名', () => {
    setupMessageListener()
    invokeMessage(window.location.origin, { type: 'BGM:userInfoUpdated', userId: 'u-9' })
    expect(sharedBGM.cache.userId).toBe('u-9')
    expect(sharedBGM.cache.username).toBe('')
    expect(mockReferences.mockSetBgmUsername).not.toHaveBeenCalled()
    expect(mockReferences.mockSetBgmUserId).toHaveBeenCalledWith('u-9')
  })

  it('兼容旧格式 tokenUpdated / userIdUpdated', () => {
    setupMessageListener()
    invokeMessage(window.location.origin, { type: 'tokenUpdated' })
    expect(mockReferences.mockUpdateTokenStatus).toHaveBeenCalledTimes(1)
    invokeMessage(window.location.origin, { type: 'userIdUpdated' })
    expect(mockReferences.mockUpdateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('未知消息类型忽略', () => {
    setupMessageListener()
    invokeMessage(window.location.origin, { type: 'BGM:whatever' })
    expect(mockReferences.mockUpdateTokenStatus).not.toHaveBeenCalled()
    expect(mockReferences.mockUpdateUserIdStatus).not.toHaveBeenCalled()
  })
})

describe('ui/handlers/panel-events · removeMessageListener', () => {
  it('未注册时早退，不触碰 window', () => {
    removeMessageListener()
    expect(removedListeners).toHaveLength(0)
    expect(mockReferences.mockBgmLog).not.toHaveBeenCalledWith(
      LEVELS.INFO,
      expect.stringContaining('消息监听器已移除'),
    )
  })

  it('注册后移除并置空（幂等，第二次不再移除）', () => {
    setupMessageListener()
    removeMessageListener()
    expect(removedListeners.filter((item) => item.type === 'message')).toHaveLength(1)
    expect(mockReferences.mockBgmLog).toHaveBeenCalledWith(
      LEVELS.INFO,
      expect.stringContaining('消息监听器已移除'),
    )
    removeMessageListener()
    expect(removedListeners.filter((item) => item.type === 'message')).toHaveLength(1)
  })
})

/** 建一个带 data-action 的按钮并挂到文档，返回该按钮 */
function mountActionButton(action: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.dataset.action = action
  document.body.append(button)
  return button
}

describe('ui/handlers/panel-events · setupEventListeners', () => {
  const expectedEvents = [
    BGM_EVENTS.TOKEN_UPDATED,
    BGM_EVENTS.USER_ID_UPDATED,
    BGM_EVENTS.USER_NAME_UPDATED,
    BGM_EVENTS.CONFIG_UPDATED,
    BGM_EVENTS.SYNC_PROGRESS,
    BGM_EVENTS.SYNC_STATE_CHANGED,
    BGM_EVENTS.SYNC_COMPLETED,
    BGM_EVENTS.SYNC_ERROR,
    BGM_EVENTS.REQUEST_GITHUB_SYNC,
    BGM_EVENTS.REQUEST_UNDO_LAST_SYNC,
  ]

  beforeEach(() => {
    setupEventListeners()
  })

  it('注册全部 10 个事件', () => {
    for (const eventName of expectedEvents) {
      expect(mockReferences.busHandlers.has(eventName)).toBe(true)
    }
    expect(mockReferences.busHandlers.size).toBe(expectedEvents.length)
  })

  it('TOKEN_UPDATED → 刷新 token 与用户 ID 状态', () => {
    emitBusEvent(BGM_EVENTS.TOKEN_UPDATED)
    expect(mockReferences.mockUpdateTokenStatus).toHaveBeenCalledTimes(1)
    expect(mockReferences.mockUpdateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('USER_ID_UPDATED / USER_NAME_UPDATED → 只刷新用户 ID 状态', () => {
    emitBusEvent(BGM_EVENTS.USER_ID_UPDATED)
    emitBusEvent(BGM_EVENTS.USER_NAME_UPDATED)
    expect(mockReferences.mockUpdateUserIdStatus).toHaveBeenCalledTimes(2)
    expect(mockReferences.mockUpdateTokenStatus).not.toHaveBeenCalled()
  })

  it('CONFIG_UPDATED 在非面板页直接早退', () => {
    mockReferences.mockIsPanelContext.mockReturnValue(false)
    emitBusEvent(BGM_EVENTS.CONFIG_UPDATED, { key: 'bgm_incremental_sync', value: 'true' })
    expect(mockReferences.mockTryUpdateIncrementalCheckbox).not.toHaveBeenCalled()
  })

  it('CONFIG_UPDATED 按 key 分发三个开关，值按 "true" 转布尔', () => {
    emitBusEvent(BGM_EVENTS.CONFIG_UPDATED, { key: 'bgm_incremental_sync', value: 'true' })
    expect(mockReferences.mockTryUpdateIncrementalCheckbox).toHaveBeenCalledWith(true)

    emitBusEvent(BGM_EVENTS.CONFIG_UPDATED, { key: 'bgm_skip_conflicts', value: 'false' })
    expect(mockReferences.mockTryUpdateSkipConflictsUI).toHaveBeenCalledWith(false)

    emitBusEvent(BGM_EVENTS.CONFIG_UPDATED, { key: 'bgm_enable_sync_record', value: 'true' })
    expect(mockReferences.mockTryUpdateEnableSyncRecordUI).toHaveBeenCalledWith(true)
  })

  it('CONFIG_UPDATED 未知 key 忽略', () => {
    emitBusEvent(BGM_EVENTS.CONFIG_UPDATED, { key: 'bgm_unknown', value: 'true' })
    expect(mockReferences.mockTryUpdateIncrementalCheckbox).not.toHaveBeenCalled()
    expect(mockReferences.mockTryUpdateSkipConflictsUI).not.toHaveBeenCalled()
    expect(mockReferences.mockTryUpdateEnableSyncRecordUI).not.toHaveBeenCalled()
  })

  it('SYNC_PROGRESS → 透传给进度弹窗', () => {
    emitBusEvent(BGM_EVENTS.SYNC_PROGRESS, { current: 3, total: 10, message: '同步中' })
    expect(mockReferences.mockUpdateSyncProgressDialog).toHaveBeenCalledWith(3, 10, '同步中')
  })

  it('SYNC_STATE_CHANGED：running / paused 禁用同步按钮，idle 恢复', () => {
    const syncButton = mountActionButton('sync')
    const undoButton = mountActionButton('syncCollectionFromBgm')
    const previewButton = mountActionButton('previewSyncContent')
    const enlargeButton = mountActionButton('enlargePreview')
    const otherButton = mountActionButton('exportData')

    emitBusEvent(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'running', row: 5 })
    for (const button of [syncButton, undoButton, previewButton, enlargeButton]) {
      expect(button.disabled).toBe(true)
    }

    emitBusEvent(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'paused' })
    expect(syncButton.disabled).toBe(true)

    emitBusEvent(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'idle' })
    for (const button of [syncButton, undoButton, previewButton, enlargeButton]) {
      expect(button.disabled).toBe(false)
    }
    expect(otherButton.disabled).toBe(false)
  })

  it('SYNC_COMPLETED：带统计数字时按实报，缺 results 时补 0', () => {
    emitBusEvent(BGM_EVENTS.SYNC_COMPLETED, { success: 2, fail: 1, skip: 3 })
    expect(mockReferences.mockShowToast).toHaveBeenCalledWith(
      '同步完成: 成功 2, 失败 1, 跳过 3',
      'success',
    )

    emitBusEvent(BGM_EVENTS.SYNC_COMPLETED, undefined)
    expect(mockReferences.mockShowToast).toHaveBeenLastCalledWith(
      '同步完成: 成功 0, 失败 0, 跳过 0',
      'success',
    )

    emitBusEvent(BGM_EVENTS.SYNC_COMPLETED, { success: 1 })
    expect(mockReferences.mockShowToast).toHaveBeenLastCalledWith(
      '同步完成: 成功 1, 失败 0, 跳过 0',
      'success',
    )
  })

  it('SYNC_ERROR：Error 取 message，非 Error 走 String()', () => {
    emitBusEvent(BGM_EVENTS.SYNC_ERROR, new Error('网络超时'))
    expect(mockReferences.mockShowToast).toHaveBeenLastCalledWith('同步失败: 网络超时', 'error')

    emitBusEvent(BGM_EVENTS.SYNC_ERROR, '裸字符串错误')
    expect(mockReferences.mockShowToast).toHaveBeenLastCalledWith('同步失败: 裸字符串错误', 'error')
  })

  it('REQUEST_GITHUB_SYNC：转发给 syncFromGithub handler', () => {
    const handler = vi.fn<(context: ActionContext) => void>()
    mockReferences.actionHandlers.syncFromGithub = handler

    emitBusEvent(BGM_EVENTS.REQUEST_GITHUB_SYNC)

    expect(handler).toHaveBeenCalledTimes(1)
    const context = handler.mock.calls[0]?.[0]
    expect(context?.args).toEqual([])
    expect(typeof context?.startTime).toBe('number')
  })

  it('REQUEST_GITHUB_SYNC：handler 未注册时报错日志', () => {
    Reflect.deleteProperty(mockReferences.actionHandlers, 'syncFromGithub')
    emitBusEvent(BGM_EVENTS.REQUEST_GITHUB_SYNC)
    expect(mockReferences.mockBgmLog).toHaveBeenCalledWith(
      LEVELS.ERROR,
      expect.stringContaining('syncFromGithub handler 未注册'),
    )
  })

  it('REQUEST_UNDO_LAST_SYNC：转发给 undoLastSync handler', () => {
    const handler = vi.fn<(context: ActionContext) => void>()
    mockReferences.actionHandlers.undoLastSync = handler

    emitBusEvent(BGM_EVENTS.REQUEST_UNDO_LAST_SYNC)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[0]?.args).toEqual([])
  })

  it('REQUEST_UNDO_LAST_SYNC：handler 未注册时报错日志', () => {
    Reflect.deleteProperty(mockReferences.actionHandlers, 'undoLastSync')
    emitBusEvent(BGM_EVENTS.REQUEST_UNDO_LAST_SYNC)
    expect(mockReferences.mockBgmLog).toHaveBeenCalledWith(
      LEVELS.ERROR,
      expect.stringContaining('undoLastSync handler 未注册'),
    )
  })
})
