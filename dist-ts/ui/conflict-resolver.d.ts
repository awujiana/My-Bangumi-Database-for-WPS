/**
 * @fileoverview 冲突解决 UI 组件
 * @module ui/conflictResolver
 *
 * @description
 * 在 GitHub 仓库同步流程中，当远程条目与本地 Excel 行存在字段级差异时，
 * 弹出模态对话框让用户逐字段选择保留本地值或采用远程值。
 *
 * 设计要点：
 * - 纯 DOM API 构建，无第三方依赖，兼容 WPS 内嵌浏览器
 * - 所有动态文本均使用 textContent（防 XSS）
 * - 返回 Promise<ConflictResolution[] | null>：
 *   - 用户点击「确认」返回解决决策数组（可能为空数组，表示无冲突）
 *   - 用户点击「取消」返回 null，调用方应中止同步
 * - 模态框关闭后立即从 DOM 移除，避免残留监听器
 */
import type { Conflict, ConflictResolution } from '../services/ribbon-service.js';
/**
 * 显示冲突解决对话框
 *
 * @param conflicts 冲突列表（来自 detectGithubConflicts）
 * @returns 用户的解决决策；若用户取消则返回 null；空冲突列表直接返回空数组
 */
export declare function showConflictResolver(conflicts: Conflict[]): Promise<ConflictResolution[] | null>;
//# sourceMappingURL=conflict-resolver.d.ts.map