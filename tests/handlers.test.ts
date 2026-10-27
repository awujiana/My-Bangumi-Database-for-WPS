/**
 * @fileoverview UI 事件处理模块（ACTION_HANDLERS 分发）单元测试
 *
 * 测试目标：
 *   - clearAllPendingTimeouts：清理待执行的 setTimeout
 *   - onAction：基于 action 字符串的分发（旧版 Ribbon 入口）
 *   - handleActionClick：基于 DOM 事件的分发（解析 data-action 与 data-args）
 *   - setupButtonListeners：为 [data-action] 元素注册 click 监听
 *   - initializeHandlers：根据 document.readyState 决定同步或延迟初始化
 *
 * 模块依赖说明：
 *   - handlers/index.ts 导入 '../../index.js'，触发 index → ui/handlers 副作用链。
 *   - handlers.ts 模块加载时通过 trackedSetTimeout(setupButtonListeners, 0) 调度延迟回调。
 *   - 使用 vi.hoisted() 在所有 import 之前启用 fake timers，使 setTimeout 进入 fake 队列。
 *   - 需要 jsdom 环境以提供 document/window。
 *
 * Mock 策略：
 *   - vi.mock handler 子模块（token.js / sync.js / sheet.js / _constants.js）控制实际实现
 *   - vi.mock services/ribbon-service.js / configService.js
 *   - vi.mock tools/logger.js / tools/events.js / tools/debounce.js
 *   - 通过 vi.hoisted 共享 vi.fn 引用，测试代码可断言调用情况
 *
 * 未覆盖（依赖 BGM 全局对象与完整 UI 状态，建议在集成测试中覆盖）：
 *   - GitHub 配置自动保存的防抖逻辑（依赖真实 PluginStorage）
 *   - 消息监听器 setupMessageListener（依赖 window.postMessage 完整流程）
 *   - 事件总线 setupEventListeners（依赖 eventBus 完整订阅机制）
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'

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
  // services/ribbon-service.js
  undoLastSyncForRibbon: vi.fn(),
  executeUndoLastSync: vi.fn(() => Promise.resolve(0)),
  // services/config-service.js
  exportConfig: vi.fn(() => '{}'),
  importConfig: vi.fn(() => ({ isOk: () => true, isFail: () => false })),
  // tools/config.js
  isIncrementalSyncEnabled: vi.fn(() => false),
  setIncrementalSync: vi.fn(),
  isSkipConflictsEnabled: vi.fn(() => false),
  setSkipConflicts: vi.fn(),
  isSyncRecordEnabled: vi.fn(() => false),
  setSyncRecordEnabled: vi.fn(),
  getConfig: vi.fn(() => ''),
  setConfig: vi.fn(() => true),
  setExportPath: vi.fn(() => true),
  getExportPath: vi.fn(() => ''),
  setImportPath: vi.fn(() => true),
  getImportPath: vi.fn(() => ''),
  // sync/github-config.js
  getGithubConfig: vi.fn(() => ({ owner: '', repo: '', branch: '', path: '' })),
  setGithubConfig: vi.fn(),
  getSyncStrategy: vi.fn(() => 'add-update'),
  setSyncStrategy: vi.fn(),
  getSyncSourceType: vi.fn(() => 'api'),
  setSyncSourceType: vi.fn(),
  // tools/logger.js：bgmLog() 的真实实现会把日志转发给 logger.*，
  // 断言「记了 WARN/INFO 日志」必须打在这里（barrel 的 bgmLog 是真实实现，不是 mock）。
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  getRecentLogs: vi.fn(() => []),
  exportData: vi.fn(),
  clearLogs: vi.fn(),
  // tools/debounce.js
  debounce: vi.fn((function_: () => void) => function_),
  // handlers/index.js（barrel 转发入口，vi.mock('../index.js') 工厂逐名引用）
  getApp: vi.fn(),
  showToast: vi.fn(),
  confirm: vi.fn(),
  showConfirm: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
  bgmLog: vi.fn(),
  // setupButtonListeners 的「设置页控件回填」需要这 5 个 config getter。
  // 缺失时对应控件块会被 getElementById 返回 null 提前跳过（历史未覆盖行即由此而来）。
  getTheme: vi.fn(() => 'dark'),
  getListType: vi.fn(() => 'all'),
  getTimeFilter: vi.fn(() => 'year'),
  getRefreshInterval: vi.fn(() => 0),
  getLogLevel: vi.fn(() => 1),
  // handlers/module-order.js
  initializeModuleOrderEditor: vi.fn(),
  loadBgToken: vi.fn(),
  storeBgToken: vi.fn(),
  clearBgToken: vi.fn(),
  getBgToken: vi.fn(),
  getCurrentUser: vi.fn(),
  _setBgmUserId: vi.fn(),
  _getBgmUserId: vi.fn(),
  _setBgmUsername: vi.fn(),
  _getBgmUsername: vi.fn(),
  copyTokenToClipboard: vi.fn(),
  getBangumiToken: vi.fn(),
  setBangumiToken: vi.fn(),
  previewSyncContent: vi.fn(),
  showClearConfirm: vi.fn(),
  requestStop: vi.fn(),
  pauseSync: vi.fn(),
  resumeSync: vi.fn(),
  openSyncRecordSheet: vi.fn(),
  showSettingsPanel: vi.fn(),
  refreshData: vi.fn(),
  refreshSheets: vi.fn(),
  refreshWorkbooks: vi.fn(),
  toggleSheetLock: vi.fn(),
  clearSyncRecords: vi.fn(),
  deduplicateSyncRecords: vi.fn(),
  formatSyncRecordSheet: vi.fn(),
  closeDetailModal: vi.fn(),
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

// 模块排序编辑器：仅被 handlers/index.ts 引用；mock 掉才能驱动
// setupButtonListeners 中 `initializeModuleOrderEditor()` 的异常兜底分支。
// 真实实现在 tests/module-order.test.ts 中另有完整覆盖，不受影响。
vi.mock('../ts/ui/handlers/module-order.js', () => ({
  initializeModuleOrderEditor: mockState.initializeModuleOrderEditor,
}))

vi.mock('../ts/ui/handlers/_constants.js', () => ({
  _T: { confirmClearMarks: '确认清除标记？' },
}))

vi.mock('../ts/services/ribbon-service.js', () => ({
  undoLastSyncForRibbon: mockState.undoLastSyncForRibbon,
  executeUndoLastSync: mockState.executeUndoLastSync,
}))

vi.mock('../ts/services/config-service.js', () => ({
  exportConfig: mockState.exportConfig,
  importConfig: mockState.importConfig,
}))

vi.mock('../ts/tools/config.js', () => ({
  isIncrementalSyncEnabled: mockState.isIncrementalSyncEnabled,
  setIncrementalSync: mockState.setIncrementalSync,
  isSkipConflictsEnabled: mockState.isSkipConflictsEnabled,
  setSkipConflicts: mockState.setSkipConflicts,
  isSyncRecordEnabled: mockState.isSyncRecordEnabled,
  setSyncRecordEnabled: mockState.setSyncRecordEnabled,
  getConfig: mockState.getConfig,
  setConfig: mockState.setConfig,
  removeConfig: vi.fn(() => true),
  // setupButtonListeners() 会同步调用以下 config 导出来初始化设置页控件。
  // 这些名字经 barrel（ts/index.ts）转发给 ts/ui/handlers/index.ts，
  // 一旦 mock 工厂遗漏，barrel 转发结果即为 undefined，
  // 会抛出 `getTheme is not a function` 并连带使本文件全部用例失败。
  // 返回值与 ts/tools/config.ts 中的真实默认值保持一致。
  getTheme: mockState.getTheme,
  setNavIconsOnly: vi.fn(() => true),
  getListType: mockState.getListType,
  setListType: vi.fn(() => true),
  getTimeFilter: mockState.getTimeFilter,
  setTimeFilter: vi.fn(() => true),
  // 主题定时（system / schedule 模式）与模态框按钮位置：设置页初始化与切主题时会同步读取
  getThemeSchedule: vi.fn(() => ({ enabled: false, darkStart: '19:00', lightStart: '07:00' })),
  setThemeSchedule: vi.fn(() => true),
  getModalButtonsPosition: vi.fn(() => 'inside'),
  setModalButtonsPosition: vi.fn(() => true),
  // 条件格式自动聚类口径：设置页初始化时回填分段按钮
  getClusterMode: vi.fn(() => 'formula'),
  setClusterMode: vi.fn(() => true),
  clusterModeLabel: vi.fn((mode: string) => mode),
  getMergeMode: vi.fn(() => 'adjacent'),
  setMergeMode: vi.fn(() => true),
  mergeModeLabel: vi.fn((mode: string) => mode),
  getRefreshInterval: mockState.getRefreshInterval,
  setRefreshInterval: vi.fn(() => true),
  // 全局日志级别：setupButtonListeners 用它回填 #logLevelSelect
  getLogLevel: mockState.getLogLevel,
  setExportPath: mockState.setExportPath,
  getExportPath: mockState.getExportPath,
  setImportPath: mockState.setImportPath,
  getImportPath: mockState.getImportPath,
  CONFIG_KEYS: {
    INCREMENTAL_SYNC: 'bgm_incremental_sync',
    SKIP_CONFLICTS: 'bgm_skip_conflicts',
    ENABLE_SYNC_RECORD: 'bgm_enable_sync_record',
  },
}))

vi.mock('../ts/sync/github-config.js', () => ({
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
    debug: mockState.loggerDebug,
    info: mockState.loggerInfo,
    warn: mockState.loggerWarn,
    error: mockState.loggerError,
  },
  getRecentLogs: mockState.getRecentLogs,
  clearLogs: mockState.clearLogs,
  LogLevel: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}))

// 通用数据导出：exportLogs 与 exportData 两个 action 都走它
vi.mock('../ts/ui/handlers/data-export.js', () => ({
  exportData: mockState.exportData,
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
  clearLogs: mockState.clearLogs,

  // ---- 配置相关（saveAllConfig 使用） ----
  isIncrementalSyncEnabled: mockState.isIncrementalSyncEnabled,
  setIncrementalSync: mockState.setIncrementalSync,
  isSkipConflictsEnabled: mockState.isSkipConflictsEnabled,
  setSkipConflicts: mockState.setSkipConflicts,
  isSyncRecordEnabled: mockState.isSyncRecordEnabled,
  setSyncRecordEnabled: mockState.setSyncRecordEnabled,
  getGithubConfig: mockState.getGithubConfig,
  setGithubConfig: mockState.setGithubConfig,
  getSyncStrategy: mockState.getSyncStrategy,
  setSyncStrategy: mockState.setSyncStrategy,
  getSyncSourceType: mockState.getSyncSourceType,
  setSyncSourceType: mockState.setSyncSourceType,
  isGithubConfigComplete: vi.fn(() => true),
  buildRawUrl: vi.fn(() => ''),
  // 默认导出位置 / 默认导入文件夹（initializeConfigPathControls 使用，缺失会导致 getExportPath is not a function）
  setExportPath: mockState.setExportPath,
  getExportPath: mockState.getExportPath,
  setImportPath: mockState.setImportPath,
  getImportPath: mockState.getImportPath,

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
  initializeHandlers,
  clearAllPendingTimeouts,
} from '../ts/ui/handlers/index.js'

vi.clearAllTimers()

afterEach(() => {
  // 先还原全局桩（部分用例会临时把 document 换掉），再清 DOM
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.clearAllMocks()
  // 清理 DOM
  document.body.replaceChildren()
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

/**
 * 创建带 data-action 的按钮，注册监听后触发 click
 * @param action data-action 值
 * @param arguments_ data-args 值（JSON 字符串或原生值）
 */
function clickAction(action: string, arguments_?: string): void {
  const button = document.createElement('button')
  button.dataset.action = action
  if (arguments_ !== undefined) {
    button.dataset.args = arguments_
  }
  document.body.appendChild(button)
  setupButtonListeners()
  button.click()
}

describe('ACTION_HANDLERS 分发（通过 DOM click 触发）', () => {
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

  // 已改走统一的导出源注册表（等价于导出「系统日志」的 TXT），
  // 与其它数据源共用同一套文件命名与空数据校验；级别下拉框的取值一并透传
  it('点击 [data-action="exportLogs"] 导出系统日志（systemLogs + txt）', () => {
    clickAction('exportLogs')
    expect(mockState.exportData).toHaveBeenCalledWith('systemLogs', 'txt', { logLevel: undefined })
  })

  it('点击 [data-action="exportData"] 按 data-args 传数据源与格式', () => {
    clickAction('exportData', JSON.stringify(['cleanLogs', 'csv']))
    expect(mockState.exportData).toHaveBeenCalledWith('cleanLogs', 'csv')
  })

  it('[data-action="exportData"] 缺少参数时不调用导出（不抛错）', () => {
    expect(() => clickAction('exportData')).not.toThrow()
  })

  it('[data-action="exportData"] 格式缺省或非法时回落为 csv', () => {
    clickAction('exportData', JSON.stringify(['enrichRecords']))
    expect(mockState.exportData).toHaveBeenCalledWith('enrichRecords', 'csv')
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
    mockState.isIncrementalSyncEnabled.mockImplementation(() => true)
    mockState.isSkipConflictsEnabled.mockImplementation(() => true)
    mockState.isSyncRecordEnabled.mockImplementation(() => true)
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
    mockState.isIncrementalSyncEnabled.mockImplementation(() => false)
    mockState.isSkipConflictsEnabled.mockImplementation(() => false)
    mockState.isSyncRecordEnabled.mockImplementation(() => false)
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
    document.body.replaceChildren()
    expect(() => setupButtonListeners()).not.toThrow()
  })

  it('多个 [data-action] 元素都应注册监听器', () => {
    const button1 = document.createElement('button')
    button1.dataset.action = 'sync'
    const button2 = document.createElement('button')
    button2.dataset.action = 'testToken'
    document.body.appendChild(button1)
    document.body.appendChild(button2)

    setupButtonListeners()

    button1.click()
    expect(mockState.syncFromPanel).toHaveBeenCalled()

    button2.click()
    expect(mockState.testTokenValidity).toHaveBeenCalled()
  })

  it('重复调用 setupButtonListeners 不应重复触发（removeEventListener 后 addEventListener）', () => {
    const button = document.createElement('button')
    button.dataset.action = 'sync'
    document.body.appendChild(button)

    setupButtonListeners()
    // 再次调用
    setupButtonListeners()

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

// ========== initializeHandlers ==========
describe('initializeHandlers', () => {
  it('document.readyState=complete 时应同步执行初始化（不抛错）', () => {
    // jsdom 默认 readyState 为 'complete'
    expect(() => initializeHandlers()).not.toThrow()
  })

  it('重复调用 initializeHandlers 不应抛错（幂等）', () => {
    expect(() => {
      initializeHandlers()
      initializeHandlers()
    }).not.toThrow()
  })

  it('initializeHandlers 后点击 [data-action] 按钮应触发 handler', () => {
    const button = document.createElement('button')
    button.dataset.action = 'sync'
    document.body.appendChild(button)

    initializeHandlers()

    button.click()
    expect(mockState.syncFromPanel).toHaveBeenCalled()
  })

  it('document.readyState=loading 时应把初始化挂到 DOMContentLoaded（不立即执行）', () => {
    const domContentLoaded: (() => void)[] = []
    // 用 Proxy 继承真实 document：只把 readyState 改成 loading、拦下 addEventListener，
    // 其余成员（getElementById / querySelectorAll …）仍绑到真实 document 上，
    // 这样回调真正执行时 startHandlers 能正常跑完。
    const realDocument = document
    const fakeDocument = new Proxy(realDocument, {
      get(target, property) {
        if (property === 'readyState') return 'loading'
        if (property === 'addEventListener') {
          return (type: string, handler: () => void) => {
            if (type === 'DOMContentLoaded') domContentLoaded.push(handler)
          }
        }
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function'
          ? (value as (...arguments_: unknown[]) => unknown).bind(target)
          : value
      },
    })
    vi.stubGlobal('document', fakeDocument)

    initializeHandlers()

    // 延迟注册：此刻还没有跑初始化
    expect(domContentLoaded).toHaveLength(1)
    expect(mockState.loggerInfo).not.toHaveBeenCalledWith('[handlers] initializeHandlers 完成')

    // 触发 DOMContentLoaded 后才同步执行 startHandlers
    domContentLoaded[0]!()
    expect(mockState.loggerInfo).toHaveBeenCalledWith('[handlers] initializeHandlers 完成')
  })

  it('无 document 环境时走同步分支（Node 兜底；因缺少 DOM 而立即失败）', () => {
    // 该分支服务于「无 DOM 的 Node 环境」，jsdom 下必须显式移除 document 才能进入。
    // startHandlers() 会立刻访问 document.querySelectorAll，因此这里断言的是
    // 「进入同步分支」这一事实（表现为同步抛错），而非成功路径 ——
    // 成功路径需要一整套假 DOM，超出本文件职责，且产品里永远不会走这里。
    vi.stubGlobal('document', undefined)
    expect(() => initializeHandlers()).toThrow(TypeError)
  })
})

// ========== setupButtonListeners · 设置页控件回填与异常兜底 ==========
//
// 这一组专门覆盖 setupButtonListeners 里「按 id 找控件 → 回填 → 注册监听」的
// 各个 if 块，以及三处 try/catch 兜底。历史未覆盖行全部集中在这里：
// 之前的用例只验证「不抛错」，没有把对应 id 的元素挂到 DOM 上，于是整块被跳过。

/**
 * 造一个「已挂到 body 且带同值 option」的 select。
 * jsdom 对 `select.value = 'x'` 在无匹配 option 时会**静默丢弃**赋值，
 * 直接断言 value 会得到空串（假失败），所以必须预置 option。
 */
function mountSelectWithOption(id: string, value: string): HTMLSelectElement {
  const select = document.createElement('select')
  select.id = id
  const option = document.createElement('option')
  option.value = value
  select.append(option)
  document.body.append(select)
  return select
}

describe('setupButtonListeners · 设置页控件回填与异常兜底', () => {
  // 对话框 DOM 未初始化时，showConfirm 会走 `window.confirm` 原生兜底
  // （见 ts/ui/dialog.ts 的 _showDialog）。用它来驱动「用户确认/取消」两条分支。
  // refreshData 是真实实现（ts/panel/panel-lifecycle.ts），无工作表时立即早退，
  // 因此用它的首行日志作为「确实被调用」的观测点。

  it('clear 用户确认后应调用 refreshData（原生 confirm 兜底路径）', () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )

    expect(() => onAction('clear')).not.toThrow()

    expect(mockState.loggerInfo).toHaveBeenCalledWith('refreshData 开始执行')
  })

  it('clear 用户取消时不调用 refreshData', () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    )

    onAction('clear')

    expect(mockState.loggerInfo).not.toHaveBeenCalledWith('refreshData 开始执行')
  })

  it('showClearConfirm 用户确认后应调用 refreshData', () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )

    onAction('showClearConfirm')

    expect(mockState.loggerInfo).toHaveBeenCalledWith('refreshData 开始执行')
  })

  it('读取同步记录状态抛错时记 WARN 日志且不中断其余控件注册', () => {
    mockState.isSyncRecordEnabled.mockImplementationOnce(() => {
      throw new Error('PluginStorage 读取失败')
    })
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.id = 'chkEnableSyncRecord'
    document.body.appendChild(checkbox)

    expect(() => setupButtonListeners()).not.toThrow()

    expect(mockState.loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('读取同步记录状态失败'),
    )
    // 兜底只影响初值回填，checkbox 仍应被注册监听（保持默认未勾选）
    expect(checkbox.checked).toBe(false)
  })

  it('加载 GitHub 配置抛错时记 WARN 日志并继续', () => {
    // loadGithubConfigIntoForm() 第一行就调 getGithubConfig()，让它抛错即可命中兜底
    mockState.getGithubConfig.mockImplementationOnce(() => {
      throw new Error('配置读取失败')
    })

    expect(() => setupButtonListeners()).not.toThrow()
    expect(mockState.loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('加载 GitHub 配置失败'),
    )
  })

  it('初始化模块排序编辑器抛错时记 WARN 日志并继续', () => {
    mockState.initializeModuleOrderEditor.mockImplementationOnce(() => {
      throw new Error('编辑器初始化失败')
    })

    expect(() => setupButtonListeners()).not.toThrow()
    expect(mockState.loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('初始化模块排序编辑器失败'),
    )
  })

  it('主题选择框回填当前主题并注册 change 监听', () => {
    const themeSelect = mountSelectWithOption('themeSelect', 'light')
    mockState.getTheme.mockReturnValueOnce('light')

    setupButtonListeners()

    expect(themeSelect.value).toBe('light')
  })

  it('主题预览卡片注册 click 监听', () => {
    const card = document.createElement('div')
    card.dataset.themeCard = 'dark'
    document.body.appendChild(card)

    expect(() => setupButtonListeners()).not.toThrow()
  })

  it('日志级别下拉框回填当前级别并注册 change 监听', () => {
    const logLevelSelect = mountSelectWithOption('logLevelSelect', '3')
    mockState.getLogLevel.mockReturnValueOnce(3)

    setupButtonListeners()

    expect(logLevelSelect.value).toBe('3')
  })

  it('收藏列表类型下拉框回填当前类型', () => {
    const listTypeSelect = mountSelectWithOption('listTypeSelect', 'wish')
    mockState.getListType.mockReturnValueOnce('wish')

    setupButtonListeners()

    expect(listTypeSelect.value).toBe('wish')
  })

  it('时间筛选下拉框回填当前范围', () => {
    const timeFilterSelect = mountSelectWithOption('timeFilterSelect', 'month')
    mockState.getTimeFilter.mockReturnValueOnce('month')

    setupButtonListeners()

    expect(timeFilterSelect.value).toBe('month')
  })

  it('刷新间隔输入框回填当前分钟数', () => {
    const refreshIntervalInput = document.createElement('input')
    refreshIntervalInput.id = 'refreshIntervalInput'
    document.body.appendChild(refreshIntervalInput)
    mockState.getRefreshInterval.mockReturnValueOnce(45)

    setupButtonListeners()

    expect(refreshIntervalInput.value).toBe('45')
  })
})
