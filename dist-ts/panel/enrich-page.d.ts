/**
 * @fileoverview 富化页面的 UI 控制器
 * @module panel/enrichPage
 * @description 负责文件选择、表头识别、列映射编辑、匹配预览、富化执行与进度、富化记录查看。
 */
export declare function initializeEnrichPage(): void;
export declare function selectNewAnimeFile(): void;
export declare function autoDetectHeader(): void;
export declare function startEnrichment(): void;
/**
 * 请求取消当前富化。
 * 仅置位标记，真正停止由 `enrichEntries` 在条目循环边界检查后返回；已写入的部分保留（不回滚）。
 */
declare function cancelEnrichment(): void;
/**
 * 批量文件选择入口（已废弃）
 * @deprecated 自 2026-08-30 起，"选择文件"按钮已合并为单/多选统一入口。
 *   该函数仅作向后兼容保留，不再被任何 UI 触发；新逻辑在 selectNewAnimeFile() 中。
 */
export declare function batchSelectFiles(): void;
/** 批量富化主入口 */
export declare function batchStartEnrichment(): void;
export { state } from './enrich-page-context.js';
export { cancelEnrichment };
export { openEnrichRecordSheet, clearRecords } from './enrich-record-view.js';
export { previewMatch } from './enrich-preview-flow.js';
//# sourceMappingURL=enrich-page.d.ts.map