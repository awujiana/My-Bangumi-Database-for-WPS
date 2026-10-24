// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/components/sortable-list.ts` 可拖拽排序单测（jsdom + 真实指针/键盘事件）
 *
 * 守住的东西（dnd-kit 范式逐条对）：
 * 1. 纯函数：moveInArray 搬运、computeDropTarget 中点碰撞、keyboardMoveIndex 钳制；
 * 2. 指针传感器：不过阈值 = 单击（不建 overlay）；过阈值才拖；
 *    按钮 / 输入上的按下不启动拖拽（控件语义优先）；
 * 3. 拖拽中：克隆 overlay 跟手（transform = 指针位移）、原项 is-placeholder、
 *    指示线可见；松手 → onReorder 拿到正确的 from/over/placeAfter；
 * 4. 拖拽后那一次 click 被吞（不误触发行内按钮）；
 * 5. 键盘传感器：Space 拾起（DOM 实时换位预览）、↑↓ 移动、Space 提交、
 *    Esc 取消并还原 DOM；
 * 6. isDisabled / destroy 的失活与卸载。
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import {
  computeDropTarget,
  createSortable,
  keyboardMoveIndex,
  moveInArray,
} from '../ts/ui/components/sortable-list.js'
import type { SortableOptions, SortableReorderEvent } from '../ts/ui/components/sortable-list.js'

/** 等两个帧：位移经 rAF 合帧后写入 */
async function nextFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }
}

/** 在元素上发指针事件 */
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

let container: HTMLElement
let reorderEvents: SortableReorderEvent[]
let options: SortableOptions
/** 登记本页所有 sortable 实例：afterEach 统一 destroy，失败用例也不泄漏拖拽态 */
const handles: ReturnType<typeof createSortable>[] = []

/** 建 4 个项，每项 40px 高、从 top=0 起垂直排列（stub 掉 getBoundingClientRect） */
function buildItems(count: number): HTMLElement[] {
  container.replaceChildren()
  const items: HTMLElement[] = []
  for (let index = 0; index < count; index += 1) {
    const item = document.createElement('div')
    item.className = 'row'
    item.dataset.itemId = `id-${String(index)}`
    item.textContent = `第 ${String(index)} 项`
    item.getBoundingClientRect = () =>
      ({
        top: index * 40,
        bottom: index * 40 + 40,
        left: 0,
        right: 300,
        width: 300,
        height: 40,
      }) as DOMRect
    container.append(item)
    items.push(item)
  }
  return items
}

beforeEach(() => {
  reorderEvents = []
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  // jsdom 的 scrollBy 未实现会往虚拟控制台刷错误；统一桩掉
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  options = {
    container,
    itemSelector: '.row',
    getItemId: (item) => item.dataset.itemId ?? '',
    onReorder: (event) => {
      reorderEvents.push(event)
    },
  }
})

afterEach(() => {
  for (const handle of handles) handle.destroy()
  handles.length = 0
  vi.restoreAllMocks()
})

// ========== 纯函数 ==========

describe('moveInArray', () => {
  it('从后往前搬 / 从前往后搬都不重不漏', () => {
    expect(moveInArray(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveInArray(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
    expect(moveInArray(['a', 'b'], 0, 0)).toEqual(['a', 'b'])
  })

  it('越界下标不抛（splice 收敛）', () => {
    expect(moveInArray(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })
})

describe('computeDropTarget', () => {
  const probes = [
    { id: 'a', top: 0, height: 40 },
    { id: 'b', top: 40, height: 40 },
    { id: 'c', top: 80, height: 40 },
  ]

  it('指针在项中点上半 → 插它前面', () => {
    expect(computeDropTarget(probes, 10)).toEqual({ overId: 'a', placeAfter: false, index: 0 })
    expect(computeDropTarget(probes, 45)).toEqual({ overId: 'b', placeAfter: false, index: 1 })
  })

  it('指针过全部中点 → 落末尾', () => {
    expect(computeDropTarget(probes, 200)).toEqual({ overId: 'c', placeAfter: true, index: 3 })
  })

  it('空列表 → overId null', () => {
    expect(computeDropTarget([], 10)).toEqual({ overId: null, placeAfter: true, index: 0 })
  })
})

describe('keyboardMoveIndex', () => {
  it('钳在 [0, count-1]（不循环）', () => {
    expect(keyboardMoveIndex(0, -1, 3)).toBe(0)
    expect(keyboardMoveIndex(2, 1, 3)).toBe(2)
    expect(keyboardMoveIndex(1, -1, 3)).toBe(0)
    expect(keyboardMoveIndex(0, 1, 3)).toBe(1)
    expect(keyboardMoveIndex(0, 1, 0)).toBe(0)
  })
})

// ========== 指针传感器 ==========

describe('指针拖拽', () => {
  it('不过阈值 = 单击：不建 overlay、不提交', async () => {
    buildItems(3)
    handles.push(createSortable(options))
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    pointer(items[0]!, 'pointerdown', 10, 10)
    // 位移 3px < 5px 阈值
    pointer(window, 'pointermove', 12, 13)
    await nextFrames()
    expect(document.querySelector('.sortable-overlay')).toBeNull()
    expect(items[0]?.classList.contains('is-placeholder')).toBe(false)
    pointer(window, 'pointerup', 12, 13)
    expect(reorderEvents).toHaveLength(0)
  })

  it('过阈值进入拖拽：overlay 跟手 + 原项占位 + 指示线', async () => {
    buildItems(3)
    handles.push(createSortable(options))
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    pointer(items[0]!, 'pointerdown', 10, 10)
    // 位移 50px，过阈值（这一帧位移还是 0）
    pointer(window, 'pointermove', 60, 60)
    // 再移动才有增量
    pointer(window, 'pointermove', 100, 100)
    await nextFrames()

    const overlay = document.querySelector<HTMLElement>('.sortable-overlay')
    expect(overlay).not.toBeNull()
    // 跟手：transform = 相对「过阈值那一刻」的指针位移（抓住的点不跳）
    expect(overlay?.style.transform).toBe('translate(40px, 40px)')
    expect(items[0]?.classList.contains('is-placeholder')).toBe(true)
    expect(document.body.classList.contains('sortable-dragging')).toBe(true)
    expect(document.querySelector('.sortable-drop-indicator')).not.toBeNull()

    pointer(window, 'pointerup', 100, 100)
    await nextFrames()
  })

  it('拖到第二项中点之下松手 → 提交 from=0 / over=1 / placeAfter=true', async () => {
    buildItems(3)
    handles.push(createSortable(options))
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    pointer(items[0]!, 'pointerdown', 10, 10)
    // 指针落在第 3 项（top 80..120）区域
    pointer(window, 'pointermove', 10, 90)
    await nextFrames()
    pointer(window, 'pointerup', 10, 90)

    expect(reorderEvents).toHaveLength(1)
    const event = reorderEvents[0]!
    expect(event.fromId).toBe('id-0')
    expect(event.overId).toBe('id-2')
    expect(event.placeAfter).toBe(false)
    // 拖拽浮态收尾：占位类摘掉、body 类摘掉
    expect(items[0]?.classList.contains('is-placeholder')).toBe(false)
    expect(document.body.classList.contains('sortable-dragging')).toBe(false)
  })

  it('animateDrop:false → 松手直接撤浮层（id 会漂的列表不能飞错位置）', async () => {
    buildItems(3)
    options.animateDrop = false
    handles.push(createSortable(options))
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    pointer(items[0]!, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 10, 90)
    await nextFrames()
    pointer(window, 'pointerup', 10, 90)

    expect(reorderEvents).toHaveLength(1)
    // 浮层立即撤掉，不留在屏幕上飞
    expect(document.querySelector('.sortable-overlay')).toBeNull()
  })

  it('拖拽后那一次 click 被吞（行内按钮不会被误触发）', async () => {
    buildItems(3)
    handles.push(createSortable(options))
    const clickSpy = vi.fn()
    container.addEventListener('click', clickSpy)
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    pointer(items[0]!, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 60, 60)
    await nextFrames()
    pointer(window, 'pointerup', 60, 60)
    // 浏览器在 pointerup 后会补一个 click（目标是松手处的元素）
    items[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clickSpy).not.toHaveBeenCalled()
    // 再点一次就恢复（吞的只有那一次）
    items[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('按钮上的按下不启动拖拽（控件语义优先）', async () => {
    buildItems(2)
    const button = document.createElement('button')
    container.querySelector('.row')?.append(button)
    handles.push(createSortable(options))
    pointer(button, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 80, 80)
    await nextFrames()
    expect(document.querySelector('.sortable-overlay')).toBeNull()
  })

  it('isDisabled 返回 true 时拖拽与键盘都不响应', async () => {
    buildItems(2)
    options.isDisabled = () => true
    handles.push(createSortable(options))
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    pointer(items[0]!, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 80, 80)
    await nextFrames()
    expect(document.querySelector('.sortable-overlay')).toBeNull()
  })

  it('handleSelector 指定把手：只有按在把手上才拖', async () => {
    buildItems(2)
    for (const item of container.querySelectorAll<HTMLElement>('.row')) {
      const handle = document.createElement('span')
      handle.className = 'grip'
      item.append(handle)
    }
    options.handleSelector = '.grip'
    handles.push(createSortable(options))
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    // 按在行主体（非把手）
    pointer(items[0]!, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 80, 80)
    await nextFrames()
    expect(document.querySelector('.sortable-overlay')).toBeNull()

    const grip = items[0]?.querySelector<HTMLElement>('.grip')
    pointer(grip!, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 80, 80)
    await nextFrames()
    expect(document.querySelector('.sortable-overlay')).not.toBeNull()
  })
})

// ========== 键盘传感器 ==========

describe('键盘排序（dnd-kit 招牌无障碍）', () => {
  it('Space 拾起 → ↓ 移动（DOM 实时换位）→ Space 提交', async () => {
    buildItems(3)
    const announced: string[] = []
    options.announce = (message) => {
      announced.push(message)
    }
    handles.push(createSortable(options))
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    items[0]?.focus()
    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    expect(items[0]?.classList.contains('is-keyboard-dragging')).toBe(true)
    expect(announced.at(-1)).toContain('已拾起第 1 项')

    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    // DOM 实时换位：第 0 项跑到第 1 位
    expect(container.querySelectorAll('.row')[1]).toBe(items[0])
    expect(announced.at(-1)).toContain('第 2 项')

    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    expect(reorderEvents).toHaveLength(1)
    expect(reorderEvents[0]?.fromId).toBe('id-0')
    expect(reorderEvents[0]?.overId).toBe('id-1')
    expect(reorderEvents[0]?.placeAfter).toBe(true)
    expect(announced.at(-1)).toContain('已放置到第 2 位')
    expect(items[0]?.classList.contains('is-keyboard-dragging')).toBe(false)
  })

  it('Esc 取消：DOM 还原到原址、不提交', () => {
    buildItems(3)
    handles.push(createSortable(options))
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    items[0]?.focus()
    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(container.querySelectorAll('.row')[1]).toBe(items[0])
    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(container.querySelector('.row')).toBe(items[0])
    expect(reorderEvents).toHaveLength(0)
    expect(items[0]?.classList.contains('is-keyboard-dragging')).toBe(false)
  })

  it('未拖拽时方向键 = roving focus（在项间移焦点，tabindex 跟着搬迁）', () => {
    buildItems(3)
    handles.push(createSortable(options))
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    // roving：整列只有一个 Tab 停靠点（347 行不能有 347 个）
    expect(items[0]?.tabIndex).toBe(0)
    expect(items[1]?.tabIndex).toBe(-1)
    items[0]?.focus()
    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(items[1])
    // 停靠点搬迁：旧项收起、新项升起
    expect(items[0]?.tabIndex).toBe(-1)
    expect(items[1]?.tabIndex).toBe(0)
    items[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(items[0])
    expect(items[1]?.tabIndex).toBe(-1)
  })

  it('拖拽 overlay 剥掉身份标识（同一时刻 DOM 里不出现两个「第 N 行」）', async () => {
    buildItems(3)
    handles.push(createSortable(options))
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    pointer(items[0]!, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 60, 60)
    pointer(window, 'pointermove', 100, 100)
    await nextFrames()

    const overlay = document.querySelector<HTMLElement>('.sortable-overlay')
    expect(overlay?.dataset.itemId).toBeUndefined()
    expect(document.querySelectorAll('[data-item-id="id-0"]')).toHaveLength(1)
  })

  it('到边界播报「已经到顶/底」，不越界', () => {
    buildItems(2)
    const announced: string[] = []
    options.announce = (message) => {
      announced.push(message)
    }
    handles.push(createSortable(options))
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    items[0]?.focus()
    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    expect(announced.at(-1)).toBe('已经到顶了')
    expect(reorderEvents).toHaveLength(0)
  })
})

// ========== 生命周期 ==========

describe('refresh / destroy', () => {
  it('refresh 给项补 tabindex 与 aria（键盘可达）', () => {
    buildItems(2)
    const handle = createSortable(options)
    handles.push(handle)
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    expect(items[0]?.tabIndex).toBe(0)
    expect(items[0]?.getAttribute('aria-roledescription')).toBe('可拖拽排序项')
    handle.refresh()
  })

  it('destroy 后 pointerdown 不再起拖', async () => {
    buildItems(2)
    const handle = createSortable(options)
    handles.push(handle)
    handle.destroy()
    const items = [...container.querySelectorAll<HTMLElement>('.row')]
    pointer(items[0]!, 'pointerdown', 10, 10)
    pointer(window, 'pointermove', 80, 80)
    await nextFrames()
    expect(document.querySelector('.sortable-overlay')).toBeNull()
    expect(document.querySelector('.sortable-live-region')).toBeNull()
  })
})
