/**
 * WPS 最小化接口定义
 * @module types/wps
 * @description 定义 WPS COM 对象的核心接口，避免 unknown 强制转换
 */

// ========== WPS Application ==========
export interface WpsApplication {
    ActiveWorkbook?: WpsWorkbook;
    PluginStorage?: WpsPluginStorage;
    ActiveSheet?: WpsWorksheet;
    ActiveCell?: WpsRange;
    StatusBar?: string | boolean;
    OAAssist?: WpsOAAssist;
    InputBox?: (message: string, title: string, defaultVal: string, type: number) => string | false;
    MessageBox?: (message: string, type: number) => number;
    Wait?: (date: Date) => void;
    DoEvents?: () => void;
    CreateTaskPane?: (url: string) => WpsTaskPane;
    GetTaskPane?: (id: string) => WpsTaskPane;
    Enum?: Record<string, number>;
    ribbonUI?: unknown;
}

// ========== WPS 工作簿 ==========
export interface WpsWorkbook {
    Worksheets: WpsWorksheets;
    Sheets: WpsSheets;
    ActiveSheet: WpsWorksheet;
}

// ========== WPS 工作表集合 ==========
export interface WpsWorksheets {
    Count: number;
    Item(index: number): WpsWorksheet;
}

export interface WpsSheets {
    Count: number;
    Item(index: number): WpsWorksheet;
    Add(): WpsWorksheet;
}

// ========== WPS 工作表 ==========
export interface WpsWorksheet {
    Name: string;
    Rows: WpsRows;
    Columns: WpsColumns;
    AutoFilter?: WpsAutoFilter;
    AutoFilterMode?: boolean;
    Activate(): void;
    Calculate(): void;
    Range(address: string): WpsRange;
    Cells(row: number, col: number): WpsRange;
}

// ========== WPS 行/列 ==========
export interface WpsRows {
    Count: number;
    Item(index: number): WpsRow;
    (index: number): WpsRow;
}

export interface WpsRow {
    Row: number;
    Hidden: boolean;
}

export interface WpsColumns {
    Count: number;
}

// ========== WPS 自动筛选 ==========
export interface WpsAutoFilter {
    Mode?: boolean;
    FilterMode?: boolean;
    Range?: WpsRange;
    Filters?: WpsFilters;
}

export interface WpsFilters {
    Count: number;
    Item(index: number): WpsFilter;
    (index: number): WpsFilter;
}

export interface WpsFilter {
    On: boolean;
    Criteria1?: string;
    Criteria2?: string;
    Operator?: number;
}

// ========== WPS 单元格/区域 ==========
export interface WpsRange {
    // 基础属性
    Row: number;
    Column: number;
    Rows: WpsRows;
    Columns: WpsColumns;

    // 值属性（WPS 中是属性，不是方法）
    Value?: unknown;
    Value2?: unknown;
    Text?: string;
    Formula?: string;

    // 格式属性
    Interior?: WpsInterior;
    Font?: WpsFont;

    // 区域属性
    Areas?: WpsAreas;

    // 方法
    End(direction: number): WpsRange;
    Select(): void;
    Delete(): void;
    SpecialCells(type: number): WpsRange;
}
// ========== WPS 区域集合 ==========
export interface WpsAreas {
    Count: number;
    Item(index: number): WpsRange;
}

// ========== WPS 单元格格式 ==========
export interface WpsInterior {
    Color: number;
    ColorIndex?: number;
}

export interface WpsFont {
    Bold: boolean;
    Size: number;
    Color: number;
}

// ========== WPS 插件存储 ==========
export interface WpsPluginStorage {
    setItem(key: string, value: string): void;
    getItem(key: string): string | null;
}

// ========== WPS 其他 ==========
export interface WpsOAAssist {
    ShellExecute(param: string): void;
}

export interface WpsTaskPane {
    ID: string;
    Visible: boolean;
}

// ========== 类型守卫函数 ==========

/**
 * 检查对象是否为有效的 WPS Application
 */
export function isWpsApp(value: unknown): value is WpsApplication {
    return (
        typeof value === 'object' &&
        value !== null &&
        'ActiveWorkbook' in (value as Record<string, unknown>)
    );
}

/**
 * 检查对象是否为有效的 WPS 工作表
 */
export function isWpsWorksheet(value: unknown): value is WpsWorksheet {
    return (
        typeof value === 'object' &&
        value !== null &&
        'Name' in (value as Record<string, unknown>) &&
        'Range' in (value as Record<string, unknown>)
    );
}

/**
 * 检查对象是否为有效的 WPS Range
 */
export function isWpsRange(value: unknown): value is WpsRange {
    return (
        typeof value === 'object' &&
        value !== null &&
        ('Row' in (value as Record<string, unknown>) ||
         'Value' in (value as Record<string, unknown>) ||
         'Value2' in (value as Record<string, unknown>))
    );
}