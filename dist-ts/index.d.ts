/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口。
 *              其他模块只需 `import { ... } from '../types/index.js'`
 *              即可获取所有核心功能与类型，降低模块间耦合。
 */
import type { WpsWorksheet } from './tools/wps.js';
export { ErrorLevel, type ErrorOptions, WPS_ENUM, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, COLLECTION_TYPE_NAMES, SYNC_STATUS, COLUMN_RULES, HEADER_KEYWORDS, IMPORTANT_COLS, FIELD_NAME_MAP, URL_PATTERNS, TOKEN_CONFIG, WATCH_STATUS_MAP, COLUMNS, SYNC_RECORD_SHEET_NAME, SYNC_RECORD_COLUMNS, SYNC_RECORD_COL, SYNC_RECORD_TYPE_COLOR, } from './core/constants.js';
export { BgmError, Result, type BatchSyncResult, } from './core/result.js';
export { calcChecksum, extractToken, } from './core/crypto.js';
export { httpRequest, type HttpMethod, } from './tools/http.js';
export { showAlert, // 提示
showConfirm, // 确认
showError, // 错误
showSuccess, // 成功
showInput, // 输入
showToast, // Toast 通知
showSyncResult, // 同步结果（可展开详情）
showSyncProgressDialog, updateSyncProgressDialog, completeSyncProgressDialog, type SyncProgressStats, hideSyncProgressDialog, } from './ui/dialog.js';
export { type DialogButton, type DialogConfig, type DialogCallback, type DialogOptions, } from './ui/dialog.js';
export { setStatus, initMessageListener, } from './ui/message.js';
export { showUserIdDialog, updateTokenStatus, updateUserIdStatus, showTokenDialog, testDebugConnection, syncCollectionFromBgm, openUserCollection, removeMessageListener, clearAllPendingTimeouts, } from './ui/handlers.js';
export { getOrCreateSyncRecordSheet, getSyncRecordSheetIfExists, getAllSyncRecords, addSyncRecord, addSyncRecords, addSyncRecordSummary, deduplicateSyncRecords, formatSyncRecordSheet, openSyncRecordSheet, type SyncRecord, type UpdateRecordParams, clearSyncRecords, } from './sync/syncRecord.js';
export { extractSubjectId, getFilterStatus, getSequentialRowsBySeqCol, SyncToBangumiAsync, syncSelectedRows, mapWatchStatus, buildJsonPayload, bgmRequestSync, setBangumiToken, openBangumiTokenPage, testTokenValidityForRibbon, buildTagsArray, addTagsFromStr, } from './sync/exceltobangumi.js';
export { verifyToken, fetchAllUserCollections, type BangumiUserData, type TokenVerifyResult, type ApiResponse, } from './sync/scraping.js';
export { syncFromGithub, fetchGithubJson, readLocalEntriesForSync, applyDiffToSheet, applyConflictResolutions, type GithubSyncResult, } from './sync/githubSync.js';
export { syncFromRemote, registerSyncSource, getSyncSource, getRegisteredSourceTypes, isSyncSourceRegistered, } from './sync/syncSourceRegistry.js';
export { computeDiff, tagsToString, SYNC_STRATEGY_LABELS, type GithubRemoteEntry, type GithubSyncDiff, type LocalRowEntry, type SyncStrategy, type SyncTimeFilter, } from './sync/githubSyncDiff.js';
export { getGithubConfig, setGithubConfig, isGithubConfigComplete, buildRawUrl, getSyncStrategy, setSyncStrategy, getSyncSourceType, setSyncSourceType, DEFAULT_GITHUB_CONFIG, type GithubSyncConfig, type SyncSourceType, } from './sync/githubConfig.js';
export { bgmLog, getApp, colNumToLetter, getCell, getCellValue, setCellValue, getSheetByIndex, escapeHtml, storeBgToken, clearBgToken, loadBgToken, storeTokenExpires, loadTokenExpires, clearTokenExpires, getTokenRemainingTime, copyTokenToClipboard, _getBgmUserId, _setBgmUserId, _getBgmUsername, _setBgmUsername, fetchBgmUserInfo, trim, BGM, _getUserApiPath, _fetchBgmUserInfo, showBangumiPanel, showSettingsPanel, sleep, delay, readRangeValues, getColumnMap, cacheGet, clearSheetCache, getLastRow, isEmptyValue, getDataSheet, findHeaderRow, shellExecuteByOAAssist, getUrlPath, calcFingerprint, } from './tools/util.js';
export { CONFIG_KEYS, setConfig, getConfig, removeConfig, setIncrementalSync, getIncrementalSync, setSkipConflicts, getSkipConflicts, setSyncRecordEnabled, getSyncRecordEnabled, } from './tools/config.js';
export { autoFillUrls, showAutoFillUrlDialog, type AutoFillResult, type NameUrlMap, } from './tools/autoFillUrl.js';
export interface BGMCache {
    /** WPS 文档总行数缓存 */
    totalRows: number;
    /** 当前用户 ID */
    userId: string | null;
    /** 当前用户名 */
    username: string | null;
    /** 当前用户头像 URL */
    avatarUrl: string | null;
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
    /** 锁定的工作簿名称（空字符串表示当前活动工作簿） */
    lockedWorkbookName: string | null;
}
export interface BGMSync {
    /** 是否正在同步 */
    isRunning: boolean;
    /** 是否请求停止同步 */
    shouldStop: boolean;
    /** 是否暂停中 */
    isPaused: boolean;
    /** 上次同步时间（ISO 格式） */
    lastSyncTime: string | null;
    /** 当前正在处理的行号（用于暂停时定位） */
    currentRow: number;
    /** 当前正在处理的工作表（用于暂停时定位） */
    currentSheet: WpsWorksheet | null;
    /** 当前正在处理的列号（用于暂停时定位） */
    currentCol: number;
    /**
     * 进入运行状态（统一入口）
     * - 防重复：如果 isRunning === true 则提示并返回 false
     * - 重置停止标志，置 isRunning = true，记录 lastSyncTime
     * @returns 是否成功进入运行状态
     */
    enterRunningState: () => boolean;
    /**
     * 退出运行状态（统一入口）
     * - 清除 isRunning，重置停止标志
     */
    exitRunningState: () => void;
    /**
     * 启动同步流程（由"全面同步"按钮触发）
     * - 防重复：如果 isRunning === true 则提示并返回
     * - 检查 BGM.dataPreview 是否已加载
     * - 调用 preview.ts 中的 syncAllRows() 执行批量上传
     */
    startSync: () => void;
    /**
     * 请求停止同步
     * - 设置 shouldStop 标志
     * - 未在运行时静默返回
     */
    requestStop: () => void;
    /** 暂停同步：设置 isPaused，并定位到当前单元格 */
    pause: () => void;
    /** 恢复同步：清除 isPaused */
    resume: () => void;
    /**
     * 检查是否应该停止同步
     * @returns 是否应该停止
     */
    checkShouldStop: () => boolean;
    /** 检查是否暂停中 */
    checkPaused: () => boolean;
    /** 暂停时等待恢复（每 50ms 轮询），恢复或停止后返回 */
    waitForResume: () => Promise<void>;
    /** 定位到当前正在处理的单元格 */
    locateCurrentCell: () => void;
    /** 更新当前位置（供同步循环调用，传 undefined 保留原值） */
    updatePosition: (ws: WpsWorksheet | null | undefined, row: number, col?: number) => void;
    /**
     * 重置停止标志（同时清理 currentRow/currentSheet/currentCol）
     */
    resetStopFlag: () => void;
}
export interface BGMUserInfo {
    /** 用户 ID */
    id: string;
    /** 用户名 */
    username: string;
    /** 头像 URL */
    avatarUrl?: string | undefined;
}
export { refreshSheets, refreshWorkbooks, toggleSheetLock, refreshData, enlargePreview, } from './taskpane.js';
export type { DetailItem, PreviewItem, DetailPreviewData, } from './ui/preview.js';
export { previewSyncContent, closeDetailModal, syncAllRows, } from './ui/preview.js';
export { isWpsApp, isWpsWorksheet, isWpsRange, wpsMsgBox, } from './tools/wps.js';
export type { BgmWindow, WpsApplication, WpsWorkbook, WpsWorksheets, WpsSheets, WpsWorksheet, WpsRows, WpsRow, WpsColumns, WpsRange, WpsAutoFilter, WpsFilters, WpsFilter, WpsInterior, WpsFont, WpsAreas, WpsPluginStorage, WpsOAAssist, WpsTaskPane, } from './tools/wps.js';
export { detectConflicts, getSyncPreview, detectGithubConflicts, type Conflict, type ConflictResolution, } from './services/ribbonService.js';
export { showConflictResolver } from './ui/conflictResolver.js';
export { showSyncResultDialog, hideSyncResultDialog, computeDateStatsFromSheet, formatDuration, type DateStats, type SyncResultDialogOptions, } from './ui/syncResultDialog.js';
export { exportSheetToJsonlFile, buildJsonlFromSheet } from './sync/exportJsonl.js';
//# sourceMappingURL=index.d.ts.map