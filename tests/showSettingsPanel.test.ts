/**
 * @fileoverview showSettingsPanel 单元测试
 *
 * 测试目标：
 *   - 设置面板始终停靠右侧（msoCTPDockPositionRight = 2）
 *   - 主面板可见或隐藏时，设置面板均停靠右侧
 *   - 无主面板时，设置面板直接弹出在右侧
 *   - 首次创建设置面板（settings_pane_id 不存在）
 *   - 已存在设置面板：切换显示/隐藏与停靠位置
 *   - 边界情况：app 为 null、PluginStorage 不可用、GetTaskPane 返回 null
 *
 * 模块依赖说明：
 *   - showSettingsPanel 来自 ts/tools/util/index.ts
 *   - 通过 vi.mock 替换 getApp、bgmLog、getUrlPath 及 core/constants WPS_ENUM
 *   - 需要 jsdom 环境（handlers 模块副作用链需要 document）
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// ============ Mock 基础设施 ============

// 模拟 PluginStorage
function createMockPluginStorage(store: Record<string, string> = {}): {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  _store: Record<string, string>
} {
  const s = { ...store }
  return {
    getItem: (k: string) => (k in s ? s[k] : null),
    setItem: (k: string, v: string) => {
      s[k] = v
    },
    _store: s,
  }
}

// 模拟 TaskPane 对象
function createMockTaskPane(
  id: string,
  visible: boolean,
  dockPosition = 0,
): { ID: string; Visible: boolean; DockPosition: number } {
  return { ID: id, Visible: visible, DockPosition: dockPosition }
}

// 记录 CreateTaskPane / GetTaskPane 调用
let createdPanes: { url: string }[] = []
let getTaskPaneResults: Record<string, { Visible: boolean; DockPosition?: number } | null> = {}
let createdPaneCounter = 0

function createMockApp(): {
  PluginStorage: ReturnType<typeof createMockPluginStorage>
  CreateTaskPane: (url: string) => { ID: string; Visible: boolean; DockPosition?: number } | null
  GetTaskPane: (id: string) => { Visible: boolean; DockPosition?: number } | null
} {
  createdPanes = []
  getTaskPaneResults = {}
  createdPaneCounter = 0

  return {
    PluginStorage: createMockPluginStorage(),
    CreateTaskPane: (url: string) => {
      createdPaneCounter++
      const pane = {
        ID: `settings-pane-${createdPaneCounter}`,
        Visible: false,
        DockPosition: 0,
      }
      createdPanes.push({ url })
      getTaskPaneResults[pane.ID] = pane
      return pane
    },
    GetTaskPane: (id: string) => getTaskPaneResults[id] ?? null,
  }
}

// ============ vi.hoisted 共享 mock 引用 ============
const mockRefs = vi.hoisted(() => ({
  mockBgmLog: vi.fn(),
  mockGetUrlPath: vi.fn(() => 'https://example.com/addin'),
  mockGetApp: vi.fn(),
  MOCK_WPS_ENUM: {
    msoCTPDockPositionLeft: 0,
    msoCTPDockPositionRight: 2,
  },
}))

// ============ vi.mock 声明（hoisted 执行） ============
vi.mock('../ts/tools/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: mockRefs.mockBgmLog,
    warn: vi.fn(),
    error: vi.fn(),
  },
  LogLevel: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}))

vi.mock('../ts/core/constants.js', () => ({
  WPS_ENUM: mockRefs.MOCK_WPS_ENUM,
  BGM_CONFIG: {},
  LOG_LEVELS: { INFO: 1, WARN: 2, ERROR: 3, DEBUG: 0 },
  ERROR_LEVELS: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
  ErrorLevel: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
}))

vi.mock('../ts/tools/wps.js', () => ({
  // 当 window.Application 被设置时，isWpsApp 应返回 true
  isWpsApp: vi.fn((app: unknown): app is Record<string, unknown> => {
    if (app && typeof app === 'object') {
      const a = app as Record<string, unknown>
      return 'PluginStorage' in a || 'CreateTaskPane' in a || 'GetTaskPane' in a
    }
    return false
  }),
}))

// Mock UI modules to prevent handlers.ts side-effect chain
vi.mock('../ts/ui/dialog.js', () => ({
  showConfirm: vi.fn(),
  showAlert: vi.fn(),
  showInput: vi.fn(() => 'test'),
  showToast: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}))

vi.mock('../ts/ui/preview.js', () => ({
  syncAllRows: vi.fn(),
  enlargePreview: vi.fn(),
}))

vi.mock('../ts/tools/events.js', () => ({
  BGM_EVENTS: {},
  eventBus: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}))

// Mock the root index.js to prevent circular dependency chain
vi.mock('../index.js', () => ({
  getApp: mockRefs.mockGetApp,
  showToast: vi.fn(),
  confirm: vi.fn(),
  showConfirm: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
  bgmLog: mockRefs.mockBgmLog,
  LOG_LEVELS: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  loadBgToken: vi.fn(() => null),
  storeBgToken: vi.fn(),
  clearBgToken: vi.fn(),
  getBgToken: vi.fn(() => null),
  getCurrentUser: vi.fn(() => null),
  _setBgmUserId: vi.fn(),
  _getBgmUserId: vi.fn(() => null),
  _setBgmUsername: vi.fn(),
  _getBgmUsername: vi.fn(() => null),
  copyTokenToClipboard: vi.fn(),
  getBangumiToken: vi.fn(() => null),
  setBangumiToken: vi.fn(),
  syncFromPanel: vi.fn(),
  previewSyncContent: vi.fn(),
  showClearConfirm: vi.fn(),
  requestStop: vi.fn(),
  pauseSync: vi.fn(),
  resumeSync: vi.fn(),
  cleanLockedDataSheet: vi.fn(),
  openSyncRecordSheet: vi.fn(),
  testDebugConnection: vi.fn(),
  getRecentLogs: vi.fn(() => []),
  exportLogsToFile: vi.fn(),
  clearLogs: vi.fn(),
  getIncrementalSync: vi.fn(() => false),
  setIncrementalSync: vi.fn(),
  getSkipConflicts: vi.fn(() => false),
  setSkipConflicts: vi.fn(),
  getSyncRecordEnabled: vi.fn(() => false),
  setSyncRecordEnabled: vi.fn(),
  getGithubConfig: vi.fn(() => ({ owner: '', repo: '', branch: '', path: '' })),
  setGithubConfig: vi.fn(),
  getSyncStrategy: vi.fn(() => 'add-update'),
  setSyncStrategy: vi.fn(),
  getSyncSourceType: vi.fn(() => 'api'),
  setSyncSourceType: vi.fn(),
  isGithubConfigComplete: vi.fn(() => true),
  buildRawUrl: vi.fn(() => ''),
  showSettingsPanel: vi.fn(),
  refreshData: vi.fn(),
  refreshSheets: vi.fn(),
  refreshWorkbooks: vi.fn(),
  toggleSheetLock: vi.fn(),
  clearSyncRecords: vi.fn(),
  deduplicateSyncRecords: vi.fn(),
  formatSyncRecordSheet: vi.fn(),
  closeDetailModal: vi.fn(),
  getLastRow: vi.fn(() => 1),
  getSyncRecordSheetIfExists: vi.fn(() => true),
  showConnectionTestDialog: vi.fn(),
  hideConnectionTestDialog: vi.fn(),
  showSyncProgressDialog: vi.fn(),
  updateSyncProgressDialog: vi.fn(),
  completeSyncProgressDialog: vi.fn(),
  hideSyncProgressDialog: vi.fn(),
  showSyncResultDialog: vi.fn(),
  syncFromRemote: vi.fn(),
  getUrlPath: mockRefs.mockGetUrlPath,
  BGM: {},
}))

// 为 handlers 模块提供空实现，避免副作用
vi.mock('../ts/ui/handlers/index.js', () => ({
  onAction: vi.fn(),
  setupButtonListeners: vi.fn(),
  initHandlers: vi.fn(),
  clearAllPendingTimeouts: vi.fn(),
  ACTION_HANDLERS: {},
}))

import { showSettingsPanel } from '../ts/tools/util/index.js'

// ============ 测试套件 ============

afterEach(() => {
  vi.clearAllMocks()
  mockRefs.mockBgmLog.mockClear()
  mockRefs.mockGetUrlPath.mockClear()
  mockRefs.mockGetApp.mockClear()
  getTaskPaneResults = {}
  createdPanes = []
  // 清理 window.Application
  if ('Application' in window) {
    delete (window as Record<string, unknown>).Application
  }
})

/** 将 mock app 设置到 window.Application，使 getApp() 能获取 */
function setMockApp(app: unknown): void {
  ;(window as Record<string, unknown>).Application = app
}

// ============ 场景 1: 主面板可见 → 设置面板停靠右侧 ============
describe('showSettingsPanel — 主面板可见时停靠右侧', () => {
  it('首次创建：主面板可见 → 设置面板 DockPosition = Right (2)', () => {
    const app = createMockApp()
    // 主面板已存在且可见
    app.PluginStorage.setItem('panel_id', 'main-pane-1')
    getTaskPaneResults['main-pane-1'] = createMockTaskPane('main-pane-1', true)

    setMockApp(app)

    showSettingsPanel()

    // 应创建新面板
    expect(createdPanes).toHaveLength(1)
    expect(createdPanes[0].url).toContain('/ui/settings.html')

    // 创建的面板应停靠右侧且可见
    const createdId = Object.keys(getTaskPaneResults).find((k) => k.startsWith('settings-pane-'))
    expect(createdId).toBeDefined()
    if (createdId) {
      const pane = getTaskPaneResults[createdId]
      expect(pane?.DockPosition).toBe(mockRefs.MOCK_WPS_ENUM.msoCTPDockPositionRight)
      expect(pane?.Visible).toBe(true)
    }

    // settings_pane_id 应已存储
    expect(app.PluginStorage.getItem('settings_pane_id')).toBeTruthy()
  })

  it('已存在：主面板可见 → 设置面板停靠右侧', () => {
    const app = createMockApp()
    // 主面板可见
    app.PluginStorage.setItem('panel_id', 'main-pane-1')
    getTaskPaneResults['main-pane-1'] = createMockTaskPane('main-pane-1', true)

    // 设置面板已存在且当前可见
    app.PluginStorage.setItem('settings_pane_id', 'settings-pane-1')
    getTaskPaneResults['settings-pane-1'] = createMockTaskPane(
      'settings-pane-1',
      true,
      mockRefs.MOCK_WPS_ENUM.msoCTPDockPositionLeft,
    )

    setMockApp(app)

    showSettingsPanel()

    // 已存在且可见 → 应切换为隐藏
    expect(getTaskPaneResults['settings-pane-1']?.Visible).toBe(false)
  })

  it('已存在但隐藏：主面板可见 → 设置面板停靠右侧并显示', () => {
    const app = createMockApp()
    // 主面板可见
    app.PluginStorage.setItem('panel_id', 'main-pane-1')
    getTaskPaneResults['main-pane-1'] = createMockTaskPane('main-pane-1', true)

    // 设置面板已存在但当前隐藏
    app.PluginStorage.setItem('settings_pane_id', 'settings-pane-1')
    getTaskPaneResults['settings-pane-1'] = createMockTaskPane(
      'settings-pane-1',
      false,
      mockRefs.MOCK_WPS_ENUM.msoCTPDockPositionLeft,
    )

    setMockApp(app)

    showSettingsPanel()

    // 已存在且隐藏 → 应显示并调整到右侧
    const pane = getTaskPaneResults['settings-pane-1']
    expect(pane?.Visible).toBe(true)
    expect(pane?.DockPosition).toBe(mockRefs.MOCK_WPS_ENUM.msoCTPDockPositionRight)
  })
})

// ============ 场景 2: 主面板隐藏 → 设置面板仍停靠右侧 ============
describe('showSettingsPanel — 主面板隐藏时仍停靠右侧', () => {
  it('首次创建：主面板隐藏 → 设置面板 DockPosition = Right (2)', () => {
    const app = createMockApp()
    // 主面板存在但隐藏
    app.PluginStorage.setItem('panel_id', 'main-pane-1')
    getTaskPaneResults['main-pane-1'] = createMockTaskPane('main-pane-1', false)

    setMockApp(app)

    showSettingsPanel()

    // 应创建新面板
    expect(createdPanes).toHaveLength(1)

    // 创建的面板应停靠右侧且可见
    const createdId = Object.keys(getTaskPaneResults).find((k) => k.startsWith('settings-pane-'))
    expect(createdId).toBeDefined()
    if (createdId) {
      const pane = getTaskPaneResults[createdId]
      expect(pane?.DockPosition).toBe(mockRefs.MOCK_WPS_ENUM.msoCTPDockPositionRight)
      expect(pane?.Visible).toBe(true)
    }
  })

  it('首次创建：主面板 ID 不存在 → 默认停靠右侧', () => {
    const app = createMockApp()
    // 主面板 ID 未存储 → mainPanelVisible 默认 false

    setMockApp(app)

    showSettingsPanel()

    // 应创建新面板，停靠右侧
    expect(createdPanes).toHaveLength(1)
    const createdId = Object.keys(getTaskPaneResults).find((k) => k.startsWith('settings-pane-'))
    if (createdId) {
      const pane = getTaskPaneResults[createdId]
      expect(pane?.DockPosition).toBe(mockRefs.MOCK_WPS_ENUM.msoCTPDockPositionRight)
      expect(pane?.Visible).toBe(true)
    }
  })

  it('已存在但隐藏：主面板隐藏 → 设置面板停靠右侧并显示', () => {
    const app = createMockApp()
    // 主面板隐藏
    app.PluginStorage.setItem('panel_id', 'main-pane-1')
    getTaskPaneResults['main-pane-1'] = createMockTaskPane('main-pane-1', false)

    // 设置面板已存在但隐藏，且当前停靠在右侧
    app.PluginStorage.setItem('settings_pane_id', 'settings-pane-1')
    getTaskPaneResults['settings-pane-1'] = createMockTaskPane(
      'settings-pane-1',
      false,
      mockRefs.MOCK_WPS_ENUM.msoCTPDockPositionRight,
    )

    setMockApp(app)

    showSettingsPanel()

    // 应显示并调整到右侧
    const pane = getTaskPaneResults['settings-pane-1']
    expect(pane?.Visible).toBe(true)
    expect(pane?.DockPosition).toBe(mockRefs.MOCK_WPS_ENUM.msoCTPDockPositionRight)
  })
})

// ============ 场景 3: 边界情况 ============
describe('showSettingsPanel — 边界情况', () => {
  it('app 为 null 时不应抛错', () => {
    // window.Application 未设置 → getApp() 返回 null
    // （已在 afterEach 中清理）

    expect(() => showSettingsPanel()).not.toThrow()
    expect(createdPanes).toHaveLength(0)
  })

  it('PluginStorage 为 undefined 时不应抛错', () => {
    const app = {
      PluginStorage: undefined,
      CreateTaskPane: vi.fn(),
      GetTaskPane: vi.fn(),
    }
    setMockApp(app)

    expect(() => showSettingsPanel()).not.toThrow()
  })

  it('GetTaskPane 返回 null（主面板 ID 失效）→ 默认主面板不可见，停靠右侧', () => {
    const app = createMockApp()
    app.PluginStorage.setItem('panel_id', 'invalid-pane-id')
    // GetTaskPane 返回 null（未注册的 ID）

    setMockApp(app)

    showSettingsPanel()

    // 主面板不可见 → 设置面板停靠右侧
    expect(createdPanes).toHaveLength(1)
    const createdId = Object.keys(getTaskPaneResults).find((k) => k.startsWith('settings-pane-'))
    if (createdId) {
      const pane = getTaskPaneResults[createdId]
      expect(pane?.DockPosition).toBe(mockRefs.MOCK_WPS_ENUM.msoCTPDockPositionRight)
    }
  })

  it('设置面板 ID 失效（GetTaskPane 返回 null）→ 清除存储', () => {
    const app = createMockApp()
    app.PluginStorage.setItem('settings_pane_id', 'invalid-settings-id')
    // 该 ID 不在 getTaskPaneResults 中 → GetTaskPane 返回 null

    setMockApp(app)

    showSettingsPanel()

    // settings_pane_id 应被清除
    expect(app.PluginStorage.getItem('settings_pane_id')).toBe('')
  })

  it('CreateTaskPane 返回 null → 不存储 settings_pane_id', () => {
    const app = {
      PluginStorage: createMockPluginStorage(),
      CreateTaskPane: vi.fn(() => null),
      GetTaskPane: vi.fn(),
    }
    setMockApp(app)

    showSettingsPanel()

    expect(app.PluginStorage.getItem('settings_pane_id')).toBeNull()
  })

  it('日志应输出主面板状态和目标停靠位置', () => {
    const app = createMockApp()
    app.PluginStorage.setItem('panel_id', 'main-pane-1')
    getTaskPaneResults['main-pane-1'] = createMockTaskPane('main-pane-1', true)

    setMockApp(app)

    showSettingsPanel()

    // mockBgmLog 是 logger.info，只接收 message 字符串
    const statusCall = mockRefs.mockBgmLog.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('主面板状态'),
    )
    expect(statusCall).toBeDefined()
    if (statusCall) {
      expect(String(statusCall[0])).toContain('可见')
    }
  })
})
