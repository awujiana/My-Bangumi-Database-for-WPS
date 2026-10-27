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
export interface WpsApp {
    ActiveWorkbook?: WpsWorkbook;
    Workbooks?: WpsWorkbooks;
    /** 同一 WPS 实例中的窗口集合；部分版本可通过 Window.ActiveSheet.Parent 补齐工作簿 */
    Windows?: WpsWindows;
    PluginStorage?: WpsPluginStorage;
    ActiveSheet?: WpsWorksheet;
    ActiveCell?: WpsRange;
    StatusBar?: string | boolean;
    OAAssist?: WpsOAAssist;
    InputBox?: (message: string, title: string, defaultValue: string, type: number) => string | false;
    MessageBox?: (message: string, type: number, icon?: number) => number;
    Wait?: (date: Date) => void;
    DoEvents?: () => void;
    CreateTaskPane?: (url: string) => WpsTaskPane;
    GetTaskPane?: (id: string) => WpsTaskPane;
    /**
     * 创建独立 Web 对话框（新版本宿主）。建出来不可见且无尺寸，
     * 需自行 `Visible = true` + `Resize(...)` —— 见 `tools/wps-web-dialog.js`
     */
    CreateWebDialog?: (url: string) => WpsWebDialog | null;
    /** 按 id 取回对话框，用于查存活 / 关闭 */
    GetWebDialog?: (id: number) => WpsWebDialog | null;
    /** 一步创建并显示的旧接口；返回值是否可用句柄因版本而异 */
    ShowDialog?: (url: string, caption: string, width: number, height: number, isModal: boolean) => WpsWebDialog | null;
    Enum?: Record<string, number>;
    ribbonUI?: unknown;
    Selection?: WpsSelection;
    /** 屏幕刷新开关（性能优化） */
    ScreenUpdating?: boolean;
    /** 计算模式：-4135=手动, -4105=自动 */
    Calculation?: number;
    /**
     * 工作表内容变更事件（单元格编辑触发）。
     * 面板用它做「预览随编辑自动刷新」（见 `panel/panel-auto-refresh.ts`）；
     * 部分宿主版本不提供该事件，此时为 `undefined`。
     */
    SheetChange?: ((sheet?: WpsWorksheet, target?: unknown) => void) | undefined;
}
export interface WpsWorkbooks {
    Count: number;
    Item(index: number): WpsWorkbook;
}
/** WPS 窗口集合的最小接口 */
export interface WpsWindows {
    Count?: number;
    Item(index: number): WpsWindow;
}
/** WPS 窗口的最小接口，用于从 ActiveSheet.Parent 取得所属工作簿 */
export interface WpsWindow {
    ActiveSheet?: {
        Parent?: unknown;
    };
    Workbook?: unknown;
    Parent?: unknown;
}
export interface WpsWorkbook {
    Name: string;
    FullName: string;
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
    Cells: WpsCells;
    AutoFilter?: WpsAutoFilter;
    AutoFilterMode?: boolean;
    UsedRange?: WpsRange;
    /** 全表条件格式规则集合（Sheet 级；部分宿主版本不提供，用时须探测，见 readForeignRules 兜底） */
    FormatConditions?: WpsFormatConditions;
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
    /** 整组行的显隐（高亮页「筛选显示」用：`Range(...).Rows.Hidden = true`） */
    Hidden: boolean;
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
export interface WpsCells {
    /** 单元格总数（全表单元格数，通常很大） */
    Count: number;
    /** 获取指定行列的单元格（1‑based） */
    Item(row: number, column: number): WpsRange;
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
    FormulaR1C1?: string;
    Interior?: WpsInterior;
    Font?: WpsFont;
    Areas?: WpsAreas;
    /**
     * 区域地址（如 "A1:B10" / "$B$3:$B$26958"）。
     *
     * 建模成「字符串属性 | 无参函数」联合：WPS 各版本下它有两副面孔——有的直接读
     * 属性就是地址串，有的 `Address` 是 COM 风格的方法，**属性读数恒为函数对象**
     * （`typeof` 是 function 而非 string），必须调用才返回地址。条件格式读
     * `FormatCondition.AppliesTo.Address` 实测踩到后者：38 条规则全部显示
     * 「（未读到范围）」。调用方统一走 readRangeAddress，别直接下标。
     */
    Address?: string | (() => unknown);
    /**
     * 本地化区域地址（部分 WPS 版本只有它可读；与 Address 同两副面孔）。
     * 条件格式实测：AppliesTo 的 Address 属性/函数都读不出串时，它可能是备用路径。
     */
    AddressLocal?: string | (() => unknown);
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
    FormatConditions?: WpsFormatConditions;
}
/** FormatConditions.Add 的入参（对象形式，与 WPS WebOffice 文档一致） */
export interface WpsFormatConditionAddOptions {
    /** 条件类型：2=xlExpression（公式）/ 1=xlCellValue（单元格值） */
    Type: number;
    /** 运算符（xlCellValue 时用；xlExpression 时忽略） */
    Operator?: number;
    /** 条件公式或值，如 '=$R3="26年10月"' */
    Formula1?: string;
    /** 第二部分（xlBetween 用） */
    Formula2?: string;
}
/** 单条条件格式规则 */
export interface WpsFormatCondition {
    Type?: number;
    Operator?: number;
    Formula1?: string;
    Formula2?: string;
    Priority?: number;
    /** 规则生效范围 */
    AppliesTo?: WpsRange;
    Interior?: WpsInterior;
    Font?: WpsFont;
    /** 「如果为真则停止」：本条命中就不再评估后续规则 */
    StopIfTrue?: boolean;
    Delete?: () => void;
    SetFirstPriority?: () => void;
    SetLastPriority?: () => void;
    ModifyAppliesToRange?: (range: string) => void;
    /** 一次性设置格式（WPS WebOffice 对象形式入参） */
    With?: (options: {
        Interior?: {
            Color?: string | number;
        };
        Font?: {
            Color?: string | number;
            Bold?: boolean;
        };
        Borders?: {
            LineStyle?: number;
            Color?: string | number;
        };
    }) => void;
}
/** 区域上的条件格式集合 */
export interface WpsFormatConditions {
    Count?: number;
    /**
     * 取第 index 条（1 基）规则。
     * 返回类型带 `| undefined` 是**诚实的宿主建模**：越界下标下部分 WPS 版本返回
     * undefined 而非抛错，调用方必须判空（见 conditional-format-apply 的 getForeignCondition）。
     */
    Item?: (index: number) => WpsFormatCondition | undefined;
    Add?: (options: WpsFormatConditionAddOptions) => WpsFormatCondition;
    /** 清空该区域全部规则（含手工建的——调用前必须读过并确认） */
    Delete?: () => void;
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
    /** 颜色索引（-4105=xlAutomatic 等；清除填充/字色时用） */
    ColorIndex?: number;
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
    ShellExecute(parameter: string): void;
}
export interface WpsTaskPane {
    ID: string;
    Visible: boolean;
}
/**
 * 宿主原生的独立 Web 对话框（WebDialog）
 *
 * 各版本暴露的成员差异较大，因此方法一律可选：缺失时 `wps-web-dialog.js`
 * 会降级（关不掉就提示手动关），不会因为「类型说有、运行时没有」而抛错。
 */
export interface WpsWebDialog {
    /** 实例 id（只读）；部分版本拿不到，取不到时按「无句柄」处理 */
    readonly ID?: number;
    Url?: string;
    /** 是否可见（读写）。`CreateWebDialog` 建出来默认 false，必须显式置 true */
    Visible?: boolean;
    IsModal?: boolean;
    /** 是否允许用户用系统关闭按钮关掉（我们要 true，用户得能自己关） */
    IsCloseable?: boolean;
    readonly Width?: number;
    readonly Height?: number;
    readonly Xpos?: number;
    readonly Ypos?: number;
    Resize?: (width: number, height: number) => void;
    Move?: (x: number, y: number) => void;
    Delete?: () => void;
}
export declare function isWpsApp(value: unknown): value is WpsApp;
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
export declare function wpsMessageBox(message: string, buttons?: number, icon?: number): Promise<number>;
/**
 * 安全获取指定行的 Range 对象（推荐使用）
 * @param worksheet  当前工作表
 * @param row 1‑based 行号
 * @returns   该行对应的 WpsRange
 */
export declare function getRowRange(worksheet: WpsWorksheet, row: number): WpsRange;
/**
 * 带后备的安全行 Range 获取（当 Range 构造异常时尝试使用 Rows.Item）
 * @param worksheet  当前工作表
 * @param row 1‑based 行号
 * @returns   该行对应的 WpsRange
 */
export declare function getRowRangeSafe(worksheet: WpsWorksheet, row: number): WpsRange;
//# sourceMappingURL=wps.d.ts.map