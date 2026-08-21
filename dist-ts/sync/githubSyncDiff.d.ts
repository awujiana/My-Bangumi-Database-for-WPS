/**
 * @fileoverview GitHub 同步差异计算（纯函数模块）
 * @module sync/githubSyncDiff
 * @description 提供 GitHub 远程条目与本地 Excel 行的差异计算逻辑。
 *
 * 本模块为零依赖纯函数模块，不导入任何项目模块（避免触发 index.ts → handlers.ts
 * 的 document 副作用链），可在 Node 测试环境中直接运行。
 *
 * type 字段约定（与 Bangumi 一致）：
 *   1=想看  2=在看  3=看过  4=搁置  5=抛弃
 */
/** 远程 JSON 单条记录结构 */
export interface GithubRemoteEntry {
    /** Bangumi subject ID（主键） */
    sid: string;
    /** 条目名称 */
    name?: string;
    /** 远程更新时间戳 */
    updatedAt?: string;
    /** 开播日期（dump.date） */
    date?: string;
    /** 标签/分级（dump.meta_tags，写入「标签/分级」列） */
    meta_tags?: string[];
    /** 布尔（dump.nsfw） */
    nsfw?: boolean;
    /** 完播日（infobox.播放结束） */
    播放结束?: string;
    /** 制作公司（infobox.动画制作公司） */
    动画制作公司?: string;
    /** 集数（infobox.话数，写入「集数」列） */
    话数?: string;
    /** 时长/分钟（infobox.片长） */
    片长?: string;
    /** 制片国家（infobox.制片国家） */
    制片国家?: string;
    /** 语言（infobox.语言） */
    语言?: string;
    /** 类型（infobox.类型） */
    类型?: string;
    /** 导演（infobox.导演） */
    导演?: string;
    /** 音乐（infobox.音乐） */
    音乐?: string;
    /** 人物设定（infobox.人物设定） */
    人物设定?: string;
    /** 机械设定（infobox.机械设定） */
    机械设定?: string;
    /** 原作（infobox.原作） */
    原作?: string;
    /** 脚本（infobox.脚本） */
    脚本?: string;
    /** 分镜（infobox.分镜） */
    分镜?: string;
    /** 演出（infobox.演出） */
    演出?: string;
    /** 原案（infobox.原案） */
    原案?: string;
    /** 系列构成（infobox.系列构成） */
    系列构成?: string;
    /** 在线播放平台（infobox.在线播放平台） */
    在线播放平台?: string;
    /** 关联的动漫ID（subject-relations） */
    关联的动漫ID?: string;
}
/**
 * 用户对单条冲突的解决决策
 *
 * chosenValue 为 'local' 时表示保留本地值（从 diff.changedFields 中移除该字段）；
 * 为 'remote' 时表示采用远程值（保留该字段在 changedFields 中）。
 */
export interface ConflictResolution {
    /** Bangumi subject ID（主键） */
    sid: string;
    /** 冲突字段名（与 Conflict.field 对应） */
    field: string;
    /** 用户选择的值来源 */
    chosenValue: 'local' | 'remote';
}
/**
 * 扩展字段映射表：JSONL 字段名 → Excel 标准字段名（colMap key）
 *
 * 用于 computeDiff 比对和 writeRemoteEntryToRow 写入扩展字段。
 *
 * 特殊处理（不在此表中）：
 * - '话数' 写入「集数」列（有独立处理逻辑）
 * - 'meta_tags' 写入「标签/分级」列（有独立处理逻辑）
 * - 'nsfw' 无明确 Excel 列映射，暂不处理
 */
export declare const EXTENDED_FIELD_MAP: ReadonlyArray<readonly [string, string]>;
/**
 * 获取指定 JSONL 字段对应的所有 Excel 列名（含主映射和别名）
 *
 * @param jsonlField JSONL 字段名
 * @returns Excel 列名数组（至少包含 1 个元素）
 */
export declare function getExcelAliases(jsonlField: string): readonly string[];
/**
 * 同步策略枚举
 * - add-update: 新增+更新，不删除（默认，保守）
 * - add-only: 仅新增本地不存在的 SID，不更新已有行
 * - update-only: 仅更新本地已存在的 SID，不新增行
 * - mirror: 镜像同步（新增+更新+删除本地多余行）
 * - force-overwrite: 强制覆盖（无视字段比对，远程值全部覆盖本地，含空值）
 */
export type SyncStrategy = 'add-update' | 'add-only' | 'update-only' | 'mirror' | 'force-overwrite';
/** 策略中文标签映射（供 UI 下拉框使用） */
export declare const SYNC_STRATEGY_LABELS: Readonly<Record<SyncStrategy, string>>;
/** 单条差异记录 */
export interface GithubSyncDiff {
    /** 差异类型 */
    kind: 'add' | 'update' | 'delete';
    /** 主键 SID */
    sid: string;
    /** 远程条目数据（delete 时为 undefined） */
    remote?: GithubRemoteEntry;
    /** 本地行号（update/delete 时有值，add 时为 undefined） */
    localRow?: number;
    /** 变更字段列表（add/force-overwrite 时为 ['*']） */
    changedFields: string[];
}
/** 本地行数据（仅包含 diff 所需字段） */
export interface LocalRowEntry {
    /** 行号 */
    row: number;
    /** SID（主键） */
    sid: string;
    /** 各字段值 */
    fields: Record<string, string>;
}
/**
 * 将远程 tags 数组转为本地「标签/分级」文本（用 | 分隔）
 */
export declare function tagsToString(tags: string[] | undefined): string;
/**
 * 类型守卫：判断未知值是否为 GithubRemoteEntry
 */
export declare function isGithubRemoteEntry(value: unknown): value is GithubRemoteEntry;
/**
 * 解析 JSONL 文本为 GithubRemoteEntry 数组
 *
 * JSONL（JSON Lines）格式：每行一个独立的 JSON 对象，无外层数组括号，无逗号分隔。
 * 空行与首尾空白会被忽略；非法行的行号会被收集到 errors 中但不中断整体解析。
 *
 * @param text JSONL 原始文本
 * @returns 解析结果：{ entries: 合法条目; errors: 非法行信息（1-based 行号+原因） }
 */
export declare function parseJsonl(text: string): {
    entries: GithubRemoteEntry[];
    errors: Array<{
        line: number;
        reason: string;
    }>;
};
/**
 * 同步时间筛选配置
 *
 * 支持五种筛选模式：
 * - 'all': 不过滤（全部同步）
 * - 'year': 按年份筛选（如 2026 年所有动漫）
 * - 'quarter': 按季度筛选（如 2026 年 4 月新番）
 * - 'month': 按月份筛选（如 2025 年 1 月）
 * - 'future': 预告/未来动漫（无开播日期的条目）
 */
export interface SyncTimeFilter {
    /** 是否启用时间筛选 */
    enabled: boolean;
    /** 目标年份 */
    year: number;
    /** 筛选范围 */
    range: 'all' | 'year' | 'quarter' | 'month' | 'future';
    /** 季度值（仅 range='quarter' 时有效）：1 | 4 | 7 | 10 */
    quarter?: 1 | 4 | 7 | 10;
    /** 月份值（仅 range='month' 时有效）：1-12 */
    month?: number;
}
/**
 * 按时间筛选远程条目
 *
 * 根据 {@link SyncTimeFilter} 配置，基于远程条目的 `date` 字段（开播日期）
 * 进行年份/季度/月份筛选，或筛选预告/未来动漫（无开播日期）。
 * 日期格式支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 等。
 *
 * 特殊模式：
 * - future: 筛选无开播日期的条目（预告/未来动漫）
 *
 * 季度规则：
 * - 1月新番（Q1）：上年12月 + 本年1月 + 本年2月
 * - 4月新番（Q2）：3月 + 4月 + 5月
 * - 7月新番（Q3）：6月 + 7月 + 8月
 * - 10月新番（Q4）：9月 + 10月 + 11月
 *
 * @param entries 远程条目数组
 * @param filter 时间筛选配置
 * @returns 筛选后的条目数组
 */
export declare function filterByTime(entries: GithubRemoteEntry[], filter: SyncTimeFilter): GithubRemoteEntry[];
/**
 * 计算远程条目与本地条目的差异（按指定策略）
 *
 * 比对规则（基础）：
 * - 远程有、本地无 → add（changedFields = ['*']）
 * - 远程与本地 SID 相同 → 逐字段比对，任一字段不同则 update
 * - 远程字段为 undefined/空 → 不视为差异（保留本地值）
 * - 远程 meta_tags 数组用 | 拼接后比对
 * - 远程「话数」转为字符串后比对
 *
 * 策略修饰：
 * - add-update: 基础规则（add + update，无 delete）
 * - add-only: 仅返回 add，已存在的 SID 全部跳过
 * - update-only: 仅返回 update，本地不存在的 SID 全部跳过
 * - mirror: 基础规则 + 本地存在但远程不存在的 SID 标记为 delete
 * - force-overwrite: 已存在的 SID 强制标记为 update（changedFields = ['*']），
 *                    远程空值也会覆盖本地（applyDiffToSheet 中处理）
 *
 * @param remoteEntries 远程条目数组
 * @param localEntries 本地条目映射（SID → 行）
 * @param strategy 同步策略，默认 'add-update'
 * @returns 差异列表（按策略包含 add/update/delete，不含 unchanged）
 */
export declare function computeDiff(remoteEntries: GithubRemoteEntry[], localEntries: Map<string, LocalRowEntry>, strategy?: SyncStrategy, timeFilter?: SyncTimeFilter): GithubSyncDiff[];
//# sourceMappingURL=githubSyncDiff.d.ts.map