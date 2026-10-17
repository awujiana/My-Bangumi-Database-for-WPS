/**
 * @fileoverview 同步前列映射确认对话框单测
 *
 * 覆盖 `ts/ui/sync-mapping-dialog.ts`：
 *   - 无数据表时不阻塞（返回空配置）
 *   - 行渲染（字段 / 目标列下拉 / 缺列徽章）
 *   - 取消勾选 → excludedColumns；改目标列 → columnOverrides
 *   - 一键补齐缺失列（写表头 + 读回校验）
 *   - 目标列冲突时确认被拦下
 *   - 取消按钮 / ESC → null
 *
 * COM 侧用「内存工作表」桩：表头行 + 列映射由单元格存储派生，与生产读取口径一致。
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ========== 内存工作表 ==========

const store = new Map<string, string>()
let isDataSheetMissing = false
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

vi.mock('../ts/tools/util/index.js', () => ({
  getDataSheet: () => (isDataSheetMissing ? null : DATA_SHEET),
  getCellValue: (_sheet: unknown, row: number, col: number) => getCell(row, col),
  setCellValue: (_sheet: unknown, row: number, col: number, value: unknown) => {
    setCell(row, col, String(value))
    return true
  },
  findHeaderRow: findHeaderRowStub,
  getColumnMap: getColumnMapStub,
}))

vi.mock('../ts/tools/utility.js', () => ({
  getDataSheet: () => (isDataSheetMissing ? null : DATA_SHEET),
  getCellValue: (_sheet: unknown, row: number, col: number) => getCell(row, col),
  setCellValue: (_sheet: unknown, row: number, col: number, value: unknown) => {
    setCell(row, col, String(value))
    return true
  },
  findHeaderRow: findHeaderRowStub,
  getColumnMap: getColumnMapStub,
}))

import { showSyncMappingDialog } from '../ts/ui/sync-mapping-dialog.js'

/** 写入一行表头（第 1 行） */
function setupHeader(...names: string[]): void {
  store.clear()
  for (const [index, name] of names.entries()) {
    setCell(1, index + 1, name)
  }
}

/** 取弹窗内某行的复选框 / 下拉 */
function rowElement(id: string): HTMLElement | null {
  const rows = [...document.querySelectorAll<HTMLElement>('.bgm-mapping-row')]
  return rows.find((element) => element.dataset.rowId === id) ?? null
}

describe('showSyncMappingDialog', () => {
  beforeEach(() => {
    isDataSheetMissing = false
    store.clear()
    document.body.replaceChildren()
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('无数据表时应直接返回空配置（不阻塞同步）', async () => {
    isDataSheetMissing = true
    const config = await showSyncMappingDialog()
    expect(config).toEqual({ excludedColumns: [], columnOverrides: {} })
    expect(document.querySelector('.bgm-modal')).toBeNull()
  })

  it('应渲染全部可同步字段行，缺列行标「本地缺列」且默认不勾选', async () => {
    setupHeader('Bangumi_URL', '名称', '标签/分级', '导演')
    const promise = showSyncMappingDialog()

    const director = rowElement('导演')
    expect(director).not.toBeNull()
    const checkbox = director?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(checkbox?.checked).toBe(true)

    const music = rowElement('音乐')
    expect(music?.textContent).toContain('本地缺列')
    expect(music?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)

    document.querySelector<HTMLButtonElement>('#bgmMappingCancel')?.click()
    await expect(promise).resolves.toBeNull()
  })

  it('取消勾选的行应进入 excludedColumns', async () => {
    setupHeader('Bangumi_URL', '名称', '导演')
    const promise = showSyncMappingDialog()

    const checkbox = rowElement('导演')?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (checkbox) {
      checkbox.checked = false
      checkbox.dispatchEvent(new Event('change'))
    }
    document.querySelector<HTMLButtonElement>('#bgmMappingConfirm')?.click()

    const config = await promise
    expect(config?.excludedColumns).toContain('导演')
    expect(config?.columnOverrides).toEqual({})
  })

  it('改目标列应产生 columnOverrides', async () => {
    setupHeader('Bangumi_URL', '名称', '导演', '监督')
    const promise = showSyncMappingDialog()

    const select = rowElement('导演')?.querySelector<HTMLSelectElement>('select')
    expect(select).not.toBeNull()
    if (select) {
      select.value = '监督'
      select.dispatchEvent(new Event('change'))
    }
    document.querySelector<HTMLButtonElement>('#bgmMappingConfirm')?.click()

    const config = await promise
    expect(config?.columnOverrides).toEqual({ 导演: '监督' })
  })

  it('一键补齐缺失列应写入表头并读回校验，补齐后该行转为已匹配', async () => {
    setupHeader('Bangumi_URL', '名称')
    const promise = showSyncMappingDialog()

    // 缺列行默认不勾选，先勾上「导演」再补列
    const director = rowElement('导演')
    const checkbox = director?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (checkbox) {
      checkbox.checked = true
      checkbox.dispatchEvent(new Event('change'))
    }

    document.querySelector<HTMLButtonElement>('#bgmMappingAddMissing')?.click()

    // 表头行末尾写入了「导演」
    const colMap = getColumnMapStub(DATA_SHEET, 1)
    expect(colMap.has('导演')).toBe(true)
    // 状态行报告补齐结果
    expect(document.querySelector('#bgmMappingStatus')?.textContent).toContain('已补齐')

    document.querySelector<HTMLButtonElement>('#bgmMappingConfirm')?.click()
    const config = await promise
    // 补齐后「导演」不再算排除；其余缺列行仍按默认（不勾选）排除
    expect(config?.excludedColumns).not.toContain('导演')
  })

  it('目标列冲突时应拦下确认（不 resolve、状态栏给冲突提示）', async () => {
    // 「监督」必须在本地表头里，才能作为两个字段共同的下拉选项
    setupHeader('Bangumi_URL', '名称', '导演', '音乐', '监督')
    const promise = showSyncMappingDialog()

    const directorSelect = rowElement('导演')?.querySelector<HTMLSelectElement>('select')
    const musicSelect = rowElement('音乐')?.querySelector<HTMLSelectElement>('select')
    const selects = [directorSelect, musicSelect].filter(
      (select): select is HTMLSelectElement => select !== null,
    )
    for (const select of selects) {
      select.value = '监督'
      select.dispatchEvent(new Event('change'))
    }

    document.querySelector<HTMLButtonElement>('#bgmMappingConfirm')?.click()
    await Promise.resolve()

    // 未 resolve 的表现：弹窗仍在文档里，且状态栏给出冲突提示
    expect(document.querySelector('#bgmMappingConfirm')).not.toBeNull()
    expect(document.querySelector('#bgmMappingStatus')?.textContent).toContain('目标列冲突')

    // 收尾：取消关闭，避免悬挂的 Promise 影响后续用例
    document.querySelector<HTMLButtonElement>('#bgmMappingCancel')?.click()
    await expect(promise).resolves.toBeNull()
  })

  it('ESC 应等价于取消同步（resolve null）', async () => {
    setupHeader('Bangumi_URL', '名称')
    const promise = showSyncMappingDialog()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await expect(promise).resolves.toBeNull()
  })

  it('上下移按钮应调整行顺序（仅展示顺序）', async () => {
    setupHeader('Bangumi_URL', '名称', '导演', '音乐')
    const promise = showSyncMappingDialog()

    const firstId = document.querySelector<HTMLElement>('.bgm-mapping-row')?.dataset.rowId
    const secondRow = document.querySelectorAll<HTMLElement>('.bgm-mapping-row')[1]
    const secondId = secondRow?.dataset.rowId
    // 把第二行上移
    secondRow?.querySelector<HTMLButtonElement>('button[data-move="up"]')?.click()

    const idsAfter = [...document.querySelectorAll<HTMLElement>('.bgm-mapping-row')].map(
      (element) => element.dataset.rowId,
    )
    expect(idsAfter[0]).toBe(secondId)
    expect(idsAfter[1]).toBe(firstId)

    document.querySelector<HTMLButtonElement>('#bgmMappingCancel')?.click()
    await expect(promise).resolves.toBeNull()
  })
})
