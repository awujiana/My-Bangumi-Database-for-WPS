/**
 * @fileoverview 富化预览单元格渲染（着色工具）
 * @module panel/enrich-preview-cell
 * @description TAGS / 首播 / 平台按内容稳定配色，以及数据预览单元格 HTML 生成。
 *              自 panel/enrich-page.ts 抽出（P1-G），保持纯逻辑以便单测（P1-H）。
 */
import type { ScalarMappingKey } from './enrich-page-state.js';
/** 平台徽章单元格：parts 已去空去重（含噪声过滤），逐个渲染 platform-chip（可按名着色） */
export declare function renderPlatformChipsCell(parts: string[]): string;
/** 数据预览单元格渲染：名称加粗、周更/播放平台以徽章形式展示 */
export declare function renderPreviewCell(fieldKey: ScalarMappingKey, rawValue: string): string;
//# sourceMappingURL=enrich-preview-cell.d.ts.map