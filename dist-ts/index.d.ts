/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口。
 *              其他模块只需 `import { ... } from '../types/index.js'`
 *              即可获取所有核心功能与类型，降低模块间耦合。
 */
export { ErrorLevel, type ErrorOptions, WPS_ENUM, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS, } from './core/constants.js';
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
export { showUserIdDialog, markUploadedItems, clearSheetMarks, updateTokenStatus, updateUserIdStatus, showTokenDialog, testDebugConnection } from './ui/handlers.js';
export { getOrCreateSyncRecordSheet, getAllSyncRecords, addSyncRecord, openSyncRecordSheet, clearSheetMarksInSheet, type SyncRecord, type UpdateRecordParams, } from './sync/syncRecord.js';
export { findHeaderRow, getColumnMap, getLastRow, extractSubjectId, getFilterStatus, getSequentialRowsBySeqCol, SyncToBangumiAsync, clearRowColors, testSingleUpdate, mapWatchStatus, buildJsonPayload, bgmRequestSync, bgmRequest, setBangumiToken, openBangumiTokenPage, testTokenValidityForRibbon, openUserCollection, buildTagsArray, addTagsFromStr, getDataSheet, HEADER_KEYWORDS, IMPORTANT_COLS } from './sync/exceltobangumi.js';
export { verifyToken, fetchAllUserCollections, type BangumiUserData, type TokenVerifyResult, type ApiResponse, } from './sync/scraping.js';
export { bgmLog, getApp, colNumToLetter, getCell, getCellValue, readCell, setCellValue, getSheetByIndex, escapeHtml, storeBgToken, clearBgToken, loadBgToken, _getBgmUserId, _setBgmUserId, fetchBgmUserInfo, trim, BGM, _getUserApiPath, showBangumiPanel, sleep, } from './tools/util.js';
export type { BGMCache, BGMSheet, BGMSync, BGMUserInfo, } from './tools/util.js';
export { refreshSheets, toggleSheetLock, refreshData, fetchBgCollectionRecords, clearSyncRecords, markUploadedItemsDefault, clearSheetMarksDefault, } from './taskpane.js';
export type { DetailItem, PreviewItem, DetailPreviewData, } from './ui/preview.js';
export { previewSyncContent, closeDetailModal, } from './ui/preview.js';
export { isWpsApp, isWpsWorksheet, isWpsRange, wpsMsgBox, } from './tools/wps.js';
export type { BgmWindow, WpsApplication, WpsWorkbook, WpsWorksheets, WpsSheets, WpsWorksheet, WpsRows, WpsRow, WpsColumns, WpsRange, WpsAutoFilter, WpsFilters, WpsFilter, WpsInterior, WpsFont, WpsAreas, WpsPluginStorage, WpsOAAssist, WpsTaskPane, } from './tools/wps.js';
//# sourceMappingURL=index.d.ts.map