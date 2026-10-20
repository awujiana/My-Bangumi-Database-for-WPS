/**
 * 工具模块 - 统一导出入口
 * @module tools/util
 * @description 原 utility.ts 已按职责拆分到 util/ 子目录，此文件作为聚合入口，
 *              保留 BGM 全局命名空间、bgmLog、getApp、Token 存储、用户信息、辅助函数等核心内容，
 *              并 re-export 子模块以保持外部 import 路径不变。
 *
 * 拆分结构：
 *   - util/cell.ts：单元格读取/设置（getCell、getCellValue、setCellValue、getSheetByIndex）
 *   - util/sheet.ts：工作表读取/缓存（readRangeValues、cacheGet、findHeaderRow、getColumnMap、clearSheetCache、getLastRow、isEmptyValue、getDataSheet、safeActivate）
 *   - util/field-getter.ts：批量字段访问器（矩形读 + 逐格回退）与同步行指纹
 *   - util/sleep.ts：延时（sleep、delay）
 *   - util/index.ts：BGM 命名空间、bgmLog、getApp、Token 存储、用户 ID/用户名、辅助函数（shellExecuteByOAAssist、getUrlPath、showBangumiPanel）
 */
// 直接从源模块导入，打破 utility.ts ↔ index.ts 的循环依赖
import { LOG_LEVELS, ERROR_LEVELS, ErrorLevel, WPS_ENUM } from '../../core/constants.js'
import type { ErrorOptions } from '../../core/constants.js'
import { BgmError } from '../../core/result.js'
import type { BGMCache, BGMSheet, BGMSync, BGMUserInfo } from '../../core/types.js'
import { fetchBgmMe as fetchBgmMeImpl } from './bgm-me.js'
// 对话框与全量同步执行体走依赖反转桥：本模块属于底层（tools/），不得 runtime-import
// 上层 UI 层（见 文档/TS_AUDIT_2026_09_10.md 的 P1-5）。实现分别由 ui/dialog.ts、
// ui/preview.ts 在模块求值时注册；未注册则走桥的降级实现（记日志 + 忽略）。
import { getNotifyApi, getSyncRunner } from '../../core/ui-bridge.js'
// DialogOptions 是纯类型，`import type` 编译后不产生运行时依赖，不构成反向依赖边
import type { DialogOptions } from '../../ui/dialog.js'

// 类型只从 index.js 导入（type-only import 不会产生运行时循环依赖）
import { BGM_EVENTS, eventBus } from '../events.js'
// 字符串工具已拆分到 string-utilities.ts，此处 import 供内部调用，并 re-export 保持向后兼容
import { logger } from '../logger.js'
import { colNumberToLetter } from '../string-utilities.js'
// 日志模块：bgmLog 内部通过 logger 输出，自动脱敏敏感信息，且不污染全局 console
import { isWpsApp } from '../wps.js'
import type { WpsApp, WpsWorksheet } from '../wps.js'

// re-export 字符串工具保持向后兼容

// re-export 子模块
export { getCell, getCellValue, setCellValue, getSheetByIndex } from './cell.js'
export {
  readRowsCache,
  createSheetCellCache,
  type SheetCellCache,
  readRangeValues,
  readRangeCellValues,
  cacheGet,
  findHeaderRow,
  getColumnMap,
  clearSheetCache,
  getLastRow,
  isEmptyValue,
  getDataSheet,
  safeActivate,
  ensureSheetHeaders,
} from './sheet.js'
export { fetchBgmMe } from './bgm-me.js'
// 批量字段访问器（矩形读 + 逐格回退）与同步行指纹：exceltobangumi / ribbon-service 共用
export { createBatchFieldGetter, calcSyncRowFingerprint, type FieldGetter } from './field-getter.js'
export { sleep, delay } from './sleep.js'

// ========== BGM 全局窗口扩展接口 ==========
interface BgmWindowGlobals {
  Application?: unknown
  BGMDialog?: {
    alert(title: string, message: string): void
    error(title: string, message: string): void
    input(
      title: string,
      prompt: string,
      defaultValue: string,
      onOk?: (value: string) => void,
      onCancel?: () => void,
    ): void
    show(
      type: 'alert' | 'confirm' | 'error' | 'input',
      title: string,
      message: string,
      options?: DialogOptions,
    ): void
  }
  BGMAlert?(message: string, title: string, callback?: () => void): void
  BGMError?(message: string, title: string): void
  BGMInput?(
    title: string,
    prompt: string,
    defaultValue: string,
    onOk?: (value: string) => void,
    onCancel?: () => void,
  ): void
}

// ========== BGM 全局命名空间 ==========
export const BGM: {
  cache: BGMCache
  sheet: BGMSheet
  sync: BGMSync
  LOG_LEVEL: number
  LOG_LEVELS: typeof LOG_LEVELS
  ERROR_LEVELS: typeof ERROR_LEVELS
  ErrorLevel: typeof ErrorLevel
  BgmError: typeof BgmError
  dataPreview?: {
    worksheet: WpsWorksheet | null | undefined
    visibleRows: number[]
    headerRow: number
    dataStartRow: number
    previewColStart: number
    previewColEnd: number
    columnCount: number
    headerNames: string[]
    isImportant: boolean[]
  }
  Dialog: {
    alert: (title: string, message: string) => void
    confirm: (message: string, callback: (isConfirmed: boolean) => void, title?: string) => void
    error: (title: string, message: string) => void
    input: (
      title: string,
      prompt: string,
      defaultValue?: string,
      onOk?: (value: string) => void,
      onCancel?: () => void,
    ) => void
    show: (
      type: 'alert' | 'confirm' | 'error' | 'input',
      title: string,
      message: string,
      options?: DialogOptions,
    ) => void
  }

  showAlert: (title: string, message: string) => void
  handleError: (error: unknown, options?: ErrorOptions) => BgmError
  safeExecute: <T>(function_: () => T, context?: string, options?: ErrorOptions) => T | BgmError

  setUserId: (id: string | null) => void
  setUsername: (name: string | null) => void
  notifyTokenUpdated: () => void
  setSyncProgress: (current: number, total: number, message: string) => void
  setSyncComplete: (results?: { success: number; fail: number; skip: number }) => void
  setSyncError: (error: unknown) => void

  /** 全局 AbortController，用于取消所有关联的 HTTP 请求 */
  abortController: AbortController
  /** 重置 AbortController（创建新实例，用于重新发起请求） */
  resetAbortController: () => void
} = {
  // 缓存数据
  cache: {
    totalRows: 0,
    userId: null,
    username: null,
    avatarUrl: null,
    sidCache: new Map(),
    listCache: [],
  },
  // 工作表状态
  sheet: {
    lockedIndex: null,
    lockedName: null,
    isLocked: false,
    lockedWorkbookName: null,
  },
  // 同步状态
  sync: {
    isRunning: false,
    shouldStop: false,
    isPaused: false,
    lastSyncTime: null,
    currentRow: 0,
    currentSheet: null as WpsWorksheet | null,
    currentCol: 0,

    /** 进入运行状态：防重复 + 重置标志 + 置位 */
    enterRunningState(): boolean {
      if (this.isRunning) {
        BGM.Dialog.alert('同步正在进行中，请稍后', '提示')
        return false
      }
      this.resetStopFlag()
      this.isRunning = true
      this.lastSyncTime = new Date().toISOString()
      eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'running' })
      return true
    },

    /** 退出运行状态：清运行标志 + 重置停止标志 */
    exitRunningState(): void {
      this.isRunning = false
      this.resetStopFlag()
      eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'idle' })
    },

    startSync(): void {
      if (this.isRunning) {
        BGM.Dialog.alert('同步正在进行中，请稍后', '提示')
        return
      }
      this.resetStopFlag()
      BGM.Dialog.confirm('确定要开始上传同步吗？', (isConfirmed: boolean) => {
        if (!isConfirmed) return
        // 复用统一入口，确保状态一致
        if (!this.enterRunningState()) return
        bgmLog(LOG_LEVELS.INFO, '开始执行同步...')
        void (async () => {
          try {
            const syncRunner = getSyncRunner()
            if (syncRunner === null) {
              BGM.Dialog.alert('同步功能当前不可用（界面未就绪）', '提示')
              this.exitRunningState()
              return
            }
            await syncRunner()
            // 成功路径也清理状态，与 catch 分支对称
            if (this.shouldStop) {
              BGM.Dialog.alert('同步已停止', '提示')
            }
            this.exitRunningState()
          } catch (error: unknown) {
            this.exitRunningState()
            BGM.handleError(error, { showAlert: true })
          }
        })()
      })
    },

    requestStop(): void {
      // 静默返回，不弹 alert
      if (!this.isRunning) return
      this.shouldStop = true
      this.isPaused = false
      bgmLog(LOG_LEVELS.INFO, '用户请求停止同步')
      eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'stopped' })
    },

    pause(): void {
      // 增加 shouldStop 检查：已请求停止时不再允许暂停
      if (!this.isRunning || this.isPaused || this.shouldStop) return
      this.isPaused = true
      bgmLog(LOG_LEVELS.INFO, `[sync] 同步已暂停，当前行: ${String(this.currentRow)}`)
      eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'paused', row: this.currentRow })
      // 定位到当前单元格
      const isLocated = this.locateCurrentCell()
      if (!isLocated) {
        getNotifyApi().toast('已暂停，但无法定位到当前单元格', 'warn')
      }
    },

    resume(): void {
      if (!this.isPaused) return
      this.isPaused = false
      bgmLog(LOG_LEVELS.INFO, '[sync] 同步已恢复')
      eventBus.emit(BGM_EVENTS.SYNC_STATE_CHANGED, { state: 'resumed' })
    },

    checkShouldStop(): boolean {
      return this.shouldStop
    },

    checkPaused(): boolean {
      return this.isPaused
    },

    /** 暂停时等待恢复，每 50ms 轮询一次 */
    async waitForResume(): Promise<void> {
      while (this.isPaused && !this.shouldStop) {
        await new Promise((resolve) => {
          setTimeout(resolve, 50)
        })
      }
    },

    /** 定位到当前正在处理的单元格 */
    locateCurrentCell(): boolean {
      if (!this.currentRow || this.currentRow < 1 || !this.currentSheet) return false
      try {
        const worksheet = this.currentSheet
        const col = this.currentCol > 0 ? this.currentCol : 1
        const cellAddr = `${colNumberToLetter(col)}${String(this.currentRow)}`
        const cell = worksheet.Range(cellAddr)
        cell.Select()
        bgmLog(LOG_LEVELS.INFO, `[sync] 已定位到单元格: ${cellAddr}`)
        return true
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        bgmLog(LOG_LEVELS.WARN, `[sync] 定位单元格失败: ${message}`)
        getNotifyApi().toast(`定位单元格失败: ${message}`, 'error')
        return false
      }
    },

    /** 更新当前位置（供同步循环调用，传 undefined 保留原值） */
    updatePosition(worksheet: WpsWorksheet | null | undefined, row: number, col?: number): void {
      // 行号范围校验：必须为非负整数
      if (!Number.isSafeInteger(row) || row < 0) return
      if (worksheet !== undefined) this.currentSheet = worksheet
      this.currentRow = row
      if (col !== undefined && col > 0) this.currentCol = col
    },

    resetStopFlag(): void {
      this.shouldStop = false
      this.isPaused = false
      this.currentRow = 0
      this.currentSheet = null
      // 同步清理列号，避免遗留状态
      this.currentCol = 0
    },
  },
  // 日志级别（0=DEBUG, 1=INFO, 2=WARN, 3=ERROR）
  LOG_LEVEL: LOG_LEVELS.INFO,

  // 日志级别常量
  LOG_LEVELS,

  // 错误级别常量
  ERROR_LEVELS,

  // 错误级别枚举
  ErrorLevel,

  // BGM 错误类
  BgmError,

  // 统一对话框
  Dialog: {
    alert(title: string, message: string): void {
      if (typeof window !== 'undefined') {
        const win = window as unknown as BgmWindowGlobals
        if (win.BGMDialog !== undefined) {
          win.BGMDialog.alert(title, message)
          return
        }
        if (typeof win.BGMAlert === 'function') {
          win.BGMAlert(message, title)
          return
        }
      }
      // 使用自定义对话框
      getNotifyApi().alert(message, title)
    },
    confirm(message: string, callback: (isConfirmed: boolean) => void, title?: string): void {
      getNotifyApi().confirm(message, callback, title)
    },
    error(title: string, message: string): void {
      if (typeof window !== 'undefined') {
        const win = window as unknown as BgmWindowGlobals
        if (win.BGMDialog !== undefined) {
          win.BGMDialog.error(title, message)
          return
        }
        if (typeof win.BGMError === 'function') {
          // BGMError 是宿主注入的展示函数，非构造函数，勿用 new

          win.BGMError(message, title)
          return
        }
      }
      // 使用自定义对话框
      getNotifyApi().error(message, title)
    },
    input(
      title: string,
      prompt: string,
      defaultValue?: string,
      onOk?: (value: string) => void,
      onCancel?: () => void,
    ): void {
      if (typeof window !== 'undefined') {
        const win = window as unknown as BgmWindowGlobals
        if (win.BGMDialog !== undefined) {
          win.BGMDialog.input(title, prompt, defaultValue ?? '', onOk, onCancel)
          return
        }
        if (typeof win.BGMInput === 'function') {
          win.BGMInput(title, prompt, defaultValue ?? '', onOk, onCancel)
          return
        }
      }
      // 使用自定义对话框
      getNotifyApi().input(
        title,
        prompt,
        defaultValue,
        (value) => {
          if (onOk && value !== undefined) onOk(value)
        },
        onCancel,
      )
    },
    show(
      type: 'alert' | 'confirm' | 'error' | 'input',
      title: string,
      message: string,
      options?: DialogOptions,
    ): void {
      if (typeof window !== 'undefined') {
        const win = window as unknown as BgmWindowGlobals
        if (win.BGMDialog !== undefined) {
          win.BGMDialog.show(type, title, message, options)
          return
        }
      }
      switch (type) {
        case 'error': {
          this.error(title, message)
          break
        }
        case 'confirm': {
          this.confirm(
            message,
            (confirmed) => {
              if (confirmed) options?.onOk?.()
              else options?.onCancel?.()
            },
            title,
          )
          break
        }
        case 'input': {
          this.input(title, message, options?.defaultValue, options?.onOk, options?.onCancel)
          break
        }
        default: {
          this.alert(title, message)
        }
      }
    },
  },

  showAlert(title: string, message: string): void {
    BGM.Dialog.alert(title, message)
  },

  // 统一错误处理
  handleError(error: unknown, options?: ErrorOptions): BgmError {
    const options_: ErrorOptions = {
      level: ErrorLevel.ERROR,
      showAlert: false,
      context: '',
      ...options,
    }
    // context 只在调用方显式传入时写进 details —— 不做栈推断。
    // （原实现是 `options_.context ??= getCallerFunctionName()`，但默认值 `context: ''`
    //  让 ??= 恒短路，分支从未生效；且生产 90+ 个调用点全都显式传 context，
    //  栈解析在打包后的 WPS WebView 里也不可靠，故连同 getCallerFunctionName 一并移除。）
    let bgmError: BgmError
    if (error instanceof BgmError) {
      bgmError = error
    } else if (error instanceof Error) {
      bgmError = new BgmError(error.message, {
        code: 'JS_ERROR',
        details: {
          name: error.name,
          stack: error.stack,
        },
      })
    } else {
      bgmError = new BgmError(String(error), { code: 'UNKNOWN' })
    }

    if (options_.context) {
      bgmError.details.context = options_.context
    }

    switch (options_.level) {
      case ErrorLevel.SILENT: {
        break
      }
      case ErrorLevel.WARN: {
        bgmLog(LOG_LEVELS.WARN, bgmError.toString())
        break
      }
      case ErrorLevel.ERROR: {
        bgmLog(LOG_LEVELS.ERROR, bgmError.toString())
        if (options_.showAlert) {
          BGM.showAlert('错误', bgmError.message)
        }
        break
      }
      case ErrorLevel.THROW: {
        bgmLog(LOG_LEVELS.ERROR, bgmError.toString())
        throw bgmError
      }
      default: {
        // 未匹配的 level（如 INFO=4 或非法值）：与原有 fall-through 行为一致，不输出错误日志
        break
      }
    }

    return bgmError
  },

  // 安全执行函数
  safeExecute<T>(function_: () => T, context?: string, options?: ErrorOptions): T | BgmError {
    try {
      return function_()
    } catch (error) {
      return BGM.handleError(error, { context, ...options } as ErrorOptions)
    }
  },
  setUserId(id: string | null) {
    if (id) {
      _setBgmUserId(id)
    } else {
      this.cache.userId = null
      eventBus.emit(BGM_EVENTS.USER_ID_UPDATED)
    }
  },
  setUsername(name: string | null) {
    if (name) {
      _setBgmUsername(name)
    } else {
      this.cache.username = null
      eventBus.emit(BGM_EVENTS.USER_NAME_UPDATED)
    }
  },
  notifyTokenUpdated() {
    eventBus.emit(BGM_EVENTS.TOKEN_UPDATED)
  },
  // 同步进度更新
  setSyncProgress(current: number, total: number, message: string) {
    eventBus.emit(BGM_EVENTS.SYNC_PROGRESS, { current, total, message })
  },
  // 同步完成，结果可选（成功/失败/跳过数量）
  setSyncComplete(results?: unknown) {
    eventBus.emit(BGM_EVENTS.SYNC_COMPLETED, results)
  },
  // 同步错误更新
  setSyncError(error: unknown) {
    eventBus.emit(BGM_EVENTS.SYNC_ERROR, error)
  },

  // 全局 AbortController：用于取消所有关联的 HTTP 请求
  abortController: new AbortController(),

  // 重置 AbortController：创建新实例，旧实例保持 aborted 状态
  resetAbortController(): void {
    this.abortController = new AbortController()
  },
}

// ========== 日志函数 ==========
/**
 * 日志函数（支持日志级别控制）
 *
 * `level >= BGM.LOG_LEVEL` 才记录，故 DEBUG 级别（`LOG_LEVELS.DEBUG = 0`）即「全部日志」。
 *
 * @param level - 日志级别（取 {@link LOG_LEVELS} 之一）
 * @param message - 日志消息
 */

export function bgmLog(level: number, message_ = ''): void {
  if (!(level >= BGM.LOG_LEVEL)) {
    return
  }

  // 通过 logger 输出，message 会自动经过 maskSensitiveData 脱敏
  switch (level) {
    case LOG_LEVELS.DEBUG: {
      logger.debug(message_)
      break
    }
    case LOG_LEVELS.INFO: {
      logger.info(message_)
      break
    }
    case LOG_LEVELS.WARN: {
      logger.warn(message_)
      break
    }
    case LOG_LEVELS.ERROR: {
      logger.error(message_)
      break
    }
    default: {
      logger.info(message_)
    }
  }
}
// ========== Application 获取 ==========
/**
 * 获取 Application 对象（使用类型守卫）
 */
export function getApp(): WpsApp | null {
  if (typeof window !== 'undefined') {
    const winApp = (window as unknown as BgmWindowGlobals).Application
    if (isWpsApp(winApp)) return winApp
    if (winApp && typeof winApp === 'object') return winApp
  }
  return null
}

// ========== Token 存储 ==========
/**
 * 存储 Token（明文存储）
 *
 * @description
 * 当前为明文存储，原因：
 * 1. 用户需要可直接复制使用 Token
 * 2. WPS PluginStorage 本身是宿主隔离的，非浏览器全局 localStorage
 * 3. 历史版本曾使用 XOR 加密，但已废弃（仅 loadBgToken 兼容旧数据）
 *
 * 不应引入 AES-GCM 等加密，因为：
 * - 加密 key 仍需存储在同一环境，无法真正提升安全性
 * - 用户明确指示保持明文以便复制使用
 *
 * @param token - Bangumi API Token
 * @returns 是否存储成功
 */
export function storeBgToken(token: string): boolean {
  const app = getApp() as {
    PluginStorage?: { setItem: (key: string, value: string) => void }
  } | null
  if (!app?.PluginStorage) return false
  app.PluginStorage.setItem('bgm_token', token)
  return true
}

/**
 * 清除 Token
 */
export function clearBgToken(): boolean {
  const app = getApp() as {
    PluginStorage?: { setItem: (key: string, value: string) => void }
  } | null
  if (!app?.PluginStorage) return false
  app.PluginStorage.setItem('bgm_token', '')
  return true
}

/**
 * 存储 Token 过期时间戳
 *
 * @param expires - Unix 时间戳（秒），来自 /oauth/token_status 接口
 */
export function storeTokenExpires(expires: number): void {
  const app = getApp() as {
    PluginStorage?: { setItem: (key: string, value: string) => void }
  } | null
  if (!app?.PluginStorage) return
  app.PluginStorage.setItem('bgm_token_expires', String(expires))
  bgmLog(
    LOG_LEVELS.INFO,
    `[storeTokenExpires] Token 过期时间已存储: ${new Date(expires * 1000).toLocaleString('zh-CN')}`,
  )
}

/**
 * 加载 Token 过期时间戳
 *
 * @returns Unix 时间戳（秒）或 null（未存储）
 */
export function loadTokenExpires(): number | null {
  const app = getApp() as { PluginStorage?: { getItem: (key: string) => string | null } } | null
  if (!app?.PluginStorage) return null
  const raw = app.PluginStorage.getItem('bgm_token_expires')
  if (!raw) return null
  const expires = Number(raw)
  return Number.isFinite(expires) && expires > 0 ? expires : null
}

/**
 * 清除 Token 过期时间戳
 */
export function clearTokenExpires(): void {
  const app = getApp() as {
    PluginStorage?: { setItem: (key: string, value: string) => void }
  } | null
  if (!app?.PluginStorage) return
  app.PluginStorage.setItem('bgm_token_expires', '')
}

/**
 * 计算 Token 剩余有效期信息
 *
 * @param expires - Unix 时间戳（秒）
 * @returns 剩余天数/小时数/状态描述，过期返回 expired 状态
 */
export function getTokenRemainingTime(expires: number): {
  days: number
  hours: number
  totalSeconds: number
  status: 'normal' | 'warning' | 'danger' | 'expired'
  label: string
} {
  const now = Math.floor(Date.now() / 1000)
  const diffSeconds = expires - now
  const absSeconds = Math.abs(diffSeconds)

  if (diffSeconds <= 0) {
    const days = Math.floor(absSeconds / 86_400)
    const hours = Math.floor((absSeconds % 86_400) / 3600)
    return {
      days,
      hours,
      totalSeconds: absSeconds,
      status: 'expired',
      label: `已过期 ${days > 0 ? `${String(days)}天` : `${String(hours)}小时`}`,
    }
  }

  const days = Math.floor(diffSeconds / 86_400)
  const hours = Math.floor((diffSeconds % 86_400) / 3600)

  let status: 'normal' | 'warning' | 'danger' = 'normal'
  let label = `${String(days)}天${String(hours)}小时后过期`

  if (diffSeconds < 86_400) {
    status = 'danger'
    label = `${String(hours)}小时后过期`
  } else if (diffSeconds < 86_400 * 3) {
    status = 'danger'
    label = `${String(days)}天${String(hours)}小时后过期`
  } else if (diffSeconds < 86_400 * 7) {
    status = 'warning'
    label = `${String(days)}天后过期`
  }

  return { days, hours, totalSeconds: diffSeconds, status, label }
}

/**
 * 加载 Token（明文读取）
 *
 * @returns Token 字符串或 null（未存储）
 */
export function loadBgToken(): string | null {
  const app = getApp() as {
    PluginStorage?: {
      getItem: (key: string) => string | null
    }
  } | null
  if (!app?.PluginStorage) return null
  const stored = app.PluginStorage.getItem('bgm_token')
  if (!stored) return null

  return stored
}

/**
 * execCommand 复制结果。
 *
 * `kind` 区分两种失败：`unsupported`（execCommand 返回 false，浏览器/WPS 不支持）
 * 与 `error`（抛异常，`message` 带具体原因）——Ribbon 弹窗需要据此给不同文案。
 */
export type ClipboardCopyResult =
  | { ok: true }
  | { ok: false; kind: 'unsupported'; message: string }
  | { ok: false; kind: 'error'; message: string }

/**
 * 用 execCommand 把文本写入剪贴板（WPS WebView 里 Clipboard API 不可用时的回退路径）。
 *
 * `copyTokenToClipboard` 与 `copyTokenForRibbon` 此前各写一份逐字相同的实现，
 * 收敛于此。
 *
 * @param text 待复制文本
 * @returns 复制结果（区分「不支持」与「异常」，供调用方给不同文案）
 */
export function copyTextWithResult(text: string): ClipboardCopyResult {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    // execCommand 已废弃（no-deprecated），但 WPS WebView 中 Clipboard API 不可用时可回退使用，
    // 这里以精确类型调用规避废弃标注
    const isOk = (
      document as unknown as {
        execCommand: (commandId: string, shouldShowUI?: boolean, value?: string) => boolean
      }
    ).execCommand('copy')
    document.body.removeChild(textarea)
    if (isOk) {
      bgmLog(LOG_LEVELS.INFO, '[copyTextWithResult] 已复制到剪贴板')
      return { ok: true }
    }
    bgmLog(LOG_LEVELS.WARN, '[copyTextWithResult] execCommand copy 失败')
    return { ok: false, kind: 'unsupported', message: 'execCommand copy 返回 false' }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[copyTextWithResult] 复制失败: ${message}`)
    return { ok: false, kind: 'error', message }
  }
}

/**
 * 复制 Token 到剪贴板
 * @returns 是否复制成功
 */
export function copyTokenToClipboard(): boolean {
  const token = loadBgToken()
  if (!token) return false
  return copyTextWithResult(token).ok
}

/**
 * 设置 Bangumi 用户 ID（存储到全局缓存）
 * @param id - 用户 ID 字符串，不能为空
 *
 *
 *
 *  1.验证输入的用户ID是否为空
    2.将用户ID存储到全局缓存 BGM.cache.userId 中
    3.同时使用插件存储功能将用户ID持久化保存
    4.触发用户ID更新事件通知其他模块
 */
export function _setBgmUserId(id: string): void {
  if (!id || id.trim() === '') return
  const userId = id.trim()
  BGM.cache.userId = userId
  // 持久化存储
  const app = getApp()
  if (app?.PluginStorage) {
    app.PluginStorage.setItem('bgm_user_id', userId)
  }
  eventBus.emit(BGM_EVENTS.USER_ID_UPDATED)
}

/**
 * 获取 Bangumi 用户 ID（优先从内存缓存读取，回退到 PluginStorage）
 * @returns 用户 ID 字符串；若未设置则返回 null
 */
export function _getBgmUserId(): string | null {
  if (BGM.cache.userId) return BGM.cache.userId
  // 回退到 PluginStorage（Ribbon 设置后 Panel 可从持久化存储读取）
  try {
    const app = getApp()
    if (app?.PluginStorage) {
      const stored = app.PluginStorage.getItem('bgm_user_id')
      if (stored) {
        BGM.cache.userId = stored
        return stored
      }
    }
  } catch {
    /* 忽略 PluginStorage 读取错误 */
  }
  return null
}

/**
 * 设置 Bangumi 用户名（持久化到 PluginStorage）
 */
export function _setBgmUsername(name: string): void {
  if (!name || name.trim() === '') return
  const username = name.trim()
  BGM.cache.username = username
  const app = getApp()
  if (app?.PluginStorage) {
    app.PluginStorage.setItem('bgm_username', username)
  }
  eventBus.emit(BGM_EVENTS.USER_NAME_UPDATED)
}

/**
 * 获取 Bangumi 用户名（优先从内存缓存读取，回退到 PluginStorage）
 * @returns 用户名；若未设置则返回 null
 */
export function _getBgmUsername(): string | null {
  if (BGM.cache.username) return BGM.cache.username
  try {
    const app = getApp()
    if (app?.PluginStorage) {
      const stored = app.PluginStorage.getItem('bgm_username')
      if (stored) {
        BGM.cache.username = stored
        return stored
      }
    }
  } catch {
    /* 忽略 */
  }
  return null
}

/**
 * 获取 Bangumi API 用户路径（格式：/-）
 * 用于拼接用户收藏请求的 URL
 * @returns 用户路径字符串 "/-"，代表当前认证用户
 * @description BGM API v0 使用 "-" 代表当前认证用户，而不是具体的用户ID
 */
export function _getUserApiPath(): string {
  // BGM API v0 使用 "-" 代表当前认证用户
  return '/-'
}

/**
 * 获取 Bangumi 当前登录用户信息
 * @param callback 回调函数，接收 userInfo 和错误类型
 *   - errorType: 'none' | 'network' | 'http' | 'parse' | 'aborted'
 *   - network 错误通常意味着无法连接到 BGM API（如被 GFW 墙）
 * @param signal 可选 AbortSignal，用于取消请求
 */
export function _fetchBgmUserInfo(
  callback?: (
    userInfo: BGMUserInfo | null,
    errorType?: 'none' | 'network' | 'http' | 'parse' | 'aborted',
  ) => void,
  signal?: AbortSignal,
): void {
  // 无 Token 时**同步**回调（保持旧实现语义：调用方在同一个 tick 内即可拿到结果）
  if (!loadBgToken()) {
    if (callback) callback(null, 'none')
    return
  }

  void (async (): Promise<void> => {
    const result = await fetchBgmMeImpl(signal)

    if (result.kind === 'ok') {
      const { id, username, avatarUrl } = result.user
      _setBgmUserId(id)
      _setBgmUsername(username)
      BGM.cache.avatarUrl = avatarUrl ?? null

      // 持久化头像 URL 到 PluginStorage
      try {
        const app = getApp()
        if (app?.PluginStorage) {
          app.PluginStorage.setItem('bgm_avatar_url', avatarUrl ?? '')
        }
      } catch {
        // 静默处理
      }

      bgmLog(
        LOG_LEVELS.INFO,
        `[_fetchBgmUserInfo] 获取用户信息成功: userId=${id}, username=${username}, hasAvatar=${String(avatarUrl !== undefined)}`,
      )
      if (callback) callback(result.user, 'none')
      return
    }

    if (!callback) return
    if (result.kind === 'no-token') {
      callback(null, 'none')
      return
    }
    // 超时沿用旧口径：并入 network（本函数的调用方文案不区分二者）
    callback(null, result.kind === 'timeout' ? 'network' : result.kind)
  })()
}
/**
 * 获取 Bangumi 用户信息（Promise 版本，供 handlers.js 等模块使用）
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns { userInfo, errorType } - errorType 用于区分网络错误与 Token 错误
 *   - 'network': 网络错误（如被 GFW 墙、断网、DNS 失败等），Token 本身可能有效
 *   - 'http': HTTP 错误（如 401 Token 失效、500 服务器错误等）
 *   - 'parse': 响应解析失败
 *   - 'aborted': 请求被取消
 *   - 'none': 无错误（成功或无 Token）
 */
export function fetchBgmUserInfo(signal?: AbortSignal): Promise<{
  userInfo: BGMUserInfo | null
  errorType: 'none' | 'network' | 'http' | 'parse' | 'aborted'
}> {
  return new Promise((resolve) => {
    _fetchBgmUserInfo((userInfo, errorType) => {
      resolve({ userInfo, errorType: errorType ?? 'none' })
    }, signal)
  })
}

// ========== 辅助函数 ==========
/**
 * 通过 WPS 提供的接口执行脚本
 */
export function shellExecuteByOAAssist(parameter: string): void {
  const app = getApp()
  if (app?.OAAssist) {
    app.OAAssist.ShellExecute(parameter)
  }
}

/**
 * 获取 URL 路径
 */
export function getUrlPath(): string {
  const app = getApp() as { PluginStorage?: { getItem: (key: string) => string | null } } | null
  const manifestPath = app?.PluginStorage?.getItem('manifest_base_path')
  if (manifestPath) {
    return manifestPath
  }
  if (typeof window !== 'undefined' && window.location.href) {
    const currentUrl = window.location.href
    const lastSlash = currentUrl.lastIndexOf('/')
    return currentUrl.substring(0, lastSlash)
  }
  return ''
}

/**
 * 标记设置面板已成功加载
 *
 * showSettingsPanel 依据该标记判断已缓存的面板 ID 是否可用：
 * 页面若加载失败（URL 错误等），标记不会被写入，下次点击时直接重建面板。
 */
export function markSettingsPaneLoaded(): void {
  if (typeof window === 'undefined') return
  const app = getApp() as { PluginStorage?: { setItem: (k: string, v: string) => void } } | null
  app?.PluginStorage?.setItem('settings_pane_url', window.location.href)
}

/**
 * 标记清理面板已成功加载
 *
 * 与 markSettingsPaneLoaded 同款自愈机制：页面若加载失败（URL 错误等），
 * 标记不会被写入，下次点击「数据清理」时直接重建面板，避免坏 ID 被持久化卡死。
 */
export function markCleanPaneLoaded(): void {
  if (typeof window === 'undefined') return
  const app = getApp() as { PluginStorage?: { setItem: (k: string, v: string) => void } } | null
  app?.PluginStorage?.setItem('clean_pane_url', window.location.href)
}

/**
 * 显示 / 切换「数据清理」面板（独立面板，与设置 / 富化面板并列）
 *
 * 面板 ID 缓存于 `clean_pane_id`；配合 `clean_pane_url` 标记做自愈：
 * 缓存 ID 存在但页面从未成功加载时，隐藏旧面板并重建。
 */
export function showCleanPanel(): void {
  const app = getApp() as {
    PluginStorage?: {
      getItem: (k: string) => string | null
      setItem: (k: string, v: string) => void
    }
    CreateTaskPane?: (url: string) => { ID: string; Visible: boolean }
    GetTaskPane?: (id: string) => { Visible: boolean }
  } | null
  if (!app) {
    bgmLog(LOG_LEVELS.ERROR, '[showCleanPanel] 无法获取 WPS Application 对象')
    return
  }

  let cleanId = app.PluginStorage?.getItem('clean_pane_id')
  const storedPaneUrl = app.PluginStorage?.getItem('clean_pane_url')

  // 自愈：缓存 ID 存在但页面从未成功加载（URL 拼错 / 页面报错）→ 隐藏并重建
  if (cleanId && !storedPaneUrl?.includes('clean.html')) {
    const stalePane = app.GetTaskPane?.(cleanId)
    if (stalePane) stalePane.Visible = false
    app.PluginStorage?.setItem('clean_pane_id', '')
    app.PluginStorage?.setItem('clean_pane_url', '')
    cleanId = null
    bgmLog(LOG_LEVELS.WARN, '[showCleanPanel] 检测到加载失败的旧清理面板，已重建')
  }

  if (cleanId) {
    const pane = app.GetTaskPane?.(cleanId)
    if (pane) {
      pane.Visible = !pane.Visible
      bgmLog(LOG_LEVELS.INFO, `[showCleanPanel] 清理面板可见性切换: ${String(pane.Visible)}`)
      return
    }
    // 面板 ID 失效（用户手动关闭）→ 清空存储，本次直接重建
    app.PluginStorage?.setItem('clean_pane_id', '')
    app.PluginStorage?.setItem('clean_pane_url', '')
    bgmLog(LOG_LEVELS.WARN, '[showCleanPanel] 清理面板ID失效，已清除存储')
  }

  const pane = app.CreateTaskPane?.(buildTaskPaneUrl('clean.html'))
  if (pane) {
    pane.Visible = true
    app.PluginStorage?.setItem('clean_pane_id', pane.ID)
    bgmLog(LOG_LEVELS.INFO, `[showCleanPanel] 清理面板已创建(ID:${pane.ID})`)
  } else {
    bgmLog(LOG_LEVELS.ERROR, '[showCleanPanel] 创建清理面板失败')
  }
}

/**
 * 标记「番剧高亮」面板已成功加载（自愈用：URL 拼错 / 页面报错时下次重建）
 */
export function markHighlightPaneLoaded(): void {
  if (typeof window === 'undefined') return
  const app = getApp() as { PluginStorage?: { setItem: (k: string, v: string) => void } } | null
  app?.PluginStorage?.setItem('highlight_pane_url', window.location.href)
}

/**
 * 标记「条件格式管理」面板已成功加载（自愈用：URL 拼错 / 页面报错时下次重建）
 */
export function markConditionalFormatPaneLoaded(): void {
  if (typeof window === 'undefined') return
  const app = getApp() as { PluginStorage?: { setItem: (k: string, v: string) => void } } | null
  app?.PluginStorage?.setItem('conditionalFormat_pane_url', window.location.href)
}

/**
 * 显示 / 切换「条件格式管理」面板（独立面板，与设置 / 富化 / 清理 / 高亮并列）
 *
 * 面板 ID 缓存于 `cf_pane_id`；配合 `cf_pane_url` 标记做自愈：缓存 ID 存在但
 * 页面从未成功加载时，隐藏旧面板并重建。与清理 / 高亮面板同款机制。
 */
export function showConditionalFormatPanel(): void {
  const app = getApp() as {
    PluginStorage?: {
      getItem: (k: string) => string | null
      setItem: (k: string, v: string) => void
    }
    CreateTaskPane?: (url: string) => { ID: string; Visible: boolean }
    GetTaskPane?: (id: string) => { Visible: boolean }
  } | null
  if (!app) {
    bgmLog(LOG_LEVELS.ERROR, '[showConditionalFormatPanel] 无法获取 WPS Application 对象')
    return
  }

  let conditionalFormatId = app.PluginStorage?.getItem('conditionalFormat_pane_id')
  const storedPaneUrl = app.PluginStorage?.getItem('conditionalFormat_pane_url')
  // 命名规范化（cf → conditionalFormat）前的旧键：读一次并迁走，
  // 否则升级后旧面板拿不到缓存 ID，会被重复 CreateTaskPane 成孤儿窗
  if (!conditionalFormatId) {
    const legacyId = app.PluginStorage?.getItem('cf_pane_id')
    if (legacyId) {
      conditionalFormatId = legacyId
      app.PluginStorage?.setItem('conditionalFormat_pane_id', legacyId)
      app.PluginStorage?.setItem('cf_pane_id', '')
    }
  }

  // 自愈：缓存 ID 存在但页面从未成功加载 → 隐藏并重建
  if (conditionalFormatId && !storedPaneUrl?.includes('conditional-format.html')) {
    const stalePane = app.GetTaskPane?.(conditionalFormatId)
    if (stalePane) stalePane.Visible = false
    app.PluginStorage?.setItem('conditionalFormat_pane_id', '')
    app.PluginStorage?.setItem('conditionalFormat_pane_url', '')
    conditionalFormatId = null
    bgmLog(LOG_LEVELS.WARN, '[showConditionalFormatPanel] 检测到加载失败的旧条件格式面板，已重建')
  }

  if (conditionalFormatId) {
    const pane = app.GetTaskPane?.(conditionalFormatId)
    if (pane) {
      pane.Visible = !pane.Visible
      bgmLog(
        LOG_LEVELS.INFO,
        `[showConditionalFormatPanel] 条件格式面板可见性切换: ${String(pane.Visible)}`,
      )
      return
    }
    app.PluginStorage?.setItem('conditionalFormat_pane_id', '')
    app.PluginStorage?.setItem('conditionalFormat_pane_url', '')
    bgmLog(LOG_LEVELS.WARN, '[showConditionalFormatPanel] 条件格式面板ID失效，已清除存储')
  }

  const pane = app.CreateTaskPane?.(buildTaskPaneUrl('conditional-format.html'))
  if (pane) {
    pane.Visible = true
    app.PluginStorage?.setItem('conditionalFormat_pane_id', pane.ID)
    bgmLog(LOG_LEVELS.INFO, `[showConditionalFormatPanel] 条件格式面板已创建(ID:${pane.ID})`)
  } else {
    bgmLog(LOG_LEVELS.ERROR, '[showConditionalFormatPanel] 创建条件格式面板失败')
  }
}

/**
 * 显示 / 切换「番剧高亮」面板（独立面板，与设置 / 富化 / 清理面板并列）
 *
 * 面板 ID 缓存于 `highlight_pane_id`；配合 `highlight_pane_url` 标记做自愈：
 * 缓存 ID 存在但页面从未成功加载时，隐藏旧面板并重建。与清理面板同款机制。
 */
export function showHighlightPanel(): void {
  const app = getApp() as {
    PluginStorage?: {
      getItem: (k: string) => string | null
      setItem: (k: string, v: string) => void
    }
    CreateTaskPane?: (url: string) => { ID: string; Visible: boolean }
    GetTaskPane?: (id: string) => { Visible: boolean }
  } | null
  if (!app) {
    bgmLog(LOG_LEVELS.ERROR, '[showHighlightPanel] 无法获取 WPS Application 对象')
    return
  }

  let highlightId = app.PluginStorage?.getItem('highlight_pane_id')
  const storedPaneUrl = app.PluginStorage?.getItem('highlight_pane_url')

  // 自愈：缓存 ID 存在但页面从未成功加载 → 隐藏并重建
  if (highlightId && !storedPaneUrl?.includes('highlight.html')) {
    const stalePane = app.GetTaskPane?.(highlightId)
    if (stalePane) stalePane.Visible = false
    app.PluginStorage?.setItem('highlight_pane_id', '')
    app.PluginStorage?.setItem('highlight_pane_url', '')
    highlightId = null
    bgmLog(LOG_LEVELS.WARN, '[showHighlightPanel] 检测到加载失败的旧高亮面板，已重建')
  }

  if (highlightId) {
    const pane = app.GetTaskPane?.(highlightId)
    if (pane) {
      pane.Visible = !pane.Visible
      bgmLog(LOG_LEVELS.INFO, `[showHighlightPanel] 高亮面板可见性切换: ${String(pane.Visible)}`)
      return
    }
    app.PluginStorage?.setItem('highlight_pane_id', '')
    app.PluginStorage?.setItem('highlight_pane_url', '')
    bgmLog(LOG_LEVELS.WARN, '[showHighlightPanel] 高亮面板ID失效，已清除存储')
  }

  const pane = app.CreateTaskPane?.(buildTaskPaneUrl('highlight.html'))
  if (pane) {
    pane.Visible = true
    app.PluginStorage?.setItem('highlight_pane_id', pane.ID)
    bgmLog(LOG_LEVELS.INFO, `[showHighlightPanel] 高亮面板已创建(ID:${pane.ID})`)
  } else {
    bgmLog(LOG_LEVELS.ERROR, '[showHighlightPanel] 创建高亮面板失败')
  }
}

/**
 * 构造任务窗格页面 URL
 *
 * 背景：getUrlPath() 在面板页面内（如 .../ui/panel.html）执行时返回的是页面所在目录
 * `.../ui`，此时若直接拼接 `/ui/settings.html` 会得到错误的 `.../ui/ui/settings.html`。
 * 这里统一把末尾的 `/ui` 归一化掉后再拼接，保证任何调用上下文都得到 `.../ui/<page>`。
 *
 * @param page 页面文件名，如 `settings.html`
 * @returns 归一化后的完整页面 URL
 */
export function buildTaskPaneUrl(page: string): string {
  const base = getUrlPath().replace(/\/+$/u, '').replace(/\/ui$/u, '')
  return `${base}/ui/${page}`
}

/**
 * 显示同步面板
 */
export function showBangumiPanel(): void {
  const app = getApp() as {
    PluginStorage?: {
      getItem: (k: string) => string | null
      setItem: (k: string, v: string) => void
    }
    CreateTaskPane?: (url: string) => { ID: string; Visible: boolean }
    GetTaskPane?: (id: string) => { Visible: boolean }
  } | null
  if (!app) {
    const win = typeof window === 'undefined' ? null : (window as unknown as BgmWindowGlobals)
    if (win?.BGMError) {
      // BGMError 是宿主注入的展示函数，非构造函数，勿用 new

      win.BGMError('无法获取 WPS Application 对象！', '错误')
    } else {
      // 使用自定义错误对话框
      getNotifyApi().error('无法获取 WPS Application 对象！', '错误')
    }
    return
  }
  const tsId = app.PluginStorage?.getItem('panel_id')
  let isBecameVisible = false
  if (tsId) {
    const tskpane = app.GetTaskPane?.(tsId)
    if (tskpane) {
      // 切换可见性：从隐藏→显示时才触发刷新信号
      if (!tskpane.Visible) {
        isBecameVisible = true
      }
      tskpane.Visible = !tskpane.Visible
    }
  } else {
    const tskpane = app.CreateTaskPane?.(`${getUrlPath()}/ui/panel.html`)
    if (tskpane) {
      const id = tskpane.ID
      app.PluginStorage?.setItem('panel_id', id)
      tskpane.Visible = true
      isBecameVisible = true
    }
  }
  // 写入"面板已显示"信号（时间戳），panel 轮询检测到变化后自动刷新工作表
  if (isBecameVisible) {
    try {
      app.PluginStorage?.setItem('bgm_panel_shown_at', String(Date.now()))
      bgmLog(LOG_LEVELS.INFO, `[showBangumiPanel] 面板已显示，已写入刷新信号`)
    } catch (error: unknown) {
      bgmLog(
        LOG_LEVELS.WARN,
        `[showBangumiPanel] 写入面板显示信号失败: ${(error as Error).message}`,
      )
    }
  }
}

/**
 * 显示新番表富化面板
 * 独立面板，与主同步面板分离
 */
export function showEnrichPanel(): void {
  const app = getApp() as {
    PluginStorage?: {
      getItem: (k: string) => string | null
      setItem: (k: string, v: string) => void
    }
    CreateTaskPane?: (url: string) => { ID: string; Visible: boolean }
    GetTaskPane?: (id: string) => { Visible: boolean }
  } | null
  if (!app) {
    bgmLog(LOG_LEVELS.ERROR, '[showEnrichPanel] 无法获取 WPS Application 对象')
    return
  }
  const tsId = app.PluginStorage?.getItem('enrich_pane_id')
  if (tsId) {
    const tskpane = app.GetTaskPane?.(tsId)
    if (tskpane) {
      tskpane.Visible = !tskpane.Visible
      bgmLog(LOG_LEVELS.INFO, `[showEnrichPanel] 富化面板可见性切换: ${String(tskpane.Visible)}`)
    }
  } else {
    const tskpane = app.CreateTaskPane?.(`${getUrlPath()}/ui/enrich.html`)
    if (tskpane) {
      const id = tskpane.ID
      app.PluginStorage?.setItem('enrich_pane_id', id)
      tskpane.Visible = true
      bgmLog(LOG_LEVELS.INFO, '[showEnrichPanel] 富化面板已创建并显示')
    }
  }
}

/**
 * 显示/切换设置面板
 * 设置面板位置逻辑：
 * - 始终停靠右侧（msoCTPDockPositionRight）
 * - 有主面板时在主面板右边弹出，无主面板时直接弹出在右侧
 */
export function showSettingsPanel(): void {
  const app = getApp() as {
    PluginStorage?: {
      getItem: (k: string) => string | null
      setItem: (k: string, v: string) => void
    }
    CreateTaskPane?: (url: string) => { ID: string; Visible: boolean; DockPosition?: number }
    GetTaskPane?: (id: string) => { Visible: boolean; DockPosition?: number }
  } | null
  if (!app) {
    bgmLog(LOG_LEVELS.ERROR, '[showSettingsPanel] 无法获取 WPS Application 对象')
    return
  }

  let settingsId = app.PluginStorage?.getItem('settings_pane_id')
  const storedPaneUrl = app.PluginStorage?.getItem('settings_pane_url')

  // 自愈：若上次创建的面板从未成功加载设置页（例如旧版本拼出的 .../ui/ui/settings.html，
  // 页面加载失败因此从未写入 settings_pane_url），该 ID 永远打不开内容。
  // 这里隐藏旧面板并清空 ID，本次点击直接重建。
  if (settingsId && !storedPaneUrl?.includes('settings.html')) {
    const stalePane = app.GetTaskPane?.(settingsId)
    if (stalePane) stalePane.Visible = false
    app.PluginStorage?.setItem('settings_pane_id', '')
    app.PluginStorage?.setItem('settings_pane_url', '')
    settingsId = null
    bgmLog(LOG_LEVELS.WARN, '[showSettingsPanel] 检测到加载失败的旧设置面板，已重建')
  }

  const mainPanelId = app.PluginStorage?.getItem('panel_id')

  // 检查主面板当前可见性
  let isMainPanelVisible = false
  if (mainPanelId) {
    const mainPanel = app.GetTaskPane?.(mainPanelId)
    isMainPanelVisible = mainPanel?.Visible ?? false
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[showSettingsPanel] 主面板状态: ${isMainPanelVisible ? '可见' : '隐藏'}, settingsId: ${settingsId ?? '无'}`,
  )

  // 始终停靠右侧
  const targetPosition = WPS_ENUM.msoCTPDockPositionRight
  const positionLabel = '右侧'

  if (settingsId) {
    // 已存在：显示并更新停靠位置
    const settingsPane = app.GetTaskPane?.(settingsId)
    if (settingsPane) {
      if (settingsPane.Visible) {
        settingsPane.Visible = false
        bgmLog(LOG_LEVELS.INFO, '[showSettingsPanel] 设置面板已隐藏')
      } else {
        settingsPane.DockPosition = targetPosition
        settingsPane.Visible = true
        bgmLog(LOG_LEVELS.INFO, `[showSettingsPanel] 设置面板已显示(停靠:${positionLabel})`)
      }
    } else {
      // 面板ID失效（可能被用户手动关闭），清除存储以便下次重新创建
      app.PluginStorage?.setItem('settings_pane_id', '')
      app.PluginStorage?.setItem('settings_pane_url', '')
      bgmLog(LOG_LEVELS.WARN, '[showSettingsPanel] 设置面板ID失效，已清除存储')
    }
  } else {
    // 首次创建设置面板
    const settingsPane = app.CreateTaskPane?.(buildTaskPaneUrl('settings.html'))
    if (settingsPane) {
      settingsPane.DockPosition = targetPosition
      settingsPane.Visible = true
      app.PluginStorage?.setItem('settings_pane_id', settingsPane.ID)
      bgmLog(
        LOG_LEVELS.INFO,
        `[showSettingsPanel] 设置面板已创建(ID:${settingsPane.ID}, 停靠:${positionLabel})`,
      )
    } else {
      bgmLog(LOG_LEVELS.ERROR, '[showSettingsPanel] 创建设置面板失败')
    }
  }
}

export { trim, escapeHtml, calcFingerprint, colNumberToLetter } from '../string-utilities.js'
