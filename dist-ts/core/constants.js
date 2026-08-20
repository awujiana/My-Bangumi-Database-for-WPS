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
export const ErrorLevel = {
    SILENT: 0,
    WARN: 1,
    ERROR: 2,
    THROW: 3,
    INFO: 4,
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
    msoCTPDockPositionRight: 2,
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
    CELL_TYPE_VISIBLE: 12,
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
    API_BASE: 'https://api.bgm.tv',
    /** 请求间隔时间（毫秒），用于防止API限流 */
    REQUEST_DELAY: 800,
    /** 失败后最大重试次数 */
    MAX_RETRIES: 3,
    /** 重试等待基础时间（毫秒），采用指数退避策略 */
    RETRY_DELAY_BASE: 2000,
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
    503: ErrorLevel.ERROR,
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
    SUCCESS: 0xccffcc,
    /** 浅红色 - 同步失败 */
    FAIL: 0xffcccc,
    /** 浅黄色 - 跳过 */
    SKIP: 0xffffcc,
    /** 紫色 - 从Bangumi同步（已收藏1次） */
    BGM_SYNC: 0x7030a0,
    /** 浅绿色 - 已同步2次 */
    LIGHT_GREEN: 0x92d050,
    /** 深绿色 - 已同步3次及以上 */
    DARK_GREEN: 0x00b050,
    /** 灰色 - 表头背景 */
    GRAY: 0xd3d3d3,
    /** 白色 - 清除标记 */
    WHITE: 0xffffff,
    /** 粉色 - 想看状态 */
    WISH: 0xffcce5,
    /** 蓝色 - 在看状态 */
    WATCHING: 0xcce5ff,
};
/**
 * 日志级别常量
 * 用于bgmLog函数控制日志输出
 *
 * @constant
 * @type {Object}
 */
export const LOG_LEVELS = {
    /** 信息级别 - 一般操作信息 */
    INFO: 1,
    /** 警告级别 - 潜在问题提示 */
    WARN: 2,
    /** 错误级别 - 错误信息 */
    ERROR: 3,
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
    PREVIEW_LIMIT: 200,
    /** 筛选检测最大行数 */
    MAX_FILTER_SCAN_ROWS: 5000,
    /** 回退检测的最大行数 */
    FILTER_FALLBACK_LIMIT: 200,
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
    6: '真人剧',
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
    NO_UPDATE: '无需更新',
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
export const COLUMN_RULES = [
    // ── URL / ID ──
    [/bangumi.*url|bgm.*url|subject.*url|url.*bgm/i, 'Bangumi_URL'],
    [/关联的动漫ID|关联动漫|关联id|related.*id/i, '关联的动漫ID'],
    // ── 状态/日期 ──
    [/是否看完|观看状态|状态/, '是否看完'],
    [/看完时间/, '看完时间'],
    [/完播日|完播时间|播放结束|结束日期|结束日|完结日|完结时间/, '完播日'],
    [/开播日期|开播时间|首播/, '开播日期'],
    [/开播季度|季度|年份/, '开播季度'],
    [/播出方式/, '播出方式'],
    // ── 评分/标记 ──
    [/打分|评分|分数|\brate\b/i, '打分'],
    [/感言|剧透|评价|评论|\bcomment\b/i, '剧透/感言'],
    // 原作标签 必须在 标签/分级 之前匹配，避免 "标签" 分支误匹配 "原作标签"
    [/原作标签/, '原作标签'],
    [/标签\/分级|标签|分级|\btag\b/i, '标签/分级'],
    [/特点\/印象|特点|印象/, '特点/印象'],
    // ── 制作人员(精确匹配优先)──
    [/人物设定|人设|角色设计/, '人物设定'],
    [/机械设定|机设/, '机械设定'],
    [/原案/, '原案'],
    [/系列构成/, '系列构成'],
    [/系列集数/, '系列集数'],
    [/系列/, '系列'],
    [/集数|总集/, '集数'],
    [/集号|看到|ep/i, '集号'],
    [/季数/, '季数'],
    [/时长\/分钟|时长|分钟/, '时长'],
    [/原作(?!标签)/, '原作'],
    // ── 名称 ──
    [/名称|标题|\bname\b|\btitle\b/i, '名称'],
    [/别名|原名|alias/i, '别名'],
    // ── 分类 ──
    [/类别|分类|\btype\b/i, '类别'],
    [/类型/, '类型'],
    // ── 制作人员(续)──
    [/动画制作公司/, '动画制作公司'],
    [/制作公司|studio/i, '制作公司'],
    [/导演|director/i, '导演'],
    [/音乐|music/i, '音乐'],
    [/脚本|编剧|剧本/, '脚本'],
    [/分镜/, '分镜'],
    [/演出/, '演出'],
    // ── 地点/平台 ──
    [/电影院|影院/, '电影院'],
    [/影厅/, '影厅'],
    [/电影票存根|票根/, '电影票存根'],
    [/制片国家|国家/, '制片国家'],
    [/语言/, '语言'],
    [/在线播放平台|播放平台/, '在线播放平台'],
    // ── 其他 ──
    [/序列号|序号|编号/, '序列号'],
];
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
export const COLUMNS = {
    /** 序列号列 - 第9列（I列），用于排序和行标识 */
    SEQUENCE: 9,
    DEFAULT_START: 1,
    /** 名称列 - 第1列（A列），条目名称 */
    NAME: 1,
    /** URL列 - 第2列（B列），Bangumi 主题页链接 */
    URL: 2,
    /** 状态列 - 第3列（C列），观看/阅读状态 */
    STATUS: 3,
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
export const HEADER_KEYWORDS = [
    '序列号',
    '是否看完',
    '看完时间',
    '开播季度',
    '开播日期',
    '完播日',
    '类别',
    '原作标签',
    '制作公司',
    '标签/分级',
    '特点/印象',
    '打分',
    '集号',
    '集数',
    '名称',
    '别名',
    '剧透/感言',
    '感言',
    '备注',
    '评价',
    'bangumi url',
    'url',
    '制片国家',
    '语言',
    '类型',
    '导演',
    '音乐',
    '原作',
    '标签',
    '条目id',
    'sid',
    '状态',
    'status',
    'rate',
    '番剧',
    '动画',
    '书',
    '名字',
    '链接',
    '观看状态',
    '收藏类型',
    '章节状态',
    '同步状态',
    '关联的动漫',
    '系列',
    '季数',
    '时长',
    '播出方式',
    '系列集数',
    '系列构成',
    '人物设定',
    '机械设定',
    '脚本',
    '分镜',
    '演出',
    '原案',
    '电影院',
    '影厅',
    '电影票存根',
    '在线播放平台',
    '关联的动漫ID',
];
/**
 * 标准表头列表（37 列）
 *
 * 当工作表为空（无表头行）时，按此顺序在第 1 行写入表头。
 * 列顺序与用户模板一致，getColumnMap() 会通过 COLUMN_RULES 自动映射。
 *
 * @constant
 */
export const STANDARD_HEADERS = [
    '序列号',
    '是否看完',
    '看完时间',
    '开播季度',
    '开播日期',
    '完播日',
    '类别',
    '原作标签',
    '制作公司',
    '标签/分级',
    '特点/印象',
    '打分',
    '集号',
    '集数',
    '系列',
    '季数',
    '系列集数',
    '时长/分钟',
    '名称',
    '别名',
    '电影院',
    '影厅',
    '电影票存根',
    '剧透/感言',
    'Bangumi URL',
    '制片国家',
    '语言',
    '类型',
    '导演',
    '音乐',
    '人物设定',
    '机械设定',
    '原作',
    '脚本',
    '分镜',
    '演出',
    '原案',
    '系列构成',
    '关联的动漫ID',
];
/**
 * 重要列配置
 * 标记哪些列在数据预览中需要高亮显示
 * 键为标准字段名，值为布尔标记
 *
 * @constant
 * @type {Record<string, boolean>}
 */
export const IMPORTANT_COLS = {
    名称: true,
    'bangumi url': true,
    条目id: true,
    sid: true,
    url: true,
    状态: true,
    观看状态: true,
    收藏类型: true,
    是否看完: true,
    打分: true,
    标签: true,
    '标签/分级': true,
    感言: true,
    '剧透/感言': true,
    评价: true,
};
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
export const FIELD_NAME_MAP = {
    名称: 'name',
    name: 'name',
    作品名: 'name',
    条目id: 'subjectId',
    sid: 'subjectId',
    id: 'subjectId',
    'bangumi url': 'url',
    url: 'url',
    链接: 'url',
    状态: 'type',
    type: 'type',
    观看状态: 'type',
    收藏类型: 'type',
    是否看完: 'watchStatus',
    watchStatus: 'watchStatus',
    打分: 'rate',
    rate: 'rate',
    评分: 'rate',
    标签: 'tags',
    tags: 'tags',
    '标签/分级': 'tags',
    评价: 'comment',
    comment: 'comment',
    感言: 'comment',
    '剧透/感言': 'comment',
    完播日: 'finishedDate',
    完播日期: 'finishedDate',
    开播日期: 'airDate',
    开播时间: 'airDate',
    别名: 'alias',
    alias: 'alias',
    季数: 'season',
    season: 'season',
    集数: 'episode',
    episode: 'episode',
    集号: 'episode',
    时长: 'duration',
    类型: 'subjectType',
    subjectType: 'subjectType',
    番剧: 'subjectType',
    动画: 'subjectType',
    备注: 'notes',
    notes: 'notes',
};
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
export const URL_PATTERNS = [
    /bgm\.tv\/subject\/(\d+)/i,
    /bangumi\.tv\/subject\/(\d+)/i,
    /chii\.in\/subject\/(\d+)/i,
];
/**
 * Token 版本配置（仅用于识别历史 XOR 加密数据）
 *
 * 当前 Token 已改为明文存储，XOR 加密仅保留用于读取历史数据并自动升级。
 * XOR_KEY 不再全局暴露，仅在 core/crypto.ts 内部保留以兼容旧数据。
 */
export const TOKEN_CONFIG = {
    /** Token版本标识，用于识别历史 XOR 加密数据 */
    VERSION: '1',
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
export const WATCH_STATUS_MAP = {
    /** 想看 (1) - 包含"否"和"false"是因为在Excel模板中"是否看完"为"否" */
    想看: 1,
    想看动画: 1,
    否: 1,
    wish: 1,
    '1': 1,
    false: 1,
    /** 看过 (2) - 包含"是"和"true"是"是否看完"列的肯定标记 */
    看过: 2,
    看完: 2,
    已看: 2,
    完: 2,
    completed: 2,
    '2': 2,
    是: 2,
    true: 2,
    /** 在看 (3) */
    在看: 3,
    看动画: 3,
    在看动画: 3,
    在追: 3,
    追: 3,
    watching: 3,
    '3': 3,
    /** 搁置 (4) */
    搁置: 4,
    暂停: 4,
    停: 4,
    on_hold: 4,
    '4': 4,
    /** 抛弃 (5) */
    抛弃: 5,
    弃: 5,
    弃番: 5,
    drop: 5,
    dropped: 5,
    '5': 5,
    /** 忽略 (0) - 跳过不处理 */
    忽略: 0,
    ignore: 0,
    skip: 0,
};
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
export const COLLECTION_TYPE_NAMES = ['', '想看', '看过', '在看', '搁置', '抛弃'];
/**
 * 同步记录工作表名称
 * 在工作簿中创建"同步记录"工作表来存储同步操作的历史记录
 *
 * @constant
 * @type {string}
 */
export const SYNC_RECORD_SHEET_NAME = '同步记录';
/**
 * 同步记录表列名定义
 * 按顺序排列的12列：
 * SID(1) → 同步时间(2) → 名称(3) → URL(4) → 条目类型(5) → 来源(6)
 * → 次数(7) → 内容(8) → 状态(9) → 收藏状态(10) → 备注(11) → 数据指纹(12)
 *
 * @constant
 * @type {string[]}
 */
export const SYNC_RECORD_COLUMNS = [
    'SID',
    '同步时间',
    '名称',
    'URL',
    '条目类型',
    '来源',
    '次数',
    '内容',
    '状态',
    '收藏状态',
    '备注',
    '数据指纹',
];
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
export const SYNC_RECORD_COL = {
    SID: 1,
    TIME: 2,
    NAME: 3,
    URL: 4,
    TYPE: 5,
    SOURCE: 6,
    COUNT: 7,
    CONTENT: 8,
    STATUS: 9,
    COLL_TYPE: 10,
    MESSAGE: 11,
    FINGERPRINT: 12,
};
/**
 * 同步记录类型颜色映射表
 * 根据收藏状态（想看/在看/看过/搁置/抛弃）显示对应颜色
 * 用于在同步记录表中直观区分不同的收藏状态
 *
 * @constant
 * @type {Record<string, number>}
 */
export const SYNC_RECORD_TYPE_COLOR = {
    想看: BGM_COLOR.WISH,
    在看: BGM_COLOR.WATCHING,
    看过: BGM_COLOR.SUCCESS,
    搁置: BGM_COLOR.SKIP,
    抛弃: BGM_COLOR.FAIL,
};
