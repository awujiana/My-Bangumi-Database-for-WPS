/**
 * UI 事件处理模块 - 同步相关
 * @module ui/handlers/sync
 * @description 从面板同步到 Bangumi、从 BGM API 同步收藏标记等。
 */
export declare function syncFromPanel(): Promise<void>;
export declare function syncCollectionFromBgm(): void;
export declare function syncFromBgmByAPI(sheetIndex: number, type?: 'collect' | 'wish' | 'do' | null): void;
//# sourceMappingURL=sync.d.ts.map