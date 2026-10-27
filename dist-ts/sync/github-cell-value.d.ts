/**
 * @fileoverview GitHub 同步的单单元格写入值解析（纯函数）
 * @module sync/githubCellValue
 * @description 从 `github-sync.ts` 抽出的纯逻辑：给定「目标列名 + 远程条目 + 字段筛选」
 *              计算应写入的值与写入标记。封装「新增行取值」与「更新行取值（含名称/标签合并策略）」
 *              两套规则，零 WPS / DOM 依赖，可在 Node 测试环境直接运行。
 *
 * @remarks 别名列映射依赖 `github-sync-diff.js`（零依赖纯模块），无循环风险。
 */
import type { GithubRemoteEntry } from './github-sync-diff.js';
/**
 * 解析新增行的单个单元格写入值（扩展字段支持别名列映射）
 *
 * 独立辅助函数：避免批量写入循环内的嵌套 switch/loop break
 */
export declare function resolveNewRowCellValue(wc: {
    name: string;
}, entry: {
    remote: GithubRemoteEntry;
}): string | number | null;
/**
 * 解析更新行的单个单元格新值与写入标记（支持别名列映射与合并策略）
 *
 * 独立辅助函数：避免批量更新循环内的嵌套 switch/loop break
 */
export declare function resolveUpdateCellValue(wc: {
    name: string;
}, remote: GithubRemoteEntry, fields: string[], isWriteAll: boolean, shouldForceOverwrite: boolean, oldCellValue: string): {
    value: string | number | null;
    shouldWrite: boolean;
};
//# sourceMappingURL=github-cell-value.d.ts.map