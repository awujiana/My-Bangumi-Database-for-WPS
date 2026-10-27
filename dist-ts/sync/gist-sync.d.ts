/**
 * @fileoverview GitHub Gist 同步源模块
 * @module sync/gistSync
 * @description Gist 同步源实现，URL 模板：
 *              https://api.github.com/gists/{gist_id}
 *
 *              Gist API 响应结构（节选）：
 *              {
 *                "id": "...",
 *                "description": "...",
 *                "files": {
 *                  "data1.jsonlines": { "content": "..." },
 *                  "data2.jsonlines": { "content": "..." }
 *                },
 *                ...
 *              }
 *
 *              本模块从响应中提取所有 files[*].content 字段，
 *              按文件名字典序拼接为单一 JSONL 文本，再复用 githubSyncDiff.ts
 *              的 parseJsonl 解析为 GithubRemoteEntry[]。
 *              因此表头必须位于字典序最靠前的那个文件里，其后文件只放值数组。
 *
 *              与 GitHub/GitLab/Gitee 远程源的差异：
 *              - 不需要 owner/repo/branch/path 字段，仅需 gist_id
 *              - 调用 GitHub Gist REST API（非 raw 文件直链），返回 JSON 元数据
 *              - 通过 extractGistContent 从 JSON 响应中提取文本内容
 *              - 配置校验使用 isGistConfigured()，不复用 isGithubConfigComplete()
 *
 *              注意：未认证的 Gist API 限流为 60 次/小时/IP（与 GitHub Raw 一致）。
 *              若需更高配额，可在后续扩展中通过请求头附加 token。
 *
 *              **gzip 数据源不支持**：Gist API 的 `files[*].content` 只承载文本，
 *              GitHub 对二进制文件（如 `bangumi.jsonlines.gz`）会省略 content 字段，
 *              因此本同步源只能读取**明文** JSONL。要使用 gzip 数据源，请改用
 *              GitHub / GitLab / Gitee raw 直链或本地文件同步源
 *              （它们统一走 jsonl-response.ts 按魔数解压）。
 */
import type { GithubRemoteEntry } from './github-sync-diff.js';
import { BaseSyncSource } from './sync-source-base.js';
/**
 * 构造 Gist API URL
 *
 * 格式：https://api.github.com/gists/{gistId}
 *
 * @param gistId Gist ID 字符串（Gist URL 末段，如 https://gist.github.com/user/{gistId} 的末段）
 * @returns 完整 Gist API URL
 */
export declare function buildGistApiUrl(gistId: string): string;
/**
 * 从 Gist API 响应中提取并拼接所有 files[*].content
 *
 * 行为约定：
 * - null/undefined 输入 → 返回空字符串
 * - 缺失 files 字段或 files 不是对象 → 返回空字符串
 * - 单文件：返回该文件的 content（若 content 缺失则跳过，返回空串）
 * - 多文件：按文件名字典序拼接所有非空 content，用 '\n' 分隔
 * - 单文件 content 为空字符串：跳过（不参与拼接）
 *
 * 多文件分隔符选择 '\n'：
 * - JSONL 每行是独立 JSON 对象，'\n' 是合法行分隔符
 * - 拼接后 parseJsonl 会按行分割，逐行 JSON.parse
 * - 单文件 content 内部可能本身就包含多行 JSONL，无需额外处理
 *
 * @param apiResponse Gist API 响应（unknown 类型，需通过类型守卫缩窄）
 * @returns 拼接后的 JSONL 文本
 */
export declare function extractGistContent(apiResponse: unknown): string;
export declare function fetchGistJson(signal?: AbortSignal): Promise<GithubRemoteEntry[]>;
/**
 * Gist 同步源实现
 *
 * 包装 fetchGistJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 *
 * 与远程源（GitHub/GitLab/Gitee）的关键差异：
 *   1. validateConfig 校验 gist_id 非空（不要求 owner/repo/branch/path）
 *   2. fetchRemoteEntries 调用 Gist API（非 raw 文件直链），
 *      从 files[*].content 提取 JSONL 文本
 *   3. 配置存储使用独立的 gistId 字段（不复用 path）
 */
export declare class GistSyncSource extends BaseSyncSource {
    constructor();
    /**
     * 获取远程条目（委托给 fetchGistJson）
     * @param signal 可选的 AbortSignal
     */
    fetchRemoteEntries(signal?: AbortSignal): Promise<GithubRemoteEntry[]>;
}
//# sourceMappingURL=gist-sync.d.ts.map