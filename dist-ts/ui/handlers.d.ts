/**
 * UI 事件处理模块
 * @module ui/handlers
 * @description 面板操作处理、按钮绑定、业务对话框
 */
export declare function showTokenDialog(currentToken?: string): void;
export declare function showUserIdDialog(): void;
export declare function updateTokenStatus(): void;
export declare function updateUserIdStatus(): void;
export declare function openUserCollection(): void;
export declare function testTokenValidity(): void;
export declare function testDebugConnection(): void;
export declare function onAction(action: string): void;
export declare function syncFromPanel(): Promise<void>;
export declare function showStopButton(): void;
export declare function hideStopButton(): void;
export declare function testSingleUpdateFromPanel(): void;
export declare function syncCollectionFromBgm(): Promise<void>;
export declare function syncFromBgmByAPI(sheetIndex: number): Promise<void>;
export declare function markUploadedItems(sheetIndexOrName: number | string, collections?: unknown[]): Promise<void>;
//# sourceMappingURL=handlers.d.ts.map