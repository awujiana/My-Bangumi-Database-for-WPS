/**
 * @fileoverview 富化记录视图：打开/清空富化记录工作表，并渲染最近记录列表。
 * @module panel/enrich-record-view
 * @description
 *   从 `enrich-page.ts` 切出的独立流程块。`enrich-page.ts` 是富化页的 UI 控制器，
 *   本块只依赖共享上下文（`enrich-page-context.js`）与外部模块，**不反向依赖源文件**。
 */
export declare function openEnrichRecordSheet(): void;
export declare function clearRecords(): void;
export declare function loadRecentRecords(): void;
//# sourceMappingURL=enrich-record-view.d.ts.map