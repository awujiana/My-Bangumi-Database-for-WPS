/**
 * 工具模块 - 统一导出入口
 * @module tools/util
 * @description 原 util.ts 已按职责拆分到 util/ 子目录，此文件作为聚合入口，
 *              保留 BGM 全局命名空间、bgmLog、getApp、Token 存储、用户信息、辅助函数等核心内容，
 *              并 re-export 子模块以保持外部 import 路径不变。
 *
 * 拆分结构：
 *   - util/cell.ts：单元格读取/设置（getCell、getCellValue、setCellValue、getSheetByIndex）
 *   - util/sheet.ts：工作表读取/缓存（readRangeValues、cacheGet、findHeaderRow、getColumnMap、clearSheetCache、getLastRow、isEmptyValue、getDataSheet、safeActivate）
 *   - util/sleep.ts：延时（sleep、delay）
 *   - util/index.ts：BGM 命名空间、bgmLog、getApp、Token 存储、用户 ID/用户名、辅助函数（shellExecuteByOAAssist、getUrlPath、showBangumiPanel）
 */
// 直接从源模块导入，打破 util.ts ↔ index.ts 的循环依赖
import { BGM_CONFIG, LOG_LEVELS, ERROR_LEVELS, ErrorLevel, WPS_ENUM } from '../../core/constants.js'
import type { ErrorOptions } from '../../core/constants.js'
import { BgmError } from '../../core/result.js'
import type {
  BGMCache,
  BGMSheet,
  BGMSync,
  BGMUserInfo,
  EnrichWorkbookState,
} from '../../core/types.js'
import {
  showConfirm,
  showToast,
  showAlert as customShowAlert,
  showError as customShowError,
  showInput as customShowInput,
} from '../../ui/dialog.js'
import type { DialogOptions } from '../../ui/dialog.js'

import { syncAllRows } from '../../ui/preview.js'
// 类型只从 index.js 导入（type-only import 不会产生运行时循环依赖）
import { BGM_EVENTS, eventBus } from '../events.js'
// 字符串工具已拆分到 stringUtils.ts，此处 import 供内部调用，并 re-export 保持向后兼容
import { logger } from '../logger.js'
import {
  colNumToLetter as colNumberToLetter,
  trim,
  escapeHtml,
  calcFingerprint,
} from '../stringUtils.js'
// 日志模块：bgmLog 内部通过 logger 输出，自动脱敏敏感信息，且不污染全局 console
import { isWpsApp } from '../wps.js'
import type { WpsApplication as WpsApp, WpsWorksheet } from '../wps.js'

// re-export 字符串工具保持向后兼容
export { colNumberToLetter as colNumToLetter, trim, escapeHtml, calcFingerprint }
// re-export 子模块
export { getCell, getCellValue, setCellValue, getSheetByIndex } from './cell.js'
export {
  readRangeValues,
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
  enrich: EnrichWorkbookState
  LOG_LEVEL: number
  LOG_LEVELS: typeof LOG_LEVELS
  ERROR_LEVELS: typeof ERROR_LEVELS
  ErrorLevel: typeof ErrorLevel
  BgmError: typeof BgmError
  dataPreview?: {
    ws: WpsWorksheet | null | undefined
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
    confirm: (message: string, callback: (confirmed: boolean) => void, title?: string) => void
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
  showConfirm: (
    title: string,
    message: string,
    onConfirm?: () => void,
    onCancel?: () => void,
  ) => void
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
  // 富化工作簿锁定状态（与 BGM.sheet 独立）
  enrich: {
    lockedWorkbookName: null,
    lockedSheetName: null,
    lockedSheetIndex: null,
    isLocked: false,
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
      BGM.Dialog.confirm('确定要开始上传同步吗？', (confirmed: boolean) => {
        if (!confirmed) return
        // 复用统一入口，确保状态一致
        if (!this.enterRunningState()) return
        bgmLog(LOG_LEVELS.INFO, '开始执行同步...')
        syncAllRows()
          .then(() => {
            // 成功路径也清理状态，与 catch 分支对称
            if (this.shouldStop) {
              BGM.Dialog.alert('同步已停止', '提示')
            }
            this.exitRunningState()
          })
          .catch((error: unknown) => {
            this.exitRunningState()
            BGM.handleError(error, { showAlert: true })
          })
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
        showToast('已暂停，但无法定位到当前单元格', 'warn')
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
        await new Promise((r) => setTimeout(r, 50))
      }
    },

    /** 定位到当前正在处理的单元格 */
    locateCurrentCell(): boolean {
      if (!this.currentRow || this.currentRow < 1 || !this.currentSheet) return false
      try {
        const ws = this.currentSheet
        const col = this.currentCol > 0 ? this.currentCol : 1
        const cellAddr = `${colNumberToLetter(col)}${String(this.currentRow)}`
        const cell = ws.Range(cellAddr)
        cell.Select()
        bgmLog(LOG_LEVELS.INFO, `[sync] 已定位到单元格: ${cellAddr}`)
        return true
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        bgmLog(LOG_LEVELS.WARN, `[sync] 定位单元格失败: ${message}`)
        showToast(`定位单元格失败: ${message}`, 'error')
        return false
      }
    },

    /** 更新当前位置（供同步循环调用，传 undefined 保留原值） */
    updatePosition(ws: WpsWorksheet | null | undefined, row: number, col?: number): void {
      // 行号范围校验：必须为非负整数
      if (!Number.isInteger(row) || row < 0) return
      if (ws !== undefined) this.currentSheet = ws
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
      customShowAlert(message, title)
    },
    confirm(message: string, callback: (confirmed: boolean) => void, title?: string): void {
      showConfirm(message, callback, title)
    },
    error(title: string, message: string): void {
      if (typeof window !== 'undefined') {
        const win = window as unknown as BgmWindowGlobals
        if (win.BGMDialog !== undefined) {
          win.BGMDialog.error(title, message)
          return
        }
        if (typeof win.BGMError === 'function') {
          win.BGMError(message, title)
          return
        }
      }
      // 使用自定义对话框
      customShowError(message, title)
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
      customShowInput(
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
      {
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
      }
    },
  },

  showAlert(title: string, message: string): void {
    BGM.Dialog.alert(title, message)
  },

  showConfirm(title: string, message: string, onConfirm?: () => void, onCancel?: () => void): void {
    BGM.Dialog.confirm(
      message,
      (confirmed: boolean) => {
        if (confirmed) {
          onConfirm?.()
        } else {
          onCancel?.()
        }
      },
      title,
    )
  },

  // 统一错误处理
  handleError(error: unknown, options?: ErrorOptions): BgmError {
    const options_: ErrorOptions = {
      level: ErrorLevel.ERROR,
      showAlert: false,
      context: '',
      ...options,
    }
    // ✅ 自动获取调用函数名（如果 context 未手动指定）
    if (!options_.context) {
      options_.context = getCallerFunctionName()
    }
    let bgmError: BgmError
    if (error instanceof BgmError) {
      bgmError = error
    } else if (error instanceof Error) {
      bgmError = new BgmError(error.message, 'JS_ERROR', {
        name: error.name,
        stack: error.stack,
      })
    } else {
      bgmError = new BgmError(String(error), 'UNKNOWN')
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
 * @param level - 日志级别 (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
 * @param message - 日志消息
 */

export function bgmLog(level: number, message: string | null | undefined): void {
  if (level >= BGM.LOG_LEVEL) {
    const message_ = message ?? ''
    // 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR（与 LOG_LEVELS 保持一致）
    // 通过 logger 输出，message 会自动经过 maskSensitiveData 脱敏
    switch (level) {
      case 0: {
        logger.debug(message_)
        break
      }
      case 1: {
        logger.info(message_)
        break
      }
      case 2: {
        logger.warn(message_)
        break
      }
      case 3: {
        logger.error(message_)
        break
      }
      default: {
        logger.info(message_)
      }
    }
  }
}
/**
 * 从调用栈中提取第一个非内部函数的名称
 * @param skipAdditional 额外跳过的帧数（备用，通常无需传）
 */
function getCallerFunctionName(_skipAdditional = 0): string {
  const e = new Error()
  const stack = e.stack ?? ''
  const lines = stack.split('\n')
  // 需要跳过的内部函数名列表
  const internalFuncs = new Set([
    'getCallerFunctionName',
    'handleError',
    'safeExecute',
    'BGM.handleError',
    'BGM.safeExecute',
  ])

  for (let index = 2; index < lines.length; index += 1) {
    const rawLine = lines[index]
    if (!(rawLine === undefined)) {
      const line = rawLine.trim()
      const match = /at\s+([^\s(]+)/.exec(line)
      if (match) {
        const name = match[1]
        if (name !== undefined && !internalFuncs.has(name)) {
          return name
        }
      }
    }
  }
  return 'unknown'
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
 * 复制 Token 到剪贴板
 * @returns 是否复制成功
 */
export function copyTokenToClipboard(): boolean {
  const token = loadBgToken()
  if (!token) return false
  try {
    const textarea = document.createElement('textarea')
    textarea.value = token
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    // execCommand 已废弃（no-deprecated），但 WPS WebView 中 Clipboard API 不可用时可回退使用，
    // 这里以精确类型调用规避废弃标注
    const isOk = (
      document as unknown as {
        execCommand: (commandId: string, showUI?: boolean, value?: string) => boolean
      }
    ).execCommand('copy')
    document.body.removeChild(textarea)
    if (isOk) {
      bgmLog(LOG_LEVELS.INFO, '[copyTokenToClipboard] Token 已复制到剪贴板')
    } else {
      bgmLog(LOG_LEVELS.WARN, '[copyTokenToClipboard] execCommand copy 失败')
    }
    return isOk
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.ERROR, `[copyTokenToClipboard] 复制失败: ${(error as Error).message}`)
    return false
  }
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
  const token = loadBgToken()
  if (!token) {
    if (callback) callback(null, 'none')
    return
  }

  // 如果 signal 已 aborted，立即回调
  if (signal?.aborted) {
    bgmLog(LOG_LEVELS.INFO, `[_fetchBgmUserInfo] 请求被取消（signal 已 aborted）`)
    if (callback) callback(null, 'aborted')
    return
  }

  const apiUrl = `${BGM_CONFIG.API_BASE}/v0/me`
  bgmLog(LOG_LEVELS.INFO, `[_fetchBgmUserInfo] API 路由: ${apiUrl}`)

  const xhr = new XMLHttpRequest()
  xhr.open('GET', apiUrl, true)
  xhr.setRequestHeader('Authorization', `Bearer ${token}`)
  xhr.setRequestHeader('Content-Type', 'application/json')
  // 15 秒超时，便于快速感知网络问题
  xhr.timeout = 15_000

  // AbortSignal 支持：监听 abort 事件触发 xhr.abort()
  if (signal) {
    signal.addEventListener('abort', () => {
      xhr.abort()
    })
  }

  xhr.onload = function (): void {
    if (xhr.status === 200) {
      try {
        const data = JSON.parse(xhr.responseText) as {
          id?: string | number
          user_id?: string | number
          username?: string
          user_name?: string
          name?: string
          nickname?: string
          avatar?: {
            large?: string
            medium?: string
            small?: string
          }
        }
        const userId = String(data.id || data.user_id || '')
        // BGM API v0 返回的用户名字段是 nickname，username 是用户ID
        const username = (data.nickname || data.username || data.user_name || data.name) ?? ''

        _setBgmUserId(userId)
        _setBgmUsername(username)

        // 从 API 响应中提取头像 URL，并清理可能存在的反引号包裹
        const rawAvatarUrl = (data.avatar?.large || data.avatar?.medium || data.avatar?.small) ?? ''
        const cleanAvatarUrl = rawAvatarUrl ? rawAvatarUrl.replace(/`/g, '').trim() : ''

        // 优先使用 API 返回的头像 URL，若不存在则回退到构造的 URL
        const avatarUrl =
          cleanAvatarUrl ||
          (username
            ? `${BGM_CONFIG.API_BASE}/v0/users/${encodeURIComponent(username)}/avatar?type=large`
            : null)

        BGM.cache.avatarUrl = avatarUrl

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
          `[_fetchBgmUserInfo] 获取用户信息成功: userId=${userId}, username=${username}, hasAvatar=${String(!!avatarUrl)}`,
        )

        if (callback) callback({ id: userId, username, avatarUrl: avatarUrl || undefined }, 'none')
      } catch (error: unknown) {
        bgmLog(LOG_LEVELS.ERROR, `[_fetchBgmUserInfo] 解析响应失败: ${(error as Error).message}`)
        if (callback) callback(null, 'parse')
      }
    } else {
      bgmLog(
        LOG_LEVELS.WARN,
        `[_fetchBgmUserInfo] 获取用户信息失败，HTTP 状态码: ${String(xhr.status)}`,
      )
      if (callback) callback(null, 'http')
    }
  }

  xhr.onerror = function (): void {
    // 如果是 abort 导致的 onerror，归类为 aborted
    if (signal?.aborted) {
      bgmLog(LOG_LEVELS.INFO, `[_fetchBgmUserInfo] 请求被取消`)
      if (callback) callback(null, 'aborted')
      return
    }
    bgmLog(LOG_LEVELS.WARN, `[_fetchBgmUserInfo] 网络错误：无法连接到 ${apiUrl}（可能被 GFW 墙）`)
    if (callback) callback(null, 'network')
  }

  xhr.ontimeout = function (): void {
    bgmLog(LOG_LEVELS.WARN, `[_fetchBgmUserInfo] 请求超时（15s）：可能网络受限或被墙`)
    if (callback) callback(null, 'network')
  }

  xhr.send()
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
      win.BGMError('无法获取 WPS Application 对象！', '错误')
    } else {
      // 使用自定义错误对话框
      customShowError('无法获取 WPS Application 对象！', '错误')
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

  const settingsId = app.PluginStorage?.getItem('settings_pane_id')
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
      bgmLog(LOG_LEVELS.WARN, '[showSettingsPanel] 设置面板ID失效，已清除存储')
    }
  } else {
    // 首次创建设置面板
    const settingsPane = app.CreateTaskPane?.(`${getUrlPath()}/ui/settings.html`)
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
