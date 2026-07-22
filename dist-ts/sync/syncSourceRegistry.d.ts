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
import type { SyncSource } from './SyncSource.js';
/** 同步源工厂函数：每次调用返回新实例，避免实例间状态共享 */
type SyncSourceFactory = () => SyncSource;
/**
 * 注册同步源
 * @param type 同步源类型标识（如 'github' / 'gitlab' / 'gitee' / 'local' / 'gist'）
 * @param factory 工厂函数，返回 SyncSource 实例
 */
export declare function registerSyncSource(type: string, factory: SyncSourceFactory): void;
/**
 * 获取同步源实例
 * @param type 同步源类型标识
 * @returns 已注册则返回新实例，未注册返回 null
 */
export declare function getSyncSource(type: string): SyncSource | null;
/**
 * 获取所有已注册的同步源类型
 * @returns 类型标识数组
 */
export declare function getRegisteredSourceTypes(): string[];
/**
 * 判断同步源是否已注册
 * @param type 同步源类型标识
 */
export declare function isSyncSourceRegistered(type: string): boolean;
export {};
//# sourceMappingURL=syncSourceRegistry.d.ts.map