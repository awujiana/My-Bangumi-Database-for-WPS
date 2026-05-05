/**
 * 常量模块类型定义
 */

export interface WPSEnum {
    msoCTPDockPositionLeft: number;
    msoCTPDockPositionRight: number;
}

export interface XLConstants {
    UP: number;
    DOWN: number;
    TO_LEFT: number;
    TO_RIGHT: number;
    NONE: number;
    CELL_TYPE_VISIBLE: number;
}

export interface BGMConfig {
    API_BASE: string;
    REQUEST_DELAY: number;
    MAX_RETRIES: number;
    RETRY_DELAY_BASE: number;
}

export interface BGMColors {
    SUCCESS: number;
    FAIL: number;
    SKIP: number;
    BGM_SYNC: number;
    LIGHT_GREEN: number;
    DARK_GREEN: number;
    GRAY: number;
    WHITE: number;
}

export interface TokenConfig {
    KEY_BYTES: number[];
    VERSION: string;
    FALLBACK_KEYS: number[];
}

export interface LogLevels {
    DEBUG: 0;
    INFO: 1;
    WARN: 2;
    ERROR: 3;
}

export interface ErrorLevels {
    SILENT: 0;
    WARN: 1;
    ERROR: 2;
    THROW: 3;
}

declare const WPS_ENUM: WPSEnum;
declare const XL: XLConstants;
declare const BGM_CONFIG: BGMConfig;
declare const BGM_COLOR: BGMColors;
declare const TOKEN_CONFIG: TokenConfig;
declare const LOG_LEVELS: LogLevels;
declare const ERROR_LEVELS: ErrorLevels;

export { WPS_ENUM, XL, BGM_CONFIG, BGM_COLOR, TOKEN_CONFIG, LOG_LEVELS, ERROR_LEVELS };
export { BGM_API_CONFIG, BGM_COLORS, TOKEN_CFG };
