/**
 * Ribbon 模块
 * @module ribbon
 * @description WPS Office 功能区按钮回调处理
 */

import * as RibbonService from './services/ribbonService.js'

import {
  WPS_ENUM,
  showBangumiPanel,
  BGM,
  getIncrementalSync,
  getSkipConflicts,
  setIncrementalSync,
  setSkipConflicts,
  getSyncRecordEnabled,
  setSyncRecordEnabled,
  bgmLog,
  LOG_LEVELS,
  getApp,
} from './index.js'

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

// 在 Ribbon 启动时通过 initRibbon() 显式注册（不在模块加载时自动执行）
// 【正确】监听侧边栏发来的配置更新，刷新 Ribbon UI
let _ribbonMessageHandler: ((event: MessageEvent) => void) | null = null

function initRibbonMessageListener(): void {
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
    const data = event.data
    if (data?.type === 'BGM:configUpdated') {
      const key = data.data?.key
      const controlIdMap: Record<string, string> = {
        bgm_incremental_sync: 'chkIncrementalSync',
        bgm_skip_conflicts: 'chkSkipConflicts',
        bgm_enable_sync_record: 'chkEnableSyncRecord',
      }
      const controlId = controlIdMap[key as string]
      if (controlId) {
        const app = getApp()
        const ribbonUI = app?.ribbonUI as WpsRibbonUI | undefined
        if (ribbonUI) {
          ribbonUI.InvalidateControl(controlId)
          bgmLog(
            LOG_LEVELS.INFO,
            `[ribbon-message] 已 InvalidateControl ${controlId} (config key=${key})`,
          )
        } else {
          bgmLog(LOG_LEVELS.WARN, `[ribbon-message] ribbonUI 不可用，无法刷新 ${controlId}`)
        }
      }
    }
  }
  window.addEventListener('message', _ribbonMessageHandler)
}

// ========== PluginStorage 配置轮询（Ribbon ↔ Taskpane 跨 WebView 同步）==========
// WPS 中 Ribbon 和 Taskpane 是独立 WebView，postMessage 无法跨上下文通信。
// Taskpane 侧通过 userInfoPolling 轮询 PluginStorage 同步 Ribbon 的变更，
// Ribbon 侧也需要同等轮询机制，定期检查 Taskpane 写入的配置变更并刷新按钮状态。

let _configPollingTimer: ReturnType<typeof setInterval> | null = null

/**
 * 启动 Ribbon 配置轮询：每 2 秒检查 PluginStorage 中配置值的变化，
 * 发现变化时调用 InvalidateControl 刷新 Ribbon 按钮状态。
 *
 * 需要与 Taskpane 的 startUserInfoPolling（2 秒间隔）保持一致，
 * 确保双边同步延迟在 2 秒以内。
 */
function startRibbonConfigPolling(): void {
  // 防止重复启动
  if (_configPollingTimer) return

  let lastIncrementalSync: boolean | null = null
  let lastSkipConflicts: boolean | null = null
  let lastEnableSyncRecord: boolean | null = null

  _configPollingTimer = setInterval(() => {
    try {
      const currentIncrementalSync = getIncrementalSync(true)
      const currentSkipConflicts = getSkipConflicts(true)
      const currentEnableSyncRecord = getSyncRecordEnabled(true)

      const app = getApp()
      const ribbonUI = app?.ribbonUI as WpsRibbonUI | undefined
      if (!ribbonUI) return

      if (currentIncrementalSync !== lastIncrementalSync) {
        lastIncrementalSync = currentIncrementalSync
        ribbonUI.InvalidateControl('chkIncrementalSync')
        bgmLog(
          LOG_LEVELS.INFO,
          `[ribbon-polling] 增量同步配置变更: ${currentIncrementalSync ? '开启' : '关闭'}，已 InvalidateControl chkIncrementalSync`,
        )
      }

      if (currentSkipConflicts !== lastSkipConflicts) {
        lastSkipConflicts = currentSkipConflicts
        ribbonUI.InvalidateControl('chkSkipConflicts')
        bgmLog(
          LOG_LEVELS.INFO,
          `[ribbon-polling] 跳过冲突配置变更: ${currentSkipConflicts ? '跳过' : 'Excel覆盖'}，已 InvalidateControl chkSkipConflicts`,
        )
      }

      if (currentEnableSyncRecord !== lastEnableSyncRecord) {
        lastEnableSyncRecord = currentEnableSyncRecord
        ribbonUI.InvalidateControl('chkEnableSyncRecord')
        bgmLog(
          LOG_LEVELS.INFO,
          `[ribbon-polling] 同步记录开关变更: ${currentEnableSyncRecord ? '开启' : '关闭'}，已 InvalidateControl chkEnableSyncRecord`,
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
  if (_configPollingTimer !== null) {
    clearInterval(_configPollingTimer)
    _configPollingTimer = null
  }
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
export function initRibbon(): void {
  initRibbonMessageListener()
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
  const result = getSkipConflicts()
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] GetSkipConflictsPressed: ${result}`)
  return result
}

/**
 * 当"跳过冲突"复选框被点击时，保存状态
 */
export function OnSkipConflictsChange(control: WpsRibbonControl): boolean {
  const newValue = control.Pressed
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] OnSkipConflictsChange: control.Pressed = ${newValue}`)

  // 如果 control.Pressed 是 undefined，则切换当前状态
  let finalValue: boolean
  if (typeof newValue === 'boolean') {
    finalValue = newValue
  } else {
    finalValue = !getSkipConflicts()
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] control.Pressed 不可用，切换状态为: ${finalValue}`)
  }

  // 保存到 PluginStorage
  setSkipConflicts(finalValue)
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] 跳过冲突状态已保存到 PluginStorage: ${finalValue}`)
  return true // 必须返回 boolean
}

/**
 * 获取"启用同步记录"复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetEnableSyncRecordPressed(_control: WpsRibbonControl): boolean {
  const result = getSyncRecordEnabled()
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] GetEnableSyncRecordPressed: ${result}`)
  return result
}

/**
 * 当"启用同步记录"复选框被点击时，保存状态
 */
export function OnEnableSyncRecordChange(control: WpsRibbonControl): boolean {
  const newValue = control.Pressed
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] OnEnableSyncRecordChange: control.Pressed = ${newValue}`)
  let finalValue: boolean
  if (typeof newValue === 'boolean') {
    finalValue = newValue
  } else {
    finalValue = !getSyncRecordEnabled()
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] control.Pressed 不可用，切换状态为: ${finalValue}`)
  }
  setSyncRecordEnabled(finalValue)
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] 启用同步记录状态已保存到 PluginStorage: ${finalValue}`)
  return true
}

/**
 * 获取增量同步复选框的初始按下状态
 * 从配置读取上次保存的设置，默认未选中
 */
export function GetIncrementalSyncPressed(_control: WpsRibbonControl): boolean {
  const result = getIncrementalSync()
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] GetIncrementalSyncPressed: ${result}`)
  return result
}

/**
 * 当增量同步复选框被点击时，保存状态
 */
export function OnIncrementalSyncChange(control: WpsRibbonControl): boolean {
  const newValue = control.Pressed
  let finalValue: boolean
  if (typeof newValue === 'boolean') {
    finalValue = newValue
  } else {
    finalValue = !getIncrementalSync()
    bgmLog(LOG_LEVELS.INFO, `[Ribbon] control.Pressed 不可用，切换状态为: ${finalValue}`)
  }
  setIncrementalSync(finalValue)
  bgmLog(LOG_LEVELS.INFO, `[Ribbon] 增量同步状态已保存到 PluginStorage: ${finalValue}`)
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
  return true
}

/**
 * 统一的 Ribbon 按钮点击处理函数
 * 根据按钮 ID 分发到具体的处理函数
 */

export function OnAction(control: { Id: string }): boolean {
  bgmLog(LOG_LEVELS.INFO, `[BGM] OnAction: ${control.Id}`)
  try {
    switch (control.Id) {
      case 'btnShowPanel':
        showBangumiPanel()
        break
      case 'btnSyncBangumi': {
        // syncWithConfirmation 是 async 函数，需要 .catch() 防止未处理的 Promise rejection
        RibbonService.syncWithConfirmation().catch((e: unknown) => {
          bgmLog(
            LOG_LEVELS.ERROR,
            `[OnAction] syncWithConfirmation 异常: ${(e as Error)?.message || String(e)}`,
          )
          BGM.handleError(e, {
            showAlert: true,
            level: BGM.ErrorLevel.ERROR,
            context: 'Ribbon btnSyncBangumi',
          })
        })
        break
      }
      case 'btnSetToken':
        RibbonService.setTokenForRibbon()
        break
      case 'btnTestToken': {
        // testTokenForRibbon 是 async 函数，需 .catch() 防止未处理 rejection
        RibbonService.testTokenForRibbon().catch((e: unknown) => {
          bgmLog(
            LOG_LEVELS.ERROR,
            `[OnAction] testTokenForRibbon 异常: ${(e as Error)?.message || String(e)}`,
          )
          BGM.handleError(e, {
            showAlert: true,
            level: BGM.ErrorLevel.ERROR,
            context: 'Ribbon btnTestToken',
          })
        })
        break
      }
      case 'btnCopyToken': {
        // copyTokenForRibbon 是 async 函数，需 .catch() 防止未处理 rejection
        RibbonService.copyTokenForRibbon().catch((e: unknown) => {
          bgmLog(
            LOG_LEVELS.ERROR,
            `[OnAction] copyTokenForRibbon 异常: ${(e as Error)?.message || String(e)}`,
          )
          BGM.handleError(e, {
            showAlert: true,
            level: BGM.ErrorLevel.ERROR,
            context: 'Ribbon btnCopyToken',
          })
        })
        break
      }
      case 'btnSetUserId':
        RibbonService.setUserIdForRibbon()
        break
      case 'btnOpenCollection':
        RibbonService.openCollectionForRibbon()
        break
      case 'btnSyncFromGithub': {
        // syncFromGithubForRibbon 是 async 函数，需 .catch() 防止未处理 rejection
        RibbonService.syncFromGithubForRibbon().catch((e: unknown) => {
          bgmLog(
            LOG_LEVELS.ERROR,
            `[OnAction] syncFromGithubForRibbon 异常: ${(e as Error)?.message || String(e)}`,
          )
          BGM.handleError(e, {
            showAlert: true,
            level: BGM.ErrorLevel.ERROR,
            context: 'Ribbon btnSyncFromGithub',
          })
        })
        break
      }
      case 'btnUndoLastSync': {
        // undoLastSyncForRibbon 是 async 函数，需 .catch() 防止未处理 rejection
        RibbonService.undoLastSyncForRibbon().catch((e: unknown) => {
          bgmLog(
            LOG_LEVELS.ERROR,
            `[OnAction] undoLastSyncForRibbon 异常: ${(e as Error)?.message || String(e)}`,
          )
          BGM.handleError(e, {
            showAlert: true,
            level: BGM.ErrorLevel.ERROR,
            context: 'Ribbon btnUndoLastSync',
          })
        })
        break
      }
      default:
        bgmLog(LOG_LEVELS.WARN, `[BGM] 未知按钮: ${control.Id}`)
    }
  } catch (e: unknown) {
    BGM.handleError(e, { showAlert: true, level: BGM.ErrorLevel.ERROR, context: 'Ribbon OnAction' })
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
  btnClearColors: 'images/btnClearColors.svg',
  btnSyncFromGithub: 'images/github.svg',
  btnUndoLastSync: 'images/undo.svg',
}

export function GetBangumiImage(control: { Id: string }): string {
  return ICON_PATHS[control.Id] || 'images/newFromTemp.svg'
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
