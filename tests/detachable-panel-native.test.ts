/**
 * @fileoverview 可拖出面板的 **native 模式** 行为单测
 * @module tests/detachablePanelNative
 * @description 覆盖「拖出去 → 放回来」这条回路中容易静默失效的分支：
 *   1. 走宿主原生对话框（不是窗格内浮动）；
 *   2. 宿主不支持时回落到窗格内浮动（功能不丢，而不是点了没反应）；
 *   3. 用户在 WPS 里直接关掉原生窗口 → 轮询发现 → 自动收回占位块。
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PLACEHOLDER_CLASS,
  createDetachablePanel,
  resetDetachablePanelsForTest,
} from '../ts/ui/components/detachable-panel.js'

/** 假对话框：记录 Delete 调用次数 */
interface FakeDialog {
  Visible?: boolean
  ID?: number
  Delete?: () => void
}

/** 假宿主 */
interface FakeHostApp {
  CreateWebDialog?: (url: string) => unknown
  GetWebDialog?: (id: number) => unknown
  ShowDialog?: (
    url: string,
    caption: string,
    width: number,
    height: number,
    isModal: boolean,
  ) => unknown
}

let host: HTMLDivElement
let section: HTMLElement
let trigger: HTMLButtonElement
let dialog: FakeDialog
let hostApp: FakeHostApp
let removalCount: number

function installHostApp(): void {
  ;(window as unknown as { Application?: unknown }).Application = hostApp
}

/** 造一个「宿主 + 区块 + 触发按钮」的最小页面 */
function mountPage(): void {
  document.body.replaceChildren()
  host = document.createElement('div')
  section = document.createElement('section')
  section.id = 'sec-existing'
  section.textContent = '表格本体'
  trigger = document.createElement('button')
  trigger.id = 'trigger-btn'
  host.append(section, trigger)
  document.body.append(host)
}

beforeEach(() => {
  resetDetachablePanelsForTest()
  removalCount = 0
  dialog = { Visible: false, ID: 7 }
  dialog.Delete = () => {
    removalCount += 1
    dialog.Visible = false
  }
  hostApp = {
    CreateWebDialog: () => dialog,
    GetWebDialog: () => dialog,
  }
  installHostApp()
  mountPage()
})

afterEach(() => {
  vi.useRealTimers()
  resetDetachablePanelsForTest()
})

/** 注册一个 native 模式面板 */
function createNative(): ReturnType<typeof createDetachablePanel> {
  return createDetachablePanel(section, {
    title: '工作表规则',
    mode: 'native',
    nativeUrl: './manager.html',
    trigger,
  })
}

describe('native 模式：拖出去', () => {
  it('区块原地隐藏 + 留占位块（不是搬进窗格内的浮动窗口）', () => {
    createNative()
    trigger.click()

    // 区块本体留在页面上、被隐藏：另一个 WebView 搬不走它
    expect(section.parentElement).toBe(host)
    expect(section.classList.contains('detachable-detached')).toBe(true)
    // 占位块顶在原位置，否则正文塌陷一大块
    expect(host.querySelector(`.${PLACEHOLDER_CLASS}`)).not.toBeNull()
    // 开了窗口并置为可见 + 非模态
    expect(dialog.Visible).toBe(true)
  })

  it('再点一次收回：窗口被关闭（Delete）、区块与占位块复原', () => {
    createNative()
    trigger.click()
    trigger.click()

    expect(removalCount).toBe(1)
    expect(section.classList.contains('detachable-detached')).toBe(false)
    expect(host.querySelector(`.${PLACEHOLDER_CLASS}`)).toBeNull()
  })

  it('占位块上的「收回」按钮同样能放回去', () => {
    createNative()
    trigger.click()
    const recall = host.querySelector<HTMLButtonElement>(`.${PLACEHOLDER_CLASS} button`)
    expect(recall).not.toBeNull()
    recall?.click()

    expect(removalCount).toBe(1)
    expect(section.classList.contains('detachable-detached')).toBe(false)
  })

  it('窗口已开着时再点是「收回」而不是再开一个（否则叠一屏窗口）', () => {
    let creationCount = 0
    hostApp.CreateWebDialog = () => {
      creationCount += 1
      return dialog
    }
    createNative()
    // 开
    trigger.click()
    // 收回（此时窗口还活着，不该再开一个）
    trigger.click()

    expect(creationCount).toBe(1)
    expect(removalCount).toBe(1)
    expect(section.classList.contains('detachable-detached')).toBe(false)
  })
})

describe('native 模式：放回来', () => {
  it('用户在 WPS 里关掉窗口 → 轮询发现 → 自动收回（否则占位块永久卡住）', () => {
    vi.useFakeTimers()
    createNative()
    trigger.click()
    expect(section.classList.contains('detachable-detached')).toBe(true)

    // 宿主侧窗口没了（用户点了系统关闭按钮），任务窗格收不到任何事件。
    // 轮询间隔 2s（NATIVE_POLL_INTERVAL）：推进两轮内必须发现并收回。
    hostApp.GetWebDialog = () => null
    vi.advanceTimersByTime(2000)

    expect(section.classList.contains('detachable-detached')).toBe(false)
    expect(host.querySelector(`.${PLACEHOLDER_CLASS}`)).toBeNull()
  })

  it('窗口还开着时轮询不会误收回', () => {
    vi.useFakeTimers()
    createNative()
    trigger.click()
    vi.advanceTimersByTime(3000)
    expect(section.classList.contains('detachable-detached')).toBe(true)
  })

  it('收回后停止轮询（不再空转查 COM）', () => {
    vi.useFakeTimers()
    const getWebDialog = vi.fn(() => dialog)
    hostApp.GetWebDialog = getWebDialog
    createNative()
    trigger.click()
    // 收回：close() 自己会查一次句柄，之后必须停表
    trigger.click()
    const afterClose = getWebDialog.mock.calls.length
    vi.advanceTimersByTime(3000)
    expect(getWebDialog.mock.calls.length).toBe(afterClose)
  })
})

describe('native 模式：宿主不支持时回落', () => {
  it('两条通路都没有 → 退回窗格内浮动窗口，功能不丢', () => {
    hostApp = {}
    installHostApp()
    createNative()
    trigger.click()

    // 走的是 float：区块被搬进 .detachable-panel 的 body
    const panel = document.querySelector('.detachable-panel')
    expect(panel).not.toBeNull()
    expect(section.parentElement?.classList.contains('detachable-panel-body')).toBe(true)
    // 占位块同样要有
    expect(host.querySelector(`.${PLACEHOLDER_CLASS}`)).not.toBeNull()
  })

  it('只有老接口 ShowDialog 时也能开（降级但不失效）', () => {
    const showDialog = vi.fn(() => dialog)
    hostApp = { ShowDialog: showDialog }
    installHostApp()
    createNative()
    trigger.click()

    expect(showDialog).toHaveBeenCalled()
    expect(section.classList.contains('detachable-detached')).toBe(true)
  })
})
