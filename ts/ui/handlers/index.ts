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
  _setBgmUserId,
  _setBgmUsername,
  showConfirm,
  showToast,
  refreshData,
  previewSyncContent,
  setSyncRecordEnabled,
  isSyncRecordEnabled,
  isIncrementalSyncEnabled,
  setIncrementalSync,
  isSkipConflictsEnabled,
  setSkipConflicts,
  getTheme,
  setListType,
  getListType,
  setTimeFilter,
  getTimeFilter,
  setRefreshInterval,
  getRefreshInterval,
  saveTheme,
  updateSyncProgressDialog,
} from '../../index.js'
import { BGM_EVENTS } from '../../tools/events.js'
import { loadGithubConfigIntoForm } from './github-settings.js'
import { initConfigPathControls } from './path-controls.js'
import {
  clearTrackedListeners,
  trackedAddEventListener,
  trackedEventBusOn,
  trackedSetTimeout,
} from './resource-tracking.js'

// 子模块
import { _T } from './_constants.js'
import { ACTION_HANDLERS, handleActionClick } from './action-handlers.js'
import { loadEnrichPreviewSettingsIntoForm } from './enrich-preview-settings.js'
import { renderLogEntries } from './log-panel.js'
import { syncFromPanel } from './sync.js'
import {
  showTokenDialog,
  showUserIdDialog,
  updateTokenStatus,
  updateUserIdStatus,
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
export { clearAllPendingTimeouts } from './resource-tracking.js'

// 连接测试弹窗

// ========== 面板操作分发 ==========

export function onAction(action: string): void {
  switch (action) {
    case 'sync': {
      void syncFromPanel()
      break
    }
    case 'clear': {
      showConfirm(_T.confirmClearMarks, (confirmed) => {
        if (confirmed && typeof refreshData === 'function') refreshData()
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
        if (confirmed && typeof refreshData === 'function') refreshData()
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
    default: {
      // 未知 action 不处理（与旧逻辑一致：无默认分支即什么都不做）
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
  const mode = select?.value || 'dark' // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空串表示未选择/未填写，须回退默认（`??` 会保留空串）
  // 乐观更新预览卡片，即使持久化失败也保持视觉一致
  updateThemePreview(mode)
  const isOk = saveTheme(mode)
  if (isOk) {
    const labels: Record<string, string> = {
      dark: '深色模式',
      light: '浅色模式',
      system: '跟随系统',
    }
    showToast(`主题已切换为「${labels[mode] || mode}」`, 'success') // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空串表示未选择/未填写，须回退默认（`??` 会保留空串）
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
    showToast(`默认收藏列表类型：${labels[select.value] || select.value}`, 'success') // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空串表示未选择/未填写，须回退默认（`??` 会保留空串）
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
    showToast(`默认时间筛选范围：${labels[select.value] || select.value}`, 'success') // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空串表示未选择/未填写，须回退默认（`??` 会保留空串）
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
      const isEnabled = isSyncRecordEnabled()
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
    loadGithubConfigIntoForm()
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

  // 设置页「🎨 富化预览」：表单回填（元素不存在时模块内部自动跳过，面板页无副作用）
  loadEnrichPreviewSettingsIntoForm()
  document.querySelectorAll<HTMLElement>('[data-theme-card]').forEach((card) => {
    trackedAddEventListener(card, 'click', handleThemePreviewClick)
  })
  updateThemePreview(getTheme(true))

  // 设置页：默认导出位置 / 默认导入文件夹（回填已记忆的路径）
  initConfigPathControls()

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
  if (!chkTimeFilter || !timeFilterControls) return

  // 仅在通过校验后声明后续变量（符合 unicorn/no-declarations-before-early-exit）
  const rangeSelect = document.getElementById('timeFilterRange') as HTMLSelectElement | null
  const yearRow = document.getElementById('yearRow')
  const quarterRow = document.getElementById('quarterRow')
  const monthRow = document.getElementById('monthRow')
  const futureHintRow = document.getElementById('futureHintRow')

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

function startHandlers(): void {
  // 先清理旧监听器，防止面板重新初始化时重复注册
  clearTrackedListeners()
  setupButtonListeners()
  setupTimeFilterControls()
  setupMessageListener()
  setupEventListeners()
  initIncrementalSyncFromRibbon()
  bgmLog(LOG_LEVELS.INFO, '[handlers] initHandlers 完成')
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
  if (typeof document === 'undefined') {
    // 无 DOM 环境（如 Node 测试环境）下同步执行
    startHandlers()
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      startHandlers()
    })
  } else {
    startHandlers()
  }
}

function isPanelContext(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.includes('panel.html')
}

// ========== 消息监听 ==========
let _messageHandler: ((event: MessageEvent) => void) | null = null

function setupMessageListener(): void {
  if (typeof window === 'undefined') {
    return
  }

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
    // 用类型断言保留 unknown 注解，避免解构 any（event.data 为 any，直接解构会触发 no-unsafe-assignment）
    const { data } = event as { data: unknown }
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
      default: {
        // 未知消息类型：忽略
        break
      }
    }
  }
  window.addEventListener('message', _messageHandler)

  bgmLog(LOG_LEVELS.INFO, '[handlers] 消息监听器已注册')
}

/**
 * 移除消息监听器，防止面板关闭后内存泄漏
 */
export function removeMessageListener(): void {
  if (!_messageHandler) {
    return
  }

  window.removeEventListener('message', _messageHandler)
  _messageHandler = null
  bgmLog(LOG_LEVELS.INFO, '[handlers] 消息监听器已移除')
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

const handleUsernameUpdatedEvent = (): void => {
  bgmLog(LOG_LEVELS.INFO, '[handlers] 收到 USER_NAME_UPDATED 事件')
  updateUserIdStatus()
}

const handleConfigUpdatedEvent = (data: { key: string; value: string }): void => {
  if (!isPanelContext()) return

  bgmLog(
    LOG_LEVELS.INFO,
    `[handlers] 收到 CONFIG_UPDATED 事件: key=${data.key}, value=${data.value}`,
  )

  switch (data.key) {
    case 'bgm_incremental_sync': {
      bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新增量同步复选框 ==========`)
      tryUpdateIncrementalCheckbox(data.value === 'true')

      break
    }
    case 'bgm_skip_conflicts': {
      bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新跳过冲突 UI ==========`)
      tryUpdateSkipConflictsUI(data.value === 'true')

      break
    }
    case 'bgm_enable_sync_record': {
      bgmLog(LOG_LEVELS.INFO, `[handlers] ========== 更新启用同步记录复选框 ==========`)
      tryUpdateEnableSyncRecordUI(data.value === 'true')

      break
    }
    default: {
      // 未知配置键：忽略（与旧逻辑一致，原注释即 No default）
      break
    }
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
  trackedEventBusOn(BGM_EVENTS.USER_NAME_UPDATED, handleUsernameUpdatedEvent)
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
function tryUpdateIncrementalCheckbox(isChecked: boolean, attempts = 0): void {
  if (!isPanelContext()) return

  const chkIncremental = document.getElementById('chkIncremental') as HTMLInputElement | null

  if (chkIncremental) {
    bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 chkIncremental 元素`)
    bgmLog(LOG_LEVELS.INFO, `[handlers] 当前状态: ${chkIncremental.checked ? '开启' : '关闭'}`)

    chkIncremental.checked = isChecked

    bgmLog(LOG_LEVELS.INFO, `[handlers] 增量同步复选框已更新: ${isChecked ? '开启' : '关闭'}`)
  } else if (attempts < 3) {
    // 最多重试3次
    bgmLog(
      LOG_LEVELS.WARN,
      `[handlers] 未找到 chkIncremental 元素，延迟重试 (${String(attempts + 1)}/3)...`,
    )
    trackedSetTimeout(() => {
      tryUpdateIncrementalCheckbox(isChecked, attempts + 1)
    }, 100)
  } else {
    bgmLog(LOG_LEVELS.ERROR, `[handlers] 重试3次后仍未找到 chkIncremental 元素，放弃更新`)
  }
}

// 尝试更新跳过冲突 UI（带重试机制）
function tryUpdateSkipConflictsUI(shouldSkipConflicts: boolean, attempts = 0): void {
  if (!isPanelContext()) return

  bgmLog(LOG_LEVELS.INFO, `[handlers] 目标状态: ${shouldSkipConflicts ? '跳过冲突' : 'Excel覆盖'}`)

  const conflictStrategySelect = document.getElementById(
    'conflictStrategy',
  ) as HTMLSelectElement | null

  if (conflictStrategySelect) {
    bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 conflictStrategy select 元素`)
    bgmLog(LOG_LEVELS.INFO, `[handlers] 当前值: ${conflictStrategySelect.value}`)

    conflictStrategySelect.value = shouldSkipConflicts ? 'skip' : 'excel'

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
      tryUpdateSkipConflictsUI(shouldSkipConflicts, attempts + 1)
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
    skipRadio.checked = shouldSkipConflicts
    overwriteRadio.checked = !shouldSkipConflicts
    bgmLog(LOG_LEVELS.INFO, `[handlers] 冲突策略 radio 已更新`)
    return
  }

  // 备用：如果是 checkbox
  const chkSkipConflicts = document.getElementById('chkSkipConflicts') as HTMLInputElement | null
  if (chkSkipConflicts) {
    chkSkipConflicts.checked = shouldSkipConflicts
    bgmLog(LOG_LEVELS.INFO, `[handlers] 跳过冲突复选框已更新`)
  }
}

// 尝试更新启用同步记录复选框（带重试机制，与另外两个开关保持一致）
function tryUpdateEnableSyncRecordUI(isEnabled: boolean, attempts = 0): void {
  if (!isPanelContext()) return

  const chkEnableSyncRecord = document.getElementById(
    'chkEnableSyncRecord',
  ) as HTMLInputElement | null

  if (chkEnableSyncRecord) {
    bgmLog(LOG_LEVELS.INFO, `[handlers] 找到 chkEnableSyncRecord 元素`)
    bgmLog(
      LOG_LEVELS.INFO,
      `[handlers] 当前状态: ${chkEnableSyncRecord.checked ? '开启' : '关闭'}，目标状态: ${isEnabled ? '开启' : '关闭'}`,
    )
    chkEnableSyncRecord.checked = isEnabled
    bgmLog(LOG_LEVELS.INFO, `[handlers] 启用同步记录复选框已更新: ${isEnabled ? '开启' : '关闭'}`)
  } else if (attempts < 3) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[handlers] 未找到 chkEnableSyncRecord 元素，延迟重试 (${String(attempts + 1)}/3)...`,
    )
    trackedSetTimeout(() => {
      tryUpdateEnableSyncRecordUI(isEnabled, attempts + 1)
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
    const isIncremental = isIncrementalSyncEnabled()
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
    const isSkipConflicts = isSkipConflictsEnabled()
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

export { showConnectionTestDialog, hideConnectionTestDialog } from '../github-config-dialog.js'
