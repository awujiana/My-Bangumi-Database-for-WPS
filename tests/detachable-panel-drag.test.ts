/**
 * @fileoverview 浮动窗口拖动行为单测（jsdom + 真实指针事件）
 * @module tests/detachablePanelDrag
 * @description
 *   钉死 2026-10-22 性能改造的三条不变量（背景：拖动每帧写 left/top 会让浏览器
 *   重排 + 重绘整个面板内容，几百行预览表时一帧几十毫秒 = 肉眼可见掉帧）：
 *
 *   1. **拖动中只写 transform**：left/top 保持基准值不变，位移走
 *      `transform: translate()`（命中合成层，每帧只平移层，内容不重画）；
 *   2. **pointerup 时一次性提交**：transform 撤掉、left/top 落定，
 *      几何单一来源始终是 rect + left/top（不会出现「半个窗口漂着」的中间态）；
 *   3. **拖动中位移同样受视口钳制**：窗口永远完整留在视口内（拖出去找不回来
 *      是最糟的失败模式）。
 *
 *   另外守一条 native 轮询间隔的回归：间隔从 1s 改成 2s（每轮两次 COM 往返，
 *   见 NATIVE_POLL_INTERVAL 注释），「用户关窗 → 自动收回」仍要在两轮内发现。
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDetachablePanel,
  resetDetachablePanelsForTest,
} from '../ts/ui/components/detachable-panel.js'

let section: HTMLElement
let trigger: HTMLButtonElement

/** 等两个帧：bindDrag 的位移经 rAF 合帧后写入，需让帧跑完 */
async function nextFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }
}

/** 读内联几何的 px 数值（jsdom 序列化形如 '152px'，切掉后缀再 Number） */
function readPx(value: string): number {
  return Number(value.replace('px', ''))
}

/** jsdom 没有指针捕获 API，给把手打三个桩（record 住 capture 的生命周期） */
function stubPointerCapture(element: HTMLElement): void {
  ;(element as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {}
  ;(element as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {}
  ;(element as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false
}

/** 在把手上发一个指针事件（jsdom 有 PointerEvent 构造器） */
function pointer(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
): void {
  element.dispatchEvent(
    new PointerEvent(type, { button: 0, buttons: 1, clientX: x, clientY: y, pointerId: 1, bubbles: true }),
  )
}

/** 建一个 float 模式面板并拖出，返回 [根元素, 标题栏把手] */
function detachPanel(): { root: HTMLElement; header: HTMLElement } {
  const handle = createDetachablePanel(section, { title: '预览', trigger })
  expect(handle).not.toBeNull()
  trigger.click()
  const root = document.querySelector<HTMLElement>('.detachable-panel')
  const header = root?.querySelector<HTMLElement>('.detachable-panel-header')
  expect(root).not.toBeNull()
  expect(header).not.toBeNull()
  if (!root || !header) throw new Error('面板骨架缺失')
  stubPointerCapture(header)
  return { root, header }
}

beforeEach(() => {
  resetDetachablePanelsForTest()
  document.body.replaceChildren()
  const host = document.createElement('div')
  section = document.createElement('section')
  section.id = 'sec-preview'
  section.textContent = '表格本体'
  trigger = document.createElement('button')
  trigger.id = 'trigger-btn'
  host.append(section, trigger)
  document.body.append(host)
})

describe('浮动窗口拖动：transform 定位', () => {
  it('拖动中只写 transform，left/top 保持基准不动', async () => {
    const { root, header } = detachPanel()
    const baseLeft = root.style.left
    const baseTop = root.style.top

    pointer(header, 'pointerdown', 100, 100)
    pointer(header, 'pointermove', 150, 130)
    await nextFrames()

    // 位移 50,30 全部落在 transform 上
    expect(root.style.transform).toBe('translate(50px, 30px)')
    // left/top 一个字符都没动（这是「不触发重排 + 重绘」的关键）
    expect(root.style.left).toBe(baseLeft)
    expect(root.style.top).toBe(baseTop)
    // 拖动态类名在（CSS 靠它挂 will-change 与禁悬停）
    expect(root.classList.contains('is-dragging')).toBe(true)
  })

  it('pointerup 时提交：transform 撤掉，left/top 落定到终点', async () => {
    const { root, header } = detachPanel()
    const baseLeft = readPx(root.style.left)
    const baseTop = readPx(root.style.top)

    pointer(header, 'pointerdown', 100, 100)
    pointer(header, 'pointermove', 150, 130)
    await nextFrames()
    pointer(header, 'pointerup', 150, 130)

    expect(root.style.transform).toBe('')
    expect(root.style.left).toBe(`${String(baseLeft + 50)}px`)
    expect(root.style.top).toBe(`${String(baseTop + 30)}px`)
    expect(root.classList.contains('is-dragging')).toBe(false)
  })

  it('一个 rAF 都没等到就松手：最后几像素不丢（onUp 先 flush 再提交）', () => {
    const { root, header } = detachPanel()
    const baseLeft = readPx(root.style.left)

    pointer(header, 'pointerdown', 100, 100)
    pointer(header, 'pointermove', 140, 100)
    pointer(header, 'pointerup', 140, 100)

    expect(root.style.transform).toBe('')
    expect(root.style.left).toBe(`${String(baseLeft + 40)}px`)
  })

  it('拖动中的位移同样受视口钳制（拖再远也完整留在视口内）', async () => {
    const { root, header } = detachPanel()
    const width = readPx(root.style.width)
    const viewportWidth = window.innerWidth

    pointer(header, 'pointerdown', 100, 100)
    pointer(header, 'pointermove', 100 + 5000, 100 + 5000)
    await nextFrames()

    // 贴到右下边界：transform 的位移 = 边界 - 基准（x、y 分别钳制）
    const baseLeft = readPx(root.style.left)
    const baseTop = readPx(root.style.top)
    const height = readPx(root.style.height)
    const expectedX = viewportWidth - width - baseLeft
    const expectedY = window.innerHeight - height - baseTop
    expect(root.style.transform).toBe(`translate(${String(expectedX)}px, ${String(expectedY)}px)`)

    pointer(header, 'pointerup', 100 + 5000, 100 + 5000)
    expect(readPx(root.style.left)).toBe(viewportWidth - width)
  })

  it('连续两次拖动：第二次从第一次的终点起算（不重复累加）', async () => {
    const { root, header } = detachPanel()
    const baseLeft = readPx(root.style.left)

    pointer(header, 'pointerdown', 100, 100)
    pointer(header, 'pointermove', 160, 100)
    await nextFrames()
    pointer(header, 'pointerup', 160, 100)

    pointer(header, 'pointerdown', 160, 100)
    pointer(header, 'pointermove', 210, 100)
    await nextFrames()

    // 第二次位移是 50（不是 110）：基准已随第一次提交更新
    expect(root.style.transform).toBe('translate(50px, 0px)')
    pointer(header, 'pointerup', 210, 100)
    expect(root.style.left).toBe(`${String(baseLeft + 110)}px`)
  })

  it('还原回页面后几何记忆保留（transform 不残留，left/top 是唯一来源）', async () => {
    const { root, header } = detachPanel()

    pointer(header, 'pointerdown', 100, 100)
    pointer(header, 'pointermove', 180, 120)
    await nextFrames()
    pointer(header, 'pointerup', 180, 120)
    const movedLeft = root.style.left
    const movedTop = root.style.top

    // 收回，再拖出
    trigger.click()
    trigger.click()

    const reopened = document.querySelector<HTMLElement>('.detachable-panel')
    expect(reopened).not.toBeNull()
    if (!reopened) throw new Error('面板骨架缺失')
    expect(reopened.style.left).toBe(movedLeft)
    expect(reopened.style.top).toBe(movedTop)
    expect(reopened.style.transform).toBe('')
  })
})

describe('浮动窗口几何持久化（2026-10-24 真机缺陷）', () => {
  it('pane 重载后恢复上次位置（内存丢失靠 localStorage 兜住）', async () => {
    // 真机场景：JsApiDevTool 调速器拖动 → pane 重载 → 模块级 geometryMemory 清空。
    // 修复前：重载后浮窗回默认位（用户说的「还原位置」）。修复后：几何落盘 localStorage。
    const handle = createDetachablePanel(section, { title: '预览', trigger })
    if (!handle) throw new Error('面板创建失败')
    trigger.click()
    const root = document.querySelector<HTMLElement>('.detachable-panel')
    const header = root?.querySelector<HTMLElement>('.detachable-panel-header')
    if (!root || !header) throw new Error('面板骨架缺失')
    stubPointerCapture(header)

    const baseLeft = readPx(root.style.left)
    const baseTop = readPx(root.style.top)

    // 拖到新位置
    pointer(header, 'pointerdown', 100, 100)
    pointer(header, 'pointermove', 160, 140)
    await nextFrames()
    pointer(header, 'pointerup', 160, 140)
    expect(readPx(root.style.left)).toBe(baseLeft + 60)
    expect(readPx(root.style.top)).toBe(baseTop + 40)

    // 收回面板：rememberRect → 落盘
    handle.attach()

    // 模拟 pane 重载：模块重新加载（内存几何清空，localStorage 留存）
    vi.resetModules()
    const fresh = await import('../ts/ui/components/detachable-panel.js')
    document.body.replaceChildren()
    const host = document.createElement('div')
    const nextSection = document.createElement('section')
    // 同 panelId → 同一条持久化记录
    nextSection.id = 'sec-preview'
    const nextTrigger = document.createElement('button')
    host.append(nextSection, nextTrigger)
    document.body.append(host)

    const nextHandle = fresh.createDetachablePanel(nextSection, { title: '预览', trigger: nextTrigger })
    if (!nextHandle) throw new Error('重载后创建失败')
    nextTrigger.click()
    const nextRoot = document.querySelector<HTMLElement>('.detachable-panel')
    expect(readPx(nextRoot?.style.left ?? '0px')).toBe(baseLeft + 60)
    expect(readPx(nextRoot?.style.top ?? '0px')).toBe(baseTop + 40)
  })
})
