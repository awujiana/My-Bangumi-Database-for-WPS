/**
 * @fileoverview 条件格式管理页 UI 控制器
 * @module panel/conditionalFormatPage
 * @description 「条件格式管理」独立页：任意工作表可选、规则搜索/分组/隐藏/排序/
 *   复制粘贴/编辑、默认规则集生成、双策略应用（应用前读手工规则快照，弹模态框
 *   列出范围+公式，用户选「清掉后应用」或「保留手工规则」）。
 *
 * 本页面只做渲染与编排，判断逻辑全在纯函数引擎（conditional-format-rules.ts），宿主交互全在
 * conditional-format-apply.ts——单测覆盖在那一层，页面保持薄。
 */
export declare function initializeConditionalFormatPage(): void;
//# sourceMappingURL=conditional-format-page.d.ts.map