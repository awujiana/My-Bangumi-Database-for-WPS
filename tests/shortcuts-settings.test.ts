// @vitest-environment jsdom
/**
 * @fileoverview 设置页「⌨️ 快捷键」编辑器单测（ui/handlers/shortcuts-settings.ts）
 *
 * 守住的东西：
 * 1. 清单由注册表渲染（6 条），不依赖 HTML 手写行；
 * 2. 点组合按钮进入录制态 → 按下的键写入绑定并重渲染；
 * 3. 与其它动作重复的组合**不落盘**，并提示占用者（这是用户最容易踩的坑：
 *    冲突写进去后运行时按遍历顺序命中一个，表现为「快捷键时灵时不灵」）；
 * 4. Esc 取消录制、不写盘；
 * 5. 鼠标手势下拉的选项来自 MOUSE_ACTION_LABELS，change 后落盘。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  store: new Map<string, string>(),
  toasts: [] as [string, string][],
}))

vi.mock('../ts/index.js', () => ({
  LOG_LEVELS: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  bgmLog: (): void => {
    /* 日志不参与断言 */
  },
  showToast: (message: string, kind: string): void => {
    mockState.toasts.push([message, kind])
  },
}))

vi.mock('../ts/tools/config.js', () => ({
  CONFIG_KEYS: {
    SHORTCUTS_ENABLED: 'bgm_shortcuts_enabled',
    SHORTCUT_BINDINGS: 'bgm_shortcut_bindings',
    SHORTCUT_MOUSE: 'bgm_shortcut_mouse',
  },
  getConfig: (key: string, fallback = ''): string => mockState.store.get(key) ?? fallback,
  setConfig: (key: string, value: string): boolean => {
    mockState.store.set(key, value)
    return true
  },
}))

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: (): void => {
    /* 不参与断言 */
  },
  showBangumiPanel: (): void => undefined,
  showEnrichPanel: (): void => undefined,
  showCleanPanel: (): void => undefined,
  showHighlightPanel: (): void => undefined,
  showConditionalFormatPanel: (): void => undefined,
  showSettingsPanel: (): void => undefined,
}))

vi.mock('../ts/tools/module-state.js', () => ({
  applyModuleState: (): void => undefined,
  enterSoloMode: (): void => undefined,
  exitSoloMode: (): void => undefined,
  isSoloMode: (): boolean => false,
  toggleModuleHidden: (): void => undefined,
}))

import { initializeShortcutSettings } from '../ts/ui/handlers/shortcuts-settings.js'
import { getShortcutBindings, SHORTCUT_ACTIONS } from '../ts/tools/shortcuts.js'

/** 造出设置页里快捷键模块的最小 DOM */
function buildDom(): void {
  document.body.innerHTML = `
    <div id="shortcutPanel">
      <input type="checkbox" id="chkShortcutsEnabled" />
      <div id="shortcutList"></div>
      <p id="shortcutConflicts" hidden></p>
      <div id="shortcutMouseRows"></div>
      <button type="button" data-shortcut-reset-all="1">全部恢复默认</button>
    </div>`
}

/** 当前某动作那一行的组合按钮 */
function keyButtonOf(actionId: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-shortcut-record="${CSS.escape(actionId)}"]`)
  if (button === null) throw new Error(`缺少 ${actionId} 的组合按钮`)
  return button
}

/** 在 window 上派发一次按键（录制监听挂在 window 捕获阶段） */
function pressKey(options: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...options }))
}

beforeEach(() => {
  mockState.store.clear()
  mockState.toasts.length = 0
  buildDom()
  initializeShortcutSettings()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('渲染', () => {
  it('每个动作一行，组合按钮显示当前绑定', () => {
    const rows = document.querySelectorAll('.shortcut-row')
    expect(rows).toHaveLength(SHORTCUT_ACTIONS.length)
    expect(keyButtonOf('nav.settings').textContent).toBe('Alt+6')
  })

  it('鼠标手势下拉：两个槽位，选项来自动作表', () => {
    const selects = document.querySelectorAll<HTMLSelectElement>('[data-shortcut-mouse]')
    expect(selects).toHaveLength(2)
    expect([...selects[0]!.options].map((option) => option.value)).toEqual(['none', 'solo', 'hide'])
    expect(selects[0]!.value).toBe('solo')
  })

  it('总开关按配置回填（默认开）', () => {
    const checkbox = document.getElementById('chkShortcutsEnabled')
    expect((checkbox as HTMLInputElement).checked).toBe(true)
  })
})

describe('录制改绑', () => {
  it('点组合按钮 → 进入录制态 → 按新组合落盘并重渲染', () => {
    keyButtonOf('nav.settings').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(keyButtonOf('nav.settings').textContent).toBe('按下按键…')

    pressKey({ key: 'k', ctrlKey: true, shiftKey: true })

    expect(getShortcutBindings()['nav.settings']).toBe('Ctrl+Shift+K')
    expect(keyButtonOf('nav.settings').textContent).toBe('Ctrl+Shift+K')
  })

  it('与其它动作重复的组合不落盘，并提示占用者', () => {
    keyButtonOf('nav.clean').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    pressKey({ key: '1', altKey: true })

    expect(getShortcutBindings()['nav.clean']).toBe('Alt+3')
    expect(mockState.toasts.some(([message]) => message.includes('已被「主面板」占用'))).toBe(true)
  })

  it('Esc 取消录制，不写盘', () => {
    keyButtonOf('nav.enrich').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    pressKey({ key: 'Escape' })

    expect(getShortcutBindings()['nav.enrich']).toBe('Alt+2')
    expect(keyButtonOf('nav.enrich').textContent).toBe('Alt+2')
  })

  it('恢复单个动作默认值', () => {
    keyButtonOf('nav.settings').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    pressKey({ key: 'k', ctrlKey: true })
    document
      .querySelector('[data-shortcut-reset="nav.settings"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(getShortcutBindings()['nav.settings']).toBe('Alt+6')
  })
})

describe('鼠标手势', () => {
  it('change 后写入配置', () => {
    const select = document.querySelector<HTMLSelectElement>('[data-shortcut-mouse="middle"]')
    if (select === null) throw new Error('缺少中键槽位')
    select.value = 'hide'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    const stored = JSON.parse(mockState.store.get('bgm_shortcut_mouse') ?? '{}') as Record<
      string,
      string
    >
    expect(stored.middle).toBe('hide')
  })
})
