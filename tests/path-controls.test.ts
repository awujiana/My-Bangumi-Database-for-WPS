// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/handlers/path-controls.ts` 单元测试。
 *
 * 覆盖：
 *  - selectDefaultFolder：getApp 为空 / FileDialog 选择 / FileDialog 取消 / GetOpenFilename 回退取目录 /
 *    GetOpenFilename 取消 / GetOpenFilename 抛错兜底 / GetOpenFilename 返回无斜杠文件名 /
 *    既无 FileDialog 也无 GetOpenFilename
 *  - updatePathDisplay：元素存在回填 / 元素缺失不抛
 *  - initConfigPathControls：从 PluginStorage 回填两个只读输入框
 *
 * getApp / getExportPath / getImportPath 统一从 ts/index.js barrel mock。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getApp: vi.fn((): unknown => null),
  getExportPath: vi.fn(() => 'E:/exp'),
  getImportPath: vi.fn(() => 'E:/imp'),
}))

vi.mock('../ts/index.js', () => ({
  getApp: m.getApp,
  getExportPath: m.getExportPath,
  getImportPath: m.getImportPath,
}))

import {
  selectDefaultFolder,
  updatePathDisplay,
  initConfigPathControls,
} from '../ts/ui/handlers/path-controls.js'

function fileDialogApp(showResult: number, count = 1, item = 'C:/sel/folder'): unknown {
  return {
    FileDialog: (_type: number) => ({
      Title: '',
      Show: () => showResult,
      SelectedItems: { Count: count, Item: () => item },
    }),
    msoFileDialogFolderPicker: 2,
  }
}

function getOpenFilenameApp(selected: unknown): unknown {
  return {
    GetOpenFilename: (_filter: string, _title: string) => selected,
  }
}

describe('ui/handlers/path-controls · selectDefaultFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.getApp.mockReturnValue(null)
  })
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('getApp 为空时返回 null', () => {
    expect(selectDefaultFolder('选择文件夹')).toBeNull()
  })

  it('FileDialog 选择成功时返回选中目录', () => {
    m.getApp.mockReturnValue(fileDialogApp(-1, 1, 'C:/sel/folder'))
    expect(selectDefaultFolder('选择文件夹')).toBe('C:/sel/folder')
  })

  it('FileDialog 取消（Show=0）时返回 null', () => {
    m.getApp.mockReturnValue(fileDialogApp(0))
    expect(selectDefaultFolder('选择文件夹')).toBeNull()
  })

  it('无 FileDialog 时回退 GetOpenFilename 取文件所在目录', () => {
    m.getApp.mockReturnValue(getOpenFilenameApp('C:/a/b/file.txt'))
    expect(selectDefaultFolder('选择文件夹')).toBe('C:/a/b')
  })

  it('GetOpenFilename 返回 false（取消）时返回 null', () => {
    m.getApp.mockReturnValue(getOpenFilenameApp(false))
    expect(selectDefaultFolder('选择文件夹')).toBeNull()
  })

  it('GetOpenFilename 抛错时走 catch 返回 null', () => {
    m.getApp.mockReturnValue({
      GetOpenFilename: () => {
        throw new Error('dialog fail')
      },
    })
    expect(selectDefaultFolder('选择文件夹')).toBeNull()
  })

  it('GetOpenFilename 返回无斜杠文件名时返回 null', () => {
    m.getApp.mockReturnValue(getOpenFilenameApp('file.txt'))
    expect(selectDefaultFolder('选择文件夹')).toBeNull()
  })

  it('既无 FileDialog 也无 GetOpenFilename 时返回 null', () => {
    m.getApp.mockReturnValue({})
    expect(selectDefaultFolder('选择文件夹')).toBeNull()
  })
})

describe('ui/handlers/path-controls · 路径显示回填', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('updatePathDisplay：元素存在时回填 value', () => {
    const element = document.createElement('input')
    element.id = 'exportPathDisplay'
    document.body.append(element)
    updatePathDisplay('exportPathDisplay', 'E:/exp')
    expect(element.value).toBe('E:/exp')
  })

  it('updatePathDisplay：元素缺失时不抛', () => {
    expect(() => updatePathDisplay('missing', 'x')).not.toThrow()
  })

  it('initConfigPathControls：回填导出/导入输入框', () => {
    const exp = document.createElement('input')
    exp.id = 'exportPathDisplay'
    const imp = document.createElement('input')
    imp.id = 'importPathDisplay'
    document.body.append(exp, imp)
    initConfigPathControls()
    expect(exp.value).toBe('E:/exp')
    expect(imp.value).toBe('E:/imp')
    expect(m.getExportPath).toHaveBeenCalledWith(true)
    expect(m.getImportPath).toHaveBeenCalledWith(true)
  })
})
