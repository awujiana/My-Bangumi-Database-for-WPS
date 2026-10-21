/**
 * @fileoverview 宿主 COM 就绪闸门（首屏零 COM + 初始化分片 + 卡顿降级）
 *
 * 背景（高亮页面打开卡 70 秒）：WPS 任务窗格在「新窗格打开 → 宿主渲染进程 attach →
 * COM 桥建好」之间存在一个**初始化窗口**。在这个窗口里从渲染进程发起**任何同步跨进程
 * COM 调用**（`getDataSheet` / `Worksheet.Range.Read` / `PluginStorage` 读写）都会让
 * 宿主主线程阻塞：宿主同步等渲染进程回复，渲染进程又被宿主的同步 IPC 堵住 ——
 * 宿主与渲染进程互锁死等，直到 JSAPI 桥的看门狗超时（实测 10s 轻 COM / 70s 大 Range）。
 *
 * 真机 bisect 证据（用户实测）：
 *   - 只 import highlight-page 不调函数      → 秒开（静态 import 148 模块无罪）
 *   - 调 initializeHighlightPage（3 次轻 COM）→ 卡 10 秒
 *   - 原版（3 轻 COM + 一次大 Range 读）      → 卡 70 秒
 *   - panel.html                              → 秒开（首帧后 COM 更晚更少）
 *
 * 结论：**卡多久取决于「首次 COM 落在窗口内多久」，而不是代码本身**。靠固定
 * `setTimeout(0)` 挪不动窗口（离 load 只有几毫秒，宿主还在等 attach），所以本模块
 * 用三层组合拳而不是猜时间：
 *
 *   1. **首屏零 COM**：闸门开启前，任何 COM 任务只排队不执行 → 骨架先渲染出来，
 *      用户看到的是「加载中」而不是「卡死」；
 *   2. **分片执行**：初始化拆成若干小片，片间让出主线程；单片超时即记 stall；
 *   3. **自适应延迟 + 降级按钮**：把观测到的 stall 时长记进 PluginStorage，下次开
 *      该页时闸门延迟 = 上次 stall + 余量（上限 15s）；
 *   4. **重分片（heavy）按需**：光靠延迟**绕不开窗口** —— 真机实测（2026-10-21）
 *      闸门 800ms 开启后，轻分片 1057ms 全跑完，但自动跑「读取工作表」仍卡 69735ms，
 *      而降级后用户点击继续只花 642ms。即：窗口不是几秒级的，自动跑重 COM 必然撞。
 *      所以分片可标 `heavy: true`：轻分片照常自动跑，**重分片默认挂起**，首屏直接
 *      给「点此加载数据」按钮；只有当该页上次实测重活耗时 <= 1500ms 且从未 stall 过，
 *      才恢复自动。同步 COM 一旦阻塞 JS 自己无法中断，用户点击时宿主主线程必然空闲
 *      （点击是宿主派发的输入事件），因此点击路径不会互锁。
 *
 * 依赖说明：本模块是**底层**（被各页 bootstrap 使用），不得反向 import
 * tools/util/index（bgmLog/getApp 都在那，会构成运行时循环，被 check:cycles 拦截）
 * —— 日志走 tools/logger，宿主直接读 `window.Application`。
 */

import { logger } from './logger.js'

/** 初始化分片：初始化流程被拆成的最小可执行单元 */
export interface ComPhase {
  /** 分片名（日志 / 降级提示里显示） */
  name: string
  /** 分片本体（内部允许含同步 COM） */
  run: () => void
  /**
   * 是否重分片（含大 Range 读 / getDataSheet 这类会撞宿主初始化窗口的 COM）
   *
   * 标了 true 的分片段**默认挂起**，等用户点「加载数据」再跑；
   * 只有该页上次实测整段 <= 1500ms 且从未 stall 过才自动跑。
   */
  heavy?: boolean
}

/** 挂起/降级提示条的两种成因 */
export type ComPendingMode =
  /** 自动跑重分片时撞上窗口（已付出 stall 代价） */
  | 'degraded'
  /** 还没跑就先挂起（依据历史 stall 主动避让） */
  | 'awaiting'

/** 降级事件携带的信息 */
export interface ComDegradedDetail {
  pageKey: string
  /** 触发降级的分片名与实测耗时 */
  reason: string
  /** 用户点击「继续」时调用：接着跑剩余分片（此时宿主必然空闲） */
  resume: () => void
  /** 成因：degraded=跑崩了 / awaiting=主动避让（默认 degraded） */
  mode?: ComPendingMode
}

/** 闸门前排队任务 */
interface ComTask {
  name: string
  run: () => void
}

/** 闸门默认延迟：首帧后再给宿主 800ms 收尾（首次冷启动尚无观测数据） */
const GATE_DELAY_DEFAULT_MS = 800

/**
 * 闸门延迟上限 3s
 *
 * 延迟的作用只是「等宿主 attach 完」：真机实测 800ms 闸门下轻分片 1057ms 就全跑完、
 * 按钮已可用，说明轻活根本不需要十几秒。真正撞窗口的是重活，而已改由 `heavy` 按需
 * 承担，所以这里刻意不追着 stall 抬到 15s —— 否则轻分片（按钮启用）也要陪着等，
 * 那是纯 UX 倒退。
 */
const GATE_DELAY_MAX_MS = 3000

/** 单片预算：超过即认定踩进初始化窗口，停止后续自动分片并降级 */
const STALL_BUDGET_MS = 800

/** 自适应延迟的余量：在观测到的 stall 之上再加一点 */
const STALL_MARGIN_MS = 200

/** stall 观测值存储前缀（完整键：`bgm_com_stall_<pageKey>`） */
const STALL_KEY_PREFIX = 'bgm_com_stall_'

/** 重分片实测耗时存储前缀（完整键：`bgm_com_heavy_<pageKey>`） */
const HEAVY_KEY_PREFIX = 'bgm_com_heavy_'

/**
 * 重分片自动跑的门槛：上次整段实测耗时 <= 1500ms 才认为「这页的重活是安全的」
 *
 * 真机参照：高亮页撞窗口时 69735ms，用户点击时 642ms —— 差两个数量级，
 * 1500ms 足够把两种情形分开，且不会误伤正常页面（正常重活都在几十毫秒）。
 */
const HEAVY_AUTO_BUDGET_MS = 1500

/** 降级事件名（各页 bootstrap 用 installComInitFallback 监听） */
export const COM_DEGRADED_EVENT = 'bgm:comInitDegraded'

/** 闸门是否已开启 */
let isGateOpen = false

/** 闸门是否已启动（防重复装配） */
let isGateStarted = false

/** 闸门开启前排队的任务 */
const pendingTasks: ComTask[] = []

/** 闸门需要访问的宿主最小面 */
interface ComHost {
  PluginStorage?: {
    getItem?: (key: string) => string | null
    setItem?: (key: string, value: string) => void
  }
}

/** 读宿主（等价于 getApp() 的取值路径，但不依赖 util/index 以避免循环依赖） */
function readHost(): ComHost | null {
  if (typeof window === 'undefined') return null
  const app = (window as unknown as { Application?: ComHost }).Application
  return app && typeof app === 'object' ? app : null
}

/** @returns 闸门是否已开启（供断言 / 调试用） */
export function isComGateOpen(): boolean {
  return isGateOpen
}

/**
 * 读某页上一次观测到的 stall 时长（毫秒）；无记录 / 脏值一律 0
 */
export function readLastStallMs(pageKey: string): number {
  const raw = readHost()?.PluginStorage?.getItem?.(STALL_KEY_PREFIX + pageKey)
  if (!raw) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** 记一次 stall：只在比历史值更大时写（避免把延迟越调越小） */
function recordStall(pageKey: string, costMs: number): void {
  if (costMs <= readLastStallMs(pageKey)) return
  try {
    readHost()?.PluginStorage?.setItem?.(STALL_KEY_PREFIX + pageKey, String(costMs))
  } catch {
    // 写不进去不影响本次降级（内存里已有本次观测，页面内重试点得动）
  }
}

/**
 * 读某页上一次重分片段的实测总耗时（毫秒）；无记录 / 脏值一律 0
 *
 * 用于决定「这页的重活能不能自动跑」：0 = 从未成功跑过，不冒险自动跑。
 */
export function readHeavyCostMs(pageKey: string): number {
  const raw = readHost()?.PluginStorage?.getItem?.(HEAVY_KEY_PREFIX + pageKey)
  if (!raw) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** 记一次重分片实测耗时（至少记 1ms：0 会被 readHeavyCostMs 当成「没跑过」） */
function recordHeavyCost(pageKey: string, costMs: number): void {
  try {
    readHost()?.PluginStorage?.setItem?.(HEAVY_KEY_PREFIX + pageKey, String(Math.max(1, costMs)))
  } catch {
    // 写不进去只是失去「下次自动跑」的能力，不影响本次功能
  }
}

/** 清掉 stall 记录：重活实测已经够快，说明窗口已过，恢复自动 */
function clearStall(pageKey: string): void {
  try {
    readHost()?.PluginStorage?.setItem?.(STALL_KEY_PREFIX + pageKey, '0')
  } catch {
    // 同上：清不掉最坏结果是下次仍走「点此加载」，不报错
  }
}

/**
 * 本页重分片能否自动跑
 *
 * 规则：从未 stall 过 **且** 上次实测耗时在预算内。两个条件缺一不可 ——
 * 没跑过就自动跑等于拿用户赌 70 秒，stall 过则说明这页确实会撞窗口。
 */
export function isHeavyAutoAllowed(pageKey: string): boolean {
  if (readLastStallMs(pageKey) > 0) return false
  const cost = readHeavyCostMs(pageKey)
  return cost > 0 && cost <= HEAVY_AUTO_BUDGET_MS
}

/**
 * 本次闸门延迟：上次观测到的 stall + 余量，上限 3s
 * （第一次冷启动没有观测值 → 走默认 800ms）
 */
export function resolveGateDelayMs(pageKey: string): number {
  const adaptive = readLastStallMs(pageKey) + STALL_MARGIN_MS
  const raw = Math.max(GATE_DELAY_DEFAULT_MS, adaptive)
  return Math.min(raw, GATE_DELAY_MAX_MS)
}

/** 连续两帧后再回调（确保第一帧真的画出来了）；无 rAF 环境直接回调 */
function afterTwoFrames(callback: () => void): void {
  if (typeof requestAnimationFrame !== 'function') {
    callback()
    return
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(callback)
  })
}

/** 排空游标：避免用 Array#shift() 做队首删除（unicorn/no-array-front-mutation） */
let drainCursor = 0

/** 是否正在排空（防重复调度两条消费链） */
let isDraining = false

/** 排空队列：每个任务独占一个宏任务，避免一整串 COM 挤在一次调度里 */
function drainPending(): void {
  if (isDraining) return
  isDraining = true

  const next = (): void => {
    const task = pendingTasks[drainCursor]
    drainCursor += 1
    if (!task) {
      isDraining = false
      drainCursor = 0
      pendingTasks.length = 0
      return
    }
    try {
      task.run()
    } catch (error: unknown) {
      logger.warn(
        `[comReady] 任务「${task.name}」执行失败: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    window.setTimeout(next, 0)
  }
  window.setTimeout(next, 0)
}

/**
 * 开启闸门：load（或已 complete）→ 连续两帧 → 自适应延迟 → 开闸排空队列
 *
 * 幂等：同一页面重复调用只生效一次。本函数自身**不发任何 COM**（只注册事件），
 * 可以放心在模块顶层调用。
 */
export function openComGate(pageKey: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (isGateStarted) return
  isGateStarted = true

  const delayMs = resolveGateDelayMs(pageKey)
  const open = (): void => {
    isGateOpen = true
    logger.info(
      `[comReady] ${pageKey} 闸门已开（延迟 ${String(delayMs)}ms，历史 stall ${String(readLastStallMs(pageKey))}ms）`,
    )
    drainPending()
  }

  const scheduleOpen = (): void => {
    afterTwoFrames(() => {
      window.setTimeout(open, delayMs)
    })
  }

  if (document.readyState === 'complete') {
    scheduleOpen()
    return
  }
  window.addEventListener('load', scheduleOpen, { once: true })
}

/**
 * 排一个 COM 任务：闸门未开则排队，开了就放进下一个宏任务执行
 *
 * 所有会碰 COM（含 PluginStorage 读配置）的初始化都必须走这里，**禁止在模块顶层
 * 或 load 回调里直接同步发 COM**（scripts/check-boot-com.mjs 守这条）。
 */
export function scheduleComTask(name: string, run: () => void): void {
  if (!isGateOpen) {
    pendingTasks.push({ name, run })
    return
  }
  pendingTasks.push({ name, run })
  if (pendingTasks.length === 1) drainPending()
}

/** 派发降级 / 挂起事件（供页面渲染「点此继续」按钮） */
function dispatchDegraded(
  pageKey: string,
  reason: string,
  resume: () => void,
  mode: ComPendingMode = 'degraded',
): void {
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return
  const detail: ComDegradedDetail = { pageKey, reason, resume, mode }
  document.dispatchEvent(new CustomEvent(COM_DEGRADED_EVENT, { detail }))
}

/**
 * 跑 [startIndex, endIndex) 这一段分片：一片一个宏任务，单片超预算即停止并降级
 *
 * @param onRangeDone 整段跑完后回调（用于接着处理重分片段）
 */
function runPhaseRange(
  pageKey: string,
  phases: ComPhase[],
  startIndex: number,
  endIndex: number,
  budgetMs: number,
  onRangeDone?: () => void,
): void {
  if (startIndex >= endIndex) {
    onRangeDone?.()
    return
  }
  const phase = phases[startIndex]
  if (!phase) {
    onRangeDone?.()
    return
  }

  const startAt = Date.now()
  try {
    phase.run()
  } catch (error: unknown) {
    logger.warn(
      `[comReady] ${pageKey} 分片「${phase.name}」抛出异常: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const costMs = Date.now() - startAt
  const nextIndex = startIndex + 1

  // 踩进宿主初始化窗口：记下这次的代价（下次绕开），剩下的交给用户点击
  if (costMs > budgetMs) {
    recordStall(pageKey, costMs)
    const reason = `分片「${phase.name}」耗时 ${String(costMs)}ms，疑似撞上宿主初始化窗口`
    logger.warn(`[comReady] ${pageKey} ${reason} —— 停止自动初始化，等待用户点击继续`)
    dispatchDegraded(pageKey, reason, () => {
      window.setTimeout(() => {
        runPhaseRange(pageKey, phases, nextIndex, endIndex, budgetMs, onRangeDone)
      }, 0)
    })
    return
  }

  if (nextIndex >= endIndex) {
    onRangeDone?.()
    return
  }
  window.setTimeout(() => {
    runPhaseRange(pageKey, phases, nextIndex, endIndex, budgetMs, onRangeDone)
  }, 0)
}

/** 重分片段的运行态（跨片复用，只描述「跑哪些片、预算多少」） */
interface HeavyRun {
  pageKey: string
  phases: ComPhase[]
  budgetMs: number
}

/** 重分片段跑完：记耗时；够快就清掉 stall 记录，下次恢复自动 */
function finishHeavyRun(run: HeavyRun, startAt: number): void {
  const totalMs = Date.now() - startAt
  logger.info(`[comReady] ${run.pageKey} 重分片段完成，实测 ${String(totalMs)}ms`)
  if (totalMs <= HEAVY_AUTO_BUDGET_MS) clearStall(run.pageKey)
  recordHeavyCost(run.pageKey, totalMs)
}

/**
 * 跑重分片段：一片一个宏任务，单片超预算即停止并降级
 *
 * @param startAt 本段计时起点（resume 时传入新的 Date.now()，避免把等用户的时间算进去）
 */
function runHeavyRun(run: HeavyRun, fromIndex: number, startAt: number): void {
  if (fromIndex >= run.phases.length) {
    finishHeavyRun(run, startAt)
    return
  }
  const phase = run.phases[fromIndex]
  if (!phase) {
    finishHeavyRun(run, startAt)
    return
  }

  const phaseStartAt = Date.now()
  try {
    phase.run()
  } catch (error: unknown) {
    logger.warn(
      `[comReady] ${run.pageKey} 重分片「${phase.name}」抛出异常: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const costMs = Date.now() - phaseStartAt
  const nextIndex = fromIndex + 1

  if (costMs > run.budgetMs) {
    recordStall(run.pageKey, costMs)
    const reason = `重分片「${phase.name}」耗时 ${String(costMs)}ms，疑似撞上宿主初始化窗口`
    logger.warn(`[comReady] ${run.pageKey} ${reason} —— 停止自动初始化，等待用户点击继续`)
    dispatchDegraded(run.pageKey, reason, () => {
      window.setTimeout(() => {
        runHeavyRun(run, nextIndex, Date.now())
      }, 0)
    })
    return
  }

  if (nextIndex >= run.phases.length) {
    finishHeavyRun(run, startAt)
    return
  }
  window.setTimeout(() => {
    runHeavyRun(run, nextIndex, startAt)
  }, 0)
}

/**
 * 分片执行初始化：闸门开启后一片一片跑，片间让出主线程
 *
 * 分片数组按依赖顺序排列，第一个 `heavy: true` 及其之后的分片构成**重段**：
 *   - 轻段（含轮询启动）照常自动跑，保证按钮尽早可用；
 *   - 重段默认**挂起**并弹「点此加载数据」，只有本页实测够快才自动跑。
 *
 * @param pageKey 页面标识（用于读写 stall / 重活耗时观测值）
 * @param phases 初始化分片，按依赖顺序排列（越重的放越后面）
 * @param budgetMs 单片预算，默认 800ms；超过即降级为「点击继续」
 */
export function runComPhases(
  pageKey: string,
  phases: ComPhase[],
  budgetMs: number = STALL_BUDGET_MS,
): void {
  if (phases.length === 0) return

  const heavyStart = phases.findIndex((phase) => phase.heavy === true)
  const lightEnd = heavyStart === -1 ? phases.length : heavyStart

  scheduleComTask(`${pageKey}:startup`, () => {
    runPhaseRange(pageKey, phases, 0, lightEnd, budgetMs, () => {
      if (lightEnd >= phases.length) return
      const run: HeavyRun = { pageKey, phases, budgetMs }
      if (isHeavyAutoAllowed(pageKey)) {
        runHeavyRun(run, lightEnd, Date.now())
        return
      }
      const lastCost = readHeavyCostMs(pageKey)
      const reason =
        lastCost > 0
          ? `本页上次读取耗时 ${String(lastCost)}ms，为避开宿主初始化窗口先挂起`
          : '本页尚未实测过读取耗时，为避开宿主初始化窗口先挂起'
      logger.info(`[comReady] ${pageKey} 重分片挂起，等待用户点击（${reason}）`)
      dispatchDegraded(
        pageKey,
        reason,
        () => {
          window.setTimeout(() => {
            runHeavyRun(run, lightEnd, Date.now())
          }, 0)
        },
        'awaiting',
      )
    })
  })
}

/**
 * 安装挂起/降级兜底 UI：收到本页事件时插入提示条 + 「点此加载」按钮
 *
 * 为什么必须留这条兜底：同步 COM 一旦阻塞，JS 线程自己无法中断或超时，
 * 只能**事先不跑**。而用户点击时宿主主线程必然空闲（点击是宿主派发的输入事件），
 * 因此点击路径不会互锁 —— 真机实测：自动跑 69735ms，点击跑 642ms。
 *
 * @param pageKey 页面标识（只响应本页的降级事件）
 */
export function installComStartupFallback(pageKey: string): void {
  if (typeof document === 'undefined') return

  document.addEventListener(COM_DEGRADED_EVENT, (event: Event) => {
    // 事件.detail 的类型是声明式的：运行期可能被无 detail 的事件触发（比如手工派发）
    const { detail } = event as CustomEvent<ComDegradedDetail | undefined>
    if (detail?.pageKey !== pageKey) return
    if (document.getElementById('bgm-com-fallback')) return

    // awaiting = 主动避让（还没跑，用户零等待）；degraded = 已经撞了（说明原因）
    const isAwaiting = detail.mode === 'awaiting'

    const banner = document.createElement('div')
    banner.id = 'bgm-com-fallback'
    banner.setAttribute('role', 'status')
    banner.style.cssText =
      'position:sticky;top:0;z-index:9999;padding:8px 10px;margin:0 0 8px;' +
      'background:#fff4e5;border:1px solid #ffb35c;border-radius:6px;' +
      'font-size:12px;line-height:1.5;display:flex;gap:8px;align-items:center;flex-wrap:wrap'

    const text = document.createElement('span')
    text.textContent = isAwaiting
      ? '数据尚未读取（等宿主空闲后再读，避免卡住界面）。'
      : `初始化撞上宿主忙（${detail.reason}）。`

    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = isAwaiting ? '点此加载数据' : '点此继续初始化'
    button.style.cssText =
      'flex:0 0 auto;padding:4px 10px;border:1px solid #d98c2b;border-radius:4px;' +
      'background:#ffb35c;color:#3a2200;cursor:pointer;font-size:12px'
    button.addEventListener('click', () => {
      banner.remove()
      detail.resume()
    })

    banner.append(text, button)
    document.body.prepend(banner)
    logger.info(
      `[comReady] ${pageKey} 已显示「${isAwaiting ? '点此加载数据' : '点此继续初始化'}」兜底按钮`,
    )
  })
}

/** 仅测试用：复位闸门状态，让 openComGate / scheduleComTask 可以重复装配 */
export function resetComGateForTest(): void {
  isGateOpen = false
  isGateStarted = false
  isDraining = false
  drainCursor = 0
  pendingTasks.length = 0
}
