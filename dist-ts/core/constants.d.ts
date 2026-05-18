/**
 * @fileoverview 全局常量定义模块
 * @module core/constants
 * @description 存储项目中使用的所有全局常量、枚举、配置值和映射表。
 *              包括WPS Office枚举、Excel方向常量、Bangumi API配置、
 *              颜色常量、面板配置、表头关键字、字段映射等。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
/**
 * 错误级别枚举
 * 用于控制错误处理的行为和输出级别
 *
 * @enum {number}
 * @property {number} SILENT - 静默处理，不输出任何信息
 * @property {number} WARN - 输出警告信息
 * @property {number} ERROR - 输出错误信息
 * @property {number} THROW - 抛出异常
 * @property {number} INFO - 输出信息级日志
 */
export declare const ErrorLevel: {
    readonly SILENT: 0;
    readonly WARN: 1;
    readonly ERROR: 2;
    readonly THROW: 3;
    readonly INFO: 4;
};
/**
 * 错误处理选项接口
 * 用于配置handleError函数的行为
 *
 * @interface ErrorOptions
 * @property {number} [level=ErrorLevel.ERROR] - 错误级别
 * @property {string} [context] - 错误上下文描述
 * @property {boolean} [showAlert=false] - 是否显示警告对话框
 * @property {boolean} [throwOnCritical=true] - 严重错误是否抛出
 */
export interface ErrorOptions {
    level?: number;
    context?: string;
    showAlert?: boolean;
    throwOnCritical?: boolean;
}
/**
 * WPS Office 枚举值集合
 * 用于WPS加载项开发和COM对象操作
 *
 * @constant
 * @type {Object}
 */
export declare const WPS_ENUM: {
    /** 任务窗格停靠位置：左侧 */
    msoCTPDockPositionLeft: number;
    /** 任务窗格停靠位置：右侧 */
    msoCTPDockPositionRight: number;
};
/**
 * Excel 方向常量
 * 用于Range对象的导航和定位操作
 *
 * @constant
 * @type {Object}
 */
export declare const XL: {
    /** 向上定位 (xlUp) */
    UP: number;
    /** 向下定位 (xlDown) */
    DOWN: number;
    /** 向左定位 (xlToLeft) */
    TO_LEFT: number;
    /** 向右定位 (xlToRight) */
    TO_RIGHT: number;
    /** 无特殊填充 (xlNone) */
    NONE: number;
    /** 可见单元格类型 (xlCellTypeVisible) */
    CELL_TYPE_VISIBLE: number;
};
/**
 * Bangumi API 配置
 * 定义与Bangumi API通信的相关参数
 *
 * @constant
 * @type {Object}
 */
export declare const BGM_CONFIG: {
    /** Bangumi API 基础URL */
    API_BASE: string;
    /** 请求间隔时间（毫秒），用于防止API限流 */
    REQUEST_DELAY: number;
    /** 失败后最大重试次数 */
    MAX_RETRIES: number;
    /** 重试等待基础时间（毫秒），采用指数退避策略 */
    RETRY_DELAY_BASE: number;
};
/**
 * 错误级别映射
 * 将HTTP状态码映射到错误级别
 *
 * @constant
 * @type {Record<number, number>}
 */
export declare const ERROR_LEVELS: Record<number, number>;
/**
 * Excel 单元格颜色常量
 * 用于标记同步结果的可视化显示
 *
 * @constant
 * @type {Object}
 */
export declare const BGM_COLOR: {
    /** 浅绿色 - 同步成功 */
    SUCCESS: number;
    /** 浅红色 - 同步失败 */
    FAIL: number;
    /** 浅黄色 - 跳过 */
    SKIP: number;
    /** 紫色 - 从Bangumi同步（已收藏1次） */
    BGM_SYNC: number;
    /** 浅绿色 - 已同步2次 */
    LIGHT_GREEN: number;
    /** 深绿色 - 已同步3次及以上 */
    DARK_GREEN: number;
    /** 灰色 - 表头背景 */
    GRAY: number;
    /** 白色 - 清除标记 */
    WHITE: number;
    /** 粉色 - 想看状态 */
    WISH: number;
    /** 蓝色 - 在看状态 */
    WATCHING: number;
};
/**
 * 日志级别常量
 * 用于bgmLog函数控制日志输出
 *
 * @constant
 * @type {Object}
 */
export declare const LOG_LEVELS: {
    /** 信息级别 - 一般操作信息 */
    INFO: number;
    /** 警告级别 - 潜在问题提示 */
    WARN: number;
    /** 错误级别 - 错误信息 */
    ERROR: number;
};
/**
 * 任务面板配置
 * 定义面板扫描和显示的相关参数
 *
 * @constant
 * @type {Object}
 */
export declare const PANEL_CONFIG: {
    /** 表头检测的最大列数 */
    MAX_SCAN_COLUMNS: number;
    /** 表头检测的最大行数 */
    MAX_SCAN_ROWS: number;
    /** 预览显示的数据行数上限 */
    PREVIEW_LIMIT: number;
    /** 筛选检测最大行数 */
    MAX_FILTER_SCAN_ROWS: number;
    /** 回退检测的最大行数 */
    FILTER_FALLBACK_LIMIT: number;
};
/**
 * Bangumi 条目类型映射
 * 将数字类型映射为可读文本
 *
 * @constant
 * @type {Record<number, string>}
 */
export declare const BGM_SUBJECT_TYPES: Record<number, string>;
/**
 * 同步状态常量
 * 用于标识同步操作的结果状态
 *
 * @constant
 * @type {Object}
 */
export declare const SYNC_STATUS: {
    /** 成功 */
    SUCCESS: string;
    /** 失败 */
    FAIL: string;
    /** 跳过 */
    SKIP: string;
    /** 已收藏 */
    COLLECTED: string;
    /** 无需更新 */
    NO_UPDATE: string;
};
/**
 * 列规则配置
 * 定义各列的数据验证和转换规则
 *
 * @constant
 * @type {Array<Object>}
 */
export declare const COLUMN_RULES: [RegExp, string][];
/**
 * 列索引常量
 * 定义标准列对应的索引位置
 *
 * @constant
 * @type {Object}
 */
export declare const COLUMNS: {
    /** 序列号列 */
    SEQUENCE: number;
    DEFAULT_START: number;
    /** 名称列 */
    NAME: number;
    /** URL列 */
    URL: number;
    /** 状态列 */
    STATUS: number;
};
/**
 * 表头关键字列表
 * 用于自动识别Excel表格中的表头行
 *
 * @constant
 * @type {string[]}
 */
export declare const HEADER_KEYWORDS: string[];
/**
 * 重要列配置
 * 标记哪些列属于重要列，在预览时会高亮显示
 *
 * @constant
 * @type {Record<string, boolean>}
 */
export declare const IMPORTANT_COLS: Record<string, boolean>;
/**
 * 字段名称映射表
 * 将各种可能的列名映射到标准字段名
 *
 * @constant
 * @type {Record<string, string>}
 */
export declare const FIELD_NAME_MAP: Record<string, string>;
/**
 * URL匹配模式
 * 用于从各种格式的URL中提取Bangumi Subject ID
 *
 * @constant
 * @type {RegExp[]}
 */
export declare const URL_PATTERNS: RegExp[];
/**
 * Token加密配置
 * 定义Token加密和解密的相关参数
 *
 * @constant
 * @type {Object}
 */
export declare const TOKEN_CONFIG: {
    /** Token版本标识 */
    VERSION: string;
    /** XOR加密密钥 */
    XOR_KEY: string;
};
/**
 * 观看状态文本到数值的反向映射（用于快速精确匹配）
 * 键：常见状态文本（小写），值：Bangumi 状态码 (1-5)
 */
/**
 * 观看状态文本到数值的映射表
 * 用于将用户友好的状态文本转换为Bangumi API所需数值
 *
 * @constant
 * @type {Record<string, number>}
 * @description
 * BGM API v0 状态码：
 * - 1: wish (想看)
 * - 2: collect (在看)
 * - 3: do (看过)
 * - 4: on_hold (搁置)
 * - 5: dropped (抛弃)
 */
export declare const WATCH_STATUS_MAP: Record<string, number>;
/**
 * BGM API 收藏状态名称映射（下标即 API 数值）
 * 1=想看, 2=在看, 3=看过, 4=搁置, 5=抛弃
 *
 * @constant
 * @type {string[]}
 */
export declare const COLLECTION_TYPE_NAMES: string[];
/**
 * 同步记录工作表名称
 *
 * @constant
 * @type {string}
 */
export declare const SYNC_RECORD_SHEET_NAME = "\u540C\u6B65\u8BB0\u5F55";
/**
 * 同步记录列配置
 *
 * @constant
 * @type {string[]}
 */
export declare const SYNC_RECORD_COLUMNS: string[];
/**
 * 同步记录表列索引常量 (1-based)
 *
 * @constant
 * @type {Object}
 */
export declare const SYNC_RECORD_COL: {
    readonly SID: 1;
    readonly TIME: 2;
    readonly NAME: 3;
    readonly URL: 4;
    readonly TYPE: 5;
    readonly COUNT: 6;
    readonly CONTENT: 7;
    readonly STATUS: 8;
    readonly COLL_TYPE: 9;
    readonly MESSAGE: 10;
    readonly FINGERPRINT: 11;
};
/**
 * 同步记录类型颜色映射表
 *
 * @constant
 * @type {Record<string, number>}
 */
export declare const SYNC_RECORD_TYPE_COLOR: Record<string, number>;
//# sourceMappingURL=constants.d.ts.map