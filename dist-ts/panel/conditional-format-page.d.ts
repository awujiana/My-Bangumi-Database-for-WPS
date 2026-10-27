/**
 * @fileoverview 条件格式管理页 UI 控制器
 * @module panel/conditionalFormatPage
 * @description 「条件格式管理」独立页：任意工作表可选、规则搜索/分组/隐藏/排序/
 *   复制粘贴/编辑、默认规则集生成、应用（默认**增量**：只增改插件自己那份规则，
 *   不清除表上既有规则；另有显式「清空整表后应用」走确认弹框）。
 *
 * 本页面只做渲染与编排，判断逻辑全在纯函数引擎（conditional-format-rules.ts），宿主交互全在
 * conditional-format-apply.ts——单测覆盖在那一层，页面保持薄。
 */
export declare function initializeConditionalFormatPage(): void;
//# sourceMappingURL=conditional-format-page.d.ts.map