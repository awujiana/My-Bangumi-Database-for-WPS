/**
 * @fileoverview sync-result-dialog 单测
 *
 * 覆盖 `ts/ui/sync-result-dialog.ts`（此前无任何测试，行覆盖 2.17%）：
 *   - formatDuration（2026-10-15 起三份实现已收敛到 `tools/util/duration.ts`，本文件覆盖其对外转出）
 *   - computeDateStatsFromSheet（最早/最晚开播日、最新季度、日期条数计数、日期格式容错）
 *   - showSyncResultDialog（标题/图标随 stopped 变化、完成度环配色、失败与跳过徽标、
 *     导出按钮、查看详情按钮的三条分支、关闭按钮与 ESC、日期统计区块）
 *   - 同步详情预览弹窗（两种状态提示、起始行号、明细表、遮罩点击、关闭按钮与 ESC）
 *
 * 依赖形状：全部为叶子模块或单一 barrel（`tools/util/index.js`）→ 逐模块 `vi.mock` 即可接管，
 * 不存在 barrel 循环死锁。COM 侧只提供「内存工作表」桩，不做真实 Range 交互。
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ========== Mock 基础设施 ==========

const mocks = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  exportSheetToJsonlFile: vi.fn<() => boolean>(() => true),
  renderSyncDetailTable: vi.fn<(details: unknown[]) => string>(() => '<table class="detail"/>'),
  getSyncRecordSheetIfExists: vi.fn<() => unknown>(() => null),
  openSyncRecordSheet: vi.fn<(row?: number) => void>(),
  isSyncRecordEnabled: vi.fn<() => boolean>(() => true),
}))

/** 单元格存储：`行_列` → 值 */
const store = new Map<string, string>()
/** 为 true 时 getDataSheet() 返回 null（模拟没有数据表） */
let isDataSheetMissing = false
/** 数据表桩：被 mock 生产代码原样回传，测试只关心「非空」 */
const DATA_SHEET = { Name: 'data' }

function cellKey(row: number, col: number): string {
  return `${String(row)}_${String(col)}`
}

function getCell(row: number, col: number): string {
  return store.get(cellKey(row, col)) ?? ''
}

function setCell(row: number, col: number, value: string): void {
  store.set(cellKey(row, col), value)
}

/** 首个有任意非空值的行（1..10） */
function findHeaderRowStub(): number {
  for (let row = 1; row <= 10; row += 1) {
    for (let col = 1; col <= 12; col += 1) {
      if (getCell(row, col).trim()) return row
    }
  }
  return 0
}

function getColumnMapStub(_sheet: unknown, headerRow: number): Map<string, number> {
  const map = new Map<string, number>()
  for (let col = 1; col <= 50; col += 1) {
    const value = getCell(headerRow, col).trim()
    if (value) map.set(value, col)
  }
  return map
}

/** 末行：表头行之后仍存在非空值的最大行号 */
function getLastRowStub(): number {
  const headerRow = findHeaderRowStub()
  if (headerRow <= 0) return 1
  let lastRow = headerRow
  for (let row = headerRow + 1; row <= 500; row += 1) {
    if (hasAnyValueInRow(row)) lastRow = row
  }
  return lastRow
}

function hasAnyValueInRow(row: number): boolean {
  for (let col = 1; col <= 50; col += 1) {
    if (getCell(row, col).trim()) return true
  }
  return false
}

function trimStub(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/^\s+|\s+$/g, '')
}

function isEmptyValueStub(value: string | null | undefined): boolean {
  if (!value) return true
  return value.trim() === ''
}

vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: mocks.bgmLog,
  BGM: { handleError: vi.fn(), ErrorLevel: { ERROR: 'ERROR' } },
  getDataSheet: () => (isDataSheetMissing ? null : DATA_SHEET),
  getCellValue: (_sheet: unknown, row: number, col: number) => getCell(row, col),
  setCellValue: (_sheet: unknown, row: number, col: number, value: unknown) => {
    setCell(row, col, String(value))
  },
  getLastRow: getLastRowStub,
  findHeaderRow: findHeaderRowStub,
  getColumnMap: getColumnMapStub,
  readRangeValues: () => [],
  trim: trimStub,
  isEmptyValue: isEmptyValueStub,
}))

vi.mock('../ts/ui/dialog.js', () => ({
  renderSyncDetailTable: mocks.renderSyncDetailTable,
}))

vi.mock('../ts/sync/export-jsonl.js', () => ({
  exportSheetToJsonlFile: mocks.exportSheetToJsonlFile,
}))

vi.mock('../ts/sync/sync-record.js', () => ({
  getSyncRecordSheetIfExists: mocks.getSyncRecordSheetIfExists,
  openSyncRecordSheet: mocks.openSyncRecordSheet,
  addSyncRecord: vi.fn(),
  addSyncRecords: vi.fn(() => true),
  SYNC_RECORD_COLUMNS: [],
}))

vi.mock('../ts/tools/config.js', () => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  CONFIG_KEYS: { SYNC_RECORD_ENABLED: 'bgm_sync_record_enabled' },
  isSyncRecordEnabled: mocks.isSyncRecordEnabled,
}))

// ========== 导入被测模块 ==========

import {
  computeDateStatsFromSheet,
  formatDuration,
  hideSyncResultDialog,
  showSyncResultDialog,
} from '../ts/ui/sync-result-dialog.js'
import type { SyncResultDialogOptions } from '../ts/ui/sync-result-dialog.js'
import type { GithubSyncResult } from '../ts/sync/github-sync.js'
import { LOG_LEVELS } from '../ts/core/constants.js'

// ========== 测试数据 ==========

const SHEET_SECTION_TITLE = '数据统计'

function makeResult(overrides: Partial<GithubSyncResult> = {}): GithubSyncResult {
  return {
    remoteTotal: 10,
    added: 3,
    updated: 2,
    deleted: 1,
    unchanged: 4,
    skipped: 0,
    failed: 0,
    ...overrides,
  }
}

function makeOptions(overrides: Partial<SyncResultDialogOptions> = {}): SyncResultDialogOptions {
  return {
    result: makeResult(),
    elapsedMs: 90_000,
    avgSpeed: 12.5,
    strategyLabel: '智能合并',
    stopped: false,
    ...overrides,
  }
}

/** 播种「数据表」：表头（名称 / 开播日期 / Bangumi_URL）+ 数据行 */
function seedDateSheet(rows: [string, string, string][]): void {
  setCell(1, 1, '名称')
  setCell(1, 2, '开播日期')
  setCell(1, 3, 'Bangumi_URL')
  for (const [index, rowValues] of rows.entries()) {
    const row = index + 2
    setCell(row, 1, rowValues[0])
    setCell(row, 2, rowValues[1])
    setCell(row, 3, rowValues[2])
  }
}

/** 关闭并清空所有弹窗（私有 hide 未导出，预览弹窗通过关闭按钮触发） */
function cleanupDialogs(): void {
  hideSyncResultDialog()
  document.querySelector<HTMLElement>('#bgmPreviewCloseBtn')?.click()
  document.body.replaceChildren()
}

/** 取结果弹窗中的文本内容 */
function resultDialogHtml(): string {
  return document.querySelector<HTMLElement>('.bgm-modal')?.innerHTML ?? ''
}

/** 取预览弹窗（按标题 id 定位，避免与结果弹窗混淆） */
function previewDialog(): HTMLElement | null {
  const title = document.querySelector<HTMLElement>('#bgmPreviewTitle')
  return title?.closest<HTMLElement>('.bgm-modal') ?? null
}

/**
 * 点击「查看详情」并等待异步分支完成
 *
 * 「查看详情」的处理函数是异步的（内部走动态 import），若上一次留下的预览弹窗
 * 仍在 DOM 中，`previewDialog() !== null` 会立刻成立而错过新弹窗的渲染 ——
 * 此时必须传入 `needle`，等待新内容真正出现。
 */
async function clickViewDetails(needle?: string): Promise<void> {
  document.querySelector<HTMLElement>('#bgmResultViewDetailsBtn')?.click()
  await vi.waitFor(() => {
    const dialog = previewDialog()
    const isPreviewOpened =
      dialog !== null && (needle === undefined || dialog.innerHTML.includes(needle))
    const isRecordSheetOpened = mocks.openSyncRecordSheet.mock.calls.length > 0
    expect(isPreviewOpened || isRecordSheetOpened).toBe(true)
  })
}

/** 走「查看详情」分支打开预览弹窗（needle 语义见 clickViewDetails） */
async function openPreview(
  options: Partial<SyncResultDialogOptions> = {},
  needle?: string,
): Promise<void> {
  mocks.isSyncRecordEnabled.mockReturnValue(false)
  showSyncResultDialog(makeOptions(options))
  await clickViewDetails(needle)
}

beforeEach(() => {
  store.clear()
  isDataSheetMissing = false
  vi.clearAllMocks()
  mocks.exportSheetToJsonlFile.mockReturnValue(true)
  mocks.isSyncRecordEnabled.mockReturnValue(true)
  mocks.getSyncRecordSheetIfExists.mockReturnValue(null)
  mocks.renderSyncDetailTable.mockReturnValue('<table class="detail"/>')
  cleanupDialogs()
})

afterEach(() => {
  vi.useRealTimers()
  cleanupDialogs()
})

// ========== formatDuration ==========

describe('formatDuration 耗时格式化', () => {
  it('小于 1 秒：保留两位小数的秒', () => {
    expect(formatDuration(0)).toBe('0.00秒')
    expect(formatDuration(500)).toBe('0.50秒')
    expect(formatDuration(990)).toBe('0.99秒')
    // 截断语义：999ms 不得四舍五入成 1.00秒（会与 1000ms 的「1秒」跨档混淆）
    expect(formatDuration(999)).toBe('0.99秒')
  })

  it('负数按 0 处理', () => {
    expect(formatDuration(-1000)).toBe('0.00秒')
  })

  it('不足 1 分钟：整数秒', () => {
    expect(formatDuration(1000)).toBe('1秒')
    expect(formatDuration(59_999)).toBe('59秒')
  })

  it('1 分钟以上：分（整分不补秒）', () => {
    expect(formatDuration(60_000)).toBe('1分')
    expect(formatDuration(125_000)).toBe('2分05秒')
    expect(formatDuration(3_600_000)).toBe('60分')
  })
})

// ========== computeDateStatsFromSheet ==========

describe('computeDateStatsFromSheet 开播日期统计', () => {
  it('没有数据表时返回全零统计', () => {
    isDataSheetMissing = true

    expect(computeDateStatsFromSheet()).toEqual({
      earliestDate: null,
      latestDate: null,
      latestSeason: null,
      datedCount: 0,
      totalCount: 0,
    })
  })

  it('缺少开播日期列或 Bangumi_URL 列时返回全零统计', () => {
    setCell(1, 1, '名称')
    setCell(1, 2, '开播日期')
    setCell(2, 1, '芙莉莲')
    setCell(2, 2, '2023-09-29')

    expect(computeDateStatsFromSheet().totalCount).toBe(0)
  })

  it('统计有效条目数、日期条数与最早/最晚日期', () => {
    seedDateSheet([
      ['芙莉莲', '2023-09-29', 'https://bgm.tv/subject/400602'],
      ['间谍过家家', '2022/04/09', 'https://bgm.tv/subject/345678'],
      ['无日期番', '', 'https://bgm.tv/subject/999'],
      ['无 URL 番', '2024.07.05', ''],
      ['坏日期', 'not-a-date', 'https://bgm.tv/subject/8888'],
      ['点分隔', '2025.01.15', 'https://bgm.tv/subject/777'],
    ])

    const stats = computeDateStatsFromSheet()

    // 有 URL 且有 SID 的：芙莉莲 / 间谍过家家 / 无日期番 / 坏日期 / 点分隔
    expect(stats.totalCount).toBe(5)
    // 其中有日期字符串的：芙莉莲 / 间谍过家家 / 坏日期 / 点分隔
    expect(stats.datedCount).toBe(4)
    // 可归一化的日期才参与比较：2022-04-09 最早、2025-01-15 最晚
    expect(stats.earliestDate).toBe('2022-04-09')
    expect(stats.latestDate).toBe('2025-01-15')
    expect(stats.latestSeason).toBe('2025年1月新番')
  })

  it('没有 SID 的条目不计入总数', () => {
    seedDateSheet([
      ['无效 URL', '2023-09-29', 'https://example.com/no-id'],
      ['有效 URL', '2023-09-29', 'https://bgm.tv/subject/400602'],
    ])

    expect(computeDateStatsFromSheet().totalCount).toBe(1)
  })

  it('月份超出 1-12 时最新季度为 null', () => {
    seedDateSheet([['异常月份', '2025-13-01', 'https://bgm.tv/subject/400602']])

    const stats = computeDateStatsFromSheet()

    expect(stats.latestDate).toBe('2025-13-01')
    expect(stats.latestSeason).toBeNull()
  })

  it('表头行识别为 0 时回退到第 1 行', () => {
    // 只有第 2 行存在数据 → findHeaderRow 返回 2，仍能正常统计
    setCell(2, 1, '名称')
    setCell(2, 2, '开播日期')
    setCell(2, 3, 'Bangumi_URL')
    setCell(3, 1, '芙莉莲')
    setCell(3, 2, '2023-09-29')
    setCell(3, 3, 'https://bgm.tv/subject/400602')

    expect(computeDateStatsFromSheet().totalCount).toBe(1)
  })
})

// ========== showSyncResultDialog ==========

describe('showSyncResultDialog 结果弹窗', () => {
  it('正常完成：标题与图标为完成态，并渲染统计区块', () => {
    showSyncResultDialog(makeOptions())

    const html = resultDialogHtml()
    expect(html).toContain('同步完成')
    expect(html).toContain('✅')
    expect(html).toContain(SHEET_SECTION_TITLE)
    expect(document.querySelector('.bgm-modal')?.getAttribute('aria-modal')).toBe('true')
  })

  it('被停止：标题与图标为停止态', () => {
    showSyncResultDialog(makeOptions({ stopped: true }))

    expect(resultDialogHtml()).toContain('同步已停止')
    expect(resultDialogHtml()).toContain('⏹️')
  })

  it('完成度 ≥90% 用绿色环，<50% 用红色环', () => {
    showSyncResultDialog(
      makeOptions({
        result: makeResult({ added: 9, updated: 0, deleted: 0, unchanged: 1 }),
      }),
    )
    expect(resultDialogHtml()).toContain('--green, #a6e3a1')

    cleanupDialogs()
    showSyncResultDialog(
      makeOptions({ result: makeResult({ added: 1, updated: 0, deleted: 0, unchanged: 9 }) }),
    )
    expect(resultDialogHtml()).toContain('--red, #f38ba8')
  })

  it('失败与跳过大于 0 时渲染对应徽标', () => {
    showSyncResultDialog(
      makeOptions({ result: makeResult({ failed: 2, skipped: 3, added: 1, unchanged: 2 }) }),
    )

    const html = resultDialogHtml()
    expect(html).toContain('失败 2')
    expect(html).toContain('跳过 3')
    expect(html).toContain('需关注')
  })

  it('速度为 0 时显示占位符并给出「完成」剩余提示', () => {
    showSyncResultDialog(makeOptions({ avgSpeed: 0, result: makeResult({ unchanged: 0 }) }))

    const html = resultDialogHtml()
    expect(html).toContain('--')
    expect(html).toContain('完成')
  })

  it('存在日期数据时渲染开播日期统计区块', () => {
    seedDateSheet([['芙莉莲', '2023-09-29', 'https://bgm.tv/subject/400602']])

    showSyncResultDialog(makeOptions())

    const html = resultDialogHtml()
    expect(html).toContain('开播日期统计')
    expect(html).toContain('2023-09-29')
    expect(html).toContain('2023年9月新番')
  })

  it('没有数据表时不渲染日期统计区块', () => {
    isDataSheetMissing = true

    showSyncResultDialog(makeOptions())

    expect(resultDialogHtml()).not.toContain('开播日期统计')
  })

  it('存在「远程也无数据」字段时渲染对应区块（说明不是同步失败）', () => {
    showSyncResultDialog(
      makeOptions({
        result: makeResult({
          remoteEmptyFields: [
            { name: '完播日', count: 101 },
            { name: '制作公司', count: 64 },
          ],
        }),
      }),
    )

    const html = resultDialogHtml()
    expect(html).toContain('远程也无数据的字段')
    expect(html).toContain('完播日 · 101 条')
    expect(html).toContain('制作公司 · 64 条')
    // 关键是要点明「不是同步失败」，否则用户仍会误判成加载项有 bug
    expect(html).toContain('这不是同步失败')
  })

  it('没有「远程也无数据」字段时不渲染该区块（避免每次同步都啰嗦）', () => {
    showSyncResultDialog(makeOptions())

    expect(resultDialogHtml()).not.toContain('远程也无数据的字段')
  })

  it('点击确定关闭弹窗', () => {
    showSyncResultDialog(makeOptions())

    document.querySelector<HTMLElement>('#bgmResultCloseBtn')?.click()

    expect(document.querySelector('.bgm-modal')).toBeNull()
  })

  it('按 ESC 关闭弹窗', () => {
    showSyncResultDialog(makeOptions())

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(document.querySelector('.bgm-modal')).toBeNull()
  })

  it('关闭后再次打开会替换旧弹窗', () => {
    showSyncResultDialog(makeOptions())
    showSyncResultDialog(makeOptions({ stopped: true }))

    expect(document.querySelectorAll('.bgm-modal')).toHaveLength(1)
    expect(resultDialogHtml()).toContain('同步已停止')
  })

  it('导出成功：按钮文案切换后 2 秒还原', () => {
    vi.useFakeTimers()
    showSyncResultDialog(makeOptions())
    const exportButton = document.querySelector<HTMLElement>('#bgmResultExportBtn')
    expect(exportButton?.textContent).toBe('📥 导出 JSONL')

    exportButton?.click()

    expect(mocks.exportSheetToJsonlFile).toHaveBeenCalledTimes(1)
    expect(exportButton?.textContent).toBe('✅ 已导出')

    vi.advanceTimersByTime(2000)
    expect(exportButton?.textContent).toBe('📥 导出 JSONL')
  })

  it('导出失败：按钮文案提示失败', () => {
    vi.useFakeTimers()
    mocks.exportSheetToJsonlFile.mockReturnValue(false)
    showSyncResultDialog(makeOptions())

    document.querySelector<HTMLElement>('#bgmResultExportBtn')?.click()

    expect(document.querySelector<HTMLElement>('#bgmResultExportBtn')?.textContent).toBe(
      '❌ 导出失败',
    )
  })
})

// ========== 「查看详情」三条分支 ==========

describe('查看详情按钮分支', () => {
  it('同步记录已启用且记录表存在：打开记录表并滚动到目标行', async () => {
    mocks.isSyncRecordEnabled.mockReturnValue(true)
    mocks.getSyncRecordSheetIfExists.mockReturnValue({ Name: 'sync-record' })
    showSyncResultDialog(makeOptions({ scrollToRow: 42 }))

    await clickViewDetails()

    expect(mocks.openSyncRecordSheet).toHaveBeenCalledWith(42)
    expect(previewDialog()).toBeNull()
  })

  it('同步记录未启用：打开预览弹窗并提示未启用', async () => {
    mocks.isSyncRecordEnabled.mockReturnValue(false)
    showSyncResultDialog(makeOptions())

    await clickViewDetails()

    expect(mocks.openSyncRecordSheet).not.toHaveBeenCalled()
    expect(previewDialog()?.innerHTML).toContain('同步记录功能未启用')
    expect(previewDialog()?.innerHTML).toContain('notice-warning')
  })

  it('已启用但记录表未创建：提示首次同步', async () => {
    mocks.isSyncRecordEnabled.mockReturnValue(true)
    mocks.getSyncRecordSheetIfExists.mockReturnValue(null)
    showSyncResultDialog(makeOptions())

    await clickViewDetails()

    expect(previewDialog()?.innerHTML).toContain('同步记录表尚未创建')
    expect(previewDialog()?.innerHTML).toContain('notice-info')
  })

  it('读取记录表状态抛错：记警告日志并降级为预览弹窗', async () => {
    mocks.getSyncRecordSheetIfExists.mockImplementation(() => {
      throw new Error('COM 读取失败')
    })
    showSyncResultDialog(makeOptions())

    await clickViewDetails()

    expect(mocks.bgmLog).toHaveBeenCalledWith(
      LOG_LEVELS.WARN,
      expect.stringContaining('无法加载同步记录模块'),
    )
    expect(previewDialog()?.innerHTML).toContain('同步记录功能未启用')
  })
})

// ========== 同步详情预览弹窗 ==========

describe('同步详情预览弹窗', () => {
  it('传入起始行号时渲染对应行', async () => {
    await openPreview({ scrollToRow: 7 })

    expect(previewDialog()?.innerHTML).toContain('第 7 行')
  })

  it('未传起始行号时不渲染行号项', async () => {
    await openPreview()

    expect(previewDialog()?.innerHTML).not.toContain('起始行号')
  })

  it('有明细时渲染明细表', async () => {
    await openPreview({
      result: makeResult({
        details: [{ kind: 'add', sid: '400602', name: '芙莉莲' }],
      }),
    })

    expect(previewDialog()?.innerHTML).toContain('同步明细（1 条）')
    // jsdom 重新序列化后自闭合斜杠被丢弃，断言以回读形态为准
    expect(previewDialog()?.innerHTML).toContain('<table class="detail">')
    expect(mocks.renderSyncDetailTable).toHaveBeenCalledTimes(1)
  })

  it('没有明细时不渲染明细表', async () => {
    await openPreview()

    expect(previewDialog()?.innerHTML).not.toContain('同步明细')
    expect(mocks.renderSyncDetailTable).not.toHaveBeenCalled()
  })

  it('点击确定按钮关闭预览弹窗', async () => {
    await openPreview()

    document.querySelector<HTMLElement>('#bgmPreviewCloseBtn')?.click()

    expect(previewDialog()).toBeNull()
  })

  it('按 ESC 关闭预览弹窗', async () => {
    await openPreview()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(previewDialog()).toBeNull()
  })

  it('点击遮罩关闭预览弹窗', async () => {
    await openPreview()

    previewDialog()?.click()

    expect(previewDialog()).toBeNull()
  })

  it('再次打开会替换旧预览弹窗', async () => {
    await openPreview()
    await openPreview({ scrollToRow: 3 }, '第 3 行')

    expect(document.querySelectorAll('.bgm-preview-dialog')).toHaveLength(1)
    expect(previewDialog()?.innerHTML).toContain('第 3 行')
  })

  it('弹窗已移除后再次触发关闭 → ESC 清理安全早退（不再调 removeEventListener）', async () => {
    await openPreview()
    const modal = previewDialog()
    expect(modal).not.toBeNull()

    document.querySelector<HTMLElement>('#bgmPreviewCloseBtn')?.click()
    expect(previewDialog()).toBeNull()

    // 元素已从 DOM 移除，但监听器仍挂在元素上：再次点击等价于「重复关闭」。
    // 此时 _previewDialogEscHandler 已是 null，_clearPreviewEscHandler 应早退。
    const removeListenerSpy = vi.spyOn(document, 'removeEventListener')
    try {
      expect(() => {
        modal?.click()
      }).not.toThrow()
      expect(removeListenerSpy).not.toHaveBeenCalled()
    } finally {
      removeListenerSpy.mockRestore()
    }
  })
})
