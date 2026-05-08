/**
 * WPS 最小化接口定义
 * @module types/wps
 * @description 定义 WPS COM 对象的核心接口，避免 unknown 强制转换
 */
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
    Activate(): void;
    Calculate(): void;
    Range(address: string): WpsRange;
    Cells(row: number, col: number): WpsRange;
}
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
    Value?: unknown;
    Value2?: unknown;
    Text?: string;
    Formula?: string;
    Interior?: WpsInterior;
    Font?: WpsFont;
    Areas?: WpsAreas;
    End(direction: number): WpsRange;
    Select(): void;
    Delete(): void;
    SpecialCells(type: number): WpsRange;
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
    Bold: boolean;
    Size: number;
    Color: number;
}
export interface WpsPluginStorage {
    setItem(key: string, value: string): void;
    getItem(key: string): string | null;
}
export interface WpsOAAssist {
    ShellExecute(param: string): void;
}
export interface WpsTaskPane {
    ID: string;
    Visible: boolean;
}
/**
 * 检查对象是否为有效的 WPS Application
 */
export declare function isWpsApp(value: unknown): value is WpsApplication;
/**
 * 检查对象是否为有效的 WPS 工作表
 */
export declare function isWpsWorksheet(value: unknown): value is WpsWorksheet;
/**
 * 检查对象是否为有效的 WPS Range
 */
export declare function isWpsRange(value: unknown): value is WpsRange;
//# sourceMappingURL=wps.d.ts.map