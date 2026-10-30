// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/components/table-resize.ts` 单测（jsdom）
 *
 * 守住的东西（每条都对应一个「改坏了但没人发现」的真实可能）：
 * 1. `decorate()` 在表头每格（最后一列除外）插列宽把手、在表头上插行高把手；
 * 2. **幂等**：连调两次不会重复插——行高把手是表头的子元素，若不排除，
 *    第二次就会把它当成一格「列」再塞一个把手进去；
 * 3. 「默认 = 自动」：没拖过的列**不写** `--table-col-N`，让 CSS 的
 *    `var(--table-col-N, <默认>)` 兜底（这是「JS 不再抄一份默认模板」的前提）；
 * 4. 拖动后该列变固定 px，且不小于 minColumnWidth；行高不小于 minRowHeight；
 * 5. 双击把手 = 删掉该变量 = 回到自动，并回调 onChange；
 * 6. `reset()` 清全部、`destroy()` 连把手带变量一起撤。
 *
 * jsdom 不做布局计算（`getBoundingClientRect` 恒 0），所以拖动用例都显式
 * 打桩起始尺寸——否则「起点 0 + 位移 100 = 100」这种断言会误判通过。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bindTableResize } from '../ts/ui/components/table-resize.js'
import type { TableResizeController, TableSizeState } from '../ts/ui/components/table-resize.js'

/** 三列表：表头 3 格（只插 2 个列宽把手）+ 2 行数据 */
function buildTable(): { container: HTMLElement; head: HTMLElement } {
  document.body.innerHTML = `
    <div id="table">
      <div class="table-resize-head"><span>#</span><span>名称</span><span>公式</span></div>
      <div class="row"><span>1</span><span>a</span><span>=1</span></div>
      <div class="row"><span>2</span><span>b</span><span>=2</span></div>
    </div>`
  const container = document.getElementById('table')!
  const head = container.querySelector<HTMLElement>('.table-resize-head')!
  return { container, head }
}

/** 给元素打桩尺寸（jsdom 恒 0，不打桩测不出「起点 + 位移」） */
function stubSize(element: HTMLElement, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: width, bottom: height, width, height }) as DOMRect
}

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

function columnHandles(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.table-resize-handle')]
}

function rowHandles(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.table-resize-row-handle')]
}

/**
 * 取第 index 个把手
 *
 * 不用 `columnHandles()[index]`：`noUncheckedIndexedAccess` 下它是
 * `HTMLElement | undefined`，到处写 `!` 会把「把手没插上」这种真实故障
 * 变成一句没有信息量的类型断言；这里显式报错，失败信息直接说清是第几个。
 */
function handleAt(handles: HTMLElement[], index: number): HTMLElement {
  const handle = handles[index]
  if (handle === undefined) throw new Error(`没有第 ${String(index)} 个把手`)
  return handle
}

/** 拖一次列宽：从把手的第 x0 处拖到 x1 */
function dragColumn(handle: HTMLElement, x0: number, x1: number): void {
  pointer(handle, 'pointerdown', x0, 10)
  pointer(window, 'pointermove', x1, 10)
  pointer(window, 'pointerup', x1, 10)
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('decorate：补把手', () => {
  it('表头每格（最后一列除外）一个列宽把手，表头上再挂一个行高把手', () => {
    const { container } = buildTable()
    const controller = bindTableResize({ container })
    controller.decorate()

    const handles = columnHandles()
    expect(handles).toHaveLength(2)
    // data-col 是列序号（第 3 列右边没有下一列，所以只到 1）
    expect(handles.map((handle) => handle.dataset.col)).toEqual(['0', '1'])
    expect(rowHandles()).toHaveLength(1)
    // 把手是纯标记：不绑监听，靠容器委托
    expect(handleAt(handles, 0).getAttribute('aria-hidden')).toBe('true')
  })

  it('幂等：连调两次不重复插（行高把手不能被当成一格「列」）', () => {
    const { container } = buildTable()
    const controller = bindTableResize({ container })
    controller.decorate()
    controller.decorate()
    controller.decorate()

    expect(columnHandles()).toHaveLength(2)
    expect(rowHandles()).toHaveLength(1)
    // 行高把手内部不该被塞进列宽把手
    expect(handleAt(rowHandles(), 0).querySelector('.table-resize-handle')).toBeNull()
  })

  it('没有表头的表：decorate 不炸，也不插任何把手', () => {
    document.body.innerHTML = '<div id="table"><div class="row">a</div></div>'
    const container = document.getElementById('table')!
    const controller = bindTableResize({ container })
    expect(() => {
      controller.decorate()
    }).not.toThrow()
    expect(columnHandles()).toHaveLength(0)
    expect(rowHandles()).toHaveLength(0)
  })
})

describe('默认 = 自动', () => {
  it('没拖过的列不写 --table-col-N（让 CSS 的 var 兜底值生效）', () => {
    const { container } = buildTable()
    const controller = bindTableResize({ container })
    controller.decorate()

    expect(container.style.getPropertyValue('--table-col-0')).toBe('')
    expect(container.style.getPropertyValue('--table-col-1')).toBe('')
    // 行高默认写 auto（不是留空）：CSS 的 min-height: var(--table-row-h, auto)
    // 两种写法等价，但显式写出来让 getState / 存储读得到「自动」这个意图
    expect(container.style.getPropertyValue('--table-row-h')).toBe('auto')
    expect(controller.getState()).toEqual({ cols: [], rowHeight: null })
  })

  it('initial 里的值直接落成固定 px', () => {
    const { container } = buildTable()
    const controller = bindTableResize({
      container,
      initial: { cols: [120, null], rowHeight: 40 },
    })
    controller.decorate()

    expect(container.style.getPropertyValue('--table-col-0')).toBe('120px')
    expect(container.style.getPropertyValue('--table-col-1')).toBe('')
    expect(container.style.getPropertyValue('--table-row-h')).toBe('40px')
    expect(controller.getState()).toEqual({ cols: [120, null], rowHeight: 40 })
  })
})

describe('拖列宽', () => {
  it('拖动把第 2 列写成固定 px，并按位移量算（起点 100 + 30 = 130）', () => {
    const { container } = buildTable()
    const onChange = vi.fn<(state: TableSizeState) => void>()
    const controller = bindTableResize({ container, onChange })
    controller.decorate()

    const handle = handleAt(columnHandles(), 1)
    stubSize(handle.parentElement!, 100, 20)
    dragColumn(handle, 100, 130)

    expect(container.style.getPropertyValue('--table-col-1')).toBe('130px')
    // 只改被拖的那一列，另一列保持自动
    expect(container.style.getPropertyValue('--table-col-0')).toBe('')
    // 收尾才回调（拖动过程中不刷存储）
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls.at(0)?.at(0)).toEqual({ cols: [null, 130], rowHeight: null })
  })

  it('向左拖过头 → 夹到 minColumnWidth（默认 48）', () => {
    const { container } = buildTable()
    const controller = bindTableResize({ container, minColumnWidth: 48 })
    controller.decorate()

    const handle = handleAt(columnHandles(), 0)
    stubSize(handle.parentElement!, 100, 20)
    dragColumn(handle, 100, -400)

    expect(container.style.getPropertyValue('--table-col-0')).toBe('48px')
  })

  it('拖动中给容器加 is-resizing + data-resize-axis，松手清掉', () => {
    const { container } = buildTable()
    const controller = bindTableResize({ container })
    controller.decorate()

    const handle = handleAt(columnHandles(), 0)
    stubSize(handle.parentElement!, 100, 20)
    pointer(handle, 'pointerdown', 100, 10)
    expect(container.classList.contains('is-resizing')).toBe(true)
    expect(container.dataset.resizeAxis).toBe('column')

    pointer(window, 'pointerup', 100, 10)
    expect(container.classList.contains('is-resizing')).toBe(false)
    expect(container.dataset.resizeAxis).toBeUndefined()
  })

  it('双击列把手 → 该列回自动（变量被删），并回调', () => {
    const { container } = buildTable()
    const onChange = vi.fn<(state: TableSizeState) => void>()
    const controller = bindTableResize({
      container,
      initial: { cols: [120, 200] },
      onChange,
    })
    controller.decorate()
    expect(container.style.getPropertyValue('--table-col-0')).toBe('120px')

    handleAt(columnHandles(), 0).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))

    expect(container.style.getPropertyValue('--table-col-0')).toBe('')
    // 另一列不受影响
    expect(container.style.getPropertyValue('--table-col-1')).toBe('200px')
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('拖行高', () => {
  it('起点取表头实测高度（24 + 16 = 40）', () => {
    const { container, head } = buildTable()
    const controller = bindTableResize({ container })
    controller.decorate()
    stubSize(head, 300, 24)

    pointer(handleAt(rowHandles(), 0), 'pointerdown', 10, 100)
    pointer(window, 'pointermove', 10, 116)
    pointer(window, 'pointerup', 10, 116)

    expect(container.style.getPropertyValue('--table-row-h')).toBe('40px')
    expect(controller.getState().rowHeight).toBe(40)
  })

  it('向上拖过头 → 夹到 minRowHeight（默认 22）', () => {
    const { container, head } = buildTable()
    const controller = bindTableResize({ container, initial: { rowHeight: 40 } })
    controller.decorate()
    stubSize(head, 300, 24)

    pointer(handleAt(rowHandles(), 0), 'pointerdown', 10, 100)
    pointer(window, 'pointermove', 10, -300)
    pointer(window, 'pointerup', 10, -300)

    expect(container.style.getPropertyValue('--table-row-h')).toBe('22px')
  })

  it('双击行高把手 → 回 auto', () => {
    const { container } = buildTable()
    const controller = bindTableResize({ container, initial: { rowHeight: 40 } })
    controller.decorate()

    handleAt(rowHandles(), 0).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))

    expect(container.style.getPropertyValue('--table-row-h')).toBe('auto')
    expect(controller.getState().rowHeight).toBeNull()
  })
})

describe('reset / getState / destroy', () => {
  it('reset 把列宽与行高一起清回自动并回调', () => {
    const { container } = buildTable()
    const onChange = vi.fn<(state: TableSizeState) => void>()
    const controller = bindTableResize({
      container,
      initial: { cols: [120, 200], rowHeight: 40 },
      onChange,
    })
    controller.decorate()

    controller.reset()

    expect(container.style.getPropertyValue('--table-col-0')).toBe('')
    expect(container.style.getPropertyValue('--table-col-1')).toBe('')
    expect(container.style.getPropertyValue('--table-row-h')).toBe('auto')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toEqual({ cols: [null, null], rowHeight: null })
  })

  it('getState 返回副本：改它不影响内部状态', () => {
    const { container } = buildTable()
    const controller = bindTableResize({ container, initial: { cols: [120] } })
    controller.decorate()

    const snapshot = controller.getState()
    snapshot.cols[0] = 999

    expect(controller.getState().cols[0]).toBe(120)
  })

  it('destroy 撤掉把手、清空变量、解绑（再拖不再有反应）', () => {
    const { container } = buildTable()
    const controller = bindTableResize({ container, initial: { cols: [120], rowHeight: 40 } })
    controller.decorate()
    const handle = handleAt(columnHandles(), 0)
    stubSize(handle.parentElement!, 120, 20)

    controller.destroy()

    expect(columnHandles()).toHaveLength(0)
    expect(rowHandles()).toHaveLength(0)
    expect(container.style.getPropertyValue('--table-col-0')).toBe('')
    expect(container.style.getPropertyValue('--table-row-h')).toBe('')
    expect(container.style.length).toBe(0)

    // 容器上的委托也解了：重新插一个把手（模拟残留）再拖，不会写变量
    const stray = document.createElement('span')
    stray.className = 'table-resize-handle'
    stray.dataset.col = '0'
    container.appendChild(stray)
    dragColumn(stray, 0, 50)
    expect(container.style.getPropertyValue('--table-col-0')).toBe('')
  })
})

describe('回调语义', () => {
  it('拖动结束才回调一次（不是每帧都写存储）', () => {
    const { container } = buildTable()
    const onChange = vi.fn<(state: TableSizeState) => void>()
    const controller: TableResizeController = bindTableResize({ container, onChange })
    controller.decorate()

    const handle = handleAt(columnHandles(), 0)
    stubSize(handle.parentElement!, 100, 20)
    pointer(handle, 'pointerdown', 100, 10)
    pointer(window, 'pointermove', 110, 10)
    pointer(window, 'pointermove', 120, 10)
    pointer(window, 'pointermove', 130, 10)
    expect(onChange).not.toHaveBeenCalled()

    pointer(window, 'pointerup', 130, 10)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(container.style.getPropertyValue('--table-col-0')).toBe('130px')
  })

  it('没传 onChange 也不炸（组件零依赖，调用方可以只用它渲染）', () => {
    const { container } = buildTable()
    const controller = bindTableResize({ container })
    controller.decorate()
    expect(() => {
      controller.reset()
    }).not.toThrow()
  })
})

/** 给表头每格打桩一个「按内容量出来的宽度」 */
function stubHeadWidths(head: HTMLElement, widths: readonly number[]): void {
  const cells = [...head.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  )
  for (const [index, cell] of cells.entries()) {
    stubSize(cell, widths[index] ?? 0, 24)
  }
  stubSize(
    head,
    widths.reduce((sum, width) => sum + width, 0),
    24,
  )
}

describe('智能分配（autoFit）', () => {
  it('按内容给每列写固定宽度（夹在 min / max 之间）', () => {
    const { container, head } = buildTable()
    const controller = bindTableResize({ container, minColumnWidth: 40 })
    controller.decorate()
    stubHeadWidths(head, [30, 120, 900])

    const fitted = controller.autoFit()

    expect(fitted).toBe(3)
    // 30 → 抬到 min 40；120 原样；900 → 压到上限 420
    expect(container.style.getPropertyValue('--table-col-0')).toBe('40px')
    expect(container.style.getPropertyValue('--table-col-1')).toBe('120px')
    expect(container.style.getPropertyValue('--table-col-2')).toBe('420px')
    expect(controller.getState().rowHeight).toBeNull()
  })

  it('表不可见（宽度 0）时不改任何列，返回 0（调用方据此不提示）', () => {
    const { container, head } = buildTable()
    const controller = bindTableResize({ container })
    controller.decorate()
    stubHeadWidths(head, [0, 0, 0])

    expect(controller.autoFit()).toBe(0)
    expect(container.style.getPropertyValue('--table-col-0')).toBe('')
  })

  it('分配后回调 onChange（页面据此落存储，刷新后仍记得）', () => {
    const { container, head } = buildTable()
    const onChange = vi.fn<(state: TableSizeState) => void>()
    const controller = bindTableResize({ container, onChange })
    controller.decorate()
    stubHeadWidths(head, [60, 60, 60])

    controller.autoFit()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0]?.cols).toEqual([60, 60, 60])
  })
})
