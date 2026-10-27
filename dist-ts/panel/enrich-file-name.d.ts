/**
 * @fileoverview 富化页文件名工具
 * @module panel/enrich-file-name
 * @description
 *   `extractFileName` 原本定义在 `enrich-page.ts` 的「批量富化」区块里，但
 *   「文件选择」「表头自动识别」「工作簿变化监听」等区块都在用它。抽成叶子
 *   模块后，这些区块才能各自独立成文件而不必反向依赖 `enrich-page.ts`。
 */
/** 从文件路径提取文件名（同时处理 / 与 \ 两种分隔符） */
export declare function extractFileName(filePath: string): string;
//# sourceMappingURL=enrich-file-name.d.ts.map