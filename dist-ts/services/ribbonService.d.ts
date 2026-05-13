/**
 * 获取同步预览统计（不发送请求，仅扫描 Excel）
 * @param ws 工作表对象
 * @param colMap 列映射
 * @param lastRow 数据最后一行
 * @param headerRow 表头行
 * @param options 可选参数 { incremental: boolean }
 * @returns 统计信息 { total, valid, willSync, willSkip, alreadyUploaded, noUrl, emptyStatus }
 */
export declare function getSyncPreview(ws: any, colMap: Map<string, number>, lastRow: number, headerRow: number, options?: {
    incremental?: boolean;
    fingerprintMap?: Map<string, string>;
}): {
    total: number;
    valid: number;
    willSync: number;
    willSkip: number;
    alreadyUploaded: number;
    noUrl: number;
    emptyStatus: number;
    incrementalSkipped: number;
};
/**
 * 异步检测 Excel 与 Bangumi 收藏之间的冲突
 * @returns 包含冲突条目列表及统计信息的对象
 */
export declare function detectConflicts(ws: any, colMap: Map<string, number>, lastRow: number, headerRow: number, token: string): Promise<{
    conflicts: Array<{
        row: number;
        sid: string;
        name: string;
        existingType?: number;
        newType: number;
    }>;
    conflictCount: number;
    bgmCollectionReady: boolean;
}>;
/**
 * Ribbon 专用的完整同步流程：预览 → 冲突检测 → 确认 → 执行
 * @param conflictResolution 冲突处理策略，默认 'excel'（覆盖）
 */
export declare function syncWithConfirmation(): Promise<void>;
/** 设置 Token（Ribbon 版本） */
export declare function setTokenForRibbon(): Promise<boolean>;
/** 测试 Token（Ribbon 版本） */
export declare function testTokenForRibbon(): void;
/** 设置用户 ID（Ribbon 版本） */
export declare function setUserIdForRibbon(): void;
/** 打开收藏页面（Ribbon 版本） */
export declare function openCollectionForRibbon(): void;
//# sourceMappingURL=ribbonService.d.ts.map