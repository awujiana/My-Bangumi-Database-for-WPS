/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */

import {
  syncWithConfirmation,
  setTokenForRibbon,
  testTokenForRibbon,
  copyTokenForRibbon,
  setUserIdForRibbon,
  openCollectionForRibbon,
  syncFromGithubForRibbon,
  undoLastSyncForRibbon,
} from './services/ribbon-service.js'

import {
  WPS_ENUM,
  showBangumiPanel,
  showEnrichPanel,
  showSettingsPanel,
  showCleanPanel,
  showHighlightPanel,
  showConditionalFormatPanel,
  BGM,
  isIncrementalSyncEnabled,
  isSkipConflictsEnabled,
  setIncrementalSync,
  setSkipConflicts,
  isSyncRecordEnabled,
  setSyncRecordEnabled,
  bgmLog,
  LOG_LEVELS,
  getApp,
} from './index.js'
import { initializeWorkbookAutoDetection } from './sync/workbook-auto-detect.js'

/**
 * WPS Ribbon 控件回调参数最小接口
 * WPS Ribbon 系统在调用 getPressed/onAction 回调时传入的 control 对象。
 * 第三方 WPS Ribbon API 无 @types，仅定义本项目使用到的字段。
 */
interface WpsRibbonControl {
  /** 控件 ID（对应 ribbon.xml 中的 id 属性） */
  Id?: string
  /** 控件 Tag（对应 ribbon.xml 中的 tag 属性） */
  Tag?: string
  /** 复选框当前按下状态（仅 checkBox 控件回调使用） */
  Pressed?: boolean
  /** 上下文对象（通常为当前 Workbook） */
  Context?: unknown
}

/**
 * WPS Ribbon UI 最小接口定义
 * 第三方 WPS Ribbon API 无 @types，仅定义本项目使用到的方法
 */
interface WpsRibbonUI {
  Invalidate(): void
  InvalidateControl(id: string): void
  ActivateTab?(tabId: string): void
}

/**
 * Ribbon 模块挂载到 window 上的全局扩展
 * 用于 WPS Ribbon XML 回调桥接（只能调用 window 上的函数）
 */
interface RibbonWindowExtensions {
  _bgmRibbonReady?: (
    onAddinLoad: (ribbonUI: WpsRibbonUI) => boolean,
    onAction: (control: { Id: string }) => boolean,
    getImage: (control: { Id: string }) => string,
  ) => void
  GetIncrementalSyncPressed?: (control: WpsRibbonControl) => boolean
  GetSkipConflictsPressed?: (control: WpsRibbonControl) => boolean
  OnIncrementalSyncChange?: (control: WpsRibbonControl) => boolean
  OnSkipConflictsChange?: (control: WpsRibbonControl) => boolean
  GetEnableSyncRecordPressed?: (control: WpsRibbonControl) => boolean
  OnEnableSyncRecordChange?: (control: WpsRibbonControl) => boolean
}

// 在 Ribbon 启动时通过 initializeRibbon() 显式注册（不在模块加载时自动执行）
// 【正确】监听侧边栏发来的配置更新，刷新 Ribbon UI
let _ribbonMessageHandler: ((event: MessageEvent) => void) | null = null

function initializeRibbonMessageListener(): void {
  if (typeof window === 'undefined') return
  // 防止重复注册：先移除旧监听器
  if (_ribbonMessageHandler) {
    window.removeEventListener('message', _ribbonMessageHandler)
  }
  _ribbonMessageHandler = (event: MessageEvent) => {
    // origin 白名单校验（防止跨域消息注入）
    const allowedOrigins = ['null', '', window.location.origin]
    if (!allowedOrigins.includes(event.origin)) {
      bgmLog(LOG_LEVELS.WARN, `[message] 拒绝非预期 origin: ${event.origin}`)
      return
    }
    const data = event.data as { type?: string; data?: { key?: string } } | null | undefined
    if (data?.type === 'BGM:configUpdated') {
      const key = data.data?.key
      const controlIdMap: Record<string, string> = {
        bgm_incremental_sync: 'chkIncrementalSync',
        bgm_skip_conflicts: 'chkSkipConflicts',
        bgm_enable_sync_record: 'chkEnableSyncRecord',
      }
      const controlId = key === undefined ? undefined : controlIdMap[key]
      if (controlId) {
        const app = getApp()
        const ribbonUI = app?.ribbonUI as WpsRibbonUI | undefined
        if (ribbonUI) {
          ribbonUI.InvalidateControl(controlId)
          bgmLog(
            LOG_LEVELS.INFO,
            `[ribbon-message] 已 InvalidateControl ${controlId} (config key=${String(key)})`,
          )
        } else {
          bgmLog(LOG_LEVELS.WARN, `[ribbon-message] ribbonUI 不可用，无法刷新 ${controlId}`)
        }
      }
    }
  }
  window.addEventListener('message', _ribbonMessageHandler)
}

// ========== PluginStorage 配置轮询（Ribbon ↔ Panel 跨 WebView 同步）========== WPS 中 Ribbon 和 Panel 是独立 WebView，postMessage 无法跨上下文通信。 Panel 侧通过 userInfoPolling 轮询 PluginStorage 同步 Ribbon 的变更， Ribbon 侧也需要同等轮询机制，定期检查 Panel 写入的配置变更并刷新按钮状态。

let _configPollingTimer: ReturnType<typeof setInterval> | null = null

/**
 * 启动 Ribbon 配置轮询：每 2 秒检查 PluginStorage 中配置值的变化，
 * 发现变化时调用 InvalidateControl 刷新 Ribbon 按钮状态。
 *
 * 需要与 Panel 的 startUserInfoPolling（2 秒间隔）保持一致，
 * 确保双边同步延迟在 2 秒以内。
 */
function startRibbonConfigPolling(): void {
  // 临时实验开关：停掉周期性同步 COM 轮询（见 freeze-probe 的 fp_quiet）
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { __FP_QUIET__?: boolean }).__FP_QUIET__ === true
  ) {
    return
  }
  // 防止重复启动
  if (_configPollingTimer) return

  let lastIncrementalSync: boolean | null = null
  let lastSkipConflicts: boolean | null = null
  let lastEnableSyncRecord: boolean | null = null

  _configPollingTimer = setInterval(() => {
    try {
      const isCurrentIncrementalSync = isIncrementalSyncEnabled(true)
      const isCurrentSkipConflicts = isSkipConflictsEnabled(true)
      const isCurrentEnableSyncRecord = isSyncRecordEnabled(true)

      const app = getApp()
      const ribbonUI = app?.ribbonUI as WpsRibbonUI | undefined
      if (!ribbonUI) return

      if (isCurrentIncrementalSync !== lastIncrementalSync) {
        lastIncrementalSync = isCurrentIncrementalSync
        ribbonUI.InvalidateControl('chkIncrementalSync')
        bgmLog(
          LOG_LEVELS.INFO,
          `[ribbon-polling] 增量同步配置变更: ${isCurrentIncrementalSync ? '开启' : '关闭'}，已 InvalidateControl chkIncrementalSync`,
        )
      }

      if (isCurrentSkipConflicts !== lastSkipConflicts) {
        lastSkipConflicts = isCurrentSkipConflicts
        ribbonUI.InvalidateControl('chkSkipConflicts')
        bgmLog(
          LOG_LEVELS.INFO,
          `[ribbon-polling] 跳过冲突配置变更: ${isCurrentSkipConflicts ? '跳过' : 'Excel覆盖'}，已 InvalidateControl chkSkipConflicts`,
        )
      }

      if (isCurrentEnableSyncRecord !== lastEnableSyncRecord) {
        lastEnableSyncRecord = isCurrentEnableSyncRecord
        ribbonUI.InvalidateControl('chkEnableSyncRecord')
        bgmLog(
          LOG_LEVELS.INFO,
          `[ribbon-polling] 同步记录开关变更: ${isCurrentEnableSyncRecord ? '开启' : '关闭'}，已 InvalidateControl chkEnableSyncRecord`,
        )
      }
    } catch {
      // 静默处理轮询错误
    }
  }, 2000)
}

/**
 * 停止 Ribbon 配置轮询，防止内存泄漏
 */
function stopRibbonConfigPolling(): void {
  if (_configPollingTimer === null) {
    return
  }

  clearInterval(_configPollingTimer)
  _configPollingTimer = null
}

/**
 * 初始化 Ribbon 模块：注册消息监听器 + 启动配置轮询。
 *
 * postMessage 仅在同上下文（同源 iframe）中生效，
 * 轮询机制作为跨 WebView 通信的兜底方案。
 *
 * 必须由显式入口（如 `ts/entry/ribbon-entry.ts`）调用，
 * 不在模块加载时自动执行，便于在测试环境按需初始化。
 */
export function initializeRibbon(): void {
  initializeRibbonMessageListener()
  startRibbonConfigPolling()
}

/**
 * 移除 Ribbon 消息监听器 + 停止配置轮询，防止内存泄漏
 */
export function removeRibbonMessageListener(): void {
  if (_ribbonMessageHandler) {
    window.removeEventListener('message', _ribbonMessageHandler)
    _ribbonMessageHandler = null
  }
  stopRibbonConfigPolling()
}

/**
 * 获取"跳过冲突"复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetSkipConflictsPressed(_control: WpsRibbonControl): boolean {
  const isResult = isSkipConflictsEnabled()
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] GetSkipConflictsPressed: ${String(isResult)}`)
  return isResult
}

/**
 * 当"跳过冲突"复选框被点击时，保存状态
 */
export function OnSkipConflictsChange(control: WpsRibbonControl): boolean {
  const value = control.Pressed
  bgmLog(
    LOG_LEVELS.INFO,
    `[Ribbon] OnSkipConflictsChange: control.Pressed = ${String(value ?? '')}`,
  )

  // 如果 control.Pressed 是 undefined，则切换当前状态
  let isFinalValue: boolean
  if (typeof value === 'boolean') {
    isFinalValue = value
  } else {
    isFinalValue = !isSkipConflictsEnabled()
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] control.Pressed 不可用，切换状态为: ${String(isFinalValue)}`)
  }

  // 保存到 PluginStorage
  setSkipConflicts(isFinalValue)
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] 跳过冲突状态已保存到 PluginStorage: ${String(isFinalValue)}`)
  // 必须返回 boolean
  return true
}

/**
 * 获取"启用同步记录"复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetEnableSyncRecordPressed(_control: WpsRibbonControl): boolean {
  const isResult = isSyncRecordEnabled()
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] GetEnableSyncRecordPressed: ${String(isResult)}`)
  return isResult
}

/**
 * 当"启用同步记录"复选框被点击时，保存状态
 */
export function OnEnableSyncRecordChange(control: WpsRibbonControl): boolean {
  const value = control.Pressed
  bgmLog(
    LOG_LEVELS.INFO,
    `[Ribbon] OnEnableSyncRecordChange: control.Pressed = ${String(value ?? '')}`,
  )
  let isFinalValue: boolean
  if (typeof value === 'boolean') {
    isFinalValue = value
  } else {
    isFinalValue = !isSyncRecordEnabled()
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] control.Pressed 不可用，切换状态为: ${String(isFinalValue)}`)
  }
  setSyncRecordEnabled(isFinalValue)
  bgmLog(
    LOG_LEVELS.INFO,
    `[Ribbon] 启用同步记录状态已保存到 PluginStorage: ${String(isFinalValue)}`,
  )
  return true
}

/**
 * 获取增量同步复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetIncrementalSyncPressed(_control: WpsRibbonControl): boolean {
  const isResult = isIncrementalSyncEnabled()
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] GetIncrementalSyncPressed: ${String(isResult)}`)
  return isResult
}

/**
 * 当增量同步复选框被点击时，保存状态
 */
export function OnIncrementalSyncChange(control: WpsRibbonControl): boolean {
  const value = control.Pressed
  let isFinalValue: boolean
  if (typeof value === 'boolean') {
    isFinalValue = value
  } else {
    isFinalValue = !isIncrementalSyncEnabled()
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] control.Pressed 不可用，切换状态为: ${String(isFinalValue)}`)
  }
  setIncrementalSync(isFinalValue)
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] 增量同步状态已保存到 PluginStorage: ${String(isFinalValue)}`)
  return true
}

// ========== Ribbon 回调 ==========

export function OnAddinLoad(ribbonUI: WpsRibbonUI): boolean {
  const app = getApp()
  if (!app) return true
  if (typeof app.ribbonUI !== 'object') {
    app.ribbonUI = ribbonUI
  }
  if (typeof app.Enum !== 'object') {
    app.Enum = WPS_ENUM
  }
  app.PluginStorage?.setItem('EnableFlag', 'false')
  app.PluginStorage?.setItem('ApiEventFlag', 'false')
  // 检查方式 A + 事件时机 C/D/E：打开 WPS（加载项加载）时，自动识别已打开的新番表/Bangumi 数据表工作簿并持久化
  initializeWorkbookAutoDetection()
  return true
}

/**
 * 同步按钮处理器表：按钮 ID → 处理函数。
 *
 * 单一分发表。此前是「PANEL_OPENERS 映射表 + OnAction switch」两套机制并存，
 * 改错一处就静默失效；且按钮 ID 还要与 ribbon.xml 对齐。现在只剩这一张表，
 * 与 ribbon.xml 的一致性由 tests/ribbon.test.ts 的 XML 对照用例守护。
 */
const SYNC_ACTIONS: Record<string, () => unknown> = {
  btnShowPanel: showBangumiPanel,
  btnOpenSettings: showSettingsPanel,
  btnOpenEnrichPanel: showEnrichPanel,
  btnOpenCleanPanel: showCleanPanel,
  btnOpenHighlightPanel: showHighlightPanel,
  btnOpenConditionalFormatPanel: showConditionalFormatPanel,
  btnSetToken: setTokenForRibbon,
  btnSetUserId: setUserIdForRibbon,
  btnOpenCollection: openCollectionForRibbon,
}

/**
 * 异步按钮处理器表。
 *
 * OnAction 是同步回调无法 await，统一交给 runAsyncRibbonAction 用 async IIFE 消费
 * （连同步抛错一并捕获），避免每个按钮重复抄一段 try/catch。
 */
const ASYNC_ACTIONS: Record<string, () => Promise<unknown>> = {
  btnSyncBangumi: syncWithConfirmation,
  btnTestToken: testTokenForRibbon,
  btnCopyToken: copyTokenForRibbon,
  btnSyncFromGithub: syncFromGithubForRibbon,
  btnUndoLastSync: undoLastSyncForRibbon,
}

/**
 * 消费异步按钮处理器：async IIFE + 全量 try/catch
 * @param buttonId - 按钮 ID（用于日志与错误上下文）
 * @param run - 实际的异步处理函数
 */
function runAsyncRibbonAction(buttonId: string, run: () => Promise<unknown>): void {
  void (async () => {
    try {
      await run()
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : String(error)
      bgmLog(LOG_LEVELS.ERROR, `[OnAction] ${buttonId} 异常: ${message}`)
      BGM.handleError(error, {
        showAlert: true,
        level: BGM.ErrorLevel.ERROR,
        context: `Ribbon ${buttonId}`,
      })
    }
  })()
}

/**
 * 统一的 Ribbon 按钮点击处理函数
 * 根据按钮 ID 分发到具体的处理函数
 */

export function OnAction(control: { Id: string }): boolean {
  bgmLog(LOG_LEVELS.INFO, `[BGM] OnAction: ${control.Id}`)
  try {
    const syncAction = SYNC_ACTIONS[control.Id]
    if (syncAction) {
      syncAction()
      return true
    }
    const asyncAction = ASYNC_ACTIONS[control.Id]
    if (asyncAction) {
      runAsyncRibbonAction(control.Id, asyncAction)
      return true
    }
    bgmLog(LOG_LEVELS.WARN, `[BGM] 未知按钮: ${control.Id}`)
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: true,
      level: BGM.ErrorLevel.ERROR,
      context: 'Ribbon OnAction',
    })
  }
  return true
}
/**
 * 获取按钮图标：返回 SVG 文件相对路径。
 * WPS 会从加载项所在目录解析该路径并加载图片（与成功案例一致）。
 */
const ICON_PATHS: Record<string, string> = {
  btnShowPanel: 'images/panel.svg',
  btnSyncBangumi: 'images/sync.svg',
  btnSetToken: 'images/token.svg',
  btnTestToken: 'images/TestToken.svg',
  btnCopyToken: 'images/CopyToken.svg',
  btnSetUserId: 'images/user.svg',
  btnOpenCollection: 'images/link.svg',
  btnSyncFromGithub: 'images/github.svg',
  btnUndoLastSync: 'images/undo.svg',
  btnOpenSettings: 'images/settings.svg',
  btnOpenEnrichPanel: 'images/enrichPage.svg',
  btnOpenCleanPanel: 'images/cleanPage.svg',
  btnOpenHighlightPanel: 'images/highlightPage.svg',
  btnOpenConditionalFormatPanel: 'images/conditionalFormatPage.svg',
}

export function GetBangumiImage(control: { Id: string }): string {
  return ICON_PATHS[control.Id] ?? 'images/newFromTemp.svg'
}

// 通知 index.html 早期占位：真实实现已就绪
const ribbonWindow = window as unknown as RibbonWindowExtensions
ribbonWindow._bgmRibbonReady?.(OnAddinLoad, OnAction, GetBangumiImage)
// 挂载 Ribbon 复选框回调到全局（WPS Ribbon XML 只能调用 window 上的函数）
ribbonWindow.GetIncrementalSyncPressed = GetIncrementalSyncPressed
ribbonWindow.GetSkipConflictsPressed = GetSkipConflictsPressed
ribbonWindow.OnIncrementalSyncChange = OnIncrementalSyncChange
ribbonWindow.OnSkipConflictsChange = OnSkipConflictsChange
ribbonWindow.GetEnableSyncRecordPressed = GetEnableSyncRecordPressed
ribbonWindow.OnEnableSyncRecordChange = OnEnableSyncRecordChange
