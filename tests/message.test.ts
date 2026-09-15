// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/message.ts` 的单元测试。
 *
 * 模块由两部分组成：
 *  1. `initMessageListener()` —— 在 `window` 上装一个 `message` 监听器，按 `data.type`
 *     分派到各 UI 动作。**关键安全语义**：先校验 `event.origin` 只允许 `https://bgm.tv`
 *     与自身 origin，跨站消息一律丢弃；重复调用要先摘掉旧监听器（否则一次消息触发两次动作）。
 *  2. `setStatus()` —— 往 `#statusBox`（回退 `#statusDisplay`）写文案与样式类。
 *
 * 监听器是**模块级单例**（`_messageHandler`），所以断言一律看「分派出来的副作用」
 * （`showAlert` 等被调用几次），不看监听器本身。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => ({
  showAlert: vi.fn(),
  showConfirm: vi.fn(),
  updateTokenStatus: vi.fn(),
  updateUserIdStatus: vi.fn(),
  refreshSheets: vi.fn(),
  refreshData: vi.fn(),
  bgmLog: vi.fn(),
  startSync: vi.fn(),
}))

vi.mock('../ts/index.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  showAlert: stubs.showAlert,
  showConfirm: stubs.showConfirm,
  updateTokenStatus: stubs.updateTokenStatus,
  updateUserIdStatus: stubs.updateUserIdStatus,
  refreshSheets: stubs.refreshSheets,
  refreshData: stubs.refreshData,
  bgmLog: stubs.bgmLog,
  BGM: {
    sync: { startSync: stubs.startSync },
  },
}))

import { initMessageListener, setStatus } from '../ts/ui/message.js'

/** 自身 origin（jsdom 默认是 http://localhost:3000，不写死） */
const SELF_ORIGIN = window.location.origin

/** 派发一条 message 事件 */
function postMessage(data: unknown, origin: string = SELF_ORIGIN): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }))
}

/** bgmLog 是否输出过包含某片段的日志 */
function hasLog(fragment: string): boolean {
  return stubs.bgmLog.mock.calls.some((call) => String(call[1]).includes(fragment))
}

beforeEach(() => {
  vi.clearAllMocks()
  initMessageListener()
})

describe('initMessageListener', () => {
  it('注册监听器并打印开始 / 完成日志', () => {
    expect(hasLog('[message] initMessageListener 开始执行')).toBe(true)
    expect(hasLog('[message] initMessageListener 执行完成，监听器已注册')).toBe(true)
  })

  it('重复调用先摘掉旧监听器（一次消息只触发一次动作）', () => {
    initMessageListener()
    initMessageListener()

    postMessage({ type: 'updateToken' })

    expect(stubs.updateTokenStatus).toHaveBeenCalledTimes(1)
  })
})

describe('消息来源校验', () => {
  it('非白名单 origin 的消息被丢弃（不产生任何动作与日志）', () => {
    postMessage({ type: 'updateToken' }, 'https://evil.example.com')

    expect(stubs.updateTokenStatus).not.toHaveBeenCalled()
    expect(hasLog('[message] 收到消息')).toBe(false)
  })

  it('https://bgm.tv 是白名单来源', () => {
    postMessage({ type: 'updateToken' }, 'https://bgm.tv')

    expect(stubs.updateTokenStatus).toHaveBeenCalledTimes(1)
  })

  it('自身 origin 是白名单来源', () => {
    postMessage({ type: 'refreshSheets' }, SELF_ORIGIN)

    expect(stubs.refreshSheets).toHaveBeenCalledTimes(1)
  })

  it('缺少 type 的消息被丢弃', () => {
    postMessage({ message: 'no type' })

    expect(hasLog('[message] 收到消息')).toBe(false)
  })
})

describe('消息分派', () => {
  it('showAlert → showAlert(message, title)', () => {
    postMessage({ type: 'showAlert', message: '出错了', title: '提示' })

    expect(stubs.showAlert).toHaveBeenCalledWith('出错了', '提示')
  })

  it('showAlert 缺 message 时传空串', () => {
    postMessage({ type: 'showAlert' })

    expect(stubs.showAlert).toHaveBeenCalledWith('', undefined)
  })

  it('showConfirm → 确认时启动同步', () => {
    postMessage({ type: 'showConfirm', message: '要同步吗' })

    expect(stubs.showConfirm).toHaveBeenCalledTimes(1)
    expect(stubs.showConfirm.mock.calls[0]?.[0]).toBe('要同步吗')

    const callback = stubs.showConfirm.mock.calls[0]?.[1] as (isConfirmed: boolean) => void
    callback(true)
    expect(stubs.startSync).toHaveBeenCalledTimes(1)
  })

  it('showConfirm → 取消时不启动同步', () => {
    postMessage({ type: 'showConfirm', message: '要同步吗' })

    const callback = stubs.showConfirm.mock.calls[0]?.[1] as (isConfirmed: boolean) => void
    callback(false)
    expect(stubs.startSync).not.toHaveBeenCalled()
  })

  it('refreshData → refreshData()', () => {
    postMessage({ type: 'refreshData' })

    expect(stubs.refreshData).toHaveBeenCalledTimes(1)
  })

  it('BGM:userInfoUpdated → 记录用户名 / ID 并刷新用户状态', () => {
    postMessage({ type: 'BGM:userInfoUpdated', username: 'alice', userId: '42' })

    expect(hasLog('username=alice, userId=42')).toBe(true)
    expect(stubs.updateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('BGM:userInfoUpdated 缺字段时日志里是空串', () => {
    postMessage({ type: 'BGM:userInfoUpdated' })

    expect(hasLog('username=, userId=')).toBe(true)
    expect(stubs.updateUserIdStatus).toHaveBeenCalledTimes(1)
  })

  it('未知消息类型 → WARN 日志，不产生动作', () => {
    postMessage({ type: '__nope__' })

    expect(stubs.bgmLog).toHaveBeenCalledWith('WARN', expect.stringContaining('未知消息类型: __nope__'))
    expect(stubs.updateTokenStatus).not.toHaveBeenCalled()
    expect(stubs.refreshSheets).not.toHaveBeenCalled()
    expect(stubs.refreshData).not.toHaveBeenCalled()
    expect(stubs.updateUserIdStatus).not.toHaveBeenCalled()
  })
})

describe('setStatus', () => {
  it('写入 #statusBox 并带上默认 info 样式类', () => {
    document.body.innerHTML = '<div id="statusBox"></div>'
    const box = document.getElementById('statusBox')

    setStatus('同步完成')

    expect(box?.textContent).toBe('同步完成')
    expect(box?.className).toBe('status info')
  })

  it('指定 type 时用作样式类', () => {
    document.body.innerHTML = '<div id="statusBox"></div>'
    const box = document.getElementById('statusBox')

    setStatus('失败了', 'error')

    expect(box?.className).toBe('status error')
  })

  it('没有 #statusBox 时回退到 #statusDisplay', () => {
    document.body.innerHTML = '<div id="statusDisplay"></div>'
    const display = document.getElementById('statusDisplay')

    setStatus('回退目标', 'warn')

    expect(display?.textContent).toBe('回退目标')
    expect(display?.className).toBe('status warn')
  })

  it('两个元素都不存在时静默返回', () => {
    document.body.replaceChildren()

    expect(() => {
      setStatus('无处可写')
    }).not.toThrow()
  })
})
