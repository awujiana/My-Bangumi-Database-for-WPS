/**
 * @fileoverview 通用清理功能 · 规则配置层（纯数据，不含任何页面逻辑）
 * @module panel/cleanRules
 * @description
 * 本文件是「清理规则」与「页面展示」分离的关键：
 *
 *   clean-rules.ts（本文件，配置）  →  clean-engine.ts（执行）  →  clean-page.ts（展示）
 *
 * - **新增清理项**：只需在 {@link CLEAN_RULES} 数组追加一条配置，页面勾选列表、
 *   预览统计、执行流程全部自动生效，**无需改动页面逻辑**（除非引入全新 kind）。
 * - **清理目标与排除规则**：集中在 {@link CLEAN_TARGETS} / {@link CLEAN_EXCLUDES}，
 *   页面只负责读取展示，不硬编码任何具体路径或工作表名。
 * - **可复用规则常量**（噪声标签、原作标签归一化）移植自 Python 侧 clean 子项目：
 *   - `clean/rules_loader.py` 的 `load_tag_filters()` 默认 `noise_tags` / `noise_tag_patterns`
 *   - `clean/config/tag_normalize_rules.yaml` 的 `countries` / `type_mappings` /
 *     `base_gai_types` / `priority_rules` / `special_cases`
 */
/** 生效的清理目标配置（页面只读展示，不写死路径） */
export const CLEAN_TARGETS = {
    includeWorkbookPath: [],
    // WPS 临时锁文件（~$ 开头）与加载项自身目录不参与清理
    excludeWorkbookPath: ['~$', '/dist/', '/dist-ts/', '/node_modules/'],
    includeSheetName: [],
    // 命中任一即视为 Bangumi 数据表：有「名称」列，或有「Bangumi_URL」列（两者都有更好）
    identityColumns: ['名称', 'Bangumi_URL'],
    maxDataRows: 50_000,
};
/** 生效的排除规则配置 */
export const CLEAN_EXCLUDES = {
    // 记录表 / 日志表不参与数据清理
    sheetName: ['同步记录', '富化记录', '日志', 'Log'],
    // 汇总行、说明行、模板示例行不清理（保护语义）
    rowText: ['合计', '小计', '总计', '示例', '新番表 by Hazx', '版权平台标注'],
    // 与 rowText 同词表，但语义为「整行删除」：由 noise-rows 规则执行。
    // 注意：noiseRows 扫描刻意**不遵守** excludedRows，否则这些行会先被 rowText 保护而永远删不掉。
    noiseRowText: ['合计', '小计', '总计', '示例', '新番表 by Hazx', '版权平台标注'],
    minDataRows: 1,
    rowScanColumns: 30,
};
/** 生效的新番表表头识别配置 */
export const XINFAN_HEADER = {
    headerKeywords: ['周更时间', '播放平台', 'TAGS', '集数', '首播', '独播', '特殊'],
    minHeaderHits: 2,
    nameAnchorKeyword: '周更时间',
    tagHeaderKeywords: ['TAGS', '标签', 'tags'],
    nameProbeRows: 30,
};
// ========== 可复用规则常量（移植自 clean/ 子项目） ==========
/**
 * 噪声标签词表。
 * 来源：`clean/rules_loader.py` → `load_tag_filters()` 的 `noise_tags` 默认值。
 * 命中即整项移除（全等匹配，非子串）。
 */
export const NOISE_TAGS = [
    // 档期 / 进度状态
    '待定档',
    '待定',
    '未定档',
    '未确定',
    '待上映',
    '未上映',
    '未开播',
    '待播',
    '预定',
    '预告',
    'PV',
    '时间',
    '未完结',
    '连载中',
    '制作中',
    '放送中',
    '放送暂停',
    '暂无',
    '未放送',
    // 媒介 / 形式（已由「播出方式」「原作标签」等列承载）
    '游戏改',
    '日本动画',
    '动画',
    'アニメ',
    'anime',
    'TVA',
    'TV动画',
    'TV版',
    // 主观评价
    '童年',
    '补番',
    '神作',
    '经典',
    '追番',
    '有生之年',
    '弃番',
    '良作',
    '佳作',
    '口碑',
    '推荐',
    '已看',
    '看过',
    '在看',
    '想看',
    // 播放平台（已由「在线播放平台」列承载）
    'Netflix',
    'netflix',
    'Amazon',
    'Hulu',
    'Disney',
    'CR',
    'Crunchyroll',
    'Bilibili',
    'bilibili',
    'B站',
    '爱奇艺',
    '优酷',
    '腾讯视频',
    '芒果TV',
];
/**
 * 噪声标签正则（整项匹配）。
 * 来源：`clean/rules_loader.py` → `noise_tag_patterns`（纯年份 / 年月类标签）。
 */
export const NOISE_TAG_PATTERNS = [
    /^\d{4}$/u,
    /^\d{4}年$/u,
    /^\d{4}年\d{1,2}月$/u,
    /^\d{4}\.\d{1,2}$/u,
    /^\d{4}-\d{1,2}$/u,
];
/** 生效的原作标签归一化规则 */
export const ORIGINAL_TAG_RULES = {
    countries: [
        '日本',
        '中国',
        '美国',
        '英国',
        '韩国',
        '法国',
        '德国',
        '意大利',
        '西班牙',
        '俄罗斯',
        '加拿大',
        '澳大利亚',
        '印度',
        '泰国',
        '台湾',
        '香港',
        '巴西',
        '墨西哥',
    ],
    typeMappings: {
        漫改: '漫画改',
        漫画改: '漫画改',
        游改: '游戏改',
        游戏改: '游戏改',
        GAL改: 'GAL改',
        轻改: '轻小说改',
        轻小说改: '轻小说改',
        日轻: '轻小说改',
        小说改: '小说改',
        手游改: '手游改',
        网文改: '网文改',
        宅文改: '宅文改',
        原创: '原创',
        漫画: '漫画改',
        小说: '小说改',
        游戏: '游戏改',
        网文: '网文改',
    },
    baseGaiTypes: ['漫画改', '游戏改', '轻小说改', '小说改', '手游改', '网文改', '宅文改', 'GAL改'],
    priorityRules: [
        { higher: '手游改', lower: '游戏改' },
        { higher: '轻小说改', lower: '小说改' },
        { higher: 'GAL改', lower: '游戏改' },
    ],
    specialCases: [
        { country: '中国', types: ['网文改'], output: '中国网文改' },
        { country: '中国', types: ['网文改', '宅文改'], output: '中国宅文改' },
    ],
};
/** 类别列数字前缀（`12|TV` → `TV`），来源：`clean/clean_stages.py` 的 clean_category_column */
export const CATEGORY_NUMBER_PREFIX_RE = /^\d+\|/u;
/** 行字节数估算的采样行数上限（避免整表读取卡死 WPS） */
export const ROW_BYTES_SAMPLE_LIMIT = 30;
/** 采样失败时使用的单行兜底字节数 */
export const ROW_BYTES_FALLBACK = 96;
/**
 * 清理项清单。**新增清理项只需在此追加一条**，
 * 页面勾选列表、执行前预览、执行与日志均自动适配。
 */
export const CLEAN_RULES = [
    // ── 重复数据 ──
    {
        id: 'dup-name',
        name: '重复名称行',
        desc: '按「名称」分组，保留含 Bangumi_URL 的行，把被删行的标签合并进保留行后删除重复行。',
        group: '重复数据',
        icon: '🧬',
        kind: 'duplicateNameRows',
        risk: 'medium',
        defaultOn: true,
    },
    {
        id: 'dup-url',
        name: '同 URL 重复行',
        desc: '同一 Bangumi_URL 出现在多行（含跨名称）时，保留行号最大的一行，合并标签后删除其余行。',
        group: '重复数据',
        icon: '🔗',
        kind: 'duplicateUrlRows',
        risk: 'medium',
        defaultOn: true,
    },
    {
        id: 'empty-name',
        name: '空白数据行',
        desc: '删除数据区内部的空白行（名称为空且其余列均无数据）。行号会上移，默认关闭。',
        group: '重复数据',
        icon: '🕳️',
        kind: 'emptyNameRows',
        risk: 'medium',
        defaultOn: false,
    },
    {
        id: 'noise-rows',
        name: '噪声行（水印 / 汇总 / 说明）',
        desc: '整行删除命中噪声词表的行：合计、小计、总计、示例、「新番表 by Hazx」水印行、版权平台标注。',
        group: '重复数据',
        icon: '🚫',
        kind: 'noiseRows',
        risk: 'high',
        defaultOn: true,
    },
    // ── 单元格清洗 ──
    {
        id: 'noise-tags',
        name: '噪声标签',
        desc: '移除「标签/分级」列中的平台 / 状态 / 主观类噪声标签（B站、已看、待定档…）。',
        group: '单元格清洗',
        icon: '🧹',
        kind: 'cellTransform',
        transform: 'stripNoiseTags',
        columns: ['标签/分级'],
        risk: 'low',
        defaultOn: true,
    },
    {
        id: 'tag-format',
        name: '标签格式统一',
        desc: '把「标签/分级」的分隔符统一为 " | "，并移除重复标签。',
        group: '单元格清洗',
        icon: '📐',
        kind: 'cellTransform',
        transform: 'normalizeTagSeparator',
        columns: ['标签/分级'],
        risk: 'low',
        defaultOn: true,
    },
    {
        id: 'category-prefix',
        name: '类别数字前缀',
        desc: '去除「类别」列的 "数字|" 前缀（如 12|TV → TV）。',
        group: '单元格清洗',
        icon: '🔢',
        kind: 'cellTransform',
        transform: 'stripCategoryNumberPrefix',
        columns: ['类别'],
        risk: 'low',
        defaultOn: true,
    },
    {
        id: 'alias-dedup',
        name: '别名重复项',
        desc: '移除「别名」列中与「名称」重复的条目，并去除重复别名。',
        group: '单元格清洗',
        icon: '🏷️',
        kind: 'cellTransform',
        transform: 'dedupAliasAgainstName',
        columns: ['别名'],
        risk: 'low',
        defaultOn: true,
    },
    {
        id: 'original-tag',
        name: '原作标签归一化',
        desc: '统一「原作标签」列的变体（漫改→漫画改）并按优先级去重（轻小说改 > 小说改）。',
        group: '单元格清洗',
        icon: '🌱',
        kind: 'cellTransform',
        transform: 'normalizeOriginalTag',
        columns: ['原作标签'],
        risk: 'medium',
        defaultOn: false,
    },
];
/** 按 id 查找清理规则 */
export function findCleanRule(id) {
    return CLEAN_RULES.find((rule) => rule.id === id);
}
/** 风险等级 → 展示文案 */
export const RISK_LABELS = {
    low: '低风险',
    medium: '中风险',
    high: '高风险',
};
