/**
 * 增量同步 / 冲突策略 UI 绑定
 * @module ui/handlers/incremental-bindings
 * @description 从 handlers/index.ts 抽出：增量同步与跳过冲突的复选框回写（含重试）、
 *              冲突策略单选切换、同步记录开关回写，以及从 Ribbon 恢复初始状态。
 */
export declare function tryUpdateIncrementalCheckbox(isChecked: boolean): void;
export declare function tryUpdateSkipConflictsUI(shouldSkipConflicts: boolean, attempts?: number): void;
export declare function tryUpdateEnableSyncRecordUI(isEnabled: boolean): void;
export declare const handleIncrementalChange: () => void;
export declare const handleConflictStrategyChange: () => void;
export declare const handleSkipRadioChange: () => void;
export declare const handleOverwriteRadioChange: () => void;
export declare const handleChkSkipConflictsChange: () => void;
export declare function initializeIncrementalSyncFromRibbon(): void;
export declare function initializeSkipConflictsFromRibbon(): void;
//# sourceMappingURL=incremental-bindings.d.ts.map