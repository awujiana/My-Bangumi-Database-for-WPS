/**
 * 任务面板主模块 - 聚合入口
 * @module panel/panelPage
 * @description 面板初始化、事件绑定、核心逻辑。
 *
 * 模块拆分结构：
 *   - panel/panelLifecycle.ts：工作表锁定/解锁、表头检测、筛选状态、预览渲染
 *   - panel/userInfoPolling.ts：用户信息恢复与轮询
 *   - panel/enrichPage.ts：新番表富化 UI 控制器
 */

import {
  WPS_ENUM,
  LOG_LEVELS,
  getApp,
  bgmLog,
  BGM,
  updateTokenStatus,
  updateUserIdStatus,
  closeDetailModal,
  removeMessageListener,
  clearAllPendingTimeouts,
} from '../index.js'

import {
  saveLockedSheet,
  restoreLockedSheet,
  updateLockButton,
  refreshSheets,
  refreshWorkbooks,
  autoDetectSheet,
  refreshData,
  onSelectModeChange,
  autoDetectAndLockSheet,
} from './panel-lifecycle.js'
import { restoreUserInfoFromStorage, startUserInfoPolling } from './user-info-polling.js'

// ========== 初始化 ==========

/** Escape 键关闭详情模态框 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeDetailModal()
  }
}

function initPanelCore(): void {
  bgmLog(LOG_LEVELS.INFO, 'initPanelCore 开始')

  // 初始化 WPS 枚举（如果未设置）
  const app = getApp()
  if (app && typeof app.Enum !== 'object') {
    app.Enum = WPS_ENUM
  }

  bgmLog(LOG_LEVELS.INFO, '[panel] 锁定按钮监听器设置完成')

  // 初始化事件监听
  restoreUserInfoFromStorage()
  // 定时轮询 PluginStorage，确保在 Ribbon 设置 Token 后 Panel 能自动更新 UI
  startUserInfoPolling()

  // 恢复上次锁定的工作表
  const isRestored = restoreLockedSheet()
  refreshSheets()
  refreshWorkbooks()

  // 自动检测最佳工作表并锁定
  const detected = autoDetectSheet()
  if (detected) {
    const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
    if (select) select.value = String(detected.sheetIndex)
    BGM.sheet.lockedIndex = detected.sheetIndex
    BGM.sheet.lockedName = detected.sheetName
    BGM.sheet.isLocked = true
    saveLockedSheet({ index: detected.sheetIndex, name: detected.sheetName })
    updateLockButton()
    // 立即刷新一次预览
    refreshData()
  } else if (isRestored && BGM.sheet.isLocked) {
    const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
    if (select) select.value = String(BGM.sheet.lockedIndex)
    refreshData()
  }

  // 更新 Token 和用户 ID 状态显示
  updateTokenStatus()
  updateUserIdStatus()

  // 工作表选择器变更事件
  const sheetSelect = document.getElementById('sheetSelect')
  if (sheetSelect) {
    sheetSelect.addEventListener('change', () => {
      BGM.sheet.lockedIndex = null
      BGM.sheet.lockedName = null
      BGM.sheet.isLocked = false
      saveLockedSheet(null)
      updateLockButton()
      // 切换工作表时刷新预览
      refreshData()
    })
  }

  // 工作簿选择器变更事件：切换工作簿时刷新工作表列表并自动检测表头
  const wbSelect = document.getElementById('workbookSelect')
  if (wbSelect) {
    wbSelect.addEventListener('change', () => {
      refreshSheets()
      // 自动检测新工作簿的表头
      autoDetectAndLockSheet()
    })
  }

  // 模式切换（自动/手动）
  document.querySelectorAll<HTMLInputElement>('input[name="selectMode"]').forEach((radio) => {
    radio.addEventListener('change', onSelectModeChange)
  })

  // 在 initPanel 中添加
  document.getElementById('closeSyncPreview')?.addEventListener('click', () => {
    const modal = document.getElementById('syncPreviewModal')
    if (modal) modal.style.display = 'none'
  })
  // 按 Escape 键关闭详情模态框
  document.addEventListener('keydown', handleKeydown)
  // 面板关闭时移除键盘监听
  window.addEventListener('beforeunload', () => {
    document.removeEventListener('keydown', handleKeydown)
    // 兜底：再次调用 abort，确保任何后续监听器也能触发取消
    BGM.abortController.abort()
  })
  // 面板关闭时清理消息监听器和待执行的 setTimeout，防止内存泄漏
  window.addEventListener('beforeunload', () => {
    removeMessageListener()
    clearAllPendingTimeouts()
  })
  // 通知模块就绪
  document.dispatchEvent(new CustomEvent('bgm:modulesReady'))
  bgmLog(LOG_LEVELS.INFO, 'initPanelCore 完成')
}

// ========== 导出 ==========
export { initPanelCore }

// ========== 挂载到 window ==========
// WPS 宿主（Ribbon）通过 GetTaskPane().initPanelCore 直接调用面板入口，
// 这是宿主桥接协议的一部分，必须有意的全局属性赋值。

;(window as unknown as { initPanelCore: () => void }).initPanelCore = initPanelCore

/**
 * 全局函数：供 Ribbon 通过 GetTaskPane 直接调用，
 * 从 PluginStorage 刷新所有 UI 状态（用户信息、配置等）
 * 如果 GetTaskPane 不可用，轮询也请购底机制。）
 */
// refreshPanelUI 是 Ribbon 宿主桥接入口，同上必须有意的全局属性赋值。

;(window as unknown as { refreshPanelUI: () => void }).refreshPanelUI =
  function refreshPanelUI(): void {
    try {
      restoreUserInfoFromStorage()
      bgmLog(LOG_LEVELS.INFO, '[refreshPanelUI] UI 已刷新')
    } catch (error: unknown) {
      bgmLog(LOG_LEVELS.WARN, `[refreshPanelUI] 刷新失败: ${(error as Error).message}`)
    }
  }

function safeInitPanel(): void {
  try {
    initPanelCore()
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'initPanelCore',
    })
    document.dispatchEvent(new CustomEvent('bgm:modulesReady'))
  }
}

/**
 * 初始化面板。
 *
 * 显式入口函数，由 `ts/entry/panel-entry.ts` 调用。
 * 不在模块加载时自动执行，避免在测试或非 panel 上下文下意外触发副作用。
 *
 * 行为：
 *  - 若文档已加载完成（readyState === 'complete'），立即执行 safeInitPanel()
 *  - 否则推迟到 window load 事件后执行
 */
export function initPanel(): void {
  if (typeof document === 'undefined') {
    // 无 DOM 环境（如 Node 测试环境），直接同步初始化
    safeInitPanel()
    return
  }
  if (document.readyState === 'complete') {
    safeInitPanel()
  } else {
    window.addEventListener('load', safeInitPanel)
  }
}

export {
  toggleSheetLock,
  updateFilterStatus,
  enlargePreview,
  refreshSheets,
  refreshWorkbooks,
  refreshData,
  onSelectModeChange,
  autoDetectSheet,
  autoDetectAndLockSheet,
} from './panel-lifecycle.js'
