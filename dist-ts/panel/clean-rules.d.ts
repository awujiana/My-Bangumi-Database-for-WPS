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
/** 清理风险等级：页面据此渲染徽标，并作为二次确认的提示强度依据 */
export type CleanRisk = 'low' | 'medium' | 'high';
/**
 * 清理项种类：引擎按 kind 分派到对应扫描执行器。
 * 只有引入「全新种类」才需要改引擎；新增同类清理项只改配置。
 */
export type CleanKind = 
/** 按「名称」分组的重复行（保留含 URL 行、合并标签、删除无 URL 重复行） */
'duplicateNameRows'
/** 同一 URL 跨名称的重复行（保留最新行、合并标签） */
 | 'duplicateUrlRows'
/** 名称为空的残留行 */
 | 'emptyNameRows'
/** 噪声行（水印 / 汇总 / 说明行，按关键词整行删除） */
 | 'noiseRows'
/** 单元格值变换（具体算法由 transform 指定） */
 | 'cellTransform';
/** 单元格变换 ID：与 clean-transforms.ts 的纯函数一一对应 */
export type CellTransformId = 
/** 移除噪声标签 */
'stripNoiseTags'
/** 统一 `|` 分隔为 ` | ` 并去重重复标签 */
 | 'normalizeTagSeparator'
/** 去除类别列的 `数字|` 前缀 */
 | 'stripCategoryNumberPrefix'
/** 移除与「名称」重复的别名并去重 */
 | 'dedupAliasAgainstName'
/** 原作标签归一化（变体统一 + 优先级去重） */
 | 'normalizeOriginalTag';
/**
 * 清理目标配置。
 *
 * 所有路径 / 表名判定都在这里，页面与引擎只读取：
 * - `includeWorkbookPath` 为空表示「不限制工作簿」；
 * - `excludeWorkbookPath` 优先级高于 include（用于排除临时文件 / 加载项目录）。
 */
export interface CleanTargetConfig {
    /** 仅处理全路径包含任一关键词的工作簿；空数组 = 不限制 */
    includeWorkbookPath: string[];
    /** 全路径包含任一关键词的工作簿直接跳过（优先于 include） */
    excludeWorkbookPath: string[];
    /** 仅处理表名包含任一关键词的工作表；空数组 = 按表头自动识别 */
    includeSheetName: string[];
    /**
     * 判定「Bangumi 数据表」的特征列（取自 `getColumnMap()` 的归一化列键）：
     * **命中任一即视为 Bangumi 数据表**。
     *
     * 判定宽松是有意的：同一份数据在不同工作簿里列名并不统一（如「剧集名 / 小说名」
     * 不会归一化成「名称」），但只要有表头行 + Bangumi_URL 列，它就是可清理的
     * Bangumi 数据表；缺列的规则会在扫描时自行跳过并在预览中说明原因。
     */
    identityColumns: string[];
    /** 单表最多扫描的数据行数（防御超大数据表把 WPS 卡死） */
    maxDataRows: number;
}
/** 排除规则配置：命中任一条即跳过对应表 / 行 */
export interface CleanExcludeConfig {
    /** 表名包含任一关键词即整表跳过 */
    sheetName: string[];
    /** 行内任一单元格文本包含这些关键词 → 该行不参与清理（保护汇总行 / 说明行） */
    rowText: string[];
    /** 行内任一单元格文本包含这些关键词 → 由 `noiseRows` 规则整行**删除**（水印 / 汇总 / 说明行） */
    noiseRowText: string[];
    /** 数据行数少于该值的表跳过 */
    minDataRows: number;
    /** 行文本排除判定时读取的最大列数 */
    rowScanColumns: number;
}
/** 生效的清理目标配置（页面只读展示，不写死路径） */
export declare const CLEAN_TARGETS: CleanTargetConfig;
/** 生效的排除规则配置 */
export declare const CLEAN_EXCLUDES: CleanExcludeConfig;
/**
 * 新番表表头识别配置。
 *
 * 新番表是「月历式」布局，与 Bangumi 归档表结构完全不同：
 * ```
 *   A   B        C(番剧名)  D(周更时间) E(时间)  F(播放平台) … J(独播) K(首播) L(集数) M(特殊) N(TAGS)
 *  (空) (空)     (空)       周更时间    (空)     播放平台       独播    首播     集数     特殊     TAGS
 *               淫狱团地     周一      00:10                            4.6     12     多版本…  搞笑 / 抽象
 * ```
 * 特征：① 表头行**没有「名称」列**（番剧名列 C 表头为空）；
 *      ② 表名 / 表头命中「周更时间 / 播放平台 / TAGS」等专属列。
 * 因此不能套用「必须有名称列」的门槛，需要独立签名识别。
 */
export interface XinFanHeaderConfig {
    /** 新番表专属表头关键词（大小写不敏感） */
    headerKeywords: string[];
    /** 表头行至少命中多少个专属关键词才判定为新番表 */
    minHeaderHits: number;
    /** 名称列锚点：名称列位于该列左侧（空表头且数据区有值的最近一列） */
    nameAnchorKeyword: string;
    /** TAGS 列的候选表头名（映射为「标签/分级」以复用现有标签规则） */
    tagHeaderKeywords: string[];
    /** 名称列探测时扫描的数据行数上限 */
    nameProbeRows: number;
}
/** 生效的新番表表头识别配置 */
export declare const XINFAN_HEADER: XinFanHeaderConfig;
/**
 * 噪声标签词表。
 * 来源：`clean/rules_loader.py` → `load_tag_filters()` 的 `noise_tags` 默认值。
 * 命中即整项移除（全等匹配，非子串）。
 */
export declare const NOISE_TAGS: readonly string[];
/**
 * 噪声标签正则（整项匹配）。
 * 来源：`clean/rules_loader.py` → `noise_tag_patterns`（纯年份 / 年月类标签）。
 */
export declare const NOISE_TAG_PATTERNS: readonly RegExp[];
/** 原作标签归一化规则（移植自 `clean/config/tag_normalize_rules.yaml`） */
export interface OriginalTagRules {
    /** 国家 / 地区名：用于「国家 + 改类型」合并判定 */
    countries: readonly string[];
    /** 类型同义词映射：别名 → 标准名 */
    typeMappings: Readonly<Record<string, string>>;
    /** 标准改类型集合：与自定义改类型共存时保留自定义 */
    baseGaiTypes: readonly string[];
    /** 优先级规则：higher 与 lower 共存时移除 lower */
    priorityRules: readonly {
        higher: string;
        lower: string;
    }[];
    /** 特例规则：国家 + 全部类型命中时输出 output 值 */
    specialCases: readonly {
        country: string;
        types: readonly string[];
        output: string;
    }[];
}
/** 生效的原作标签归一化规则 */
export declare const ORIGINAL_TAG_RULES: OriginalTagRules;
/** 类别列数字前缀（`12|TV` → `TV`），来源：`clean/clean_stages.py` 的 clean_category_column */
export declare const CATEGORY_NUMBER_PREFIX_RE: RegExp;
/** 行字节数估算的采样行数上限（避免整表读取卡死 WPS） */
export declare const ROW_BYTES_SAMPLE_LIMIT = 30;
/** 采样失败时使用的单行兜底字节数 */
export declare const ROW_BYTES_FALLBACK = 96;
/** 单条清理规则（新增清理项 = 在此数组追加一条） */
export interface CleanRule {
    /** 唯一标识（同时作为勾选状态持久化键） */
    id: string;
    /** 展示名 */
    name: string;
    /** 说明文案 */
    desc: string;
    /** 分组名（页面按 group 分组渲染，保持首次出现顺序） */
    group: string;
    /** 分组 / 列表图标（emoji） */
    icon: string;
    /** 执行种类 */
    kind: CleanKind;
    /** 风险等级 */
    risk: CleanRisk;
    /** 是否默认勾选 */
    defaultOn: boolean;
    /** cellTransform 专用：目标列的表头关键词（按数组顺序取首个命中的列） */
    columns?: readonly string[];
    /** cellTransform 专用：变换函数 ID */
    transform?: CellTransformId;
}
/**
 * 清理项清单。**新增清理项只需在此追加一条**，
 * 页面勾选列表、执行前预览、执行与日志均自动适配。
 */
export declare const CLEAN_RULES: readonly CleanRule[];
/** 按 id 查找清理规则 */
export declare function findCleanRule(id: string): CleanRule | undefined;
/** 风险等级 → 展示文案 */
export declare const RISK_LABELS: Record<CleanRisk, string>;
//# sourceMappingURL=clean-rules.d.ts.map