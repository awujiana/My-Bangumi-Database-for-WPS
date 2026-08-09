/**
 * WPS 最小化接口定义
 * @module types/wps
 * @description 定义 WPS COM 对象的核心接口，避免 unknown 强制转换
 */
import { getApp, bgmLog, LOG_LEVELS } from '../index.js'
import {
  showAlert as customShowAlert,
  showConfirm as customShowConfirm,
  showInput as customShowInput,
} from '../ui/dialog.js'

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
export interface WpsApplication {
  ActiveWorkbook?: WpsWorkbook
  PluginStorage?: WpsPluginStorage
  ActiveSheet?: WpsWorksheet
  ActiveCell?: WpsRange
  StatusBar?: string | boolean
  OAAssist?: WpsOAAssist
  InputBox?: (message: string, title: string, defaultVal: string, type: number) => string | false
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
}

// ========== WPS 工作簿 ==========
export interface WpsWorkbook {
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
  ShellExecute(param: string): void
}

export interface WpsTaskPane {
  ID: string
  Visible: boolean
}

// ========== 类型守卫函数 ==========

export function isWpsApp(value: unknown): value is WpsApplication {
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
    const app = getApp() as {
      InputBox?: (msg: string, title: string, defaultVal: string, type: number) => string | false
    }
    if (app?.InputBox) {
      try {
        const result = app.InputBox(message, 'Bangumi 设置', defaultValue || '', 2)
        if (result === false || result === null || result === undefined) {
          resolve(null)
          return
        }
        resolve(String(result))
        return
      } catch (e: unknown) {
        // 类型守卫：先缩窄类型再访问 message，符合 useUnknownInCatchVariables 规范
        const errMsg = e instanceof Error ? e.message : String(e)
        bgmLog(LOG_LEVELS.WARN, `WPS InputBox 不可用: ${errMsg}`)
      }
    }
    if (
      typeof window !== 'undefined' &&
      typeof (window as unknown as Record<string, unknown>).BGMInput === 'function'
    ) {
      ;(
        window as unknown as Record<
          string,
          (t: string, m: string, d: string, oc: (v: string) => void, oc2: () => void) => void
        >
      ).BGMInput!(
        '输入',
        message,
        defaultValue || '',
        (value) => {
          resolve(value)
        },
        () => {
          resolve(null)
        },
      )
    } else {
      // 使用自定义输入对话框
      customShowInput(
        '输入',
        message,
        defaultValue,
        (value) => {
          resolve(value || null)
        },
        () => {
          resolve(null)
        },
      )
    }
  })
}

export function wpsMsgBox(message: string, buttons?: number, icon?: number): Promise<number> {
  return new Promise((resolve) => {
    const app = getApp() as { MessageBox?: (msg: string, type: number) => number }
    if (app?.MessageBox) {
      try {
        const result = app.MessageBox(message, (buttons || 0) + (icon || 64))
        resolve(result)
        return
      } catch (e: unknown) {
        // 类型守卫：先缩窄类型再访问 message，符合 useUnknownInCatchVariables 规范
        const errMsg = e instanceof Error ? e.message : String(e)
        bgmLog(LOG_LEVELS.WARN, `WPS MessageBox 不可用: ${errMsg}`)
      }
    }

    if (buttons === 4) {
      if (
        typeof window !== 'undefined' &&
        typeof (window as unknown as Record<string, unknown>).BGMConfirm === 'function'
      ) {
        ;(
          window as unknown as Record<
            string,
            (m: string, t: string, oc: () => void, oc2: () => void) => void
          >
        ).BGMConfirm!(
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
        customShowConfirm(
          message,
          (confirmed) => {
            resolve(confirmed ? 6 : 7)
          },
          '确认',
        )
      }
    } else {
      if (
        typeof window !== 'undefined' &&
        typeof (window as unknown as Record<string, unknown>).BGMAlert === 'function'
      ) {
        ;(window as unknown as Record<string, (m: string, t: string, oc?: () => void) => void>)
          .BGMAlert!(message, '提示', () => {
          resolve(1)
        })
      } else {
        // 使用自定义警告对话框
        customShowAlert(message, '提示', () => {
          resolve(1)
        })
      }
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
  if (!ws || typeof ws.Range !== 'function') {
    throw new Error('Invalid worksheet object')
  }
  if (!Number.isFinite(row) || row < 1) {
    throw new Error(`Row index must be a positive integer, got ${row}`)
  }
  return ws.Range(`${row}:${row}`)
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
      throw new Error(`Failed to access row ${row}`)
    }
  }
}
