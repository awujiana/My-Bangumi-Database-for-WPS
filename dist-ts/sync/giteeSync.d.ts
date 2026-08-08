/**
 * @fileoverview Gitee 仓库增量同步模块
 * @module sync/giteeSync
 * @description Gitee 同步源实现，URL 模板：
 *              https://gitee.com/{owner}/{repo}/raw/{branch}/{path}
 *
 *              注意：Gitee Raw URL 使用 `/raw/` 段（与 GitHub 一致），
 *              不同于 GitLab 的 `/-/raw/`。例如：
 *                GitHub: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
 *                Gitee:  https://gitee.com/{owner}/{repo}/raw/{branch}/{path}
 *                GitLab: https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{path}
 *
 *              复用 githubConfig 的 owner/repo/branch/path 字段（与 GitHub 共享配置 UI），
 *              复用 githubSyncDiff.ts 的 parseJsonl 解析逻辑，不重复解析实现。
 *
 * 数据格式（远程 JSONL 文件，每行一个 JSON 对象）与 GitHub 一致：
 *   { "sid": "12345", "name": "...", "updatedAt": "2026-07-21",
 *     "date": "2024-01-01", "meta_tags": ["标签1","标签2"], "nsfw": false,
 *     "话数": "12", "播放结束": "...", "动画制作公司": "...", ... }
 *
 * url 字段从 sid 构造：https://bgm.tv/subject/{sid}
 * type 字段默认为 2（动漫），用于同步记录显示。
 * updatedAt 为 YYYY-MM-DD 格式（仅日期，不含时间，节省空间）。
 */
import { Result } from '../core/result.js';
import { type GithubRemoteEntry } from './githubSyncDiff.js';
import type { SyncSource } from './SyncSource.js';
/**
 * 构造 Gitee Raw 文件下载 URL
 *
 * 格式：https://gitee.com/{owner}/{repo}/raw/{branch}/{path}
 *
 * 关键差异：Gitee 使用 `/raw/` 段（与 GitHub 一致），不同于 GitLab 的 `/-/raw/`。
 *
 * @returns URL 字符串
 * @throws 配置不完整时抛出 Error
 */
export declare function buildGiteeRawUrl(): string;
/**
 * 从 Gitee Raw 下载 JSONL 文件
 *
 * JSONL（JSON Lines）格式与 GitHub 同步源一致：每行一个独立的 JSON 对象。
 * 解析复用 githubSyncDiff.ts 的 parseJsonl，非法行不中断整体解析。
 *
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export declare function fetchGiteeJson(signal?: AbortSignal): Promise<GithubRemoteEntry[]>;
/**
 * Gitee 同步源实现
 *
 * 包装 fetchGiteeJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 * 与 GithubSyncSource / GitlabSyncSource 行为一致：
 * 1. validateConfig() 在下载前校验配置完整性（复用 githubConfig）
 * 2. fetchRemoteEntries() 委托给 fetchGiteeJson，仅 URL 构造不同
 */
export declare class GiteeSyncSource implements SyncSource {
    /** 数据源类型标识 */
    getSourceType(): string;
    /** 数据源显示名称（用于日志与进度提示） */
    getDisplayName(): string;
    /**
     * 获取远程条目（委托给 fetchGiteeJson）
     * @param signal 可选的 AbortSignal
     */
    fetchRemoteEntries(signal?: AbortSignal): Promise<GithubRemoteEntry[]>;
    /**
     * 校验配置是否完整可用
     * @returns 完整返回 Result.ok(undefined)，不完整返回 Result.fail(BgmError)
     */
    validateConfig(): Result<void>;
}
//# sourceMappingURL=giteeSync.d.ts.map