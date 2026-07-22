/**
 * @fileoverview GitLab 仓库增量同步模块
 * @module sync/gitlabSync
 * @description GitLab 同步源实现，URL 模板：
 *              https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{path}
 *
 *              注意：GitLab Raw URL 使用 `/-/raw/` 段（含三段横线），
 *              与 GitHub 的 `/raw/` 不同。例如：
 *                GitHub: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
 *                GitLab: https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{path}
 *
 *              复用 githubConfig 的 owner/repo/branch/path 字段（与 GitHub 共享配置 UI），
 *              复用 githubSyncDiff.ts 的 parseJsonl / isGithubRemoteEntry 解析逻辑，
 *              不重复解析实现。
 *
 * 数据格式（远程 JSON 文件）与 GitHub 一致：
 * [
 *   { "sid": "12345", "url": "https://bgm.tv/subject/12345", "name": "...",
 *     "type": 2, "score": 8, "tags": ["标签1","标签2"], "comment": "...",
 *     "episode": 12, "updatedAt": "2026-07-05T10:00:00Z" },
 *   ...
 * ]
 */
import { Result } from '../core/result.js';
import { type GithubRemoteEntry } from './githubSyncDiff.js';
import type { SyncSource } from './SyncSource.js';
/**
 * 构造 GitLab Raw 文件下载 URL
 *
 * 格式：https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{path}
 *
 * 关键差异：GitLab 使用 `/-/raw/` 段（含三段横线），不同于 GitHub 的 `/raw/`。
 *
 * @returns URL 字符串
 * @throws 配置不完整时抛出 Error
 */
export declare function buildGitlabRawUrl(): string;
/**
 * 从 GitLab Raw 下载 JSONL 文件
 *
 * JSONL（JSON Lines）格式与 GitHub 同步源一致：每行一个独立的 JSON 对象。
 * 解析复用 githubSyncDiff.ts 的 parseJsonl，非法行不中断整体解析。
 *
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export declare function fetchGitlabJson(signal?: AbortSignal): Promise<GithubRemoteEntry[]>;
/**
 * GitLab 同步源实现
 *
 * 包装 fetchGitlabJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 * 与 GithubSyncSource 行为一致：
 * 1. validateConfig() 在下载前校验配置完整性（复用 githubConfig）
 * 2. fetchRemoteEntries() 委托给 fetchGitlabJson，仅 URL 构造不同
 */
export declare class GitlabSyncSource implements SyncSource {
    /** 数据源类型标识 */
    getSourceType(): string;
    /** 数据源显示名称（用于日志与进度提示） */
    getDisplayName(): string;
    /**
     * 获取远程条目（委托给 fetchGitlabJson）
     * @param signal 可选的 AbortSignal
     */
    fetchRemoteEntries(signal?: AbortSignal): Promise<GithubRemoteEntry[]>;
    /**
     * 校验配置是否完整可用
     * @returns 完整返回 Result.ok(undefined)，不完整返回 Result.fail(BgmError)
     */
    validateConfig(): Result<void>;
}
//# sourceMappingURL=gitlabSync.d.ts.map