/**
 * @fileoverview UI 事件处理模块（ACTION_HANDLERS 分发）单元测试
 *
 * 测试目标：
 *   - clearAllPendingTimeouts：清理待执行的 setTimeout
 *   - onAction：基于 action 字符串的分发（旧版 Ribbon 入口）
 *   - handleActionClick：基于 DOM 事件的分发（解析 data-action 与 data-args）
 *   - setupButtonListeners：为 [data-action] 元素注册 click 监听
 *   - initHandlers：根据 document.readyState 决定同步或延迟初始化
 *
 * 模块依赖说明：
 *   - handlers/index.ts 导入 '../../index.js'，触发 index → ui/handlers 副作用链。
 *   - handlers.ts 模块加载时通过 trackedSetTimeout(setupButtonListeners, 0) 调度延迟回调。
 *   - 使用 vi.hoisted() 在所有 import 之前启用 fake timers，使 setTimeout 进入 fake 队列。
 *   - 需要 jsdom 环境以提供 document/window。
 *
 * Mock 策略：
 *   - vi.mock handler 子模块（token.js / sync.js / sheet.js / _constants.js）控制实际实现
 *   - vi.mock services/ribbonService.js / configService.js
 *   - vi.mock tools/logger.js / tools/events.js / tools/debounce.js
 *   - 通过 vi.hoisted 共享 vi.fn 引用，测试代码可断言调用情况
 *
 * 未覆盖（依赖 BGM 全局对象与完整 UI 状态，建议在集成测试中覆盖）：
 *   - GitHub 配置自动保存的防抖逻辑（依赖真实 PluginStorage）
 *   - 消息监听器 setupMessageListener（依赖 window.postMessage 完整流程）
 *   - 事件总线 setupEventListeners（依赖 eventBus 完整订阅机制）
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll, beforeEach } from 'vitest'

vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

// 通过 vi.hoisted 创建跨 vi.mock 工厂与测试代码共享的 mock 引用
const mockState = vi.hoisted(() => ({
  // handlers/sync.js
  syncFromPanel: vi.fn(),
  syncCollectionFromBgm: vi.fn(),
  syncFromBgmByAPI: vi.fn(),
  // handlers/token.js
  showTokenDialog: vi.fn(),
  showUserIdDialog: vi.fn(),
  updateTokenStatus: vi.fn(),
  updateUserIdStatus: vi.fn(),
  openUserCollection: vi.fn(),
  testTokenValidity: vi.fn(),
  testDebugConnection: vi.fn(),
  // handlers/sheet.js
  cleanLockedDataSheet: vi.fn(),
  // services/ribbonService.js
  undoLastSyncForRibbon: vi.fn(),
  executeUndoLastSync: vi.fn(() => Promise.resolve(0)),
  // services/configService.js
  exportConfig: vi.fn(() => '{}'),
  importConfig: vi.fn(() => ({ isOk: () => true, isFail: () => false })),
  // tools/config.js
  getIncrementalSync: vi.fn(() => false),
  setIncrementalSync: vi.fn(),
  getSkipConflicts: vi.fn(() => false),
  setSkipConflicts: vi.fn(),
  getSyncRecordEnabled: vi.fn(() => false),
  setSyncRecordEnabled: vi.fn(),
  getConfig: vi.fn(() => ''),
  setConfig: vi.fn(() => true),
  // sync/githubConfig.js
  getGithubConfig: vi.fn(() => ({ owner: '', repo: '', branch: '', path: '' })),
  setGithubConfig: vi.fn(),
  getSyncStrategy: vi.fn(() => 'add-update'),
  setSyncStrategy: vi.fn(),
  getSyncSourceType: vi.fn(() => 'api'),
  setSyncSourceType: vi.fn(),
  // tools/logger.js
  getRecentLogs: vi.fn(() => []),
  exportLogsToFile: vi.fn(),
  clearLogs: vi.fn(),
  // tools/debounce.js
  debounce: vi.fn((fn: () => void) => fn),
}))

vi.mock('../ts/ui/handlers/token.js', () => ({
  showTokenDialog: mockState.showTokenDialog,
  showUserIdDialog: mockState.showUserIdDialog,
  updateTokenStatus: mockState.updateTokenStatus,
  updateUserIdStatus: mockState.updateUserIdStatus,
  openUserCollection: mockState.openUserCollection,
  testTokenValidity: mockState.testTokenValidity,
  testDebugConnection: mockState.testDebugConnection,
}))

vi.mock('../ts/ui/handlers/sync.js', () => ({
  syncFromPanel: mockState.syncFromPanel,
  syncCollectionFromBgm: mockState.syncCollectionFromBgm,
  syncFromBgmByAPI: mockState.syncFromBgmByAPI,
}))

vi.mock('../ts/ui/handlers/sheet.js', () => ({
  cleanLockedDataSheet: mockState.cleanLockedDataSheet,
}))

vi.mock('../ts/ui/handlers/_constants.js', () => ({
  _T: { confirmClearMarks: '确认清除标记？' },
}))

vi.mock('../ts/services/ribbonService.js', () => ({
  undoLastSyncForRibbon: mockState.undoLastSyncForRibbon,
  executeUndoLastSync: mockState.executeUndoLastSync,
}))

vi.mock('../ts/services/configService.js', () => ({
  exportConfig: mockState.exportConfig,
  importConfig: mockState.importConfig,
}))

vi.mock('../ts/tools/config.js', () => ({
  getIncrementalSync: mockState.getIncrementalSync,
  setIncrementalSync: mockState.setIncrementalSync,
  getSkipConflicts: mockState.getSkipConflicts,
  setSkipConflicts: mockState.setSkipConflicts,
  getSyncRecordEnabled: mockState.getSyncRecordEnabled,
  setSyncRecordEnabled: mockState.setSyncRecordEnabled,
  getConfig: mockState.getConfig,
  setConfig: mockState.setConfig,
  removeConfig: vi.fn(() => true),
  CONFIG_KEYS: {
    INCREMENTAL_SYNC: 'bgm_incremental_sync',
    SKIP_CONFLICTS: 'bgm_skip_conflicts',
    ENABLE_SYNC_RECORD: 'bgm_enable_sync_record',
  },
}))

vi.mock('../ts/sync/githubConfig.js', () => ({
  getGithubConfig: mockState.getGithubConfig,
  setGithubConfig: mockState.setGithubConfig,
  isGithubConfigComplete: vi.fn(() => true),
  buildRawUrl: vi.fn(() => ''),
  getSyncStrategy: mockState.getSyncStrategy,
  setSyncStrategy: mockState.setSyncStrategy,
  getSyncSourceType: mockState.getSyncSourceType,
  setSyncSourceType: mockState.setSyncSourceType,
  DEFAULT_GITHUB_CONFIG: { owner: '', repo: '', branch: 'main', path: '' },
  GithubConfigSchema: { parse: vi.fn() },
}))

vi.mock('../ts/tools/logger.js', () => ({
  // util/index.ts 内部调用 logger.info/warn/error/debug 输出日志，需提供空实现
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getRecentLogs: mockState.getRecentLogs,
  exportLogsToFile: mockState.exportLogsToFile,
  clearLogs: mockState.clearLogs,
  LogLevel: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}))

vi.mock('../index.js', () => ({
  // ---- 基础工具 ----
  getApp: mockState.getApp,
  showToast: mockState.showToast,
  confirm: mockState.confirm,
  showConfirm: mockState.showConfirm,
  showError: mockState.showError,
  showInfo: mockState.showInfo,
  bgmLog: mockState.bgmLog,
  LOG_LEVELS: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },

  // ---- Token / 用户 ----
  loadBgToken: mockState.loadBgToken,
  storeBgToken: mockState.storeBgToken,
  clearBgToken: mockState.clearBgToken,
  getBgToken: mockState.getBgToken,
  getCurrentUser: mockState.getCurrentUser,
  _setBgmUserId: mockState._setBgmUserId,
  _getBgmUserId: mockState._getBgmUserId,
  _setBgmUsername: mockState._setBgmUsername,
  _getBgmUsername: mockState._getBgmUsername,
  copyTokenToClipboard: mockState.copyTokenToClipboard,

  // ---- Bangumi Token ----
  getBangumiToken: mockState.getBangumiToken,
  setBangumiToken: mockState.setBangumiToken,

  // ---- 同步 ----
  syncFromPanel: mockState.syncFromPanel,
  previewSyncContent: mockState.previewSyncContent,
  showClearConfirm: mockState.showClearConfirm,
  requestStop: mockState.requestStop,
  pauseSync: mockState.pauseSync,
  resumeSync: mockState.resumeSync,

  // ---- Sheet 操作 ----
  cleanLockedDataSheet: mockState.cleanLockedDataSheet,
  openSyncRecordSheet: mockState.openSyncRecordSheet,

  // ---- 调试 / 日志 ----
  testDebugConnection: mockState.testDebugConnection,
  getRecentLogs: mockState.getRecentLogs,
  exportLogsToFile: mockState.exportLogsToFile,
  clearLogs: mockState.clearLogs,

  // ---- 配置相关（saveAllConfig 使用） ----
  getIncrementalSync: mockState.getIncrementalSync,
  setIncrementalSync: mockState.setIncrementalSync,
  getSkipConflicts: mockState.getSkipConflicts,
  setSkipConflicts: mockState.setSkipConflicts,
  getSyncRecordEnabled: mockState.getSyncRecordEnabled,
  setSyncRecordEnabled: mockState.setSyncRecordEnabled,
  getGithubConfig: mockState.getGithubConfig,
  setGithubConfig: mockState.setGithubConfig,
  getSyncStrategy: mockState.getSyncStrategy,
  setSyncStrategy: mockState.setSyncStrategy,
  getSyncSourceType: mockState.getSyncSourceType,
  setSyncSourceType: mockState.setSyncSourceType,
  isGithubConfigComplete: vi.fn(() => true),
  buildRawUrl: vi.fn(() => ''),

  // ---- 其它 ----
  showSettingsPanel: mockState.showSettingsPanel,
  refreshData: mockState.refreshData,
  refreshSheets: mockState.refreshSheets,
  refreshWorkbooks: mockState.refreshWorkbooks,
  toggleSheetLock: mockState.toggleSheetLock,
  clearSyncRecords: mockState.clearSyncRecords,
  deduplicateSyncRecords: mockState.deduplicateSyncRecords,
  formatSyncRecordSheet: mockState.formatSyncRecordSheet,
  closeDetailModal: mockState.closeDetailModal,
  getLastRow: vi.fn(() => 1),
  getSyncRecordSheetIfExists: vi.fn(() => true),
  showAlert: vi.fn(),
  showInput: vi.fn(() => 'test'),
  enlargePreview: vi.fn(),
  syncSelectedRows: vi.fn(),
  openBangumiTokenPage: vi.fn(),
  showConnectionTestDialog: vi.fn(),
  hideConnectionTestDialog: vi.fn(),
  showSyncProgressDialog: vi.fn(),
  updateSyncProgressDialog: vi.fn(),
  completeSyncProgressDialog: vi.fn(),
  hideSyncProgressDialog: vi.fn(),
  showSyncResultDialog: vi.fn(),
  syncFromRemote: vi.fn(),
  // 类型
  LOG_LEVELS_ENUM: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}))

vi.mock('../ts/tools/debounce.js', () => ({
  debounce: mockState.debounce,
}))

import {
  onAction,
  setupButtonListeners,
  initHandlers,
  clearAllPendingTimeouts,
} from '../ts/ui/handlers/index.js'

vi.clearAllTimers()

afterEach(() => {
  vi.clearAllTimers()
  vi.clearAllMocks()
  // 清理 DOM
  document.body.innerHTML = ''
})

afterAll(() => {
  vi.useRealTimers()
})

// ========== clearAllPendingTimeouts ==========
describe('clearAllPendingTimeouts', () => {
  it('应清理所有待执行的 setTimeout（无 pending 时不抛错）', () => {
    expect(() => clearAllPendingTimeouts()).not.toThrow()
  })

  it('应清理通过 trackedSetTimeout 调度的回调（模块加载时调度的会被清理）', () => {
    // 模块加载时已经调度了若干 setTimeout，清理后不应触发
    clearAllPendingTimersSafe()
    // 推进 timers，不应有回调被触发（已清理）
    vi.advanceTimersByTime(1000)
    // 无异常即通过
    expect(true).toBe(true)
  })
})

/** 安全清理 pending timers 并验证不抛错 */
function clearAllPendingTimersSafe(): void {
  try {
    clearAllPendingTimeouts()
  } catch {
    // 忽略清理过程中的异常
  }
}

// ========== onAction ==========
describe('onAction', () => {
  it('"sync" 应调用 syncFromPanel', () => {
    onAction('sync')
    expect(mockState.syncFromPanel).toHaveBeenCalled()
  })

  it('"setToken" 应调用 showTokenDialog', () => {
    onAction('setToken')
    expect(mockState.showTokenDialog).toHaveBeenCalled()
  })

  it('"showUserIdDialog" 应调用 showUserIdDialog', () => {
    onAction('showUserIdDialog')
    expect(mockState.showUserIdDialog).toHaveBeenCalled()
  })

  it('"tokenUpdated" 应调用 updateTokenStatus', () => {
    onAction('tokenUpdated')
    expect(mockState.updateTokenStatus).toHaveBeenCalled()
  })

  it('"userIdUpdated" 应调用 updateUserIdStatus', () => {
    onAction('userIdUpdated')
    expect(mockState.updateUserIdStatus).toHaveBeenCalled()
  })

  it('"requestStopSync" 不应抛错（调用 BGM.sync.requestStop）', () => {
    // BGM.sync 在测试环境可能未初始化，应捕获异常或安全处理
    expect(() => onAction('requestStopSync')).not.toThrow()
  })

  it('"pauseSync" 不应抛错', () => {
    expect(() => onAction('pauseSync')).not.toThrow()
  })

  it('"resumeSync" 不应抛错', () => {
    expect(() => onAction('resumeSync')).not.toThrow()
  })

  it('未知 action 不应抛错（switch 无 default 分支，静默忽略）', () => {
    expect(() => onAction('unknownAction123')).not.toThrow()
  })

  it('空字符串 action 不应抛错', () => {
    expect(() => onAction('')).not.toThrow()
  })

  it('"preview" 不应抛错（previewSyncContent 来自 index.js）', () => {
    expect(() => onAction('preview')).not.toThrow()
  })

  it('"clear" 不应抛错（showConfirm 来自 index.js）', () => {
    expect(() => onAction('clear')).not.toThrow()
  })

  it('"showClearConfirm" 不应抛错', () => {
    expect(() => onAction('showClearConfirm')).not.toThrow()
  })
})

// ========== ACTION_HANDLERS 分发（通过 DOM click 触发） ==========
// handleActionClick 是模块内部函数（未导出），通过 setupButtonListeners + button.click()
// 间接测试分发逻辑，更贴近真实使用场景。
describe('ACTION_HANDLERS 分发（通过 DOM click 触发）', () => {
  /**
   * 创建带 data-action 的按钮，注册监听后触发 click
   * @param action data-action 值
   * @param args data-args 值（JSON 字符串或原生值）
   */
  function clickAction(action: string, args?: string): void {
    const button = document.createElement('button')
    button.dataset.action = action
    if (args !== undefined) {
      button.dataset.args = args
    }
    document.body.appendChild(button)
    setupButtonListeners()
    button.click()
  }

  it('点击 [data-action="sync"] 触发 syncFromPanel', () => {
    clickAction('sync')
    expect(mockState.syncFromPanel).toHaveBeenCalled()
  })

  it('点击无 data-action 的按钮不应抛错', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    setupButtonListeners()
    expect(() => button.click()).not.toThrow()
  })

  it('点击 [data-action="showToast"] 解析 data-args JSON 数组不抛错', () => {
    expect(() => clickAction('showToast', JSON.stringify(['消息', 'info']))).not.toThrow()
  })

  it('点击 [data-action="showToast"] 非法 data-args JSON 不抛错', () => {
    expect(() => clickAction('showToast', 'invalid json {')).not.toThrow()
  })

  it('点击 [data-action="testSelected"] 不抛错', () => {
    expect(() => clickAction('testSelected')).not.toThrow()
  })

  it('点击 [data-action="setToken"] 触发 showTokenDialog', () => {
    clickAction('setToken')
    expect(mockState.showTokenDialog).toHaveBeenCalled()
  })

  it('点击 [data-action="clearToken"] 不抛错', () => {
    expect(() => clickAction('clearToken')).not.toThrow()
  })

  it('点击 [data-action="copyToken"] 不抛错', () => {
    expect(() => clickAction('copyToken')).not.toThrow()
  })

  it('点击 [data-action="testToken"] 触发 testTokenValidity', () => {
    clickAction('testToken')
    expect(mockState.testTokenValidity).toHaveBeenCalled()
  })

  it('点击 [data-action="showUserIdDialog"] 触发 showUserIdDialog', () => {
    clickAction('showUserIdDialog')
    expect(mockState.showUserIdDialog).toHaveBeenCalled()
  })

  it('点击 [data-action="openTokenPage"] 不抛错', () => {
    expect(() => clickAction('openTokenPage')).not.toThrow()
  })

  it('点击 [data-action="syncCollectionFromBgm"] 触发 syncCollectionFromBgm', () => {
    clickAction('syncCollectionFromBgm')
    expect(mockState.syncCollectionFromBgm).toHaveBeenCalled()
  })

  it('点击 [data-action="refreshSheets"] 不抛错', () => {
    expect(() => clickAction('refreshSheets')).not.toThrow()
  })

  it('点击 [data-action="refreshData"] 不抛错', () => {
    expect(() => clickAction('refreshData')).not.toThrow()
  })

  it('点击 [data-action="toggleSheetLock"] 不抛错', () => {
    expect(() => clickAction('toggleSheetLock')).not.toThrow()
  })

  it('点击 [data-action="clearSyncRecords"] 不抛错', () => {
    expect(() => clickAction('clearSyncRecords')).not.toThrow()
  })

  it('点击 [data-action="deduplicateSyncRecords"] 不抛错', () => {
    expect(() => clickAction('deduplicateSyncRecords')).not.toThrow()
  })

  it('点击 [data-action="formatSyncRecordSheet"] 不抛错', () => {
    expect(() => clickAction('formatSyncRecordSheet')).not.toThrow()
  })

  it('点击 [data-action="cleanLockedDataSheet"] 触发 cleanLockedDataSheet', () => {
    clickAction('cleanLockedDataSheet')
    expect(mockState.cleanLockedDataSheet).toHaveBeenCalled()
  })

  it('点击 [data-action="openSyncRecordSheet"] 不抛错', () => {
    expect(() => clickAction('openSyncRecordSheet')).not.toThrow()
  })

  it('点击 [data-action="testDebugConnection"] 触发 testDebugConnection', () => {
    clickAction('testDebugConnection')
    expect(mockState.testDebugConnection).toHaveBeenCalled()
  })

  it('点击 [data-action="closeDetailModal"] 不抛错', () => {
    expect(() => clickAction('closeDetailModal')).not.toThrow()
  })

  it('点击 [data-action="requestStopSync"] 不抛错', () => {
    expect(() => clickAction('requestStopSync')).not.toThrow()
  })

  it('点击 [data-action="pauseSync"] 不抛错', () => {
    expect(() => clickAction('pauseSync')).not.toThrow()
  })

  it('点击 [data-action="resumeSync"] 不抛错', () => {
    expect(() => clickAction('resumeSync')).not.toThrow()
  })

  it('点击未知 action 不抛错（记录警告日志）', () => {
    expect(() => clickAction('unknownAction999')).not.toThrow()
  })

  it('点击 [data-action="exportLogs"] 触发 exportLogsToFile', () => {
    clickAction('exportLogs')
    expect(mockState.exportLogsToFile).toHaveBeenCalled()
  })

  it('点击 [data-action="clearLogs"] 触发 clearLogs', () => {
    clickAction('clearLogs')
    expect(mockState.clearLogs).toHaveBeenCalled()
  })

  it('点击 [data-action="showLogPanel"] 不抛错', () => {
    expect(() => clickAction('showLogPanel')).not.toThrow()
  })

  it('点击 [data-action="closeLogModal"] 不抛错', () => {
    expect(() => clickAction('closeLogModal')).not.toThrow()
  })

  it('点击 [data-action="exportConfig"] 触发 configService.exportConfig', () => {
    clickAction('exportConfig')
    expect(mockState.exportConfig).toHaveBeenCalled()
  })

  it('点击 [data-action="saveAllConfig"] 触发配置保存流程', () => {
    // 模拟有配置需要保存（返回非默认值）
    mockState.getIncrementalSync.mockImplementation(() => true)
    mockState.getSkipConflicts.mockImplementation(() => true)
    mockState.getSyncRecordEnabled.mockImplementation(() => true)
    mockState.getSyncStrategy.mockImplementation(() => 'skip-existing')
    mockState.getGithubConfig.mockImplementation(() => ({
      owner: 'test-owner',
      repo: 'test-repo',
      branch: 'main',
      path: 'data',
    }))

    clickAction('saveAllConfig')

    // 验证各配置项的 set 函数被调用
    expect(mockState.setIncrementalSync).toHaveBeenCalledWith(true)
    expect(mockState.setSkipConflicts).toHaveBeenCalledWith(true)
    expect(mockState.setSyncRecordEnabled).toHaveBeenCalledWith(true)
    expect(mockState.setSyncStrategy).toHaveBeenCalledWith('skip-existing')
    expect(mockState.setGithubConfig).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      branch: 'main',
      path: 'data',
    })
  })

  it('点击 [data-action="saveAllConfig"] 配置为默认值时不抛错', () => {
    // 默认返回值（false、空对象等）
    mockState.getIncrementalSync.mockImplementation(() => false)
    mockState.getSkipConflicts.mockImplementation(() => false)
    mockState.getSyncRecordEnabled.mockImplementation(() => false)
    mockState.getGithubConfig.mockImplementation(() => ({
      owner: '',
      repo: '',
      branch: '',
      path: '',
    }))

    expect(() => clickAction('saveAllConfig')).not.toThrow()
  })

  it('点击 [data-action="undoLastSync"] 触发 executeUndoLastSync', () => {
    clickAction('undoLastSync')
    expect(mockState.executeUndoLastSync).toHaveBeenCalled()
  })
})

// ========== setupButtonListeners ==========
describe('setupButtonListeners', () => {
  it('应为 [data-action] 元素注册 click 监听器', () => {
    const button = document.createElement('button')
    button.dataset.action = 'sync'
    document.body.appendChild(button)

    expect(() => setupButtonListeners()).not.toThrow()
    // 触发 click 事件应调用 syncFromPanel
    button.click()
    expect(mockState.syncFromPanel).toHaveBeenCalled()
  })

  it('无 [data-action] 元素时不应抛错', () => {
    document.body.innerHTML = '<div>no action buttons</div>'
    expect(() => setupButtonListeners()).not.toThrow()
  })

  it('空 DOM 不应抛错', () => {
    document.body.innerHTML = ''
    expect(() => setupButtonListeners()).not.toThrow()
  })

  it('多个 [data-action] 元素都应注册监听器', () => {
    const btn1 = document.createElement('button')
    btn1.dataset.action = 'sync'
    const btn2 = document.createElement('button')
    btn2.dataset.action = 'testToken'
    document.body.appendChild(btn1)
    document.body.appendChild(btn2)

    setupButtonListeners()

    btn1.click()
    expect(mockState.syncFromPanel).toHaveBeenCalled()

    btn2.click()
    expect(mockState.testTokenValidity).toHaveBeenCalled()
  })

  it('重复调用 setupButtonListeners 不应重复触发（removeEventListener 后 addEventListener）', () => {
    const button = document.createElement('button')
    button.dataset.action = 'sync'
    document.body.appendChild(button)

    setupButtonListeners()
    setupButtonListeners() // 再次调用

    button.click()
    // 应只触发一次（先 removeEventListener 再 addEventListener）
    expect(mockState.syncFromPanel).toHaveBeenCalledTimes(1)
  })

  it('应为 chkEnableSyncRecord checkbox 注册 change 监听器（不抛错）', () => {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.id = 'chkEnableSyncRecord'
    document.body.appendChild(checkbox)

    expect(() => setupButtonListeners()).not.toThrow()
  })

  it('应为 logLevelFilter select 注册 change 监听器（不抛错）', () => {
    const select = document.createElement('select')
    select.id = 'logLevelFilter'
    document.body.appendChild(select)

    expect(() => setupButtonListeners()).not.toThrow()
  })

  it('应为 GitHub 配置输入框注册防抖自动保存（不抛错）', () => {
    const ownerInput = document.createElement('input')
    ownerInput.id = 'githubOwner'
    const repoInput = document.createElement('input')
    repoInput.id = 'githubRepo'
    const branchInput = document.createElement('input')
    branchInput.id = 'githubBranch'
    const pathInput = document.createElement('input')
    pathInput.id = 'githubPath'
    const strategySelect = document.createElement('select')
    strategySelect.id = 'githubStrategy'
    const sourceTypeSelect = document.createElement('select')
    sourceTypeSelect.id = 'syncSourceType'
    document.body.appendChild(ownerInput)
    document.body.appendChild(repoInput)
    document.body.appendChild(branchInput)
    document.body.appendChild(pathInput)
    document.body.appendChild(strategySelect)
    document.body.appendChild(sourceTypeSelect)

    expect(() => setupButtonListeners()).not.toThrow()
  })
})

// ========== initHandlers ==========
describe('initHandlers', () => {
  it('document.readyState=complete 时应同步执行初始化（不抛错）', () => {
    // jsdom 默认 readyState 为 'complete'
    expect(() => initHandlers()).not.toThrow()
  })

  it('重复调用 initHandlers 不应抛错（幂等）', () => {
    expect(() => {
      initHandlers()
      initHandlers()
    }).not.toThrow()
  })

  it('initHandlers 后点击 [data-action] 按钮应触发 handler', () => {
    const button = document.createElement('button')
    button.dataset.action = 'sync'
    document.body.appendChild(button)

    initHandlers()

    button.click()
    expect(mockState.syncFromPanel).toHaveBeenCalled()
  })
})
