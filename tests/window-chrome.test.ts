// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/components/window-chrome.ts` 窗口能力原语单测（jsdom + 真实指针事件）
 *
 * 守住的东西（2026-10-25 momo：模态框要能缩放放大 + 收起，与浮动窗能力对齐）：
 * 1. 缩放把手：拖动改写 width/height（rAF 合帧），上界 = 视口-当前left/top-留隙，
 *    下界 280×120——「压成一条线 / 放大撞出视口」都是最糟的失败模式；
 * 2. 最大化 ⛶：fixed + 铺满视口（留 8px 空隙）；还原写回快照——拖过/缩放过的
 *    位置不丢，没动过则清干净回 CSS 居中；
 * 3. 最大化态拖动是 no-op（modal-drag 见 is-maximized 即不启动）；
 * 4. resetModalPosition 清缩放/最大化/收起全部会话态（开窗即回归居中展开）。
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { bindModalDrag, resetModalPosition } from '../ts/ui/components/modal-drag.js'
import {
  bindModalMaximize,
  bindModalResize,
  MODAL_MAXIMIZED_CLASS,
} from '../ts/ui/components/window-chrome.js'

/** 在元素 / window 上发指针事件 */
function pointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: y,
      pointerId: 1,
      bubbles: true,
      cancelable: true,
    }),
  )
}

/** 等两个帧：宽高经 rAF 合帧后写入，需让帧跑完 */
async function nextFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }
}

let modal: HTMLElement
let handle: HTMLElement
let maximizeButton: HTMLElement

/**
 * jsdom 无布局引擎：装一个随内联样式变化的假矩形（语义见 modal-drag.test.ts
 * 的同名 helper）。promoteToModalLayer 的「置零测差」需要它——固定矩形会让
 * 抬升后的偏移算成 0，测不出「保持视觉位置」这件事。
 */
function installRectMock(
  element: HTMLElement,
  base: { left: number; top: number; width: number; height: number },
): void {
  element.getBoundingClientRect = (): DOMRect => {
    const isLayered = element.style.position === 'absolute' || element.style.position === 'fixed'
    const left = isLayered ? Number(element.style.left) || 0 : base.left
    const top = isLayered ? Number(element.style.top) || 0 : base.top
    const width = Number(element.style.width) || base.width
    const height = Number(element.style.height) || base.height
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: (): string => '',
    }
  }
}

beforeEach(() => {
  document.body.replaceChildren()
  modal = document.createElement('div')
  handle = document.createElement('div')
  maximizeButton = document.createElement('button')
  modal.append(handle, maximizeButton)
  document.body.append(modal)
  // 非零基准矩形（jsdom 默认全 0）
  installRectMock(modal, { left: 100, top: 50, width: 300, height: 200 })
  bindModalResize({ modal, handle })
  bindModalMaximize({ modal, button: maximizeButton })
})

describe('bindModalResize：缩放把手', () => {
  it('拖把手 → 改写 width/height（+120/+80）', async () => {
    pointer(handle, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 130, 90)
    await nextFrames()
    pointer(window, 'pointerup', 130, 90)

    expect(modal.style.getPropertyValue('width')).toBe('420px')
    expect(modal.style.getPropertyValue('height')).toBe('280px')
    // 缩放过挂 is-resized（CSS 借它把列表切成吃满剩余高度）
    expect(modal.classList.contains('is-resized')).toBe(true)
  })

  it('缩小到保底：不小于 280×120（压成一条线是最糟的失败模式）', async () => {
    pointer(handle, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', -2000, -2000)
    await nextFrames()
    pointer(window, 'pointerup', -2000, -2000)

    expect(modal.style.getPropertyValue('width')).toBe('280px')
    expect(modal.style.getPropertyValue('height')).toBe('120px')
  })

  it('放大到撞定位层边界即停：上界 = 层宽/高 - left/top', async () => {
    pointer(handle, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 5000, 5000)
    await nextFrames()
    pointer(window, 'pointerup', 5000, 5000)

    // 抬升后 left=100 / top=50：宽 = 1024-100 = 924，高 = 768-50 = 718
    expect(modal.style.getPropertyValue('width')).toBe('924px')
    expect(modal.style.getPropertyValue('height')).toBe('718px')
  })

  it('缩放起点把静态模态框抬升为 absolute 定位层（视觉位置不变）', async () => {
    expect(modal.style.getPropertyValue('position')).toBe('')
    pointer(handle, 'pointerdown', 10, 10)
    pointer(window, 'pointerup', 10, 10)

    // 宿主下 fixed 会被摆到文档坐标 → 一律用 absolute（与遮罩锚定同基准）
    expect(modal.style.getPropertyValue('position')).toBe('absolute')
    expect(modal.style.getPropertyValue('left')).toBe('100px')
    expect(modal.style.getPropertyValue('top')).toBe('50px')
  })
})

describe('bindModalMaximize：最大化 / 还原', () => {
  it('⛶ 最大化：absolute + 铺满定位层（= 遮罩锚定的当前可见区）', () => {
    maximizeButton.click()

    expect(modal.classList.contains(MODAL_MAXIMIZED_CLASS)).toBe(true)
    expect(modal.style.getPropertyValue('position')).toBe('absolute')
    // 铺满定位层：不读 window.inner*（宿主下会失真成整份文档高 → 弹窗撑没）
    expect(modal.style.getPropertyValue('left')).toBe('0px')
    expect(modal.style.getPropertyValue('top')).toBe('0px')
    expect(modal.style.getPropertyValue('width')).toBe('1024px')
    expect(modal.style.getPropertyValue('height')).toBe('768px')
  })

  it('再点还原：没拖过/缩放过 → 内联几何清干净，回 CSS 居中', () => {
    maximizeButton.click()
    maximizeButton.click()

    expect(modal.classList.contains(MODAL_MAXIMIZED_CLASS)).toBe(false)
    expect(modal.style.getPropertyValue('position')).toBe('')
    expect(modal.style.getPropertyValue('left')).toBe('')
    expect(modal.style.getPropertyValue('width')).toBe('')
  })

  it('最大化前缩放过 → 还原写回缩放后的几何', async () => {
    pointer(handle, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 130, 90)
    await nextFrames()
    pointer(window, 'pointerup', 130, 90)

    maximizeButton.click()
    expect(modal.style.getPropertyValue('width')).toBe('1024px')
    maximizeButton.click()

    // 回到缩放留下的 420×280（不是清空回 CSS 默认）
    expect(modal.style.getPropertyValue('width')).toBe('420px')
    expect(modal.style.getPropertyValue('height')).toBe('280px')
  })

  it('最大化后一量完全出界 → 当场还原（不留孤零零的黑遮罩）', () => {
    // 宿主把定位解析到可见区之外的极端情况
    modal.getBoundingClientRect = (): DOMRect => ({
      left: 9000,
      top: 9000,
      width: 1024,
      height: 768,
      right: 10_024,
      bottom: 9768,
      x: 9000,
      y: 9000,
      toJSON: (): string => '',
    })

    maximizeButton.click()

    expect(modal.classList.contains(MODAL_MAXIMIZED_CLASS)).toBe(false)
    expect(maximizeButton.textContent).toBe('⛶')
    expect(maximizeButton.getAttribute('aria-pressed')).toBe('false')
    expect(modal.style.getPropertyValue('position')).toBe('')
  })

  it('最大化态拖标题是 no-op（先 ⛶ 还原再拖）', async () => {
    const grip = document.createElement('h4')
    modal.append(grip)
    bindModalDrag({ modal, grip })
    maximizeButton.click()

    pointer(grip, 'pointerdown', 50, 50)
    pointer(window, 'pointermove', 200, 200)
    await nextFrames()
    pointer(window, 'pointerup', 200, 200)

    // left/top 还是最大化的 0px，没被拖走
    expect(modal.style.getPropertyValue('left')).toBe('0px')
    expect(modal.style.getPropertyValue('top')).toBe('0px')
  })
})

describe('resetModalPosition：清全部会话态', () => {
  it('清掉缩放尺寸与 is-resized / is-maximized / is-collapsed，回居中', async () => {
    pointer(handle, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 130, 90)
    await nextFrames()
    pointer(window, 'pointerup', 130, 90)
    expect(modal.style.getPropertyValue('width')).toBe('420px')

    resetModalPosition(modal)

    expect(modal.style.getPropertyValue('width')).toBe('')
    expect(modal.style.getPropertyValue('height')).toBe('')
    expect(modal.style.getPropertyValue('position')).toBe('')
    expect(modal.classList.contains('is-resized')).toBe(false)
    expect(modal.classList.contains('is-dragged')).toBe(false)
    expect(modal.classList.contains('is-collapsed')).toBe(false)
    expect(modal.classList.contains(MODAL_MAXIMIZED_CLASS)).toBe(false)
  })
})
