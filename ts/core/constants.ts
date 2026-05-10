/**
 * BGM 项目常量定义
 * @module constants
 * @description 统一定义所有常量，避免分散定义导致的不一致
 *              所有其他模块应从此模块导入常量，而非自行定义
 */



// ========== 错误级别枚举 ==========
export const ErrorLevel = {
    SILENT: 0,
    WARN: 1,
    ERROR: 2,
    THROW: 3
} as const;
export type ErrorLevel = typeof ErrorLevel[keyof typeof ErrorLevel];


// ========== 错误处理选项 ==========
export interface ErrorOptions {
    /** 错误级别（0=SILENT, 1=WARN, 2=ERROR, 3=THROW） */
    level?: ErrorLevel;
    /** 是否显示错误对话框 */
    showAlert?: boolean;
    /** 错误上下文描述 */
    context?: string;
}



// ========== WPS Office 枚举 ==========
export const WPS_ENUM = {
  msoCTPDockPositionLeft: 0,
  msoCTPDockPositionRight: 2
};

// ========== Excel 方向常量 ==========
export const XL = {
  UP: -4162,           // xlUp - 向上查找
  DOWN: -4121,         // xlDown - 向下查找
  TO_LEFT: -4159,      // xlToLeft - 向左查找
  TO_RIGHT: -4161,     // xlToRight - 向右查找
  NONE: -4142,         // xlNone - 无填充
  CELL_TYPE_VISIBLE: 12 // xlCellTypeVisible - 可见单元格
};

// ========== BGM API 配置 ==========
export const BGM_CONFIG = {
  API_BASE: "https://api.bgm.tv",
  REQUEST_DELAY: 800,
  MAX_RETRIES: 3,
  RETRY_DELAY_BASE: 2000
};

// ========== Excel 颜色常量 ==========
export const BGM_COLOR = {
  SUCCESS: 0xCCFFCC,     // 上传成功 - 绿
  FAIL: 0xFFCCCC,        // 上传失败 - 红
  SKIP: 0xFFFFCC,        // 跳过 - 黄
  BGM_SYNC: 0x7030A0,    // 从BGM同步标记 - 紫
  LIGHT_GREEN: 0x92D050, // 已同步一次标记 - 浅绿
  DARK_GREEN: 0x00B050,  // 已同步多次标记 - 深绿
  GRAY: 0xD3D3D3,        // 表头灰色
  WHITE: 0xFFFFFF,       // 白色（清除标记）
};

// ========== Token 加密配置 ==========
export const TOKEN_CONFIG = {
  // AES 密钥（32字节 = 256位）
  KEY_BYTES: [
    0x42, 0x47, 0x4D, 0x5F, 0x54, 0x4F, 0x4B, 0x45,
    0x4E, 0x5F, 0x53, 0x45, 0x43, 0x55, 0x52, 0x45,
    0x5F, 0x4B, 0x45, 0x59, 0x5F, 0x32, 0x30, 0x32,
    0x34, 0x5F, 0x41, 0x45, 0x53, 0x5F, 0x32, 0x35
  ],
  VERSION: "BGM2:",
  // 备用 XOR 密钥（当 Web Crypto 不可用时使用）
  FALLBACK_KEYS: [0x5A, 0xA5, 0x7F, 0xF2, 0x3C, 0xC3, 0x1E, 0xE1]
};

// ========== 日志级别 ==========
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// ========== 错误级别 ==========
export const ERROR_LEVELS = {
  SILENT: 0,    // 静默处理
  WARN: 1,      // 警告
  ERROR: 2,     // 错误
  THROW: 3      // 抛出异常
};

// ========== 任务面板配置 ==========
export const PANEL_CONFIG = {
  /** 表头/数据扫描的最大列数 */
  MAX_SCAN_COLUMNS: 60,
  /** 表头检测的最大扫描行数 */
  MAX_SCAN_ROWS: 10,
  /** 预览显示的数据行数上限 */
  PREVIEW_LIMIT: 8,
  /** 筛选检测最大行数（SpecialCells 可用时） */
  MAX_FILTER_SCAN_ROWS: 5000,
  /** 回退方式（逐行 Hidden 检查）的最大行数 */
  FILTER_FALLBACK_LIMIT: 200,
};

// ========== BGM 条目类型 ==========
export const BGM_SUBJECT_TYPES: { [key: number]: string } = {
  1: "书籍",
  2: "动画",
  3: "音乐",
  4: "游戏",
  6: "真人剧"
};

// ========== 同步记录状态 ==========
export const SYNC_STATUS = {
  SUCCESS: "成功",
  FAIL: "失败",
  SKIP: "跳过",
  COLLECTED: "已收藏"
};

// 定义匹配规则数组（按优先级顺序）
export const COLUMN_RULES: [RegExp, string][] = [
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



// ========== 常量定义 ==========
export const COLUMNS = {
  SEQUENCE: 4,      // D列 - 序号
  DEFAULT_START: 1
};

export const WATCH_STATUS_MAP: { [key: string]: number } = {
  "看过": 3, "看完": 3, "已看": 3, "完": 3, "completed": 3, "3": 3,
  "在看": 2, "在看动画": 2, "在追": 2, "追": 2, "watching": 2, "2": 2,
  "想看": 0, "想看动画": 0, "否": 0, "wish": 0, "1": 0,
  "搁置": 4, "暂停": 4, "停": 4, "on_hold": 4, "4": 4,
  "抛弃": 5, "弃": 5, "弃番": 5, "drop": 5, "dropped": 5, "5": 5
};

export const TYPE_TEXT_MAP: { [key: number]: string } = {1: "想看", 2: "在看", 3: "看过", 4: "搁置", 5: "抛弃"};

export const URL_PATTERNS = [
  /bgm\.tv\/subject\/(\d+)/i,
  /bangumi\.tv\/subject\/(\d+)/i,
  /chii\.in\/subject\/(\d+)/i,
  /(\d{6,})/
];

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

export const IMPORTANT_COLS: { [key: string]: boolean } = {
  "名称": true, "是否看完": true, "bangumi url": true,
  "url": true, "打分": true, "集数": true, "感言": true,
  "剧透/感言": true, "类型": true, "状态": true,
  "status": true, "rate": true, "别名": true
};

export const FIELD_NAME_MAP: { [key: string]: string } = {
  "名称": "name", "name": "name", "作品名": "name", "条目": "name", "标题": "name",
  "条目id": "subjectId", "sid": "subjectId", "subject_id": "subjectId", "id": "subjectId",
  "bangumi url": "url", "url": "url", "链接": "url", "地址": "url",
  "状态": "type", "type": "type", "观看状态": "type", "收藏类型": "type",
  "是否看完": "watchStatus",
  "评分": "rate", "rate": "rate", "分数": "rate", "rating": "rate", "打分": "rate",
  "标签": "tags", "tags": "tags", "tag": "tags", "标签/分级": "tags",
  "评价": "comment", "comment": "comment", "备注": "comment", "notes": "comment",
  "剧透/感言": "comment", "感言": "comment",
  "完播日": "finishedDate", "完播日期": "finishedDate", "看完时间": "finishedDate",
  "finished": "finishedDate", "日期": "finishedDate",
  "章节状态": "epStatus", "ep_status": "epStatus", "集数": "epStatus",
  "同步状态": "syncStatus", "sync_status": "syncStatus",
  "开播季度": "startSeason", "开播日期": "startDate",
  "别名": "alias", "类别": "category", "制作公司": "studio",
  "原作标签": "originalTag", "特点/印象": "impression",
  "集号": "epNum", "系列": "series", "季数": "season",
  "时长": "duration", "导演": "director", "音乐": "music",
  "制片国家": "country", "序列号": "sequence"
};