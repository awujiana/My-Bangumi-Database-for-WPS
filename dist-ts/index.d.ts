/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口。
 *              其他模块只需 `import { ... } from '../types/index.js'`
 *              即可获取所有核心功能与类型，降低模块间耦合。
 */
export { ErrorLevel, type ErrorOptions, WPS_ENUM, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS, COLUMN_RULES, HEADER_KEYWORDS, IMPORTANT_COLS, FIELD_NAME_MAP, URL_PATTERNS, TOKEN_CONFIG, WATCH_STATUS_MAP, COLUMNS, SYNC_RECORD_SHEET_NAME, SYNC_RECORD_COLUMNS } from './core/constants.js';
export { BgmError, Result, type BatchSyncResult, } from './core/result.js';
export { calcChecksum, extractToken, encryptToken, decryptToken, } from './core/crypto.js';
export { httpRequest, type HttpMethod, } from './tools/http.js';
export { showAlert, // 提示
showConfirm, // 确认
showError, // 错误
showSuccess, // 成功
showInput, // 输入
showToast, } from './ui/dialog.js';
export { type DialogButton, type DialogConfig, type DialogCallback, type DialogOptions, } from './ui/dialog.js';
export { setStatus, initMessageListener, setSyncRunning, } from './ui/message.js';
export { showUserIdDialog, markUploadedItems, clearSheetMarks, updateTokenStatus, updateUserIdStatus, showTokenDialog, testDebugConnection, syncCollectionFromBgm } from './ui/handlers.js';
export { getOrCreateSyncRecordSheet, getAllSyncRecords, addSyncRecord, openSyncRecordSheet, clearSheetMarksInSheet, type SyncRecord, type UpdateRecordParams, clearSyncRecords, } from './sync/syncRecord.js';
export { extractSubjectId, getFilterStatus, getSequentialRowsBySeqCol, SyncToBangumiAsync, clearRowColors, testSingleUpdate, mapWatchStatus, buildJsonPayload, bgmRequestSync, setBangumiToken, openBangumiTokenPage, testTokenValidityForRibbon, openUserCollection, buildTagsArray, addTagsFromStr, } from './sync/exceltobangumi.js';
export { verifyToken, fetchAllUserCollections, type BangumiUserData, type TokenVerifyResult, type ApiResponse, } from './sync/scraping.js';
export { bgmLog, getApp, colNumToLetter, getCell, getCellValue, readCell, setCellValue, getSheetByIndex, escapeHtml, storeBgToken, clearBgToken, loadBgToken, _getBgmUserId, _setBgmUserId, fetchBgmUserInfo, trim, BGM, _getUserApiPath, _fetchBgmUserInfo, showBangumiPanel, sleep, delay, readRangeValues, getColumnMap, cacheGet, clearSheetCache, getLastRow, isEmptyValue, getDataSheet, findHeaderRow, shellExecuteByOAAssist, GetUrlPath, calcFingerprint } from './tools/util.js';
export interface BGMCache {
    /** WPS 文档总行数缓存 */
    totalRows: number;
    /** 当前用户 ID */
    userId: string | null;
    /** 当前用户名 */
    username: string | null;
    /** Subject ID 缓存（sid → 行号） */
    sidCache: Map<string, string>;
    /** 列表缓存（通用数据） */
    listCache: unknown[];
}
export interface BGMSheet {
    /** 锁定的工作表索引 */
    lockedIndex: number | null;
    /** 锁定的工作表名称 */
    lockedName: string | null;
    /** 是否已锁定 */
    isLocked: boolean;
}
export interface BGMSync {
    /** 是否正在同步 */
    isRunning: boolean;
    /** 上次同步时间（ISO 格式） */
    lastSyncTime: string | null;
    /**
    * 启动同步流程（由“全面同步”按钮触发）
    * - 防重复：如果 isRunning === true 则提示并返回
    * - 检查 BGM.dataPreview 是否已加载
    * - 调用 preview.ts 中的 syncAllRows() 执行批量上传
    */
    startSync: () => void;
}
export interface BGMUserInfo {
    /** 用户 ID */
    id: string;
    /** 用户名 */
    username: string;
}
export { refreshSheets, toggleSheetLock, refreshData, } from './taskpane.js';
export type { DetailItem, PreviewItem, DetailPreviewData, } from './ui/preview.js';
export { previewSyncContent, closeDetailModal, syncAllRows, } from './ui/preview.js';
export { isWpsApp, isWpsWorksheet, isWpsRange, wpsMsgBox, } from './tools/wps.js';
export type { BgmWindow, WpsApplication, WpsWorkbook, WpsWorksheets, WpsSheets, WpsWorksheet, WpsRows, WpsRow, WpsColumns, WpsRange, WpsAutoFilter, WpsFilters, WpsFilter, WpsInterior, WpsFont, WpsAreas, WpsPluginStorage, WpsOAAssist, WpsTaskPane, } from './tools/wps.js';
export { detectConflicts, getSyncPreview } from './services/ribbonService.js';
//# sourceMappingURL=index.d.ts.map