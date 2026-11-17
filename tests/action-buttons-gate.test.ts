// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/action-buttons-gate.ts` 单元测试。
 *
 * 这组用例守的是一条**真机踩过的坑**（2026-10-20）：cf / highlight / clean 三页的
 * `initializeXxxPage()` 忘了派发 `bgm:modulesReady`，门禁只能等 5s 超时兜底，
 * 表现为「页面打开后按钮灰 5 秒」，控制台只剩一条容易被当噪声的 warn。
 *
 * 因此这里断言三件事：
 * 1. 安装后按钮立刻禁用（防误点未初始化的处理逻辑）；
 * 2. 页面调 `notifyModulesReady()` 后立刻启用（正常路径）；
 * 3. 事件一直不来时 5s 兜底强开（脚本 404 / 语法错误时不能永久禁用）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 每个用例都重新加载模块：`pageLogTag` 是模块级状态，跨用例会串味 */
async function loadGate() {
  vi.resetModules()
  return import('../ts/panel/action-buttons-gate.js')
}

function mountButtons(): HTMLButtonElement[] {
  document.body.innerHTML = `
    <button data-action="apply">应用</button>
    <button data-action="clear">清除</button>
    <button>无 data-action，不该被门禁管理</button>
  `
  return [...document.querySelectorAll<HTMLButtonElement>('button[data-action]')]
}

describe('installActionButtonsGate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('安装后 data-action 按钮全部禁用，普通按钮不受影响', async () => {
    const buttons = mountButtons()
    const plain = document.querySelector<HTMLButtonElement>('button:not([data-action])')
    const { installActionButtonsGate } = await loadGate()

    installActionButtonsGate('[测试]')

    expect(buttons.every((button) => button.disabled)).toBe(true)
    expect(plain?.disabled).toBe(false)
  })

  it('notifyModulesReady 后按钮立即启用，不等超时', async () => {
    const buttons = mountButtons()
    const { installActionButtonsGate, notifyModulesReady } = await loadGate()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    installActionButtonsGate('[测试]')
    notifyModulesReady()

    expect(buttons.every((button) => button.disabled)).toBe(false)
  })

  it('日志前缀由 installActionButtonsGate 登记，页面侧不必重复传', async () => {
    mountButtons()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { installActionButtonsGate, notifyModulesReady } = await loadGate()

    installActionButtonsGate('[BGM ConditionalFormat]')
    notifyModulesReady()

    expect(logSpy).toHaveBeenCalledWith('[BGM ConditionalFormat] 模块就绪事件已派发')
  })

  it('5s 内没收到事件时兜底强开并 warn（脚本 404 不能让按钮永久失效）', async () => {
    const buttons = mountButtons()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { installActionButtonsGate } = await loadGate()

    installActionButtonsGate('[测试]')
    expect(buttons.every((button) => button.disabled)).toBe(true)

    vi.advanceTimersByTime(4999)
    expect(buttons.every((button) => button.disabled)).toBe(true)

    vi.advanceTimersByTime(1)
    expect(buttons.every((button) => button.disabled)).toBe(false)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('事件先到则超时不再重复告警', async () => {
    mountButtons()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { installActionButtonsGate, notifyModulesReady } = await loadGate()

    installActionButtonsGate('[测试]')
    notifyModulesReady()
    vi.advanceTimersByTime(5000)

    expect(warnSpy).not.toHaveBeenCalled()
  })
})
