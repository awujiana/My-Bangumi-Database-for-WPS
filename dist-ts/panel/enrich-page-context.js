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
// ========== 状态 ==========
export const state = {
    filePath: '',
    animeSourceSheet: null,
    bangumiSheet: null,
    columnMapping: null,
    headerRow: 0,
    dataStartRow: 0,
    matches: [],
    activePreviewTab: 'source',
    hasSourcePreview: false,
    isEnriching: false,
    cancelRequested: false,
    pendingConflicts: [],
    currentConflictIndex: 0,
    batchFiles: [],
    batchResults: [],
    batchIndex: 0,
    isBatchEnriching: false,
    batchCancelRequested: false,
    enrichDetailGroups: [],
    sourceWorkbook: null,
    isSourceWorkbookOpenedByUs: false,
    introContext: null,
    closeSourceAfterDetect: false,
};
// ========== 工具函数 ==========
export function safeGetElement(id) {
    return document.getElementById(id);
}
export function safeGetButton(id) {
    const element = document.getElementById(id);
    return element instanceof HTMLButtonElement ? element : null;
}
export function safeGetSelect(id) {
    const element = document.getElementById(id);
    return element instanceof HTMLSelectElement ? element : null;
}
export function safeGetCheckbox(id) {
    const element = document.getElementById(id);
    return element instanceof HTMLInputElement ? element : null;
}
