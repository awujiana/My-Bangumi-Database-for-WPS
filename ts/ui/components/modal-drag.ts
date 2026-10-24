/**
 * @fileoverview 模态框拖动与「拉回可见区」（纯 DOM，零 WPS 依赖，可 jsdom 单测）
 * @module ui/components/modalDrag
 * @description 遮罩式模态框（条件格式页的规则编辑器 / 导入手工规则 / 归组命名 /
 *   双策略确认）此有两个实测缺陷（2026-10-24 用户反馈）：
 *
 *   1. **拖不动**：模态框是遮罩 flex 居中的子项，位置完全由 CSS 决定——任务窗格
 *      窄、宿主滚动模型各异时它可能落在半屏外，用户却没有任何办法移动它；
 *   2. **显示不全**：遮罩用 absolute + top=scrollY 锚定文档，模态框 max-height 用
 *      `calc(100vh - 64px)`；宿主「iframe 视口 = 内容全高」或页面滚动后，
 *      模态框会整体落在可见区外（截图：标题栏被切掉半个）。
 *
 *   本模块补两能力：
 *   - {@link bindModalDrag}：按住标题栏把手拖动模态框。指针按下时把模态框抬升为
 *     `position: fixed`（基准几何 = 当前视口矩形），位移 rAF 合帧（一帧至多写一次
 *     样式，指针事件快于屏幕刷新时不掉帧），并做视口钳制——横向允许露头但保证
 *     ≥96px 可抓宽度，纵向钳在 `[0, 视口高-40]`：「拖出去找不回来」是最糟的
 *     失败模式（与 detachable-panel 的 bindDrag 同口径）。
 *   - {@link bringModalIntoView}：打开后量一次，越界就 scrollBy 修正并重锚遮罩
 *     top——修「iframe 内部滚动」宿主模型下的显示不全；「iframe=内容全高」模型
 *     下 window 不可滚（scrollBy 是 no-op），此时靠拖动兜底。
 *
 *   与 detachable-panel 的 bindDrag 的分工：那个服务「区块拖出为浮动窗口」
 *   （transform 合成层 + pointerup 时落 left/top），本模块服务「遮罩内小模态框」
 *   （直接写 left/top，没有可复用的基准几何）。事件监听挂 **window** 而不是
 *   把手 + setPointerCapture：老宿主 / jsdom 没有指针捕获 API，window 监听
 *   在两者下都能完整收到 move/up（拖到遮罩外也不丢事件）。
 */

/** 横向露头时至少保留的可抓宽度（px）：小于它用户就再也抓不到标题栏了 */
const MIN_GRAB_WIDTH = 96

/** 纵向钳制时标题栏至少露出的高度（px） */
const MIN_TITLE_VISIBLE = 40

/** 把手（标题栏）里嵌了这些控件时，按上去不启动拖动（要优先响应控件本身） */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('button, a, input, select, textarea, [role="button"]') !== null
}

/** 把模态框几何限制在视口内（留出可抓宽度 / 标题可见高度） */
function clampLeft(startLeft: number, deltaX: number, width: number): number {
  const maxLeft = Math.max(0, window.innerWidth - MIN_GRAB_WIDTH)
  // 允许向左露头，但露出的部分不能超过「宽度 - 可抓宽度」
  const minLeft = Math.min(0, MIN_GRAB_WIDTH - width)
  return Math.min(Math.max(startLeft + deltaX, minLeft), maxLeft)
}

/** 纵向钳制：顶不能高于视口顶，底至少要留标题栏高度在视口内 */
function clampTop(startTop: number, deltaY: number): number {
  const maxTop = Math.max(0, window.innerHeight - MIN_TITLE_VISIBLE)
  return Math.min(Math.max(startTop + deltaY, 0), maxTop)
}

/**
 * 给模态框绑「拖标题栏移动」
 *
 * 拖动开始时把模态框抬升为 fixed（记下当前视口矩形作基准），结束时保留
 * left/top（停在用户放的位置）；下次打开由 {@link resetModalPosition} 清回
 * CSS 居中，不记住上次位置（模态框是「一次性」交互，重新居中最好找）。
 */
export function bindModalDrag(options: { modal: HTMLElement; grip: HTMLElement }): void {
  const { modal, grip } = options
  grip.addEventListener('pointerdown', (event: PointerEvent) => {
    // 只响应主键：右键 / 中键拖动会和系统菜单冲突
    if (event.button !== 0) return
    if (isInteractiveTarget(event.target)) return
    event.preventDefault()

    const startX = event.clientX
    const startY = event.clientY
    const rect = modal.getBoundingClientRect()
    const startLeft = rect.left
    const startTop = rect.top

    // 抬升：flex 子项 → fixed。margin 必须清零，否则遮罩的 flex 居中 margin
    // 会让 left/top 相对元素盒本身再偏移一次（基准几何就歪了）。
    modal.style.setProperty('position', 'fixed')
    modal.style.setProperty('margin', '0')
    modal.style.setProperty('left', `${String(startLeft)}px`)
    modal.style.setProperty('top', `${String(startTop)}px`)
    modal.classList.add('is-dragged')

    // rAF 合帧：pointermove 可能快于屏幕刷新率，每次都写 style 会让一帧内
    // 跑多次「样式重算 + 布局」。只记最新位移，一帧至多写一次。
    let frame: number | null = null
    let latestX = 0
    let latestY = 0
    const flush = (): void => {
      frame = null
      modal.style.setProperty('left', `${String(clampLeft(startLeft, latestX, rect.width))}px`)
      modal.style.setProperty('top', `${String(clampTop(startTop, latestY))}px`)
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
 * 清掉拖动留下的内联几何，让模态框回到遮罩的 CSS 居中位
 *
 * 打开模态框前调用（每次打开都重新居中，不记住上次拖到的位置）。
 */
export function resetModalPosition(modal: HTMLElement): void {
  modal.style.removeProperty('position')
  modal.style.removeProperty('margin')
  modal.style.removeProperty('left')
  modal.style.removeProperty('top')
  modal.classList.remove('is-dragged')
}

/**
 * 打开后把模态框拉回可见区（iframe 内部滚动模型下修正「显示不全」）
 *
 * 量模态框矩形：顶部越界 → 向下滚到底部对齐；底部越界 → 向上滚。滚动后
 * **必须重锚遮罩 top**——遮罩是 absolute 相对文档的，不跟着走就会错位
 * （anchored top 还是旧 scrollY，遮罩盖住的是滚走前的区域）。
 *
 * 「iframe 视口 = 内容全高」的宿主模型下 window 不可滚，scrollBy 是 no-op，
 * 重锚写的是同一个值，无害；那种模型只能靠拖动兜底（见模块注释）。
 */
export function bringModalIntoView(mask: HTMLElement, modal: HTMLElement): void {
  const rect = modal.getBoundingClientRect()
  const overflowTop = 8 - rect.top
  const overflowBottom = rect.bottom - (window.innerHeight - 8)
  if (overflowTop <= 0 && overflowBottom <= 0) return
  const delta = overflowTop > 0 ? overflowTop : -overflowBottom
  window.scrollBy(0, delta)
  mask.style.setProperty('top', `${String(window.scrollY)}px`)
}

/**
 * 给模态框标题栏的收起按钮绑「收起 / 展开」
 *
 * 收起 = 只留标题栏一行（body / footer 用 CSS 藏掉），再点展开——
 * 与 detachable-panel 浮动窗的 ▾/▸ 同范式（momo：确认框要能收起，
 * 范围看完先收起来，别一直挡着后面的表格）。
 *
 * 只切 class + 改 aria，不碰几何：拖过的位置（fixed + left/top）不受影响，
 * 展开后还在原处。按钮文字 ▾↔▸ 与模块折叠按钮一致。
 */
export function bindModalCollapse(options: { modal: HTMLElement; button: HTMLElement }): void {
  const { modal, button } = options
  button.addEventListener('click', () => {
    const isCollapsed = modal.classList.toggle('is-collapsed')
    button.textContent = isCollapsed ? '▸' : '▾'
    button.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true')
  })
}
