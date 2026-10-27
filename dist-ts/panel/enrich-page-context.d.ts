/**
 * @fileoverview 富化页共享上下文：页面状态单例 + DOM 取元素工具
 * @module panel/enrich-page-context
 * @description
 *   从 `enrich-page.ts` 抽出的**被所有富化子流程共享**的部分：
 *   `EnrichPageState` 的形状与其单例 `state`、批量结果类型、以及四个
 *   `safeGet*` 取值工具。抽出来的目的是让「文件选择 / 匹配预览 / 冲突对话框 /
 *   批量富化」等流程块能被切到独立模块而不必各自复制一份状态。
 *
 *   这里**只放数据与取元素**，不放流程逻辑，也不反向 import `enrich-page.ts`
 *   （会成环）。
 */
import type { IntroSheetContext } from '../sync/enrich-intro.js';
import type { EnrichColumnMapping } from '../sync/enrich-layout.js';
import type { ConflictInfo, MatchResult } from '../sync/enrich-types.js';
import type { WpsWorksheet, WpsWorkbook } from '../tools/wps.js';
import type { EnrichDetailGroup } from './enrich-detail-render.js';
export interface BatchFileResult {
    filePath: string;
    fileName: string;
    /** 识别到的表头行；0 表示未识别成功 */
    headerRow: number;
    matched: number;
    addedEntries: number;
    updatedEntries: number;
    unmatched: number;
    success: boolean;
    error?: string;
}
export interface EnrichPageState {
    filePath: string;
    animeSourceSheet: WpsWorksheet | null;
    bangumiSheet: WpsWorksheet | null;
    columnMapping: EnrichColumnMapping | null;
    headerRow: number;
    dataStartRow: number;
    matches: MatchResult[];
    /** 「数据预览」当前页签：source=新番表数据，match=匹配结果 */
    activePreviewTab: 'source' | 'match';
    /** 源数据预览是否已成功渲染（决定「查看详细数据表格」按钮是否可用） */
    hasSourcePreview: boolean;
    isEnriching: boolean;
    cancelRequested: boolean;
    pendingConflicts: ConflictInfo[];
    currentConflictIndex: number;
    batchFiles: string[];
    batchResults: BatchFileResult[];
    batchIndex: number;
    isBatchEnriching: boolean;
    batchCancelRequested: boolean;
    enrichDetailGroups: EnrichDetailGroup[];
    sourceWorkbook: WpsWorkbook | null;
    isSourceWorkbookOpenedByUs: boolean;
    introContext: IntroSheetContext | null;
    closeSourceAfterDetect: boolean;
}
export declare const state: EnrichPageState;
export declare function safeGetElement(id: string): HTMLElement | null;
export declare function safeGetButton(id: string): HTMLButtonElement | null;
export declare function safeGetSelect(id: string): HTMLSelectElement | null;
export declare function safeGetCheckbox(id: string): HTMLInputElement | null;
//# sourceMappingURL=enrich-page-context.d.ts.map