/**
 * BGM 项目常量定义
 * @module constants
 * @description 统一定义所有常量，避免分散定义导致的不一致
 *              所有其他模块应从此模块导入常量，而非自行定义
 */
export declare const WPS_ENUM: {
    msoCTPDockPositionLeft: number;
    msoCTPDockPositionRight: number;
};
export declare const XL: {
    UP: number;
    DOWN: number;
    TO_LEFT: number;
    TO_RIGHT: number;
    NONE: number;
    CELL_TYPE_VISIBLE: number;
};
export declare const BGM_CONFIG: {
    API_BASE: string;
    REQUEST_DELAY: number;
    MAX_RETRIES: number;
    RETRY_DELAY_BASE: number;
};
export declare const BGM_COLOR: {
    SUCCESS: number;
    FAIL: number;
    SKIP: number;
    BGM_SYNC: number;
    LIGHT_GREEN: number;
    DARK_GREEN: number;
    GRAY: number;
    WHITE: number;
};
export declare const TOKEN_CONFIG: {
    KEY_BYTES: number[];
    VERSION: string;
    FALLBACK_KEYS: number[];
};
export declare const LOG_LEVELS: {
    DEBUG: number;
    INFO: number;
    WARN: number;
    ERROR: number;
};
export declare const ERROR_LEVELS: {
    SILENT: number;
    WARN: number;
    ERROR: number;
    THROW: number;
};
export declare const PANEL_CONFIG: {
    /** 表头/数据扫描的最大列数 */
    MAX_SCAN_COLUMNS: number;
    /** 表头检测的最大扫描行数 */
    MAX_SCAN_ROWS: number;
    /** 预览显示的数据行数上限 */
    PREVIEW_LIMIT: number;
    /** 筛选检测最大行数（SpecialCells 可用时） */
    MAX_FILTER_SCAN_ROWS: number;
    /** 回退方式（逐行 Hidden 检查）的最大行数 */
    FILTER_FALLBACK_LIMIT: number;
};
export declare const BGM_SUBJECT_TYPES: {
    [key: number]: string;
};
export declare const SYNC_STATUS: {
    SUCCESS: string;
    FAIL: string;
    SKIP: string;
    COLLECTED: string;
};
//# sourceMappingURL=constants.d.ts.map