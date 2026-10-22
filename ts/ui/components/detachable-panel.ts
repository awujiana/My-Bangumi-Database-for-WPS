/**
 * @fileoverview 可拖出浮动窗口的通用组件（detachable panel）
 * @module ui/components/detachablePanel
 * @description 把页面上任意「区块」按需拖出成一个独立浮动窗口：可拖动、可缩放、
 *   可最大化、可收起，关掉后原样回到页面原位。
 *
 * ## 为什么要做成组件（而不是每页手写一份）
 * 第一版是条件格式页专用的 `#conditionalFormatFloat`：一个页面一套 DOM、一套 CSS、
 * 一套拖动逻辑。用户要「所有页面能应用的都应用」时，复制 6 份必然漂移。
 * 抽成组件后，页面侧只需要一个属性：
 * ```html
 * <section id="sec-preview" data-detachable data-detachable-title="执行前预览"> … </section>
 * ```
 *
 * ## 四条硬约束
 * 1. **默认在页面上**：不拖出时就是普通 section，组件不改变任何既有布局与交互。
 *    浮动是**可选项**，用户主动点「⧉」才发生。
 * 2. **搬家而非复制**：拖出时把 section 这个 DOM 节点**整体移动**到浮动窗口 body，
 *    关闭时搬回原父节点的原位置（记住原下一个兄弟节点，避免排到 section 末尾）。
 *    复制一份会出现「浮动窗口里删了规则、正文列表还在」的两份视图漂移；
 *    搬家后事件监听随节点走，**页面代码继续 `getElementById` 读写同一份 DOM** ——
 *    这就是「原页面在变化」的实现方式：不是同步，是同一份。
 * 3. **几何计算是纯函数**：`(起点, 位移, 视口, 下限) → 新值`，没有 DOM 依赖，
 *    可以直接在 Node 下单测越界钳制与最小尺寸。DOM 层只负责把算出的值写回 style。
 * 4. **拖出后原位置留占位块**：否则正文会突然塌陷一大块，用户以为内容丢了。
 *    占位块上带「收回」按钮，给出明确回路。
 *
 * ## 交互细节（真机踩过或一定会踩的坑）
 * - `setPointerCapture`：不用的话鼠标挪快了移出标题栏就「脱轨」，之后收不到
 *   pointermove，窗口粘在鼠标上直到用户再点一次；
 * - `hasPointerCapture` 守卫后再 `releasePointerCapture`：pointercancel 时浏览器
 *   已经自动释放，直接 release 会抛 NotFoundError；
 * - 视口尺寸读 `window.innerWidth/Height`：便宜且不触发重排；真正要避的是在 move
 *   回调里读 `offsetWidth` / `getBoundingClientRect()`（强制同步布局，每帧抖一次），
 *   故尺寸全程由 `rect` 状态维护，拖动只做加法；
 * - 拖动写 `transform: translate()` 而不是 `left/top`：后者每帧变一次，浏览器就要
 *   重排 + 重绘整个面板内容（预览表 / 规则表几百行时一帧几十毫秒，实测拖起来
 *   明显掉帧）；transform 命中合成层（配合 `.is-dragging` 的 `will-change` 提示），
 *   每帧只做一次层平移，内容一次都不用重画。位移在 pointerup 时一次性提交回
 *   left/top —— 几何的单一来源始终是 `rect`，transform 只在拖动期存在；
 * - 位置钳制在视口内：不允许把窗口拖到屏幕外（否则找不回来，只能刷新任务窗格）。
 */

import {
  isWebDialogSupported,
  openWebDialog,
  resolveDialogUrl,
} from '../../tools/wps-web-dialog.js'
import type { WebDialogSession } from '../../tools/wps-web-dialog.js'

/** 视口尺寸（拖动 / 缩放开始时读一次） */
export interface ViewportSize {
  width: number
  height: number
}

/** 面板矩形：位置 + 尺寸（内联样式的唯一来源） */
export interface PanelRect {
  left: number
  top: number
  width: number
  height: number
}

/** 面板尺寸下限（再小内容就被裁没了） */
export const MIN_PANEL_WIDTH = 360
export const MIN_PANEL_HEIGHT = 200

/** 收起后只剩标题栏的高度 */
export const COLLAPSED_HEIGHT = 40

/** 未指定尺寸时的默认窗口大小 */
export const DEFAULT_PANEL_WIDTH = 720
export const DEFAULT_PANEL_HEIGHT = 520

/**
 * 浮动窗口的层级：低于页面模态框（各页 modal-mask 都是 1000），
 * 高于正文（正文最高 100）。多窗口不靠 z-index 抢层级 —— 一律用同一个值，
 * 谁在上面由 DOM 顺序决定，「点谁谁置顶」就是把节点重新 append 到 body 末尾。
 * 早先用「每开一个 +1」会一路涨到盖住模态框，确认对话框被压在下面。
 */
const PANEL_Z_INDEX = 900

/** 几何记忆：key = 面板 id，关闭再打开时恢复上次的位置与尺寸 */
const geometryMemory = new Map<string, PanelRect>()

/** 收回函数（拖出中的面板各一个；存函数而非句柄可避免前向引用） */
type DetachCloser = () => void

/** 当前处于拖出状态的收回函数栈（Esc 关最上面那个） */
const detachedClosers: DetachCloser[] = []

/** Esc 监听是否装过（全局只装一次） */
let isEscapeBound = false

/**
 * 钳制拖动后的位置：窗口必须完整留在视口内
 *
 * 允许负 left/top 吗？不允许 —— 负值会把标题栏推到视口外，用户再也抓不回来。
 */
export function clampPosition(
  position: { left: number; top: number },
  size: { width: number; height: number },
  viewport: ViewportSize,
): { left: number; top: number } {
  const maxLeft = Math.max(0, viewport.width - size.width)
  const maxTop = Math.max(0, viewport.height - size.height)
  return {
    left: Math.min(Math.max(0, position.left), maxLeft),
    top: Math.min(Math.max(0, position.top), maxTop),
  }
}

/**
 * 钳制缩放后的尺寸：不小于下限、不大于视口
 *
 * 宽高都保底：只保宽不保高的话用户能把面板压成一条线，内容全被裁掉。
 */
export function clampSize(
  size: { width: number; height: number },
  viewport: ViewportSize,
): { width: number; height: number } {
  const maxWidth = Math.max(MIN_PANEL_WIDTH, viewport.width)
  const maxHeight = Math.max(MIN_PANEL_HEIGHT, viewport.height)
  return {
    width: Math.min(Math.max(MIN_PANEL_WIDTH, size.width), maxWidth),
    height: Math.min(Math.max(MIN_PANEL_HEIGHT, size.height), maxHeight),
  }
}

/** 收起 / 展开时的目标高度：收起收到标题栏一行，展开还原（不低于下限） */
export function nextPanelHeight(
  currentHeight: number,
  isCollapsed: boolean,
  restoredHeight: number,
): number {
  return isCollapsed
    ? COLLAPSED_HEIGHT
    : Math.max(MIN_PANEL_HEIGHT, restoredHeight || currentHeight)
}

/**
 * 新窗口的默认位置：居中后再按已开数量做阶梯偏移
 *
 * 阶梯偏移是必须的：不开偏移的话连开三个窗口会严丝合缝叠在一起，
 * 用户只看到「没反应」。
 */
export function defaultPanelRect(
  openCount: number,
  viewport: ViewportSize,
  desiredWidth = DEFAULT_PANEL_WIDTH,
  desiredHeight = DEFAULT_PANEL_HEIGHT,
): PanelRect {
  const size = clampSize({ width: desiredWidth, height: desiredHeight }, viewport)
  const step = 24
  const offset = (openCount % 6) * step
  const position = clampPosition(
    {
      left: (viewport.width - size.width) / 2 + offset,
      top: (viewport.height - size.height) / 2 + offset,
    },
    size,
    viewport,
  )
  return { left: position.left, top: position.top, width: size.width, height: size.height }
}

// ===== DOM 装配 =====

/** 单个可拖出面板的对外句柄 */
export interface DetachablePanelHandle {
  /** 拖出为浮动窗口 */
  readonly detach: () => void
  /** 收回页面原位 */
  readonly attach: () => void
  /** 开 / 关切换 */
  readonly toggle: () => void
  /** 当前是否已拖出 */
  readonly isDetached: () => boolean
  /** 解绑并移除浮动窗口（页面销毁时调用） */
  readonly destroy: () => void
}

/** 创建单个可拖出面板时的可选项（`| undefined` 是 `exactOptionalPropertyTypes` 要求） */
export interface DetachablePanelOptions {
  /** 窗口标题；缺省取区块标题元素（h3/h2）的文本 */
  title?: string | undefined
  /** 初始宽度（px） */
  width?: number | undefined
  /** 初始高度（px） */
  height?: number | undefined
  /** 挂进窗口标题栏的工具条元素（随窗口显示，不随内容搬家） */
  toolbar?: HTMLElement | null | undefined
  /** 外部已有的触发按钮（例：条件格式页的「🔍 规则管理器」） */
  trigger?: HTMLElement | null | undefined
  /**
   * 拖出方式
   * - `float`（默认）：任务窗格内的浮动窗口，可拖动 / 缩放，但出不了窗格边界；
   * - `native`：宿主原生独立窗口，能浮到 WPS 表格上面、能最大化。
   *   宿主不支持时**自动回落**到 `float`，不会变成点了没反应。
   */
  mode?: DetachableMode | undefined
  /**
   * `native` 模式下窗口要加载的页面（相对当前页面解析，见 `resolveDialogUrl`）
   *
   * 必须是**独立页面**：原生对话框是另一个 WebView，拿不到本页的 DOM，
   * 搬不了节点。页面里要自己装配同一套逻辑（对话框页复用 `conditional-format-page.js`）。
   */
  nativeUrl?: string | undefined
  /** 拖出后回调（页面可借此刷新一次数据） */
  onDetach?: (() => void) | undefined
  /** 收回后回调 */
  onAttach?: (() => void) | undefined
}

/** 触发按钮的类名（样式 + 测试定位） */
export const TRIGGER_BUTTON_CLASS = 'detachable-trigger'

/** 占位块的类名 */
export const PLACEHOLDER_CLASS = 'detachable-placeholder'

/** 浮动窗口根元素类名 */
export const PANEL_CLASS = 'detachable-panel'

/** 区块被拖出后加在它身上的类（原生模式用它隐藏区块，不用 hidden 属性：section 的 display 会盖掉它） */
const DETACHED_CLASS = 'detachable-detached'

/** 拖出方式 */
export type DetachableMode = 'float' | 'native'

/** 原生对话框存活轮询间隔（ms）。
 *  一轮要两次 COM 往返（`GetWebDialog(id)` + 读 `Visible`），1 秒一轮在用户
 *  操作原生窗口期间是持续的宿主演入；2 秒足够快（占位块最多多留 1 秒），
 *  负担减半。 */
const NATIVE_POLL_INTERVAL = 2000

/** 标记「该区块已装配」的属性（通用扫描据此跳过，避免重复注入） */
const DETACHABLE_READY_ATTRIBUTE = 'data-detachable-ready'

/** 拖动 / 缩放进行中的类名（用于禁用过渡与文本选中） */
const DRAGGING_CLASS = 'is-dragging'
const RESIZING_CLASS = 'is-resizing'
const COLLAPSED_CLASS = 'is-collapsed'
const MAXIMIZED_CLASS = 'is-maximized'

/** 读视口：只在 pointerdown 时调用一次 */
function readViewport(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** 建一个带 class 的 div */
function makeDiv(cssClass: string): HTMLDivElement {
  const element = document.createElement('div')
  element.className = cssClass
  return element
}

/**
 * 判断事件目标是不是可交互控件。
 * 放在模块作用域：`bindDrag` 里定义会被 `consistent-function-scoping` 判为可外提。
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, select, input, textarea, a'))
}

/** 建一个图标按钮（不落地成变量，避免动词前缀误伤） */
function makeIconButton(
  icon: string,
  label: string,
  cssClass: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = cssClass
  button.textContent = icon
  button.title = label
  button.setAttribute('aria-label', label)
  button.addEventListener('click', onClick)
  return button
}

/**
 * 造一个「已拖出」占位块
 *
 * float 与 native 两种模式共用，只是文案不同 —— 两者对用户的回路是一样的：
 * 原位置不会凭空塌陷，且都给一个「收回」按钮（少了它用户只能刷新任务窗格找回来）。
 */
function makePlaceholder(message: string, onRecall: () => void): HTMLElement {
  const placeholder = makeDiv(PLACEHOLDER_CLASS)
  const icon = document.createElement('span')
  icon.className = 'detachable-placeholder-icon'
  icon.textContent = '⧉'
  icon.setAttribute('aria-hidden', 'true')
  const text = document.createElement('span')
  text.className = 'detachable-placeholder-text'
  text.textContent = message
  const recall = document.createElement('button')
  recall.type = 'button'
  recall.className = 'bgm-btn small detachable-placeholder-recall'
  // 文案用「还原」而非「关闭」：用户要的是「把内容放回原位」这个语义，
  // 「关闭」容易被理解成把内容丢掉（区块其实一直在，只是搬去了窗口里）。
  recall.textContent = '还原'
  recall.title = '把区块收回本页面原位'
  recall.setAttribute('aria-label', recall.title)
  recall.addEventListener('click', onRecall)
  placeholder.append(icon, text, recall)
  return placeholder
}

/**
 * 造一个 native 模式句柄：把区块换成宿主原生独立窗口
 *
 * ## 与 float 模式的两处本质差异
 * 1. **不搬 DOM**：原生对话框是另一个 WebView，本页节点搬不过去。所以
 *    区块本体留在页面上（加 `.detachable-detached` 隐藏），窗口里加载
 *    `nativeUrl` 指向的独立页面 —— 那份页面自己装配同一套逻辑。
 * 2. **窗口能被用户在 WPS 里直接关掉**（系统关闭按钮），任务窗格无从得知。
 *    故开窗口后轮询 `isAlive()`，发现关了就自动收回 ——
 *    否则占位块会永久卡在「已拖出」，而窗口早没了（比塌陷更难发现）。
 */
function createNativeDetachable(
  section: HTMLElement,
  resolved: DetachablePanelOptions,
): DetachablePanelHandle {
  const title = resolved.title ?? '浮动窗口'
  const homeParent = section.parentElement
  const homeNextSibling = section.nextElementSibling
  const placeholder = makePlaceholder(`「${title}」已拖出为独立窗口`, attach)

  let session: WebDialogSession | null = null
  let pollTimer: number | null = null
  let isDetached = false

  function stopPolling(): void {
    if (pollTimer === null) return
    window.clearInterval(pollTimer)
    pollTimer = null
  }

  function attach(): void {
    if (!isDetached) return
    stopPolling()
    if (session) session.close()
    session = null
    isDetached = false
    // 用 class 而非 hidden 属性：`.section` 自带 display 会盖掉 [hidden]
    section.classList.remove(DETACHED_CLASS)
    placeholder.remove()
    resolved.onAttach?.()
  }

  function detach(): void {
    // 已经开着就别再开第二个：原生窗口没有「置顶」回调，重复开只会叠一屏窗口
    if (session?.isAlive()) return
    const { nativeUrl } = resolved
    if (!nativeUrl) return
    const opened = openWebDialog({
      url: resolveDialogUrl(nativeUrl, window.location.href),
      title,
      width: resolved.width ?? DEFAULT_PANEL_WIDTH,
      height: resolved.height ?? DEFAULT_PANEL_HEIGHT,
      isModal: false,
    })
    if (!opened) return
    session = opened
    isDetached = true
    section.classList.add(DETACHED_CLASS)
    if (homeParent?.isConnected) {
      if (homeNextSibling?.isConnected) homeNextSibling.before(placeholder)
      else homeParent.append(placeholder)
    }
    // 用户在 WPS 里点系统关闭按钮时，本页收不到任何事件 —— 只能轮询。
    // 1 秒一次足够快，开销可忽略（一次 COM 属性读取）。
    pollTimer = window.setInterval(() => {
      if (session?.isAlive() === false) attach()
    }, NATIVE_POLL_INTERVAL)
    resolved.onDetach?.()
  }

  const trigger = resolved.trigger ?? injectTrigger(section, title)
  const onTriggerClick = (): void => {
    if (isDetached) attach()
    else detach()
  }
  trigger?.addEventListener('click', onTriggerClick)

  return {
    detach,
    attach,
    toggle: onTriggerClick,
    isDetached: () => isDetached,
    destroy: () => {
      attach()
      trigger?.removeEventListener('click', onTriggerClick)
      section.removeAttribute(DETACHABLE_READY_ATTRIBUTE)
    },
  }
}

/**
 * 给把手绑上「按住拖动」行为
 *
 * 用 pointer capture 而非 window 监听：capture 后即使指针移出把手甚至移出窗口，
 * 事件仍然派发给把手，不会脱轨。
 *
 * @param onEnd 拖动结束回调（在最后一次位移落定之后调用）：供调用方把
 *   「拖动期临时状态」提交回正式状态。拖动可能一个 rAF 都没等到就结束，
 *   所以这里保证先 flush 再 onEnd，调用方不会丢最后几像素。
 */
function bindDrag(
  grip: HTMLElement,
  root: HTMLElement,
  draggingClass: string,
  onStart: () => void,
  onDelta: (deltaX: number, deltaY: number) => void,
  onEnd?: () => void,
): void {
  // 标题栏里嵌了按钮 / 下拉，按在这些控件上不应该启动拖动
  grip.addEventListener('pointerdown', (event: PointerEvent) => {
    // 只响应主键：右键 / 中键拖动会和系统菜单、滚轮冲突
    if (event.button !== 0) return
    if (isInteractiveTarget(event.target)) return

    const startX = event.clientX
    const startY = event.clientY
    grip.setPointerCapture(event.pointerId)
    root.classList.add(draggingClass)
    // 拖动起点：让调用方捕获基准几何与视口（见下方 onStart 说明）
    onStart()

    // rAF 合帧：pointermove 可能快于屏幕刷新率，每次都写 style 会让一帧内跑多次
    // 「样式重算 + 布局」。只记最新位移，一帧至多写一次。
    let frame: number | null = null
    let latestX = 0
    let latestY = 0
    const flush = (): void => {
      frame = null
      onDelta(latestX, latestY)
    }

    const onMove = (moveEvent: PointerEvent): void => {
      latestX = moveEvent.clientX - startX
      latestY = moveEvent.clientY - startY
      frame ??= window.requestAnimationFrame(flush)
    }
    const onUp = (): void => {
      // 收尾补一次：最后一个 rAF 可能还没跑，直接结束会丢掉最后几像素
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
        frame = null
      }
      flush()
      root.classList.remove(draggingClass)
      grip.removeEventListener('pointermove', onMove)
      grip.removeEventListener('pointerup', onUp)
      grip.removeEventListener('pointercancel', onUp)
      // pointercancel 时浏览器已自动释放，未守卫直接 release 会抛 NotFoundError
      if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId)
      // 提交放在撤类之后：两次样式写入在同一个任务里，浏览器只做一次重算，
      // 不会出现「先看见窗口跳回基准位、再跳到终点」的中间帧。
      onEnd?.()
    }

    grip.addEventListener('pointermove', onMove)
    grip.addEventListener('pointerup', onUp)
    grip.addEventListener('pointercancel', onUp)
    event.preventDefault()
  })
}

/** 从区块里取标题文本：优先 data 属性，其次 h3/h2 文本（去掉内嵌按钮的字） */
function readSectionTitle(section: HTMLElement): string {
  const fromAttribute = section.dataset.detachableTitle
  if (fromAttribute) return fromAttribute.trim()

  const heading = section.querySelector('h3, h2')
  if (!heading) return '浮动窗口'

  const clone = heading.cloneNode(true) as HTMLElement
  clone.querySelectorAll('button').forEach((button) => {
    button.remove()
  })
  // 去掉内嵌按钮的字（折叠按钮、拖出按钮都会污染标题）
  return (clone.textContent || '').replace(/\s+/g, ' ').trim() || '浮动窗口'
}

/** 读 HTML 上的数字属性，缺省或非法值返回 undefined */
function readNumberAttribute(section: HTMLElement, name: 'width' | 'height'): number | undefined {
  const raw = name === 'width' ? section.dataset.detachableWidth : section.dataset.detachableHeight
  if (!raw) return undefined
  // 不用 parseInt：`radix` 规则要基数、`unicorn/prefer-number-coercion` 又不许写 10，
  // 两条规则在这个点上互斥。属性是我们自己写的，直接 Number() 足够。
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** 按 id 找元素（只接受 HTMLElement，找不到返回 null） */
function elementById(id: string | undefined): HTMLElement | null {
  if (!id) return null
  const found = document.getElementById(id)
  return found instanceof HTMLElement ? found : null
}

/** 从 HTML 属性读出该区块的配置 */
function readOptionsFromDataset(section: HTMLElement): DetachablePanelOptions {
  return {
    title: readSectionTitle(section),
    width: readNumberAttribute(section, 'width'),
    height: readNumberAttribute(section, 'height'),
    mode: section.dataset.detachableMode === 'native' ? 'native' : 'float',
    nativeUrl: section.dataset.detachableUrl,
    toolbar: elementById(section.dataset.detachableToolbar),
    trigger: elementById(section.dataset.detachableTrigger),
  }
}

/**
 * 把区块变成可拖出的
 *
 * @param section 要被搬家的区块（通常是 `<section>`）
 * @param options 可选项；不传时全部从 `data-detachable-*` 属性读
 * @returns 句柄；入参不是 HTMLElement 时返回 null（页面侧直接 `?.` 即可）
 */
export function createDetachablePanel(
  section: HTMLElement,
  options: DetachablePanelOptions = {},
): DetachablePanelHandle | null {
  if (!(section instanceof HTMLElement)) return null
  // 幂等：页面若已用 `createDetachablePanel` 定制过（传了回调 / 工具条），
  // 通用扫描必须让路，否则会再注入一个「⧉」按钮、再建一个窗口。
  // 用 attribute 而非 dataset 赋值：`no-param-reassign` 禁止写入入参属性。
  if (section.getAttribute(DETACHABLE_READY_ATTRIBUTE) === 'true') return null
  section.setAttribute(DETACHABLE_READY_ATTRIBUTE, 'true')

  const resolved: DetachablePanelOptions = {
    title: options.title ?? readSectionTitle(section),
    width: options.width ?? readNumberAttribute(section, 'width') ?? DEFAULT_PANEL_WIDTH,
    height: options.height ?? readNumberAttribute(section, 'height') ?? DEFAULT_PANEL_HEIGHT,
    mode: options.mode ?? readOptionsFromDataset(section).mode,
    nativeUrl: options.nativeUrl ?? section.dataset.detachableUrl,
    toolbar: options.toolbar ?? elementById(section.dataset.detachableToolbar),
    trigger: options.trigger ?? elementById(section.dataset.detachableTrigger),
    onDetach: options.onDetach,
    onAttach: options.onAttach,
  }

  // native 需要宿主支持；不支持时**静默回落** float —— 用户照样能拖出，
  // 只是窗口在任务窗格内。功能不丢比「点了没反应」重要。
  if (resolved.mode === 'native' && resolved.nativeUrl && isWebDialogSupported()) {
    return createNativeDetachable(section, resolved)
  }

  const panelId = section.id || `detachable-${String(geometryMemory.size + 1)}`
  const title = resolved.title ?? '浮动窗口'

  // ---- 浮动窗口骨架（追加到 body：position fixed 相对视口，可宽于任务窗格）----
  const root = makeDiv(PANEL_CLASS)
  root.dataset.detachableFor = panelId
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', title)
  root.style.zIndex = String(PANEL_Z_INDEX)
  root.hidden = true

  // ---- 几何（必须早于按钮创建：折叠按钮的回调要读 rect 当前高度）----
  const rect: PanelRect = geometryMemory.get(panelId) ?? {
    ...defaultPanelRect(detachedClosers.length, readViewport(), resolved.width, resolved.height),
  }

  function applyPosition(): void {
    root.style.left = `${String(rect.left)}px`
    root.style.top = `${String(rect.top)}px`
  }

  function applySize(): void {
    root.style.width = `${String(rect.width)}px`
    root.style.height = `${String(rect.height)}px`
  }

  function applyRect(): void {
    applyPosition()
    applySize()
    // transform 是「只在拖动期存在」的临时偏移，任何一次全量落地都把它撤掉，
    // 保证几何的单一来源始终是 rect + left/top（最大化前也必须撤，否则
    // inset 定位会被残留位移顶偏）。
    root.style.transform = ''
  }

  /** 记住几何，供下次打开恢复（只在收回时写一次，避免拖动过程频繁写 Map） */
  function rememberRect(): void {
    geometryMemory.set(panelId, { ...rect })
  }

  const header = document.createElement('header')
  header.className = 'detachable-panel-header'

  const grip = document.createElement('span')
  grip.className = 'detachable-panel-grip'
  grip.textContent = '⡇'
  grip.setAttribute('aria-hidden', 'true')

  const titleNode = document.createElement('span')
  titleNode.className = 'detachable-panel-title'
  titleNode.textContent = title

  const toolbarSlot = makeDiv('detachable-panel-toolbar')

  const actions = makeDiv('detachable-panel-actions')
  const buttonCollapse = makeIconButton('▾', '收起 / 展开', 'detachable-panel-icon-btn', () => {
    const isCollapsed = root.classList.toggle(COLLAPSED_CLASS)
    root.style.height = isCollapsed ? `${String(COLLAPSED_HEIGHT)}px` : `${String(rect.height)}px`
    buttonCollapse.textContent = isCollapsed ? '▸' : '▾'
    buttonCollapse.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true')
  })
  buttonCollapse.setAttribute('aria-expanded', 'true')
  const buttonMaximize = makeIconButton('⤢', '最大化 / 还原', 'detachable-panel-icon-btn', () => {
    const isMaximized = root.classList.toggle(MAXIMIZED_CLASS)
    if (isMaximized) {
      // 最大化靠 CSS 的 inset，必须清掉内联几何，否则内联优先级更高撑不开
      // （transform 同理：残留的拖动位移会把最大化窗口顶偏）
      root.style.left = ''
      root.style.top = ''
      root.style.width = ''
      root.style.height = ''
      root.style.transform = ''
    } else {
      applyRect()
    }
    buttonMaximize.textContent = isMaximized ? '⤡' : '⤢'
  })
  // 还原按钮用**文字**而非图标：三个并排小图标（▾ ⤢ ✕）曾被当成「刷新窗口」，
  // 没人猜得到 ✕ 是「放回页面原位」。文字按钮语义自明，不再依赖 tooltip。
  const buttonRestore = makeIconButton(
    '还原',
    '还原：把模块放回页面原位',
    'detachable-panel-restore-btn',
    () => {
      attach()
    },
  )
  actions.append(buttonCollapse, buttonMaximize, buttonRestore)
  header.append(grip, titleNode, toolbarSlot, actions)

  const body = makeDiv('detachable-panel-body')
  const resizeHandle = makeDiv('detachable-panel-resize')
  resizeHandle.setAttribute('role', 'separator')
  resizeHandle.setAttribute('aria-label', '拖动缩放窗口')
  resizeHandle.title = '拖动缩放'

  root.append(header, body, resizeHandle)

  // ---- 占位块：拖出后顶在原位置，避免正文塌陷 ----
  const placeholder = makePlaceholder(`「${title}」已拖出为浮动窗口`, attach)

  // 拖动 / 缩放期间的基准：起点几何 + 起点视口。
  // 视口只在 pointerdown 时读一次（`window.innerWidth/Height` 有挂起样式变更时会触发
  // 强制布局，逐帧读 = 逐帧重排）；几何用「基准 + 累计位移」算绝对位置 —— 若用
  // 「当前 rect + 累计位移」，rect 已被上一帧改过，位移会被重复累加，窗口越拖越快。
  let dragViewport: ViewportSize = readViewport()
  let dragBase: PanelRect = { ...rect }
  /** 拖动期相对基准位置的位移；只在拖动中非零，onEnd 提交后清零 */
  let dragDeltaX = 0
  let dragDeltaY = 0

  bindDrag(
    header,
    root,
    DRAGGING_CLASS,
    () => {
      dragBase = { ...rect }
      dragViewport = readViewport()
      dragDeltaX = 0
      dragDeltaY = 0
    },
    (deltaX, deltaY) => {
      const next = clampPosition(
        { left: dragBase.left + deltaX, top: dragBase.top + deltaY },
        { width: dragBase.width, height: dragBase.height },
        dragViewport,
      )
      dragDeltaX = next.left - dragBase.left
      dragDeltaY = next.top - dragBase.top
      // 只写 transform，不碰 left/top：left/top 每帧变一次，浏览器就要重排 +
      // 重绘整个面板内容（预览表 / 规则表几百行时一帧几十毫秒，这就是「拖动
      // 掉帧」的本因）。transform 命中合成层，配合 .is-dragging 的 will-change
      // 提示，每帧只做一次层平移，内容一次都不用重画。
      root.style.transform = `translate(${String(dragDeltaX)}px, ${String(dragDeltaY)}px)`
    },
    () => {
      // 收尾提交：基准 + 最终位移写回 rect 与 left/top，撤掉临时 transform，
      // 几何回到单一来源（rect + left/top）。
      rect.left = dragBase.left + dragDeltaX
      rect.top = dragBase.top + dragDeltaY
      dragDeltaX = 0
      dragDeltaY = 0
      applyRect()
    },
  )

  bindDrag(
    resizeHandle,
    root,
    RESIZING_CLASS,
    () => {
      dragBase = { ...rect }
      dragViewport = readViewport()
    },
    (deltaX, deltaY) => {
      const next = clampSize(
        { width: dragBase.width + deltaX, height: dragBase.height + deltaY },
        dragViewport,
      )
      rect.width = next.width
      rect.height = next.height
      // 缩放必须改 width/height（内容要跟着重排），只写尺寸不写位置，
      // 少两个属性的样式失效。
      applySize()
    },
  )

  // 点击任意位置置顶：把节点重新 append 到 body 末尾（同 z-index 下由 DOM 顺序决定层级）。
  // 已是最后一个就别再 append —— 重复 append 等于「移除再插入」，会强制整树样式重算，
  // 而这个监听在每次 pointerdown（含每次拖动开始）都会触发。
  root.addEventListener('pointerdown', () => {
    if (document.body.lastElementChild !== root) document.body.append(root)
  })

  // ---- 搬家 ----
  const homeParent = section.parentElement
  const homeNextSibling = section.nextElementSibling

  function detach(): void {
    // 无条件 append（已连接时等于「移到末尾」）：后开的窗口排在后面，天然在上面
    document.body.append(root)
    if (homeParent?.isConnected) {
      if (homeNextSibling?.isConnected) homeNextSibling.before(placeholder)
      else homeParent.append(placeholder)
    }
    body.append(section)
    root.hidden = false
    root.classList.remove(COLLAPSED_CLASS, MAXIMIZED_CLASS)
    buttonCollapse.textContent = '▾'
    buttonCollapse.setAttribute('aria-expanded', 'true')
    buttonMaximize.textContent = '⤢'
    applyRect()
    // 工具条只在窗口里才有意义（作用于当前窗口内容），显示出来
    if (resolved.toolbar) {
      toolbarSlot.append(resolved.toolbar)
      resolved.toolbar.hidden = false
    }
    if (!detachedClosers.includes(attach)) detachedClosers.push(attach)
    resolved.onDetach?.()
  }

  function attach(): void {
    if (root.hidden) return
    rememberRect()
    if (homeParent?.isConnected) {
      if (homeNextSibling?.isConnected) homeNextSibling.before(section)
      else homeParent.append(section)
    } else {
      // 原父节点被整块重渲染掉时（个别页面会重写容器）不能让区块凭空消失，
      // 兜底挂回 body 至少保证内容还在、可滚动看到。
      document.body.append(section)
    }
    placeholder.remove()
    if (resolved.toolbar) {
      resolved.toolbar.hidden = true
      document.body.append(resolved.toolbar)
    }
    root.hidden = true
    const index = detachedClosers.indexOf(attach)
    if (index !== -1) detachedClosers.splice(index, 1)
    resolved.onAttach?.()
  }

  // ---- 触发按钮 ----
  const trigger = resolved.trigger ?? injectTrigger(section, title)
  const onTriggerClick = (): void => {
    if (root.hidden) detach()
    else attach()
  }
  trigger?.addEventListener('click', onTriggerClick)

  const handle: DetachablePanelHandle = {
    detach,
    attach,
    toggle: onTriggerClick,
    isDetached: () => !root.hidden,
    destroy: () => {
      attach()
      trigger?.removeEventListener('click', onTriggerClick)
      root.remove()
      section.removeAttribute(DETACHABLE_READY_ATTRIBUTE)
    },
  }

  return handle
}

/**
 * 在区块标题里注入「拖出」按钮
 *
 * 没有标题元素时退化为插到区块最前面 —— 有按钮总比没有入口强。
 */
function injectTrigger(section: HTMLElement, title: string): HTMLElement | null {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = TRIGGER_BUTTON_CLASS
  button.textContent = '⧉'
  button.title = `把「${title}」拖出为浮动窗口（可拖动 / 缩放 / 最大化）`
  button.setAttribute('aria-label', button.title)

  const heading = section.querySelector('h3, h2')
  if (heading) heading.append(button)
  else section.prepend(button)
  return button
}

/** 给文档里所有 `[data-detachable]` 区块装上拖出能力 */
export function setupDetachablePanels(scope: ParentNode = document): DetachablePanelHandle[] {
  const sections = scope.querySelectorAll<HTMLElement>('[data-detachable]')
  const handles: DetachablePanelHandle[] = []
  sections.forEach((section) => {
    const handle = createDetachablePanel(section, readOptionsFromDataset(section))
    if (handle) handles.push(handle)
  })
  bindEscapeToCloseTopmost()
  return handles
}

/** Esc 关闭最上面的浮动窗口（全局只绑一次） */
function bindEscapeToCloseTopmost(): void {
  if (isEscapeBound) return
  isEscapeBound = true
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    detachedClosers.at(-1)?.()
  })
}

/** 供测试 / 调试：清空模块级状态 */
export function resetDetachablePanelsForTest(): void {
  geometryMemory.clear()
  detachedClosers.length = 0
}
