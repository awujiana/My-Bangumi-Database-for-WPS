/**
 * @fileoverview 冲突对话框：收集富化产生的字段冲突，逐个展示并回写用户选择的解决策略。
 * @module panel/enrich-conflict-dialog
 * @description
 *   从 `enrich-page.ts` 切出的独立流程块。`enrich-page.ts` 是富化页的 UI 控制器，
 *   本块只依赖共享上下文（`enrich-page-context.js`）与外部模块，**不反向依赖源文件**。
 */
import type { ConflictInfo, EnrichResultItem } from '../sync/enrich-types.js';
export declare function collectAllConflicts(results: EnrichResultItem[]): ConflictInfo[];
/** 静态对话框按钮只需绑定一次（不再随每次展示重建 DOM） */
export declare function bindConflictDialogButtons(): void;
export declare function showConflictDialog(): void;
//# sourceMappingURL=enrich-conflict-dialog.d.ts.map