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
  showConfirm,
  refreshData,
  previewSyncContent,
  isSyncRecordEnabled,
  getTheme,
  getListType,
  getTimeFilter,
  getRefreshInterval,
  getLogLevel,
} from '../../index.js'
import { loadGithubConfigIntoForm } from './github-settings.js'
import { initModuleOrderEditor } from './module-order.js'
import { initConfigPathControls } from './path-controls.js'
import { clearTrackedListeners, trackedAddEventListener } from './resource-tracking.js'

// 子模块
import { _T } from './_constants.js'
import { handleActionClick } from './action-handlers.js'
import { loadEnrichPreviewSettingsIntoForm } from './enrich-preview-settings.js'
import { initIncrementalSyncFromRibbon } from './incremental-bindings.js'
import { setupEventListeners, setupMessageListener } from './panel-events.js'
import {
  handleEnableSyncRecordChange,
  handleListTypeChange,
  handleLogLevelChange,
  handleLogLevelFilterChange,
  handleRefreshIntervalChange,
  handleThemeChange,
  handleThemePreviewClick,
  handleTimeFilterChange,
  setupTimeFilterControls,
  updateThemePreview,
} from './settings-bindings.js'
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
export { removeMessageListener } from './panel-events.js'

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

  // 设置页：全局日志级别（记录级别偏好）
  const logLevelSelect = document.getElementById('logLevelSelect') as HTMLSelectElement | null
  if (logLevelSelect) {
    logLevelSelect.value = String(getLogLevel(true))
    trackedAddEventListener(logLevelSelect, 'change', handleLogLevelChange)
    bgmLog(LOG_LEVELS.INFO, '[handlers] 日志级别 change 监听器已注册')
  }

  // 设置页：模块排序编辑器（↑↓ 按钮 + 拖拽）
  try {
    initModuleOrderEditor()
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[handlers] 初始化模块排序编辑器失败: ${(error as Error).message}`)
  }

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

export { showConnectionTestDialog, hideConnectionTestDialog } from '../github-config-dialog.js'
