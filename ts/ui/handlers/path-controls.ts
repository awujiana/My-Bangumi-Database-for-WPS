/**
 * 默认路径记忆（导出位置 / 导入文件夹）
 * @module ui/handlers/path-controls
 * @description 从 handlers/index.ts 抽出：WPS 文件夹选择对话框（含 GetOpenFilename 回退）
 *              与设置页只读路径输入框回填。
 */

import { getApp, getExportPath, getImportPath } from '../../index.js'

/** WPS FileDialog 对象的能力子集（仅用到的成员） */
interface WpsPathDialog {
  Title: string
  Show(): number
  SelectedItems: { Count: number; Item(index: number): string }
}

/**
 * 弹出文件夹选择对话框并返回选中的文件夹绝对路径。
 * 优先使用 WPS Application.FileDialog(msoFileDialogFolderPicker=2)，
 * 不可用时回退到 GetOpenFilename 单选（由用户选取文件后取目录）。
 * 用户取消返回 null。
 */
export function selectDefaultFolder(title: string): string | null {
  try {
    const app = getApp() as {
      FileDialog?: (dialogType: number) => WpsPathDialog | null
      msoFileDialogFolderPicker?: number
      GetOpenFilename?: (fileFilter: string, dialogTitle: string) => unknown
    } | null
    if (!app) return null

    if (typeof app.FileDialog === 'function') {
      const dialogType =
        typeof app.msoFileDialogFolderPicker === 'number' ? app.msoFileDialogFolderPicker : 2
      const dialog = app.FileDialog(dialogType)
      if (dialog) {
        dialog.Title = title
        const result = dialog.Show()
        if (result === -1 && dialog.SelectedItems.Count > 0) {
          return dialog.SelectedItems.Item(1)
        }
        // 取消（result === 0）
        return null
      }
    }

    // 回退：GetOpenFilename 选择文件后取其所在目录作为默认文件夹
    if (typeof app.GetOpenFilename === 'function') {
      const selected = app.GetOpenFilename('所有文件 (*.*),*.*', title)
      if (typeof selected === 'boolean' || selected === false) return null
      const filePath = String(selected)
      const normalized = filePath.replace(/\\+/g, '/')
      const lastSlash = normalized.lastIndexOf('/')
      if (lastSlash !== -1) return normalized.slice(0, lastSlash)
      return null
    }
    return null
  } catch {
    return null
  }
}

/** 设置设置页中的路径只读输入框显示值 */
export function updatePathDisplay(inputId: string, value: string): void {
  const input = document.getElementById(inputId) as HTMLInputElement | null
  if (input) input.value = value
}

/** 从 PluginStorage 读取已保存的默认路径并回填到设置页输入框 */
export function initConfigPathControls(): void {
  if (typeof document === 'undefined') return
  updatePathDisplay('exportPathDisplay', getExportPath(true))
  updatePathDisplay('importPathDisplay', getImportPath(true))
}
