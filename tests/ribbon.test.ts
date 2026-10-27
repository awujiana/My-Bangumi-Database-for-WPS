/**
 * @fileoverview Ribbon 按钮分发与图标兜底的运行时行为测试
 *
 * 测试目标：
 *   - OnAction 按「同步分发表 → 异步分发表 → 未知按钮告警」顺序分发
 *   - 同步处理函数抛错被 OnAction 的 try/catch 捕获，不打断宿主
 *   - 异步处理函数 reject 被 runAsyncRibbonAction 捕获，不产生未处理的 Promise 拒绝
 *   - GetBangumiImage 未登记的按钮 ID 走 newFromTemp.svg 兜底
 *
 * 与 scripts/check-ribbon-buttons.mjs 的分工（P2-9 平行清单）：
 *   - 「ribbon.xml 里每个按钮都在分发表/图标表里」属于跨文件一致性，由门禁脚本
 *     静态校验（本目录测试不允许 import node:fs）；
 *   - 本文件只覆盖运行时行为，两者互补。
 *
 * Mock 策略：
 *   - ribbon.ts 模块顶层只做 window 挂载，导入 ../ts/index.js（大 barrel）与
 *     services/ribbon-service.js，故二者整体 mock，只需提供被直接引用的名字。
 *   - 持有 bgmLog / handleError / 各面板打开函数的引用以便断言调用。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'

const mockState = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  handleError: vi.fn(),
  showBangumiPanel: vi.fn(),
  syncWithConfirmation: vi.fn(() => Promise.resolve()),
  closeAllPanels: vi.fn(() => 0),
  notifyToast: vi.fn(),
}))

vi.mock('../ts/index.js', () => ({
  WPS_ENUM: {},
  showBangumiPanel: mockState.showBangumiPanel,
  showEnrichPanel: vi.fn(),
  showSettingsPanel: vi.fn(),
  showCleanPanel: vi.fn(),
  showHighlightPanel: vi.fn(),
  showConditionalFormatPanel: vi.fn(),
  closeAllPanels: mockState.closeAllPanels,
  getApp: vi.fn(() => null),
  isIncrementalSyncEnabled: vi.fn(() => false),
  isSkipConflictsEnabled: vi.fn(() => false),
  setIncrementalSync: vi.fn(),
  setSkipConflicts: vi.fn(),
  isSyncRecordEnabled: vi.fn(() => false),
  setSyncRecordEnabled: vi.fn(),
  bgmLog: mockState.bgmLog,
  LOG_LEVELS: { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  BGM: { handleError: mockState.handleError, ErrorLevel: { WARN: 'WARN', ERROR: 'ERROR' } },
}))

// ribbon.ts 的 toast 走 ui-bridge 依赖反转桥，mock 掉以便断言反馈文案
vi.mock('../ts/core/ui-bridge.js', () => ({
  getNotifyApi: () => ({ toast: mockState.notifyToast }),
}))

vi.mock('../ts/services/ribbon-service.js', () => ({
  syncWithConfirmation: mockState.syncWithConfirmation,
  setTokenForRibbon: vi.fn(() => true),
  testTokenForRibbon: vi.fn(() => Promise.resolve()),
  copyTokenForRibbon: vi.fn(() => Promise.resolve()),
  setUserIdForRibbon: vi.fn(),
  openCollectionForRibbon: vi.fn(),
  syncFromGithubForRibbon: vi.fn(() => Promise.resolve(null)),
  undoLastSyncForRibbon: vi.fn(() => Promise.resolve()),
}))

vi.mock('../ts/sync/workbook-auto-detect.js', () => ({
  initializeWorkbookAutoDetection: vi.fn(),
}))

import { OnAction, GetBangumiImage } from '../ts/ribbon.js'

/** 图标兜底路径：返回它即表示该按钮 ID 没有专属图标 */
const FALLBACK_ICON = 'images/newFromTemp.svg'

/** 取 bgmLog 中「未知按钮」告警的次数 */
function countUnknownButtonWarnings(): number {
  return mockState.bgmLog.mock.calls.filter(
    (call: unknown[]) => call[0] === 'WARN' && String(call[1]).includes('未知按钮'),
  ).length
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('OnAction 分发', () => {
  it('面板类按钮命中同步分发表并调用对应打开函数', () => {
    expect(OnAction({ Id: 'btnShowPanel' })).toBe(true)

    expect(mockState.showBangumiPanel).toHaveBeenCalledTimes(1)
    expect(countUnknownButtonWarnings()).toBe(0)
  })

  it('异步按钮命中异步分发表（同步返回 true，不阻塞宿主）', () => {
    expect(OnAction({ Id: 'btnSyncBangumi' })).toBe(true)

    expect(mockState.syncWithConfirmation).toHaveBeenCalledTimes(1)
    expect(countUnknownButtonWarnings()).toBe(0)
  })

  it('未登记的按钮 ID 落「未知按钮」告警，但仍返回 true（不打断宿主）', () => {
    expect(OnAction({ Id: 'btnNotDeclaredInXml' })).toBe(true)

    expect(countUnknownButtonWarnings()).toBe(1)
    expect(mockState.handleError).not.toHaveBeenCalled()
  })

  it('同步处理函数抛错时被捕获并交给 handleError，OnAction 仍返回 true', () => {
    mockState.showBangumiPanel.mockImplementationOnce(() => {
      throw new Error('面板打开失败')
    })

    expect(OnAction({ Id: 'btnShowPanel' })).toBe(true)

    expect(mockState.handleError).toHaveBeenCalledTimes(1)
  })

  it('异步处理函数 reject 时被捕获并交给 handleError，不产生未处理的 Promise 拒绝', async () => {
    mockState.syncWithConfirmation.mockRejectedValueOnce(new Error('同步失败'))

    expect(OnAction({ Id: 'btnSyncBangumi' })).toBe(true)

    await vi.waitFor(() => {
      expect(mockState.handleError).toHaveBeenCalledTimes(1)
    })
  })
})

describe('OnAction：一键关闭所有页面', () => {
  it('命中同步分发表，按实际关闭数量播报', () => {
    mockState.closeAllPanels.mockReturnValueOnce(3)

    expect(OnAction({ Id: 'btnCloseAllPanels' })).toBe(true)

    expect(mockState.closeAllPanels).toHaveBeenCalledTimes(1)
    expect(mockState.notifyToast).toHaveBeenCalledWith('已关闭 3 个工具页面', 'success')
    expect(countUnknownButtonWarnings()).toBe(0)
  })

  it('一个都没关时明确播报「没有打开的工具页面」（否则用户以为按钮坏了）', () => {
    mockState.closeAllPanels.mockReturnValueOnce(0)

    expect(OnAction({ Id: 'btnCloseAllPanels' })).toBe(true)

    expect(mockState.notifyToast).toHaveBeenCalledWith('当前没有打开的工具页面', 'info')
  })

  it('closeAllPanels 抛错时被 OnAction 的 try/catch 捕获，不打断宿主', () => {
    mockState.closeAllPanels.mockImplementationOnce(() => {
      throw new Error('宿主不可用')
    })

    expect(OnAction({ Id: 'btnCloseAllPanels' })).toBe(true)

    expect(mockState.handleError).toHaveBeenCalledTimes(1)
    expect(mockState.notifyToast).not.toHaveBeenCalled()
  })
})

describe('GetBangumiImage 图标兜底', () => {
  it('未登记的按钮 ID 返回 newFromTemp.svg 兜底', () => {
    expect(GetBangumiImage({ Id: 'btnNotDeclaredInXml' })).toBe(FALLBACK_ICON)
  })

  it('已登记的按钮 ID 返回 images/ 下的 svg 路径', () => {
    expect(GetBangumiImage({ Id: 'btnShowPanel' })).toMatch(/^images\/.+\.svg$/u)
  })
})
