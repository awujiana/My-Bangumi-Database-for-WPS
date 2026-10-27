/**
 * @fileoverview 富化预览流程：表头识别与列映射编辑、源数据预览、多新番表工作簿切换、匹配预览与匹配详情弹窗。
 * @module panel/enrich-preview-flow
 * @description
 *   从 `enrich-page.ts` 切出的独立流程块。`enrich-page.ts` 是富化页的 UI 控制器，
 *   本块只依赖共享上下文（`enrich-page-context.js`）与外部模块，**不反向依赖源文件**。
 */
import type { EnrichColumnMapping } from '../sync/enrich-layout.js';
import type { WpsWorksheet } from '../tools/wps.js';
/**
 * 在指定工作表上识别表头并写入 state（不负责工作簿的打开/关闭）。
 * @returns 识别成功返回列映射；失败返回 null
 */
export declare function detectHeaderOnSheet(worksheet: WpsWorksheet, label: string): EnrichColumnMapping | null;
/**
 * 匹配预览。
 * @param options.keepSourceOpen 为 true 时预览结束不回收源工作簿
 *   （富化流程内部调用时使用：调用方还持有工作表引用，关闭会使其失效）
 */
export declare function previewMatch(options?: {
    keepSourceOpen?: boolean;
}): void;
export declare function hideMatchDetail(): void;
//# sourceMappingURL=enrich-preview-flow.d.ts.map