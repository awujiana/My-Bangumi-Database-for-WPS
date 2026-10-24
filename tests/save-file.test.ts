// @vitest-environment jsdom
/**
 * @fileoverview ts/tools/save-file.ts 单测
 *
 * 覆盖三条路径：
 * 1. 纯函数（directoryNameOf / joinPath）——直测；
 * 2. FSO 通道：mock FileDialog(Show=-1) + OAAssist.CoCreateInstance → 断言
 *    写入了用户选的路径、内容原样；
 * 3. 降级通道：FSO 不可用 → 走 downloadTextFile（spy）+ via='download'；
 * 4. 取消：Show()=0 → 返回 null（不写文件）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// FSO 不可用时的降级通道：断言它被调用（生产代码 import 的同一模块实例）
vi.mock('../ts/tools/file-export.js', () => ({
  downloadTextFile: vi.fn(),
}))

import {
  directoryNameOf,
  joinPath,
  pickSavePath,
  saveTextFileWithDialog,
  canWriteTextFile,
} from '../ts/tools/save-file.js'
import { downloadTextFile } from '../ts/tools/file-export.js'

interface FakeDialog {
  Title: string
  ButtonName: string
  InitialFileName: string
  Filters: { Clear: () => void; Add: ReturnType<typeof vi.fn> }
  Show: ReturnType<typeof vi.fn>
  SelectedItems: { Count: number; Item: (index: number) => string }
}

/** 装配一个假的 FileDialog（可控 Show 返回值与选中路径） */
function stubApp(options: { showResult: number; selectedPath?: string }): { dialog: FakeDialog } {
  const dialog: FakeDialog = {
    Title: '',
    ButtonName: '',
    InitialFileName: '',
    Filters: {
      Clear: vi.fn(),
      Add: vi.fn(),
    },
    Show: vi.fn(() => options.showResult),
    SelectedItems: {
      Count: options.selectedPath !== undefined && options.showResult === -1 ? 1 : 0,
      Item: () => options.selectedPath ?? '',
    },
  }
  ;(window as unknown as { Application: unknown }).Application = {
    FileDialog: vi.fn(() => dialog),
    msoFileDialogSaveAs: 2,
  }
  return { dialog }
}

/** 装配假的 OAAssist（可控 CreateTextFile 是否抛错） */
function stubFso(shouldFail = false): {
  write: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
} {
  const write = vi.fn()
  const close = vi.fn()
  const createTextFile = shouldFail
    ? vi.fn(() => {
        throw new Error('disk full')
      })
    : vi.fn(() => ({ Write: write, Close: close }))
  ;(window as unknown as { wps: unknown }).wps = {
    OAAssist: {
      CoCreateInstance: vi.fn(() => ({ CreateTextFile: createTextFile })),
    },
  }
  return { write, close }
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  delete (window as unknown as { Application?: unknown }).Application
  delete (window as unknown as { wps?: unknown }).wps
  vi.mocked(downloadTextFile).mockClear()
})

describe('directoryNameOf / joinPath', () => {
  it('directoryNameOf 取目录（反斜杠也认）', () => {
    expect(directoryNameOf('C:/a/b/c.json')).toBe('C:/a/b')
    expect(directoryNameOf(String.raw`C:\a\b\c.json`)).toBe('C:/a/b')
    expect(directoryNameOf('c.json')).toBe('')
  })

  it('joinPath 拼目录与文件名（目录尾部分隔符不重复）', () => {
    expect(joinPath('C:/a/b', 'c.json')).toBe('C:/a/b/c.json')
    expect(joinPath('C:/a/b/', 'c.json')).toBe('C:/a/b/c.json')
    expect(joinPath('C:\\a\\b\\', 'c.json')).toBe('C:/a/b/c.json')
    expect(joinPath('', 'c.json')).toBe('c.json')
  })
})

describe('pickSavePath', () => {
  it('用户确定 → 返回所选完整路径，且对话框预填了默认目录+文件名', () => {
    const { dialog } = stubApp({ showResult: -1, selectedPath: 'D:/备份/规则-2026-10-24.json' })

    const path = pickSavePath({
      title: '保存规则文件',
      defaultDir: 'D:/备份',
      fileName: 'bgm-规则.json',
      filterDescription: 'JSON 文件 (*.json)',
      filterExtensions: '*.json',
    })

    expect(path).toBe('D:/备份/规则-2026-10-24.json')
    expect(dialog.Title).toBe('保存规则文件')
    expect(dialog.InitialFileName).toBe('D:/备份/bgm-规则.json')
    expect(dialog.ButtonName).toBe('保存')
    expect(dialog.Filters.Add).toHaveBeenCalledWith('JSON 文件 (*.json)', '*.json', 1)
  })

  it('用户取消（Show=0）→ null', () => {
    stubApp({ showResult: 0 })
    expect(
      pickSavePath({
        title: 't',
        defaultDir: '',
        fileName: 'f.json',
        filterDescription: 'd',
        filterExtensions: '*.json',
      }),
    ).toBeNull()
  })

  it('FileDialog 不可用 → null（调用方据此不写文件）', () => {
    expect(
      pickSavePath({
        title: 't',
        defaultDir: '',
        fileName: 'f.json',
        filterDescription: 'd',
        filterExtensions: '*.json',
      }),
    ).toBeNull()
  })
})

describe('canWriteTextFile', () => {
  it('FSO 可用 → CreateTextFile(覆盖, Unicode) 并写入内容', () => {
    const { write, close } = stubFso(false)

    expect(canWriteTextFile('D:/a/b.json', '{"x":1}')).toBe(true)
    expect(write).toHaveBeenCalledWith('{"x":1}')
    expect(close).toHaveBeenCalled()
  })

  it('FSO 写失败 → false（不抛，交给调用方降级）', () => {
    stubFso(true)
    expect(canWriteTextFile('D:/a/b.json', 'x')).toBe(false)
  })

  it('OAAssist 缺失 → false', () => {
    expect(canWriteTextFile('D:/a/b.json', 'x')).toBe(false)
  })
})

describe('saveTextFileWithDialog', () => {
  it('选路径 + FSO 写成功 → via=fso，带回路径', () => {
    stubApp({ showResult: -1, selectedPath: 'D:/备份/rules.json' })
    stubFso(false)

    const result = saveTextFileWithDialog({
      title: '保存规则文件',
      defaultDir: 'D:/备份',
      fileName: 'rules.json',
      content: '{"rules":[]}',
    })

    expect(result).toEqual({ path: 'D:/备份/rules.json', via: 'fso' })
  })

  it('FSO 不可用 → 降级 Blob 下载，via=download', () => {
    stubApp({ showResult: -1, selectedPath: 'D:/备份/rules.json' })
    // 不装 wps → FSO 通道不可用

    const result = saveTextFileWithDialog({
      title: '保存规则文件',
      defaultDir: '',
      fileName: 'rules.json',
      content: '{"rules":[]}',
    })

    expect(result?.via).toBe('download')
    expect(vi.mocked(downloadTextFile)).toHaveBeenCalledWith(
      '{"rules":[]}',
      'rules.json',
      'application/json',
    )
  })

  it('用户取消 → null，不写文件不下载', () => {
    stubApp({ showResult: 0 })

    const result = saveTextFileWithDialog({
      title: '保存规则文件',
      defaultDir: '',
      fileName: 'rules.json',
      content: 'x',
    })

    expect(result).toBeNull()
    expect(vi.mocked(downloadTextFile)).not.toHaveBeenCalled()
  })
})
