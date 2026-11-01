/**
 * 面板上下文判定
 * @module ui/handlers/sync-panel-context
 * @description 从 handlers/index.ts 抽出：判定当前任务窗格是否为 sync-panel.html。
 */
export function isPanelContext() {
    return typeof window !== 'undefined' && window.location.pathname.includes('sync-panel.html');
}
