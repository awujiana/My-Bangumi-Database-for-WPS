/**
 * @fileoverview 远程同步统一编排（各入口共用的主流程）
 * @module sync/remoteSyncCore
 * @description 2026-10-17 结构合并：`syncFromRemote`（sync-source-registry.ts）与
 *              `syncFromGithub`（github-sync.ts）的主体曾逐字重复约 150 行，收敛为
 *              本模块的 {@link runRemoteSync}。两者的历史差异（source 获取方式、
 *              校验失败文案、日志 tag、耗时格式）全部参数化，由两个薄入口各自传入。
 *
 *              流程：校验配置 → 按表头推导所需字段（时间筛选启用时补 date）→ 下载 →
 *              关闭屏幕刷新 → 空文档表头填充 / 选中行过滤 / 时间筛选 → 读本地 →
 *              diff → 冲突决策 → applyDiffToSheet → 缺列与脏数据体检 → 汇总收尾。
 *
 *              apply 阶段在 `remote-sync-apply.ts`：`vi.mock` 截不住模块内调用，
 *              apply 与编排必须分模块才能保住 registry 测试的 mock 接缝。
 *
 *              进度与日志口径以 sync-source-registry 版为基准：进度分母
 *              0/1 → 1/3 → 2/3 → 3/3，编排层耗时一律裸毫秒 `${ms}ms`
 *              （apply 阶段内部的 formatDuration 文案不变）。
 */
import type { ConflictResolution, SyncStrategy, SyncTimeFilter } from './github-sync-diff.js';
import type { GithubSyncResult } from './remote-sync-apply.js';
import type { SyncMappingConfig } from './sync-mapping.js';
import type { SyncSource } from './sync-source.js';
/**
 * 远程同步的阶段名（供进度弹窗的阶段时间线）。
 *
 * 导出给调用方：弹窗由 `showSyncProgressDialog` 打开（UI 层），阶段推进由本模块
 * 做（编排层），两边必须用同一份下标，否则时间线会跳错。
 */
export declare const REMOTE_SYNC_PHASES: readonly string[];
/** {@link runRemoteSync} 入参：两个薄入口的历史差异全部在此参数化 */
export interface RunRemoteSyncParameters {
    /** 同步源实例（入口负责按 sourceType 从注册表取，或直接 new） */
    source: SyncSource;
    /** 编排层日志 tag（入口名，如 'syncFromRemote' / 'syncFromGithub'） */
    logTag: string;
    /** validateConfig 失败且 error.message 缺失时的兜底文案 */
    validationFailedMessage: string;
    /** 进度回调（current, total, message, eta） */
    onProgress?: ((current: number, total: number, message: string, eta?: string) => void) | undefined;
    /** 同步策略，默认 'add-update' */
    strategy?: SyncStrategy | undefined;
    /** 可选 AbortSignal，用于取消请求（下载与写入阶段均生效） */
    signal?: AbortSignal | undefined;
    /** 仅同步选中行 */
    shouldUseSelectedRowsOnly?: boolean | undefined;
    /** 冲突解决决策列表；提供时按用户选择过滤 update diff 的字段 */
    conflictResolution?: ConflictResolution[] | undefined;
    /** 时间筛选条件 */
    timeFilter?: SyncTimeFilter | undefined;
    /**
     * 同步前列映射确认结果（2026-10-17）
     *
     * 用户在确认框里取消同步的列 / 改映射的目标列。undefined = 未经确认框
     * （既有调用方与测试的行为与从前逐字一致）。
     */
    mapping?: SyncMappingConfig | undefined;
}
/**
 * 统一远程同步编排
 *
 * 步骤：
 * 1. `source.validateConfig()` 校验配置（失败抛出，文案取 validationFailedMessage）
 * 2. `collectNeededFieldsFromSheet()` 按表头推导所需字段；时间筛选启用时补 `date`
 * 3. `source.fetchRemoteEntries()` 下载远程条目
 * 4. 关闭屏幕刷新 / 自动计算（`finally` 恢复）
 * 5. applyRemoteEntries：空文档表头填充 → 选中行过滤 → 时间筛选 → 读本地 →
 *    computeDiff → applyConflictResolutions → applyDiffToSheet → 缺列体检 →
 *    脏数据体检 → 汇总进度与日志
 *
 * @param parameters 见 {@link RunRemoteSyncParameters}
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误、本地工作表不可读时抛出
 */
export declare function runRemoteSync(parameters: RunRemoteSyncParameters): Promise<GithubSyncResult>;
//# sourceMappingURL=remote-sync-core.d.ts.map