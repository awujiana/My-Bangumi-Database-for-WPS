/**
 * UI 事件处理模块 - 入口与聚合
 * @module ui/handlers/index
 * @description 资源追踪、按钮监听、ACTION_HANDLERS 分发、消息监听、事件总线监听、
 *              配置 UI 回填等。同时 re-export 子模块的公开 API，保持原 handlers.ts 的外部接口。
 */

import {
  LOG_LEVELS,
  bgmLog,
  BGM,
  loadBgToken,
  storeBgToken,
  clearBgToken,
  copyTokenToClipboard,
  _setBgmUserId,
  _getBgmUserId,
  _setBgmUsername,
  getApp,
  getLastRow,
  getSyncRecordSheetIfExists,
  showAlert,
  showConfirm,
  showInput,
  showToast,
  refreshData,
  refreshSheets,
  refreshWorkbooks,
  toggleSheetLock,
  enlargePreview,
  clearSyncRecords,
  deduplicateSyncRecords,
  formatSyncRecordSheet,
  openSyncRecordSheet,
  closeDetailModal,
  previewSyncContent,
  syncSelectedRows,
  openBangumiTokenPage,
  setSyncRecordEnabled,
  getSyncRecordEnabled,
  getIncrementalSync,
  setIncrementalSync,
  getSkipConflicts,
  setSkipConflicts,
  setNavIconsOnly,
  getTheme,
  setListType,
  getListType,
  setTimeFilter,
  getTimeFilter,
  setRefreshInterval,
  getRefreshInterval,
  saveTheme,
  getGithubConfig,
  setGithubConfig,
  isGithubConfigComplete,
  getSyncStrategy,
  setSyncStrategy,
  getSyncSourceType,
  setSyncSourceType,
  syncFromRemote,
  buildRawUrl,
  showSyncProgressDialog,
  buildSyncConfig,
  updateSyncProgressDialog,
  completeSyncProgressDialog,
  hideSyncProgressDialog,
  showSyncResultDialog,
  formatDuration,
  showSettingsPanel,
} from '../../index.js'
import type {
  BuildSyncConfigContext,
  SyncProgressStats,
  SyncResultDialogOptions,
  SyncStrategy,
  SyncSourceType,
  GithubSyncResult,
  GithubSyncDetailItem,
  SyncTimeFilter,
} from '../../index.js'
import { exportConfig, importConfig } from '../../services/configService.js'
import { executeUndoLastSync } from '../../services/ribbonService.js'
import { debounce } from '../../tools/debounce.js'
import { BGM_EVENTS, eventBus } from '../../tools/events.js'
import type { EventHandler } from '../../tools/events.js'
import { getRecentLogs, exportLogsToFile, clearLogs } from '../../tools/logger.js'
import type { LogLevel } from '../../tools/logger.js'
import { showConnectionTestDialog, hideConnectionTestDialog } from '../githubConfigDialog.js'

// 子模块
import { _T } from './_constants.js'
import { cleanLockedDataSheet } from './sheet.js'
import { syncFromPanel, syncCollectionFromBgm } from './sync.js'
import {
  showTokenDialog,
  showUserIdDialog,
  updateTokenStatus,
  updateUserIdStatus,
  openUserCollection,
  testTokenValidity,
  testDebugConnection,
} from './token.js'

// 子模块 re-export（保持原 handlers.ts 的对外 API）
export {
  showTokenDialog,
  showUserIdDialog,
  updateTokenStatus,
  updateUserIdStatus,
  openUserCollection,
  testTokenValidity,
  testDebugConnection,
  showUserProfile,
  hideUserProfile,
  // renewToken 已标记 @deprecated（内部委托给 testTokenValidity），此处为保持对外 API 而必须保留 re-export
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  renewToken,
} from './token.js'
export { syncFromPanel, syncCollectionFromBgm, syncFromBgmByAPI } from './sync.js'
export { cleanLockedDataSheet } from './sheet.js'

// 连接测试弹窗
export { showConnectionTestDialog, hideConnectionTestDialog }

// ========== 模块级资源追踪（防止事件监听器与定时器泄漏） ==========
const _pendingTimeouts = new Set<ReturnType<typeof setTimeout>>()

/**
 * 受追踪的 setTimeout：将 timeoutId 加入模块级 Set，便于统一清理。
 * 回调执行时自动从 Set 中移除。
 */
function trackedSetTimeout(function_: () => void, delay: number): ReturnType<typeof setTimeout> {
  const id = setTimeout(() => {
    _pendingTimeouts.delete(id)
    function_()
  }, delay)
  _pendingTimeouts.add(id)
  return id
}

/**
 * 清理所有仍在等待的 setTimeout，防止面板关闭后回调仍被触发。
 */
export function clearAllPendingTimeouts(): void {
  for (const id of _pendingTimeouts) {
    clearTimeout(id)
  }
  _pendingTimeouts.clear()
}

// ========== 模块级 DOM / 事件总线监听器追踪（防止重复注册与内存泄漏） ==========

interface TrackedDomListener {
  kind: 'dom'
  element: EventTarget
  type: string
  handler: EventListenerOrEventListenerObject
}

interface TrackedBusListener {
  kind: 'eventBus'
  eventName: string
  handler: EventHandler
}

type TrackedListener = TrackedDomListener | TrackedBusListener

const _trackedListeners: TrackedListener[] = []

/**
 * 清理所有已追踪的监听器。
 * 在 initHandlers 重新初始化前调用，防止同一面板内重复注册。
 */
function clearTrackedListeners(): void {
  for (const item of _trackedListeners) {
    if (item.kind === 'dom') {
      item.element.removeEventListener(item.type, item.handler)
    } else {
      eventBus.off(item.eventName, item.handler)
    }
  }
  _trackedListeners.length = 0
}

/**
 * 受追踪的 addEventListener：自动记录，便于统一清理。
 */
function trackedAddEventListener(
  element: EventTarget,
  type: string,
  handler: EventListenerOrEventListenerObject,
): void {
  element.addEventListener(type, handler)
  _trackedListeners.push({ kind: 'dom', element, type, handler })
}

/**
 * 受追踪的 eventBus.on：自动记录，便于统一清理。
 */
function trackedEventBusOn<T = unknown>(eventName: string, handler: EventHandler<T>): void {
  eventBus.on(eventName, handler)
  _trackedListeners.push({ kind: 'eventBus', eventName, handler: handler as EventHandler })
}

// ========== 面板操作分发 ==========

export function onAction(action: string): void {
  switch (action) {
    case 'sync': {
      void syncFromPanel()
      break
    }
    case 'clear': {
      showConfirm(_T.confirmClearMarks, (confirmed) => {
        if (confirmed) {
          if (typeof refreshData === 'function') refreshData()
        }
      })
      break
    }
    case 'setToken': {
      showTokenDialog(loadBgToken() ?? '')
      break
    }
    case 'preview': {
      if (typeof previewSyncContent === 'function') void previewSyncContent()
      break
    }
    case 'showUserIdDialog': {
      showUserIdDialog()
      break
    }
    case 'showClearConfirm': {
      showConfirm(_T.confirmClearMarks, (confirmed) => {
        if (confirmed) {
          if (typeof refreshData === 'function') refreshData()
        }
      })
      break
    }
    case 'tokenUpdated': {
      updateTokenStatus()
      break
    }
    case 'userIdUpdated': {
      updateUserIdStatus()
      break
    }
    case 'requestStopSync': {
      bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求停止同步')
      BGM.sync.requestStop()
      break
    }
    case 'pauseSync': {
      bgmLog(LOG_LEVELS.INFO, '用户请求暂停同步')
      BGM.sync.pause()
      break
    }
    case 'resumeSync': {
      bgmLog(LOG_LEVELS.INFO, '用户请求恢复同步')
      BGM.sync.resume()
      break
    }
  }
}

// ========== 事件处理器（模块级，便于追踪与去重） ==========

const handleEnableSyncRecordChange = (): void => {
  const chkEnableSyncRecord = document.getElementById(
    'chkEnableSyncRecord',
  ) as HTMLInputElement | null
  if (!chkEnableSyncRecord) return
  const { checked } = chkEnableSyncRecord
  bgmLog(LOG_LEVELS.INFO, `[handlers] 启用同步记录开关切换: ${checked ? '开启' : '关闭'}`)
  setSyncRecordEnabled(checked)
  showToast(checked ? '已启用同步记录功能' : '已关闭同步记录功能', 'info')
}

const handleLogLevelFilterChange = (): void => {
  renderLogEntries()
}

// ========== 设置页：外观主题 / 列表类型 / 时间筛选 / 刷新间隔 ==========

/** 同步主题预览卡片的 active 高亮 */
function updateThemePreview(mode: string): void {
  document.querySelectorAll<HTMLElement>('[data-theme-card]').forEach((card) => {
    card.classList.toggle('active', card.dataset.themeCard === mode)
  })
}

const handleThemeChange = (): void => {
  const select = document.getElementById('themeSelect') as HTMLSelectElement | null
  const mode = select?.value || 'dark'
  // 乐观更新预览卡片，即使持久化失败也保持视觉一致
  updateThemePreview(mode)
  const isOk = saveTheme(mode)
  if (isOk) {
    const labels: Record<string, string> = {
      dark: '深色模式',
      light: '浅色模式',
      system: '跟随系统',
    }
    showToast(`主题已切换为「${labels[mode] || mode}」`, 'success')
  } else {
    showToast('主题保存失败', 'error')
  }
}

const handleThemePreviewClick = (event: Event): void => {
  const card = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-theme-card]')
  const mode = card?.dataset.themeCard
  if (!mode) return
  const select = document.getElementById('themeSelect') as HTMLSelectElement | null
  if (select) select.value = mode
  handleThemeChange()
}

const handleListTypeChange = (): void => {
  const select = document.getElementById('listTypeSelect') as HTMLSelectElement | null
  if (!select) return
  const isOk = setListType(select.value)
  if (isOk) {
    const labels: Record<string, string> = {
      all: '全部收藏',
      collect: '已看',
      wish: '想看',
      do: '在看',
    }
    showToast(`默认收藏列表类型：${labels[select.value] || select.value}`, 'success')
  } else {
    showToast('收藏列表类型保存失败', 'error')
  }
}

const handleTimeFilterChange = (): void => {
  const select = document.getElementById('timeFilterSelect') as HTMLSelectElement | null
  if (!select) return
  const isOk = setTimeFilter(select.value)
  if (isOk) {
    const labels: Record<string, string> = {
      all: '全部时间',
      year: '全年',
      quarter: '季度新番',
      month: '月份',
      future: '预告 / 未来',
    }
    showToast(`默认时间筛选范围：${labels[select.value] || select.value}`, 'success')
  } else {
    showToast('时间筛选范围保存失败', 'error')
  }
}

const handleRefreshIntervalChange = (): void => {
  const input = document.getElementById('refreshIntervalInput') as HTMLInputElement | null
  if (!input) return
  const raw = input.value.trim()
  if (raw === '') {
    input.value = String(getRefreshInterval(true))
    return
  }
  const minutes = Number(raw)
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    showToast('刷新间隔需为 0–1440 之间的整数（分钟）', 'warn')
    input.value = String(getRefreshInterval(true))
    return
  }
  const isOk = setRefreshInterval(minutes)
  if (isOk) {
    const value = Math.round(minutes)
    showToast(
      `自动刷新间隔已设为 ${String(value)} 分钟${value === 0 ? '（已关闭）' : ''}`,
      'success',
    )
  } else {
    showToast('刷新间隔保存失败', 'error')
  }
}

/**
 * GitHub 配置输入框防抖自动保存（300ms）。
 * 每次从 DOM 实时读取值，避免闭包持有过时的元素引用。
 */
const debouncedSaveGithubConfig = debounce((): void => {
  try {
    const ownerInput = document.getElementById('githubOwner') as HTMLInputElement | null
    const repoInput = document.getElementById('githubRepo') as HTMLInputElement | null
    const branchInput = document.getElementById('githubBranch') as HTMLInputElement | null
    const pathInput = document.getElementById('githubPath') as HTMLInputElement | null
    const localFilePathInput = document.getElementById('localFilePath') as HTMLInputElement | null
    const gistIdInput = document.getElementById('gistId') as HTMLInputElement | null
    const strategySelect = document.getElementById('githubStrategy') as HTMLSelectElement | null
    const sourceTypeSelect = document.getElementById('syncSourceType') as HTMLSelectElement | null

    const owner = (ownerInput?.value ?? '').trim()
    const repo = (repoInput?.value ?? '').trim()
    const branch = (branchInput?.value ?? '').trim() || 'main'
    const strategy = (strategySelect?.value as SyncStrategy | undefined) ?? 'add-update'
    const sourceType = (sourceTypeSelect?.value as SyncSourceType | undefined) ?? 'github'

    // 按数据源类型读取对应字段值
    // - local: 复用 githubConfig.path 字段存储本地文件路径（与远程源 path 字段互斥复用）
    // - gist: 使用独立的 gistId 字段
    // - github/gitlab/gitee: 使用 owner/repo/branch/path
    let path: string
    let gistId: string | undefined
    if (sourceType === 'local') {
      path = (localFilePathInput?.value ?? '').trim()
    } else {
      path = (pathInput?.value ?? '').trim()
    }
    if (sourceType === 'gist') {
      gistId = (gistIdInput?.value ?? '').trim() || undefined
    }

    // 必填项校验：用户可能正在输入，未完成时跳过自动保存
    if (sourceType === 'local') {
      if (!path) return
    } else if (sourceType === 'gist') {
      if (!gistId) return
    } else if (!owner || !repo || !path) return

    const isOkConfig = setGithubConfig({ owner, repo, branch, path, sourceType, gistId })
    const isOkStrategy = setSyncStrategy(strategy)
    const isOkSourceType = setSyncSourceType(sourceType)
    if (isOkConfig && isOkStrategy && isOkSourceType) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[handlers] GitHub 配置已自动保存: ${owner}/${repo}/${branch}/${path}, 策略: ${strategy}, 同步源: ${sourceType}${gistId ? `, gistId: ${gistId}` : ''}`,
      )
    }
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[handlers] GitHub 配置自动保存失败: ${(error as Error).message}`)
  }
}, 300)

/**
 * 按同步源类型切换 UI 字段显示/隐藏
 *
 * - github/gitlab/gitee: 显示 owner/repo/branch/path（#remoteSourceFields）
 * - local: 显示本地文件路径输入框 + 选择按钮（#localFileFields）
 * - gist: 显示 gistId 输入框（#gistFields）
 *
 * @param sourceType 同步源类型
 */
function toggleSourceFields(sourceType: SyncSourceType): void {
  const remoteFields = document.getElementById('remoteSourceFields')
  const localFields = document.getElementById('localFileFields')
  const gistFields = document.getElementById('gistFields')
  if (remoteFields) {
    remoteFields.style.display = sourceType === 'local' || sourceType === 'gist' ? 'none' : ''
  }
  if (localFields) {
    localFields.style.display = sourceType === 'local' ? '' : 'none'
  }
  if (gistFields) {
    gistFields.style.display = sourceType === 'gist' ? '' : 'none'
  }
}

// ========== 事件监听 ==========

export function setupButtonListeners(): void {
  document.querySelectorAll('[data-action]').forEach((button) => {
    trackedAddEventListener(button, 'click', handleActionClick)
  })

  // 启用同步记录 开关：从 config 读取初始状态 + 注册 change 监听器
  const chkEnableSyncRecord = document.getElementById(
    'chkEnableSyncRecord',
  ) as HTMLInputElement | null
  if (chkEnableSyncRecord) {
    // 从 config 读取初始状态（与 chkIncremental/chkSkipConflicts 一致的双向同步机制）
    try {
      const isEnabled = getSyncRecordEnabled()
      chkEnableSyncRecord.checked = isEnabled
      bgmLog(LOG_LEVELS.INFO, `[handlers] 从配置读取同步记录状态: ${isEnabled ? '开启' : '关闭'}`)
    } catch (error: unknown) {
      bgmLog(LOG_LEVELS.WARN, `[handlers] 读取同步记录状态失败: ${(error as Error).message}`)
    }
    trackedAddEventListener(chkEnableSyncRecord, 'change', handleEnableSyncRecordChange)
    bgmLog(LOG_LEVELS.INFO, '[handlers] 启用同步记录 checkbox 监听器已注册')
  }

  // GitHub 配置：面板加载时自动填充已保存的值（含策略与同步源类型）
  try {
    const config = getGithubConfig()
    const ownerInput = document.getElementById('githubOwner') as HTMLInputElement | null
    const repoInput = document.getElementById('githubRepo') as HTMLInputElement | null
    const branchInput = document.getElementById('githubBranch') as HTMLInputElement | null
    const pathInput = document.getElementById('githubPath') as HTMLInputElement | null
    const localFilePathInput = document.getElementById('localFilePath') as HTMLInputElement | null
    const gistIdInput = document.getElementById('gistId') as HTMLInputElement | null
    const strategySelect = document.getElementById('githubStrategy') as HTMLSelectElement | null
    const sourceTypeSelect = document.getElementById('syncSourceType') as HTMLSelectElement | null
    if (ownerInput) ownerInput.value = config.owner
    if (repoInput) repoInput.value = config.repo
    if (branchInput) branchInput.value = config.branch
    if (pathInput) pathInput.value = config.path
    // 本地文件路径复用 githubConfig.path 字段，回填到独立输入框
    if (localFilePathInput) localFilePathInput.value = config.path
    // Gist ID 回填
    if (gistIdInput && config.gistId) gistIdInput.value = config.gistId
    // 回填策略
    const savedStrategy = getSyncStrategy()
    if (strategySelect) strategySelect.value = savedStrategy
    // 回填同步源类型，并触发字段显示/隐藏切换
    const savedSourceType = getSyncSourceType()
    if (sourceTypeSelect) sourceTypeSelect.value = savedSourceType
    toggleSourceFields(savedSourceType)
    if (config.owner || config.repo || config.path) {
      bgmLog(
        LOG_LEVELS.INFO,
        `[handlers] GitHub 配置已加载: ${config.owner}/${config.repo}/${config.branch}/${config.path}, 策略: ${savedStrategy}, 同步源: ${savedSourceType}`,
      )
    }

    // 为 GitHub 配置输入框添加防抖自动保存（300ms），
    // 用户输入时静默保存，避免每次按键都触发 PluginStorage 写入。
    // 注意：按钮点击 "保存配置"（saveGithubConfig action）不走此路径，
    // 仍保留同步保存 + Toast 反馈，确保用户主动保存的即时确认体验。
    if (ownerInput) trackedAddEventListener(ownerInput, 'input', debouncedSaveGithubConfig)
    if (repoInput) trackedAddEventListener(repoInput, 'input', debouncedSaveGithubConfig)
    if (branchInput) trackedAddEventListener(branchInput, 'input', debouncedSaveGithubConfig)
    if (pathInput) trackedAddEventListener(pathInput, 'input', debouncedSaveGithubConfig)
    if (localFilePathInput)
      trackedAddEventListener(localFilePathInput, 'input', debouncedSaveGithubConfig)
    if (gistIdInput) trackedAddEventListener(gistIdInput, 'input', debouncedSaveGithubConfig)
    if (strategySelect) trackedAddEventListener(strategySelect, 'change', debouncedSaveGithubConfig)
    if (sourceTypeSelect) {
      // sourceType 切换时：1) 触发字段显示/隐藏；2) 触发防抖保存
      trackedAddEventListener(sourceTypeSelect, 'change', () => {
        const selectedSourceType =
          (sourceTypeSelect.value as SyncSourceType | undefined) ?? 'github'
        toggleSourceFields(selectedSourceType)
        debouncedSaveGithubConfig()
      })
    }
    bgmLog(LOG_LEVELS.INFO, '[handlers] GitHub 配置输入框防抖自动保存监听器已注册')
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[handlers] 加载 GitHub 配置失败: ${(error as Error).message}`)
  }

  // 系统日志：级别筛选下拉框变化时重新渲染日志列表
  const logLevelFilter = document.getElementById('logLevelFilter') as HTMLSelectElement | null
  if (logLevelFilter) {
    trackedAddEventListener(logLevelFilter, 'change', handleLogLevelFilterChange)
    bgmLog(LOG_LEVELS.INFO, '[handlers] 日志级别筛选 change 监听器已注册')
  }

  // 设置页：外观主题选择 / 预览卡片
  const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement | null
  if (themeSelect) {
    themeSelect.value = getTheme(true)
    trackedAddEventListener(themeSelect, 'change', handleThemeChange)
    bgmLog(LOG_LEVELS.INFO, '[handlers] 主题选择 change 监听器已注册')
  }
  document.querySelectorAll<HTMLElement>('[data-theme-card]').forEach((card) => {
    trackedAddEventListener(card, 'click', handleThemePreviewClick)
  })
  updateThemePreview(getTheme(true))

  // 设置页：默认收藏列表类型
  const listTypeSelect = document.getElementById('listTypeSelect') as HTMLSelectElement | null
  if (listTypeSelect) {
    listTypeSelect.value = getListType(true)
    trackedAddEventListener(listTypeSelect, 'change', handleListTypeChange)
    bgmLog(LOG_LEVELS.INFO, '[handlers] 收藏列表类型 change 监听器已注册')
  }

  // 设置页：默认时间筛选范围
  const timeFilterSelect = document.getElementById('timeFilterSelect') as HTMLSelectElement | null
  if (timeFilterSelect) {
    timeFilterSelect.value = getTimeFilter(true)
    trackedAddEventListener(timeFilterSelect, 'change', handleTimeFilterChange)
    bgmLog(LOG_LEVELS.INFO, '[handlers] 时间筛选范围 change 监听器已注册')
  }

  // 设置页：自动刷新间隔（含校验）
  const refreshIntervalInput = document.getElementById(
    'refreshIntervalInput',
  ) as HTMLInputElement | null
  if (refreshIntervalInput) {
    refreshIntervalInput.value = String(getRefreshInterval(true))
    trackedAddEventListener(refreshIntervalInput, 'change', handleRefreshIntervalChange)
    bgmLog(LOG_LEVELS.INFO, '[handlers] 刷新间隔 change 监听器已注册')
  }
}

// ========== 时间筛选 UI 控制 ==========

/**
 * 初始化时间筛选控件的显示/隐藏逻辑
 * - 勾选「启用时间筛选」时显示筛选控件区域
 * - 筛选范围切换时显示/隐藏季度/月份下拉框
 * - 选择「预告/未来动漫」时隐藏年份/季度/月份，显示提示
 */
function setupTimeFilterControls(): void {
  const chkTimeFilter = document.getElementById('chkTimeFilter') as HTMLInputElement | null
  const timeFilterControls = document.getElementById('timeFilterControls')
  const rangeSelect = document.getElementById('timeFilterRange') as HTMLSelectElement | null
  const yearRow = document.getElementById('yearRow')
  const quarterRow = document.getElementById('quarterRow')
  const monthRow = document.getElementById('monthRow')
  const futureHintRow = document.getElementById('futureHintRow')

  if (!chkTimeFilter || !timeFilterControls) return

  // 复选框切换：显示/隐藏筛选控件
  chkTimeFilter.addEventListener('change', () => {
    timeFilterControls.style.display = chkTimeFilter.checked ? 'block' : 'none'
  })

  // 筛选范围切换：显示/隐藏年份/季度/月份/提示行
  if (rangeSelect && yearRow && quarterRow && monthRow) {
    rangeSelect.addEventListener('change', () => {
      const isFuture = rangeSelect.value === 'future'
      yearRow.style.display = isFuture ? 'none' : ''
      quarterRow.style.display = rangeSelect.value === 'quarter' ? '' : 'none'
      monthRow.style.display = rangeSelect.value === 'month' ? '' : 'none'
      if (futureHintRow) {
        futureHintRow.style.display = isFuture ? '' : 'none'
      }
    })
  }
}

interface ActionHandlerContext {
  args: string[]
  startTime: number
}

type ActionHandler = (context: ActionHandlerContext) => void

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  // 核心操作
  sync: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行同步操作')
    void syncFromPanel()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 同步操作已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  testSelected: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行选中行同步')
    if (typeof syncSelectedRows === 'function') {
      void syncSelectedRows()
      bgmLog(
        LOG_LEVELS.INFO,
        `[handleActionClick] 选中行同步已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
      )
    } else {
      bgmLog(LOG_LEVELS.WARN, '[handleActionClick] syncSelectedRows 函数未定义')
    }
  },

  clear: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新数据')
    showConfirm(_T.confirmClearMarks, (confirmed) => {
      if (confirmed) {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户确认刷新数据')

        if (typeof refreshData === 'function') refreshData()
        bgmLog(
          LOG_LEVELS.INFO,
          `[handleActionClick] 刷新数据完成，耗时: ${String(Date.now() - context.startTime)}ms`,
        )
      } else {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户取消刷新数据')
      }
    })
  },

  previewSyncContent: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始执行预览同步内容')
    if (typeof previewSyncContent === 'function') {
      void previewSyncContent()
      bgmLog(
        LOG_LEVELS.INFO,
        `[handleActionClick] 预览同步内容已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
      )
    } else {
      bgmLog(LOG_LEVELS.WARN, '[handleActionClick] previewSyncContent 函数未定义')
    }
  },

  enlargePreview: () => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 放大预览表格')
    if (typeof enlargePreview === 'function') {
      enlargePreview()
    } else {
      bgmLog(LOG_LEVELS.WARN, '[handleActionClick] enlargePreview 函数未定义')
    }
  },

  setToken: (context) => {
    // 已废弃，由 showTokenDialog 替代，保留兼容
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开 Token 设置对话框')
    showTokenDialog(loadBgToken() ?? '')
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] Token 设置对话框已打开，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 快捷按钮
  showTokenDialog: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 显示 Token 设置对话框')
    showTokenDialog(loadBgToken() ?? '')
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] Token 设置对话框已显示，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  clearToken: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 清除 Token 设置')
    try {
      clearBgToken()
      BGM.cache.userId = null
      BGM.cache.username = null
      const app = getApp()
      if (app?.PluginStorage) {
        app.PluginStorage.setItem('bgm_user_id', '')
        app.PluginStorage.setItem('bgm_username', '')
      }
      updateTokenStatus()
      updateUserIdStatus()
      showToast('Token 已清除', 'info')
      bgmLog(LOG_LEVELS.INFO, '[handleActionClick] Token 已清除')
    } catch (error: unknown) {
      BGM.handleError(error, { showAlert: true, level: BGM.ErrorLevel.WARN, context: 'clearToken' })
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 清除 Token 操作完成，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  copyToken: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 复制 Token 到剪贴板')
    try {
      const isOk = copyTokenToClipboard()
      if (isOk) {
        showToast('Token 已复制到剪贴板', 'success')
      } else {
        showToast('复制失败，可能未设置 Token 或浏览器不支持', 'error')
      }
    } catch (error: unknown) {
      BGM.handleError(error, { showAlert: true, level: BGM.ErrorLevel.WARN, context: 'copyToken' })
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 复制 Token 操作完成，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  testToken: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始测试 Token 有效性')
    testTokenValidity()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] Token 测试已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // Token 续约：刷新用户信息和头像
  renewToken: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] Token 续约')
    // renewToken 已废弃，其内部仅委托给 testTokenValidity，直接调用等价流程
    testTokenValidity()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] Token 续约已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 关闭连接测试弹窗
  closeConnectionTest: () => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭连接测试弹窗')
    hideConnectionTestDialog()
  },

  showUserIdDialog: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 显示用户ID设置对话框')
    showUserIdDialog()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 用户ID设置对话框已显示，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  openUserCollection: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 尝试打开收藏页面')
    openUserCollection()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 收藏页面打开操作已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  openTokenPage: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开 Token 申请页面')
    openBangumiTokenPage()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] Token 申请页面已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  syncCollectionFromBgm: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始从 BGM 同步收藏')
    syncCollectionFromBgm()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 收藏同步已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  refreshSheets: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新工作表（自动匹配当前活动工作表）')
    refreshSheets({ autoSelectActive: true })
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 工作表刷新已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  refreshWorkbooks: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新工作簿列表')
    refreshWorkbooks()
    refreshSheets({ autoSelectActive: true })
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 工作簿刷新已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  refreshData: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始刷新数据')
    refreshData()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 数据刷新已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  toggleSheetLock: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 切换工作表锁定状态')
    toggleSheetLock()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 工作表锁定状态已切换，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  clearSyncRecords: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始清除同步记录')
    clearSyncRecords()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 同步记录清除已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  deduplicateSyncRecords: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始去重同步记录')
    deduplicateSyncRecords()
    showToast('去重完成', 'success')
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 同步记录去重已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  formatSyncRecordSheet: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始设置同步记录表格式')
    formatSyncRecordSheet()
    showToast('格式设置完成', 'success')
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 同步记录表格式设置已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  cleanLockedDataSheet: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始清洗锁定数据表')
    cleanLockedDataSheet()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 数据清洗完成，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  openSyncRecordSheet: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开同步记录工作表')
    openSyncRecordSheet()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 同步记录工作表已打开，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  testDebugConnection: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 测试调试连接')
    testDebugConnection()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 调试连接测试已完成，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 模态框操作
  closeDetailModal: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭详情模态框')
    closeDetailModal()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 详情模态框已关闭，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 弹窗快捷调用（参数形式）
  showToast: (context) => {
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 显示 Toast 消息: ${context.args[0] ?? ''}`)
    showToast(context.args[0] ?? '', context.args[1] ?? '')
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] Toast 已显示，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  showAlert: (context) => {
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 显示警告框: ${context.args[0] ?? ''}`)
    showAlert(context.args[0] ?? '', context.args[1] ?? '')
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 警告框已显示，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  requestStopSync: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求停止同步')
    BGM.sync.requestStop()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 停止同步请求已发送，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  pauseSync: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求暂停同步')
    BGM.sync.pause()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 暂停同步请求已发送，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  resumeSync: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户请求恢复同步')
    BGM.sync.resume()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 恢复同步请求已发送，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // GitHub 仓库同步：保存配置（含策略与同步源类型）
  saveGithubConfig: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 保存 GitHub 配置')
    const ownerInput = document.getElementById('githubOwner') as HTMLInputElement | null
    const repoInput = document.getElementById('githubRepo') as HTMLInputElement | null
    const branchInput = document.getElementById('githubBranch') as HTMLInputElement | null
    const pathInput = document.getElementById('githubPath') as HTMLInputElement | null
    const localFilePathInput = document.getElementById('localFilePath') as HTMLInputElement | null
    const gistIdInput = document.getElementById('gistId') as HTMLInputElement | null
    const strategySelect = document.getElementById('githubStrategy') as HTMLSelectElement | null
    const sourceTypeSelect = document.getElementById('syncSourceType') as HTMLSelectElement | null
    if (!ownerInput || !repoInput || !pathInput) {
      showToast('UI 元素缺失', 'error')
      return
    }
    const sourceType = (sourceTypeSelect?.value as SyncSourceType | undefined) ?? 'github'

    // 按数据源类型读取对应字段
    let path: string
    let gistId: string | undefined
    if (sourceType === 'local') {
      path = (localFilePathInput?.value ?? '').trim()
    } else {
      path = pathInput.value.trim()
    }
    if (sourceType === 'gist') {
      gistId = (gistIdInput?.value ?? '').trim() || undefined
    }

    const config = {
      owner: ownerInput.value.trim(),
      repo: repoInput.value.trim(),
      branch: branchInput?.value.trim() || 'main',
      path,
      sourceType,
      gistId,
    }
    // 必填项校验
    if (sourceType === 'local') {
      if (!config.path) {
        showToast('本地文件路径不能为空', 'warn')
        return
      }
    } else if (sourceType === 'gist') {
      if (!gistId) {
        showToast('Gist ID 不能为空', 'warn')
        return
      }
    } else if (!config.owner || !config.repo || !config.path) {
      showToast('owner / repo / path 不能为空', 'warn')
      return
    }
    const strategy = (strategySelect?.value as SyncStrategy | undefined) ?? 'add-update'
    const isOkConfig = setGithubConfig(config)
    const isOkStrategy = setSyncStrategy(strategy)
    const isOkSourceType = setSyncSourceType(sourceType)
    if (isOkConfig && isOkStrategy && isOkSourceType) {
      showToast(`配置已保存（策略：${strategy}，同步源：${sourceType}）`, 'success')
      bgmLog(
        LOG_LEVELS.INFO,
        `[handleActionClick] GitHub 配置已保存: ${config.owner}/${config.repo}/${config.branch}/${config.path}, 策略: ${strategy}, 同步源: ${sourceType}${gistId ? `, gistId: ${gistId}` : ''}`,
      )
    } else {
      showToast('保存失败：PluginStorage 不可用', 'error')
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 保存 GitHub 配置完成，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // GitHub 仓库同步：立即同步（异步，按当前策略）
  syncFromGithub: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 开始数据同步（远程仓库 → Excel）')
    // 读取同步源类型：优先用下拉框当前值，兜底用已保存的值
    const sourceTypeSelect = document.getElementById('syncSourceType') as HTMLSelectElement | null
    const currentSourceType: SyncSourceType =
      (sourceTypeSelect?.value as SyncSourceType | undefined) ?? getSyncSourceType()
    // 读取「仅同步选中行」开关
    const chkSelectedOnly = document.getElementById(
      'chkSyncSelectedOnly',
    ) as HTMLInputElement | null
    const isSelectedRowsOnly = chkSelectedOnly?.checked === true

    // 读取时间筛选配置
    const chkTimeFilter = document.getElementById('chkTimeFilter') as HTMLInputElement | null
    const isTimeFilterEnabled = chkTimeFilter?.checked === true
    let timeFilter: SyncTimeFilter | undefined
    if (isTimeFilterEnabled) {
      const yearSelect = document.getElementById('timeFilterYear') as HTMLSelectElement | null
      const rangeSelect = document.getElementById('timeFilterRange') as HTMLSelectElement | null
      const quarterSelect = document.getElementById('timeFilterQuarter') as HTMLSelectElement | null
      const monthSelect = document.getElementById('timeFilterMonth') as HTMLSelectElement | null
      const year = parseInt(yearSelect?.value || '2026', 10)
      const range =
        (rangeSelect?.value as 'year' | 'quarter' | 'month' | 'future' | undefined) ?? 'year'
      timeFilter = {
        enabled: true,
        year,
        range,
        ...(range === 'quarter'
          ? { quarter: parseInt(quarterSelect?.value || '1', 10) as 1 | 4 | 7 | 10 }
          : {}),
        ...(range === 'month' ? { month: parseInt(monthSelect?.value || '1', 10) } : {}),
      }
    }
    // 本地文件源仅需 path 字段；远程源（github/gitlab/gitee）要求 owner/repo/path
    // 本地文件路径复用 #githubPath 输入框（用户可手动粘贴绝对路径，UI 后续可扩展文件选择对话框）
    if (currentSourceType === 'local') {
      const pathInput = document.getElementById('githubPath') as HTMLInputElement | null
      if (!pathInput?.value.trim()) {
        showToast('请先填写本地文件路径', 'warn')
        return
      }
    } else if (!isGithubConfigComplete()) {
      showToast('请先填写并保存远程仓库配置', 'warn')
      return
    }
    // 读取策略：优先用下拉框当前值（未保存也能即时生效），兜底用已保存的策略
    const strategySelect = document.getElementById('githubStrategy') as HTMLSelectElement | null
    const strategy = (strategySelect?.value as SyncStrategy | undefined) ?? getSyncStrategy()
    const strategyLabel = (
      {
        'add-update': '新增+更新（不删除）',
        'add-only': '仅新增',
        'update-only': '仅更新',
        mirror: '镜像同步（含删除）',
        'force-overwrite': '强制覆盖',
      } as const
    )[strategy]
    // 同步源类型对应的来源描述（本地文件 vs 远程仓库）
    const sourceLabel = currentSourceType === 'local' ? '本地文件' : '远程仓库'
    // 构建时间筛选描述
    let timeFilterDesc = ''
    if (timeFilter) {
      timeFilterDesc =
        timeFilter.range === 'future'
          ? `\n🔮 时间筛选：预告/未来动漫（无开播日期）`
          : timeFilter.range === 'year'
            ? `\n📅 时间筛选：${String(timeFilter.year)}年全年`
            : timeFilter.range === 'quarter'
              ? `\n📅 时间筛选：${String(timeFilter.year)}年${String(timeFilter.quarter ?? '')}月新番`
              : `\n📅 时间筛选：${String(timeFilter.year)}年${String(timeFilter.month ?? '')}月`
    }
    showConfirm(
      `将从${sourceLabel}下载数据并按策略【${strategyLabel}】合并到当前工作表。\n（远程仓库 → Excel，与上传同步方向相反）${isSelectedRowsOnly ? '\n⚠️ 仅同步选中行' : ''}${timeFilterDesc}\n是否继续？`,
      (confirmed) => {
        if (!confirmed) {
          bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户取消数据同步')
          return
        }
        // 使用模块化进度弹窗（与「同步到 Bangumi」「选中行同步」保持一致）
        // AbortController 支持：用户点击「停止」时取消下载阶段（applyDiffToSheet 为同步函数，不支持取消）
        const abortController = new AbortController()

        // 构建配置摘要，显示在同步进度弹窗顶部
        const configContext: BuildSyncConfigContext = {
          source: sourceLabel,
          strategy: strategyLabel,
          direction: '远程仓库 → Excel',
          selectedRowsOnly: isSelectedRowsOnly,
        }
        if (timeFilter) {
          const tfContext: {
            range: 'year' | 'quarter' | 'month' | 'future'
            year: number
            quarter?: number
            month?: number
          } = {
            range: timeFilter.range === 'all' ? 'year' : timeFilter.range,
            year: timeFilter.year,
          }
          if (timeFilter.quarter !== undefined) tfContext.quarter = timeFilter.quarter
          if (timeFilter.month !== undefined) tfContext.month = timeFilter.month
          configContext.timeFilter = tfContext
        }
        const configSummary = buildSyncConfig(configContext)

        showSyncProgressDialog(
          `正在同步 - 数据同步（${sourceLabel} → Excel）`,
          {
            onPause: () => {
              bgmLog(LOG_LEVELS.INFO, '[syncFromGithub] 数据同步不支持暂停')
            },
            onResume: () => {
              bgmLog(LOG_LEVELS.INFO, '[syncFromGithub] 数据同步不支持恢复')
            },
            onStop: () => {
              bgmLog(LOG_LEVELS.INFO, '[syncFromGithub] 用户请求停止数据同步')
              abortController.abort()
            },
          },
          configSummary,
        )

        // 状态栏同步更新（与 syncFromPanel 行为一致）
        const app = getApp()
        // 性能追踪：记录同步开始时间，用于计算总耗时
        const syncStartTime = Date.now()
        syncFromRemote(
          (current, total, message, eta) => {
            // message 写入日志区，eta 独立传入 ETA 区
            updateSyncProgressDialog(current, total, message, message, eta)
            if (app?.StatusBar !== undefined) {
              const statusMessage = eta ? `${message} | ${eta}` : message
              app.StatusBar = `[${String(current)}/${String(total)}] ${statusMessage}`
            }
          },
          strategy,
          abortController.signal,
          isSelectedRowsOnly,
          // conflictResolution
          undefined,
          timeFilter,
        )
          .then((result) => {
            const totalElapsed = Date.now() - syncStartTime
            const totalProcessed = result.added + result.updated + result.deleted
            const avgSpeed =
              totalProcessed > 0 && totalElapsed > 0
                ? Math.round((totalProcessed / totalElapsed) * 1000)
                : 0

            const efficiency =
              totalProcessed > 0 || result.unchanged > 0
                ? Math.round((totalProcessed / (totalProcessed + result.unchanged)) * 100)
                : 0
            const etaMs =
              avgSpeed > 0 && result.remoteTotal > totalProcessed
                ? Math.round(((result.remoteTotal - totalProcessed) / avgSpeed) * 1000)
                : 0

            const summary = `远程 ${String(result.remoteTotal)} 条 → ✅${String(result.added)} 🔄${String(result.updated)} ❌${String(result.deleted)} ⏭️${String(result.unchanged)} ⚠️${String(result.failed)} | 耗时 ${formatDuration(totalElapsed)} | ${String(avgSpeed > 0 ? avgSpeed : '?')} 行/秒 | 效率 ${String(efficiency)}%`
            const details = [
              `📥 远程数据总量: ${String(result.remoteTotal)}`,
              `➕ 新增: ${String(result.added)}`,
              `✏️ 更新: ${String(result.updated)}`,
              `🗑️ 删除: ${String(result.deleted)}`,
              `⏭️ 无变更: ${String(result.unchanged)}`,
              `❌ 失败: ${String(result.failed)}`,
              `🔍 跳过: ${String(result.skipped)}`,
              `📊 实际处理: ${String(totalProcessed)} 条`,
              `⏱️ 总耗时: ${formatDuration(totalElapsed)}`,
              `⚡ 平均速度: ${avgSpeed > 0 ? `${String(avgSpeed)} 行/秒` : '--'}`,
              `📈 处理效率: ${String(efficiency)}%`,
              etaMs > 0 ? `🔮 预计剩余: ${formatDuration(etaMs)}` : '✅ 全部完成',
            ]

            const stats: SyncProgressStats = {
              added: result.added,
              updated: result.updated,
              deleted: result.deleted,
              unchanged: result.unchanged,
              failed: result.failed,
              skipped: result.skipped,
              remoteTotal: result.remoteTotal,
              elapsedMs: totalElapsed,
              avgSpeed,
              strategyLabel,
            }

            const detailItems: GithubSyncDetailItem[] | undefined =
              result.details && result.details.length > 0 ? result.details : undefined
            completeSyncProgressDialog(
              summary,
              details,
              false,
              () => {
                let scrollToRow: number | undefined
                try {
                  const recordSheet = getSyncRecordSheetIfExists()
                  if (recordSheet) {
                    scrollToRow = getLastRow(recordSheet)
                  }
                } catch {
                  // ignore
                }
                const options: SyncResultDialogOptions = {
                  result,
                  elapsedMs: totalElapsed,
                  avgSpeed,
                  strategyLabel,
                  stopped: false,
                }
                if (scrollToRow !== undefined) {
                  options.scrollToRow = scrollToRow
                }
                showSyncResultDialog(options)
              },
              stats,
              detailItems,
            )

            bgmLog(
              LOG_LEVELS.INFO,
              `[handleActionClick] 同步完成 | 远程:${String(result.remoteTotal)} ✅:${String(result.added)} 🔄:${String(result.updated)} ❌:${String(result.deleted)} ⏭️:${String(result.unchanged)} ⚠️:${String(result.failed)} 🔍:${String(result.skipped)} | 耗时:${formatDuration(totalElapsed)} | 速度:${avgSpeed > 0 ? `${String(avgSpeed)}/s` : '?'} | 效率:${String(efficiency)}%`,
            )
            if (app?.StatusBar !== undefined) app.StatusBar = false
          })
          .catch((error: unknown) => {
            const errorMessage = error instanceof Error ? error.message : String(error)
            const isAborted = abortController.signal.aborted
            if (isAborted) {
              showSyncResultDialog({
                result: {
                  remoteTotal: 0,
                  added: 0,
                  updated: 0,
                  deleted: 0,
                  unchanged: 0,
                  failed: 0,
                } as GithubSyncResult,
                elapsedMs: Date.now() - syncStartTime,
                avgSpeed: 0,
                strategyLabel,
                stopped: true,
              })
              bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 数据同步被用户停止')
            } else {
              hideSyncProgressDialog()
              bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 数据同步失败: ${errorMessage}`)
              showToast(`数据同步失败：${errorMessage}`, 'error')
            }
            if (app?.StatusBar !== undefined) app.StatusBar = false
          })
      },
    )
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 数据同步已触发（策略: ${strategy}），耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // GitHub 仓库同步：测试配置（构造 URL 并提示）
  testGithubConfig: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 测试 GitHub 配置')
    if (!isGithubConfigComplete()) {
      showToast('请先填写并保存 GitHub 配置', 'warn')
      return
    }
    let url: string
    try {
      url = buildRawUrl()
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      showToast(`配置错误：${errorMessage}`, 'error')
      showConnectionTestDialog({
        success: false,
        statusCode: null,
        responseTime: 0,
        url: 'N/A',
        sourceType: getSyncSourceType(),
        errorMessage,
      })
      return
    }

    // 显示测试中提示
    showToast('正在测试连接...', 'info')

    // 获取数据源类型
    const sourceType = getSyncSourceType()

    // 发送 HEAD 请求测试连接
    const testStartTs = Date.now()
    const xhr = new XMLHttpRequest()
    xhr.open('HEAD', url, true)
    xhr.timeout = 10_000

    xhr.onload = () => {
      const responseTime = Date.now() - testStartTs
      const statusCode = xhr.status
      const isSuccess = statusCode >= 200 && statusCode < 400

      bgmLog(
        LOG_LEVELS.INFO,
        `[handleActionClick] 连接测试完成: status=${String(statusCode)}, time=${String(responseTime)}ms, url=${url}`,
      )

      showConnectionTestDialog({
        success: isSuccess,
        statusCode,
        responseTime,
        url,
        sourceType,
        errorMessage: isSuccess ? undefined : `HTTP ${String(statusCode)}`,
      })
    }

    xhr.onerror = () => {
      const responseTime = Date.now() - testStartTs
      bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 连接测试失败: ${url}`)

      showConnectionTestDialog({
        success: false,
        statusCode: null,
        responseTime,
        url,
        sourceType,
        errorMessage: '网络错误：无法连接到服务器',
      })
    }

    xhr.ontimeout = () => {
      const responseTime = Date.now() - testStartTs
      bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 连接测试超时: ${url}`)

      showConnectionTestDialog({
        success: false,
        statusCode: null,
        responseTime,
        url,
        sourceType,
        errorMessage: '请求超时（10秒）',
      })
    }

    xhr.send()

    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 测试 GitHub 配置已发起，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 本地文件源：选择本地 JSONL/JSON 文件
  browseLocalFile: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 选择本地文件')
    try {
      // 通过 WPS Application.GetOpenFilename 弹出文件选择对话框
      const app = (window as unknown as { wps?: { Application?: unknown } }).wps
      const wpsApp = app?.Application as
        { GetOpenFilename?: (fileFilter: string, title: string) => unknown } | undefined
      if (!wpsApp || typeof wpsApp.GetOpenFilename !== 'function') {
        // 降级：提示用户手动输入路径
        const input = document.getElementById('localFilePath') as HTMLInputElement | null
        if (input) {
          input.focus()
          input.placeholder = 'WPS 文件对话框不可用，请手动输入绝对路径'
        }
        showToast('WPS 文件对话框不可用，请手动输入路径', 'warn')
        return
      }
      // 文件过滤器：JSONL / JSON / 所有文件
      const selected = wpsApp.GetOpenFilename(
        'JSONL 文件 (*.jsonl),*.jsonl,JSON 文件 (*.json),*.json,所有文件 (*.*),*.*',
        '选择 JSONL/JSON 文件',
      )
      // GetOpenFilename 返回 false 表示用户取消
      if (typeof selected === 'boolean' || selected === false) {
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 用户取消文件选择')
        return
      }
      const filePath = String(selected)
      const input = document.getElementById('localFilePath') as HTMLInputElement | null
      if (input) {
        input.value = filePath
        // 触发 input 事件，激活防抖自动保存
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      showToast(`已选择：${filePath}`, 'success')
      bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 已选择本地文件: ${filePath}`)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      showToast(`选择文件失败：${errorMessage}`, 'error')
      bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 选择本地文件失败: ${errorMessage}`)
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 选择本地文件完成，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // GitHub 仓库同步：撤销最近一次同步（按单元格逆序恢复旧值）
  undoLastSync: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 撤销最近一次 GitHub 同步')
    executeUndoLastSync().catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error)
      bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 撤销同步失败: ${errorMessage}`)
      showToast(`撤销失败：${errorMessage}`, 'error')
    })
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 撤销同步已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 系统日志：打开日志面板
  showLogPanel: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开系统日志面板')
    const modal = document.getElementById('logModal')
    if (modal) {
      modal.style.display = 'block'
      renderLogEntries()
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 系统日志面板已打开，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 系统日志：关闭日志面板
  closeLogModal: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭系统日志面板')
    const modal = document.getElementById('logModal')
    if (modal) modal.style.display = 'none'
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 系统日志面板已关闭，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 系统日志：导出日志到文件
  exportLogs: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 导出系统日志到文件')
    try {
      exportLogsToFile()
      showToast('日志已导出', 'success')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 导出日志失败: ${errorMessage}`)
      showToast(`导出日志失败：${errorMessage}`, 'error')
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 日志导出完成，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 系统日志：清空日志缓冲区
  clearLogs: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 清空系统日志')
    clearLogs()
    renderLogEntries()
    showToast('日志已清空', 'info')
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 系统日志已清空，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 同步策略使用引导：显示/隐藏同步策略详细说明
  showSyncGuide: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开同步策略使用引导')
    const note = document.getElementById('mirrorSyncNote')
    const strategySelect = document.getElementById('githubStrategy') as HTMLSelectElement | null
    const strategy = strategySelect?.value ?? ''
    if (note) {
      // 根据所选策略更新说明文案
      const strategyLabels: Record<string, string> = {
        'add-update': '新增+更新：不删除本地数据，仅同步新增和有差异的条目。',
        'add-only': '仅新增：不更新本地已有条目，仅同步远程新增的 SID。',
        'update-only': '仅更新：不新增本地不存在的 SID，仅同步已有条目的变更。',
        mirror:
          '镜像同步：新增+更新+删除本地多余行（建议先备份或使用「新工作簿」以完全与远程一致）。',
        'force-overwrite': '强制覆盖：无视字段比对，远程值全部覆盖本地（含空值）。',
      }
      const prefix = strategyLabels[strategy] ?? ''
      note.innerHTML = `
        <strong>📘 同步策略说明</strong><br>
        ${prefix ? `<em>当前策略：</em>${prefix}<br><br>` : ''}
        <strong>通用规则</strong><br>
        • <strong>新增条目</strong>（writeAll=true）：正常写入所有字段<br>
        • <strong>更新条目</strong>：名称追加到「别名」列、标签追加到「标签/分级」列（以 <code> | </code> 分隔），其他字段直接覆盖<br>
        • <strong>制作公司/动画制作公司</strong>：远程「动画制作公司」字段会同步到本地「制作公司」和「动画制作公司」两列<br>
        • <strong>完全镜像</strong>：要完全与远程一致，需先删除本地全部数据后再同步，或选择新建工作簿同步<br>
      `
      note.style.display = note.style.display === 'block' ? 'none' : 'block'
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 同步策略引导已打开，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 使用引导：显示/隐藏详细操作说明
  toggleUsageGuide: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 切换使用引导详情')
    const detail = document.getElementById('usageGuideDetail')
    const button = document.getElementById('toggleUsageGuideBtn')
    if (detail && button) {
      const isHidden = detail.style.display === 'none'
      detail.style.display = isHidden ? 'block' : 'none'
      button.textContent = isHidden ? '📖 收起详细操作' : '📖 显示详细操作'
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 使用引导已${detail?.style.display === 'none' ? '隐藏' : '显示'}，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 保存所有配置：重新保存当前所有配置项到 PluginStorage
  saveAllConfig: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 保存所有配置')
    try {
      const parts: string[] = []

      // 1. Token
      const token = loadBgToken()
      if (token) {
        storeBgToken(token)
        parts.push('Token')
      }

      // 2. 用户 ID
      const userId = _getBgmUserId()
      if (userId) {
        parts.push(`用户ID: ${userId}`)
      }

      // 3. GitHub 配置
      const ghConfig = getGithubConfig()
      if (ghConfig.owner && ghConfig.repo) {
        setGithubConfig(ghConfig)
        parts.push(`GitHub: ${ghConfig.owner}/${ghConfig.repo}`)
      }

      // 4. 同步偏好（重新持久化）
      const isIncremental = getIncrementalSync()
      setIncrementalSync(isIncremental)
      parts.push(`增量同步: ${isIncremental ? '开' : '关'}`)

      const isSkipConflicts = getSkipConflicts()
      setSkipConflicts(isSkipConflicts)
      parts.push(`冲突策略: ${isSkipConflicts ? '跳过' : '覆盖'}`)

      const isSyncRecord = getSyncRecordEnabled()
      setSyncRecordEnabled(isSyncRecord)
      parts.push(`同步记录: ${isSyncRecord ? '开' : '关'}`)

      // 5. 同步策略
      const strategy = getSyncStrategy()
      setSyncStrategy(strategy)
      parts.push(`同步策略: ${strategy}`)

      bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 配置已保存: ${parts.join('; ')}`)
      showToast('所有配置已保存', 'success')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 保存配置失败: ${errorMessage}`)
      showToast(`保存失败：${errorMessage}`, 'error')
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 保存配置操作完成，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 配置导入导出：导出全部配置为 JSON 文件并复制到剪贴板
  exportConfig: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 导出配置')
    try {
      const json = exportConfig()
      // 下载为 JSON 文件
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `bgm-config-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      // 同时复制到剪贴板，便于直接粘贴到其他环境
      _copyTextToClipboard(json)
      showToast('配置已导出（已下载文件并复制到剪贴板）', 'success')
      bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 配置导出完成')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 配置导出失败: ${errorMessage}`)
      showToast(`配置导出失败：${errorMessage}`, 'error')
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 导出配置操作完成，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 配置导入导出：从粘贴的 JSON 导入配置
  importConfig: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 导入配置')
    showInput(
      '导入配置',
      '请粘贴配置 JSON（可从导出的 bgm-config.json 文件中复制）',
      '',
      (value?: string) => {
        if (!value || value.trim() === '') {
          showToast('未提供配置 JSON，已取消导入', 'info')
          return
        }
        const result = importConfig(value.trim())
        if (result.isOk()) {
          showToast('配置导入成功', 'success')
          bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 配置导入成功')
          // 刷新 UI 以反映新配置
          updateTokenStatus()
          updateUserIdStatus()
          refreshGithubConfigInputs()
        } else {
          const errorMessage = result.error?.message ?? '未知错误'
          bgmLog(LOG_LEVELS.ERROR, `[handleActionClick] 配置导入失败: ${errorMessage}`)
          showToast(`导入失败：${errorMessage}`, 'error')
        }
      },
    )
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 导入配置对话框已显示，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 关闭主面板（panel）
  closePanel: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 关闭主面板')
    const app = getApp() as {
      PluginStorage?: { getItem: (k: string) => string | null }
      GetTaskPane?: (id: string) => { Visible: boolean }
    } | null
    if (!app) {
      bgmLog(LOG_LEVELS.WARN, '[handleActionClick] 无法获取 Application 对象')
      return
    }
    const tsId = app.PluginStorage?.getItem('panel_id')
    if (tsId) {
      const tskpane = app.GetTaskPane?.(tsId)
      if (tskpane) {
        tskpane.Visible = false
        bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 主面板已关闭')
        showToast('面板已关闭', 'info')
      }
    } else {
      bgmLog(LOG_LEVELS.WARN, '[handleActionClick] 未找到主面板ID')
    }
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 关闭主面板操作完成，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 打开/切换设置面板
  openSettings: (context) => {
    bgmLog(LOG_LEVELS.INFO, '[handleActionClick] 打开设置面板')
    showSettingsPanel()
    bgmLog(
      LOG_LEVELS.INFO,
      `[handleActionClick] 设置面板操作已触发，耗时: ${String(Date.now() - context.startTime)}ms`,
    )
  },

  // 设置页面：切换增量同步开关
  toggleIncrementalSync: (_context) => {
    const checkbox = document.getElementById('chkIncrementalSync') as HTMLInputElement | null
    const isEnabled = checkbox?.checked ?? false
    setIncrementalSync(isEnabled)
    showToast(`增量同步已${isEnabled ? '开启' : '关闭'}`, 'success')
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 增量同步: ${isEnabled ? '开启' : '关闭'}`)
  },

  // 设置页面：切换跳过冲突开关
  toggleSkipConflicts: (_context) => {
    const checkbox = document.getElementById('chkSkipConflicts') as HTMLInputElement | null
    const isEnabled = checkbox?.checked ?? false
    setSkipConflicts(isEnabled)
    showToast(`冲突处理: ${isEnabled ? '跳过冲突' : 'Excel覆盖'}`, 'success')
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 跳过冲突: ${isEnabled ? '开启' : '关闭'}`)
  },

  // 设置页面：切换启用同步记录开关
  toggleEnableSyncRecord: (_context) => {
    const checkbox = document.getElementById('chkEnableSyncRecord') as HTMLInputElement | null
    const isEnabled = checkbox?.checked ?? false
    setSyncRecordEnabled(isEnabled)
    showToast(`同步记录已${isEnabled ? '开启' : '关闭'}`, 'success')
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 启用同步记录: ${isEnabled ? '开启' : '关闭'}`)
  },

  toggleNavIconsOnly: (_context) => {
    const checkbox = document.getElementById('chkNavIconsOnly') as HTMLInputElement | null
    const isEnabled = checkbox?.checked ?? false
    setNavIconsOnly(isEnabled)
    showToast(`导航模式: ${isEnabled ? '仅图标' : '图标+文字'}`, 'success')
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('nav-icons-only', isEnabled)
    }
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 导航模式: ${isEnabled ? '仅图标' : '图标+文字'}`)
  },
}

/** 渲染日志条目到日志面板 */
function renderLogEntries(): void {
  const body = document.getElementById('logModalBody')
  if (!body) return
  const filterSelect = document.getElementById('logLevelFilter') as HTMLSelectElement | null
  const level = filterSelect?.value || undefined
  const logs = getRecentLogs(level as LogLevel | undefined, 100)
  body.replaceChildren()
  if (logs.length === 0) {
    body.textContent = '暂无日志'
    return
  }
  logs.forEach((entry) => {
    const div = document.createElement('div')
    div.className = `log-entry log-${entry.level.toLowerCase()}`
    const time = new Date(entry.timestamp).toLocaleString()
    div.textContent = `[${time}] [${entry.level}] ${entry.message}`
    body.appendChild(div)
  })
  // 滚动到底部，展示最新日志
  body.scrollTop = body.scrollHeight
}

function handleActionClick(event: Event): void {
  const target = event.currentTarget as HTMLElement
  const { action } = target.dataset
  if (!action) return
  // 解析可能的参数（如：<button data-action="markUploadedItems" data-args='["动画"]'>）
  let arguments_: string[] = []
  if (target.dataset.args) {
    try {
      arguments_ = JSON.parse(target.dataset.args) as string[]
    } catch (error: unknown) {
      BGM.handleError(error, {
        showAlert: false,
        level: BGM.ErrorLevel.WARN,
        context: 'handleActionClick',
      })
    }
  }
  bgmLog(LOG_LEVELS.INFO, `[handleActionClick] ========== 按钮点击事件 ==========`)
  bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 操作类型: ${action}`)
  if (arguments_.length > 0) {
    bgmLog(LOG_LEVELS.INFO, `[handleActionClick] 参数: ${JSON.stringify(arguments_)}`)
  }
  const startTime = Date.now()
  try {
    const handler = ACTION_HANDLERS[action]
    if (handler) {
      handler({ args: arguments_, startTime })
    } else {
      bgmLog(LOG_LEVELS.WARN, `[handleActionClick] 未知操作类型: ${action}`)
    }
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.ERROR,
      `[handleActionClick] 操作执行失败: ${action}, 错误: ${(error as Error).message}`,
    )
    BGM.handleError(error, { context: `handleActionClick:${action}`, showAlert: true })
  }
}

/**
 * 初始化 UI 事件处理模块。
 *
 * 显式入口函数，由 `ts/entry/panel-entry.ts` 调用。
 * 不在模块加载时自动执行，避免：
 *  - 模块加载期间触发 trackedSetTimeout(setupButtonListeners, 0)
 *  - 在测试环境（无 DOM/BGM 全局对象）下意外触发副作用
 *
 * 行为：
 *  - 根据 document.readyState 决定同步执行还是延迟到 DOMContentLoaded
 *  - 调用 setupButtonListeners() 注册按钮点击监听
 *  - 注册消息监听器（接收 token/userId 等更新通知）
 *  - 注册事件总线监听器（接收配置变更与同步进度通知）
 *  - 从配置恢复增量同步、跳过冲突 UI 状态
 */
export function initHandlers(): void {
  const start = (): void => {
    // 先清理旧监听器，防止面板重新初始化时重复注册
    clearTrackedListeners()
    setupButtonListeners()
    setupTimeFilterControls()
    setupMessageListener()
    setupEventListeners()
    initIncrementalSyncFromRibbon()
    bgmLog(LOG_LEVELS.INFO, '[handlers] initHandlers 完成')
  }

  if (typeof document === 'undefined') {
    // 无 DOM 环境（如 Node 测试环境）下同步执行
    start()
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      start()
    })
  } else {
    start()
  }
}

function isPanelContext(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.includes('panel.html')
}

/**
 * 将文本复制到剪贴板（使用临时 textarea + execCommand）
 * @returns 是否复制成功
 */
function _copyTextToClipboard(text: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    // execCommand 已废弃但仍是 WebView/Office 环境中最可靠的剪贴板回退方案（navigator.clipboard 需安全上下文，不可用）
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const isOk = document.execCommand('copy')
    document.body.removeChild(textarea)
    return isOk
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[_copyTextToClipboard] 复制失败: ${(error as Error).message}`)
    return false
  }
}

/**
 * 从 PluginStorage 重新读取 GitHub 配置并填充到面板输入框
 * 用于配置导入后刷新 UI 显示
 */
function refreshGithubConfigInputs(): void {
  try {
    const config = getGithubConfig()
    const ownerInput = document.getElementById('githubOwner') as HTMLInputElement | null
    const repoInput = document.getElementById('githubRepo') as HTMLInputElement | null
    const branchInput = document.getElementById('githubBranch') as HTMLInputElement | null
    const pathInput = document.getElementById('githubPath') as HTMLInputElement | null
    const localFilePathInput = document.getElementById('localFilePath') as HTMLInputElement | null
    const gistIdInput = document.getElementById('gistId') as HTMLInputElement | null
    const strategySelect = document.getElementById('githubStrategy') as HTMLSelectElement | null
    const sourceTypeSelect = document.getElementById('syncSourceType') as HTMLSelectElement | null
    if (ownerInput) ownerInput.value = config.owner
    if (repoInput) repoInput.value = config.repo
    if (branchInput) branchInput.value = config.branch
    if (pathInput) pathInput.value = config.path
    if (localFilePathInput) localFilePathInput.value = config.path
    if (gistIdInput && config.gistId) gistIdInput.value = config.gistId
    if (strategySelect) strategySelect.value = getSyncStrategy()
    const sourceType = getSyncSourceType()
    if (sourceTypeSelect) sourceTypeSelect.value = sourceType
    toggleSourceFields(sourceType)
    bgmLog(
      LOG_LEVELS.INFO,
      `[refreshGithubConfigInputs] 已刷新 GitHub 配置输入框: ${config.owner}/${config.repo}/${config.branch}/${config.path}`,
    )
  } catch (error: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[refreshGithubConfigInputs] 刷新 GitHub 配置输入框失败: ${(error as Error).message}`,
    )
  }
}

// ========== 消息监听 ==========
let _messageHandler: ((event: MessageEvent) => void) | null = null

function setupMessageListener(): void {
  if (typeof window !== 'undefined') {
    // 防止重复注册：先移除旧监听器
    if (_messageHandler) {
      window.removeEventListener('message', _messageHandler)
    }
    _messageHandler = (event: MessageEvent) => {
      // origin 白名单校验（防止跨域消息注入）
      const allowedOrigins = ['null', '', window.location.origin]
      if (!allowedOrigins.includes(event.origin)) {
        bgmLog(LOG_LEVELS.WARN, `[message] 拒绝非预期 origin: ${event.origin}`)
        return
      }
      const { data } = event
      if (typeof data !== 'object' || data === null) return
      const message = data as {
        type?: string
        userId?: string
        username?: string
      }

      bgmLog(LOG_LEVELS.INFO, `[handlers] 收到消息: ${JSON.stringify(message)}`)

      switch (message.type) {
        case 'BGM:tokenUpdated': {
          bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 Token 更新通知')
          updateTokenStatus()
          updateUserIdStatus()
          break
        }
        case 'BGM:userIdUpdated': {
          bgmLog(LOG_LEVELS.INFO, `[handlers] 收到用户ID更新通知: ${String(message.userId)}`)
          if (message.userId) {
            BGM.cache.userId = message.userId
            _setBgmUserId(message.userId)
            bgmLog(LOG_LEVELS.INFO, `[handlers] 已更新 BGM.cache.userId: ${BGM.cache.userId}`)
          }
          updateUserIdStatus()
          break
        }
        case 'BGM:userInfoUpdated': {
          bgmLog(
            LOG_LEVELS.INFO,
            `[handlers] 收到用户信息更新通知: 用户名=${String(message.username)}, 用户ID=${String(message.userId)}`,
          )
          if (message.username) {
            BGM.cache.username = message.username
            _setBgmUsername(message.username)
            bgmLog(LOG_LEVELS.INFO, `[handlers] 已更新 BGM.cache.username: ${BGM.cache.username}`)
          }
          if (message.userId) {
            BGM.cache.userId = message.userId
            _setBgmUserId(message.userId)
            bgmLog(
              LOG_LEVELS.INFO,
              `[handlers] 已更新 BGM.cache.userId 和用户ID配置: ${BGM.cache.userId}`,
            )
          }
          updateUserIdStatus()
          break
        }
        case 'tokenUpdated':
        case 'userIdUpdated': {
          // 兼容旧格式
          if (message.type === 'tokenUpdated') {
            updateTokenStatus()
          } else {
            updateUserIdStatus()
          }
          break
        }
      }
    }
    window.addEventListener('message', _messageHandler)

    bgmLog(LOG_LEVELS.INFO, '[handlers] 消息监听器已注册')
  }
}

/**
 * 移除消息监听器，防止面板关闭后内存泄漏
 */
export function removeMessageListener(): void {
  if (_messageHandler) {
    window.removeEventListener('message', _messageHandler)
    _messageHandler = null
    bgmLog(LOG_LEVELS.INFO, '[handlers] 消息监听器已移除')
  }
}

// ========== 事件总线处理器（模块级，便于追踪与去重） ==========

const handleTokenUpdatedEvent = (): void => {
  bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 TOKEN_UPDATED 事件')
  updateTokenStatus()
  updateUserIdStatus()
}

const handleUserIdUpdatedEvent = (): void => {
  bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 USER_ID_UPDATED 事件')
  updateUserIdStatus()
}

const handleUserNameUpdatedEvent = (): void => {
  bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 USER_NAME_UPDATED 事件')
  updateUserIdStatus()
}

const handleConfigUpdatedEvent = (data: { key: string; value: string }): void => {
  if (!isPanelContext()) return

  bgmLog(
    LOG_LEVELS.INFO,
    `[handlers] 收到 CONFIG_UPDATED 事件: key=${data.key}, value=${data.value}`,
  )

  if (data.key === 'bgm_incremental_sync') {
    bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新增量同步复选框 ==========`)
    tryUpdateIncrementalCheckbox(data.value === 'true')
  } else if (data.key === 'bgm_skip_conflicts') {
    bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新跳过冲突 UI ==========`)
    tryUpdateSkipConflictsUI(data.value === 'true')
  } else if (data.key === 'bgm_enable_sync_record') {
    bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新启用同步记录复选框 ==========`)
    tryUpdateEnableSyncRecordUI(data.value === 'true')
  }
}

const handleSyncProgressEvent = (data: {
  current: number
  total: number
  message: string
}): void => {
  updateSyncProgressDialog(data.current, data.total, data.message)
}

const handleSyncStateChangedEvent = (payload: { state: string; row?: number }): void => {
  bgmLog(
    LOG_LEVELS.INFO,
    `[handlers] 同步状态变更: ${payload.state}${payload.row ? `, 行: ${String(payload.row)}` : ''}`,
  )
  const syncButtons = document.querySelectorAll(
    'button[data-action="sync"], button[data-action="syncCollectionFromBgm"], button[data-action="previewSyncContent"], button[data-action="enlargePreview"]',
  )
  syncButtons.forEach((button) => {
    const element = button as HTMLButtonElement
    element.disabled = payload.state === 'running' || payload.state === 'paused'
  })
}

const handleSyncCompletedEvent = (
  results: { success?: number; fail?: number; skip?: number } | undefined,
): void => {
  bgmLog(LOG_LEVELS.INFO, `[handlers] 同步完成事件触发`)
  const stats = results ?? {}
  showToast(
    `同步完成: 成功 ${String(stats.success ?? 0)}, 失败 ${String(stats.fail ?? 0)}, 跳过 ${String(stats.skip ?? 0)}`,
    'success',
  )
}

const handleSyncErrorEvent = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error)
  bgmLog(LOG_LEVELS.ERROR, `[handlers] 同步错误事件: ${message}`)
  showToast(`同步失败: ${message}`, 'error')
}

// ========== 事件监听（用于接收事件总线通知）==========
function setupEventListeners(): void {
  trackedEventBusOn(BGM_EVENTS.TOKEN_UPDATED, handleTokenUpdatedEvent)
  trackedEventBusOn(BGM_EVENTS.USER_ID_UPDATED, handleUserIdUpdatedEvent)
  trackedEventBusOn(BGM_EVENTS.USER_NAME_UPDATED, handleUserNameUpdatedEvent)
  trackedEventBusOn(BGM_EVENTS.CONFIG_UPDATED, handleConfigUpdatedEvent)
  trackedEventBusOn(BGM_EVENTS.SYNC_PROGRESS, handleSyncProgressEvent)
  trackedEventBusOn(BGM_EVENTS.SYNC_STATE_CHANGED, handleSyncStateChangedEvent)
  trackedEventBusOn(BGM_EVENTS.SYNC_COMPLETED, handleSyncCompletedEvent)
  trackedEventBusOn(BGM_EVENTS.SYNC_ERROR, handleSyncErrorEvent)
  // Ribbon 按钮触发数据同步：复用 panel handler，显示模块化进度弹窗
  trackedEventBusOn(BGM_EVENTS.REQUEST_GITHUB_SYNC, () => {
    bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 Ribbon 数据同步请求，触发 syncFromGithub handler')
    const handler = ACTION_HANDLERS.syncFromGithub
    if (handler) {
      handler({ args: [], startTime: Date.now() })
    } else {
      bgmLog(LOG_LEVELS.ERROR, '[handlers] syncFromGithub handler 未注册')
    }
  })
  // Ribbon 按钮触发撤销同步：通过 eventBus 调用 panel 的 undoLastSync handler
  // 在 panel 环境中执行，可访问 undoStack 中的实际会话数据
  trackedEventBusOn(BGM_EVENTS.REQUEST_UNDO_LAST_SYNC, () => {
    bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 Ribbon 撤销同步请求，触发 undoLastSync handler')
    const handler = ACTION_HANDLERS.undoLastSync
    if (handler) {
      handler({ args: [], startTime: Date.now() })
    } else {
      bgmLog(LOG_LEVELS.ERROR, '[handlers] undoLastSync handler 未注册')
    }
  })
}

// 尝试更新增量同步复选框（带重试机制）
function tryUpdateIncrementalCheckbox(checked: boolean, attempts = 0): void {
  if (!isPanelContext()) return

  const chkIncremental = document.getElementById('chkIncremental') as HTMLInputElement | null

  if (chkIncremental) {
    bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 chkIncremental 元素`)
    bgmLog(LOG_LEVELS.INFO, `[handlers] 当前状态: ${chkIncremental.checked ? '开启' : '关闭'}`)

    chkIncremental.checked = checked

    bgmLog(LOG_LEVELS.INFO, `[handlers] 增量同步复选框已更新: ${checked ? '开启' : '关闭'}`)
  } else if (attempts < 3) {
    // 最多重试3次
    bgmLog(
      LOG_LEVELS.WARN,
      `[handlers] 未找到 chkIncremental 元素，延迟重试 (${String(attempts + 1)}/3)...`,
    )
    trackedSetTimeout(() => {
      tryUpdateIncrementalCheckbox(checked, attempts + 1)
    }, 100)
  } else {
    bgmLog(LOG_LEVELS.ERROR, `[handlers] 重试3次后仍未找到 chkIncremental 元素，放弃更新`)
  }
}

// 尝试更新跳过冲突 UI（带重试机制）
function tryUpdateSkipConflictsUI(skipConflicts: boolean, attempts = 0): void {
  if (!isPanelContext()) return

  bgmLog(LOG_LEVELS.INFO, `[handlers] 目标状态: ${skipConflicts ? '跳过冲突' : 'Excel覆盖'}`)

  const conflictStrategySelect = document.getElementById(
    'conflictStrategy',
  ) as HTMLSelectElement | null

  if (conflictStrategySelect) {
    bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 conflictStrategy select 元素`)
    bgmLog(LOG_LEVELS.INFO, `[handlers] 当前值: ${conflictStrategySelect.value}`)

    conflictStrategySelect.value = skipConflicts ? 'skip' : 'excel'

    bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略 select 已更新: ${conflictStrategySelect.value}`)
    return
  }
  if (attempts < 3) {
    // 最多重试3次
    bgmLog(
      LOG_LEVELS.WARN,
      `[handlers] 未找到 conflictStrategy select 元素，延迟重试 (${String(attempts + 1)}/3)...`,
    )
    trackedSetTimeout(() => {
      tryUpdateSkipConflictsUI(skipConflicts, attempts + 1)
    }, 100)
    return
  }

  bgmLog(
    LOG_LEVELS.ERROR,
    `[handlers] 重试3次后仍未找到 conflictStrategy select 元素，尝试查找其他控件`,
  )

  // 如果找不到，尝试查找其他类型的控件
  // 备用：查找 radio 按钮
  const skipRadio = document.querySelector<HTMLInputElement>(
    'input[name="conflictStrategy"][value="skip"]',
  )
  const overwriteRadio = document.querySelector<HTMLInputElement>(
    'input[name="conflictStrategy"][value="overwrite"]',
  )

  if (skipRadio && overwriteRadio) {
    skipRadio.checked = skipConflicts
    overwriteRadio.checked = !skipConflicts
    bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略 radio 已更新`)
    return
  }

  // 备用：如果是 checkbox
  const chkSkipConflicts = document.getElementById('chkSkipConflicts') as HTMLInputElement | null
  if (chkSkipConflicts) {
    chkSkipConflicts.checked = skipConflicts
    bgmLog(LOG_LEVELS.INFO, `[handlers] 跳过冲突复选框已更新`)
  }
}

// 尝试更新启用同步记录复选框（带重试机制，与另外两个开关保持一致）
function tryUpdateEnableSyncRecordUI(enabled: boolean, attempts = 0): void {
  if (!isPanelContext()) return

  const chkEnableSyncRecord = document.getElementById(
    'chkEnableSyncRecord',
  ) as HTMLInputElement | null

  if (chkEnableSyncRecord) {
    bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 chkEnableSyncRecord 元素`)
    bgmLog(
      LOG_LEVELS.INFO,
      `[handlers] 当前状态: ${chkEnableSyncRecord.checked ? '开启' : '关闭'}，目标状态: ${enabled ? '开启' : '关闭'}`,
    )
    chkEnableSyncRecord.checked = enabled
    bgmLog(LOG_LEVELS.INFO, `[handlers] 启用同步记录复选框已更新: ${enabled ? '开启' : '关闭'}`)
  } else if (attempts < 3) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[handlers] 未找到 chkEnableSyncRecord 元素，延迟重试 (${String(attempts + 1)}/3)...`,
    )
    trackedSetTimeout(() => {
      tryUpdateEnableSyncRecordUI(enabled, attempts + 1)
    }, 100)
  } else {
    bgmLog(LOG_LEVELS.ERROR, `[handlers] 重试3次后仍未找到 chkEnableSyncRecord 元素，放弃更新`)
  }
}

const handleIncrementalChange = (): void => {
  const chkIncremental = document.getElementById('chkIncremental') as HTMLInputElement | null
  if (!chkIncremental) return
  const { checked } = chkIncremental

  bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 增量同步状态变更 ==========`)
  bgmLog(LOG_LEVELS.INFO, `[handlers] 新状态: ${checked ? '开启' : '关闭'}`)

  try {
    const isResult = setIncrementalSync(checked)

    if (isResult) {
      bgmLog(LOG_LEVELS.INFO, `[handlers] 增量同步状态已成功同步到配置和 Ribbon`)
    } else {
      bgmLog(LOG_LEVELS.WARN, `[handlers] 增量同步状态同步失败`)
    }
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[handlers] 更新增量同步状态失败: ${(error as Error).message}`)
  }
}

const handleConflictStrategyChange = (): void => {
  const conflictStrategySelect = document.getElementById(
    'conflictStrategy',
  ) as HTMLSelectElement | null
  if (!conflictStrategySelect) return
  const selectedValue = conflictStrategySelect.value
  const isSkip = selectedValue === 'skip'

  bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 冲突策略变更 ==========`)
  bgmLog(LOG_LEVELS.INFO, `[handlers] 当前值: ${selectedValue}`)
  bgmLog(
    LOG_LEVELS.INFO,
    `[handlers] 策略类型: ${isSkip ? '跳过冲突（保留Bangumi数据）' : 'Excel覆盖（用Excel数据覆盖）'}`,
  )

  const isResult = setSkipConflicts(isSkip)

  if (isResult) {
    bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已成功同步到配置和 Ribbon`)
  } else {
    bgmLog(LOG_LEVELS.WARN, `[handlers] 冲突策略同步失败`)
  }
}

const handleSkipRadioChange = (): void => {
  const skipRadio = document.querySelector<HTMLInputElement>(
    'input[name="conflictStrategy"][value="skip"]',
  )
  if (skipRadio?.checked) {
    setSkipConflicts(true)
    bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已更新: 跳过冲突`)
  }
}

const handleOverwriteRadioChange = (): void => {
  const overwriteRadio = document.querySelector<HTMLInputElement>(
    'input[name="conflictStrategy"][value="overwrite"]',
  )
  if (overwriteRadio?.checked) {
    setSkipConflicts(false)
    bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略已更新: Excel覆盖`)
  }
}

const handleChkSkipConflictsChange = (): void => {
  const chkSkipConflicts = document.getElementById('chkSkipConflicts') as HTMLInputElement | null
  if (!chkSkipConflicts) return
  const { checked } = chkSkipConflicts
  try {
    setSkipConflicts(checked)
    bgmLog(LOG_LEVELS.INFO, `[handlers] 跳过冲突状态已更新: ${checked ? '跳过冲突' : 'Excel覆盖'}`)
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[handlers] 更新跳过冲突状态失败: ${(error as Error).message}`)
  }
}

// 从配置读取增量同步状态并初始化 checkbox
function initIncrementalSyncFromRibbon(): void {
  if (!isPanelContext()) return

  const chkIncremental = document.getElementById('chkIncremental') as HTMLInputElement | null
  if (!chkIncremental) return

  try {
    const isIncremental = getIncrementalSync()
    chkIncremental.checked = isIncremental
    bgmLog(LOG_LEVELS.INFO, `[handlers] 从配置读取增量同步状态: ${isIncremental ? '开启' : '关闭'}`)
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[handlers] 读取增量同步状态失败: ${(error as Error).message}`)
  }

  // 监听 checkbox 变化，同步到配置
  trackedAddEventListener(chkIncremental, 'change', handleIncrementalChange)

  // 同时初始化跳过冲突选项
  initSkipConflictsFromRibbon()
}

// 从配置读取跳过冲突状态并初始化 UI
function initSkipConflictsFromRibbon(): void {
  if (!isPanelContext()) return

  try {
    const isSkipConflicts = getSkipConflicts()
    tryUpdateSkipConflictsUI(isSkipConflicts)
    bgmLog(
      LOG_LEVELS.INFO,
      `[handlers] 从配置读取跳过冲突状态: ${isSkipConflicts ? '跳过冲突' : 'Excel覆盖'}`,
    )
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.WARN,
      context: 'initSkipConflictsFromRibbon',
    })
  }

  // 监听冲突策略 select 的变化（侧边栏使用的是 select 下拉框）
  const conflictStrategySelect = document.getElementById(
    'conflictStrategy',
  ) as HTMLSelectElement | null

  if (conflictStrategySelect) {
    trackedAddEventListener(conflictStrategySelect, 'change', handleConflictStrategyChange)
    bgmLog(LOG_LEVELS.INFO, `[handlers] 已注册冲突策略 select 变化监听器`)
    return
  }

  // 备用：查找并监听 radio 按钮
  const skipRadio = document.querySelector<HTMLInputElement>(
    'input[name="conflictStrategy"][value="skip"]',
  )
  const overwriteRadio = document.querySelector<HTMLInputElement>(
    'input[name="conflictStrategy"][value="overwrite"]',
  )

  if (skipRadio && overwriteRadio) {
    trackedAddEventListener(skipRadio, 'change', handleSkipRadioChange)
    trackedAddEventListener(overwriteRadio, 'change', handleOverwriteRadioChange)
    return
  }

  // 备用：如果是 checkbox
  const chkSkipConflicts = document.getElementById('chkSkipConflicts') as HTMLInputElement | null
  if (chkSkipConflicts) {
    trackedAddEventListener(chkSkipConflicts, 'change', handleChkSkipConflictsChange)
  }
}
