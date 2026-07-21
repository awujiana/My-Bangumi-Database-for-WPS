/**
 * @fileoverview GitHub 仓库配置管理模块
 * @module sync/githubConfig
 * @description 管理 GitHub 仓库地址配置（owner/repo/branch/path），
 *              使用 PluginStorage 持久化存储。仅支持公开仓库（不认证）。
 */
import type { SyncStrategy } from './githubSyncDiff.js';
/** GitHub 仓库配置 */
export interface GithubSyncConfig {
    /** 仓库所有者（用户名或组织名） */
    owner: string;
    /** 仓库名 */
    repo: string;
    /** 分支名（默认 main） */
    branch: string;
    /** 文件路径（如 data/bangumi-data.json） */
    path: string;
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
 * @returns URL 字符串
 * @throws 配置不完整时抛出 Error
 */
export declare function buildRawUrl(): string;
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
//# sourceMappingURL=githubConfig.d.ts.map