/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口。
 *              其他模块只需 `import { ... } from '../types/index.js'`
 *              即可获取所有核心功能与类型，降低模块间耦合。
 */
export { ErrorLevel, type ErrorOptions, WPS_ENUM, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS, } from './core/constants.js';
export { BgmError, Result, } from './core/result.js';
export { calcChecksum, extractToken, encryptToken, decryptToken, } from './core/crypto.js';
export { httpRequest, type HttpMethod, } from './tools/http.js';
export { showAlert, // 提示
showConfirm, // 确认
showError, // 错误
showSuccess, // 成功
showInput, // 输入
showConfirmDialog, // 确认对话框（兼容旧接口）
showToast, } from './ui/dialog.js';
export { type DialogButton, type DialogConfig, type DialogCallback, type DialogOptions, } from './ui/dialog.js';
export { setStatus, } from './ui/message.js';
export { showUserIdDialog, } from './ui/handlers.js';
export { getOrCreateSyncRecordSheet, getAllSyncRecords, addSyncRecord, openSyncRecordSheet, clearSheetMarksInSheet, type SyncRecord, type UpdateRecordParams, } from './sync/syncRecord.js';
export { findHeaderRow, getColumnMap, getLastRow, extractSubjectId, getFilterStatus, getSequentialRowsBySeqCol, SyncToBangumi, clearRowColors, testSingleUpdate, } from './sync/exceltobangumi.js';
export { verifyToken, fetchAllUserCollections, type BangumiUserData, type TokenVerifyResult, type ApiResponse, } from './sync/scraping.js';
export { bgmLog, getApp, colNumToLetter, getCell, getCellValue, readCell, setCellValue, getSheetByIndex, escapeHtml, storeBgToken, clearBgToken, loadBgToken, _getBgmUserId, _setBgmUserId, fetchBgmUserInfo, trim, BGM, _getUserApiPath, wpsMsgBox } from './tools/util.js';
export type { BGMCache, BGMSheet, BGMSync, BGMUserInfo, } from './tools/util.js';
export { refreshData, } from './taskpane.js';
export type { DetailItem, PreviewItem, DetailPreviewData, } from './ui/preview.js';
export { previewSyncContent, } from './ui/preview.js';
export { isWpsApp, isWpsWorksheet, isWpsRange, } from './tools/wps.js';
export type { BgmWindow, WpsApplication, WpsWorkbook, WpsWorksheets, WpsSheets, WpsWorksheet, WpsRows, WpsRow, WpsColumns, WpsRange, WpsAutoFilter, WpsFilters, WpsFilter, WpsInterior, WpsFont, WpsAreas, WpsPluginStorage, WpsOAAssist, WpsTaskPane, } from './tools/wps.js';
//# sourceMappingURL=index.d.ts.map