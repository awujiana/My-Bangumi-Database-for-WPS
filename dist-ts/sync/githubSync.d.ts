/**
 * @fileoverview GitHub 仓库增量同步模块
 * @module sync/githubSync
 * @description 从 GitHub 公开仓库下载 JSON 数据，按 SID 主键比对本地 Excel 行，
 *              增量更新（新增+更新，不删除本地多余行）。
 *
 * 数据格式（远程 JSON 文件）：
 * [
 *   { "sid": "12345", "url": "https://bgm.tv/subject/12345", "name": "...",
 *     "type": 2, "score": 8, "tags": ["标签1","标签2"], "comment": "...",
 *     "episode": 12, "updatedAt": "2026-07-05T10:00:00Z" },
 *   ...
 * ]
 *
 * type 字段约定（与 Bangumi 一致）：
 *   1=想看  2=在看  3=看过  4=搁置  5=抛弃
 */
export { computeDiff, mapTypeToWatchStatus, tagsToString, parseJsonl, isGithubRemoteEntry, SYNC_STRATEGY_LABELS, type GithubRemoteEntry, type GithubSyncDiff, type LocalRowEntry, type SyncStrategy, } from './githubSyncDiff.js';
import { type GithubRemoteEntry, type GithubSyncDiff, type LocalRowEntry, type SyncStrategy } from './githubSyncDiff.js';
/** 同步结果统计 */
export interface GithubSyncResult {
    /** 远程总条目数 */
    remoteTotal: number;
    /** 新增条目数 */
    added: number;
    /** 更新条目数 */
    updated: number;
    /** 删除条目数（mirror 策略） */
    deleted: number;
    /** 无变更条目数 */
    unchanged: number;
    /** 跳过条目数（无 SID 或无效） */
    skipped: number;
    /** 失败条目数 */
    failed: number;
}
/**
 * 从 GitHub Raw 下载 JSONL 文件
 *
 * JSONL（JSON Lines）格式：每行一个独立的 JSON 对象。
 * 解析时按行分割，逐行 JSON.parse，跳过空行，非法行不中断整体解析。
 *
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export declare function fetchGithubJson(): Promise<GithubRemoteEntry[]>;
/**
 * 内部读取本地条目（供外部调用，封装为纯函数入口）
 */
export declare function readLocalEntriesForSync(): {
    entries: Map<string, LocalRowEntry>;
    lastRow: number;
} | null;
/**
 * 应用 diff 到 Excel 工作表
 * @param diffs 差异列表
 * @param strategy 同步策略（决定 force-overwrite 与 delete 行为）
 * @param onProgress 进度回调（current, total, message）
 * @returns 同步结果统计
 */
export declare function applyDiffToSheet(diffs: GithubSyncDiff[], strategy: SyncStrategy, onProgress?: (current: number, total: number, message: string) => void): GithubSyncResult;
/**
 * GitHub 同步主入口（供 ribbonService 调用）
 * @param onProgress 进度回调
 * @param strategy 同步策略，默认 'add-update'
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误时抛出
 */
export declare function syncFromGithub(onProgress?: (current: number, total: number, message: string) => void, strategy?: SyncStrategy): Promise<GithubSyncResult>;
//# sourceMappingURL=githubSync.d.ts.map