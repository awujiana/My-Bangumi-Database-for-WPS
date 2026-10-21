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
  removeMessageListener,
  clearAllPendingTimeouts,
} from '../index.js'

import {
  updateLockButton,
  refreshSheets,
  refreshWorkbooks,
  autoDetectSheet,
  refreshData,
  onSelectModeChange,
  autoDetectAndLockSheet,
} from './panel-lifecycle.js'
import { saveLockedSheet, restoreLockedSheet } from '../tools/locked-sheet.js'
import { mountDataContextNotice } from '../tools/data-context.js'
import { restoreUserInfoFromStorage, startUserInfoPolling } from './user-info-polling.js'
import { registerSheetChangeAutoRefresh, registerVisibilityRefresh } from './panel-auto-refresh.js'

// Escape 关闭模态框统一由 panel-bootstrap 安装的 modal-a11y 负责（document 级委托，覆盖 .modal / .detail-modal）；本模块不再自绑 keydown，避免同一按键两套处理。

/**
 * 自动刷新的闸门：只在「编辑的是当前预览的那张表」且「没有同步在跑」时放行。
 *
 * 同步进行中不刷新——同步流程自己会更新预览，两条路径同时读写同一张表会互相
 * 抢 COM，也会把用户正在跑的进度数据覆盖成中间态。
 */
function shouldRefresh(): boolean {
  if (BGM.sync.isRunning) return false
  const activeSheet = (getApp() as { ActiveSheet?: { Name?: string } } | null)?.ActiveSheet
  const activeName = activeSheet?.Name ?? ''
  if (!activeName) return false
  if (BGM.sheet.isLocked && BGM.sheet.lockedName) {
    return activeName === BGM.sheet.lockedName
  }
  const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
  const selectedName = select?.options[select.selectedIndex]?.text ?? ''
  return selectedName !== '' && activeName === selectedName
}

// ========== 初始化 ==========

function initializePanelCore(): void {
  bgmLog(LOG_LEVELS.INFO, 'initializePanelCore 开始')

  // 进入时重放：其它页获取的工作簿/表/列/行一次性显示（读一次存储，零轮询）
  mountDataContextNotice('panel')

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

  // 恢复上次锁定的工作表：只读 PluginStorage，成本低，保持同步（BGM.sheet 状态立即可用）
  const isRestored = restoreLockedSheet('panel')

  /**
   * 刷新工作表列表 → 自动检测最佳工作表 → 首帧预览。
   *
   * 这几步全在跨进程 COM 上：`autoDetectSheet` → `findBangumiTargetSheets` 会遍历
   * **每个已打开工作簿的每一张工作表**（读表头、数数据行、比名称关键词），工作簿越多
   * 耗时越长。同步执行会把任务窗格的**首帧**一起拖住（P2-13），故放到首屏之后跑。
   *
   * 用 `setTimeout(…, 0)`（宏任务）而非微任务：微任务仍在本次渲染前执行，达不到
   * 「先出界面、再扫描」的效果。
   */
  const bootstrapSheetSelection = (): void => {
    refreshSheets()
    refreshWorkbooks()

    // 自动检测最佳工作表并锁定
    const detected = autoDetectSheet()
    if (!detected) {
      // 未检测到追踪表：沿用上次锁定的工作表，仅刷新预览
      if (isRestored && BGM.sheet.isLocked) {
        const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
        if (select) select.value = String(BGM.sheet.lockedIndex)
        refreshData()
      }
      return
    }

    const wbSelect = document.getElementById('workbookSelect') as HTMLSelectElement | null
    if (wbSelect && detected.workbookName) wbSelect.value = detected.workbookName
    BGM.sheet.lockedIndex = detected.sheetIndex
    BGM.sheet.lockedName = detected.sheetName
    BGM.sheet.lockedWorkbookName = detected.workbookName || null
    BGM.sheet.isLocked = true
    saveLockedSheet(
      {
        index: detected.sheetIndex,
        name: detected.sheetName,
        ...(detected.workbookName && { workbookName: detected.workbookName }),
      },
      'panel',
    )
    refreshSheets()
    const select = document.getElementById('sheetSelect') as HTMLSelectElement | null
    if (select) select.value = String(detected.sheetIndex)
    updateLockButton()
    // 立即刷新一次预览
    refreshData()
  }

  window.setTimeout(bootstrapSheetSelection, 0)

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
      saveLockedSheet(null, 'panel')
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

  // 预览自动刷新：防抖 400ms，只在「编辑的是当前预览的表」且没有同步在跑时
  // 刷新（同步流程自己会更新预览，避免与其 COM 读写抢跑）。
  // 两条触发源互补：SheetChange 覆盖「面板可见时旁边改数据」，
  // window.focus / visibilitychange 覆盖「切走编辑 → 切回面板」（后者零宿主依赖，保底）。
  registerSheetChangeAutoRefresh(getApp(), refreshData, { shouldRefresh })
  registerVisibilityRefresh(refreshData, { shouldRefresh })

  // 模式切换（自动/手动）
  document.querySelectorAll<HTMLInputElement>('input[name="selectMode"]').forEach((radio) => {
    radio.addEventListener('change', onSelectModeChange)
  })

  // 在 initializePanel 中添加
  document.getElementById('closeSyncPreview')?.addEventListener('click', () => {
    const modal = document.getElementById('syncPreviewModal')
    if (modal) modal.style.display = 'none'
  })
  // 面板关闭时中止请求，防止内存泄漏
  window.addEventListener('beforeunload', () => {
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
  bgmLog(LOG_LEVELS.INFO, 'initializePanelCore 完成')
}

// ========== 导出 ==========
export { initializePanelCore }

// ========== 挂载到 window ==========
// WPS 宿主（Ribbon）通过 GetTaskPane().initializePanelCore / refreshPanelUI 直接调用面板入口，
// 宿主桥接协议要求属性可写可配置，defineProperties 显式声明挂载契约
Object.defineProperties(window, {
  initializePanelCore: {
    value: initializePanelCore,
    writable: true,
    configurable: true,
  },
  refreshPanelUI: {
    value: function refreshPanelUI(): void {
      try {
        restoreUserInfoFromStorage()
        bgmLog(LOG_LEVELS.INFO, '[refreshPanelUI] UI 已刷新')
      } catch (error: unknown) {
        bgmLog(LOG_LEVELS.WARN, `[refreshPanelUI] 刷新失败: ${(error as Error).message}`)
      }
    },
    writable: true,
    configurable: true,
  },
})

function safeInitializePanel(): void {
  try {
    initializePanelCore()
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.INFO,
      context: 'initializePanelCore',
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
 *  - 若文档已加载完成（readyState === 'complete'），立即执行 safeInitializePanel()
 *  - 否则推迟到 window load 事件后执行
 */
export function initializePanel(): void {
  if (typeof document === 'undefined') {
    // 无 DOM 环境（如 Node 测试环境），直接同步初始化
    safeInitializePanel()
    return
  }
  if (document.readyState === 'complete') {
    safeInitializePanel()
  } else {
    window.addEventListener('load', safeInitializePanel)
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
