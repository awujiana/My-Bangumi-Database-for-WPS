/**
 * 任务面板 - 用户信息轮询
 * @module panel/userInfoPolling
 * @description 从 PluginStorage 恢复用户信息、定时轮询 Token/用户信息/配置变更。
 *              从原 panel 模块拆分而来，保持函数签名与行为不变。
 */

import {
  LOG_LEVELS,
  getApp,
  bgmLog,
  BGM,
  loadBgToken,
  findWorkbookByName,
  _getBgmUserId,
  _getBgmUsername,
  updateTokenStatus,
  updateUserIdStatus,
  isSkipConflictsEnabled,
  isSyncRecordEnabled,
} from '../index.js'
import { eventBus, BGM_EVENTS } from '../tools/events.js'

import {
  refreshSheets,
  refreshWorkbooks,
  refreshData,
  autoDetectAndLockSheet,
} from './panel-lifecycle.js'

/**
 * 从 PluginStorage 恢复用户信息到内存缓存
 * Ribbon 设置的用户信息通过 PluginStorage 在 Ribbon 和 Panel 之间共享
 */
export function restoreUserInfoFromStorage(): void {
  try {
    const app = getApp()
    if (!app?.PluginStorage) {
      bgmLog(LOG_LEVELS.INFO, '[restoreUserInfoFromStorage] PluginStorage 不可用')
      return
    }
    const storedUserId = app.PluginStorage.getItem('bgm_user_id')
    const storedUsername = app.PluginStorage.getItem('bgm_username')

    if (storedUserId) {
      BGM.cache.userId = storedUserId
      bgmLog(LOG_LEVELS.INFO, `[restoreUserInfoFromStorage] 恢复 userId: ${storedUserId}`)
    }
    if (storedUsername) {
      BGM.cache.username = storedUsername
      bgmLog(LOG_LEVELS.INFO, `[restoreUserInfoFromStorage] 恢复 username: ${storedUsername}`)
    }
    if (storedUserId || storedUsername) {
      updateUserIdStatus()
    }
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[restoreUserInfoFromStorage] 恢复失败: ${(error as Error).message}`)
  }
}

/**
 * 定时轮询 PluginStorage 检查用户信息和 Token 变更
 * 由于 WPS 中 Ribbon 和 Panel 是独立 iframe，postMessage 无法跨上下文通信，
 * 因此 Panel 需要定期从 PluginStorage 读取最新数据并更新 UI。
 */

/**
 * 工作簿开/关/切换的统一处理防抖（ms）
 *
 * 关闭工作簿时 WPS 主进程正在销毁簿，此间的 COM 往返全部排队——
 * momo 实测：一关簿就卡，卡到「已自动检测表头」toast 才弹出来。
 * 等 300ms 让主进程腾出手再访问；连续开关多个簿也合并成一次处理。
 */
export const WORKBOOK_CHANGE_DEBOUNCE_MS = 300

export function startUserInfoPolling(): void {
  let lastUserId = BGM.cache.userId ?? null
  let lastUsername = BGM.cache.username ?? null
  let lastToken = loadBgToken()
  let lastSkipConflicts: boolean | null = null
  let lastEnableSyncRecord: boolean | null = null
  let lastPanelShownAt: string | null = null
  let lastRequestGithubSync: string | null = null
  let lastRequestUndoSync: string | null = null
  let lastWorkbookCount = -1
  let lastActiveWorkbookName: string | null = null
  // 工作簿变化的防抖态（见 scheduleWorkbookChange）
  let workbookChangeTimer: number | null = null
  let workbookChangeKind = ''
  let workbookChangeDetectedAt = 0

  /**
   * 统一处理「工作簿开/关/切换」（数量与活动簿两个检测源共用）
   *
   * 性能日志分段打：防抖等待 / 列表刷新 / 检测锁定，出卡顿时段直接看哪段贵。
   */
  const handleWorkbookChange = (kind: string, detectedAt: number): void => {
    const waited = Math.round(performance.now() - detectedAt)
    const listStart = performance.now()
    bgmLog(LOG_LEVELS.INFO, `[perf] 工作簿变化处理开始（${kind}，防抖等待 ${String(waited)}ms）`)
    refreshWorkbooks()
    refreshSheets({ autoSelectActive: true })
    // 锁定态下绝大多数开/关都是「别的簿」：目标还在 → 不 force，
    // autoDetectAndLockSheet 内部对锁定态短路，整条检测链直接跳过。
    // 关掉的正是锁定目标 → force 重检测（否则同步按钮指向已消失的表）。
    const lockedName = BGM.sheet.lockedWorkbookName
    const shouldForce =
      BGM.sheet.isLocked && lockedName !== null && findWorkbookByName(lockedName) === null
    if (shouldForce) {
      bgmLog(LOG_LEVELS.WARN, `[perf] 锁定的工作簿「${lockedName}」已关闭，强制重新检测`)
    }
    const detectStart = performance.now()
    autoDetectAndLockSheet(shouldForce ? { force: true } : {})
    // 性能日志（momo：审查性能参数）：防抖等待 / 列表刷新 / 检测锁定三段
    const listMs = Math.round(detectStart - listStart)
    const detectMs = Math.round(performance.now() - detectStart)
    bgmLog(
      LOG_LEVELS.INFO,
      `[perf] 工作簿变化处理完成（${kind}）：列表 ${String(listMs)}ms + 检测 ${String(detectMs)}ms`,
    )
  }

  /** 登记一次工作簿变化并（重）排防抖；连续变化只处理最后一次 */
  const scheduleWorkbookChange = (kind: string): void => {
    if (workbookChangeDetectedAt === 0) workbookChangeDetectedAt = performance.now()
    workbookChangeKind = kind
    if (workbookChangeTimer !== null) clearTimeout(workbookChangeTimer)
    // 裸 setTimeout 而非 window.setTimeout：jsdom 下 window 自带一份实现，
    // vitest fake timers 替换不了它，防抖在测试里永远不触发（真机无差别）。
    workbookChangeTimer = setTimeout(() => {
      workbookChangeTimer = null
      const detectedAt = workbookChangeDetectedAt
      workbookChangeDetectedAt = 0
      handleWorkbookChange(workbookChangeKind, detectedAt)
    }, WORKBOOK_CHANGE_DEBOUNCE_MS)
  }

  // 单次轮询逻辑（从 setInterval 回调中上提，避免每次 tick 重建闭包）
  const pollOnce = (): void => {
    const app = getApp()
    // 检测工作簿数量变化：打开/关闭新工作簿时自动刷新列表并检测表头
    const currentWorkbookCount = app?.Workbooks?.Count ?? 0
    if (lastWorkbookCount === -1) {
      lastWorkbookCount = currentWorkbookCount
    } else if (currentWorkbookCount !== lastWorkbookCount) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[startUserInfoPolling] 检测到工作簿数量变化: ${String(lastWorkbookCount)} → ${String(currentWorkbookCount)}（打开新工作簿或关闭）`,
      )
      lastWorkbookCount = currentWorkbookCount
      // 防抖后统一处理：关闭簿的瞬间 COM 全在排队，立即访问就是卡顿源
      scheduleWorkbookChange('workbook-count')
    }

    // 检测活动工作簿切换（用户直接在 WPS 中切换不同工作簿）
    const activeWbName = app?.ActiveWorkbook?.Name ?? null
    if (lastActiveWorkbookName === null) {
      lastActiveWorkbookName = activeWbName
    } else if (activeWbName !== lastActiveWorkbookName) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[startUserInfoPolling] 检测到活动工作簿切换: ${lastActiveWorkbookName} → ${activeWbName ?? ''}`,
      )
      lastActiveWorkbookName = activeWbName
      scheduleWorkbookChange('active-workbook')
    }

    const currentUserId = _getBgmUserId()
    const currentUsername = _getBgmUsername()
    const currentToken = loadBgToken()

    const isUserInfoChanged = currentUserId !== lastUserId || currentUsername !== lastUsername
    const isTokenChanged = currentToken !== lastToken

    if (isUserInfoChanged) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[startUserInfoPolling] 检测到用户信息变更: userId=${currentUserId || '(无)'}, username=${currentUsername || '(无)'}`,
      )
      lastUserId = currentUserId
      lastUsername = currentUsername
      if (currentUserId) BGM.cache.userId = currentUserId
      if (currentUsername) BGM.cache.username = currentUsername
      updateUserIdStatus()
    }

    if (isTokenChanged) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[startUserInfoPolling] 检测到 Token 变更: ${currentToken ? '已设置' : '已清除'}`,
      )
      lastToken = currentToken
      if (!currentToken) {
        BGM.cache.userId = null
        BGM.cache.username = null
      }
      updateTokenStatus()
      updateUserIdStatus()
    }

    // 同步 Ribbon 的配置变更到 Panel UI（跳过冲突，静默读取避免日志刷屏）
    // 增量同步没有这一步：panel.html 的「仅同步变更」复选框已收拢到「设置」页
    // （见 panel.html 的说明文案），主面板不再有 #chkIncremental 控件，
    // 保留该分支只会永久走进「元素不存在」的空转。
    const isCurrentSkipConflicts = isSkipConflictsEnabled(true)

    if (isCurrentSkipConflicts !== lastSkipConflicts) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[startUserInfoPolling] 检测到跳过冲突配置变更: ${isCurrentSkipConflicts ? '跳过' : 'Excel覆盖'}`,
      )
      lastSkipConflicts = isCurrentSkipConflicts
      const conflictStrategySelect = document.getElementById(
        'conflictStrategy',
      ) as HTMLSelectElement | null
      if (conflictStrategySelect) {
        conflictStrategySelect.value = isCurrentSkipConflicts ? 'skip' : 'excel'
        bgmLog(
          LOG_LEVELS.INFO,
          `[startUserInfoPolling] 冲突策略 select 已同步: ${conflictStrategySelect.value}`,
        )
      }
    }

    const isCurrentEnableSyncRecord = isSyncRecordEnabled(true)
    if (isCurrentEnableSyncRecord !== lastEnableSyncRecord) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[startUserInfoPolling] 检测到同步记录开关变更: ${isCurrentEnableSyncRecord ? '开启' : '关闭'}`,
      )
      lastEnableSyncRecord = isCurrentEnableSyncRecord
      const chkEnableSyncRecord = document.getElementById(
        'chkEnableSyncRecord',
      ) as HTMLInputElement | null
      if (chkEnableSyncRecord) {
        chkEnableSyncRecord.checked = isCurrentEnableSyncRecord
        bgmLog(
          LOG_LEVELS.INFO,
          `[startUserInfoPolling] 启用同步记录 checkbox 已同步: ${isCurrentEnableSyncRecord ? '开启' : '关闭'}`,
        )
      }
    }

    // 检测面板显示信号：Ribbon 点击"打开同步面板"时会写入 bgm_panel_shown_at 时间戳
    const currentPanelShownAt = app?.PluginStorage?.getItem('bgm_panel_shown_at') ?? null
    if (currentPanelShownAt && currentPanelShownAt !== lastPanelShownAt) {
      bgmLog(LOG_LEVELS.INFO, `[startUserInfoPolling] 检测到面板显示信号: ${currentPanelShownAt}`)
      lastPanelShownAt = currentPanelShownAt
      // 自动刷新工作簿列表 + 工作表（匹配当前活动工作表）+ 刷新数据预览
      refreshWorkbooks()
      refreshSheets({ autoSelectActive: true })
      refreshData()
    }

    // 检测数据同步请求信号：Ribbon 点击"btnSyncFromGithub"时写入 bgm_request_github_sync 时间戳
    // panel 检测到后通过内部 eventBus 触发 syncFromGithub handler（显示模块化进度弹窗）
    const currentRequestGithubSync = app?.PluginStorage?.getItem('bgm_request_github_sync') ?? null
    if (currentRequestGithubSync && currentRequestGithubSync !== lastRequestGithubSync) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[startUserInfoPolling] 检测到数据同步请求信号: ${currentRequestGithubSync}`,
      )
      lastRequestGithubSync = currentRequestGithubSync
      // 通过 panel 内部 eventBus 触发 handlers/index.ts 中的监听器
      // handlers 监听器会调用 ACTION_HANDLERS['syncFromGithub'] 显示进度弹窗
      eventBus.emit(BGM_EVENTS.REQUEST_GITHUB_SYNC, undefined)
    }

    // 检测撤销同步请求信号：Ribbon 点击"btnUndoLastSync"时写入 bgm_request_undo_sync 时间戳
    // panel 检测到后通过内部 eventBus 触发 undoLastSync handler（包含确认对话框和恢复操作）
    const currentRequestUndoSync = app?.PluginStorage?.getItem('bgm_request_undo_sync') ?? null
    if (currentRequestUndoSync && currentRequestUndoSync !== lastRequestUndoSync) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[startUserInfoPolling] 检测到撤销同步请求信号: ${currentRequestUndoSync}`,
      )
      lastRequestUndoSync = currentRequestUndoSync
      // 通过 panel 内部 eventBus 触发 handlers/index.ts 中的监听器
      // handlers 监听器会调用 ACTION_HANDLERS['undoLastSync'] 弹出确认对话框并执行撤销
      eventBus.emit(BGM_EVENTS.REQUEST_UNDO_LAST_SYNC, undefined)
    }
  }

  const pollingInterval = setInterval(() => {
    try {
      pollOnce()
    } catch {
      // 静默处理轮询错误
    }
    // 每2秒轮询一次
  }, 2000)

  // 面板关闭时清理定时器
  window.addEventListener('beforeunload', () => {
    clearInterval(pollingInterval)
    // 取消所有关联到全局 AbortController 的 HTTP 请求，防止状态更新到已卸载组件
    BGM.abortController.abort()
  })
}
