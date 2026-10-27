/**
 * @fileoverview GitHub 仓库配置管理模块
 * @module sync/githubConfig
 * @description 管理 GitHub 仓库地址配置（owner/repo/branch/path），
 *              使用 PluginStorage 持久化存储。仅支持公开仓库（不认证）。
 */
import type { SyncStrategy } from './github-sync-diff.js';
/**
 * 同步源类型枚举
 * - GitHub: GitHub 公开仓库（默认）
 * - gitlab: GitLab 仓库（Task 22 实现）
 * - gitee: Gitee 仓库（Task 23 实现）
 * - local: 本地文件（Task 24 实现）
 * - gist: GitHub Gist（Task 25 实现）
 */
export type SyncSourceType = 'github' | 'gitlab' | 'gitee' | 'local' | 'gist';
/** GitHub 仓库配置 */
export interface GithubSyncConfig {
    /** 仓库所有者（用户名或组织名） */
    owner: string;
    /** 仓库名 */
    repo: string;
    /** 分支名（默认 main） */
    branch: string;
    /**
     * 文件路径（指向**分片清单** `data/anime.manifest.json`）
     *
     * 2026-09-18 起数据文件改为分片：插件按用户表头只下载需要的分片
     * （`data/anime.<shard>.jsonlines.gz`），Excel 实际用到的 28 列压完仅
     * 3.42 MiB（相对旧单片 −83.6%）。旧单片路径不再支持。
     */
    path: string;
    /**
     * 同步源类型（可选，默认 'github'）
     * 用于 syncFromGithub 主流程按 sourceType 从 registry 获取对应 SyncSource 实例
     */
    sourceType?: SyncSourceType;
    /**
     * GitHub Gist ID（仅当 sourceType === 'gist' 时使用）
     *
     * 用于 Gist 同步源：通过 https://api.github.com/gists/{gistId} 获取 Gist 内容，
     * 解析其 files[*].content 字段并拼接为 JSONL 文本。
     * 与 owner/repo/branch/path 互斥：sourceType === 'gist' 时仅使用 gistId。
     *
     * 注意：开启 exactOptionalPropertyTypes 时，可选属性不允许赋 undefined。
     * 调用方应仅在 gistId 有值时才设置此字段，否则应省略。
     * 本接口为兼容「可能赋 undefined」的调用方，显式允许 string | undefined。
     */
    gistId?: string | undefined;
}
/**
 * 预设默认仓库配置
 * 用户首次打开面板时自动填充此值，无需手动输入。
 * 如需修改可直接在面板覆盖。
 */
export declare const DEFAULT_GITHUB_CONFIG: Readonly<GithubSyncConfig>;
/**
 * 读取 GitHub 仓库配置
 *
 * 首次读取（所有字段为空）时自动返回预设默认值并写回 PluginStorage，
 * 使用户打开面板即可看到已填好的配置，无需手动输入。
 * 用户修改后，新值会覆盖默认值。
 *
 * @returns 配置对象
 */
export declare function getGithubConfig(): GithubSyncConfig;
/**
 * 保存 GitHub 仓库配置
 * @returns 成功返回 true
 */
export declare function setGithubConfig(config: GithubSyncConfig): boolean;
/**
 * 校验配置是否完整可用
 * @returns 完整返回 true
 */
export declare function isGithubConfigComplete(): boolean;
/**
 * 构造 GitHub Raw 文件下载 URL
 * 格式：https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
 *
 * @param relativePath 可选的仓库内相对路径覆盖（下载分片时用，如 `data/anime.base.jsonlines.gz`）；
 *                     省略时使用配置里的 path（清单或旧单片）
 * @returns URL 字符串
 * @throws 配置不完整时抛出 Error
 */
export declare function buildRawUrl(relativePath?: string): string;
/**
 * 读取用户手动指定的分片名列表
 *
 * 用于「分片下载选择」UI：用户在面板上多选/取消的结果。空数组表示**未手动指定**，
 * 此时按表头自动选片。
 *
 * 存储格式是逗号分隔的字符串（PluginStorage 只存字符串）。
 *
 * @returns 分片名数组；未配置时为空数组
 */
export declare function getManualShards(): string[];
/**
 * 保存用户手动指定的分片名列表
 *
 * @param shards 分片名数组；传空数组表示恢复「按表头自动选」
 * @returns 成功返回 true
 */
export declare function setManualShards(shards: readonly string[]): boolean;
/**
 * 读取同步策略
 * @returns 同步策略，未配置或非法时返回默认 'add-update'
 */
export declare function getSyncStrategy(): SyncStrategy;
/**
 * 保存同步策略
 * @param strategy 同步策略
 * @returns 成功返回 true
 */
export declare function setSyncStrategy(strategy: SyncStrategy): boolean;
/**
 * 读取同步源类型
 * @returns 同步源类型，未配置或非法时返回默认 'github'
 */
export declare function getSyncSourceType(): SyncSourceType;
/**
 * 保存同步源类型
 * @param sourceType 同步源类型（运行时可能为任意字符串，由守卫校验）
 * @returns 成功返回 true
 */
export declare function setSyncSourceType(sourceType: string): boolean;
/**
 * 读取 GitHub Gist ID
 *
 * 用于 Gist 同步源（sourceType === 'gist'）：构造 Gist API URL
 * https://api.github.com/gists/{gistId}，从响应的 files[*].content 字段
 * 提取 JSONL 文本。
 *
 * @returns Gist ID 字符串，未配置时返回空字符串
 */
export declare function getGistId(): string;
/**
 * 保存 GitHub Gist ID
 *
 * @param id Gist ID 字符串（不可为 undefined；空串表示清除配置）
 * @returns 成功返回 true，PluginStorage 不可用时返回 false
 */
export declare function setGistId(id: string): boolean;
/**
 * 校验 Gist 配置是否可用
 *
 * Gist 同步源仅需 gistId 字段非空，不需要 owner/repo/branch/path。
 * 与 isGithubConfigComplete() 互斥：sourceType === 'gist' 时调用本函数。
 *
 * @returns gistId 非空返回 true，否则返回 false
 */
export declare function isGistConfigured(): boolean;
//# sourceMappingURL=github-config.d.ts.map