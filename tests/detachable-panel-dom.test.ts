// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/components/detachable-panel.ts` DOM 装配单测（jsdom）
 *
 * 纯函数那半边在 `detachable-panel.test.ts`（Node 直跑）；这里补 DOM 侧两条
 * 真机踩过的行为：
 *
 * 1. **占位块继承原区块的栅格 Span 与高度** —— 各页 `.main` 在宽断点下是
 *    `display: grid`，占位块若是个光秃秃的 div，通栏区块会塌成窄格、行高整体
 *    重算，用户看到「拖出后原页面布局坏了」（内容其实一块没丢）。
 * 2. **标题栏右键菜单** —— 关闭窗口 / 收起 / 最大化 / 关闭所有，四项都与标题栏
 *    按钮同一套回调；「关闭」= 还原到页面原位（内容是搬进去的，必须搬回来）。
 *
 * jsdom 不实现布局：`getBoundingClientRect` 恒为 0、`getComputedStyle` 不认
 * grid 简写。两者都在用例里打桩，只验「组件有没有把量到的值写进占位块」，
 * 不验浏览器最终怎么排。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  PANEL_CLASS,
  PLACEHOLDER_CLASS,
  WINDOW_MENU_CLASS,
  closeAllDetachedPanels,
  createDetachablePanel,
  resetDetachablePanelsForTest,
} from '../ts/ui/components/detachable-panel.js'

/** 取单个元素（取不到即失败，不做可选链——测试里「元素不在」就该红） */
function one(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`找不到元素: ${selector}`)
  return found
}

/** 造一个带标题的 section，挂到 main 上（homeParent 必须连通，占位块才插得进去） */
function makeSection(id: string, title = '执行前预览'): HTMLElement {
  document.body.replaceChildren()
  const main = document.createElement('main')
  main.className = 'main'
  document.body.append(main)
  const section = document.createElement('section')
  section.id = id
  section.className = 'section'
  section.dataset.detachable = 'true'
  section.dataset.detachableTitle = title
  const heading = document.createElement('h3')
  heading.textContent = title
  section.append(heading)
  main.append(section)
  return section
}

/** 在窗口标题栏上派发 contextmenu */
function rightClickHeader(): void {
  one(`.${PANEL_CLASS}-header`).dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 30 }),
  )
}

/** 菜单里按文案找一项 */
function findMenuItem(keyword: string): HTMLButtonElement {
  const items = [...one(`.${WINDOW_MENU_CLASS}`).querySelectorAll<HTMLButtonElement>('button')]
  const found = items.find((item) => item.textContent.includes(keyword))
  if (!found) throw new Error(`菜单里没有含「${keyword}」的项`)
  return found
}

/** 取菜单所有项的文案 */
function menuLabels(): (string | null)[] {
  return [...one(`.${WINDOW_MENU_CLASS}`).querySelectorAll('button')].map(
    (button) => button.textContent,
  )
}

/** 打桩：让 jsdom 的 getBoundingClientRect / getComputedStyle 返回可断言的值 */
function stubLayout(height: number, gridColumn = 'auto / auto', gridRow = 'auto / auto'): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    height,
    width: 300,
    top: 0,
    left: 0,
    right: 300,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    gridColumn,
    gridRow,
  } as CSSStyleDeclaration)
}

beforeEach(() => {
  resetDetachablePanelsForTest()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('占位块继承原区块布局', () => {
  it('通栏区块（grid-column: 1 / -1）拖出后，占位块继承 Span 与高度', () => {
    stubLayout(320, '1 / -1')
    const section = makeSection('sec-preview')
    const handle = createDetachablePanel(section)
    expect(handle).not.toBeNull()

    handle!.detach()

    const placeholder = one(`.${PLACEHOLDER_CLASS}`)
    // 高度：原区块 320px，占位块不能塌成 40px（否则下方内容整体上跳）
    expect(placeholder.style.minHeight).toBe('320px')
    // Span：通栏区块继承 1 / -1，否则塌成一个窄格、同行区块被挤走
    expect(placeholder.style.gridColumn).toBe('1 / -1')
  })

  it('普通单格区块（auto / auto）不继承 Span，只继承高度', () => {
    stubLayout(180)
    const section = makeSection('sec-plain')
    const handle = createDetachablePanel(section)

    handle!.detach()

    const placeholder = one(`.${PLACEHOLDER_CLASS}`)
    expect(placeholder.style.minHeight).toBe('180px')
    // auto / auto 是默认值，写上去反而钉死栅格自动放置，还原后可能对不上
    expect(placeholder.style.gridColumn).toBe('')
  })

  it('显式 grid-row 也一并继承', () => {
    stubLayout(240, 'auto / auto', '2 / 4')
    const section = makeSection('sec-rows')
    const handle = createDetachablePanel(section)

    handle!.detach()

    expect(one(`.${PLACEHOLDER_CLASS}`).style.gridRow).toBe('2 / 4')
  })

  it('取不到计算样式时不写内联样式（塌一点比整页崩好）', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => {
      throw new Error('host gone')
    })
    const section = makeSection('sec-broken')
    const handle = createDetachablePanel(section)

    expect(() => handle!.detach()).not.toThrow()
    expect(one(`.${PLACEHOLDER_CLASS}`).style.minHeight).toBe('')
  })

  it('还原后占位块被移除，原区块回到 main 里', () => {
    stubLayout(200)
    const section = makeSection('sec-preview')
    const handle = createDetachablePanel(section)

    handle!.detach()
    expect(document.querySelector(`.${PLACEHOLDER_CLASS}`)).not.toBeNull()

    handle!.attach()
    expect(document.querySelector(`.${PLACEHOLDER_CLASS}`)).toBeNull()
    expect(one('main.main').contains(section)).toBe(true)
  })
})

describe('标题栏右键菜单', () => {
  it('右键标题栏弹出菜单，含关闭 / 收起 / 最大化 / 关闭所有', () => {
    stubLayout(200)
    const section = makeSection('sec-preview')
    const handle = createDetachablePanel(section)
    handle!.detach()

    rightClickHeader()

    const labels = menuLabels()
    expect(labels.some((text) => text?.includes('关闭窗口'))).toBe(true)
    expect(labels.some((text) => text?.includes('收起'))).toBe(true)
    expect(labels.some((text) => text?.includes('最大化'))).toBe(true)
    expect(labels.some((text) => text?.includes('关闭所有浮动窗口'))).toBe(true)
  })

  it('点「关闭窗口」= 内容还原到页面原位（不是销毁）', () => {
    stubLayout(200)
    const section = makeSection('sec-preview')
    const handle = createDetachablePanel(section)
    handle!.detach()
    expect(handle!.isDetached()).toBe(true)

    rightClickHeader()
    findMenuItem('关闭窗口').click()

    expect(handle!.isDetached()).toBe(false)
    expect(document.querySelector(`.${WINDOW_MENU_CLASS}`)).toBeNull()
    // 内容必须还在：搬去了窗口就得搬回来，不能凭空消失
    expect(one('main.main').contains(section)).toBe(true)
  })

  it('点菜单外任意处菜单收起，但不影响窗口本身', () => {
    stubLayout(200)
    const section = makeSection('sec-preview')
    const handle = createDetachablePanel(section)
    handle!.detach()

    rightClickHeader()
    expect(document.querySelector(`.${WINDOW_MENU_CLASS}`)).not.toBeNull()

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(document.querySelector(`.${WINDOW_MENU_CLASS}`)).toBeNull()
    expect(handle!.isDetached()).toBe(true)
  })

  it('收起状态下右键，菜单文案变成「展开」', () => {
    stubLayout(200)
    const section = makeSection('sec-preview')
    const handle = createDetachablePanel(section)
    handle!.detach()

    // 走标题栏的收起按钮（与菜单同一回调）
    one(`.${PANEL_CLASS}-icon-btn`).click()
    rightClickHeader()

    const labels = menuLabels()
    expect(labels.some((text) => text?.includes('展开'))).toBe(true)
    expect(labels.some((text) => text?.includes('收起'))).toBe(false)
  })
})

describe('closeAllDetachedPanels', () => {
  it('一次关掉所有已拖出的窗口，返回关闭数量', () => {
    stubLayout(200)
    const first = makeSection('sec-a')
    const second = makeSection('sec-b')
    const handleA = createDetachablePanel(first)
    const handleB = createDetachablePanel(second)
    handleA!.detach()
    handleB!.detach()

    expect(closeAllDetachedPanels()).toBe(2)
    expect(handleA!.isDetached()).toBe(false)
    expect(handleB!.isDetached()).toBe(false)
    expect(document.querySelector(`.${PLACEHOLDER_CLASS}`)).toBeNull()
  })

  it('没有拖出的窗口时返回 0，不抛错', () => {
    expect(closeAllDetachedPanels()).toBe(0)
  })

  it('只拖出一个时只关那一个', () => {
    stubLayout(200)
    const first = makeSection('sec-a')
    const second = makeSection('sec-b')
    const handleA = createDetachablePanel(first)
    const handleB = createDetachablePanel(second)
    handleA!.detach()

    expect(closeAllDetachedPanels()).toBe(1)
    expect(handleA!.isDetached()).toBe(false)
    expect(handleB!.isDetached()).toBe(false)
  })
})
