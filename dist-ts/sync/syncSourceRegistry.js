/**
 * @fileoverview 同步源注册表
 * @module sync/syncSourceRegistry
 * @description 统一管理所有 SyncSource 实现的注册与查询。
 *
 * 设计目的：
 * - syncFromGithub 主流程通过 getSyncSource(sourceType) 获取对应实现，
 *   无需 hardcode 任一数据源
 * - 新增数据源（GitLab/Gitee/本地文件/Gist）只需在各自模块调用
 *   registerSyncSource(type, factory) 即可被 syncFromGithub 调度
 * - 默认在模块加载时注册 'github' → GithubSyncSource
 */
import { GistSyncSource } from './gistSync.js';
import { GiteeSyncSource } from './giteeSync.js';
import { GithubSyncSource } from './githubSync.js';
import { GitlabSyncSource } from './gitlabSync.js';
import { LocalFileSyncSource } from './localFileSync.js';
/** 注册表内部存储：type → factory */
const registry = new Map();
/**
 * 注册同步源
 * @param type 同步源类型标识（如 'github' / 'gitlab' / 'gitee' / 'local' / 'gist'）
 * @param factory 工厂函数，返回 SyncSource 实例
 */
export function registerSyncSource(type, factory) {
    registry.set(type, factory);
}
/**
 * 获取同步源实例
 * @param type 同步源类型标识
 * @returns 已注册则返回新实例，未注册返回 null
 */
export function getSyncSource(type) {
    const factory = registry.get(type);
    if (!factory)
        return null;
    return factory();
}
/**
 * 获取所有已注册的同步源类型
 * @returns 类型标识数组
 */
export function getRegisteredSourceTypes() {
    return Array.from(registry.keys());
}
/**
 * 判断同步源是否已注册
 * @param type 同步源类型标识
 */
export function isSyncSourceRegistered(type) {
    return registry.has(type);
}
// 默认注册 GitHub 同步源
// 后续 Task 22-25 在各自模块中追加 registerSyncSource 调用即可扩展
registerSyncSource('github', () => new GithubSyncSource());
registerSyncSource('gitlab', () => new GitlabSyncSource());
registerSyncSource('gitee', () => new GiteeSyncSource());
registerSyncSource('local', () => new LocalFileSyncSource());
registerSyncSource('gist', () => new GistSyncSource());
