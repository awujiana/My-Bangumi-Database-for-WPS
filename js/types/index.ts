/**
 * BGM 项目全局类型定义
 */

// ========== Excel 类型 ==========
interface ExcelApplication {
    ActiveWorkbook?: ExcelWorkbook;
    ActiveCell?: ExcelCell;
    InputBox?: (msg: string, title: string, defaultVal: string, type: number) => string | false;
    MessageBox?: (msg: string, type: number) => number;
    Wait?: (date: Date) => void;
    DoEvents?: () => void;
    OAAssist?: { ShellExecute: (p: string) => void };
    PluginStorage?: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
    };
    CreateTaskPane?: (url: string) => { ID: string; Visible: boolean };
    GetTaskPane?: (id: string) => { Visible: boolean };
}

interface ExcelWorkbook {
    ActiveSheet?: ExcelWorksheet;
    Worksheets: ExcelWorksheets;
}

interface ExcelWorksheets {
    Count: number;
    Item: (index: number) => ExcelWorksheet;
}

interface ExcelWorksheet {
    Rows: { Count: number };
    Columns: { Count: number };
    Cells: (row: number, col: number) => ExcelCell;
    Range: (addr: string) => ExcelCell;
    AutoFilterMode?: boolean;
    AutoFilter?: {
        Range?: ExcelCell;
        Filters?: {
            Count: number;
            (index: number): { On: boolean };
        };
    };
}

interface ExcelCell {
    Value: unknown;
    Row: number;
    Column: number;
    Interior?: { ColorIndex: number };
    End: (direction: number) => ExcelCell;
}

declare const Application: ExcelApplication;
declare const XL: {
    UP: number; DOWN: number; LEFT: number; RIGHT: number;
    TO_LEFT: number; TO_RIGHT: number; NONE: number; CELL_TYPE_VISIBLE: number;
};

// ========== Window 全局类型 ==========
interface BgmWindow {
    Application?: ExcelApplication;
    BGM?: unknown;
    BGMDialog?: unknown;
    BGMMessage?: unknown;
    BgmError?: unknown;
    handleError?: unknown;
    safeExecute?: unknown;
    bgmLog?: (level: number, message: string) => void;
    WPS_Enum?: unknown;
    XL?: typeof XL;
    BGM_CONFIG?: unknown;
    BGM_COLOR?: unknown;
    getApp?: () => ExcelApplication | null;
    BGMAlert?: (message: string, title: string) => void;
    BGMConfirm?: (message: string, title: string, onOk?: () => void, onCancel?: () => void) => void;
    BGMError?: (message: string, title: string) => void;
    BGMInput?: (title: string, prompt: string, defaultValue: string, onOk?: (v: string) => void, onCancel?: () => void) => void;
    showDialog?: (title: string, message: string) => void;
    showAlert?: (message: string, title: string, onOk?: () => void) => void;
    showConfirm?: (message: string, title: string, onOk?: () => void, onCancel?: () => void) => void;
    storeBgToken?: (token: string) => boolean;
    clearBgToken?: () => boolean;
    loadBgToken?: () => string | null;
    _setBgmUserId?: (id: string) => void;
    _getBgmUserId?: () => string | null;
    _fetchBgmUserInfo?: (callback?: (userInfo: BGMUserInfo | null) => void) => void;
    showBangumiPanel?: () => void;
    sleep?: (ms: number) => void;
    wpsPrompt?: (message: string, defaultValue?: string) => Promise<string | null>;
    _bgmDialogCallback?: { onOk?: () => void; onCancel?: () => void };
    _bgmConfirmCallback?: { confirm?: () => void; cancel?: () => void };
    [key: string]: unknown;
}

declare const window: BgmWindow;

// ========== 常量类型 ==========
interface BGMConfig {
    API_BASE: string;
    REQUEST_DELAY: number;
    MAX_RETRIES: number;
    RETRY_DELAY_BASE: number;
}

interface BGMColor {
    SUCCESS: number; FAIL: number; SKIP: number;
    BGM_SYNC: number; LIGHT_GREEN: number; DARK_GREEN: number;
    GRAY: number; WHITE: number;
}

interface LOG_LEVELS {
    DEBUG: 0; INFO: 1; WARN: 2; ERROR: 3;
}

interface ERROR_LEVELS {
    SILENT: 0; WARN: 1; ERROR: 2; THROW: 3;
}

declare const BGM_CONFIG: BGMConfig;
declare const BGM_COLOR: BGMColor;
declare const LOG_LEVELS: LOG_LEVELS;
declare const ERROR_LEVELS: ERROR_LEVELS;

// ========== 数据类型 ==========
interface BGMUserInfo {
    id: string;
    username: string;
}

interface BGMCache {
    totalRows: number;
    userId: string | null;
    username: string | null;
    sidCache: Map<string, string>;
    listCache: unknown[];
}

interface BGMSheet {
    lockedIndex: number | null;
    lockedName: string | null;
    isLocked: boolean;
}

interface BGMSync {
    isRunning: boolean;
    lastSyncTime: string | null;
}

interface ColumnMap {
    name: number | null;
    subjectId: number | null;
    url: number | null;
    type: number | null;
    rate: number | null;
    tags: number | null;
    comment: number | null;
    finishedDate: number | null;
    epStatus: number | null;
    syncStatus: number | null;
}

interface SyncStats {
    success: number;
    fail: number;
    skip: number;
}

// ========== 导出类型 ==========
export type {
    ExcelApplication, ExcelWorkbook, ExcelWorksheet, ExcelCell, ExcelWorksheets,
    BgmWindow, BGMConfig, BGMColor, LOG_LEVELS, ERROR_LEVELS,
    BGMUserInfo, BGMCache, BGMSheet, BGMSync, ColumnMap, SyncResult
};
