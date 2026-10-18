/**
 * WPS StatusBar 节流写入器。
 *
 * @module tools/util/status-bar
 * @description
 * 同步 / 数据同步流程在**每一行**的进度回调里写一次 `app.StatusBar`。
 * StatusBar 是宿主对象属性，每次赋值都是一次跨进程往返（与单元格写入同级）：
 * 1000 行 ≈ 1000 次往返 ≈ 1–3 秒纯开销，且用户根本看不清 1000 次刷新。
 *
 * 本模块把写入按时间窗节流（默认 200 ms）：窗口内只记录最新文本，窗口到期后的
 * 下一次 `write()` 落盘；流程结束需要展示最终值时调用 `flush()`。
 *
 * 零依赖叶子模块（不 import 任何东西）：三处调用方（ui/handlers/sync.ts、
 * ui/handlers/action-handlers.ts、services/ribbon-service.ts）都直连本文件，
 * 不经 util barrel——barrel 在测试里被整体 mock 时不会缺项。
 */

/** StatusBar 宿主的最小形状（WpsApp 结构兼容） */
export interface StatusBarHost {
  StatusBar?: string | boolean | undefined
}

/** 节流写入器 */
export interface StatusBarWriter {
  /** 记录一次进度文本；窗口外立即写、窗口内只留最新值 */
  write(text: string): void
  /** 立即写出尚未落盘的最新值（流程收尾、需要展示最终状态时调用） */
  flush(): void
}

/** 默认节流窗口（毫秒）：人眼对状态栏刷新的可感知粒度约 200 ms */
export const STATUS_BAR_THROTTLE_MS = 200

/**
 * 创建 StatusBar 节流写入器。
 * @param app 宿主对象；`null` / `undefined` 或 `StatusBar === undefined`（宿主不支持）时全部为无操作
 * @param intervalMs 节流窗口（毫秒），默认 {@link STATUS_BAR_THROTTLE_MS}
 * @param now 时钟（测试注入；默认 `Date.now`）
 */
export function createStatusBarWriter(
  app: StatusBarHost | null | undefined,
  intervalMs: number = STATUS_BAR_THROTTLE_MS,
  now: () => number = Date.now,
): StatusBarWriter {
  // 参数只在闭包里读取：写入统一走 commit（避免 no-param-reassign，也便于收窄空值）
  const host = app
  const isSupported = (): boolean => host?.StatusBar !== undefined
  // 初值 -Infinity：保证「第一次写入」无论时钟起点在哪都立即落盘
  let lastWriteAt = -Infinity
  let pending: string | null = null

  const commit = (text: string): void => {
    if (!host) return
    if (host.StatusBar === undefined) return
    host.StatusBar = text
  }

  return {
    write(text: string): void {
      if (!isSupported()) return
      const timestamp = now()
      if (timestamp - lastWriteAt >= intervalMs) {
        commit(text)
        lastWriteAt = timestamp
        pending = null
        return
      }
      pending = text
    },
    flush(): void {
      if (pending === null) return
      const text = pending
      pending = null
      if (!isSupported()) return
      commit(text)
      lastWriteAt = now()
    },
  }
}
