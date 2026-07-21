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
    /** Bangumi 条目 URL */
    url?: string;
    /** 条目名称 */
    name?: string;
    /** 观看状态（1-5） */
    type?: number;
    /** 评分（0-10） */
    score?: number;
    /** 标签数组 */
    tags?: string[];
    /** 个人评论 */
    comment?: string;
    /** 看到集数 */
    episode?: number;
    /** 远程更新时间戳 */
    updatedAt?: string;
}
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
 * 将远程 type 数值映射为本地「是否看完」文本
 * 与 pureUtils.mapWatchStatus 的逆映射
 */
export declare function mapTypeToWatchStatus(type: number): string;
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
 * 计算远程条目与本地条目的差异（按指定策略）
 *
 * 比对规则（基础）：
 * - 远程有、本地无 → add（changedFields = ['*']）
 * - 远程与本地 SID 相同 → 逐字段比对，任一字段不同则 update
 * - 远程字段为 undefined/空 → 不视为差异（保留本地值）
 * - 远程 type 映射为「是否看完」文本后比对
 * - 远程 score/episode 转为字符串后比对
 * - 远程 tags 数组用 | 拼接后比对
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
export declare function computeDiff(remoteEntries: GithubRemoteEntry[], localEntries: Map<string, LocalRowEntry>, strategy?: SyncStrategy): GithubSyncDiff[];
//# sourceMappingURL=githubSyncDiff.d.ts.map