/**
 * 通用进度组件
 * @module ui/components/progress
 * @description
 * 统一的进度展示组件，支持三种渲染模式：
 *  - `modal`：全屏遮罩弹窗（同步等阻塞型长任务，含暂停/停止/日志/完成态仪表盘）
 *  - `inline`：嵌入页面容器的行内进度条（清理页、富化页等面板内任务）
 *  - `detach`：浮动于页面角落的独立卡片（不阻塞用户继续操作）
 *
 * 设计要点：
 *  1. 引擎侧协议不变，仍是 `onProgress(current, total, message)`；
 *  2. 完成态内容由调用方注入 HTML（同步的统计图表、清理的摘要等），
 *     组件只负责进度条、日志、按钮与三态（运行 / 完成 / 隐藏）切换；
 *  3. 所有外部注入的 HTML 一律经 `sanitizeHtml` 净化，防 XSS。
 */

import { sanitizeHtml } from '../../tools/sanitize.js'
import { formatDuration } from '../../tools/util/duration.js'

/** 进度组件渲染模式 */
export type ProgressMode = 'modal' | 'inline' | 'detach'

/** 进度组件回调集合（全部可选，未提供的能力对应按钮不渲染） */
export interface ProgressHandlers {
  /** 点击暂停 */
  onPause?: () => void
  /** 点击继续 */
  onResume?: () => void
  /** 点击停止 */
  onStop?: () => void
  /** 弹窗关闭（含完成态关闭与运行中关闭） */
  onClose?: () => void
}

/** 显示进度组件的可选项 */
export interface ProgressShowOptions extends ProgressHandlers {
  /** 标题（如「正在同步」「正在清理」） */
  title: string
  /** 标题前置图标，默认 🔄 */
  icon?: string
  /** 渲染模式 */
  mode: ProgressMode
  /**
   * `mode: 'inline'` 时的宿主容器元素 id（必填）。
   * 组件会把 DOM 挂载进该容器，隐藏时清空容器。
   */
  hostId?: string
  /** 顶部配置摘要 HTML（已净化前的原始串，内部会 sanitize） */
  configHtml?: string
  /** 是否显示实时日志面板，默认 false */
  enableLogs?: boolean
  /** 是否渲染暂停/继续按钮，默认 false */
  enablePause?: boolean
  /** 是否渲染停止按钮，默认 false */
  enableStop?: boolean
  /** 是否显示标题栏（含图标与右上角关闭），`modal` 默认 true，`inline` 默认 false */
  showHeader?: boolean
  /**
   * 阶段名列表（如 `['下载', '比对', '写入']`）。
   *
   * 提供时进度条上方渲染一条阶段时间线，调用方用 `controller.setPhase(i)` 推进。
   * 不提供则不渲染——既有调用方行为完全不变。
   *
   * 动机：同步一次要跑好几个阶段，进度条只给总数，卡在「下载」还是「写入」
   * 只能翻日志；时间线把当前阶段与已完成阶段的耗时直接摆出来。
   */
  phases?: readonly string[]
  /** 完成态标题（不传则用图标区分成功/停止） */
  doneTitle?: string
}

/** 完成态参数 */
export interface ProgressCompleteOptions {
  /** 摘要文本（纯文本，内部以 textContent 写入） */
  summary: string
  /** 完成态自定义 HTML（统计图表等；内部会 sanitize） */
  resultHtml?: string
  /** 详情文本行（无 detailsHtml 时的降级展示，纯文本） */
  details?: string[]
  /** 详情区自定义 HTML（明细表格等；优先于 details，内部会 sanitize） */
  detailsHtml?: string
  /** 是否正常完成（false 表示被用户停止），默认 true */
  ok?: boolean
  /** 完成态标题，默认 ok ? '执行完成' : '已停止' */
  doneTitle?: string
  /** 完成态图标，默认 ok ? '✅' : '⏹️' */
  icon?: string
  /** 提供时渲染「下一步」按钮 */
  onNext?: () => void
}

/** 进度组件实例句柄 */
export interface ProgressController {
  /** 当前渲染模式 */
  readonly mode: ProgressMode
  /** 更新进度 */
  update(current: number, total: number, message?: string, eta?: string): void
  /** 追加一行日志（未启用日志面板时静默忽略） */
  log(line: string): void
  /** 手动切换暂停态的按钮外观（不触发回调，用于引擎侧暂停状态与按钮同步） */
  setPaused(isPaused: boolean): void
  /** 切换为完成态 */
  complete(options: ProgressCompleteOptions): void
  /**
   * 切到指定阶段（配合 `phases` 使用）。
   *
   * 把之前的阶段标为「已完成」（并记录耗时），指定的标为「进行中」。
   * 未启用阶段时间线时静默忽略——调用方不必分支判断。
   */
  setPhase(index: number): void
  /** 隐藏并销毁 */
  hide(): void
  /** 是否处于可见（运行或完成）状态 */
  isActive(): boolean
}

/** 组件内部元素引用（模板保证存在，缺失即抛错） */
interface ProgressElements {
  content: HTMLElement
  head: HTMLElement
  icon: HTMLElement
  title: HTMLElement
  closeTop: HTMLButtonElement
  body: HTMLElement
  config: HTMLElement
  phases: HTMLElement
  section: HTMLElement
  label: HTMLElement
  percent: HTMLElement
  eta: HTMLElement
  globalEta: HTMLElement
  track: HTMLElement
  bar: HTMLElement
  current: HTMLElement
  logWrap: HTMLElement
  log: HTMLElement
  result: HTMLElement
  summary: HTMLElement
  resultBody: HTMLElement
  details: HTMLElement
  footer: HTMLElement
  runningBtns: HTMLElement
  doneBtns: HTMLElement
  pauseBtn: HTMLButtonElement
  stopBtn: HTMLButtonElement
  toggleDetails: HTMLButtonElement
  closeBtn: HTMLButtonElement
  nextBtn: HTMLButtonElement
}

/** 日志区最大行数，超出后丢弃最旧行，避免长任务撑爆内存 */
const LOG_MAX_LINES = 500

/** 组件 DOM 模板（三模式共用，靠外层修饰类切换布局） */
const PROGRESS_TEMPLATE = `
  <div data-el="head" class="bgm-progress__head">
    <div class="bgm-progress__head-left">
      <span data-el="icon" class="bgm-progress__icon">🔄</span>
      <span data-el="title" class="bgm-progress__title"></span>
    </div>
    <button data-el="closeTop" type="button" class="bgm-progress__close" aria-label="关闭" title="关闭">✕</button>
  </div>
  <div data-el="body" class="bgm-progress__body">
    <div data-el="config" class="bgm-progress__config" style="display:none;"></div>
    <ol data-el="phases" class="bgm-progress__phases" style="display:none;"></ol>
    <div data-el="section" class="bgm-progress__section">
      <div class="bgm-progress__meta" aria-live="polite" aria-atomic="true">
        <span data-el="label" class="bgm-progress__label">进度: 准备中...</span>
        <span data-el="percent" class="bgm-progress__percent">--%</span>
        <span data-el="eta" class="bgm-progress__eta" style="display:none;"></span>
        <span data-el="globalEta" class="bgm-progress__global-eta" style="display:none;"></span>
      </div>
      <div data-el="track" class="bgm-progress__track">
        <div data-el="bar" class="bgm-progress__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
      </div>
      <div data-el="current" class="bgm-progress__current"></div>
      <div data-el="logWrap" class="bgm-progress__log-wrap" style="display:none;">
        <div class="bgm-progress__log-label">实时日志:</div>
        <div data-el="log" class="bgm-progress__log" role="log" aria-live="polite"></div>
      </div>
    </div>
    <div data-el="result" class="bgm-progress__result" style="display:none;">
      <div data-el="summary" class="bgm-progress__summary"></div>
      <div data-el="resultBody" class="bgm-progress__result-body"></div>
      <div data-el="details" class="bgm-progress__details" style="display:none;"></div>
    </div>
  </div>
  <div data-el="footer" class="bgm-progress__footer">
    <div data-el="runningBtns" class="bgm-progress__btns">
      <button data-el="pauseBtn" type="button" class="bgm-dialog-btn bgm-dialog-btn-default" aria-label="暂停">⏸️ 暂停</button>
      <button data-el="stopBtn" type="button" class="bgm-dialog-btn bgm-dialog-btn-danger" aria-label="停止">⏹️ 停止</button>
    </div>
    <div data-el="doneBtns" class="bgm-progress__btns" style="display:none;">
      <button data-el="toggleDetails" type="button" class="bgm-dialog-btn bgm-dialog-btn-default" aria-label="显示详情">显示详情</button>
      <button data-el="closeBtn" type="button" class="bgm-dialog-btn bgm-dialog-btn-default" aria-label="关闭">关闭</button>
      <button data-el="nextBtn" type="button" class="bgm-dialog-btn bgm-dialog-btn-primary" aria-label="下一步">下一步 →</button>
    </div>
  </div>
`

/** 查询模板内的必需元素 */
function requireElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`进度组件缺少必需元素: ${selector}`)
  return element
}

/** 查询模板内的必需按钮（需要 HTMLButtonElement 的 disabled/focus 等成员） */
function requireButton(root: ParentNode, selector: string): HTMLButtonElement {
  const element = root.querySelector<HTMLButtonElement>(selector)
  if (element === null) throw new Error(`进度组件缺少必需按钮: ${selector}`)
  return element
}

/** 收集模板内所有元素引用 */
function collectElements(content: HTMLElement): ProgressElements {
  return {
    content,
    head: requireElement(content, '[data-el="head"]'),
    icon: requireElement(content, '[data-el="icon"]'),
    title: requireElement(content, '[data-el="title"]'),
    closeTop: requireButton(content, '[data-el="closeTop"]'),
    body: requireElement(content, '[data-el="body"]'),
    config: requireElement(content, '[data-el="config"]'),
    phases: requireElement(content, '[data-el="phases"]'),
    section: requireElement(content, '[data-el="section"]'),
    label: requireElement(content, '[data-el="label"]'),
    percent: requireElement(content, '[data-el="percent"]'),
    eta: requireElement(content, '[data-el="eta"]'),
    globalEta: requireElement(content, '[data-el="globalEta"]'),
    track: requireElement(content, '[data-el="track"]'),
    bar: requireElement(content, '[data-el="bar"]'),
    current: requireElement(content, '[data-el="current"]'),
    logWrap: requireElement(content, '[data-el="logWrap"]'),
    log: requireElement(content, '[data-el="log"]'),
    result: requireElement(content, '[data-el="result"]'),
    summary: requireElement(content, '[data-el="summary"]'),
    resultBody: requireElement(content, '[data-el="resultBody"]'),
    details: requireElement(content, '[data-el="details"]'),
    footer: requireElement(content, '[data-el="footer"]'),
    runningBtns: requireElement(content, '[data-el="runningBtns"]'),
    doneBtns: requireElement(content, '[data-el="doneBtns"]'),
    pauseBtn: requireButton(content, '[data-el="pauseBtn"]'),
    stopBtn: requireButton(content, '[data-el="stopBtn"]'),
    toggleDetails: requireButton(content, '[data-el="toggleDetails"]'),
    closeBtn: requireButton(content, '[data-el="closeBtn"]'),
    nextBtn: requireButton(content, '[data-el="nextBtn"]'),
  }
}

/**
 * 格式化耗时为可读字符串。
 *
 * 实现已下沉到 `tools/util/duration.ts`（全项目唯一一份 —— `sync/` 层也要用它，
 * 而 `sync/` 不得反向依赖 `ui/`）。此处保留同名转出，既有调用方无需改动。
 */
export { formatDuration } from '../../tools/util/duration.js'

/** 把百分比钳制到 [0, 100]（进度条宽度与 aria-valuenow 共用同一取值口径） */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/** 计算并渲染全局 ETA（基于整体速率外推剩余时间，扣除暂停时长） */
function renderGlobalEta(
  element: HTMLElement,
  current: number,
  total: number,
  elapsedMs: number,
): void {
  if (total <= 0 || elapsedMs <= 0) {
    element.style.display = 'none'
    return
  }
  if (current <= 0) {
    element.textContent = `⏱ 已用${formatDuration(elapsedMs)} · 计算中...`
    element.style.display = ''
    return
  }
  const rate = current / elapsedMs
  const remainingMs = (total - current) / rate
  element.textContent = `⏱ 已用${formatDuration(elapsedMs)} · 预计剩余${formatDuration(remainingMs)} · 总计${formatDuration(elapsedMs + remainingMs)}`
  element.style.display = ''
}

/**
 * 追加一行日志并维持行数上限（超出丢弃最旧行）
 * @returns 追加后的日志行数
 * @remarks 滚动位置由调用方处理：直接写参数的 scrollTop 会触发 no-parameter-reassign
 */
function appendLogLine(log: HTMLElement, line: string, logCount: number): number {
  log.appendChild(document.createTextNode(`${line}\n`))
  let count = logCount + 1
  while (count > LOG_MAX_LINES) {
    if (log.firstChild === null) break
    log.removeChild(log.firstChild)
    count -= 1
  }
  return count
}

/** 解析挂载点：`inline` 用宿主容器，其余新建对应外层容器并挂到 body */
function resolveMount(options: ProgressShowOptions): HTMLElement | null {
  if (options.mode === 'inline') {
    if (!options.hostId) return null
    return document.getElementById(options.hostId)
  }
  if (options.mode === 'detach') {
    const dock = document.createElement('div')
    dock.className = 'bgm-progress__dock'
    document.body.appendChild(dock)
    return dock
  }
  const modal = document.createElement('div')
  modal.className = 'bgm-modal'
  modal.style.display = 'none'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-hidden', 'true')
  document.body.appendChild(modal)
  return modal
}

/**
 * 创建并显示一个进度组件实例
 * @param options 显示参数（模式、标题、能力开关与回调）
 * @returns 进度组件句柄；宿主容器缺失时返回 null（inline 模式专用）
 */
export function createProgress(options: ProgressShowOptions): ProgressController | null {
  const mount = resolveMount(options)
  if (mount === null) return null

  const content = document.createElement('div')
  content.className = `bgm-progress bgm-progress--${options.mode}`
  content.innerHTML = sanitizeHtml(PROGRESS_TEMPLATE)
  const els = collectElements(content)

  // 外层容器：modal 需要包一层 .bgm-modal-content 才能复用弹窗样式
  if (options.mode === 'modal') {
    const shell = document.createElement('div')
    shell.className = 'bgm-modal-content bgm-progress__content'
    shell.appendChild(content)
    mount.appendChild(shell)
  } else {
    mount.appendChild(content)
  }

  // ---- 运行态状态 ----
  let isPaused = false
  let logCount = 0
  const startAt = Date.now()
  let pausedDuration = 0
  let pauseStart = 0
  let isVisible = true
  let escHandler: ((event: KeyboardEvent) => void) | null = null
  /** 「下一步」回调：由 complete() 提供，点击后先关闭再执行 */
  let nextHandler: (() => void) | null = null
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const hasLogs = options.enableLogs ?? false

  // 日志区「是否跟随尾部」用滚动事件维护，而不是每条日志都读 scrollHeight：
  // 读 scrollHeight / scrollTop / clientHeight 会强制同步布局（reflow），
  // 同步流程每行一条日志时就是 O(n) 次 reflow（4000 行 ≈ 4000 次）。
  // 这里只在用户真正滚动时读一次，日志追加只做写入。
  let isFollowTail = true
  els.log.addEventListener(
    'scroll',
    () => {
      isFollowTail = els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 30
    },
    { passive: true },
  )

  // ---- 标题栏 / 能力开关 ----
  const shouldShowHeader = options.showHeader ?? options.mode !== 'inline'
  els.head.style.display = shouldShowHeader ? '' : 'none'
  els.icon.textContent = options.icon ?? '🔄'
  els.title.textContent = options.title
  els.logWrap.style.display = hasLogs ? '' : 'none'
  els.pauseBtn.style.display = options.enablePause === true ? '' : 'none'
  els.stopBtn.style.display = options.enableStop === true ? '' : 'none'
  els.footer.style.display =
    options.enablePause === true || options.enableStop === true || options.mode !== 'inline'
      ? ''
      : 'none'

  if (options.configHtml) {
    els.config.innerHTML = sanitizeHtml(options.configHtml)
    els.config.style.display = ''
  } else {
    els.config.replaceChildren()
    els.config.style.display = 'none'
  }

  // ---- 阶段时间线（可选）----
  const phases = options.phases ?? []
  /** 各阶段的开始时刻；-1 表示该阶段还没进入过 */
  const phaseStartedAt: number[] = phases.map(() => -1)
  /** 各阶段耗时（毫秒）；-1 表示还没结束 */
  const phaseElapsed: number[] = phases.map(() => -1)
  /** 当前阶段下标；-1 表示尚未开始 */
  let currentPhase = -1

  /** 渲染阶段时间线（只在启用时调用一次） */
  const renderPhases = (): void => {
    els.phases.replaceChildren()
    for (const [index, name] of phases.entries()) {
      const item = document.createElement('li')
      item.className = 'bgm-progress__phase bgm-progress__phase--pending'
      item.dataset.phase = String(index)

      const dot = document.createElement('span')
      dot.className = 'bgm-progress__phase-dot'
      const text = document.createElement('span')
      text.className = 'bgm-progress__phase-name'
      text.textContent = name
      const time = document.createElement('span')
      time.className = 'bgm-progress__phase-time'
      time.dataset.el = 'phaseTime'

      item.append(dot, text, time)
      els.phases.appendChild(item)
    }
    els.phases.style.display = ''
  }

  /** 单个阶段的状态：pending（未开始）/ active（进行中）/ done（已完成） */
  const phaseStateOf = (index: number): 'pending' | 'active' | 'done' => {
    if (index < currentPhase) return 'done'
    if (index === currentPhase) return 'active'
    return 'pending'
  }

  /**
   * 按当前状态刷新各个阶段项的类名与耗时文本。
   * 用 className 整体赋值而非 classList 增删：状态是三选一，
   * 整体赋值不会出现「上一个状态的类没被摘掉」的残留。
   */
  const paintPhases = (): void => {
    if (currentPhase < 0) return
    // 直接迭代 NodeList（已带 HTMLElement 类型，省掉 instanceof 判断与 if 包裹）
    for (const item of els.phases.querySelectorAll<HTMLElement>(':scope > li')) {
      const index = Number(item.dataset.phase ?? '-1')
      const state = phaseStateOf(index)
      item.className = `bgm-progress__phase bgm-progress__phase--${state}`
      // aria-current="false" 是合法取值（明确表示非当前项），比 removeAttribute 更省分支
      item.setAttribute('aria-current', state === 'active' ? 'step' : 'false')
      const elapsed = phaseElapsed[index] ?? -1
      const timeElement = item.querySelector<HTMLElement>(':scope > [data-el="phaseTime"]')
      if (timeElement) timeElement.textContent = elapsed >= 0 ? formatDuration(elapsed) : ''
    }
  }

  if (phases.length > 0) renderPhases()

  /** 切到指定阶段：结掉上一个阶段的计时，开启下一个 */
  const setPhase = (index: number): void => {
    if (phases.length === 0) return
    if (!Number.isSafeInteger(index) || index < 0 || index >= phases.length) return
    if (index === currentPhase) return
    const now = Date.now()
    // 结束上一个阶段
    if (currentPhase >= 0 && phaseStartedAt[currentPhase] !== undefined) {
      const started = phaseStartedAt[currentPhase] ?? now
      phaseElapsed[currentPhase] = now - started
    }
    currentPhase = index
    phaseStartedAt[index] = now
    paintPhases()
  }

  // 启用时间线时直接从第 0 阶段开始，调用方不必显式 setPhase(0)
  if (phases.length > 0) setPhase(0)

  // ---- 重置进度区 ----
  els.bar.style.width = '0%'
  els.bar.textContent = ''
  els.bar.setAttribute('aria-valuenow', '0')
  els.label.textContent = '进度: 准备中...'
  els.percent.textContent = '--%'
  els.current.textContent = ''
  els.log.textContent = ''
  isFollowTail = true
  els.eta.style.display = 'none'
  els.globalEta.style.display = 'none'
  els.section.style.display = ''
  els.result.style.display = 'none'
  els.runningBtns.style.display = 'flex'
  els.doneBtns.style.display = 'none'

  /** 同步暂停按钮外观（不触发回调） */
  const syncPauseButton = (): void => {
    els.pauseBtn.textContent = isPaused ? '▶️ 继续' : '⏸️ 暂停'
    els.pauseBtn.setAttribute('aria-label', isPaused ? '继续' : '暂停')
    if (isPaused) {
      els.pauseBtn.classList.remove('bgm-dialog-btn-default')
      els.pauseBtn.classList.add('bgm-dialog-btn-success')
    } else {
      els.pauseBtn.classList.add('bgm-dialog-btn-default')
      els.pauseBtn.classList.remove('bgm-dialog-btn-success')
    }
  }
  syncPauseButton()

  /** 移除完成态注册的 ESC 监听 */
  const clearEscHandler = (): void => {
    if (escHandler === null) return
    document.removeEventListener('keydown', escHandler)
    escHandler = null
  }

  /** 隐藏并销毁（同时恢复焦点） */
  const hide = (): void => {
    if (!isVisible) return
    isVisible = false
    clearEscHandler()
    const parent = content.parentElement
    parent?.removeChild(content)
    if (options.mode === 'modal' || options.mode === 'detach') {
      mount.remove()
    }
    options.onClose?.()
    trigger?.focus()
  }

  // ---- 事件绑定 ----
  els.pauseBtn.addEventListener('click', () => {
    if (!isVisible) return
    if (isPaused) {
      options.onResume?.()
    } else {
      options.onPause?.()
    }
  })
  els.stopBtn.addEventListener('click', () => {
    if (isVisible) options.onStop?.()
  })
  els.closeTop.addEventListener('click', hide)
  els.closeBtn.addEventListener('click', hide)
  els.nextBtn.addEventListener('click', () => {
    const handler = nextHandler
    hide()
    handler?.()
  })
  els.toggleDetails.addEventListener('click', () => {
    const isExpanded = els.details.style.display !== 'none'
    els.details.style.display = isExpanded ? 'none' : ''
    els.toggleDetails.textContent = isExpanded ? '显示详情' : '收起详情'
    els.toggleDetails.setAttribute('aria-label', isExpanded ? '显示详情' : '收起详情')
  })

  // ---- 显示 ----
  if (options.mode === 'modal') {
    mount.style.display = 'flex'
    mount.setAttribute('aria-hidden', 'false')
    // 焦点移至运行态按钮，便于键盘用户直接暂停/停止
    const focusTarget = options.enablePause === true ? els.pauseBtn : els.stopBtn
    focusTarget.focus()
  } else {
    content.style.display = ''
  }

  const controller: ProgressController = {
    mode: options.mode,
    update(current: number, total: number, message?: string, eta?: string): void {
      if (!isVisible) return
      // 钳制到 [0,100]：并发回报乱序或引擎重复回报时 current 可能超过 total，
      // 不钳制会让进度条视觉溢出且 aria-valuenow 超过 aria-valuemax（非法 ARIA）
      const pct = total > 0 ? clampPercent(Math.round((current / total) * 100)) : 0
      els.bar.style.width = `${String(pct)}%`
      els.bar.textContent = `${String(pct)}%`
      els.bar.setAttribute('aria-valuenow', String(pct))
      els.label.textContent = `进度: ${String(current)}/${String(total)}`
      els.percent.textContent = `${String(pct)}%`
      if (message !== undefined) els.current.textContent = message
      if (eta !== undefined && eta !== '') {
        els.eta.textContent = eta
        els.eta.style.display = ''
      } else {
        els.eta.style.display = 'none'
      }
      const elapsed =
        Date.now() - startAt - pausedDuration - (isPaused ? Date.now() - pauseStart : 0)
      renderGlobalEta(els.globalEta, current, total, elapsed)
    },
    log(line: string): void {
      if (!isVisible || !hasLogs) return
      logCount = appendLogLine(els.log, line, logCount)
      if (isFollowTail) els.log.scrollTop = els.log.scrollHeight
    },
    setPaused(isPausedNext: boolean): void {
      if (!isVisible) return
      if (isPausedNext && pauseStart === 0) pauseStart = Date.now()
      if (!isPausedNext && pauseStart > 0) {
        pausedDuration += Date.now() - pauseStart
        pauseStart = 0
      }
      isPaused = isPausedNext
      syncPauseButton()
    },
    complete(completeOptions: ProgressCompleteOptions): void {
      if (!isVisible) return
      // 收尾：结掉最后一个阶段的计时，并把所有阶段标为已完成
      // （时间线在 section 里，section 会被隐藏，所以这里只更新数据态；
      //  被「停止」时保留未完成阶段的 pending 外观，用户能看出卡在哪一步）
      if (phases.length > 0 && currentPhase >= 0) {
        const now = Date.now()
        const started = phaseStartedAt[currentPhase] ?? now
        phaseElapsed[currentPhase] = now - started
        currentPhase = (completeOptions.ok ?? true) ? phases.length : currentPhase
        paintPhases()
      }
      const isOk = completeOptions.ok ?? true
      els.icon.textContent = completeOptions.icon ?? (isOk ? '✅' : '⏹️')
      els.title.textContent = completeOptions.doneTitle ?? (isOk ? '执行完成' : '已停止')
      els.section.style.display = 'none'
      els.result.style.display = ''
      els.runningBtns.style.display = 'none'
      els.doneBtns.style.display = 'flex'
      els.summary.textContent = completeOptions.summary

      if (completeOptions.resultHtml) {
        els.resultBody.innerHTML = sanitizeHtml(completeOptions.resultHtml)
        els.resultBody.style.display = ''
      } else {
        els.resultBody.replaceChildren()
        els.resultBody.style.display = 'none'
      }

      const detailLines = completeOptions.details ?? []
      const { detailsHtml } = completeOptions
      if (detailsHtml !== undefined && detailsHtml !== '') {
        els.details.innerHTML = sanitizeHtml(detailsHtml)
        els.details.classList.add('bgm-progress__details--table')
        els.toggleDetails.style.display = ''
      } else if (detailLines.length > 0) {
        els.details.textContent = detailLines.join('\n')
        els.details.classList.remove('bgm-progress__details--table')
        els.toggleDetails.style.display = ''
      } else {
        els.details.textContent = ''
        els.details.classList.remove('bgm-progress__details--table')
        els.toggleDetails.style.display = 'none'
      }

      nextHandler = completeOptions.onNext ?? null
      els.nextBtn.style.display = nextHandler === null ? 'none' : ''

      // 完成态支持 ESC 关闭
      clearEscHandler()
      escHandler = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') hide()
      }
      document.addEventListener('keydown', escHandler)
      els.closeBtn.focus()
    },
    setPhase,
    hide,
    isActive: (): boolean => isVisible,
  }

  return controller
}

// ===================================================================
// 便捷全局入口：操作「最近创建」的实例
// 适用于全局唯一进度（如同步弹窗），调用方无需自己持有句柄
// ===================================================================

/** 最近一次创建的进度实例 */
let _activeProgress: ProgressController | null = null

/**
 * 显示进度组件并置为当前活跃实例
 * @returns 句柄；宿主缺失时返回 null
 */
export function showProgress(options: ProgressShowOptions): ProgressController | null {
  _activeProgress?.hide()
  const controller = createProgress(options)
  _activeProgress = controller
  return controller
}

/** 更新当前活跃实例进度（无实例时静默忽略） */
export function updateProgress(
  current: number,
  total: number,
  message?: string,
  eta?: string,
): void {
  _activeProgress?.update(current, total, message, eta)
}

/** 向当前活跃实例追加日志（无实例或未启用日志时静默忽略） */
export function appendProgressLog(line: string): void {
  _activeProgress?.log(line)
}

/** 切换当前活跃实例为完成态 */
export function completeProgress(options: ProgressCompleteOptions): void {
  _activeProgress?.complete(options)
}

/** 隐藏并销毁当前活跃实例 */
export function hideProgress(): void {
  _activeProgress?.hide()
  _activeProgress = null
}

/** 获取当前活跃实例（供调用方按需直接操作） */
export function getActiveProgress(): ProgressController | null {
  return _activeProgress
}
