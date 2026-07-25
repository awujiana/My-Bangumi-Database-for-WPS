/**
 * @fileoverview GitHub 仓库增量同步模块
 * @module sync/githubSync
 * @description 从 GitHub 公开仓库下载 JSON 数据，按 SID 主键比对本地 Excel 行，
 *              增量更新（新增+更新，不删除本地多余行）。
 *
 * 数据格式（远程 JSONL 文件，每行一个 JSON 对象）：
 *   { "sid": "12345", "url": "https://bgm.tv/subject/12345", "name": "...",
 *     "type": 2, "score": 8, "tags": ["标签1","标签2"], "comment": "...",
 *     "episode": 12, "updatedAt": "2026-07-05T10:00:00Z" }
 *
 * type 字段为 Bangumi 条目类别（不是观看状态）：
 *   1=书籍  2=动漫  3=音乐  4=游戏  6=三次元
 */
import { Result } from '../core/result.js';
import type { ConflictResolution } from '../services/ribbonService.js';
import { type GithubRemoteEntry, type GithubSyncDiff, type LocalRowEntry, type SyncStrategy } from './githubSyncDiff.js';
import type { SyncSource } from './SyncSource.js';
export { computeDiff, tagsToString, parseJsonl, isGithubRemoteEntry, SYNC_STRATEGY_LABELS, type GithubRemoteEntry, type GithubSyncDiff, type LocalRowEntry, type SyncStrategy, } from './githubSyncDiff.js';
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
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export declare function fetchGithubJson(signal?: AbortSignal): Promise<GithubRemoteEntry[]>;
/**
 * GitHub 同步源实现
 *
 * 包装 fetchGithubJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 * 通过 syncFromGithub 主流程统一调用：
 * 1. validateConfig() 在下载前校验配置完整性
 * 2. fetchRemoteEntries() 复用既有 fetchGithubJson 实现，保持向后兼容
 */
export declare class GithubSyncSource implements SyncSource {
    /** 数据源类型标识 */
    getSourceType(): string;
    /** 数据源显示名称（用于日志与进度提示） */
    getDisplayName(): string;
    /**
     * 获取远程条目（委托给 fetchGithubJson）
     * @param signal 可选的 AbortSignal
     */
    fetchRemoteEntries(signal?: AbortSignal): Promise<GithubRemoteEntry[]>;
    /**
     * 校验配置是否完整可用
     * @returns 完整返回 Result.ok(undefined)，不完整返回 Result.fail(BgmError)
     */
    validateConfig(): Result<void>;
}
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
 * 根据用户冲突解决决策调整 diff 列表
 *
 * 处理规则：
 * - 仅作用于 kind === 'update' 且 changedFields 不为 ['*'] 的 diff（字段级更新）
 * - 对每个 resolution，找到 sid 与 field 匹配的 update diff：
 *   - chosenValue === 'local'：从 changedFields 中移除该 field（保留本地值）
 *   - chosenValue === 'remote'：保留该 field 在 changedFields 中（采用远程值）
 * - 若 update diff 的 changedFields 被清空，则从 diffs 中移除该 diff（无字段需更新）
 * - add/delete 与 force-overwrite（changedFields 为 ['*']）不受影响
 *
 * 本函数直接修改传入的 diffs 数组（in-place），同时返回该数组便于链式调用。
 *
 * @param diffs 差异列表（会被原地修改）
 * @param resolutions 用户冲突解决决策列表
 * @returns 调整后的差异列表（与输入为同一引用）
 */
export declare function applyConflictResolutions(diffs: GithubSyncDiff[], resolutions: ConflictResolution[]): GithubSyncDiff[];
/**
 * GitHub 同步主入口（供 ribbonService 调用）
 *
 * 通过 syncSourceRegistry 按 sourceType 动态选择 SyncSource 实现。
 * 默认 sourceType 为 'github'，由 syncSourceRegistry 注册的 GithubSyncSource 处理；
 * 未来 Task 22-25 注册的 GitLab/Gitee/本地文件/Gist 实现可无缝替换。
 *
 * @param onProgress 进度回调
 * @param strategy 同步策略，默认 'add-update'
 * @param signal 可选 AbortSignal，用于取消请求
 * @param conflictResolution 可选冲突解决决策列表；提供时将按用户选择过滤 update diff 的字段
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误、未知 sourceType 时抛出
 */
export declare function syncFromGithub(onProgress?: (current: number, total: number, message: string) => void, strategy?: SyncStrategy, signal?: AbortSignal, conflictResolution?: ConflictResolution[]): Promise<GithubSyncResult>;
//# sourceMappingURL=githubSync.d.ts.map