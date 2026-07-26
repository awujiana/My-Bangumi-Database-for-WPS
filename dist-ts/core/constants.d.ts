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
 * 每个元素为 [正则表达式, 标准字段名] 的元组
 * 用于将Excel表头文本自动映射到标准字段名
 *
 * @constant
 * @type {Array<[RegExp, string]>}
 *
 * @example
 * // 表头为 "Bangumi URL" → 映射到 "Bangumi_URL"
 * // 表头为 "名称/标题" → 映射到 "名称"
 */
export declare const COLUMN_RULES: [RegExp, string][];
/**
 * 列索引常量（模板默认列位置）
 * 基于 Bangumi 数据模板的固定列约定
 *
 * @constant
 * @type {Object}
 *
 * @property {number} SEQUENCE - 序列号（第9列, I列）
 * @property {number} DEFAULT_START - 默认起始列
 * @property {number} NAME - 名称列（第1列, A列）
 * @property {number} URL - Bangumi URL列（第2列, B列）
 * @property {number} STATUS - 状态列（第3列, C列）
 *
 * @description
 * 注意：实际运行时列位置由 getColumnMap() 动态匹配表头决定，
 * 这里的固定索引仅作为模板默认值和新表创建时的参考。
 */
export declare const COLUMNS: {
    /** 序列号列 - 第9列（I列），用于排序和行标识 */
    SEQUENCE: number;
    DEFAULT_START: number;
    /** 名称列 - 第1列（A列），条目名称 */
    NAME: number;
    /** URL列 - 第2列（B列），Bangumi 主题页链接 */
    URL: number;
    /** 状态列 - 第3列（C列），观看/阅读状态 */
    STATUS: number;
};
/**
 * 表头关键字列表
 * 用于自动识别Excel表格中的表头行
 * 当某行匹配到至少3个关键字时，判定为表头行
 *
 * @constant
 * @type {string[]}
 *
 * @see findHeaderRow - 在 util.ts 中使用此列表进行表头检测
 */
export declare const HEADER_KEYWORDS: string[];
/**
 * 重要列配置
 * 标记哪些列在数据预览中需要高亮显示
 * 键为标准字段名，值为布尔标记
 *
 * @constant
 * @type {Record<string, boolean>}
 */
export declare const IMPORTANT_COLS: Record<string, boolean>;
/**
 * 字段名称映射表
 * 将各种可能的Excel列名映射到统一的标准字段名
 * 用于同步引擎统一处理不同模板格式的列名差异
 *
 * @constant
 * @type {Record<string, string>}
 *
 * @example
 * // 表头"作品名" → 映射到 "name"
 * // 表头"评分" → 映射到 "rate"
 */
export declare const FIELD_NAME_MAP: Record<string, string>;
/**
 * URL匹配模式
 * 用于从URL文本中提取 Bangumi Subject ID
 * 支持 bgm.tv / bangumi.tv / chii.in 三种域名格式
 *
 * @constant
 * @type {RegExp[]}
 *
 * @example
 * // "https://bgm.tv/subject/72941" → 提取出 "72941"
 * // "https://chii.in/subject/12345" → 提取出 "12345"
 */
export declare const URL_PATTERNS: RegExp[];
/**
 * Token 版本配置（仅用于识别历史 XOR 加密数据）
 *
 * 当前 Token 已改为明文存储，XOR 加密仅保留用于读取历史数据并自动升级。
 * XOR_KEY 不再全局暴露，仅在 core/crypto.ts 内部保留以兼容旧数据。
 */
export declare const TOKEN_CONFIG: {
    /** Token版本标识，用于识别历史 XOR 加密数据 */
    VERSION: string;
};
/**
 * 观看状态文本到数值的映射表
 * 用于将用户可读的状态文本转换为 Bangumi API 需要的数值
 *
 * @constant
 * @type {Record<string, number>}
 *
 * @description
 * BGM API v0 状态码定义：
 * - 1: wish（想看）
 * - 2: collect（看过/看完）
 * - 3: do（在看）
 * - 4: on_hold（搁置/暂停）
 * - 5: dropped（抛弃/弃番）
 *
 * @example
 * // WATCH_STATUS_MAP["想看"] → 1
 * // WATCH_STATUS_MAP["看过"] → 2
 * // WATCH_STATUS_MAP["在看"] → 3
 * // WATCH_STATUS_MAP["搁置"] → 4
 * // WATCH_STATUS_MAP["抛弃"] → 5
 * // WATCH_STATUS_MAP["忽略"] → 0
 */
export declare const WATCH_STATUS_MAP: Record<string, number>;
/**
 * Bangumi API 收藏状态名称映射（下标即 API 数值）
 * 空字符串占位索引0（API无此数值）
 * 1=想看, 2=看过, 3=在看, 4=搁置, 5=抛弃
 *
 * @constant
 * @type {string[]}
 *
 * @description
 * 与 WATCH_STATUS_MAP 互补：
 * - WATCH_STATUS_MAP: 文本 → 数值（以文本查数值）
 * - COLLECTION_TYPE_NAMES: 数值 → 文本（数组下标即数值）
 *
 * @example
 * // COLLECTION_TYPE_NAMES[1] → "想看"
 * // COLLECTION_TYPE_NAMES[2] → "看过"
 * // COLLECTION_TYPE_NAMES[3] → "在看"
 */
export declare const COLLECTION_TYPE_NAMES: string[];
/**
 * 同步记录工作表名称
 * 在工作簿中创建"同步记录"工作表来存储同步操作的历史记录
 *
 * @constant
 * @type {string}
 */
export declare const SYNC_RECORD_SHEET_NAME = "\u540C\u6B65\u8BB0\u5F55";
/**
 * 同步记录表列名定义
 * 按顺序排列的12列：
 * SID(1) → 同步时间(2) → 名称(3) → URL(4) → 条目类型(5) → 来源(6)
 * → 次数(7) → 内容(8) → 状态(9) → 收藏状态(10) → 备注(11) → 数据指纹(12)
 *
 * @constant
 * @type {string[]}
 */
export declare const SYNC_RECORD_COLUMNS: string[];
/**
 * 同步记录表列索引常量（1-based，与Excel列号一致）
 * 方便代码按名称引用列号，避免硬编码数字
 *
 * @constant
 * @type {Object}
 *
 * @property {number} SID - Bangumi Subject ID，条目唯一标识
 * @property {number} TIME - 同步发生的时间
 * @property {number} NAME - 条目名称（中文名/日文名）
 * @property {number} URL - Bangumi 条目页面链接
 * @property {number} TYPE - 条目类型（动画/书籍/游戏等）
 * @property {number} SOURCE - 同步来源（GitHub/GitLab/Gitee/Gist/本地文件/BGM等）
 * @property {number} COUNT - 同步次数累计
 * @property {number} CONTENT - 同步内容描述（如"标记同步"）
 * @property {number} STATUS - 同步结果状态（成功/失败/跳过）
 * @property {number} COLL_TYPE - Bangumi收藏状态（想看/在看/看过等）
 * @property {number} MESSAGE - 备注信息或错误详情
 * @property {number} FINGERPRINT - 数据指纹，用于增量同步检测变更
 */
export declare const SYNC_RECORD_COL: {
    readonly SID: 1;
    readonly TIME: 2;
    readonly NAME: 3;
    readonly URL: 4;
    readonly TYPE: 5;
    readonly SOURCE: 6;
    readonly COUNT: 7;
    readonly CONTENT: 8;
    readonly STATUS: 9;
    readonly COLL_TYPE: 10;
    readonly MESSAGE: 11;
    readonly FINGERPRINT: 12;
};
/**
 * 同步记录类型颜色映射表
 * 根据收藏状态（想看/在看/看过/搁置/抛弃）显示对应颜色
 * 用于在同步记录表中直观区分不同的收藏状态
 *
 * @constant
 * @type {Record<string, number>}
 */
export declare const SYNC_RECORD_TYPE_COLOR: Record<string, number>;
//# sourceMappingURL=constants.d.ts.map