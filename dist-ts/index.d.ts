/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口。
 *              其他模块只需 `import { ... } from '../index.js'`
 *              即可获取所有核心功能与类型，降低模块间耦合。
 */
export { initGlobalErrorHandler } from './core/errorHandler.js';
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
showSyncProgressDialog, updateSyncProgressDialog, completeSyncProgressDialog, type SyncProgressStats, type SyncConfigSummary, type BuildSyncConfigContext, buildSyncConfig, renderConfigSummary, hideSyncProgressDialog, } from './ui/dialog.js';
export { type DialogButton, type DialogConfig, type DialogCallback, type DialogOptions, } from './ui/dialog.js';
export { setStatus, initMessageListener, } from './ui/message.js';
export { showUserIdDialog, updateTokenStatus, updateUserIdStatus, showTokenDialog, testDebugConnection, syncCollectionFromBgm, openUserCollection, removeMessageListener, clearAllPendingTimeouts, } from './ui/handlers.js';
export { getOrCreateSyncRecordSheet, getSyncRecordSheetIfExists, getAllSyncRecords, addSyncRecord, addSyncRecords, addSyncRecordSummary, deduplicateSyncRecords, formatSyncRecordSheet, openSyncRecordSheet, type SyncRecord, type UpdateRecordParams, clearSyncRecords, } from './sync/syncRecord.js';
export { extractSubjectId, getFilterStatus, getSequentialRowsBySeqCol, SyncToBangumiAsync, syncSelectedRows, mapWatchStatus, buildJsonPayload, bgmRequestSync, setBangumiToken, openBangumiTokenPage, testTokenValidityForRibbon, buildTagsArray, addTagsFromStr, } from './sync/exceltobangumi.js';
export { verifyToken, fetchAllUserCollections, type BangumiUserData, type TokenVerifyResult, type ApiResponse, } from './sync/scraping.js';
export { syncFromGithub, fetchGithubJson, readLocalEntriesForSync, applyDiffToSheet, applyConflictResolutions, type GithubSyncResult, } from './sync/githubSync.js';
export { syncFromRemote, registerSyncSource, getSyncSource, getRegisteredSourceTypes, isSyncSourceRegistered, } from './sync/syncSourceRegistry.js';
export { computeDiff, tagsToString, SYNC_STRATEGY_LABELS, type GithubRemoteEntry, type GithubSyncDiff, type GithubSyncDetailItem, type LocalRowEntry, type SyncStrategy, type SyncTimeFilter, } from './sync/githubSyncDiff.js';
export { getGithubConfig, setGithubConfig, isGithubConfigComplete, buildRawUrl, getSyncStrategy, setSyncStrategy, getSyncSourceType, setSyncSourceType, DEFAULT_GITHUB_CONFIG, type GithubSyncConfig, type SyncSourceType, } from './sync/githubConfig.js';
export { bgmLog, getApp, colNumToLetter, getCell, getCellValue, setCellValue, getSheetByIndex, escapeHtml, storeBgToken, clearBgToken, loadBgToken, storeTokenExpires, loadTokenExpires, clearTokenExpires, getTokenRemainingTime, copyTokenToClipboard, _getBgmUserId, _setBgmUserId, _getBgmUsername, _setBgmUsername, fetchBgmUserInfo, trim, BGM, _getUserApiPath, _fetchBgmUserInfo, showBangumiPanel, showSettingsPanel, showEnrichPanel, sleep, delay, readRangeValues, getColumnMap, cacheGet, clearSheetCache, getLastRow, isEmptyValue, getDataSheet, findHeaderRow, shellExecuteByOAAssist, getUrlPath, calcFingerprint, } from './tools/util.js';
export { CONFIG_KEYS, setConfig, getConfig, removeConfig, setIncrementalSync, getIncrementalSync, setSkipConflicts, getSkipConflicts, setSyncRecordEnabled, getSyncRecordEnabled, setNavIconsOnly, getNavIconsOnly, } from './tools/config.js';
export { autoFillUrls, showAutoFillUrlDialog, type AutoFillResult, type NameUrlMap, } from './tools/autoFillUrl.js';
export type { BGMCache, BGMSheet, BGMSync, BGMUserInfo, EnrichWorkbookState } from './core/types.js';
export { refreshSheets, refreshWorkbooks, toggleSheetLock, refreshData, enlargePreview, } from './panel/panelPage.js';
export type { DetailItem, PreviewItem, DetailPreviewData, } from './ui/preview.js';
export { previewSyncContent, closeDetailModal, syncAllRows, } from './ui/preview.js';
export { isWpsApp, isWpsWorksheet, isWpsRange, wpsMsgBox, } from './tools/wps.js';
export type { BgmWindow, WpsApplication, WpsWorkbook, WpsWorksheets, WpsSheets, WpsWorksheet, WpsRows, WpsRow, WpsColumns, WpsRange, WpsAutoFilter, WpsFilters, WpsFilter, WpsInterior, WpsFont, WpsAreas, WpsPluginStorage, WpsOAAssist, WpsTaskPane, } from './tools/wps.js';
export { detectConflicts, getSyncPreview, detectGithubConflicts, type Conflict, type ConflictResolution, } from './services/ribbonService.js';
export { showConflictResolver } from './ui/conflictResolver.js';
export { showSyncResultDialog, hideSyncResultDialog, computeDateStatsFromSheet, formatDuration, type DateStats, type SyncResultDialogOptions, } from './ui/syncResultDialog.js';
export { exportSheetToJsonlFile, buildJsonlFromSheet } from './sync/exportJsonl.js';
export { detectColumns, matchEntries, enrichEntries, normalizeName, mergeTags, splitTags, splitAliases, appendFeatures, findAliasColumn, getBangumiColumnMap, readNewAnimeRow, enrichTags, enrichDate, enrichEpisodes, enrichFeatures, enrichIntroData, enrichOpEdPv, readIntroSheetRow, isIntroSheet, enrichAlias, resolveConflictField, ensureBangumiColumns, searchSheet, fetchRemoteFile, parseRemoteContent, writeRemoteDataToSheet, type EnrichColumnMapping, type EnrichConfig, type MatchResult, type EnrichResultItem, type EnrichedField, type ConflictInfo, type SearchResult, type RemoteRepoConfig, type EnrichProgress, type ProgressCallback, } from './sync/enrichEngine.js';
export { getOrCreateEnrichRecordSheet, getEnrichRecordSheetIfExists, getAllEnrichRecords, addEnrichRecord, addEnrichRecords, clearEnrichRecords, openEnrichRecordSheet, formatEnrichRecordSheet, type EnrichRecord, type AddEnrichRecordParams, ENRICH_RECORD_SHEET_NAME, ENRICH_RECORD_COLUMNS, ENRICH_RECORD_COL, } from './sync/enrichRecord.js';
export { initEnrichPage, selectNewAnimeFile, autoDetectHeader, previewMatch, startEnrichment, cancelEnrichment, openEnrichRecordSheet as openEnrichRecordSheetFromPage, clearRecords, } from './panel/enrichPage.js';
export { refreshEnrichWorkbooks, refreshEnrichSheets, toggleEnrichWorkbookLock, updateEnrichLockButton, saveEnrichLockedWorkbook, restoreEnrichLockedWorkbook, getLockedEnrichSheet, findWorkbookByName, findSheetInWorkbook, initEnrichLock, } from './sync/enrichLock.js';
//# sourceMappingURL=index.d.ts.map