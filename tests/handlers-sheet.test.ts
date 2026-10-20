// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/handlers/sheet.ts` 单元测试（真实 cleanLockedDataSheet 实现）。
 *
 * 注意：handlers.test.ts 把 cleanLockedDataSheet 整体 mock 成 vi.fn，并未覆盖其真实实现；
 * 本文件单独驱动真实实现。依赖全部从 `ts/index.js` barrel 进入，统一 mock 即可。
 *
 * 覆盖：
 *  - targetWorksheet 提供路径：成功提示 / skippedReason(info/error) 分支
 *  - 无 targetWorksheet 路径：getApp 为 null、未锁定数据表、按锁定索引解析工作表后成功
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  showToast: vi.fn(),
  getApp: vi.fn((): unknown => null),
  // 失败行留档：本文件只测 handler 的分支，地址拼装由 failed-rows.test.ts 覆盖
  getLastFailedRows: vi.fn((): unknown => null),
  buildFailedRowsAddress: vi.fn((): unknown => null),
  bgm: {
    sheet: { isLocked: false, lockedIndex: null as number | null },
    handleError: vi.fn(),
  },
  cleanSheetDuplicates: vi.fn(),
}))

vi.mock('../ts/index.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  bgmLog: m.bgmLog,
  BGM: m.bgm,
  getApp: m.getApp,
  showToast: m.showToast,
  getLastFailedRows: m.getLastFailedRows,
  buildFailedRowsAddress: m.buildFailedRowsAddress,
}))
vi.mock('../ts/sync/sheet-cleaning.js', () => ({
  cleanSheetDuplicates: m.cleanSheetDuplicates,
}))

import { cleanLockedDataSheet, selectFailedRowsFromLastSync } from '../ts/ui/handlers/sheet.js'

const fakeWorksheet = { Name: 'Bangumi' }
const fakeApp = {
  ActiveWorkbook: { Sheets: { Item: (_index: number) => fakeWorksheet } },
}

describe('ui/handlers/sheet · cleanLockedDataSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.getApp.mockReturnValue(null)
    m.bgm.sheet.isLocked = false
    m.bgm.sheet.lockedIndex = null
    m.cleanSheetDuplicates.mockReturnValue({ performed: true, deletedRows: 1, mergedTagGroups: 0 })
    m.getLastFailedRows.mockReturnValue(null)
    m.buildFailedRowsAddress.mockReturnValue(null)
  })

  it('直接传 targetWorksheet 且清洗成功：提示成功', () => {
    cleanLockedDataSheet(fakeWorksheet as never)
    expect(m.cleanSheetDuplicates).toHaveBeenCalledWith(fakeWorksheet)
    expect(m.showToast).toHaveBeenCalledWith(
      '清洗完成：删除 1 行，合并 0 个名称组的标签',
      'success',
    )
  })

  it('skippedReason 为「未发现重复数据」时按 info 提示', () => {
    m.cleanSheetDuplicates.mockReturnValue({ skippedReason: '未发现重复数据' })
    cleanLockedDataSheet(fakeWorksheet as never)
    expect(m.showToast).toHaveBeenCalledWith('未发现重复数据', 'info')
  })

  it('其它 skippedReason 按 error 提示', () => {
    m.cleanSheetDuplicates.mockReturnValue({ skippedReason: '锁定表结构异常' })
    cleanLockedDataSheet(fakeWorksheet as never)
    expect(m.showToast).toHaveBeenCalledWith('锁定表结构异常', 'error')
  })

  it('无 targetWorksheet 且 getApp 为空：提示无法获取工作簿并早退', () => {
    m.getApp.mockReturnValue(null)
    cleanLockedDataSheet()
    expect(m.showToast).toHaveBeenCalledWith('无法获取工作簿', 'error')
    expect(m.cleanSheetDuplicates).not.toHaveBeenCalled()
  })

  it('无 targetWorksheet 且未锁定数据表：提示请先锁定并早退', () => {
    m.getApp.mockReturnValue(fakeApp)
    m.bgm.sheet.isLocked = false
    cleanLockedDataSheet()
    expect(m.showToast).toHaveBeenCalledWith('请先锁定数据表', 'warn')
    expect(m.cleanSheetDuplicates).not.toHaveBeenCalled()
  })

  it('无 targetWorksheet 按锁定索引解析工作表后清洗成功', () => {
    m.getApp.mockReturnValue(fakeApp)
    m.bgm.sheet.isLocked = true
    m.bgm.sheet.lockedIndex = 2
    cleanLockedDataSheet()
    expect(m.cleanSheetDuplicates).toHaveBeenCalledWith(fakeWorksheet)
    expect(m.showToast).toHaveBeenCalledWith(
      '清洗完成：删除 1 行，合并 0 个名称组的标签',
      'success',
    )
  })
})

/** 带 Select 的假工作表 */
const makeSelectableWorksheet = (name: string, selectImplementation?: () => void) => ({
  Name: name,
  Range: vi.fn(() => ({ Select: selectImplementation ?? vi.fn() })),
})

describe('ui/handlers/sheet · selectFailedRowsFromLastSync', () => {
  it('没有失败记录 → 提示「上次同步没有失败行」且不碰选区', () => {
    m.getLastFailedRows.mockReturnValue(null)
    const worksheet = makeSelectableWorksheet('动画')
    m.getApp.mockReturnValue({ ActiveWorkbook: { ActiveSheet: worksheet } })

    selectFailedRowsFromLastSync()

    expect(m.showToast).toHaveBeenCalledWith('上次同步没有失败行', 'info')
    expect(worksheet.Range).not.toHaveBeenCalled()
  })

  it('失败行属于另一张表 → 拒绝选中（换表后行号就错位了）', () => {
    m.getLastFailedRows.mockReturnValue({ rows: [3, 5], sheetName: '动画' })
    const worksheet = makeSelectableWorksheet('漫画')
    m.getApp.mockReturnValue({ ActiveWorkbook: { ActiveSheet: worksheet } })

    selectFailedRowsFromLastSync()

    expect(m.showToast).toHaveBeenCalledWith('失败行属于「动画」表，请先切回该表', 'warn')
    expect(worksheet.Range).not.toHaveBeenCalled()
  })

  it('拿不到当前工作表 → 提示错误并早退', () => {
    m.getLastFailedRows.mockReturnValue({ rows: [3], sheetName: '动画' })
    m.getApp.mockReturnValue(null)

    selectFailedRowsFromLastSync()

    expect(m.showToast).toHaveBeenCalledWith('无法获取当前工作表', 'error')
  })

  it('地址超长（失败行过多）→ 提示分批，不硬抛 COM 错误', () => {
    m.getLastFailedRows.mockReturnValue({
      rows: Array.from({ length: 200 }, (_unused, index) => index + 1),
      sheetName: '动画',
    })
    m.buildFailedRowsAddress.mockReturnValue(null)
    const worksheet = makeSelectableWorksheet('动画')
    m.getApp.mockReturnValue({ ActiveWorkbook: { ActiveSheet: worksheet } })

    selectFailedRowsFromLastSync()

    expect(m.showToast).toHaveBeenCalledWith('失败行过多（200 行），请分批手动选择重试', 'warn')
    expect(worksheet.Range).not.toHaveBeenCalled()
  })

  it('正常路径：按拼出的地址选中并提示「接着点选中行同步」', () => {
    m.getLastFailedRows.mockReturnValue({ rows: [3, 4, 9], sheetName: '动画' })
    m.buildFailedRowsAddress.mockReturnValue('A3:A4,A9')
    const worksheet = makeSelectableWorksheet('动画')
    m.getApp.mockReturnValue({ ActiveWorkbook: { ActiveSheet: worksheet } })

    selectFailedRowsFromLastSync()

    expect(worksheet.Range).toHaveBeenCalledWith('A3:A4,A9')
    expect(m.showToast).toHaveBeenCalledWith(
      '已选中 3 个失败行（3, 4, 9），点「👆 选中行同步」重试',
      'success',
    )
  })

  it('Select 抛错 → 提示失败原因，不让异常冒泡', () => {
    m.getLastFailedRows.mockReturnValue({ rows: [3], sheetName: '动画' })
    m.buildFailedRowsAddress.mockReturnValue('A3')
    const worksheet = makeSelectableWorksheet('动画', () => {
      throw new Error('只读工作簿')
    })
    m.getApp.mockReturnValue({ ActiveWorkbook: { ActiveSheet: worksheet } })

    expect(() => {
      selectFailedRowsFromLastSync()
    }).not.toThrow()
    expect(m.showToast).toHaveBeenCalledWith('选中失败行失败：只读工作簿', 'error')
    expect(m.bgm.handleError).toHaveBeenCalled()
  })
})
