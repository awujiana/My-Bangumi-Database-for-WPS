/**
 * @fileoverview GitHub 仓库配置管理模块
 * @module sync/githubConfig
 * @description 管理 GitHub 仓库地址配置（owner/repo/branch/path），
 *              使用 PluginStorage 持久化存储。仅支持公开仓库（不认证）。
 */
// 直接从子模块导入，避开 index.ts 的副作用链（index → handlers → document.readyState）
// 注意：LOG_LEVELS 定义在 core/constants.ts（utility.ts 仅导入未 re-export）
import { LOG_LEVELS } from '../core/constants.js';
import { BGM_EVENTS, eventBus } from '../tools/events.js';
import { bgmLog, getApp } from '../tools/util/index.js';
/** 合法同步源类型集合（用于校验读取值） */
const VALID_SOURCE_TYPES = new Set([
    'github',
    'gitlab',
    'gitee',
    'local',
    'gist',
]);
/** PluginStorage 配置键 */
const GITHUB_CONFIG_KEYS = {
    OWNER: 'github_sync_owner',
    REPO: 'github_sync_repo',
    BRANCH: 'github_sync_branch',
    PATH: 'github_sync_path',
    STRATEGY: 'github_sync_strategy',
    SOURCE_TYPE: 'github_sync_source_type',
    GIST_ID: 'github_sync_gist_id',
    SHARDS: 'github_sync_shards',
};
/** 默认分支 */
const DEFAULT_BRANCH = 'main';
/** 默认同步策略 */
const DEFAULT_STRATEGY = 'add-update';
/**
 * 预设默认仓库配置
 * 用户首次打开面板时自动填充此值，无需手动输入。
 * 如需修改可直接在面板覆盖。
 */
export const DEFAULT_GITHUB_CONFIG = Object.freeze({
    owner: 'awujiana',
    repo: 'Bangumi-Archive-Anime-Excel',
    branch: 'main',
    path: 'data/anime.manifest.json',
    sourceType: 'github',
});
// 内部引用（保持向后兼容）
const DEFAULT_CONFIG = DEFAULT_GITHUB_CONFIG;
/** 合法策略集合（用于校验读取值） */
const VALID_STRATEGIES = new Set([
    'add-update',
    'add-only',
    'update-only',
    'mirror',
    'force-overwrite',
]);
/**
 * 类型守卫：判断字符串是否为合法 SyncStrategy
 */
function isSyncStrategy(value) {
    return typeof value === 'string' && VALID_STRATEGIES.has(value);
}
/**
 * 类型守卫：判断字符串是否为合法 SyncSourceType
 */
function isSyncSourceType(value) {
    return typeof value === 'string' && VALID_SOURCE_TYPES.has(value);
}
/**
 * 获取 PluginStorage
 */
function getStorage() {
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
export function getGithubConfig() {
    const storage = getStorage();
    const owner = storage?.getItem(GITHUB_CONFIG_KEYS.OWNER) ?? '';
    const repo = storage?.getItem(GITHUB_CONFIG_KEYS.REPO) ?? '';
    const branch = storage?.getItem(GITHUB_CONFIG_KEYS.BRANCH) ?? DEFAULT_BRANCH;
    const path = storage?.getItem(GITHUB_CONFIG_KEYS.PATH) ?? '';
    const sourceTypeRaw = storage?.getItem(GITHUB_CONFIG_KEYS.SOURCE_TYPE);
    const sourceType = isSyncSourceType(sourceTypeRaw) ? sourceTypeRaw : 'github';
    const gistId = storage?.getItem(GITHUB_CONFIG_KEYS.GIST_ID) ?? '';
    // 首次读取：所有关键字段为空 → 返回默认值并持久化
    if (!owner && !repo && !path) {
        bgmLog(LOG_LEVELS.INFO, `[githubConfig] 首次读取：填充默认配置 ${DEFAULT_CONFIG.owner}/${DEFAULT_CONFIG.repo}/${DEFAULT_CONFIG.branch}/${DEFAULT_CONFIG.path}`);
        if (storage) {
            storage.setItem(GITHUB_CONFIG_KEYS.OWNER, DEFAULT_CONFIG.owner);
            storage.setItem(GITHUB_CONFIG_KEYS.REPO, DEFAULT_CONFIG.repo);
            storage.setItem(GITHUB_CONFIG_KEYS.BRANCH, DEFAULT_CONFIG.branch);
            storage.setItem(GITHUB_CONFIG_KEYS.PATH, DEFAULT_CONFIG.path);
            storage.setItem(GITHUB_CONFIG_KEYS.SOURCE_TYPE, DEFAULT_CONFIG.sourceType ?? 'github');
        }
        return { ...DEFAULT_CONFIG };
    }
    // gistId 仅在非空时附加到返回值（满足 exactOptionalPropertyTypes: 不能赋 undefined 给可选属性）
    return gistId
        ? { owner, repo, branch, path, sourceType, gistId }
        : { owner, repo, branch, path, sourceType };
}
/**
 * 保存 GitHub 仓库配置
 * @returns 成功返回 true
 */
export function setGithubConfig(config) {
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, '[githubConfig] 无法获取 PluginStorage');
        return false;
    }
    storage.setItem(GITHUB_CONFIG_KEYS.OWNER, config.owner);
    storage.setItem(GITHUB_CONFIG_KEYS.REPO, config.repo);
    storage.setItem(GITHUB_CONFIG_KEYS.BRANCH, config.branch || DEFAULT_BRANCH);
    storage.setItem(GITHUB_CONFIG_KEYS.PATH, config.path);
    const sourceType = config.sourceType ?? 'github';
    storage.setItem(GITHUB_CONFIG_KEYS.SOURCE_TYPE, sourceType);
    // Gist ID 仅在提供时持久化（可选字段）
    if (config.gistId !== undefined) {
        storage.setItem(GITHUB_CONFIG_KEYS.GIST_ID, config.gistId);
    }
    bgmLog(LOG_LEVELS.INFO, `[githubConfig] 配置已保存: ${config.owner}/${config.repo}/${config.branch}/${config.path}, sourceType: ${sourceType}`);
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, {
        key: 'github_sync_config',
        value: JSON.stringify(config),
    });
    return true;
}
/**
 * 校验配置是否完整可用
 * @returns 完整返回 true
 */
export function isGithubConfigComplete() {
    const config = getGithubConfig();
    return config.owner.length > 0 && config.repo.length > 0 && config.path.length > 0;
}
/**
 * 构造 GitHub Raw 文件下载 URL
 * 格式：https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
 *
 * @param relativePath 可选的仓库内相对路径覆盖（下载分片时用，如 `data/anime.base.jsonlines.gz`）；
 *                     省略时使用配置里的 path（清单或旧单片）
 * @returns URL 字符串
 * @throws 配置不完整时抛出 Error
 */
export function buildRawUrl(relativePath) {
    if (!isGithubConfigComplete()) {
        throw new Error('GitHub 仓库配置不完整，请在面板中设置 owner/repo/path');
    }
    // config 声明移到 early throw 之后（满足 unicorn/no-declarations-before-early-exit）
    const config = getGithubConfig();
    const target = relativePath ?? config.path;
    return `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch || DEFAULT_BRANCH}/${target}`;
}
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
export function getManualShards() {
    const raw = getStorage()?.getItem(GITHUB_CONFIG_KEYS.SHARDS) ?? '';
    return raw
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
}
/**
 * 保存用户手动指定的分片名列表
 *
 * @param shards 分片名数组；传空数组表示恢复「按表头自动选」
 * @returns 成功返回 true
 */
export function setManualShards(shards) {
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, '[githubConfig] 无法获取 PluginStorage');
        return false;
    }
    const value = shards.join(',');
    storage.setItem(GITHUB_CONFIG_KEYS.SHARDS, value);
    bgmLog(LOG_LEVELS.INFO, `[githubConfig] 分片选择已保存: ${value || '（自动）'}`);
    return true;
}
/**
 * 读取同步策略
 * @returns 同步策略，未配置或非法时返回默认 'add-update'
 */
export function getSyncStrategy() {
    const storage = getStorage();
    const raw = storage?.getItem(GITHUB_CONFIG_KEYS.STRATEGY);
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
export function setSyncStrategy(strategy) {
    if (!isSyncStrategy(strategy)) {
        bgmLog(LOG_LEVELS.ERROR, `[githubConfig] 非法策略值: ${String(strategy)}`);
        return false;
    }
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, '[githubConfig] 无法获取 PluginStorage');
        return false;
    }
    storage.setItem(GITHUB_CONFIG_KEYS.STRATEGY, strategy);
    bgmLog(LOG_LEVELS.INFO, `[githubConfig] 同步策略已保存: ${strategy}`);
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key: 'github_sync_strategy', value: strategy });
    return true;
}
/**
 * 读取同步源类型
 * @returns 同步源类型，未配置或非法时返回默认 'github'
 */
export function getSyncSourceType() {
    const storage = getStorage();
    const raw = storage?.getItem(GITHUB_CONFIG_KEYS.SOURCE_TYPE);
    if (isSyncSourceType(raw)) {
        return raw;
    }
    return 'github';
}
/**
 * 保存同步源类型
 * @param sourceType 同步源类型（运行时可能为任意字符串，由守卫校验）
 * @returns 成功返回 true
 */
export function setSyncSourceType(sourceType) {
    if (!isSyncSourceType(sourceType)) {
        bgmLog(LOG_LEVELS.ERROR, `[githubConfig] 非法同步源类型: ${sourceType}`);
        return false;
    }
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, '[githubConfig] 无法获取 PluginStorage');
        return false;
    }
    storage.setItem(GITHUB_CONFIG_KEYS.SOURCE_TYPE, sourceType);
    bgmLog(LOG_LEVELS.INFO, `[githubConfig] 同步源类型已保存: ${sourceType}`);
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key: 'github_sync_source_type', value: sourceType });
    return true;
}
// ========== Gist 配置（Task 25 新增） ==========
//
// Gist 同步源与 GitHub/GitLab/Gitee 远程源不同：
// - 不需要 owner/repo/branch/path 字段（Gist 是单文件容器，按 ID 索引）
// - 仅需 gistId 字段定位 Gist 资源
// - 通过 https://api.github.com/gists/{gistId} 获取 Gist 元数据，
//   然后从 response.files[*].content 字段拼接出 JSONL 文本
//
// 因此 Gist 的配置校验使用 isGistConfigured()，不复用 isGithubConfigComplete()。
/**
 * 读取 GitHub Gist ID
 *
 * 用于 Gist 同步源（sourceType === 'gist'）：构造 Gist API URL
 * https://api.github.com/gists/{gistId}，从响应的 files[*].content 字段
 * 提取 JSONL 文本。
 *
 * @returns Gist ID 字符串，未配置时返回空字符串
 */
export function getGistId() {
    const storage = getStorage();
    return storage?.getItem(GITHUB_CONFIG_KEYS.GIST_ID) ?? '';
}
/**
 * 保存 GitHub Gist ID
 *
 * @param id Gist ID 字符串（不可为 undefined；空串表示清除配置）
 * @returns 成功返回 true，PluginStorage 不可用时返回 false
 */
export function setGistId(id) {
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, '[githubConfig] 无法获取 PluginStorage');
        return false;
    }
    storage.setItem(GITHUB_CONFIG_KEYS.GIST_ID, id);
    bgmLog(LOG_LEVELS.INFO, `[githubConfig] Gist ID 已保存: ${id || '(空)'}`);
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key: 'github_sync_gist_id', value: id });
    return true;
}
/**
 * 校验 Gist 配置是否可用
 *
 * Gist 同步源仅需 gistId 字段非空，不需要 owner/repo/branch/path。
 * 与 isGithubConfigComplete() 互斥：sourceType === 'gist' 时调用本函数。
 *
 * @returns gistId 非空返回 true，否则返回 false
 */
export function isGistConfigured() {
    return getGistId().length > 0;
}
