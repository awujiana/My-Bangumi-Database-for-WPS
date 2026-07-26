/**
 * WPS 单元格值类型
 * WPS COM 的 Value/Value2/Formula 属性可能是以下任意一种类型。
 * 调用方在使用前应通过 typeof/instanceof 进行类型守卫。
 */
export type WpsCellValue = string | number | boolean | Date | null;
/**
 * WPS 单元格公式类型
 * Formula 可能是字符串公式（如 "=A1+B1"）或二维数组的值。
 */
export type WpsFormula = string | WpsCellValue[][] | null;
/**
 * WPS 当前选中对象
 * Selection 可能是 Range、Shape、Chart 等多种对象或 null（无选中）。
 * 项目当前仅使用 Range 路径，其他场景需调用方自行类型守卫。
 */
export type WpsSelection = WpsRange | null;
export interface WpsApplication {
    ActiveWorkbook?: WpsWorkbook;
    PluginStorage?: WpsPluginStorage;
    ActiveSheet?: WpsWorksheet;
    ActiveCell?: WpsRange;
    StatusBar?: string | boolean;
    OAAssist?: WpsOAAssist;
    InputBox?: (message: string, title: string, defaultVal: string, type: number) => string | false;
    MessageBox?: (message: string, type: number, icon?: number) => number;
    Wait?: (date: Date) => void;
    DoEvents?: () => void;
    CreateTaskPane?: (url: string) => WpsTaskPane;
    GetTaskPane?: (id: string) => WpsTaskPane;
    Enum?: Record<string, number>;
    ribbonUI?: unknown;
    Selection?: WpsSelection;
}
export interface WpsWorkbook {
    Worksheets: WpsWorksheets;
    Sheets: WpsSheets;
    ActiveSheet: WpsWorksheet;
}
export interface WpsWorksheets {
    Count: number;
    Item(index: number): WpsWorksheet;
}
export interface WpsSheets {
    Count: number;
    Item(index: number): WpsWorksheet;
    Add(): WpsWorksheet;
}
export interface WpsWorksheet {
    Name: string;
    Rows: WpsRows;
    Columns: WpsColumns;
    AutoFilter?: WpsAutoFilter;
    AutoFilterMode?: boolean;
    UsedRange?: WpsRange;
    Activate(): void;
    Calculate(): void;
    Range(address: string): WpsRange;
    Move(Before?: WpsWorksheet | null, After?: WpsWorksheet | null): void;
}
export interface WpsRows {
    /** 行数 */
    Count: number;
    /** 获取指定行（1‑based） */
    Item(index: number): WpsRow;
}
export interface WpsRow {
    /** 行号 */
    Row: number;
    /** 是否隐藏 */
    Hidden: boolean;
    /** 行高（隐藏行通常为 0） */
    RowHeight?: number;
}
export interface WpsColumns {
    Count: number;
}
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
export interface WpsRange {
    Row: number;
    Column: number;
    Rows: WpsRows;
    Columns: WpsColumns;
    Value?: WpsCellValue | WpsCellValue[][];
    Value2?: WpsCellValue | WpsCellValue[][];
    Text?: string | null;
    Formula?: WpsFormula;
    Interior?: WpsInterior;
    Font?: WpsFont;
    Areas?: WpsAreas;
    /** 区域地址（如 "A1:B10"），可能为本地或绝对引用格式 */
    Address?: string;
    Count: number;
    EntireRow: WpsRange;
    EntireColumn: WpsRange;
    HorizontalAlignment: number;
    ColumnWidth: number;
    Borders: WpsBorders;
    End(direction: number): WpsRange;
    Select(): void;
    Delete(): void;
    Insert(): void;
    SpecialCells(type: number): WpsRange;
    AutoFit(): void;
}
export interface WpsAreas {
    Count: number;
    Item(index: number): WpsRange;
}
export interface WpsInterior {
    Color: number;
    ColorIndex?: number;
}
export interface WpsFont {
    Name: string;
    Bold: boolean;
    Size: number;
    Color: number;
}
export interface WpsBorders {
    LineStyle: number;
}
export interface WpsPluginStorage {
    setItem(key: string, value: string): void;
    getItem(key: string): string | null;
    removeItem(key: string): void;
}
export interface WpsOAAssist {
    ShellExecute(param: string): void;
}
export interface WpsTaskPane {
    ID: string;
    Visible: boolean;
}
export declare function isWpsApp(value: unknown): value is WpsApplication;
export declare function isWpsWorksheet(value: unknown): value is WpsWorksheet;
export declare function isWpsRange(value: unknown): value is WpsRange;
export interface BgmWindow {
    Application?: unknown;
    WPS_Enum?: unknown;
    XL?: unknown;
    BGM?: unknown;
    BGM_CONFIG?: unknown;
    BGM_COLOR?: unknown;
    OnAddinLoad?: (ribbonUI: unknown) => boolean;
    OnAction?: (control: {
        Id: string;
    }) => boolean;
    GetBangumiImage?: (control: {
        Id: string;
    }) => string;
    _bgmRibbonReady?: (a: unknown, b: unknown, c: unknown) => void;
    _OnAddinLoadReal?: (ribbonUI: unknown) => boolean;
    _OnActionReal?: (control: {
        Id: string;
    }) => boolean;
    _GetBangumiImageReal?: (control: {
        Id: string;
    }) => string;
    __ribbonUI?: unknown;
    _modulesReady?: boolean;
    _bgmDialogCallback?: {
        onOk?: (v?: string) => void;
        onCancel?: () => void;
    } | null;
    _bgmConfirmCallback?: {
        confirm?: () => void;
        cancel?: () => void;
    } | null;
}
export declare function wpsPrompt(message: string, defaultValue?: string): Promise<string | null>;
export declare function wpsMsgBox(message: string, buttons?: number, icon?: number): Promise<number>;
/**
 * 安全获取指定行的 Range 对象（推荐使用）
 * @param ws  当前工作表
 * @param row 1‑based 行号
 * @returns   该行对应的 WpsRange
 */
export declare function getRowRange(ws: WpsWorksheet, row: number): WpsRange;
/**
 * 带后备的安全行 Range 获取（当 Range 构造异常时尝试使用 Rows.Item）
 * @param ws  当前工作表
 * @param row 1‑based 行号
 * @returns   该行对应的 WpsRange
 */
export declare function getRowRangeSafe(ws: WpsWorksheet, row: number): WpsRange;
//# sourceMappingURL=wps.d.ts.map