/**
 * @fileoverview 表格列宽 / 行高拖拽（拖完记住，双击回到自动）
 * @module ui/components/table-resize
 *
 * 为什么单独抽：条件格式页有四张表（工作表规则 / 我的规则 / 导入弹框 / 粘贴表格），
 * 各自渲染行，但「列模板 + 表头 + 可拖动」是同一件事。列宽此前写死在 CSS 里——
 * 窄任务窗格下长公式永远被截断，用户又调不了。
 *
 * 设计取舍：
 * 1. **一列一个 CSS 变量 `--table-col-<i>`**：行是逐行 CSS Grid（不是一个大 grid
 *    容器），所以列模板写在每一行上。若把「整串模板」交给组件生成，组件就得在 JS
 *    里再抄一份各表的默认模板 —— 两份默认值必然漂移（本页的列模板此前就在 CSS 里
 *    定义过两遍，后一份静默覆盖前一份）。改成「每列一个带兜底值的变量」后：
 *
 *        grid-template-columns: var(--table-col-0, 30px) var(--table-col-1, 34px) …;
 *
 *    默认值**只存在于 CSS**，组件只负责「把用户拖过的列写成固定 px」，
 *    没拖过的列连属性都不写（自动回落到 CSS 兜底值）。组件因此不需要知道
 *    有几列、每列默认多宽。
 * 2. **默认 auto**：双击把手 = 删掉该列的变量 = 回到「自动调整」。
 * 3. **事件委托**：表头每次重渲染都会换新节点，逐节点绑监听器会全丢；把手是纯标记，
 *    监听挂在容器上一次即可，`decorate()` 只负责补把手（幂等）。
 * 4. **不碰存储**：状态通过 `onChange` 抛给调用方（页面写 PluginStorage），组件零依赖、
 *    可单测。
 */

/** 表头行标记类（把手插在这些行里） */
const HEAD_CLASS = 'table-resize-head'
/** 列宽把手 */
const COLUMN_HANDLE_CLASS = 'table-resize-handle'
/** 行高把手（表头底部那条） */
const ROW_HANDLE_CLASS = 'table-resize-row-handle'
/** 列宽变量前缀（实际属性名 = 前缀 + 列序号，如 `--table-col-2`） */
const COLUMN_PROPERTY_PREFIX = '--table-col-'
/** 行高变量名 */
const ROW_HEIGHT_PROPERTY = '--table-row-h'
/** 拖动中给容器加的类（禁选中，避免拖出蓝色选区） */
const RESIZING_CLASS = 'is-resizing'
/**
 * 「智能分配」的单列宽度上限（px）
 *
 * 长公式（`=AND($I2="x",$J2>0,…)`）按内容量能到几百 px，不封顶会把表格撑出
 * 横向滚动条 —— 那比截断更难用（用户要横向拖着看公式，其余列全在视野外）。
 * 420px 够放下约 55 个半角字符，剩下的仍靠 title 悬浮看全量。
 */
const DEFAULT_AUTO_FIT_MAX_WIDTH = 420

/** 表格尺寸状态（持久化用） */
export interface TableSizeState {
  /** 每列固定宽度（px）；`null` / 缺位 = 自动（用 CSS 里的默认模板） */
  cols: (number | null)[]
  /** 行高（px）；`null` = 自动 */
  rowHeight: number | null
}

/** {@link bindTableResize} 的入参 */
export interface TableResizeOptions {
  /** 表格容器（行都在它里面；`--table-col-*` / `--table-row-h` 挂在它上面） */
  container: HTMLElement
  /** 上次保存的尺寸（没有 = 全自动） */
  initial?: Partial<TableSizeState>
  /** 尺寸变化时回调（写存储用） */
  onChange?: (state: TableSizeState) => void
  /** 列最小宽度（px），默认 48 */
  minColumnWidth?: number
  /** 行最小高度（px），默认 22 */
  minRowHeight?: number
}

/** {@link TableResizeController.autoFit} 的入参 */
export interface AutoFitOptions {
  /** 单列宽度上限（px），默认 420 */
  maxColumnWidth?: number
}

/** {@link bindTableResize} 的返回值 */
export interface TableResizeController {
  /** 每次重渲染表格后调用：重新应用变量 + 补把手（幂等） */
  decorate: () => void
  /**
   * 按内容自动分配列宽，行高回到「按内容」（momo 反馈：表要能自己分配）
   *
   * 做法：把每一列临时设成 `max-content`（**一次写入**），此时整列宽度 = 该列
   * 最长内容的宽度，再一次性读回表头各格的实际宽度（**一次读取**），夹到
   * [min, max] 后写成固定 px。写读各一次，避免逐列「写一次读一次」把 8 列
   * 变成 8 次强制重排。
   *
   * 行高不写死：写死会把换行的长公式裁掉，而 `min-height: var(--table-row-h, auto)`
   * 的 auto 本来就是「按内容」—— 这正是要的效果。
   *
   * @returns 量到的列数（0 = 表没渲染 / 不可见 → 调用方据此不提示、也不落存储）
   */
  autoFit: (options?: AutoFitOptions) => number
  /** 全部恢复自动 */
  reset: () => void
  /** 当前状态（持久化用；返回副本） */
  getState: () => TableSizeState
  /** 解绑并清掉变量与把手 */
  destroy: () => void
}

/**
 * 给一个表头行补把手（幂等：已存在的跳过）
 *
 * 把手是纯标记，不绑监听器——监听统一挂在容器上（见 `onPointerDown`）。
 *
 * @param head 带 {@link HEAD_CLASS} 的表头行
 */
function decorateHead(head: HTMLElement): void {
  // 行高把手本身也是表头的子元素；不过滤掉的话第二次 decorate() 会把它
  // 当成一格「列」，在它里面再插一个列宽把手（幂等性就破了）
  const cells = [...head.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      !child.classList.contains(COLUMN_HANDLE_CLASS) &&
      !child.classList.contains(ROW_HANDLE_CLASS),
  )
  // 最后一列右边没有下一列，不需要列宽把手
  const columnCells = cells.slice(0, Math.max(cells.length - 1, 0))
  const pending = columnCells
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => cell.querySelector(`:scope > .${COLUMN_HANDLE_CLASS}`) === null)
  for (const { cell, index } of pending) {
    const handle = document.createElement('span')
    handle.className = COLUMN_HANDLE_CLASS
    handle.dataset.col = String(index)
    handle.title = '拖动调整列宽（双击恢复自动）'
    handle.setAttribute('aria-hidden', 'true')
    cell.appendChild(handle)
  }
  if (head.querySelector(`:scope > .${ROW_HANDLE_CLASS}`) === null) {
    const rowHandle = document.createElement('span')
    rowHandle.className = ROW_HANDLE_CLASS
    rowHandle.title = '拖动调整行高（双击恢复自动）'
    rowHandle.setAttribute('aria-hidden', 'true')
    head.appendChild(rowHandle)
  }
}

/**
 * 给一张表接上「拖列宽 / 拖行高」
 *
 * @param options 见 {@link TableResizeOptions}
 * @returns 控制器（`decorate` / `reset` / `getState` / `destroy`）
 */
export function bindTableResize(options: TableResizeOptions): TableResizeController {
  const { container } = options
  const minColumnWidth = options.minColumnWidth ?? 48
  const minRowHeight = options.minRowHeight ?? 22
  const state: TableSizeState = {
    cols: [...(options.initial?.cols ?? [])],
    rowHeight: options.initial?.rowHeight ?? null,
  }

  /** 把状态写到 CSS 变量上（所有行同时生效） */
  const apply = (): void => {
    for (let index = 0; index < state.cols.length; index += 1) {
      const property = `${COLUMN_PROPERTY_PREFIX}${String(index)}`
      const width = state.cols[index] ?? null
      // 没拖过的列不写属性：CSS 里的 `var(--table-col-N, <默认>)` 自动回落
      if (width === null) container.style.removeProperty(property)
      else container.style.setProperty(property, `${String(width)}px`)
    }
    container.style.setProperty(
      ROW_HEIGHT_PROPERTY,
      state.rowHeight === null ? 'auto' : `${String(state.rowHeight)}px`,
    )
  }

  const notify = (): void => {
    options.onChange?.({ cols: [...state.cols], rowHeight: state.rowHeight })
  }

  /**
   * 写某一列的宽度（`null` = 回自动）
   *
   * 必须把中间的空位补齐成 `null`：直接 `state.cols[3] = 120` 会在数组里留洞，
   * `getState()` 就返回 `[undefined, undefined, undefined, 120]`——类型说的是
   * `(number | null)[]`，实际混进 `undefined`，JSON 序列化后虽然会变成 null，
   * 但「拖第 1 列」与「拖第 4 列」得到的状态形状不一致，比对/断言都会咬人。
   */
  const setColumnWidth = (index: number, width: number | null): void => {
    while (state.cols.length < index) state.cols.push(null)
    state.cols[index] = width
    apply()
  }

  /**
   * 拖动过程中的通用收尾（解监听 + 去类 + 落状态）
   *
   * `axis` 写到容器的 `data-resize-axis` 上：CSS 靠它决定全程的光标方向
   * （列宽 `col-resize` / 行高 `row-resize`），否则指针一离开把手就跳回默认箭头。
   */
  const trackPointer = (
    axis: 'column' | 'row',
    onMove: (moveEvent: PointerEvent) => void,
  ): void => {
    container.classList.add(RESIZING_CLASS)
    container.dataset.resizeAxis = axis
    const finish = (): void => {
      container.classList.remove(RESIZING_CLASS)
      delete container.dataset.resizeAxis
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      notify()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const startColumnDrag = (event: PointerEvent, handle: HTMLElement): void => {
    const index = Number(handle.dataset.col ?? '-1')
    const cell = handle.parentElement
    if (cell === null) return
    if (!Number.isSafeInteger(index) || index < 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = cell.getBoundingClientRect().width
    trackPointer('column', (moveEvent) => {
      // 只改被拖的那一列：其余列保持默认模板，多出来的宽度由 fr 列吸收
      setColumnWidth(
        index,
        Math.max(minColumnWidth, Math.round(startWidth + (moveEvent.clientX - startX))),
      )
    })
  }

  const startRowDrag = (event: PointerEvent, handle: HTMLElement): void => {
    event.preventDefault()
    const startY = event.clientY
    // 起点：已有行高，否则用表头自身高度（用户看到的就是这个高度）
    const headRow = handle.closest<HTMLElement>(`.${HEAD_CLASS}`)
    const startHeight = state.rowHeight ?? headRow?.getBoundingClientRect().height ?? minRowHeight
    trackPointer('row', (moveEvent) => {
      state.rowHeight = Math.max(
        minRowHeight,
        Math.round(startHeight + (moveEvent.clientY - startY)),
      )
      apply()
    })
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    const { target } = event
    if (!(target instanceof HTMLElement)) return
    const columnHandle = target.closest<HTMLElement>(`.${COLUMN_HANDLE_CLASS}`)
    if (columnHandle !== null) {
      startColumnDrag(event, columnHandle)
      return
    }
    const rowHandle = target.closest<HTMLElement>(`.${ROW_HANDLE_CLASS}`)
    if (rowHandle !== null) startRowDrag(event, rowHandle)
  }

  /** 双击把手 = 该项恢复自动（用户不用去翻设置） */
  const onDoubleClick = (event: MouseEvent): void => {
    const { target } = event
    if (!(target instanceof HTMLElement)) return
    const columnHandle = target.closest<HTMLElement>(`.${COLUMN_HANDLE_CLASS}`)
    if (columnHandle !== null) {
      const index = Number(columnHandle.dataset.col ?? '-1')
      if (!Number.isSafeInteger(index) || index < 0) return
      setColumnWidth(index, null)
      notify()
      return
    }
    if (target.closest(`.${ROW_HANDLE_CLASS}`) !== null) {
      state.rowHeight = null
      apply()
      notify()
    }
  }

  const decorate = (): void => {
    apply()
    for (const head of container.querySelectorAll<HTMLElement>(`.${HEAD_CLASS}`)) {
      decorateHead(head)
    }
  }

  /**
   * 按内容自动分配列宽 + 行高回自动（见 {@link TableResizeController.autoFit}）
   *
   * 表头格数 = 列数（把手已被过滤），逐列量的是「这一列最长的内容」——
   * 表头自己的文字也在其中，所以「#」「操作」这类短列不会被撑宽。
   *
   * @returns 量到的列数（0 = 表没渲染 / 不可见，调用方据此不提示、也不落存储）
   */
  const measureContentWidths = (fitOptions: AutoFitOptions = {}): number => {
    const maxColumnWidth = fitOptions.maxColumnWidth ?? DEFAULT_AUTO_FIT_MAX_WIDTH
    const head = container.querySelector<HTMLElement>(`.${HEAD_CLASS}`)
    if (head === null) return 0
    // 容器不可见（模块折叠 / 窗格未显示）：量到的全是 0，写下去就成了「全部最小宽」
    if (head.getBoundingClientRect().width === 0) return 0
    const cells = [...head.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        !child.classList.contains(COLUMN_HANDLE_CLASS) &&
        !child.classList.contains(ROW_HANDLE_CLASS),
    )
    if (cells.length === 0) return 0

    for (const index of cells.keys()) {
      container.style.setProperty(`${COLUMN_PROPERTY_PREFIX}${String(index)}`, 'max-content')
    }
    const measured = cells.map((cell) => cell.getBoundingClientRect().width)
    for (const [index, width] of measured.entries()) {
      const rounded = Math.round(width)
      const clamped = Math.min(Math.max(rounded, minColumnWidth), maxColumnWidth)
      setColumnWidth(index, clamped)
    }
    state.rowHeight = null
    apply()
    notify()
    return cells.length
  }

  const reset = (): void => {
    state.cols = state.cols.map(() => null)
    state.rowHeight = null
    apply()
    notify()
  }

  const getState = (): TableSizeState => ({ cols: [...state.cols], rowHeight: state.rowHeight })

  const destroy = (): void => {
    container.removeEventListener('pointerdown', onPointerDown)
    container.removeEventListener('dblclick', onDoubleClick)
    container.classList.remove(RESIZING_CLASS)
    delete container.dataset.resizeAxis
    for (const handle of container.querySelectorAll(
      `.${COLUMN_HANDLE_CLASS}, .${ROW_HANDLE_CLASS}`,
    )) {
      handle.remove()
    }
    // 倒序删：CSSStyleDeclaration 是活对象，正序边迭代边 removeProperty 会跳项
    for (let index = container.style.length - 1; index >= 0; index -= 1) {
      const property = container.style.item(index)
      if (property.startsWith(COLUMN_PROPERTY_PREFIX)) container.style.removeProperty(property)
    }
    container.style.removeProperty(ROW_HEIGHT_PROPERTY)
  }

  container.addEventListener('pointerdown', onPointerDown)
  container.addEventListener('dblclick', onDoubleClick)
  apply()

  return { decorate, autoFit: measureContentWidths, reset, getState, destroy }
}
