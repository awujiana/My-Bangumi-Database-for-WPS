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

/**
 * jsdom 没有布局引擎（getBoundingClientRect 恒全 0），这里装一个**随内联样式
 * 变化**的假矩形，模拟真实浏览器的两条语义：
 * - 未定位（static/relative，在遮罩 flex 流里）→ 停在基准位 {left, top}；
 * - 已定位（absolute/fixed）→ left/top 就是相对包含块原点的偏移（本测试里
 *   包含块原点视作视口 0,0），改 style.left 即改视口位置。
 *
 * promoteToModalLayer 的「置零测差」依赖这个区别：静态时量一次、置零后再量
 * 一次才能算出相对包含块的偏移。固定矩形会让它算出 0（测不出宿主真实行为）。
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
  mask = document.createElement('div')
  modal = document.createElement('div')
  modal.className = 'conditional-format-modal'
  grip = document.createElement('h4')
  modal.append(grip)
  mask.append(modal)
  document.body.append(mask)
  installRectMock(modal, { left: 100, top: 50, width: 400, height: 300 })
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

// ========== 拖拽后 click 吞除（momo：一拖动就关闭） ==========

/** 建遮罩 + 模态框 + 标题栏把手，绑拖动，开一屏 */
function setupFresh(): { mask: HTMLElement; modal: HTMLElement; grip: HTMLElement } {
  document.body.replaceChildren()
  const freshMask = document.createElement('div')
  const freshModal = document.createElement('div')
  const freshGrip = document.createElement('h4')
  freshModal.append(freshGrip)
  freshMask.append(freshModal)
  document.body.append(freshMask)
  bindModalDrag({ modal: freshModal, grip: freshGrip })
  return { mask: freshMask, modal: freshModal, grip: freshGrip }
}

/** 拖一把（过阈值 + 松手），装上 click 拦截器 */
async function dragOnce(targetGrip: HTMLElement): Promise<void> {
  pointer(targetGrip, 'pointerdown', 10, 10)
  pointer(window, 'pointermove', 80, 60)
  await nextFrames()
  pointer(window, 'pointerup', 80, 60)
}

// ========== 出界兜底（momo：弹窗没了、遮罩黑层还盖着页面） ==========

/** 造一个「无论怎么量都在可见区之外」的假矩形 */
function offscreenRect(): DOMRect {
  return {
    left: 0,
    top: 9000,
    width: 400,
    height: 300,
    right: 400,
    bottom: 9300,
    x: 0,
    y: 9000,
    toJSON: (): string => '',
  }
}

describe('拖到可见区外：自愈', () => {
  it('拖完一量完全出界 → 复位回遮罩居中（弹窗与遮罩不分离）', () => {
    const { modal: modalElement, grip: gripElement } = setupFresh()
    // 宿主把定位解析到文档别处的极端情况：怎么量都在可见区外
    modalElement.getBoundingClientRect = offscreenRect

    pointer(gripElement, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 80, 60)
    pointer(window, 'pointerup', 80, 60)

    expect(modalElement.style.left).toBe('')
    expect(modalElement.style.top).toBe('')
    expect(modalElement.style.position).toBe('')
    expect(modalElement.classList.contains('is-dragged')).toBe(false)
  })

  it('正常拖（在可见区内）不被误复位', () => {
    const { modal: modalElement, grip: gripElement } = setupFresh()
    modalElement.getBoundingClientRect = (): DOMRect => ({
      left: 70,
      top: 50,
      width: 400,
      height: 300,
      right: 470,
      bottom: 350,
      x: 70,
      y: 50,
      toJSON: (): string => '',
    })

    pointer(gripElement, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 80, 60)
    pointer(window, 'pointerup', 80, 60)

    expect(modalElement.style.position).toBe('absolute')
  })

  it('双击标题栏 = 复位（弹窗被拖到别处时的自救，不用关掉重开）', () => {
    const { modal: modalElement, grip: gripElement } = setupFresh()
    modalElement.style.setProperty('position', 'absolute')
    modalElement.style.setProperty('left', '120px')
    modalElement.style.setProperty('top', '90px')

    gripElement.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))

    expect(modalElement.style.left).toBe('')
    expect(modalElement.style.top).toBe('')
    expect(modalElement.style.position).toBe('')
  })
})

describe('bindModalDrag：拖拽后吞 click', () => {
  it('真拖过 → 松手补发的 click 被吞（不再点关遮罩弹窗）', async () => {
    const { mask: maskElement, modal: modalElement, grip: gripElement } = setupFresh()
    await dragOnce(gripElement)

    // modal 已拖到 (70,50) 附近；此时点「modal 外、mask 上」的旧位置，
    // click 必须被拦截器吃掉（defaultPrevented），不会冒泡到 mask 的关闭逻辑
    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    })
    maskElement.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    // 抬升为定位层用 absolute（宿主下 fixed 会被摆到文档坐标 → 「一拖就没」）
    expect(modalElement.style.getPropertyValue('position')).toBe('absolute')
  })

  it('原地单击标题栏（没过阈值）→ 不吞 click', async () => {
    const { mask: maskElement, grip: gripElement } = setupFresh()

    pointer(gripElement, 'pointerdown', 10, 10)
    // 位移 2px < 3px 阈值
    pointer(window, 'pointermove', 12, 12)
    await nextFrames()
    pointer(window, 'pointerup', 12, 12)

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    maskElement.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
  })

  it('拦截器超时自摘：拖完 300ms 后点击恢复正常', () => {
    vi.useFakeTimers()
    try {
      const { mask: maskElement, grip: gripElement } = setupFresh()
      // 不用 dragOnce：它内含 nextFrames（真实 rAF），而本用例的 fake timers
      // 会把 rAF 也接管导致永不 resolve。pointerup 的 flush 是同步的，
      // 不等帧几何也已落位，拦截器也已装上。
      pointer(gripElement, 'pointerdown', 10, 10)
      pointer(window, 'pointermove', 80, 60)
      pointer(window, 'pointerup', 80, 60)

      // 推进超过 300ms 兜底：拦截器应自摘
      vi.advanceTimersByTime(400)
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      maskElement.dispatchEvent(click)
      expect(click.defaultPrevented).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
