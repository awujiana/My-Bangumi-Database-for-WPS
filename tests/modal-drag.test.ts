// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/components/modal-drag.ts` 模态框拖动单测（jsdom + 真实指针事件）
 *
 * 守住的东西（2026-10-24 用户实测：「条件格式编辑器浮动窗口无法拖动」）：
 * 1. 拖标题栏 → 模态框跟随位移（left/top = 基准矩形 + 位移，rAF 合帧）；
 * 2. **视口钳制**：横向允许露头但保证 ≥96px 可抓宽度，纵向钳在
 *    `[0, 视口高-40]`——「拖出去找不回来」是最糟的失败模式；
 * 3. 交互目标（标题栏里的按钮）/ 非主键不启动拖动；
 * 4. pointerup 补一次 flush：最后一个 rAF 没跑也不丢最后几像素；
 * 5. resetModalPosition 清回遮罩居中位；bringModalIntoView 只在越界时滚动，
 *    且滚动后重锚遮罩 top（遮罩是 absolute 相对文档的）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bindModalDrag,
  bringModalIntoView,
  resetModalPosition,
} from '../ts/ui/components/modal-drag.js'

/** 等两个帧：位移经 rAF 合帧后写入，需让帧跑完 */
async function nextFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }
}

/** 在元素 / window 上发指针事件 */
function pointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  button = 0,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      button,
      buttons: button === 0 ? 1 : 0,
      clientX: x,
      clientY: y,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    }),
  )
}

let modal: HTMLElement
let grip: HTMLElement
let mask: HTMLElement

beforeEach(() => {
  document.body.replaceChildren()
  mask = document.createElement('div')
  modal = document.createElement('div')
  modal.className = 'conditional-format-modal'
  grip = document.createElement('h4')
  modal.append(grip)
  mask.append(modal)
  document.body.append(mask)
  // 给模态框一个非零基准矩形（jsdom 默认全是 0）
  modal.getBoundingClientRect = () =>
    ({ top: 50, bottom: 350, left: 100, right: 500, width: 400, height: 300 }) as DOMRect
  bindModalDrag({ modal, grip })
})

describe('bindModalDrag：拖动', () => {
  it('拖标题栏按位移量改写 left/top', async () => {
    pointer(grip, 'pointerdown', 200, 100)
    pointer(window, 'pointermove', 260, 140)
    await nextFrames()

    // 100 + (260-200)
    expect(modal.style.left).toBe('160px')
    // 50 + (140-100)
    expect(modal.style.top).toBe('90px')
    expect(modal.classList.contains('is-dragged')).toBe(true)
  })

  it('pointerup 不等 rAF 也提交最后位移（收尾补 flush）', () => {
    pointer(grip, 'pointerdown', 200, 100)
    pointer(window, 'pointermove', 300, 200)
    pointer(window, 'pointerup', 300, 200)

    // 不等任何帧：onUp 里同步 flush 过
    expect(modal.style.left).toBe('200px')
    expect(modal.style.top).toBe('150px')
  })

  it('视口钳制：向上向左露头受限，但留住可抓宽度', async () => {
    pointer(grip, 'pointerdown', 200, 100)
    pointer(window, 'pointermove', -2200, -2100)
    await nextFrames()

    // 宽 400：minLeft = 96 - 400 = -304（允许露头，但至少 96px 可抓）
    expect(modal.style.left).toBe('-304px')
    // 顶不得高于视口顶
    expect(modal.style.top).toBe('0px')
  })

  it('视口钳制：向右向下不超出「留标题栏」边界', async () => {
    pointer(grip, 'pointerdown', 200, 100)
    pointer(window, 'pointermove', 5000, 5000)
    await nextFrames()

    expect(modal.style.left).toBe(`${String(window.innerWidth - 96)}px`)
    expect(modal.style.top).toBe(`${String(window.innerHeight - 40)}px`)
  })

  it('按在标题栏内的按钮上不启动拖动（按钮优先）', async () => {
    const button = document.createElement('button')
    grip.append(button)
    pointer(button, 'pointerdown', 210, 110)
    pointer(window, 'pointermove', 400, 300)
    await nextFrames()

    expect(modal.style.left).toBe('')
    expect(modal.style.top).toBe('')
  })

  it('非主键（右键）不启动拖动', async () => {
    pointer(grip, 'pointerdown', 200, 100, 2)
    pointer(window, 'pointermove', 300, 200)
    await nextFrames()

    expect(modal.style.left).toBe('')
  })

  it('pointercancel 也收尾（不卡在拖动态）', async () => {
    pointer(grip, 'pointerdown', 200, 100)
    pointer(window, 'pointermove', 260, 140)
    pointer(window, 'pointercancel', 260, 140)
    await nextFrames()

    expect(modal.style.left).toBe('160px')
    expect(modal.classList.contains('is-dragged')).toBe(true)
  })
})

describe('resetModalPosition', () => {
  it('清掉内联几何与 is-dragged，回到遮罩居中位', async () => {
    pointer(grip, 'pointerdown', 200, 100)
    pointer(window, 'pointermove', 260, 140)
    await nextFrames()
    expect(modal.style.left).not.toBe('')

    resetModalPosition(modal)

    expect(modal.style.left).toBe('')
    expect(modal.style.top).toBe('')
    expect(modal.style.position).toBe('')
    expect(modal.style.margin).toBe('')
    expect(modal.classList.contains('is-dragged')).toBe(false)
  })
})

describe('bringModalIntoView', () => {
  it('顶部越界：向下滚并把遮罩 top 重锚到新 scrollY', () => {
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true })
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    // 模态框顶在 -50（可见区上方 50px）
    modal.getBoundingClientRect = () =>
      ({ top: -50, bottom: 250, left: 0, right: 400, width: 400, height: 300 }) as DOMRect

    bringModalIntoView(mask, modal)

    // 8 - (-50) = 58
    expect(scrollBy).toHaveBeenCalledWith(0, 58)
    expect(mask.style.top).toBe('300px')
  })

  it('底部越界：向上滚并重锚遮罩', () => {
    Object.defineProperty(window, 'scrollY', { value: 100, configurable: true })
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    const bottom = window.innerHeight + 120
    modal.getBoundingClientRect = () =>
      ({ top: 100, bottom, left: 0, right: 400, width: 400, height: bottom - 100 }) as DOMRect

    bringModalIntoView(mask, modal)

    expect(scrollBy).toHaveBeenCalledWith(0, -(bottom - (window.innerHeight - 8)))
    expect(mask.style.top).toBe('100px')
  })

  it('完整在可见区内：不滚、不动遮罩', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    modal.getBoundingClientRect = () =>
      ({ top: 100, bottom: 300, left: 0, right: 400, width: 400, height: 200 }) as DOMRect

    bringModalIntoView(mask, modal)

    expect(scrollBy).not.toHaveBeenCalled()
    expect(mask.style.top).toBe('')
  })
})
