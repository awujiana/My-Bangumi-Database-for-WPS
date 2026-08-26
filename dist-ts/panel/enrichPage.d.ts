/**
 * @fileoverview 富化页面的 UI 控制器
 * @module panel/enrich
 * @description 负责文件选择、表头识别、列映射编辑、匹配预览、富化执行与进度、富化记录查看。
 */
import { type EnrichColumnMapping, type MatchResult, type EnrichProgress, type ConflictInfo } from '../sync/enrichEngine.js';
import type { WpsWorksheet } from '../tools/wps.js';
interface EnrichPageState {
    filePath: string;
    newAnimeSheet: WpsWorksheet | null;
    bangumiSheet: WpsWorksheet | null;
    columnMapping: EnrichColumnMapping | null;
    headerRow: number;
    dataStartRow: number;
    matches: MatchResult[];
    isEnriching: boolean;
    cancelRequested: boolean;
    pendingConflicts: ConflictInfo[];
    currentConflictIndex: number;
}
declare const state: EnrichPageState;
declare const COLUMN_MAPPING_FIELDS: {
    key: keyof EnrichColumnMapping;
    label: string;
    required: boolean;
}[];
export declare function initEnrichPage(): void;
export declare function selectNewAnimeFile(): void;
export declare function autoDetectHeader(): void;
export declare function previewMatch(): void;
export declare function startEnrichment(): void;
declare function cancelEnrichment(): void;
export declare function openEnrichRecordSheet(): void;
export declare function clearRecords(): void;
export declare function renderPreviewTable(container: HTMLElement | null, sheet: WpsWorksheet, _mapping: EnrichColumnMapping, maxRows?: number): void;
export declare function renderMatchResults(container: HTMLElement | null, matches: MatchResult[]): void;
export declare function renderProgress(progress: EnrichProgress): void;
export { state, cancelEnrichment, COLUMN_MAPPING_FIELDS };
//# sourceMappingURL=enrichPage.d.ts.map