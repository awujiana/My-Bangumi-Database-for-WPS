// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/handlers/action-handlers.ts` 的 ACTION_HANDLERS 分发表测试。
 *
 * 这个 1500 行的文件是一条「按 data-action 分发」的大表：61 个 handler 各自
 * 读 DOM 或调上层入口，真正的风险不是算法而是**分发链断掉**——
 * 某个 action 调错了函数、参数漏了、早退分支把用户操作静默吞掉、
 * 或 `handleActionClick` 解析 data-args 失败后不报错。因此断言一律打到
 * 「最终调用了哪个入口、参数是什么、失败时提示文案是什么」。
 *
 * 依赖结构决定了这里是「就地测」而不是「先抽后测」：
 * 全部上层依赖都从 `../../index.js` 这一个 barrel 进入（外加 14 个 UI 兄弟模块），
 * mock 一个 barrel 就能驱动 61 个 handler 的真实实现，不需要拆文件。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  // ---- barrel: 日志与通知 ----
  bgmLog: vi.fn(),
  handleError: vi.fn(() => ({ details: {} })),
  showToast: vi.fn(),
  showAlert: vi.fn(),
  showConfirm: vi.fn(),
  showInput: vi.fn(),
  /** showConfirm / showInput 的「用户回答」，由用例改写 */
  answer: { confirm: true, input: '{}' },

  // ---- barrel: 同步入口 ----
  syncFromPanel: vi.fn(),
  syncSelectedRows: vi.fn(),
  syncFromRemote: vi.fn(),
  previewSyncContent: vi.fn(),
  enlargePreview: vi.fn(),
  refreshData: vi.fn(),
  refreshSheets: vi.fn(),
  refreshWorkbooks: vi.fn(),
  toggleSheetLock: vi.fn(),
  requestStop: vi.fn(),
  pauseSync: vi.fn(),
  resumeSync: vi.fn(),

  // ---- barrel: 记录表 ----
  clearSyncRecords: vi.fn(),
  deduplicateSyncRecords: vi.fn(),
  formatSyncRecordSheet: vi.fn(),
  openSyncRecordSheet: vi.fn(),
  getSyncRecordSheetIfExists: vi.fn((): unknown => null),
  getLastRow: vi.fn(() => 0),

  // ---- barrel: Token / 用户 ----
  loadBgToken: vi.fn(() => 'tok-123'),
  storeBgToken: vi.fn(() => true),
  clearBgToken: vi.fn(),
  copyTokenToClipboard: vi.fn(() => true),
  _getBgmUserId: vi.fn(() => '100'),
  openBangumiTokenPage: vi.fn(),

  // ---- barrel: 弹窗 ----
  closeDetailModal: vi.fn(),
  showSyncProgressDialog: vi.fn(),
  updateSyncProgressDialog: vi.fn(),
  completeSyncProgressDialog: vi.fn(),
  hideSyncProgressDialog: vi.fn(),
  showSyncResultDialog: vi.fn(),
  showSettingsPanel: vi.fn(),
  showCleanPanel: vi.fn(),

  // ---- barrel: GitHub 配置 ----
  buildRawUrl: vi.fn(() => 'https://raw.example/data.json'),
  buildSyncConfig: vi.fn(() => '配置摘要'),
  formatDuration: vi.fn(() => '1s'),
  getGithubConfig: vi.fn(() => ({ owner: '', repo: '' })),
  setGithubConfig: vi.fn(() => true),
  isGithubConfigComplete: vi.fn(() => true),
  getSyncSourceType: vi.fn(() => 'github'),
  setSyncSourceType: vi.fn(() => true),
  getSyncStrategy: vi.fn(() => 'add-update'),
  setSyncStrategy: vi.fn(() => true),
  isIncrementalSyncEnabled: vi.fn(() => false),
  isSkipConflictsEnabled: vi.fn(() => false),
  isSyncRecordEnabled: vi.fn(() => false),
  setIncrementalSync: vi.fn(),
  setSkipConflicts: vi.fn(),
  setSyncRecordEnabled: vi.fn(),
  setNavIconsOnly: vi.fn(),

  // ---- barrel: 路径 / 配置 ----
  getExportPath: vi.fn(() => ''),
  setExportPath: vi.fn(() => true),
  getImportPath: vi.fn(() => ''),
  setImportPath: vi.fn(() => true),
  removeConfig: vi.fn(() => true),
  applyLogLevel: vi.fn(),
  getApp: vi.fn((): unknown => null),

  // ---- 兄弟模块 ----
  exportConfig: vi.fn(() => '{"logLevel":2}'),
  importConfig: vi.fn((): { isOk: () => boolean; error: unknown } => ({
    isOk: () => true,
    error: undefined,
  })),
  executeUndoLastSync: vi.fn(),
  readLocalFileContent: vi.fn(() => '{}'),
  clearLogs: vi.fn(),
  exportData: vi.fn(),
  hideConnectionTestDialog: vi.fn(),
  showConnectionTestDialog: vi.fn(),
  copyTextToClipboard: vi.fn(),
  getResettableConfigKeys: vi.fn(() => ['LOG_LEVEL']),
  reloadEnrichPreviewSettings: vi.fn(),
  saveEnrichPreviewSettings: vi.fn(),
  refreshGithubConfigInputs: vi.fn(),
  renderLogEntries: vi.fn(),
  selectDefaultFolder: vi.fn((): string | null => '/picked/dir'),
  updatePathDisplay: vi.fn(),
  cleanLockedDataSheet: vi.fn(),
  syncCollectionFromBgm: vi.fn(),
  openUserCollection: vi.fn(),
  showTokenDialog: vi.fn(),
  showUserIdDialog: vi.fn(),
  testDebugConnection: vi.fn(),
  testTokenValidity: vi.fn(),
  updateTokenStatus: vi.fn(),
  updateUserIdStatus: vi.fn(),
  confirmClearMarks: '确定要清空所有标记吗？',
}))

// `...await importOriginal()`：将来 barrel 新增导出不会在本 mock 里静默变 undefined
// （action-handlers 的 readLocalFileContent 即由 barrel 提供，经此链拿到
//  `../ts/sync/local-file-sync.js` 的 mock 实现）
vi.mock('../ts/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ts/index.js')>()),
  BGM: {
    cache: { userId: null, username: null, avatarUrl: null },
    sync: {
      requestStop: mocks.requestStop,
      pause: mocks.pauseSync,
      resume: mocks.resumeSync,
    },
    ErrorLevel: { SILENT: 0, WARN: 1, ERROR: 2, THROW: 3, INFO: 4 },
    handleError: mocks.handleError,
  },
  LOG_LEVELS: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
  _getBgmUserId: mocks._getBgmUserId,
  applyLogLevel: mocks.applyLogLevel,
  bgmLog: mocks.bgmLog,
  buildRawUrl: mocks.buildRawUrl,
  buildSyncConfig: mocks.buildSyncConfig,
  clearBgToken: mocks.clearBgToken,
  clearSyncRecords: mocks.clearSyncRecords,
  closeDetailModal: mocks.closeDetailModal,
  completeSyncProgressDialog: mocks.completeSyncProgressDialog,
  copyTokenToClipboard: mocks.copyTokenToClipboard,
  deduplicateSyncRecords: mocks.deduplicateSyncRecords,
  enlargePreview: mocks.enlargePreview,
  formatDuration: mocks.formatDuration,
  formatSyncRecordSheet: mocks.formatSyncRecordSheet,
  getApp: mocks.getApp,
  getExportPath: mocks.getExportPath,
  getGithubConfig: mocks.getGithubConfig,
  getImportPath: mocks.getImportPath,
  getLastRow: mocks.getLastRow,
  getSyncRecordSheetIfExists: mocks.getSyncRecordSheetIfExists,
  getSyncSourceType: mocks.getSyncSourceType,
  getSyncStrategy: mocks.getSyncStrategy,
  hideSyncProgressDialog: mocks.hideSyncProgressDialog,
  isGithubConfigComplete: mocks.isGithubConfigComplete,
  isIncrementalSyncEnabled: mocks.isIncrementalSyncEnabled,
  isSkipConflictsEnabled: mocks.isSkipConflictsEnabled,
  isSyncRecordEnabled: mocks.isSyncRecordEnabled,
  loadBgToken: mocks.loadBgToken,
  openBangumiTokenPage: mocks.openBangumiTokenPage,
  openSyncRecordSheet: mocks.openSyncRecordSheet,
  previewSyncContent: mocks.previewSyncContent,
  refreshData: mocks.refreshData,
  refreshSheets: mocks.refreshSheets,
  refreshWorkbooks: mocks.refreshWorkbooks,
  removeConfig: mocks.removeConfig,
  setExportPath: mocks.setExportPath,
  setGithubConfig: mocks.setGithubConfig,
  setImportPath: mocks.setImportPath,
  setIncrementalSync: mocks.setIncrementalSync,
  setNavIconsOnly: mocks.setNavIconsOnly,
  setSkipConflicts: mocks.setSkipConflicts,
  setSyncRecordEnabled: mocks.setSyncRecordEnabled,
  setSyncSourceType: mocks.setSyncSourceType,
  setSyncStrategy: mocks.setSyncStrategy,
  showAlert: mocks.showAlert,
  showCleanPanel: mocks.showCleanPanel,
  showConfirm: mocks.showConfirm,
  showInput: mocks.showInput,
  showSettingsPanel: mocks.showSettingsPanel,
  showSyncProgressDialog: mocks.showSyncProgressDialog,
  showSyncResultDialog: mocks.showSyncResultDialog,
  showToast: mocks.showToast,
  storeBgToken: mocks.storeBgToken,
  syncFromRemote: mocks.syncFromRemote,
  syncSelectedRows: mocks.syncSelectedRows,
  toggleSheetLock: mocks.toggleSheetLock,
  updateSyncProgressDialog: mocks.updateSyncProgressDialog,
}))

vi.mock('../ts/services/config-service.js', () => ({
  exportConfig: mocks.exportConfig,
  importConfig: mocks.importConfig,
}))
vi.mock('../ts/services/ribbon-service.js', () => ({
  executeUndoLastSync: mocks.executeUndoLastSync,
}))
vi.mock('../ts/sync/local-file-sync.js', () => ({
  readLocalFileContent: mocks.readLocalFileContent,
}))
vi.mock('../ts/tools/logger.js', () => ({ clearLogs: mocks.clearLogs }))
vi.mock('../ts/ui/github-config-dialog.js', () => ({
  hideConnectionTestDialog: mocks.hideConnectionTestDialog,
  showConnectionTestDialog: mocks.showConnectionTestDialog,
}))
vi.mock('../ts/ui/handlers/_constants.js', () => ({
  _T: { confirmClearMarks: mocks.confirmClearMarks },
}))
vi.mock('../ts/ui/handlers/clipboard.js', () => ({
  copyTextToClipboard: mocks.copyTextToClipboard,
}))
vi.mock('../ts/ui/handlers/config-reset-keys.js', () => ({
  getResettableConfigKeys: mocks.getResettableConfigKeys,
}))
vi.mock('../ts/ui/handlers/data-export.js', () => ({ exportData: mocks.exportData }))
vi.mock('../ts/ui/handlers/enrich-preview-settings.js', () => ({
  reloadEnrichPreviewSettings: mocks.reloadEnrichPreviewSettings,
  saveEnrichPreviewSettings: mocks.saveEnrichPreviewSettings,
}))
vi.mock('../ts/ui/handlers/github-settings.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ts/ui/handlers/github-settings.js')>()),
  refreshGithubConfigInputs: mocks.refreshGithubConfigInputs,
}))
vi.mock('../ts/ui/handlers/log-panel.js', () => ({ renderLogEntries: mocks.renderLogEntries }))
vi.mock('../ts/ui/handlers/path-controls.js', () => ({
  selectDefaultFolder: mocks.selectDefaultFolder,
  updatePathDisplay: mocks.updatePathDisplay,
}))
vi.mock('../ts/ui/handlers/sheet.js', () => ({
  cleanLockedDataSheet: mocks.cleanLockedDataSheet,
}))
vi.mock('../ts/ui/handlers/sync.js', () => ({
  syncCollectionFromBgm: mocks.syncCollectionFromBgm,
  syncFromPanel: mocks.syncFromPanel,
}))
vi.mock('../ts/ui/handlers/token.js', () => ({
  openUserCollection: mocks.openUserCollection,
  showTokenDialog: mocks.showTokenDialog,
  showUserIdDialog: mocks.showUserIdDialog,
  testDebugConnection: mocks.testDebugConnection,
  testTokenValidity: mocks.testTokenValidity,
  updateTokenStatus: mocks.updateTokenStatus,
  updateUserIdStatus: mocks.updateUserIdStatus,
}))

import { ACTION_HANDLERS, handleActionClick } from '../ts/ui/handlers/action-handlers.js'

// ========== helpers ==========

/** 模拟一次带 data-action / data-args 的按钮点击 */
function clickButton(action?: string, arguments_?: string): HTMLButtonElement {
  const button = document.createElement('button')
  if (action !== undefined) button.dataset.action = action
  if (arguments_ !== undefined) button.dataset.args = arguments_
  document.body.append(button)
  handleActionClick({ currentTarget: button } as unknown as Event)
  return button
}

/** 以给定参数驱动某个已注册的 action */
function runAction(action: string, ...arguments_: string[]): void {
  const handler = ACTION_HANDLERS[action]
  if (!handler) throw new Error(`未注册的 action: ${action}`)
  handler({ args: arguments_, startTime: Date.now() })
}

/**
 * 临时把 barrel 的某个导出置为 `undefined`，用于驱动「宿主/barrel 未提供该函数」的兜底分支。
 *
 * 被测代码经 Vite 的 SSR 转换后，命名导入是**调用时读命名空间属性**
 * （`__vite_ssr_import_x__.name`），所以直接改写 mock 命名空间上的属性即可生效。
 * 这类分支在产品里对应「某个子模块加载失败 / 被裁剪」的场景，不能静默吞掉用户操作。
 */
async function withBarrelExportCleared(name: string, run: () => void): Promise<void> {
  const barrel = (await import('../ts/index.js')) as Record<string, unknown>
  const original = barrel[name]
  try {
    barrel[name] = undefined
    run()
  } finally {
    barrel[name] = original
  }
}

/** 建一个带 id 的 div（handler 普遍用 getElementById 取控件） */
function mountDiv(id: string): HTMLDivElement {
  const element = document.createElement('div')
  element.id = id
  document.body.append(element)
  return element
}

function mountButton(id: string): HTMLButtonElement {
  const element = document.createElement('button')
  element.id = id
  document.body.append(element)
  return element
}

function mountInput(id: string, value = ''): HTMLInputElement {
  const input = document.createElement('input')
  input.id = id
  input.value = value
  document.body.append(input)
  return input
}

function mountSelect(id: string, value: string): HTMLSelectElement {
  const select = document.createElement('select')
  select.id = id
  // jsdom 里把 value 设成 options 中不存在的值会被静默置为空串 —— 必须先补选项
  const option = document.createElement('option')
  option.value = value
  select.append(option)
  select.value = value
  document.body.append(select)
  return select
}

/** 给 window.wps.Application 装一个可用的 GetOpenFilename */
function mountWpsDialog(getOpenFilename: (fileFilter: string, title: string) => unknown): void {
  Reflect.set(window, 'wps', { Application: { GetOpenFilename: getOpenFilename } })
}

function clearWps(): void {
  Reflect.deleteProperty(window, 'wps')
}

/** 假 XMLHttpRequest：只服务 testGithubConfig 的 HEAD 探测 */
class FakeXhr {
  static readonly instances: FakeXhr[] = []

  private readonly listeners = new Map<string, (() => void)[]>()

  status = 200

  timeout = 0

  ontimeout: (() => void) | null = null

  // 被测代码只要求「能调通」，不影响断言
  // eslint-disable-next-line class-methods-use-this -- 假 XHR 的 open 无需实例状态
  open(): void {}

  addEventListener(type: string, handler: () => void): void {
    const existing = this.listeners.get(type)
    if (existing) existing.push(handler)
    else this.listeners.set(type, [handler])
  }

  send(): void {
    FakeXhr.instances.push(this)
  }

  emit(type: string): void {
    const handlers = this.listeners.get(type)
    if (handlers) {
      for (const handler of handlers) handler()
    }
  }
}

const createObjectUrl = vi.fn(() => 'blob:fake')
const revokeObjectUrl = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
  mocks.answer.confirm = true
  mocks.answer.input = '{}'
  mocks.showConfirm.mockImplementation(
    (_message: string, callback?: (isConfirmed: boolean) => void) => {
      callback?.(mocks.answer.confirm)
    },
  )
  mocks.showInput.mockImplementation(
    (_title: string, _hint: string, _initial: string, callback?: (value?: string) => void) => {
      callback?.(mocks.answer.input)
    },
  )
  FakeXhr.instances.length = 0
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  Reflect.set(URL, 'createObjectURL', createObjectUrl)
  Reflect.set(URL, 'revokeObjectURL', revokeObjectUrl)
  clearWps()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearWps()
})

// ========== 核心操作 ==========

describe('ACTION_HANDLERS · 核心操作', () => {
  it('sync → 触发面板同步', () => {
    runAction('sync')
    expect(mocks.syncFromPanel).toHaveBeenCalledTimes(1)
  })

  it('testSelected → 触发选中行同步', () => {
    runAction('testSelected')
    expect(mocks.syncSelectedRows).toHaveBeenCalledTimes(1)
  })

  it('clear → 先弹确认，确认后才刷新数据', () => {
    runAction('clear')
    expect(mocks.showConfirm).toHaveBeenCalledWith(mocks.confirmClearMarks, expect.any(Function))
    expect(mocks.refreshData).toHaveBeenCalledTimes(1)
  })

  it('clear → 用户取消时不刷新（不能把「取消」当默认同意）', () => {
    mocks.answer.confirm = false
    runAction('clear')
    expect(mocks.refreshData).not.toHaveBeenCalled()
  })

  it('previewSyncContent → 触发预览', () => {
    runAction('previewSyncContent')
    expect(mocks.previewSyncContent).toHaveBeenCalledTimes(1)
  })

  it('enlargePreview → 放大预览', () => {
    runAction('enlargePreview')
    expect(mocks.enlargePreview).toHaveBeenCalledTimes(1)
  })

  it('refreshSheets → 带上「自动匹配活动工作表」标志', () => {
    runAction('refreshSheets')
    expect(mocks.refreshSheets).toHaveBeenCalledWith({ autoSelectActive: true })
  })

  it('refreshWorkbooks → 刷新工作簿后再刷新工作表', () => {
    runAction('refreshWorkbooks')
    expect(mocks.refreshWorkbooks).toHaveBeenCalledTimes(1)
    expect(mocks.refreshSheets).toHaveBeenCalledWith({ autoSelectActive: true })
  })

  it('refreshData / toggleSheetLock / cleanLockedDataSheet / openSyncRecordSheet → 各自入口', () => {
    runAction('refreshData')
    runAction('toggleSheetLock')
    runAction('cleanLockedDataSheet')
    runAction('openSyncRecordSheet')
    expect(mocks.refreshData).toHaveBeenCalledTimes(1)
    expect(mocks.toggleSheetLock).toHaveBeenCalledTimes(1)
    expect(mocks.cleanLockedDataSheet).toHaveBeenCalledTimes(1)
    expect(mocks.openSyncRecordSheet).toHaveBeenCalledTimes(1)
  })

  // 三个「barrel 未提供该函数」兜底：产品里对应子模块加载失败/被裁剪，
  // 必须留下 WARN 日志而不是静默什么都不做（用户会以为点了没反应）。
  it('testSelected：syncSelectedRows 不可用时记 WARN 且不抛错', async () => {
    await withBarrelExportCleared('syncSelectedRows', () => {
      runAction('testSelected')
    })
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('syncSelectedRows 函数未定义'),
    )
  })

  it('previewSyncContent：previewSyncContent 不可用时记 WARN 且不抛错', async () => {
    await withBarrelExportCleared('previewSyncContent', () => {
      runAction('previewSyncContent')
    })
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('previewSyncContent 函数未定义'),
    )
  })

  it('enlargePreview：enlargePreview 不可用时记 WARN 且不抛错', async () => {
    await withBarrelExportCleared('enlargePreview', () => {
      runAction('enlargePreview')
    })
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('enlargePreview 函数未定义'),
    )
  })
})

// ========== Token / 用户 ==========

describe('ACTION_HANDLERS · Token 与用户', () => {
  it('setToken / showTokenDialog → 把已存 Token 带到对话框', () => {
    runAction('setToken')
    expect(mocks.showTokenDialog).toHaveBeenLastCalledWith('tok-123')
    runAction('showTokenDialog')
    expect(mocks.showTokenDialog).toHaveBeenCalledTimes(2)
  })

  it('没有已存 Token 时对话框收到空串而不是 undefined', () => {
    mocks.loadBgToken.mockReturnValueOnce('')
    runAction('showTokenDialog')
    expect(mocks.showTokenDialog).toHaveBeenCalledWith('')
  })

  it('clearToken → 清 Token、清用户信息、刷新两处状态并提示', () => {
    runAction('clearToken')
    expect(mocks.clearBgToken).toHaveBeenCalledTimes(1)
    expect(mocks.updateTokenStatus).toHaveBeenCalledTimes(1)
    expect(mocks.updateUserIdStatus).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledWith('Token 已清除', 'info')
  })

  it('copyToken → 成功与失败给出不同提示', () => {
    runAction('copyToken')
    expect(mocks.showToast).toHaveBeenLastCalledWith('Token 已复制到剪贴板', 'success')

    mocks.copyTokenToClipboard.mockReturnValueOnce(false)
    runAction('copyToken')
    expect(mocks.showToast).toHaveBeenLastCalledWith(
      '复制失败，可能未设置 Token 或浏览器不支持',
      'error',
    )
  })

  it('clearToken → 连接宿主时同步清掉存储里的用户信息', () => {
    const setItem = vi.fn()
    mocks.getApp.mockReturnValueOnce({ PluginStorage: { setItem } })

    runAction('clearToken')

    expect(setItem).toHaveBeenCalledWith('bgm_user_id', '')
    expect(setItem).toHaveBeenCalledWith('bgm_username', '')
    expect(mocks.showToast).toHaveBeenCalledWith('Token 已清除', 'info')
  })

  it('clearToken → 清理过程抛错时交给 BGM.handleError，且仍输出收尾日志', () => {
    mocks.clearBgToken.mockImplementationOnce(() => {
      throw new Error('存储不可写')
    })

    expect(() => runAction('clearToken')).not.toThrow()

    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: 'clearToken' }),
    )
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('清除 Token 操作完成'),
    )
  })

  it('copyToken → 剪贴板抛错时交给 BGM.handleError，且仍输出收尾日志', () => {
    mocks.copyTokenToClipboard.mockImplementationOnce(() => {
      throw new Error('剪贴板被拒绝')
    })

    expect(() => runAction('copyToken')).not.toThrow()

    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: 'copyToken' }),
    )
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('复制 Token 操作完成'),
    )
  })

  it('testToken / renewToken → 都走 Token 有效性检测', () => {
    runAction('testToken')
    runAction('renewToken')
    expect(mocks.testTokenValidity).toHaveBeenCalledTimes(2)
  })

  it('openTokenPage / showUserIdDialog / openUserCollection / testDebugConnection → 各自入口', () => {
    runAction('openTokenPage')
    runAction('showUserIdDialog')
    runAction('openUserCollection')
    runAction('testDebugConnection')
    expect(mocks.openBangumiTokenPage).toHaveBeenCalledTimes(1)
    expect(mocks.showUserIdDialog).toHaveBeenCalledTimes(1)
    expect(mocks.openUserCollection).toHaveBeenCalledTimes(1)
    expect(mocks.testDebugConnection).toHaveBeenCalledTimes(1)
  })

  it('syncCollectionFromBgm → 从 BGM 同步收藏', () => {
    runAction('syncCollectionFromBgm')
    expect(mocks.syncCollectionFromBgm).toHaveBeenCalledTimes(1)
  })
})

// ========== 同步记录 ==========

describe('ACTION_HANDLERS · 同步记录', () => {
  it('clearSyncRecords → 清空记录', () => {
    runAction('clearSyncRecords')
    expect(mocks.clearSyncRecords).toHaveBeenCalledTimes(1)
  })

  it('deduplicateSyncRecords / formatSyncRecordSheet → 完成后都要提示', () => {
    runAction('deduplicateSyncRecords')
    expect(mocks.deduplicateSyncRecords).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledWith('去重完成', 'success')

    runAction('formatSyncRecordSheet')
    expect(mocks.formatSyncRecordSheet).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledWith('格式设置完成', 'success')
  })
})

// ========== 弹窗与同步控制 ==========

describe('ACTION_HANDLERS · 弹窗与同步控制', () => {
  it('closeDetailModal → 关闭详情', () => {
    runAction('closeDetailModal')
    expect(mocks.closeDetailModal).toHaveBeenCalledTimes(1)
  })

  it('showToast / showAlert → 把 data-args 透传为标题与正文', () => {
    runAction('showToast', '已保存', 'success')
    expect(mocks.showToast).toHaveBeenCalledWith('已保存', 'success')

    runAction('showAlert', '标题', '正文')
    expect(mocks.showAlert).toHaveBeenCalledWith('标题', '正文')
  })

  it('showToast / showAlert → 缺参数时传空串（不能把 undefined 漏给 UI）', () => {
    runAction('showToast')
    expect(mocks.showToast).toHaveBeenCalledWith('', '')
    runAction('showAlert')
    expect(mocks.showAlert).toHaveBeenCalledWith('', '')
  })

  it('requestStopSync / pauseSync / resumeSync → 打到 BGM.sync 对应方法', () => {
    runAction('requestStopSync')
    runAction('pauseSync')
    runAction('resumeSync')
    expect(mocks.requestStop).toHaveBeenCalledTimes(1)
    expect(mocks.pauseSync).toHaveBeenCalledTimes(1)
    expect(mocks.resumeSync).toHaveBeenCalledTimes(1)
  })

  it('closeConnectionTest → 关闭连接测试弹窗', () => {
    runAction('closeConnectionTest')
    expect(mocks.hideConnectionTestDialog).toHaveBeenCalledTimes(1)
  })

  it('openSettings / openCleanPanel → 拉起对应面板', () => {
    runAction('openSettings')
    runAction('openCleanPanel')
    expect(mocks.showSettingsPanel).toHaveBeenCalledTimes(1)
    expect(mocks.showCleanPanel).toHaveBeenCalledTimes(1)
  })

  it('saveEnrichPreviewSettings / reloadEnrichPreviewSettings → 直接委托', () => {
    runAction('saveEnrichPreviewSettings')
    runAction('reloadEnrichPreviewSettings')
    expect(mocks.saveEnrichPreviewSettings).toHaveBeenCalledTimes(1)
    expect(mocks.reloadEnrichPreviewSettings).toHaveBeenCalledTimes(1)
  })
})

// ========== GitHub 配置：保存 ==========

describe('ACTION_HANDLERS · saveGithubConfig', () => {
  it('必填输入框缺失 → 提示 UI 元素缺失且不落盘', () => {
    runAction('saveGithubConfig')
    expect(mocks.showToast).toHaveBeenCalledWith('UI 元素缺失', 'error')
    expect(mocks.setGithubConfig).not.toHaveBeenCalled()
  })

  it('远程源：owner/repo/path 齐全 → 落盘配置、策略与同步源', () => {
    mountInput('githubOwner', 'momo')
    mountInput('githubRepo', 'bgm')
    mountInput('githubPath', 'data/out.json')
    mountSelect('githubStrategy', 'mirror')
    mountSelect('syncSourceType', 'github')

    runAction('saveGithubConfig')

    expect(mocks.setGithubConfig).toHaveBeenCalledWith({
      owner: 'momo',
      repo: 'bgm',
      branch: 'main',
      path: 'data/out.json',
      sourceType: 'github',
      gistId: undefined,
    })
    expect(mocks.setSyncStrategy).toHaveBeenCalledWith('mirror')
    expect(mocks.setSyncSourceType).toHaveBeenCalledWith('github')
    expect(mocks.showToast).toHaveBeenCalledWith(
      '配置已保存（策略：mirror，同步源：github）',
      'success',
    )
  })

  it('远程源缺任一必填项 → 提示且不落盘', () => {
    mountInput('githubOwner', '')
    mountInput('githubRepo', 'bgm')
    mountInput('githubPath', 'p')
    runAction('saveGithubConfig')
    expect(mocks.showToast).toHaveBeenCalledWith('owner / repo / path 不能为空', 'warn')
    expect(mocks.setGithubConfig).not.toHaveBeenCalled()
  })

  it('本地源：读 localFilePath，空路径拒绝', () => {
    mountInput('githubOwner', 'o')
    mountInput('githubRepo', 'r')
    mountInput('githubPath', '远程路径不该被用')
    mountInput('localFilePath', '  ')
    mountSelect('syncSourceType', 'local')

    runAction('saveGithubConfig')

    expect(mocks.showToast).toHaveBeenCalledWith('本地文件路径不能为空', 'warn')
    expect(mocks.setGithubConfig).not.toHaveBeenCalled()
  })

  it('本地源：路径有效时落盘 sourceType=local', () => {
    mountInput('githubOwner', 'o')
    mountInput('githubRepo', 'r')
    mountInput('githubPath', 'unused')
    mountInput('localFilePath', 'D:/data/x.jsonl')
    mountSelect('syncSourceType', 'local')

    runAction('saveGithubConfig')

    expect(mocks.setGithubConfig).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'D:/data/x.jsonl', sourceType: 'local' }),
    )
  })

  it('gist 源：Gist ID 为空拒绝，填写后写入 gistId', () => {
    mountInput('githubOwner', 'o')
    mountInput('githubRepo', 'r')
    mountInput('githubPath', 'p')
    mountInput('gistId', '')
    mountSelect('syncSourceType', 'gist')

    runAction('saveGithubConfig')
    expect(mocks.showToast).toHaveBeenCalledWith('Gist ID 不能为空', 'warn')

    const gistInput = document.getElementById('gistId') as HTMLInputElement
    gistInput.value = 'abc123'
    runAction('saveGithubConfig')
    expect(mocks.setGithubConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceType: 'gist', gistId: 'abc123' }),
    )
  })

  it('任一 setter 返回 false → 明确提示存储不可用（而不是假装成功）', () => {
    mountInput('githubOwner', 'o')
    mountInput('githubRepo', 'r')
    mountInput('githubPath', 'p')
    mocks.setSyncStrategy.mockReturnValueOnce(false)

    runAction('saveGithubConfig')

    expect(mocks.showToast).toHaveBeenCalledWith('保存失败：PluginStorage 不可用', 'error')
  })
})

// ========== GitHub 配置：立即同步 ==========

describe('ACTION_HANDLERS · syncFromGithub', () => {
  const result = {
    remoteTotal: 10,
    added: 3,
    updated: 2,
    deleted: 1,
    unchanged: 4,
    failed: 0,
    skipped: 0,
    details: [],
  }

  it('远程源但配置不完整 → 提示先保存配置，不发起同步', () => {
    mocks.isGithubConfigComplete.mockReturnValueOnce(false)
    runAction('syncFromGithub')
    expect(mocks.showToast).toHaveBeenCalledWith('请先填写并保存远程仓库配置', 'warn')
    expect(mocks.syncFromRemote).not.toHaveBeenCalled()
  })

  it('本地源但路径为空 → 提示先填路径', () => {
    mountSelect('syncSourceType', 'local')
    runAction('syncFromGithub')
    expect(mocks.showToast).toHaveBeenCalledWith('请先填写本地文件路径', 'warn')
    expect(mocks.syncFromRemote).not.toHaveBeenCalled()
  })

  it('用户在确认框点取消 → 不发起同步', () => {
    mocks.answer.confirm = false
    runAction('syncFromGithub')
    expect(mocks.syncFromRemote).not.toHaveBeenCalled()
  })

  it('确认后按当前策略同步，并把统计结果汇总进进度弹窗', async () => {
    mocks.syncFromRemote.mockResolvedValueOnce(result)
    mountSelect('githubStrategy', 'add-only')

    runAction('syncFromGithub')

    await vi.waitFor(() => {
      expect(mocks.syncFromRemote).toHaveBeenCalledTimes(1)
    })
    expect(mocks.syncFromRemote).toHaveBeenCalledWith(
      expect.any(Function),
      'add-only',
      expect.any(AbortSignal),
      false,
      undefined,
      undefined,
    )
    await vi.waitFor(() => {
      expect(mocks.completeSyncProgressDialog).toHaveBeenCalledTimes(1)
    })
    const [summary, details, wasStopped] = mocks.completeSyncProgressDialog.mock.calls[0] as [
      string,
      string[],
      boolean,
    ]
    expect(summary).toContain('远程 10 条')
    expect(wasStopped).toBe(false)
    // 只断言「稳定项」：收尾行会在「全部完成 / 预计剩余 / 已停止」之间切换，
    // 取决于本机耗时是否为 0（avgSpeed 与 etaMs 由真实时钟算出），断言它会 flaky
    expect(details).toEqual(
      expect.arrayContaining([
        '📥 远程数据总量: 10',
        '➕ 新增: 3',
        '✏️ 更新: 2',
        '🗑️ 删除: 1',
        '⏭️ 无变更: 4',
        '📊 实际处理: 6 条',
        '⏱️ 总耗时: 1s',
      ]),
    )
  })

  it('启用时间筛选（季度）→ timeFilter 带上 quarter', async () => {
    mocks.syncFromRemote.mockResolvedValueOnce(result)
    const chk = mountInput('chkTimeFilter')
    chk.checked = true
    mountSelect('timeFilterYear', '2026')
    mountSelect('timeFilterRange', 'quarter')
    mountSelect('timeFilterQuarter', '4')

    runAction('syncFromGithub')

    await vi.waitFor(() => {
      expect(mocks.syncFromRemote).toHaveBeenCalledTimes(1)
    })
    const callArguments = mocks.syncFromRemote.mock.calls[0] as unknown[]
    expect(callArguments[5]).toEqual({ enabled: true, year: 2026, range: 'quarter', quarter: 4 })
  })

  it('勾选「仅同步选中行」→ 透传 selectedOnly', async () => {
    mocks.syncFromRemote.mockResolvedValueOnce(result)
    const chk = mountInput('chkSyncSelectedOnly')
    chk.checked = true

    runAction('syncFromGithub')

    await vi.waitFor(() => {
      expect(mocks.syncFromRemote).toHaveBeenCalledTimes(1)
    })
    expect(mocks.syncFromRemote.mock.calls[0]?.[3]).toBe(true)
  })

  it('同步失败 → 关掉进度弹窗并提示错误', async () => {
    mocks.syncFromRemote.mockRejectedValueOnce(new Error('404 仓库不存在'))

    runAction('syncFromGithub')

    await vi.waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith('数据同步失败：404 仓库不存在', 'error')
    })
    expect(mocks.hideSyncProgressDialog).toHaveBeenCalledTimes(1)
  })

  it('用户在写入阶段中断 → 收尾文案如实标注「已停止」而非报成完成', async () => {
    mocks.syncFromRemote.mockImplementationOnce(
      async (_onProgress: unknown, _strategy: unknown, signal: AbortSignal) => {
        // 模拟「用户点了停止」：把 signal 置为 aborted 后抛错
        const progressDialogOptions = mocks.showSyncProgressDialog.mock.calls[0]?.[1] as {
          onStop: () => void
        }
        progressDialogOptions.onStop()
        void signal
        throw new Error('aborted')
      },
    )

    runAction('syncFromGithub')

    await vi.waitFor(() => {
      expect(mocks.showSyncResultDialog).toHaveBeenCalledWith(
        expect.objectContaining({ stopped: true }),
      )
    })
  })

  it('写入阶段被停止但同步本身未抛错 → 摘要与收尾行都标注「已停止」', async () => {
    mocks.syncFromRemote.mockImplementationOnce(async () => {
      // 用户在写入阶段点了停止，但 syncFromRemote 正常返回（未抛错）
      const dialogOptions = mocks.showSyncProgressDialog.mock.calls[0]?.[1] as {
        onStop: () => void
      }
      dialogOptions.onStop()
      return result
    })

    runAction('syncFromGithub')
    await vi.waitFor(() => {
      expect(mocks.completeSyncProgressDialog).toHaveBeenCalledTimes(1)
    })

    const [summary, details, wasStopped] = mocks.completeSyncProgressDialog.mock.calls[0] as [
      string,
      string[],
      boolean,
    ]
    expect(wasStopped).toBe(true)
    expect(summary).toContain('已停止')
    expect(details).toContain('⏹️ 已停止：剩余条目未处理')
  })

  it('进度回调 → 同时刷新进度弹窗与宿主状态栏', async () => {
    mocks.getApp.mockReturnValueOnce({ StatusBar: false })
    mocks.syncFromRemote.mockImplementationOnce(
      async (
        onProgress: (current: number, total: number, message: string, eta?: string) => void,
      ) => {
        onProgress(1, 10, '处理中', '约 3s')
        return result
      },
    )

    runAction('syncFromGithub')
    await vi.waitFor(() => {
      expect(mocks.completeSyncProgressDialog).toHaveBeenCalledTimes(1)
    })

    // 消息进日志区、eta 进 ETA 区（同一个 message 传两次是既有约定）
    expect(mocks.updateSyncProgressDialog).toHaveBeenCalledWith(1, 10, '处理中', '处理中', '约 3s')

    // 「数据同步」不支持暂停/恢复，但按钮仍在界面上 —— 点了必须给出明确反馈而不是静默
    const dialogOptions = mocks.showSyncProgressDialog.mock.calls[0]?.[1] as {
      onPause: () => void
      onResume: () => void
    }
    dialogOptions.onPause()
    dialogOptions.onResume()
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('数据同步不支持暂停'),
    )
    expect(mocks.bgmLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('数据同步不支持恢复'),
    )
  })

  it('打开结果详情 → 以同步记录表末行作为滚动目标', async () => {
    mocks.syncFromRemote.mockResolvedValueOnce({ ...result, details: [{ sid: 1 }] })
    mocks.getSyncRecordSheetIfExists.mockReturnValueOnce({})
    mocks.getLastRow.mockReturnValueOnce(42)

    runAction('syncFromGithub')
    await vi.waitFor(() => {
      expect(mocks.completeSyncProgressDialog).toHaveBeenCalledTimes(1)
    })

    // completeSyncProgressDialog(summary, details, wasStopped, onViewDetails, stats, detailItems)
    const onViewDetails = mocks.completeSyncProgressDialog.mock
      .calls[0]?.[3] as unknown as () => void
    onViewDetails()

    expect(mocks.showSyncResultDialog).toHaveBeenCalledWith(
      expect.objectContaining({ scrollToRow: 42, stopped: false }),
    )
  })

  it('结果详情里取记录表失败 → 不设滚动目标但照常弹结果（不能因定位失败吞掉结果）', async () => {
    mocks.syncFromRemote.mockResolvedValueOnce(result)
    mocks.getSyncRecordSheetIfExists.mockImplementationOnce(() => {
      throw new Error('记录表打不开')
    })

    runAction('syncFromGithub')
    await vi.waitFor(() => {
      expect(mocks.completeSyncProgressDialog).toHaveBeenCalledTimes(1)
    })

    const onViewDetails = mocks.completeSyncProgressDialog.mock
      .calls[0]?.[3] as unknown as () => void
    onViewDetails()

    expect(mocks.showSyncResultDialog).toHaveBeenCalledTimes(1)
    const options = mocks.showSyncResultDialog.mock.calls[0]?.[0] as unknown as {
      scrollToRow?: number
    }
    expect(options.scrollToRow).toBeUndefined()
  })

  // 时间筛选的 4 种 range 都要在确认文案里给出明确说明（用户据此判断即将拉取哪段数据）。
  // 这里只关心文案分支，故让用户在确认框点取消，避免把同步流程整条跑起来。
  it('时间筛选 range=future → 确认文案标注「预告/未来动漫」', () => {
    mocks.answer.confirm = false
    const chk = mountInput('chkTimeFilter')
    chk.checked = true
    mountSelect('timeFilterRange', 'future')

    runAction('syncFromGithub')

    const [message] = mocks.showConfirm.mock.calls.at(-1) as [string]
    expect(message).toContain('🔮 时间筛选：预告/未来动漫（无开播日期）')
    expect(mocks.syncFromRemote).not.toHaveBeenCalled()
  })

  it('时间筛选 range=year → 确认文案标注「全年」', () => {
    mocks.answer.confirm = false
    const chk = mountInput('chkTimeFilter')
    chk.checked = true
    mountSelect('timeFilterYear', '2025')
    mountSelect('timeFilterRange', 'year')

    runAction('syncFromGithub')

    const [message] = mocks.showConfirm.mock.calls.at(-1) as [string]
    expect(message).toContain('📅 时间筛选：2025年全年')
  })

  it('时间筛选 range=month → 确认文案标注月份，并把 month 透传给同步', async () => {
    mocks.syncFromRemote.mockResolvedValueOnce(result)
    const chk = mountInput('chkTimeFilter')
    chk.checked = true
    mountSelect('timeFilterYear', '2026')
    mountSelect('timeFilterRange', 'month')
    mountSelect('timeFilterMonth', '7')

    runAction('syncFromGithub')

    const [message] = mocks.showConfirm.mock.calls.at(-1) as [string]
    expect(message).toContain('📅 时间筛选：2026年7月')

    await vi.waitFor(() => {
      expect(mocks.syncFromRemote).toHaveBeenCalledTimes(1)
    })
    expect(mocks.syncFromRemote.mock.calls[0]?.[5]).toEqual({
      enabled: true,
      year: 2026,
      range: 'month',
      month: 7,
    })
  })

  it('同步失败时若宿主提供状态栏，应把忙碌状态复位', async () => {
    mocks.getApp.mockReturnValue({ StatusBar: true })
    mocks.syncFromRemote.mockRejectedValueOnce(new Error('网络中断'))

    try {
      runAction('syncFromGithub')
      await vi.waitFor(() => {
        expect(mocks.hideSyncProgressDialog).toHaveBeenCalledTimes(1)
      })
    } finally {
      mocks.getApp.mockReturnValue(null)
    }

    const app = mocks.getApp.mock.results.at(-1)?.value as { StatusBar: boolean }
    expect(app.StatusBar).toBe(false)
  })
})

// ========== GitHub 配置：连接测试 ==========

describe('ACTION_HANDLERS · testGithubConfig', () => {
  it('配置不完整 → 先提示去保存', () => {
    mocks.isGithubConfigComplete.mockReturnValueOnce(false)
    runAction('testGithubConfig')
    expect(mocks.showToast).toHaveBeenCalledWith('请先填写并保存 GitHub 配置', 'warn')
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('URL 构造抛错 → 直接弹出失败结果，不发请求', () => {
    mocks.buildRawUrl.mockImplementationOnce(() => {
      throw new Error('缺少 repo')
    })

    runAction('testGithubConfig')

    expect(mocks.showConnectionTestDialog).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorMessage: '缺少 repo', url: 'N/A' }),
    )
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('HEAD 返回 2xx/3xx → 判成功', () => {
    runAction('testGithubConfig')
    const xhr = FakeXhr.instances[0]
    if (!xhr) throw new Error('未发起探测')
    xhr.status = 200
    xhr.emit('load')

    expect(mocks.showConnectionTestDialog).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, statusCode: 200 }),
    )
  })

  it('HEAD 返回 4xx → 判失败并带上状态码', () => {
    runAction('testGithubConfig')
    const xhr = FakeXhr.instances[0]
    if (!xhr) throw new Error('未发起探测')
    xhr.status = 404
    xhr.emit('load')

    expect(mocks.showConnectionTestDialog).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, statusCode: 404, errorMessage: 'HTTP 404' }),
    )
  })

  it('网络错误与超时 → 给出各自的失败原因', () => {
    runAction('testGithubConfig')
    FakeXhr.instances[0]?.emit('error')
    expect(mocks.showConnectionTestDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ errorMessage: '网络错误：无法连接到服务器' }),
    )

    runAction('testGithubConfig')
    FakeXhr.instances.at(-1)?.ontimeout?.()
    expect(mocks.showConnectionTestDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ errorMessage: '请求超时（10秒）' }),
    )
  })
})

// ========== 本地文件选择 ==========

describe('ACTION_HANDLERS · browseLocalFile', () => {
  it('宿主没有文件对话框 → 降级为手动输入提示', () => {
    mountInput('localFilePath')
    runAction('browseLocalFile')
    expect(mocks.showToast).toHaveBeenCalledWith('WPS 文件对话框不可用，请手动输入路径', 'warn')
  })

  it('降级路径下连输入框都没有 → 只提示，不抛错', () => {
    expect(() => {
      runAction('browseLocalFile')
    }).not.toThrow()
    expect(mocks.showToast).toHaveBeenCalledWith('WPS 文件对话框不可用，请手动输入路径', 'warn')
  })

  it('用户取消选择（返回 false）→ 不写输入框', () => {
    mountWpsDialog(() => false)
    mountInput('localFilePath')
    runAction('browseLocalFile')
    expect((document.getElementById('localFilePath') as HTMLInputElement).value).toBe('')
  })

  it('选中文件 → 写入输入框并触发 input 事件（激活防抖自动保存）', () => {
    mountWpsDialog(() => 'D:/data/a.jsonl')
    const input = mountInput('localFilePath')
    const onInput = vi.fn()
    input.addEventListener('input', onInput)

    runAction('browseLocalFile')

    expect(input.value).toBe('D:/data/a.jsonl')
    expect(onInput).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledWith('已选择：D:/data/a.jsonl', 'success')
  })

  it('对话框抛错 → 提示选择失败而不是静默', () => {
    mountWpsDialog(() => {
      throw new Error('对话框被占用')
    })
    mountInput('localFilePath')
    runAction('browseLocalFile')
    expect(mocks.showToast).toHaveBeenCalledWith('选择文件失败：对话框被占用', 'error')
  })
})

// ========== 撤销 / 日志 ==========

describe('ACTION_HANDLERS · 撤销与系统日志', () => {
  it('undoLastSync → 执行撤销', async () => {
    runAction('undoLastSync')
    await vi.waitFor(() => {
      expect(mocks.executeUndoLastSync).toHaveBeenCalledTimes(1)
    })
  })

  it('undoLastSync 失败 → 提示撤销失败', async () => {
    mocks.executeUndoLastSync.mockRejectedValueOnce(new Error('没有可撤销的记录'))
    runAction('undoLastSync')
    await vi.waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith('撤销失败：没有可撤销的记录', 'error')
    })
  })

  it('showLogPanel → 显示弹窗并渲染条目', () => {
    const modal = mountDiv('logModal')
    runAction('showLogPanel')
    expect(modal.style.display).toBe('block')
    expect(mocks.renderLogEntries).toHaveBeenCalledTimes(1)
  })

  it('showLogPanel / closeLogModal 在没有弹窗元素时静默（不抛错）', () => {
    expect(() => {
      runAction('showLogPanel')
      runAction('closeLogModal')
    }).not.toThrow()
    expect(mocks.renderLogEntries).not.toHaveBeenCalled()
  })

  it('closeLogModal → 隐藏弹窗', () => {
    const modal = mountDiv('logModal')
    modal.style.display = 'block'
    runAction('closeLogModal')
    expect(modal.style.display).toBe('none')
  })

  it('exportLogs → 走统一导出源（systemLogs / txt）', () => {
    runAction('exportLogs')
    expect(mocks.exportData).toHaveBeenCalledWith('systemLogs', 'txt', { logLevel: undefined })
  })

  it('exportLogs → 顶部级别下拉框的取值作为筛选条件透传（空串须转成 undefined）', () => {
    const select = document.createElement('select')
    select.id = 'logLevelFilter'
    for (const value of ['', 'ERROR']) {
      const option = document.createElement('option')
      option.value = value
      select.append(option)
    }
    document.body.append(select)

    select.value = 'ERROR'
    runAction('exportLogs')
    expect(mocks.exportData).toHaveBeenLastCalledWith('systemLogs', 'txt', { logLevel: 'ERROR' })

    // 空串 = 全部级别。若原样传 ''，会被下游当成「筛选 ERROR 之外的级别」这类假条件
    select.value = ''
    runAction('exportLogs')
    expect(mocks.exportData).toHaveBeenLastCalledWith('systemLogs', 'txt', { logLevel: undefined })
  })

  it('exportData → 缺数据源参数时拒绝执行', () => {
    runAction('exportData')
    expect(mocks.exportData).not.toHaveBeenCalled()
  })

  it('exportData → 只有 txt 透传，其余一律按 csv（防拼错格式）', () => {
    runAction('exportData', 'cleanLogs', 'txt')
    expect(mocks.exportData).toHaveBeenLastCalledWith('cleanLogs', 'txt')
    runAction('exportData', 'cleanLogs', 'TXT')
    expect(mocks.exportData).toHaveBeenLastCalledWith('cleanLogs', 'csv')
    runAction('exportData', 'cleanLogs')
    expect(mocks.exportData).toHaveBeenLastCalledWith('cleanLogs', 'csv')
  })

  it('clearLogs → 清空缓冲区并重渲染', () => {
    runAction('clearLogs')
    expect(mocks.clearLogs).toHaveBeenCalledTimes(1)
    expect(mocks.renderLogEntries).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledWith('日志已清空', 'info')
  })
})

// ========== 重置配置 ==========

describe('ACTION_HANDLERS · resetAllConfig', () => {
  it('用户取消 → 只提示取消，不删任何键', () => {
    mocks.answer.confirm = false
    runAction('resetAllConfig')
    expect(mocks.removeConfig).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('已取消重置', 'info')
  })

  it('确认后逐个删除可重置键，并提示删除数量', () => {
    mocks.getResettableConfigKeys.mockReturnValueOnce(['LOG_LEVEL', 'GITHUB_CONFIG'])
    mocks.removeConfig.mockReturnValue(true)

    runAction('resetAllConfig')

    expect(mocks.removeConfig).toHaveBeenCalledTimes(2)
    expect(mocks.applyLogLevel).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledWith('已重置 2 项配置，正在重新加载…', 'success')
  })

  it('单个键删除失败不影响其余键（计数只算成功的）', () => {
    mocks.getResettableConfigKeys.mockReturnValueOnce(['A', 'B'])
    mocks.removeConfig.mockReturnValueOnce(true).mockImplementationOnce(() => {
      throw new Error('存储只读')
    })

    runAction('resetAllConfig')

    expect(mocks.showToast).toHaveBeenCalledWith('已重置 1 项配置，正在重新加载…', 'success')
  })

  // 注：确认重置后的 `window.location.reload()`（延迟 600ms）不做断言 ——
  // jsdom 的 location.reload 不可被 spy，真实调用只会打印 "Not implemented: navigation"。
  // 该行为属宿主能力，留给真机验证。
  it('确认后 600ms 触发页面重载（假定时器推进到点）', () => {
    mocks.getResettableConfigKeys.mockReturnValueOnce(['LOG_LEVEL'])
    mocks.removeConfig.mockReturnValue(true)

    vi.useFakeTimers()
    try {
      runAction('resetAllConfig')
      // 定时器已挂上：推进到 600ms 会执行 window.location.reload()
      // （jsdom 只会打印 "Not implemented: navigation"，不会抛错）
      expect(() => {
        vi.advanceTimersByTime(600)
      }).not.toThrow()
    } finally {
      vi.useRealTimers()
    }

    expect(mocks.showToast).toHaveBeenCalledWith('已重置 1 项配置，正在重新加载…', 'success')
  })
})

// ========== 引导面板 ==========

describe('ACTION_HANDLERS · 使用引导', () => {
  it('showSyncGuide → 按当前策略写入说明并展开', () => {
    const note = mountDiv('mirrorSyncNote')
    mountSelect('githubStrategy', 'mirror')

    runAction('showSyncGuide')

    expect(note.innerHTML).toContain('镜像同步')
    expect(note.style.display).toBe('block')
  })

  it('showSyncGuide → 再次点击收起', () => {
    const note = mountDiv('mirrorSyncNote')
    note.style.display = 'block'
    runAction('showSyncGuide')
    expect(note.style.display).toBe('none')
  })

  it('showSyncGuide → 无说明元素时不抛错', () => {
    expect(() => {
      runAction('showSyncGuide')
    }).not.toThrow()
  })

  it('toggleUsageGuide → 在显示/隐藏之间切换，并同步按钮文案', () => {
    const detail = mountDiv('usageGuideDetail')
    const button = mountButton('toggleUsageGuideBtn')

    runAction('toggleUsageGuide')
    expect(detail.style.display).toBe('none')
    expect(button.textContent).toBe('📖 显示详细操作')

    runAction('toggleUsageGuide')
    expect(detail.style.display).toBe('block')
    expect(button.textContent).toBe('📖 收起详细操作')
  })

  it('toggleUsageGuide → 元素缺失时静默', () => {
    expect(() => {
      runAction('toggleUsageGuide')
    }).not.toThrow()
  })
})

// ========== 保存全部配置 ==========

describe('ACTION_HANDLERS · saveAllConfig', () => {
  it('把当前各项配置重新持久化，并汇总已保存项', () => {
    mocks.getGithubConfig.mockReturnValueOnce({ owner: 'momo', repo: 'bgm' })
    mocks.isIncrementalSyncEnabled.mockReturnValueOnce(true)
    mocks.isSkipConflictsEnabled.mockReturnValueOnce(true)
    mocks.isSyncRecordEnabled.mockReturnValueOnce(true)

    runAction('saveAllConfig')

    expect(mocks.storeBgToken).toHaveBeenCalledWith('tok-123')
    expect(mocks.setGithubConfig).toHaveBeenCalledWith({ owner: 'momo', repo: 'bgm' })
    expect(mocks.setIncrementalSync).toHaveBeenCalledWith(true)
    expect(mocks.setSkipConflicts).toHaveBeenCalledWith(true)
    expect(mocks.setSyncRecordEnabled).toHaveBeenCalledWith(true)
    expect(mocks.setSyncStrategy).toHaveBeenCalledWith('add-update')
    expect(mocks.showToast).toHaveBeenCalledWith('所有配置已保存', 'success')
  })

  it('没有 Token、没有仓库配置时也能保存（只是不包含这些项）', () => {
    mocks.loadBgToken.mockReturnValueOnce('')
    mocks._getBgmUserId.mockReturnValueOnce('')

    runAction('saveAllConfig')

    expect(mocks.storeBgToken).not.toHaveBeenCalled()
    expect(mocks.setGithubConfig).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('所有配置已保存', 'success')
  })

  it('任一读取抛错 → 提示保存失败而不是静默', () => {
    mocks.getGithubConfig.mockImplementationOnce(() => {
      throw new Error('存储不可用')
    })

    runAction('saveAllConfig')

    expect(mocks.showToast).toHaveBeenCalledWith('保存失败：存储不可用', 'error')
  })
})

// ========== 默认路径记忆 ==========

describe('ACTION_HANDLERS · 默认路径', () => {
  it('selectExportPath → 选中后落盘并刷新显示', () => {
    runAction('selectExportPath')
    expect(mocks.setExportPath).toHaveBeenCalledWith('/picked/dir')
    expect(mocks.updatePathDisplay).toHaveBeenCalledWith('exportPathDisplay', '/picked/dir')
    expect(mocks.showToast).toHaveBeenCalledWith('已设置默认导出位置', 'success')
  })

  it('selectExportPath → 用户取消则只提示取消', () => {
    mocks.selectDefaultFolder.mockReturnValueOnce(null)
    runAction('selectExportPath')
    expect(mocks.setExportPath).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('已取消选择导出位置', 'info')
  })

  it('clearExportPath → 有值才写存储，但显示始终清空', () => {
    mocks.getExportPath.mockReturnValueOnce('/old/dir')
    runAction('clearExportPath')
    expect(mocks.setExportPath).toHaveBeenCalledWith('')
    expect(mocks.updatePathDisplay).toHaveBeenCalledWith('exportPathDisplay', '')
    expect(mocks.showToast).toHaveBeenCalledWith('已清除默认导出位置', 'info')
  })

  it('clearExportPath → 本来就没值时不做多余写入', () => {
    runAction('clearExportPath')
    expect(mocks.setExportPath).not.toHaveBeenCalled()
  })

  it('selectImportPath / clearImportPath → 与导出一致的两侧行为', () => {
    runAction('selectImportPath')
    expect(mocks.setImportPath).toHaveBeenCalledWith('/picked/dir')
    expect(mocks.updatePathDisplay).toHaveBeenCalledWith('importPathDisplay', '/picked/dir')
    expect(mocks.showToast).toHaveBeenCalledWith('已设置默认导入文件夹', 'success')

    mocks.selectDefaultFolder.mockReturnValueOnce(null)
    runAction('selectImportPath')
    expect(mocks.showToast).toHaveBeenCalledWith('已取消选择导入文件夹', 'info')

    mocks.getImportPath.mockReturnValueOnce('/old')
    runAction('clearImportPath')
    expect(mocks.setImportPath).toHaveBeenCalledWith('')
    expect(mocks.showToast).toHaveBeenCalledWith('已清除默认导入文件夹', 'info')
  })
})

// ========== 配置导入导出 ==========

describe('ACTION_HANDLERS · exportConfig', () => {
  it('导出 JSON 并同时复制到剪贴板，提示里区分是否设过默认位置', () => {
    mocks.getExportPath.mockReturnValueOnce('/default/dir')

    runAction('exportConfig')

    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1)
    expect(mocks.copyTextToClipboard).toHaveBeenCalledWith('{"logLevel":2}')
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('/default/dir'), 'success')
  })

  it('未设置默认位置时提示里如实写「未设置」', () => {
    runAction('exportConfig')
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.stringContaining('未设置默认位置'),
      'success',
    )
  })

  it('导出过程抛错 → 提示导出失败', () => {
    mocks.exportConfig.mockImplementationOnce(() => {
      throw new Error('序列化失败')
    })
    runAction('exportConfig')
    expect(mocks.showToast).toHaveBeenCalledWith('配置导出失败：序列化失败', 'error')
  })
})

describe('ACTION_HANDLERS · importConfig', () => {
  it('从文件导入：读文件成功后应用配置并刷新界面', async () => {
    mountWpsDialog(() => 'D:/cfg.json')
    mocks.readLocalFileContent.mockResolvedValueOnce('{"logLevel":3}')

    runAction('importConfig')

    await vi.waitFor(() => {
      expect(mocks.importConfig).toHaveBeenCalledWith('{"logLevel":3}')
    })
    expect(mocks.applyLogLevel).toHaveBeenCalledTimes(1)
    expect(mocks.updateTokenStatus).toHaveBeenCalledTimes(1)
    expect(mocks.updateUserIdStatus).toHaveBeenCalledTimes(1)
    expect(mocks.refreshGithubConfigInputs).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledWith('配置导入成功', 'success')
  })

  it('读文件失败 → 提示读取失败而不是导入失败', async () => {
    mountWpsDialog(() => 'D:/cfg.json')
    mocks.readLocalFileContent.mockRejectedValueOnce(new Error('文件不存在'))

    runAction('importConfig')

    await vi.waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith('读取配置文件失败：文件不存在', 'error')
    })
    expect(mocks.importConfig).not.toHaveBeenCalled()
  })

  it('用户取消文件选择 → 回退到粘贴输入', () => {
    mountWpsDialog(() => false)
    mocks.answer.input = '{"logLevel":1}'

    runAction('importConfig')

    expect(mocks.showInput).toHaveBeenCalledTimes(1)
    expect(mocks.importConfig).toHaveBeenCalledWith('{"logLevel":1}')
  })

  it('粘贴为空 → 提示取消导入', () => {
    mocks.answer.input = ' '.repeat(3)
    runAction('importConfig')
    expect(mocks.importConfig).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('未提供配置 JSON，已取消导入', 'info')
  })

  it('导入失败按错误类型给出可读文案（Error / 字符串 / null / 对象）', () => {
    const failureCases: { error: unknown; expected: string }[] = [
      { error: new Error('版本不支持'), expected: '版本不支持' },
      { error: '纯字符串错误', expected: '纯字符串错误' },
      { error: null, expected: '未知错误' },
      { error: { code: 42 }, expected: '{"code":42}' },
    ]

    for (const { error, expected } of failureCases) {
      mocks.importConfig.mockReturnValueOnce({ isOk: () => false, error })
      mocks.answer.input = '{}'
      runAction('importConfig')
      expect(mocks.showToast).toHaveBeenCalledWith(`导入失败：${expected}`, 'error')
    }
  })
})

// ========== 关闭面板 ==========

describe('ACTION_HANDLERS · closePanel', () => {
  it('拿不到 Application → 记警告且不抛错', () => {
    runAction('closePanel')
    expect(mocks.showToast).not.toHaveBeenCalledWith('面板已关闭', 'info')
  })

  it('没有记录面板 ID → 不发关闭提示', () => {
    mocks.getApp.mockReturnValueOnce({
      PluginStorage: { getItem: () => null },
    })
    runAction('closePanel')
    expect(mocks.showToast).not.toHaveBeenCalledWith('面板已关闭', 'info')
  })

  it('有 ID 且能找到面板 → 置为不可见并提示', () => {
    const pane = { Visible: true }
    mocks.getApp.mockReturnValueOnce({
      PluginStorage: { getItem: () => 'pane-1' },
      GetTaskPane: () => pane,
    })

    runAction('closePanel')

    expect(pane.Visible).toBe(false)
    expect(mocks.showToast).toHaveBeenCalledWith('面板已关闭', 'info')
  })
})

// ========== 设置页开关 ==========

describe('ACTION_HANDLERS · 设置页开关', () => {
  it('toggleIncrementalSync → 按勾选状态落盘并提示', () => {
    const checkbox = mountInput('chkIncrementalSync')
    checkbox.checked = true
    runAction('toggleIncrementalSync')
    expect(mocks.setIncrementalSync).toHaveBeenCalledWith(true)
    expect(mocks.showToast).toHaveBeenCalledWith('增量同步已开启', 'success')

    checkbox.checked = false
    runAction('toggleIncrementalSync')
    expect(mocks.setIncrementalSync).toHaveBeenLastCalledWith(false)
    expect(mocks.showToast).toHaveBeenCalledWith('增量同步已关闭', 'success')
  })

  it('toggleSkipConflicts → 文案区分「跳过冲突 / Excel覆盖」', () => {
    const checkbox = mountInput('chkSkipConflicts')
    checkbox.checked = true
    runAction('toggleSkipConflicts')
    expect(mocks.setSkipConflicts).toHaveBeenCalledWith(true)
    expect(mocks.showToast).toHaveBeenCalledWith('冲突处理: 跳过冲突', 'success')

    checkbox.checked = false
    runAction('toggleSkipConflicts')
    expect(mocks.showToast).toHaveBeenCalledWith('冲突处理: Excel覆盖', 'success')
  })

  it('toggleEnableSyncRecord → 落盘并提示', () => {
    const checkbox = mountInput('chkEnableSyncRecord')
    checkbox.checked = true
    runAction('toggleEnableSyncRecord')
    expect(mocks.setSyncRecordEnabled).toHaveBeenCalledWith(true)
    expect(mocks.showToast).toHaveBeenCalledWith('同步记录已开启', 'success')
  })

  it('toggleNavIconsOnly → 落盘 + 同步 body 类名（仅图标模式）', () => {
    const checkbox = mountInput('chkNavIconsOnly')
    checkbox.checked = true
    runAction('toggleNavIconsOnly')
    expect(mocks.setNavIconsOnly).toHaveBeenCalledWith(true)
    expect(document.body.classList.contains('nav-icons-only')).toBe(true)

    checkbox.checked = false
    runAction('toggleNavIconsOnly')
    expect(document.body.classList.contains('nav-icons-only')).toBe(false)
    expect(mocks.showToast).toHaveBeenCalledWith('导航模式: 图标+文字', 'success')
  })

  it('控件缺失时按「关闭」处理（不会把缺失误判为开启）', () => {
    runAction('toggleIncrementalSync')
    runAction('toggleSkipConflicts')
    runAction('toggleEnableSyncRecord')
    runAction('toggleNavIconsOnly')
    expect(mocks.setIncrementalSync).toHaveBeenCalledWith(false)
    expect(mocks.setSkipConflicts).toHaveBeenCalledWith(false)
    expect(mocks.setSyncRecordEnabled).toHaveBeenCalledWith(false)
    expect(mocks.setNavIconsOnly).toHaveBeenCalledWith(false)
  })
})

// ========== handleActionClick ==========

describe('handleActionClick', () => {
  it('没有 data-action → 直接返回（不报错）', () => {
    clickButton()
    expect(mocks.bgmLog).not.toHaveBeenCalled()
  })

  it('合法 data-args → 解析后透传给 handler', () => {
    clickButton('exportData', '["cleanLogs","csv"]')
    expect(mocks.exportData).toHaveBeenCalledWith('cleanLogs', 'csv')
  })

  it('data-args 不是合法 JSON → 记警告但继续执行 handler（不能吞掉用户操作）', () => {
    clickButton('exportLogs', '{坏 JSON')
    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: 'handleActionClick' }),
    )
    expect(mocks.exportData).toHaveBeenCalledWith('systemLogs', 'txt', { logLevel: undefined })
  })

  it('未知 action → 记警告且不抛错', () => {
    expect(() => {
      clickButton('not-a-real-action')
    }).not.toThrow()
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('handler 内部抛错 → 交给 BGM.handleError 并带上 action 名', () => {
    mocks.refreshData.mockImplementationOnce(() => {
      throw new Error('刷新炸了')
    })

    clickButton('refreshData')

    expect(mocks.handleError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ context: 'handleActionClick:refreshData', showAlert: true }),
    )
  })
})
