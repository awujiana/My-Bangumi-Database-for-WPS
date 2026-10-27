/**
 * @fileoverview 富化结果视图：富化完成后的自动合并去重，以及「富化详细结果」弹窗的显示/隐藏。
 * @module panel/enrich-result-view
 * @description
 *   从 `enrich-page.ts` 切出的独立流程块。`enrich-page.ts` 是富化页的 UI 控制器，
 *   本块只依赖共享上下文（`enrich-page-context.js`）与外部模块，**不反向依赖源文件**。
 */
/**
 * 富化完成后按设置自动执行「合并去重」清洗（设置页「富化预览」可关闭）。
 * 只清洗目标 Bangumi 表：按名称分组保留含 URL 的行、合并标签、删除重复行。
 * 失败仅记录日志与提示，不中断主流程。
 */
export declare function maybeAutoCleanAfterEnrich(): void;
export declare function showEnrichDetailButton(): void;
export declare function showEnrichDetail(): void;
export declare function hideEnrichDetail(): void;
//# sourceMappingURL=enrich-result-view.d.ts.map