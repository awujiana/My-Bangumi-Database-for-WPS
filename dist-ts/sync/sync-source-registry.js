/**
 * @fileoverview 同步源注册表与调度入口
 * @module sync/syncSourceRegistry
 * @description 统一管理所有 SyncSource 实现的注册、查询与统一同步入口。
 *
 * 设计目的：
 * - 新增数据源只需实现 SyncSource 接口并调用 registerSyncSource(type, factory)
 * - syncFromRemote 按 sourceType 从注册表获取对应实现，委托 remote-sync-core.ts 的
 *   runRemoteSync 完成下载、diff、应用（2026-10-17 起主流程收敛至 core，本文件
 *   只保留取源与入口级参数）
 * - githubSync.ts 只负责 GitHub 源实现与取数，不再反向依赖注册表，
 *   从而打破 githubSync.ts ↔ syncSourceRegistry.ts 的循环依赖。
 */
import { GistSyncSource } from './gist-sync.js';
import { GiteeSyncSource } from './gitee-sync.js';
import { getSyncSourceType } from './github-config.js';
import { GithubSyncSource } from './github-sync.js';
import { GitlabSyncSource } from './gitlab-sync.js';
import { LocalFileSyncSource } from './local-file-sync.js';
import { runRemoteSync } from './remote-sync-core.js';
/** 阶段名随编排层一起对外，保证弹窗与推进用同一份下标 */
export { REMOTE_SYNC_PHASES } from './remote-sync-core.js';
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
    return [...registry.keys()];
}
/**
 * 判断同步源是否已注册
 * @param type 同步源类型标识
 */
export function isSyncSourceRegistered(type) {
    return registry.has(type);
}
/**
 * 统一远程同步入口（薄壳）
 *
 * 2026-10-17 结构合并：按 sourceType 取源后的主流程已收敛到 remote-sync-core.ts 的
 * runRemoteSync，本函数只保留「取源 + 入口级参数」。
 *
 * @param onProgress 进度回调
 * @param strategy 同步策略，默认 'add-update'
 * @param signal 可选 AbortSignal，用于取消请求
 * @param shouldUseSelectedRowsOnly 仅同步选中行
 * @param conflictResolution 可选冲突解决决策列表
 * @param timeFilter 时间筛选条件
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误、未知 sourceType 时抛出
 */
export async function syncFromRemote(onProgress, strategy = 'add-update', signal, shouldUseSelectedRowsOnly, conflictResolution, timeFilter, mapping) {
    // 1. 按 sourceType 从注册表获取 SyncSource 实例
    const sourceType = getSyncSourceType();
    const source = getSyncSource(sourceType);
    if (!source) {
        throw new Error(`未知的同步源类型: ${sourceType}`);
    }
    // 2. 主流程（校验 / 下载 / diff / apply / 体检 / 收尾）统一在 remote-sync-core
    return runRemoteSync({
        source,
        logTag: 'syncFromRemote',
        validationFailedMessage: `同步源 ${sourceType} 配置校验失败`,
        onProgress,
        strategy,
        signal,
        shouldUseSelectedRowsOnly,
        conflictResolution,
        timeFilter,
        mapping,
    });
}
// 默认注册所有同步源
// 各实现类模块仅被注册表依赖，不反向依赖注册表，避免循环依赖
registerSyncSource('github', () => new GithubSyncSource());
registerSyncSource('gitlab', () => new GitlabSyncSource());
registerSyncSource('gitee', () => new GiteeSyncSource());
registerSyncSource('local', () => new LocalFileSyncSource());
registerSyncSource('gist', () => new GistSyncSource());
