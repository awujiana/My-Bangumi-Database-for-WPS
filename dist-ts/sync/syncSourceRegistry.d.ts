/**
 * @fileoverview 同步源注册表与调度入口
 * @module sync/syncSourceRegistry
 * @description 统一管理所有 SyncSource 实现的注册、查询与统一同步入口。
 *
 * 设计目的：
 * - 新增数据源只需实现 SyncSource 接口并调用 registerSyncSource(type, factory)
 * - syncFromRemote 按 sourceType 从注册表获取对应实现，统一完成下载、diff、应用
 * - githubSync.ts 只负责 GitHub 源实现与差异应用工具，不再反向依赖注册表，
 *   从而打破 githubSync.ts ↔ syncSourceRegistry.ts 的循环依赖。
 */
import { type GithubSyncResult, type SyncStrategy } from './githubSync.js';
import { type ConflictResolution } from './githubSyncDiff.js';
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
/**
 * 统一远程同步入口
 *
 * 按当前配置的 sourceType 从注册表获取 SyncSource，完成：
 * 1. 校验配置；2. 下载远程条目；3. 计算差异；4. 应用差异到 Excel；
 * 5. 写入同步记录（由 applyDiffToSheet 内部完成）。
 *
 * @param onProgress 进度回调
 * @param strategy 同步策略，默认 'add-update'
 * @param signal 可选 AbortSignal，用于取消请求
 * @param conflictResolution 可选冲突解决决策列表
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误、未知 sourceType 时抛出
 */
export declare function syncFromRemote(onProgress?: (current: number, total: number, message: string) => void, strategy?: SyncStrategy, signal?: AbortSignal, conflictResolution?: ConflictResolution[]): Promise<GithubSyncResult>;
export {};
//# sourceMappingURL=syncSourceRegistry.d.ts.map