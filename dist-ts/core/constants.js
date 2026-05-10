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
 */
export const ErrorLevel = {
    SILENT: 0,
    WARN: 1,
    ERROR: 2,
    THROW: 3
};
/**
 * WPS Office 枚举值集合
 * 用于WPS加载项开发和COM对象操作
 *
 * @constant
 * @type {Object}
 */
export const WPS_ENUM = {
    /** 任务窗格停靠位置：左侧 */
    msoCTPDockPositionLeft: 0,
    /** 任务窗格停靠位置：右侧 */
    msoCTPDockPositionRight: 2
};
/**
 * Excel 方向常量
 * 用于Range对象的导航和定位操作
 *
 * @constant
 * @type {Object}
 */
export const XL = {
    /** 向上定位 (xlUp) */
    UP: -4162,
    /** 向下定位 (xlDown) */
    DOWN: -4121,
    /** 向左定位 (xlToLeft) */
    TO_LEFT: -4159,
    /** 向右定位 (xlToRight) */
    TO_RIGHT: -4161,
    /** 无特殊填充 (xlNone) */
    NONE: -4142,
    /** 可见单元格类型 (xlCellTypeVisible) */
    CELL_TYPE_VISIBLE: 12
};
/**
 * Bangumi API 配置
 * 定义与Bangumi API通信的相关参数
 *
 * @constant
 * @type {Object}
 */
export const BGM_CONFIG = {
    /** Bangumi API 基础URL */
    API_BASE: "https://api.bgm.tv",
    /** 请求间隔时间（毫秒），用于防止API限流 */
    REQUEST_DELAY: 800,
    /** 失败后最大重试次数 */
    MAX_RETRIES: 3,
    /** 重试等待基础时间（毫秒），采用指数退避策略 */
    RETRY_DELAY_BASE: 2000
};
/**
 * 错误级别映射
 * 将HTTP状态码映射到错误级别
 *
 * @constant
 * @type {Record<number, number>}
 */
export const ERROR_LEVELS = {
    400: ErrorLevel.ERROR,
    401: ErrorLevel.ERROR,
    403: ErrorLevel.ERROR,
    404: ErrorLevel.WARN,
    429: ErrorLevel.ERROR,
    500: ErrorLevel.ERROR,
    502: ErrorLevel.ERROR,
    503: ErrorLevel.ERROR
};
/**
 * Excel 单元格颜色常量
 * 用于标记同步结果的可视化显示
 *
 * @constant
 * @type {Object}
 */
export const BGM_COLOR = {
    /** 浅绿色 - 同步成功 */
    SUCCESS: 0xCCFFCC,
    /** 浅红色 - 同步失败 */
    FAIL: 0xFFCCCC,
    /** 浅黄色 - 跳过 */
    SKIP: 0xFFFFCC,
    /** 紫色 - 从Bangumi同步（已收藏1次） */
    BGM_SYNC: 0x7030A0,
    /** 浅绿色 - 已同步2次 */
    LIGHT_GREEN: 0x92D050,
    /** 深绿色 - 已同步3次及以上 */
    DARK_GREEN: 0x00B050,
    /** 灰色 - 表头背景 */
    GRAY: 0xD3D3D3,
    /** 白色 - 清除标记 */
    WHITE: 0xFFFFFF
};
/**
 * 日志级别常量
 * 用于bgmLog函数控制日志输出
 *
 * @constant
 * @type {Object}
 */
export const LOG_LEVELS = {
    /** 调试级别 - 详细信息，通常用于开发调试 */
    DEBUG: 0,
    /** 信息级别 - 一般操作信息 */
    INFO: 1,
    /** 警告级别 - 潜在问题提示 */
    WARN: 2,
    /** 错误级别 - 错误信息 */
    ERROR: 3
};
/**
 * 任务面板配置
 * 定义面板扫描和显示的相关参数
 *
 * @constant
 * @type {Object}
 */
export const PANEL_CONFIG = {
    /** 表头检测的最大列数 */
    MAX_SCAN_COLUMNS: 60,
    /** 表头检测的最大行数 */
    MAX_SCAN_ROWS: 10,
    /** 预览显示的数据行数上限 */
    PREVIEW_LIMIT: 8,
    /** 筛选检测最大行数 */
    MAX_FILTER_SCAN_ROWS: 5000,
    /** 回退检测的最大行数 */
    FILTER_FALLBACK_LIMIT: 200
};
/**
 * Bangumi 条目类型映射
 * 将数字类型映射为可读文本
 *
 * @constant
 * @type {Record<number, string>}
 */
export const BGM_SUBJECT_TYPES = {
    /** 书籍 */
    1: '书籍',
    /** 动画 */
    2: '动画',
    /** 音乐 */
    3: '音乐',
    /** 游戏 */
    4: '游戏',
    /** 真人剧 */
    6: '真人剧'
};
/**
 * 同步状态常量
 * 用于标识同步操作的结果状态
 *
 * @constant
 * @type {Object}
 */
export const SYNC_STATUS = {
    /** 成功 */
    SUCCESS: '成功',
    /** 失败 */
    FAIL: '失败',
    /** 跳过 */
    SKIP: '跳过',
    /** 已收藏 */
    COLLECTED: '已收藏',
    /** 无需更新 */
    NO_UPDATE: '无需更新'
};
/**
 * 列规则配置
 * 定义各列的数据验证和转换规则
 *
 * @constant
 * @type {Array<Object>}
 */
// ✅ COLUMN_RULES 必须是数组（元素为 [正则, 映射名] 元组）
export const COLUMN_RULES = [
    [/bangumi.*url|bgm.*url|subject.*url|url.*bgm/i, "Bangumi_URL"],
    [/是否看完|观看状态/, "是否看完"],
    [/完播日|完播时间|看完时间/, "完播日"],
    [/开播日期|开播时间|首播/, "开播日期"],
    [/开播季度|季度|年份/, "开播季度"],
    [/打分|评分|分数|\brate\b/i, "打分"],
    [/感言|剧透|评价|评论|\bcomment\b/i, "剧透/感言"],
    [/标签|分级|\btag\b/i, "标签/分级"],
    [/特点|印象/, "特点/印象"],
    [/集号|看到|ep/i, "集号"],
    [/集数|总集/, "集数"],
    [/名称|标题|\bname\b|\btitle\b/i, "名称"],
    [/别名|原名|alias/i, "别名"],
    [/类别|分类|\btype\b/i, "类别"],
    [/原作标签|原作/, "原作标签"],
    [/制作公司|studio/i, "制作公司"],
    [/系列/, "系列"],
    [/季数/, "季数"],
    [/时长|分钟/, "时长"],
    [/导演|director/i, "导演"],
    [/音乐|music/i, "音乐"],
    [/序列号|序号|编号/, "序列号"],
    [/制片国家/, "制片国家"],
    [/语言/, "语言"]
];
/**
 * 列索引常量
 * 定义标准列对应的索引位置
 *
 * @constant
 * @type {Object}
 */
export const COLUMNS = {
    /** 序列号列 */
    SEQUENCE: 4, // D列 - 序号
    DEFAULT_START: 1,
    // 如果需要 NAME, URL, STATUS 也可以保留
    /** 名称列 */
    NAME: 1,
    /** URL列 */
    URL: 2,
    /** 状态列 */
    STATUS: 3
};
/**
 * 表头关键字列表
 * 用于自动识别Excel表格中的表头行
 *
 * @constant
 * @type {string[]}
 */
export const HEADER_KEYWORDS = [
    "序列号", "是否看完", "看完时间", "开播季度",
    "开播日期", "完播日", "类别", "原作标签", "制作公司",
    "标签/分级", "特点/印象", "打分", "集号", "集数",
    "名称", "别名", "剧透/感言", "感言", "备注", "评价",
    "bangumi url", "url", "制片国家", "语言", "类型",
    "导演", "音乐", "原作", "标签",
    "条目id", "sid", "状态", "status", "rate",
    "番剧", "动画", "书", "名字", "链接",
    "观看状态", "收藏类型", "章节状态", "同步状态",
    "关联的动漫", "系列", "季数", "时长"
];
/**
 * 重要列配置
 * 标记哪些列属于重要列，在预览时会高亮显示
 *
 * @constant
 * @type {Record<string, boolean>}
 */
export const IMPORTANT_COLS = {
    "名称": true,
    "bangumi url": true,
    "条目id": true,
    "sid": true,
    "url": true,
    "状态": true,
    "观看状态": true,
    "收藏类型": true,
    "是否看完": true,
    "打分": true,
    "标签": true,
    "标签/分级": true,
    "感言": true,
    "剧透/感言": true,
    "评价": true
};
/**
 * 观看状态文本到数值的映射表
 * 用于将用户友好的状态文本转换为Bangumi API所需数值
 *
 * @constant
 * @type {Record<string, number>}
 */
export const TYPE_TEXT_MAP = {
    "看过": 3, "看完": 3, "已看": 3, "完": 3, "completed": 3,
    "在看": 2, "在看动画": 2, "在追": 2, "追": 2, "watching": 2,
    "想看": 0, "想看动画": 0, "否": 0, "wish": 0,
    "搁置": 4, "暂停": 4, "on_hold": 4,
    "抛弃": 5, "弃": 5, "弃番": 5, "drop": 5, "dropped": 5,
    "1": 0, "2": 2, "3": 3, "4": 4, "5": 5,
    "true": 3, "false": 0
};
/**
 * 字段名称映射表
 * 将各种可能的列名映射到标准字段名
 *
 * @constant
 * @type {Record<string, string>}
 */
export const FIELD_NAME_MAP = {
    "名称": "name", "name": "name", "作品名": "name",
    "条目id": "subjectId", "sid": "subjectId", "id": "subjectId",
    "bangumi url": "url", "url": "url", "链接": "url",
    "状态": "type", "type": "type", "观看状态": "type", "收藏类型": "type",
    "是否看完": "watchStatus", "watchStatus": "watchStatus",
    "打分": "rate", "rate": "rate", "评分": "rate",
    "标签": "tags", "tags": "tags", "标签/分级": "tags",
    "评价": "comment", "comment": "comment", "感言": "comment", "剧透/感言": "comment",
    "完播日": "finishedDate", "完播日期": "finishedDate", "看完时间": "finishedDate",
    "开播日期": "airDate", "开播时间": "airDate",
    "别名": "alias", "alias": "alias",
    "季数": "season", "season": "season",
    "集数": "episode", "episode": "episode", "集号": "episode",
    "时长": "duration",
    "类型": "subjectType", "subjectType": "subjectType",
    "番剧": "subjectType", "动画": "subjectType",
    "备注": "notes", "notes": "notes"
};
/**
 * URL匹配模式
 * 用于从各种格式的URL中提取Bangumi Subject ID
 *
 * @constant
 * @type {RegExp[]}
 */
export const URL_PATTERNS = [
    /bgm\.tv\/subject\/(\d+)/i,
    /bangumi\.tv\/subject\/(\d+)/i,
    /chii\.in\/subject\/(\d+)/i
];
/**
 * Token加密配置
 * 定义Token加密和解密的相关参数
 *
 * @constant
 * @type {Object}
 */
export const TOKEN_CONFIG = {
    /** Token版本标识 */
    VERSION: "1",
    /** XOR加密密钥 */
    XOR_KEY: "bgmtoken_secret_key_2024"
};
/**
 * 观看状态文本到数值的反向映射（用于快速精确匹配）
 * 键：常见状态文本（小写），值：Bangumi 状态码 (1-5)
 */
export const WATCH_STATUS_MAP = {
    "看过": 3, "看完": 3, "已看": 3, "完": 3, "completed": 3, "3": 3,
    "在看": 2, "看动画": 2, "在追": 2, "追": 2, "watching": 2, "2": 2,
    "想看": 0, "想看动画": 0, "否": 0, "wish": 0, "1": 0,
    "搁置": 4, "暂停": 4, "停": 4, "on_hold": 4, "4": 4,
    "抛弃": 5, "弃": 5, "弃番": 5, "drop": 5, "dropped": 5, "5": 5
};
