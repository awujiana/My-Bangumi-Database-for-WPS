/**
 * @fileoverview 通用右键菜单（任何页面的任何组件可挂，单例）
 * @module ui/components/contextMenu
 * @description 六个页面共用的「右键菜单 / 上下文菜单」组件。此前的交互只有
 *   行内小按钮与底部批量条：按钮挤在 96px 操作列里（↑↓✕⤵ 挤一排），
 *   低频操作（导入 / 归组 / 切换「如果为真则停」）要么没有入口、要么藏在
 *   批量条里要先勾选。右键菜单把「针对这一行的全部操作」收到指针处，
 *   任何组件一行接线即可挂载：
 *
 *   ```ts
 *   attachContextMenu(row, () => [
 *     { id: 'edit', label: '✎ 编辑', onSelect: () => openEditor(row.dataset.ruleId) },
 *     { id: 'sep', separator: true },
 *     { id: 'del', label: '✕ 删除', danger: true, onSelect: () => remove(row.dataset.ruleId) },
 *   ])
 *   ```
 *
 *   设计要点（对标 VS Code / dnd-kit 生态菜单的手感）：
 *   - **单例**：同时只存在一个菜单，开新的先关旧的（绝不叠罗汉）；
 *   - **视口翻转**：默认在指针处展开，右 / 下溢出时翻到另一侧，永不出屏；
 *   - **完整键盘**：↑↓ 循环导航、Home/End、Enter 执行、Esc 关闭并还原焦点，
 *     Tab 不困在菜单里（直接关）；aria role=menu/menuitem；
 *   - **关闭时机**：Esc、外部点击、窗口 scroll/resize（页面滚走还挂在原地的
 *     菜单比没有更糟）、执行动作后；
 *   - **危险操作**标红但不二次确认（确认由调用方的 onSelect 负责，菜单只递达）。
 */

/** 可执行菜单项 */
export interface ContextMenuAction {
  /** 稳定 id（同一份菜单内唯一） */
  id: string
  /** 显示文本（项目风格：emoji 前缀 + 中文） */
  label: string
  /** 右侧快捷键提示（纯展示，如 'Ctrl+C'） */
  shortcut?: string
  /** 危险操作（删除类）：红色，hover 也更醒目 */
  danger?: boolean
  /** 禁用：不可聚焦、不可点（保留可见，让用户知道「有这操作但现在不行」） */
  disabled?: boolean
  /** 禁用时的原因（进 title 提示；不填用通用文案） */
  disabledReason?: string
  /**
   * 选中回调。返回 `false` 可阻止关闭（极少用，如「切换」类操作想留在菜单里）；
   * 默认执行后关闭。同步抛错会被吞掉并打日志——不让一个坏项弄坏菜单骨架。
   *
   * 返回类型用 `unknown` 而非 `void | boolean | Promise<void>`：项目的
   * no-invalid-void-type 禁 union 里出现 void；调用方什么都不返回（多数）
   * 或返回 boolean / Promise 都合法，内部只关心 `=== false` 与 Promise 两种形态。
   */
  onSelect?: () => unknown
  /** 占位：可执行项不是分隔线（联合判别用，见 ContextMenuItem） */
  separator?: never
}

/** 分隔线项：只能给 id + separator，其余字段一律不许给（写错编译期就红） */
export interface ContextMenuSeparator {
  id: string
  separator: true
  label?: never
  shortcut?: never
  danger?: never
  disabled?: never
  disabledReason?: never
  onSelect?: never
}

/** 菜单项 = 可执行项 | 分隔线 */
export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator

/** showContextMenu 的入参 */
export interface ContextMenuShowOptions {
  items: readonly ContextMenuItem[]
  /** 指针 clientX（右键事件的 clientX） */
  x: number
  /** 指针 clientY */
  y: number
  /** 触发元素：关闭后焦点还原给它；不传则不还原 */
  anchor?: HTMLElement
}

/** 视口翻转 + 钳位的纯计算（菜单定位的唯一算法，单测直测） */
export function resolveMenuPosition(options: {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  /** 距视口边缘留白（px） */
  margin?: number
}): { left: number; top: number } {
  const margin = options.margin ?? 8
  // 右侧放不下 → 翻到指针左边；左边也放不下 → 贴视口左边
  const left =
    options.x + options.width + margin <= options.viewportWidth
      ? options.x
      : Math.max(margin, options.x - options.width)
  // 下侧放不下 → 翻到指针上边；上面也放不下 → 贴视口顶
  const top =
    options.y + options.height + margin <= options.viewportHeight
      ? options.y
      : Math.max(margin, options.y - options.height)
  return { left, top }
}

/** 当前菜单的 DOM 根（单例；null = 没开） */
let menuRoot: HTMLElement | null = null
/** 打开前的焦点元素（关闭时还原） */
let focusReturn: HTMLElement | null = null

/** 建元素的小工具（class + 文本一次到位） */
function makeElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cssClass: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.className = cssClass
  if (text !== undefined) element.textContent = text
  return element
}

/** 当前可聚焦（未禁用）的菜单项，按 DOM 序 */
function enabledItems(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('.bgm-context-menu-item')].filter(
    (item) => item.getAttribute('aria-disabled') !== 'true',
  )
}

/** 把焦点移到第 index 个可用项（循环） */
function focusItem(root: HTMLElement, index: number): void {
  const items = enabledItems(root)
  if (items.length === 0) return
  const count = items.length
  const wrapped = ((index % count) + count) % count
  items[wrapped]?.focus()
}

/** 给按钮挂回调（dataset 存不了函数，用非枚举属性携带） */
interface MenuButtonElement extends HTMLButtonElement {
  __bgmOnSelect?: () => unknown
}

/** 执行一个菜单项；禁用的直接无视 */
function activateItem(item: MenuButtonElement): void {
  if (item.getAttribute('aria-disabled') === 'true') return
  const handler = item.__bgmOnSelect
  if (handler === undefined) return
  try {
    const result = handler()
    // 返回 false = 调用方想留在菜单里（切换类操作）；默认执行后关闭
    if (result === false) return
    if (result instanceof Promise) {
      // 异步动作（写 COM 等）：先关菜单，动作在后台跑完（调用方负责 toast）
      hideContextMenu()
      void (async (): Promise<void> => {
        try {
          await result
        } catch (error: unknown) {
          // eslint-disable-next-line no-console -- 纯 DOM 组件不依赖日志后端，console 是菜单动作兜底日志的唯一通道
          console.error('[contextMenu] 菜单动作执行失败', error)
        }
      })()
      return
    }
    hideContextMenu()
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- 同上：坏项不能弄坏菜单骨架，兜底打日志
    console.error('[contextMenu] 菜单动作执行失败', error)
    hideContextMenu()
  }
}

/** 关菜单（幂等；没开时 no-op） */
export function hideContextMenu(): void {
  if (menuRoot !== null) {
    menuRoot.remove()
    menuRoot = null
  }
  focusReturn = null
}

/** 菜单是否开着 */
export function isContextMenuOpen(): boolean {
  return menuRoot !== null
}

/**
 * 在指定坐标打开菜单（单例：已在开先关旧的）
 *
 * 定位算法见 {@link resolveMenuPosition}：先按内容实测宽高（挂到 DOM 后再量），
 * 再翻转钳位。打开期间锁三件事：外部点击关闭、scroll/resize 关闭、Esc 关闭。
 */
export function showContextMenu(options: ContextMenuShowOptions): void {
  // 不再运行时过滤空 label：ContextMenuAction.label 是必填（联合类型编译期保证），
  // 分隔线是独立接口——过滤逻辑已被类型系统接管，运行时只判空列表
  if (options.items.length === 0) return
  hideContextMenu()

  const root = makeElement('div', 'bgm-context-menu')
  root.setAttribute('role', 'menu')

  for (const item of options.items) {
    if (item.separator === true) {
      const separator = makeElement('div', 'bgm-context-menu-separator')
      separator.setAttribute('role', 'separator')
      root.append(separator)
    } else {
      const button = makeElement('button', 'bgm-context-menu-item')
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.dataset.menuItem = item.id
      button.append(makeElement('span', 'bgm-context-menu-label', item.label))
      if (item.shortcut !== undefined) {
        button.append(makeElement('span', 'bgm-context-menu-shortcut', item.shortcut))
      }
      if (item.danger === true) button.classList.add('is-danger')
      if (item.disabled === true) {
        button.setAttribute('aria-disabled', 'true')
        button.title = item.disabledReason ?? '当前不可用'
      }
      // 有回调才挂 click；没有回调的项保持可聚焦可导航（点了没反应而已）——
      // 不能因为它没有回调就偷偷标 aria-disabled：读屏会念成「禁用」，
      // 而它只是没接线（调用方漏传 onSelect 是编程错误，不该伪装成禁用态）
      if (item.onSelect !== undefined) {
        const buttonWithHandler = button as MenuButtonElement
        buttonWithHandler.__bgmOnSelect = item.onSelect
        button.addEventListener('click', () => {
          activateItem(buttonWithHandler)
        })
      }
      root.append(button)
    }
  }

  focusReturn = options.anchor ?? (document.activeElement as HTMLElement | null)
  document.body.append(root)
  menuRoot = root

  // 实测宽高后定位（内容宽度只有挂上 DOM 才量得到）
  const rect = root.getBoundingClientRect()
  const { left, top } = resolveMenuPosition({
    x: options.x,
    y: options.y,
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  })
  root.style.setProperty('left', `${String(left)}px`)
  root.style.setProperty('top', `${String(top)}px`)
  // 开场动画：挂上去的下一帧再摘 class，让 CSS transition 有机会跑
  root.classList.add('is-opening')
  requestAnimationFrame(() => {
    root.classList.remove('is-opening')
  })

  // 键盘导航（挂在 root 上：焦点在菜单内才响应）
  root.addEventListener('keydown', (event: KeyboardEvent) => {
    const items_ = enabledItems(root)
    const current = items_.indexOf(document.activeElement as HTMLButtonElement)
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        focusItem(root, current + 1)
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        focusItem(root, current - 1)
        break
      }
      case 'Home': {
        event.preventDefault()
        focusItem(root, 0)
        break
      }
      case 'End': {
        event.preventDefault()
        focusItem(root, items_.length - 1)
        break
      }
      case 'Enter':
      case ' ': {
        // 按钮上 Enter/Space 本来就会触发 click，这里只对非按钮焦点兜底
        event.preventDefault()
        const active = document.activeElement
        if (active instanceof HTMLButtonElement) activateItem(active)
        break
      }
      case 'Escape': {
        event.preventDefault()
        // 先捕获再关：hideContextMenu 会把 focusReturn 清掉，之后再读就是 null
        // （焦点还原会静默失效——Esc 关菜单后焦点掉去 body，键盘用户原地迷失）
        const returnTo = focusReturn
        hideContextMenu()
        returnTo?.focus()
        break
      }
      case 'Tab': {
        // 菜单不困 Tab：直接关，焦点去下一个控件
        hideContextMenu()
        break
      }
      default: {
        break
      }
    }
  })

  // 外部交互关闭：capture 阶段拦，早于页面自己的处理器
  window.addEventListener('pointerdown', onOutsidePointerDown, { capture: true })
  window.addEventListener('resize', onDismissByViewport, { capture: true })
  window.addEventListener('scroll', onDismissByViewport, { capture: true })

  focusItem(root, 0)
}

/** 外部按下：点在菜单外就关（capture，先于业务处理器） */
function onOutsidePointerDown(event: PointerEvent): void {
  if (menuRoot === null) return
  const { target } = event
  if (target instanceof Node && !menuRoot.contains(target)) hideContextMenu()
}

/** 视口变化（scroll/resize）：菜单挂在固定坐标，页面滚走还原地挂着比没有更糟 */
function onDismissByViewport(): void {
  hideContextMenu()
}

/**
 * 给元素挂右键菜单（稳定元素用；动态列表的行用 {@link attachDelegatedContextMenu}）
 *
 * @param provider 菜单项提供者：每次右键时调用（可按元素 dataset / 状态返回
 *   不同菜单）；返回空数组 = 不拦默认菜单（让浏览器原生菜单出来）。
 * @returns 解绑函数（组件销毁 / DOM 搬家后调用；detachable-panel 的
 *   appendChild 搬家不丢监听器，但卸载旧 DOM 时必须解）
 */
export function attachContextMenu(
  element: HTMLElement,
  provider: (element: HTMLElement) => readonly ContextMenuItem[],
): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    const items = provider(element)
    if (items.length === 0) return
    event.preventDefault()
    showContextMenu({ items, x: event.clientX, y: event.clientY, anchor: element })
  }
  element.addEventListener('contextmenu', onContextMenu)
  return () => {
    element.removeEventListener('contextmenu', onContextMenu)
  }
}

/**
 * 委托式挂右键菜单（给「行会反复重渲染」的动态列表用）
 *
 * 逐行 attachContextMenu 在 innerHTML 重渲染后要全部解绑重挂（347 行就是
 * 347 次 add/remove），还容易漏。委托挂在**容器**上：contextmenu 冒泡到容器，
 * 用 closest(itemSelector) 找到行——重渲染只换子节点，容器监听不动。
 *
 * @param provider 菜单项提供者：每次右键时调用（可按行 dataset / 状态返回不同菜单）；
 *   返回空数组 = 不拦默认菜单
 * @returns 解绑函数
 */
export function attachDelegatedContextMenu(
  container: HTMLElement,
  itemSelector: string,
  provider: (item: HTMLElement) => readonly ContextMenuItem[],
): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    const { target } = event
    if (!(target instanceof Element)) return
    const item = target.closest<HTMLElement>(itemSelector)
    if (item === null || !container.contains(item)) return
    const items = provider(item)
    if (items.length === 0) return
    event.preventDefault()
    showContextMenu({ items, x: event.clientX, y: event.clientY, anchor: item })
  }
  container.addEventListener('contextmenu', onContextMenu)
  return () => {
    container.removeEventListener('contextmenu', onContextMenu)
  }
}
