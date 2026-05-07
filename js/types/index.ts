/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口
 *              其他模块只需 `import { ... } from './types/index.js'`
 */

// ========== 从 result.ts 重导出 ==========
export { BgmError } from './result.js';
export type { BgmResultError } from './result.js';
export { Result } from './result.js';
export type { SyncResult } from './result.js';
export { toSyncResult } from './result.js';

// ========== 错误级别枚举 ==========
export const ErrorLevel = {
    SILENT: 0,
    WARN: 1,
    ERROR: 2,
    THROW: 3
} as const;
export type ErrorLevel = typeof ErrorLevel[keyof typeof ErrorLevel];

// ========== BGM 缓存数据结构 ==========
export interface BGMCache {
    /** WPS 文档总行数缓存 */
    totalRows: number;
    /** 当前用户 ID */
    userId: string | null;
    /** 当前用户名 */
    username: string | null;
    /** Subject ID 缓存（sid → 行号） */
    sidCache: Map<string, string>;
    /** 列表缓存（通用数据） */
    listCache: unknown[];
}

// ========== BGM 工作表状态 ==========
export interface BGMSheet {
    /** 锁定的工作表索引 */
    lockedIndex: number | null;
    /** 锁定的工作表名称 */
    lockedName: string | null;
    /** 是否已锁定 */
    isLocked: boolean;
}

// ========== BGM 同步状态 ==========
export interface BGMSync {
    /** 是否正在同步 */
    isRunning: boolean;
    /** 上次同步时间（ISO 格式） */
    lastSyncTime: string | null;
}

// ========== BGM 用户信息 ==========
export interface BGMUserInfo {
    /** 用户 ID */
    id: string;
    /** 用户名 */
    username: string;
}

export interface TokenVerifyResult {
    valid: boolean;
    userId: string;
    username: string;
    message: string;
}

export interface ApiResponse {
    status: number;
    data: any;
}

export interface BangumiUserData {
    id?: string | number;
    nickname?: string;
    username?: string;
}








// ========== 对话框选项 ==========
export interface DialogOptions {
    title?: string;
    message?: string;
    prompt?: string;       // 输入框的提示文本（与 message 等效）
    /** 输入确认回调（参数为用户输入的值） */
    onOk?: (value?: string) => void;
    /** 取消回调 */
    onCancel?: () => void;
    // 确认回调（无输入参数，适用于确认对话框） */
    onConfirm?: () => void;      
    /** 默认值 */
    defaultValue?: string;
}


export interface DialogButton {
    id: string;
    cls: string;
    text: string;
    event: string;
}

export interface DialogConfig {
    id: string;
    titleId: string;
    msgId: string;
    buttons: DialogButton[];
}

export interface DialogCallback {
    onOk?: (value?: string) => void;  // value 改为可选
    onCancel?: () => void;
}











// ========== 错误处理选项 ==========
export interface ErrorOptions {
    /** 错误级别（0=SILENT, 1=WARN, 2=ERROR, 3=THROW） */
    level?: ErrorLevel;
    /** 是否显示错误对话框 */
    showDialog?: boolean;
    /** 错误上下文描述 */
    context?: string;
}

// ========== WPS 窗口扩展接口 ==========
export interface BgmWindow {
    // 应用对象
    Application?: unknown;
    WPS_Enum?: unknown;
    XL?: unknown;

    // BGM 全局对象
    BGM?: unknown;
    BGM_CONFIG?: unknown;
    BGM_COLOR?: unknown;

    // 核心函数
    bgmLog?: (level: number, msg: string) => void;
    getApp?: () => unknown;
    loadBgToken?: () => string | null;
    storeBgToken?: (token: string) => boolean;
    clearBgToken?: () => boolean;

    // 单元格操作
    getCell?: (ws: unknown, row: number, col: number) => unknown;
    getCellValue?: (ws: unknown, row: number, col: number) => string;
    setCellValue?: (ws: unknown, row: number, col: number, value: unknown) => boolean;
    readCell?: (ws: unknown, row: number, col: number) => string;
    colNumToLetter?: (col: number) => string;

    // 对话框
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

    // Ribbon 回调
    OnAddinLoad?: (ribbonUI: unknown) => boolean;
    OnAction?: (control: { Id: string }) => boolean;
    GetBangumiImage?: (control: { Id: string }) => string;
    _bgmRibbonReady?: (a: unknown, b: unknown, c: unknown) => void;
    _OnAddinLoadReal?: (ribbonUI: unknown) => boolean;
    _OnActionReal?: (control: { Id: string }) => boolean;
    _GetBangumiImageReal?: (control: { Id: string }) => string;

    // 同步相关
    SyncToBangumi?: () => void;
    previewSyncContent?: () => void;
    fetchBgCollectionRecords?: () => void;
    clearSyncRecords?: () => void;
    markUploadedItems?: (sheetIndexOrName: unknown) => void;
    clearSheetMarks?: (sheetIndexOrName: unknown) => void;

    // 工作表操作
    refreshSheets?: () => void;
    refreshData?: () => void;
    toggleSheetLock?: () => void;
    findHeaderRow?: (ws: unknown, startRow?: number) => number;
    getColumnMap?: (ws: unknown, headerRow: number) => Map<string, number>;
    getLastRow?: (ws: unknown) => number;
    extractSubjectId?: (url: string) => string;
    mapWatchStatus?: (status: string) => number;
    buildJsonPayload?: (ws: unknown, row: number, colMap: Map<string, number>, finishedDate: string) => string;

    // 回调存储
    _bgmDialogCallback?: { onOk?: (v?: string) => void; onCancel?: () => void } | null;
    _bgmConfirmCallback?: { confirm?: () => void; cancel?: () => void } | null;
    _dialogCallback?: ((result?: unknown) => void) | null;

    // Ribbon UI
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
    getSequentialRowsBySeqCol?: (startRow: number, endRow: number) => { validRows: number[] };


}

export type {
    WpsApplication,
    WpsWorkbook,
    WpsWorksheets,
    WpsSheets,
    WpsWorksheet,
    WpsRows,
    WpsRow,
    WpsColumns,
    WpsRange,
    WpsAutoFilter,
    WpsFilters,
    WpsFilter,
    WpsInterior,
    WpsFont,
    WpsAreas,
    WpsPluginStorage,
    WpsOAAssist,
    WpsTaskPane,
} from './wps.js';

export { isWpsApp, isWpsWorksheet, isWpsRange } from './wps.js';