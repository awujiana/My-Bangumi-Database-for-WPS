// @vitest-environment jsdom
/**
 * @fileoverview `ts/tools/shortcuts.ts` 全局快捷键单测
 *
 * 守住的东西：
 * 1. 组合串规范化：修饰键固定顺序（Ctrl+Shift+K 与 Shift+Ctrl+K 必须同串，
 *    否则冲突检测形同虚设）、只按修饰键不算组合、特殊键有稳定展示名；
 * 2. 绑定存储：默认值合并、改绑只存差异、与默认值相同则不留差异、清空存空串；
 * 3. 冲突在写入侧拦掉并指出占用者（落盘就会「时灵时不灵」）；
 * 4. 分发器：命中即执行并阻止默认行为；总开关关闭 / 焦点在输入框时放行；
 * 5. 侧栏鼠标手势：中键 → 专注、Ctrl+左键 → 隐藏（按页取 body[data-page]）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  store: new Map<string, string>(),
  openedPanels: [] as string[],
  soloCalls: [] as [string, string][],
  exitSoloCount: 0,
  hiddenCalls: [] as [string, string][],
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
    /* 日志不参与断言 */
  },
  showBangumiPanel: (): void => {
    mockState.openedPanels.push('bangumi')
  },
  showEnrichPanel: (): void => {
    mockState.openedPanels.push('enrich')
  },
  showCleanPanel: (): void => {
    mockState.openedPanels.push('clean')
  },
  showHighlightPanel: (): void => {
    mockState.openedPanels.push('highlight')
  },
  showConditionalFormatPanel: (): void => {
    mockState.openedPanels.push('conditionalFormat')
  },
  showSettingsPanel: (): void => {
    mockState.openedPanels.push('settings')
  },
}))

vi.mock('../ts/tools/module-state.js', () => ({
  applyModuleState: (): void => {
    /* 只验调用目标，不验 DOM 结果 */
  },
  enterSoloMode: (page: string, moduleId: string): void => {
    mockState.soloCalls.push([page, moduleId])
  },
  exitSoloMode: (): void => {
    mockState.exitSoloCount += 1
  },
  isSoloMode: (): boolean => false,
  toggleModuleHidden: (page: string, moduleId: string): void => {
    mockState.hiddenCalls.push([page, moduleId])
  },
}))

import {
  areShortcutsEnabled,
  describeShortcut,
  findShortcutConflicts,
  getMouseShortcuts,
  getShortcutBindings,
  MOUSE_ACTION_LABELS,
  normalizeKeyboardEvent,
  resetAllShortcutBindings,
  resetShortcutBinding,
  setMouseShortcut,
  setShortcutBinding,
  setShortcutsEnabled,
  SHORTCUT_ACTIONS,
  startShortcutDispatcher,
} from '../ts/tools/shortcuts.js'

/** 造一个键盘事件（jsdom 的 KeyboardEvent 已支持修饰键选项） */
function keydown(options: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, ...options })
}

let cleanupDispatcher: (() => void) | null = null

beforeEach(() => {
  mockState.store.clear()
  mockState.openedPanels.length = 0
  mockState.soloCalls.length = 0
  mockState.hiddenCalls.length = 0
  mockState.exitSoloCount = 0
  document.body.replaceChildren()
  document.body.dataset.page = 'panel'
})

afterEach(() => {
  cleanupDispatcher?.()
  cleanupDispatcher = null
})

describe('normalizeKeyboardEvent', () => {
  it('修饰键固定顺序，与按下的先后无关', () => {
    expect(normalizeKeyboardEvent(keydown({ key: 'k', ctrlKey: true, shiftKey: true }))).toBe(
      'Ctrl+Shift+K',
    )
    expect(normalizeKeyboardEvent(keydown({ key: 'K', shiftKey: true, ctrlKey: true }))).toBe(
      'Ctrl+Shift+K',
    )
  })

  it('只按修饰键不算组合', () => {
    expect(normalizeKeyboardEvent(keydown({ key: 'Alt', altKey: true }))).toBe('')
    expect(normalizeKeyboardEvent(keydown({ key: 'Control', ctrlKey: true }))).toBe('')
  })

  it('特殊键用稳定展示名', () => {
    expect(normalizeKeyboardEvent(keydown({ key: ' ' }))).toBe('Space')
    expect(normalizeKeyboardEvent(keydown({ key: 'ArrowUp' }))).toBe('Up')
    expect(normalizeKeyboardEvent(keydown({ key: 'Escape' }))).toBe('Esc')
  })

  it('数字键直接取字符（Alt+1）', () => {
    expect(normalizeKeyboardEvent(keydown({ key: '1', altKey: true }))).toBe('Alt+1')
  })
})

describe('describeShortcut', () => {
  it('空串显示为「未绑定」', () => {
    expect(describeShortcut('')).toBe('未绑定')
    expect(describeShortcut('Alt+1')).toBe('Alt+1')
  })
})

describe('绑定读写', () => {
  it('默认返回注册表里的默认组合', () => {
    const bindings = getShortcutBindings()
    expect(Object.keys(bindings)).toHaveLength(SHORTCUT_ACTIONS.length)
    expect(bindings['nav.settings']).toBe('Alt+6')
  })

  it('改绑只写差异，未改的动作仍走默认值', () => {
    expect(setShortcutBinding('nav.settings', 'Ctrl+Shift+S').ok).toBe(true)
    const stored = JSON.parse(mockState.store.get('bgm_shortcut_bindings') ?? '{}') as Record<
      string,
      string
    >
    expect(stored).toEqual({ 'nav.settings': 'Ctrl+Shift+S' })
    expect(getShortcutBindings()['nav.settings']).toBe('Ctrl+Shift+S')
    expect(getShortcutBindings()['nav.clean']).toBe('Alt+3')
  })

  it('改回默认值时把差异删掉（不留一条与默认相同的记录）', () => {
    setShortcutBinding('nav.settings', 'Ctrl+Shift+S')
    setShortcutBinding('nav.settings', 'Alt+6')
    const stored = JSON.parse(mockState.store.get('bgm_shortcut_bindings') ?? '{}') as Record<
      string,
      string
    >
    expect(stored).toEqual({})
  })

  it('冲突的组合拒绝写入并返回占用者', () => {
    const result = setShortcutBinding('nav.clean', 'Alt+1')
    expect(result.ok).toBe(false)
    expect(result.conflictWith).toBe('nav.bangumi')
    expect(getShortcutBindings()['nav.clean']).toBe('Alt+3')
  })

  it('清空绑定存空串（表示「这个动作不绑键」）', () => {
    expect(setShortcutBinding('nav.enrich', '').ok).toBe(true)
    expect(getShortcutBindings()['nav.enrich']).toBe('')
  })

  it('未知动作 id 不写盘', () => {
    expect(setShortcutBinding('nav.unknown', 'Alt+9').ok).toBe(false)
    expect(mockState.store.has('bgm_shortcut_bindings')).toBe(false)
  })

  it('单个 / 全部恢复默认', () => {
    setShortcutBinding('nav.settings', 'Ctrl+Shift+S')
    expect(resetShortcutBinding('nav.settings')).toBe(true)
    expect(getShortcutBindings()['nav.settings']).toBe('Alt+6')

    setShortcutBinding('nav.settings', 'Ctrl+Shift+S')
    setShortcutBinding('nav.clean', 'Ctrl+Shift+C')
    expect(resetAllShortcutBindings()).toBe(true)
    expect(getShortcutBindings()['nav.settings']).toBe('Alt+6')
    expect(getShortcutBindings()['nav.clean']).toBe('Alt+3')
  })
})

describe('findShortcutConflicts', () => {
  it('找出被两个动作共用的组合，空串不计入', () => {
    const conflicts = findShortcutConflicts({
      'nav.bangumi': 'Alt+1',
      'nav.clean': 'Alt+1',
      'nav.enrich': '',
      'nav.highlight': '',
    })
    expect(conflicts).toEqual([{ combo: 'Alt+1', actionIds: ['nav.bangumi', 'nav.clean'] }])
  })

  it('没有重复组合时返回空数组', () => {
    expect(findShortcutConflicts({ 'nav.bangumi': 'Alt+1', 'nav.clean': 'Alt+3' })).toEqual([])
  })
})

describe('总开关与鼠标手势配置', () => {
  it('默认开启；关闭后落盘 false', () => {
    expect(areShortcutsEnabled()).toBe(true)
    expect(setShortcutsEnabled(false)).toBe(true)
    expect(areShortcutsEnabled()).toBe(false)
  })

  it('鼠标手势默认中键专注、Ctrl+左键隐藏', () => {
    expect(getMouseShortcuts()).toEqual({ middle: 'solo', ctrlClick: 'hide' })
  })

  it('坏 JSON 逐槽回落默认值', () => {
    mockState.store.set('bgm_shortcut_mouse', 'not-json')
    expect(getMouseShortcuts()).toEqual({ middle: 'solo', ctrlClick: 'hide' })
    mockState.store.set('bgm_shortcut_mouse', JSON.stringify({ middle: 'boom' }))
    expect(getMouseShortcuts()).toEqual({ middle: 'none', ctrlClick: 'hide' })
  })

  it('改单个槽位不影响另一个', () => {
    expect(setMouseShortcut('middle', 'hide')).toBe(true)
    expect(getMouseShortcuts()).toEqual({ middle: 'hide', ctrlClick: 'hide' })
    expect(MOUSE_ACTION_LABELS.none).toBe('不响应')
  })
})

describe('分发器', () => {
  it('命中绑定 → 打开对应面板并阻止默认行为', () => {
    cleanupDispatcher = startShortcutDispatcher()
    const event = keydown({ key: '1', altKey: true })
    const preventDefault = vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)

    expect(mockState.openedPanels).toEqual(['bangumi'])
    expect(preventDefault).toHaveBeenCalled()
  })

  it('总开关关闭时不响应', () => {
    setShortcutsEnabled(false)
    cleanupDispatcher = startShortcutDispatcher()
    document.dispatchEvent(keydown({ key: '1', altKey: true }))
    expect(mockState.openedPanels).toEqual([])
  })

  it('焦点在输入框里时不抢键', () => {
    cleanupDispatcher = startShortcutDispatcher()
    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(keydown({ key: '1', altKey: true }))
    expect(mockState.openedPanels).toEqual([])
  })

  it('未绑定的组合不触发任何动作', () => {
    cleanupDispatcher = startShortcutDispatcher()
    document.dispatchEvent(keydown({ key: 'F9' }))
    expect(mockState.openedPanels).toEqual([])
  })

  it('重复调用不会重复绑定（幂等）', () => {
    cleanupDispatcher = startShortcutDispatcher()
    const second = startShortcutDispatcher()
    document.dispatchEvent(keydown({ key: '1', altKey: true }))
    expect(mockState.openedPanels).toEqual(['bangumi'])
    second()
  })
})

/** 建一条侧栏导航项 */
function mountNavLink(moduleId: string): HTMLAnchorElement {
  const nav = document.createElement('nav')
  nav.className = 'nav'
  const link = document.createElement('a')
  link.href = `#${moduleId}`
  nav.append(link)
  document.body.append(nav)
  return link
}

describe('侧栏鼠标手势', () => {

  it('中键点击导航项 → 进入专注模式（按 body[data-page] 取页面）', () => {
    cleanupDispatcher = startShortcutDispatcher()
    const link = mountNavLink('sec-preview')
    link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(mockState.soloCalls).toEqual([['panel', 'sec-preview']])
  })

  it('Ctrl + 左键点击导航项 → 隐藏该模块', () => {
    cleanupDispatcher = startShortcutDispatcher()
    const link = mountNavLink('sec-records')
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ctrlKey: true }))
    expect(mockState.hiddenCalls).toEqual([['panel', 'sec-records']])
  })

  it('普通左键点击不受影响（交给锚点跳转）', () => {
    cleanupDispatcher = startShortcutDispatcher()
    const link = mountNavLink('sec-preview')
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    expect(mockState.soloCalls).toEqual([])
    expect(mockState.hiddenCalls).toEqual([])
  })

  it('槽位设为「不响应」时该手势不生效', () => {
    setMouseShortcut('middle', 'none')
    cleanupDispatcher = startShortcutDispatcher()
    const link = mountNavLink('sec-preview')
    link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(mockState.soloCalls).toEqual([])
  })
})
