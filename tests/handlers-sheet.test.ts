// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/handlers/sheet.ts` 单元测试（真实 cleanLockedDataSheet 实现）。
 *
 * 注意：handlers.test.ts 把 cleanLockedDataSheet 整体 mock 成 vi.fn，并未覆盖其真实实现；
 * 本文件单独驱动真实实现。依赖全部从 `ts/index.js` barrel 进入，统一 mock 即可。
 *
 * 覆盖：
 *  - targetWs 提供路径：成功提示 / skippedReason(info/error) 分支
 *  - 无 targetWs 路径：getApp 为 null、未锁定数据表、按锁定索引解析工作表后成功
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  bgmLog: vi.fn(),
  showToast: vi.fn(),
  getApp: vi.fn((): unknown => null),
  bgm: { sheet: { isLocked: false, lockedIndex: null as number | null } },
  cleanSheetDuplicates: vi.fn(),
}))

vi.mock('../ts/index.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  bgmLog: m.bgmLog,
  BGM: m.bgm,
  getApp: m.getApp,
  showToast: m.showToast,
}))
vi.mock('../ts/sync/sheet-cleaning.js', () => ({
  cleanSheetDuplicates: m.cleanSheetDuplicates,
}))

import { cleanLockedDataSheet } from '../ts/ui/handlers/sheet.js'

const fakeWs = { Name: 'Bangumi' }
const fakeApp = {
  ActiveWorkbook: { Sheets: { Item: (_index: number) => fakeWs } },
}

describe('ui/handlers/sheet · cleanLockedDataSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.getApp.mockReturnValue(null)
    m.bgm.sheet.isLocked = false
    m.bgm.sheet.lockedIndex = null
    m.cleanSheetDuplicates.mockReturnValue({ performed: true, deletedRows: 1, mergedTagGroups: 0 })
  })

  it('直接传 targetWs 且清洗成功：提示成功', () => {
    cleanLockedDataSheet(fakeWs as never)
    expect(m.cleanSheetDuplicates).toHaveBeenCalledWith(fakeWs)
    expect(m.showToast).toHaveBeenCalledWith('清洗完成：删除 1 行，合并 0 个名称组的标签', 'success')
  })

  it('skippedReason 为「未发现重复数据」时按 info 提示', () => {
    m.cleanSheetDuplicates.mockReturnValue({ skippedReason: '未发现重复数据' })
    cleanLockedDataSheet(fakeWs as never)
    expect(m.showToast).toHaveBeenCalledWith('未发现重复数据', 'info')
  })

  it('其它 skippedReason 按 error 提示', () => {
    m.cleanSheetDuplicates.mockReturnValue({ skippedReason: '锁定表结构异常' })
    cleanLockedDataSheet(fakeWs as never)
    expect(m.showToast).toHaveBeenCalledWith('锁定表结构异常', 'error')
  })

  it('无 targetWs 且 getApp 为空：提示无法获取工作簿并早退', () => {
    m.getApp.mockReturnValue(null)
    cleanLockedDataSheet()
    expect(m.showToast).toHaveBeenCalledWith('无法获取工作簿', 'error')
    expect(m.cleanSheetDuplicates).not.toHaveBeenCalled()
  })

  it('无 targetWs 且未锁定数据表：提示请先锁定并早退', () => {
    m.getApp.mockReturnValue(fakeApp)
    m.bgm.sheet.isLocked = false
    cleanLockedDataSheet()
    expect(m.showToast).toHaveBeenCalledWith('请先锁定数据表', 'warn')
    expect(m.cleanSheetDuplicates).not.toHaveBeenCalled()
  })

  it('无 targetWs 按锁定索引解析工作表后清洗成功', () => {
    m.getApp.mockReturnValue(fakeApp)
    m.bgm.sheet.isLocked = true
    m.bgm.sheet.lockedIndex = 2
    cleanLockedDataSheet()
    expect(m.cleanSheetDuplicates).toHaveBeenCalledWith(fakeWs)
    expect(m.showToast).toHaveBeenCalledWith('清洗完成：删除 1 行，合并 0 个名称组的标签', 'success')
  })
})
