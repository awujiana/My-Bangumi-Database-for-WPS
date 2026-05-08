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
export interface BgmWindow {
    Application?: unknown;
    WPS_Enum?: unknown;
    XL?: unknown;
    BGM?: unknown;
    BGM_CONFIG?: unknown;
    BGM_COLOR?: unknown;
    bgmLog?: (level: number, msg: string) => void;
    getApp?: () => unknown;
    loadBgToken?: () => string | null;
    storeBgToken?: (token: string) => boolean;
    clearBgToken?: () => boolean;
    getCell?: (ws: unknown, row: number, col: number) => unknown;
    getCellValue?: (ws: unknown, row: number, col: number) => string;
    setCellValue?: (ws: unknown, row: number, col: number, value: unknown) => boolean;
    readCell?: (ws: unknown, row: number, col: number) => string;
    colNumToLetter?: (col: number) => string;
    showAlert?: (message: string, title?: string, onOk?: () => void) => void;
    showConfirm?: (message: string, title?: string, onOk?: () => void, onCancel?: () => void) => void;
    showError?: (message: string, title?: string, onOk?: () => void) => void;
    showWarning?: (message: string, title?: string, onOk?: () => void) => void;
    showSuccess?: (message: string, title?: string, onOk?: () => void) => void;
    showInput?: (title: string, prompt: string, defaultValue?: string, onOk?: (v: string) => void, onCancel?: () => void) => void;
    showToast?: (message: string, type?: string) => void;
    showDialog?: (title: string, message: string) => void;
    BGMAlert?: (message: string, title?: string) => void;
    BGMConfirm?: (message: string, title: string, onOk?: () => void, onCancel?: () => void) => void;
    BGMError?: (message: string, title?: string) => void;
    BGMWarning?: (message: string, title?: string) => void;
    BGMSuccess?: (message: string, title?: string) => void;
    BGMInput?: (title: string, prompt: string, defaultValue: string, onOk?: (v: string) => void, onCancel?: () => void) => void;
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
    SyncToBangumi?: () => void;
    previewSyncContent?: () => void;
    fetchBgCollectionRecords?: () => void;
    clearSyncRecords?: () => void;
    markUploadedItems?: (sheetIndexOrName: unknown) => void;
    clearSheetMarks?: (sheetIndexOrName: unknown) => void;
    refreshSheets?: () => void;
    refreshData?: () => void;
    toggleSheetLock?: () => void;
    findHeaderRow?: (ws: unknown, startRow?: number) => number;
    getColumnMap?: (ws: unknown, headerRow: number) => Map<string, number>;
    getLastRow?: (ws: unknown) => number;
    extractSubjectId?: (url: string) => string;
    mapWatchStatus?: (status: string) => number;
    buildJsonPayload?: (ws: unknown, row: number, colMap: Map<string, number>, finishedDate: string) => string;
    _bgmDialogCallback?: {
        onOk?: (v?: string) => void;
        onCancel?: () => void;
    } | null;
    _bgmConfirmCallback?: {
        confirm?: () => void;
        cancel?: () => void;
    } | null;
    _dialogCallback?: ((result?: unknown) => void) | null;
    __ribbonUI?: unknown;
    /** 安全调用函数（index.html 中使用） */
    safeCall?: (funcName: string, ...args: unknown[]) => unknown;
    /** 模块就绪标志 */
    _modulesReady?: boolean;
    /** 面板操作分发 */
    onAction?: (action: string) => void;
    /** 更新筛选状态 */
    updateFilterStatus?: (ws?: unknown) => void;
    /** 模式切换处理 */
    onSelectModeChange?: () => void;
    /** 标记已上传条目（默认工作表） */
    markUploadedItemsDefault?: () => void;
    /** 清除工作表标记（默认工作表） */
    clearSheetMarksDefault?: () => void;
    /** 预览同步内容 */
    filterDetailItems?: (filterType: string) => void;
    /** 上传单行 */
    uploadSingleRow?: (rowNum: number, btnElement?: HTMLElement) => void;
    /** 更新上传统计 */
    updateUploadStats?: () => void;
    /** 显示/关闭详情模态框 */
    showDetailModal?: () => void;
    closeDetailModal?: () => void;
    /** 查看同步记录详情 */
    viewSyncRecordDetail?: (sid: string) => void;
    /** 构建预览请求体（兼容旧接口） */
    buildPreviewPayload?: (ws: unknown, row: number, colMap: Map<string, number>) => string;
    /** 更新详情计数 */
    updateDetailCount?: (count: number) => void;
    /** 详情预览数据 */
    detailPreviewData?: {
        allItems: unknown[];
        currentFilter: string;
        totalWithType: number;
        totalValid: number;
        totalUploaded: number;
    };
    /** 打开同步记录工作表 */
    openSyncRecordSheet?: () => void;
    /** 获取所有同步记录 */
    getAllSyncRecords?: () => unknown[];
    /** 添加同步记录 */
    addSyncRecord?: (sheetOrOptions: unknown, record?: unknown) => boolean;
    /** 获取或创建同步记录表 */
    getOrCreateSyncRecordSheet?: () => unknown;
    /** 获取顺序行（按序列号） */
    getSequentialRowsBySeqCol?: (startRow: number, endRow: number) => {
        validRows: number[];
    };
}
//# sourceMappingURL=wps.d.ts.map