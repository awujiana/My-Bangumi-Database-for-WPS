/**
 * @fileoverview 同步 apply 阶段：读取本地条目，把差异写入 Excel 工作表
 * @module sync/remoteSyncApply
 * @description 2026-10-17 结构合并：本模块自 `github-sync.ts` 整体迁入（逐字保留
 *              注释、边界处理与日志），收录「比对完成后落盘」的全部逻辑：
 *                · readLocalEntriesForSync    本地条目读取（批量矩形读 + 逐格回退）
 *                · applyConflictResolutions   按用户冲突决策裁剪 update diff
 *                · applyDiffToSheet           新增/更新/删除写入 + undo + 同步记录
 *              及上述函数的私有辅助（批量写、逐字段回退、删除快照等）。
 *
 *              与 `remote-sync-core.ts`（runRemoteSync 统一编排）**必须分成两个模块**：
 *              `vi.mock` 截不住模块内调用，apply 与编排若同模块，sync-source-registry
 *              测试既有的「mock apply 三函数」接缝会整体失效（详见该测试的 mock 注释）。
 *
 *              入口为 remote-sync-core.ts；`github-sync.ts` 保留本模块导出的兼容
 *              re-export。日志 tag 保持 `[githubSync]` 逐字不变（检索连续性），
 *              编排层的 tag 另行参数化。
 */
import type { ConflictResolution, GithubSyncDiff, GithubSyncDetailItem, LocalRowEntry, RemoteEmptyFieldStat, SyncStrategy } from './github-sync-diff.js';
/** 同步结果统计 */
export interface GithubSyncResult {
    /** 远程总条目数 */
    remoteTotal: number;
    /** 新增条目数 */
    added: number;
    /** 更新条目数 */
    updated: number;
    /** 删除条目数（mirror 策略） */
    deleted: number;
    /** 无变更条目数 */
    unchanged: number;
    /** 跳过条目数（无 SID 或无效） */
    skipped: number;
    /** 失败条目数 */
    failed: number;
    /** 新增/更新/删除/失败明细（用于详情表格展示） */
    details?: GithubSyncDetailItem[];
    /**
     * 「远程有数据、本地却缺少对应表头」的字段名清单
     *
     * 写入时 safeSet 遇缺失列会静默 return，远程数据被无声丢弃；
     * 这里把这类字段挑出来，由结果弹窗提示用户自行添加对应列。
     */
    missingColumns?: string[]; /**
     * 分片拼接后因**缺少合法 subjectId** 被跳过的记录条数（>0 才出现）
     *
     * 与 `missingColumns` 同口径：链路内部原本只进 WARN 日志，用户看到的是
     * 「下载了 N 条、只同步了一部分」却说不出原因。缺合法 subjectId 的记录
     * （如数据文件混入表头行以外的坏行）会被静默跳过，这里显式计数
     * 由结果弹窗提示，数字大于 0 即说明数据源本身有脏数据。
     */
    skippedInvalidLines?: number;
    /**
     * 「本地该列为空、远程对应字段也为空」的统计（按本地列名聚合，降序）
     *
     * 与 `missingColumns` 同口径的第三种体检：`computeDiff` 对扩展字段讲究
     * 「远程没值就不视为差异」（不能用远程空值抹掉本地数据），这是对的，
     * 但完全静默——用户看到「同步成功」却无从区分「远程本来就没数据」和
     * 「同步没生效」。数据仓库里这类字段很常见（如 `播放结束` 仅约 25% 非空），
     * 因此只进完成弹窗、不弹 toast。
     */
    remoteEmptyFields?: RemoteEmptyFieldStat[];
}
/**
 * applyDiffToSheet 的列映射选项（同步前列映射确认的下游落地）
 *
 * 由 `remote-sync-core.ts` 从 `SyncMappingConfig` 构建：
 * - `excludedColumns`：用户取消同步的列（含别名闭包）→ 从 columnMap 摘除
 * - `columnRemap`：默认列名 → 目标列号（改映射）→ 替换默认列的列号
 */
export interface ApplyMappingOptions {
    /** 取消同步的列名集合（含别名闭包） */
    excludedColumns?: ReadonlySet<string> | undefined;
    /** 默认列名 → 用户选定的目标列号 */
    columnRemap?: ReadonlyMap<string, number> | undefined;
}
/**
 * 内部读取本地条目（供外部调用，封装为纯函数入口）
 *
 * 边界情况处理：
 * - 工作表无效（worksheet 为 null）：返回 null，调用方应抛出错误
 * - 无 Bangumi_URL 列（空文档或表头未识别）：返回空 entries + lastRow=0
 *   调用方 computeDiff 会将所有远程条目视为新增
 */
export declare function readLocalEntriesForSync(): {
    entries: Map<string, LocalRowEntry>;
    lastRow: number;
} | null;
/**
 * 把**降序**行号的删除项按「连续」分组成 run（每组一次 `Range(max:min).Delete()`）
 *
 * 为什么：删除阶段原来是 n 个待删行 = n 次 COM `Delete`，每次宿主都要做行位移与
 * 内部数据搬运（性能审计 2026-10-24 P1：删除阶段明显慢于新增/更新）。连续行合并后，
 * 成片的 stale 行从 n 次 COM 调用压成 1 次；完全散乱的行仍各自成组（一次删一行），
 * 与旧行为逐字一致——**永不比旧实现慢**。
 *
 * 语义等价性：连续块一次删 vs 逐行降序删，最终表状态相同（块内行全部消失、
 * 块下方向上平移块大小）。非连续行各自成组，走原来的逐行路径。
 *
 * @param items 删除项（**必须已按行号降序**——调用方 deletedDiffs 已排过）
 * @param rowOf 取行号；同行的多项会各自成组（行号相同不连续）
 * @returns 每组保持降序；组内首元素是块内最大行、末元素是最小行
 */
export declare function groupContiguousDeleteRuns<T>(items: readonly T[], rowOf: (item: T) => number): T[][];
/**
 * 应用 diff 到 Excel 工作表
 *
 * 取消（P2-7）：`signal` 在**写入阶段同样生效**。每批写入前检查一次，已写入的部分
 * 保持既定状态（同步记录 / undo 栈 / 颜色都按实际写入量收敛，不回滚），未处理的
 * 条目计入 `result.skipped`。原先 signal 只作用于下载阶段，用户点「停止」后写入
 * 仍会跑完，进度状态与实际不一致。
 *
 * @param diffs 差异列表
 * @param strategy 同步策略（决定 force-overwrite 与 delete 行为）
 * @param onProgress 进度回调（current, total, message, eta）
 * @param source 同步来源显示名称（如 GitHub/GitLab/Gitee），用于写入同步记录
 * @param signal 可选 AbortSignal，用于取消写入
 * @returns 同步结果统计
 */
export declare function applyDiffToSheet(diffs: GithubSyncDiff[], strategy: SyncStrategy, onProgress?: (current: number, total: number, message: string, eta?: string) => void, source?: string, signal?: AbortSignal, options?: ApplyMappingOptions): Promise<GithubSyncResult>;
/**
 * 根据用户冲突解决决策调整 diff 列表
 *
 * 处理规则：
 * - 仅作用于 kind === 'update' 且 changedFields 不为 ['*'] 的 diff（字段级更新）
 * - 对每个 resolution，找到 subjectId 与 field 匹配的 update diff：
 *   - chosenValue === 'local'：从 changedFields 中移除该 field（保留本地值）
 *   - chosenValue === 'remote'：保留该 field 在 changedFields 中（采用远程值）
 * - 若 update diff 的 changedFields 被清空，则从 diffs 中移除该 diff（无字段需更新）
 * - add/delete 与 force-overwrite（changedFields 为 ['*']）不受影响
 *
 * 本函数直接修改传入的 diffs 数组（in-place），同时返回该数组便于链式调用。
 *
 * @param diffs 差异列表（会被原地修改）
 * @param resolutions 用户冲突解决决策列表
 * @returns 调整后的差异列表（与输入为同一引用）
 */
export declare function applyConflictResolutions(diffs: GithubSyncDiff[], resolutions: ConflictResolution[]): GithubSyncDiff[];
//# sourceMappingURL=remote-sync-apply.d.ts.map