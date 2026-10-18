/**
 * WPS 最小化接口定义
 * @module types/wps
 * @description 定义 WPS COM 对象的核心接口，避免 unknown 强制转换
 */
import { LOG_LEVELS } from '../core/constants.js'
// 对话框走依赖反转桥：本模块属于底层（tools/），不得 runtime-import 上层 UI 层
// （见 文档/TS_AUDIT_2026_09_10.md 的 P1-5）。实现由 ui/dialog.ts 注册。
import { getNotifyApi } from '../core/ui-bridge.js'

import { getApp, bgmLog } from './util/index.js'

/**
 * WPS 单元格值类型
 * WPS COM 的 Value/Value2/Formula 属性可能是以下任意一种类型。
 * 调用方在使用前应通过 typeof/instanceof 进行类型守卫。
 */
export type WpsCellValue = string | number | boolean | Date | null

/**
 * WPS 单元格公式类型
 * Formula 可能是字符串公式（如 "=A1+B1"）或二维数组的值。
 */
export type WpsFormula = string | WpsCellValue[][] | null

/**
 * WPS 当前选中对象
 * Selection 可能是 Range、Shape、Chart 等多种对象或 null（无选中）。
 * 项目当前仅使用 Range 路径，其他场景需调用方自行类型守卫。
 */
export type WpsSelection = WpsRange | null

// ========== WPS Application ==========
export interface WpsApp {
  ActiveWorkbook?: WpsWorkbook
  Workbooks?: WpsWorkbooks
  /** 同一 WPS 实例中的窗口集合；部分版本可通过 Window.ActiveSheet.Parent 补齐工作簿 */
  Windows?: WpsWindows
  PluginStorage?: WpsPluginStorage
  ActiveSheet?: WpsWorksheet
  ActiveCell?: WpsRange
  StatusBar?: string | boolean
  OAAssist?: WpsOAAssist
  InputBox?: (message: string, title: string, defaultValue: string, type: number) => string | false
  MessageBox?: (message: string, type: number, icon?: number) => number
  Wait?: (date: Date) => void
  DoEvents?: () => void
  CreateTaskPane?: (url: string) => WpsTaskPane
  GetTaskPane?: (id: string) => WpsTaskPane
  Enum?: Record<string, number>
  ribbonUI?: unknown
  Selection?: WpsSelection
  /** 屏幕刷新开关（性能优化） */
  ScreenUpdating?: boolean
  /** 计算模式：-4135=手动, -4105=自动 */
  Calculation?: number
  /**
   * 工作表内容变更事件（单元格编辑触发）。
   * 面板用它做「预览随编辑自动刷新」（见 `panel/panel-auto-refresh.ts`）；
   * 部分宿主版本不提供该事件，此时为 `undefined`。
   */
  SheetChange?: ((sheet?: WpsWorksheet, target?: unknown) => void) | undefined
}

// ========== WPS 工作簿集合 ==========
export interface WpsWorkbooks {
  Count: number
  Item(index: number): WpsWorkbook
}

/** WPS 窗口集合的最小接口 */
export interface WpsWindows {
  Count?: number
  Item(index: number): WpsWindow
}

/** WPS 窗口的最小接口，用于从 ActiveSheet.Parent 取得所属工作簿 */
export interface WpsWindow {
  ActiveSheet?: { Parent?: unknown }
  Workbook?: unknown
  Parent?: unknown
}

// ========== WPS 工作簿 ==========
export interface WpsWorkbook {
  Name: string
  FullName: string
  Worksheets: WpsWorksheets
  Sheets: WpsSheets
  ActiveSheet: WpsWorksheet
}

// ========== WPS 工作表集合 ==========
export interface WpsWorksheets {
  Count: number
  Item(index: number): WpsWorksheet
}

export interface WpsSheets {
  Count: number
  Item(index: number): WpsWorksheet
  Add(): WpsWorksheet
}

// ========== WPS 工作表 ==========
export interface WpsWorksheet {
  Name: string
  Rows: WpsRows
  Columns: WpsColumns
  Cells: WpsCells
  AutoFilter?: WpsAutoFilter
  AutoFilterMode?: boolean
  UsedRange?: WpsRange
  Activate(): void
  Calculate(): void
  Range(address: string): WpsRange
  Move(Before?: WpsWorksheet | null, After?: WpsWorksheet | null): void
}

// ========== WPS 行/列 ==========
export interface WpsRows {
  /** 行数 */
  Count: number
  /** 获取指定行（1‑based） */
  Item(index: number): WpsRow
  // 不再提供可调用签名 (index: number): WpsRow，运行时不支持
}

export interface WpsRow {
  /** 行号 */
  Row: number
  /** 是否隐藏 */
  Hidden: boolean
  /** 行高（隐藏行通常为 0） */
  RowHeight?: number
}

export interface WpsColumns {
  Count: number
}

// ========== WPS 单元格集合 ==========
export interface WpsCells {
  /** 单元格总数（全表单元格数，通常很大） */
  Count: number
  /** 获取指定行列的单元格（1‑based） */
  Item(row: number, col: number): WpsRange
}

// ========== WPS 自动筛选 ==========
export interface WpsAutoFilter {
  Mode?: boolean
  FilterMode?: boolean
  Range?: WpsRange
  Filters?: WpsFilters
}

export interface WpsFilters {
  Count: number
  Item(index: number): WpsFilter
  (index: number): WpsFilter
}

export interface WpsFilter {
  On: boolean
  Criteria1?: string
  Criteria2?: string
  Operator?: number
}

// ========== WPS 单元格/区域 ==========
export interface WpsRange {
  // 基础属性
  Row: number
  Column: number
  Rows: WpsRows
  Columns: WpsColumns

  // 值属性（WPS 中可能是属性也可能是函数，使用联合类型覆盖所有可能）
  Value?: WpsCellValue | WpsCellValue[][]
  // Value2 与 Value 同义，未格式化的原始值
  Value2?: WpsCellValue | WpsCellValue[][]
  // Text 为只读的格式化字符串
  Text?: string | null
  // Formula 可能是字符串公式、二维数组或错误值
  Formula?: WpsFormula
  // FormulaR1C1：R1C1 格式的公式字符串（走不同属性路径，绕过某些 Proxy 拦截）
  FormulaR1C1?: string

  // 格式属性
  Interior?: WpsInterior
  Font?: WpsFont

  // 区域属性
  Areas?: WpsAreas
  /** 区域地址（如 "A1:B10"），可能为本地或绝对引用格式 */
  Address?: string
  Count: number

  // 整行/整列
  EntireRow: WpsRange
  EntireColumn: WpsRange

  // 对齐与尺寸
  HorizontalAlignment: number
  ColumnWidth: number

  // 边框
  Borders: WpsBorders

  // 方法
  End(direction: number): WpsRange
  Select(): void
  Delete(): void
  Insert(): void
  SpecialCells(type: number): WpsRange
  AutoFit(): void
}

// ========== WPS 区域集合 ==========
export interface WpsAreas {
  Count: number
  Item(index: number): WpsRange
}

// ========== WPS 单元格格式 ==========
export interface WpsInterior {
  Color: number
  ColorIndex?: number
}

export interface WpsFont {
  Name: string
  Bold: boolean
  Size: number
  Color: number
}

export interface WpsBorders {
  LineStyle: number
}

// ========== WPS 插件存储 ==========
export interface WpsPluginStorage {
  setItem(key: string, value: string): void
  getItem(key: string): string | null
  removeItem(key: string): void
}

// ========== WPS 其他 ==========
export interface WpsOAAssist {
  ShellExecute(parameter: string): void
}

export interface WpsTaskPane {
  ID: string
  Visible: boolean
}

// ========== 类型守卫函数 ==========

export function isWpsApp(value: unknown): value is WpsApp {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ActiveWorkbook' in (value as Record<string, unknown>)
  )
}

export function isWpsWorksheet(value: unknown): value is WpsWorksheet {
  return (
    typeof value === 'object' &&
    value !== null &&
    'Name' in (value as Record<string, unknown>) &&
    'Range' in (value as Record<string, unknown>)
  )
}

export function isWpsRange(value: unknown): value is WpsRange {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('Row' in (value as Record<string, unknown>) ||
      'Value' in (value as Record<string, unknown>) ||
      'Value2' in (value as Record<string, unknown>))
  )
}

// ========== WPS 窗口扩展接口 ==========

export interface BgmWindow {
  Application?: unknown
  WPS_Enum?: unknown
  XL?: unknown

  BGM?: unknown
  BGM_CONFIG?: unknown
  BGM_COLOR?: unknown

  OnAddinLoad?: (ribbonUI: unknown) => boolean
  OnAction?: (control: { Id: string }) => boolean
  GetBangumiImage?: (control: { Id: string }) => string

  _bgmRibbonReady?: (a: unknown, b: unknown, c: unknown) => void
  _OnAddinLoadReal?: (ribbonUI: unknown) => boolean
  _OnActionReal?: (control: { Id: string }) => boolean
  _GetBangumiImageReal?: (control: { Id: string }) => string
  __ribbonUI?: unknown

  _modulesReady?: boolean

  _bgmDialogCallback?: { onOk?: (v?: string) => void; onCancel?: () => void } | null
  _bgmConfirmCallback?: { confirm?: () => void; cancel?: () => void } | null
}

// ========== 工具函数 ==========

export function wpsPrompt(message: string, defaultValue?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const app = getApp() as
      | {
          InputBox?: (
            message_: string,
            title: string,
            defaultValue_: string,
            type: number,
          ) => string | false
        }
      | null
      | undefined
    if (app?.InputBox) {
      try {
        const result = app.InputBox(message, 'Bangumi 设置', defaultValue ?? '', 2)
        if (result === false) {
          resolve(null)
          return
        }
        resolve(result)
        return
      } catch (error: unknown) {
        // 类型守卫：先缩窄类型再访问 message，符合 useUnknownInCatchVariables 规范
        const errorMessage = error instanceof Error ? error.message : String(error)
        bgmLog(LOG_LEVELS.WARN, `WPS InputBox 不可用: ${errorMessage}`)
      }
    }
    const bgmInput =
      typeof window === 'undefined'
        ? undefined
        : (
            window as unknown as Record<
              string,
              | ((
                  t: string,
                  m: string,
                  d: string,
                  oc: (v: string) => void,
                  oc2: () => void,
                ) => void)
              | undefined
            >
          ).BGMInput
    if (typeof bgmInput === 'function') {
      bgmInput(
        '输入',
        message,
        defaultValue ?? '',
        (value) => {
          resolve(value)
        },
        () => {
          resolve(null)
        },
      )
    } else {
      // 使用自定义输入对话框
      getNotifyApi().input(
        '输入',
        message,
        defaultValue,
        (value) => {
          resolve(value ?? null)
        },
        () => {
          resolve(null)
        },
      )
    }
  })
}

export function wpsMessageBox(message: string, buttons?: number, icon?: number): Promise<number> {
  return new Promise((resolve) => {
    const app = getApp() as
      { MessageBox?: (message_: string, type: number) => number } | null | undefined
    if (app?.MessageBox) {
      try {
        const result = app.MessageBox(message, (buttons ?? 0) + (icon ?? 64))
        resolve(result)
        return
      } catch (error: unknown) {
        // 类型守卫：先缩窄类型再访问 message，符合 useUnknownInCatchVariables 规范
        const errorMessage = error instanceof Error ? error.message : String(error)
        bgmLog(LOG_LEVELS.WARN, `WPS MessageBox 不可用: ${errorMessage}`)
      }
    }

    const bgmAlert =
      typeof window === 'undefined'
        ? undefined
        : (
            window as unknown as Record<
              string,
              ((m: string, t: string, oc?: () => void) => void) | undefined
            >
          ).BGMAlert
    if (buttons === 4) {
      const bgmConfirm =
        typeof window === 'undefined'
          ? undefined
          : (
              window as unknown as Record<
                string,
                ((m: string, t: string, oc: () => void, oc2: () => void) => void) | undefined
              >
            ).BGMConfirm
      if (typeof bgmConfirm === 'function') {
        bgmConfirm(
          message,
          '确认',
          () => {
            resolve(6)
          },
          () => {
            resolve(7)
          },
        )
      } else {
        // 使用自定义确认对话框
        getNotifyApi().confirm(
          message,
          (confirmed) => {
            resolve(confirmed ? 6 : 7)
          },
          '确认',
        )
      }
    } else if (typeof bgmAlert === 'function') {
      bgmAlert(message, '提示', () => {
        resolve(1)
      })
    } else {
      // 使用自定义警告对话框
      getNotifyApi().alert(message, '提示', () => {
        resolve(1)
      })
    }
  })
}

/**
 * 安全获取指定行的 Range 对象（推荐使用）
 * @param ws  当前工作表
 * @param row 1‑based 行号
 * @returns   该行对应的 WpsRange
 */
export function getRowRange(ws: WpsWorksheet, row: number): WpsRange {
  if (typeof ws.Range !== 'function') {
    throw new TypeError('Invalid worksheet object')
  }
  if (!Number.isFinite(row) || row < 1) {
    throw new Error(`Row index must be a positive integer, got ${String(row)}`)
  }
  return ws.Range(`${String(row)}:${String(row)}`)
}

/**
 * 带后备的安全行 Range 获取（当 Range 构造异常时尝试使用 Rows.Item）
 * @param ws  当前工作表
 * @param row 1‑based 行号
 * @returns   该行对应的 WpsRange
 */
export function getRowRangeSafe(ws: WpsWorksheet, row: number): WpsRange {
  try {
    return getRowRange(ws, row)
  } catch {
    try {
      const item = ws.Rows.Item(row)
      return item as unknown as WpsRange
    } catch {
      throw new Error(`Failed to access row ${String(row)}`)
    }
  }
}
