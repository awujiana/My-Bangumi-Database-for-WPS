/**
 * @fileoverview 窗口能力原语：吞拖拽后的 click / 缩放 / 最大化
 * @module ui/components/windowChrome
 * @description 模态框（modal-drag）与浮动窗（detachable-panel）的「窗口 chrome」
 *   能力收敛于此——两边的拖动/收起/缩放曾各写一份，钳制口径、超时兜底容易漂移
 *   （momo：模态框组件和浮动窗口组件功能能否统一）。
 *
 *   **统一的是能力原语，不是组件本体**：遮罩模态框是一次性居中交互（开时重置
 *   居中、关即销毁），浮动窗是常驻面板（DOM 搬家 + 几何记忆 + 可停靠），生命周期
 *   完全不同，硬合一个组件只会把两边都搞复杂。本模块先收编跨组件复用的部分：
 *   - {@link suppressPostDragClick}：原 modal-drag / sortable-list 各一份同源实现；
 *   - {@link bindModalResize}：模态框右下角缩放把手（浮动窗的缩放范式 + 模态框
 *     的 fixed 抬升基准，见 modal-drag.bindModalDrag）；
 *   - {@link bindModalMaximize}：标题栏 ⛶ 最大化 / 还原（对齐浮动窗的最大化），
 *     几何走内联样式快照，还原即回到拖动/缩放留下的位置或 CSS 居中。
 *
 *   detachable-panel 自身的拖动/缩放暂未迁入：它带 transform 合成层与几何记忆，
 *   迁移是独立的重构，见模块尾注。
 */

/** 拖拽/缩放结束后吞掉那一次 click
 *
 * 模态框拖离遮罩中心后，松手时浏览器补发的 click 落在**遮罩空白处**
 * （modal 已经不在原位置），而「点遮罩关闭」的判定是 `event.target === mask`
 * ——于是「一拖动就关闭」（momo 实测：导入弹窗拖一下就没了）。
 *
 * window 上加一次 capture 阶段拦截，拦掉那一次 click 后自摘。**必须带超时
 * 兜底**——pointerup 后不一定紧跟 click（触摸 / 触控笔场景就没有），拦截器
 * 挂着不摘会把用户之后真正的点击也吞掉。
 */
export function suppressPostDragClick(): void {
  let isRemoved = false
  // handler 先持变量、后赋值：remove 与 handler 互相引用，
  // 任一定义在前都踩 no-use-before-define
  let handler: ((event: Event) => void) | null = null
  const remove = (): void => {
    if (isRemoved) return
    isRemoved = true
    if (handler) window.removeEventListener('click', handler, { capture: true })
  }
  handler = (event: Event): void => {
    event.stopPropagation()
    event.preventDefault()
    remove()
  }
  window.addEventListener('click', handler, { capture: true })
  window.setTimeout(remove, 300)
}

/** 最大化态的类名（bindModalDrag 见它即不启动拖动：最大化后拖标题无意义） */
export const MODAL_MAXIMIZED_CLASS = 'is-maximized'

/** 缩放后的最小尺寸：低于它内容被裁没、把手也按不准（对齐浮动窗的保底思路） */
const MIN_MODAL_WIDTH = 280
const MIN_MODAL_HEIGHT = 120

/** 视口四周留的空隙（最大化 / 缩放上界都用它，不贴死屏幕边） */
const VIEWPORT_INSET = 8

/**
 * 给模态框绑右下角缩放把手
 *
 * 缩放起点先把模态框抬升为 fixed（与拖动同款：记当前视口矩形作基准），
 * 否则 flex 居中的子项改宽高会两边对称长、把手抓的点就漂了。宽高 rAF 合帧，
 * 钳制在 `[min, 视口-当前left/top-留隙]`——放大不超出视口（任务窗格就是
 * iframe 视口），缩小不小于保底。
 *
 * 缩放过的模态框挂 `is-resized` 类：CSS 借它把内容区（如导入列表）从
 * 「定高滚动」切换成「吃满剩余高度」，放大才有意义。
 */
export function bindModalResize(options: { modal: HTMLElement; handle: HTMLElement }): void {
  const { modal, handle } = options
  handle.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()

    const startX = event.clientX
    const startY = event.clientY
    // 抬升为 fixed：缩放期间几何不再受遮罩 flex 居中摆布（与拖动同款）
    const rect = modal.getBoundingClientRect()
    if (modal.style.getPropertyValue('position') !== 'fixed') {
      modal.style.setProperty('position', 'fixed')
      modal.style.setProperty('margin', '0')
      modal.style.setProperty('left', `${String(rect.left)}px`)
      modal.style.setProperty('top', `${String(rect.top)}px`)
    }
    const startWidth = rect.width
    const startHeight = rect.height
    modal.classList.add('is-dragged', 'is-resized')

    // rAF 合帧：与拖动同口径，一帧至多写一次样式
    let frame: number | null = null
    let latestX = 0
    let latestY = 0
    const flush = (): void => {
      frame = null
      // 上界随当前 left/top 走：fixed 下位置不动，宽高放大到撞视口即停
      const maxWidth = Math.max(MIN_MODAL_WIDTH, window.innerWidth - rect.left - VIEWPORT_INSET)
      const maxHeight = Math.max(MIN_MODAL_HEIGHT, window.innerHeight - rect.top - VIEWPORT_INSET)
      const width = Math.min(Math.max(MIN_MODAL_WIDTH, startWidth + latestX), maxWidth)
      const height = Math.min(Math.max(MIN_MODAL_HEIGHT, startHeight + latestY), maxHeight)
      modal.style.setProperty('width', `${String(width)}px`)
      modal.style.setProperty('height', `${String(height)}px`)
    }
    const onMove = (moveEvent: PointerEvent): void => {
      latestX = moveEvent.clientX - startX
      latestY = moveEvent.clientY - startY
      frame ??= window.requestAnimationFrame(flush)
    }
    const onUp = (): void => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
        frame = null
      }
      flush()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  })
}

/**
 * 给模态框标题栏的 ⛶ 按钮绑「最大化 / 还原」
 *
 * 最大化 = fixed + 铺满视口（留 {@link VIEWPORT_INSET} 空隙）；还原 = 写回
 * 最大化前抓的内联几何快照（可能是拖动/缩放留下的位置，也可能是空——
 * 空值 removeProperty，元素回 CSS 居中）。状态以 `is-maximized` 类为准
 * （外部清类后按钮再点会重新走最大化分支，不会拿旧快照套错）。
 */
export function bindModalMaximize(options: { modal: HTMLElement; button: HTMLElement }): void {
  const { modal, button } = options
  const GEOMETRY_PROPERTIES = ['position', 'margin', 'left', 'top', 'width', 'height'] as const
  let snapshot: Map<string, string> | null = null

  button.addEventListener('click', () => {
    const isMaximized = modal.classList.contains(MODAL_MAXIMIZED_CLASS)
    if (!isMaximized) {
      snapshot = new Map(
        GEOMETRY_PROPERTIES.map((property) => [property, modal.style.getPropertyValue(property)]),
      )
      modal.style.setProperty('position', 'fixed')
      modal.style.setProperty('margin', '0')
      modal.style.setProperty('left', `${String(VIEWPORT_INSET)}px`)
      modal.style.setProperty('top', `${String(VIEWPORT_INSET)}px`)
      modal.style.setProperty('width', `${String(window.innerWidth - VIEWPORT_INSET * 2)}px`)
      modal.style.setProperty('height', `${String(window.innerHeight - VIEWPORT_INSET * 2)}px`)
      modal.classList.add(MODAL_MAXIMIZED_CLASS)
      button.textContent = '🗗'
      button.setAttribute('aria-label', '还原窗口大小')
      button.setAttribute('aria-pressed', 'true')
      return
    }
    // 还原：快照里有值写回，空值清掉（回到 CSS 居中）
    const restore = snapshot ?? new Map<string, string>()
    for (const [property, value] of restore) {
      if (value === '') modal.style.removeProperty(property)
      else modal.style.setProperty(property, value)
    }
    modal.classList.remove(MODAL_MAXIMIZED_CLASS)
    button.textContent = '⛶'
    button.setAttribute('aria-label', '最大化窗口')
    button.setAttribute('aria-pressed', 'false')
  })
}

/** detachable-panel 迁移尾注：浮动窗的 bindDrag / 缩放 / 最大化带 transform
 * 合成层与 PluginStorage 几何记忆，迁到本模块须先抽「几何记忆」接口，
 * 避免为统一而把面板特有逻辑反向灌进通用层。 */
