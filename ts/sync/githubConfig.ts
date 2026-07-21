/**
 * @fileoverview GitHub 仓库配置管理模块
 * @module sync/githubConfig
 * @description 管理 GitHub 仓库地址配置（owner/repo/branch/path），
 *              使用 PluginStorage 持久化存储。仅支持公开仓库（不认证）。
 */

// 直接从子模块导入，避开 index.ts 的副作用链（index → handlers → document.readyState）
// 注意：LOG_LEVELS 定义在 core/constants.ts（util.ts 仅导入未 re-export）
import { LOG_LEVELS } from '../core/constants.js';
import { bgmLog, getApp } from '../tools/util.js';
import type { WpsPluginStorage } from '../tools/wps.js';
import { BGM_EVENTS, eventBus } from '../tools/events.js';
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

/** PluginStorage 配置键 */
const CONFIG_KEYS = {
    OWNER: 'github_sync_owner',
    REPO: 'github_sync_repo',
    BRANCH: 'github_sync_branch',
    PATH: 'github_sync_path',
    STRATEGY: 'github_sync_strategy',
} as const;

/** 默认分支 */
const DEFAULT_BRANCH = 'main';

/** 默认同步策略 */
const DEFAULT_STRATEGY: SyncStrategy = 'add-update';

/**
 * 预设默认仓库配置
 * 用户首次打开面板时自动填充此值，无需手动输入。
 * 如需修改可直接在面板覆盖。
 */
export const DEFAULT_GITHUB_CONFIG: Readonly<GithubSyncConfig> = Object.freeze({
    owner: 'awujiana',
    repo: 'Bangumi-Archive-Anime-Excel-to-sync',
    branch: 'main',
    path: 'data.jsonl',
});

// 内部引用（保持向后兼容）
const DEFAULT_CONFIG = DEFAULT_GITHUB_CONFIG;

/** 合法策略集合（用于校验读取值） */
const VALID_STRATEGIES: ReadonlySet<SyncStrategy> = new Set<SyncStrategy>([
    'add-update', 'add-only', 'update-only', 'mirror', 'force-overwrite',
]);

/**
 * 类型守卫：判断字符串是否为合法 SyncStrategy
 */
function isSyncStrategy(value: unknown): value is SyncStrategy {
    return typeof value === 'string' && VALID_STRATEGIES.has(value as SyncStrategy);
}

/**
 * 获取 PluginStorage
 */
function getStorage(): WpsPluginStorage | undefined {
    const app = getApp();
    const storage = app?.PluginStorage;
    if (!storage) {
        bgmLog(LOG_LEVELS.WARN, '[githubConfig] PluginStorage 不可用');
    }
    return storage;
}

/**
 * 读取 GitHub 仓库配置
 *
 * 首次读取（所有字段为空）时自动返回预设默认值并写回 PluginStorage，
 * 使用户打开面板即可看到已填好的配置，无需手动输入。
 * 用户修改后，新值会覆盖默认值。
 *
 * @returns 配置对象
 */
export function getGithubConfig(): GithubSyncConfig {
    const storage = getStorage();
    const owner = storage?.getItem(CONFIG_KEYS.OWNER) ?? '';
    const repo = storage?.getItem(CONFIG_KEYS.REPO) ?? '';
    const branch = storage?.getItem(CONFIG_KEYS.BRANCH) || DEFAULT_BRANCH;
    const path = storage?.getItem(CONFIG_KEYS.PATH) ?? '';

    // 首次读取：所有关键字段为空 → 返回默认值并持久化
    if (!owner && !repo && !path) {
        bgmLog(LOG_LEVELS.INFO,
            `[githubConfig] 首次读取：填充默认配置 ${DEFAULT_CONFIG.owner}/${DEFAULT_CONFIG.repo}/${DEFAULT_CONFIG.branch}/${DEFAULT_CONFIG.path}`);
        if (storage) {
            storage.setItem(CONFIG_KEYS.OWNER, DEFAULT_CONFIG.owner);
            storage.setItem(CONFIG_KEYS.REPO, DEFAULT_CONFIG.repo);
            storage.setItem(CONFIG_KEYS.BRANCH, DEFAULT_CONFIG.branch);
            storage.setItem(CONFIG_KEYS.PATH, DEFAULT_CONFIG.path);
        }
        return { ...DEFAULT_CONFIG };
    }

    return { owner, repo, branch, path };
}

/**
 * 保存 GitHub 仓库配置
 * @returns 成功返回 true
 */
export function setGithubConfig(config: GithubSyncConfig): boolean {
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, '[githubConfig] 无法获取 PluginStorage');
        return false;
    }
    storage.setItem(CONFIG_KEYS.OWNER, config.owner);
    storage.setItem(CONFIG_KEYS.REPO, config.repo);
    storage.setItem(CONFIG_KEYS.BRANCH, config.branch || DEFAULT_BRANCH);
    storage.setItem(CONFIG_KEYS.PATH, config.path);
    bgmLog(LOG_LEVELS.INFO, `[githubConfig] 配置已保存: ${config.owner}/${config.repo}/${config.branch}/${config.path}`);
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key: 'github_sync_config', value: JSON.stringify(config) });
    return true;
}

/**
 * 校验配置是否完整可用
 * @returns 完整返回 true
 */
export function isGithubConfigComplete(): boolean {
    const cfg = getGithubConfig();
    return cfg.owner.length > 0 && cfg.repo.length > 0 && cfg.path.length > 0;
}

/**
 * 构造 GitHub Raw 文件下载 URL
 * 格式：https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
 * @returns URL 字符串
 * @throws 配置不完整时抛出 Error
 */
export function buildRawUrl(): string {
    const cfg = getGithubConfig();
    if (!isGithubConfigComplete()) {
        throw new Error('GitHub 仓库配置不完整，请在面板中设置 owner/repo/path');
    }
    return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch || DEFAULT_BRANCH}/${cfg.path}`;
}

/**
 * 读取同步策略
 * @returns 同步策略，未配置或非法时返回默认 'add-update'
 */
export function getSyncStrategy(): SyncStrategy {
    const storage = getStorage();
    const raw = storage?.getItem(CONFIG_KEYS.STRATEGY);
    if (isSyncStrategy(raw)) {
        return raw;
    }
    return DEFAULT_STRATEGY;
}

/**
 * 保存同步策略
 * @param strategy 同步策略
 * @returns 成功返回 true
 */
export function setSyncStrategy(strategy: SyncStrategy): boolean {
    if (!isSyncStrategy(strategy)) {
        bgmLog(LOG_LEVELS.ERROR, `[githubConfig] 非法策略值: ${String(strategy)}`);
        return false;
    }
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, '[githubConfig] 无法获取 PluginStorage');
        return false;
    }
    storage.setItem(CONFIG_KEYS.STRATEGY, strategy);
    bgmLog(LOG_LEVELS.INFO, `[githubConfig] 同步策略已保存: ${strategy}`);
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key: 'github_sync_strategy', value: strategy });
    return true;
}
