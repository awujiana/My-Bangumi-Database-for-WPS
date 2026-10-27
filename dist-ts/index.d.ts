/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口。
 *              其他模块只需 `import { ... } from '../index.js'`
 *              即可获取所有核心功能与类型，降低模块间耦合。
 */
export { initializeGlobalErrorHandler } from './core/error-handler.js';
export { ErrorLevel, type ErrorOptions, WPS_ENUM, XL, BGM_CONFIG, BGM_COLOR, LOG_LEVELS, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, COLLECTION_TYPE_NAMES, SYNC_STATUS, COLUMN_RULES, HEADER_KEYWORDS, IMPORTANT_COLUMNS, FIELD_NAME_MAP, URL_PATTERNS, TOKEN_CONFIG, WATCH_STATUS_MAP, COLUMNS, SYNC_RECORD_SHEET_NAME, SYNC_RECORD_COLUMNS, SYNC_RECORD_COLUMN, SYNC_RECORD_TYPE_COLOR, } from './core/constants.js';
export { BgmError, Result, type BatchSyncResult, } from './core/result.js';
export { buildFailedRowsAddress, clearLastFailedRows, getLastFailedRows, setLastFailedRows, type FailedRowsRecord, } from './core/failed-rows.js';
export { calcChecksum, extractToken, } from './core/token-payload.js';
export { httpRequest, type HttpMethod, } from './tools/http.js';
export { showAlert, showConfirm, confirmAsync, showError, showSuccess, showInput, showToast, showSyncResult, showSyncProgressDialog, updateSyncProgressDialog, completeSyncProgressDialog, type SyncProgressStats, type SyncConfigSummary, type BuildSyncConfigContext, buildSyncConfig, renderConfigSummary, hideSyncProgressDialog, } from './ui/dialog.js';
export { type DialogButton, type DialogConfig, type DialogCallback, type DialogOptions, } from './ui/dialog.js';
export { setStatus, initializeMessageListener, } from './ui/message.js';
export { showUserIdDialog, updateTokenStatus, updateUserIdStatus, showTokenDialog, testDebugConnection, syncCollectionFromBgm, openUserCollection, removeMessageListener, clearAllPendingTimeouts, } from './ui/handlers/index.js';
export { getOrCreateSyncRecordSheet, getSyncRecordSheetIfExists, getAllSyncRecords, addSyncRecord, addSyncRecords, addSyncRecordSummary, deduplicateSyncRecords, formatSyncRecordSheet, openSyncRecordSheet, type SyncRecord, type UpdateRecordParameters, clearSyncRecords, } from './sync/sync-record.js';
export { extractSubjectId, getFilterStatus, SyncToBangumiAsync, syncSelectedRows, mapWatchStatus, buildJsonPayload, bgmRequestSync, setBangumiToken, openBangumiTokenPage, testTokenValidityForRibbon, buildTagsArray, addTagsFromString, } from './sync/exceltobangumi/index.js';
export { verifyToken, fetchAllUserCollections, type BangumiUserData, type TokenVerifyResult, type ApiResponse, } from './sync/scraping.js';
export { syncFromGithub, fetchGithubJson, readLocalEntriesForSync, applyDiffToSheet, applyConflictResolutions, type GithubSyncResult, } from './sync/github-sync.js';
export { syncFromRemote, registerSyncSource, getSyncSource, getRegisteredSourceTypes, isSyncSourceRegistered, REMOTE_SYNC_PHASES, } from './sync/sync-source-registry.js';
export { readLocalFileContent, } from './sync/local-file-sync.js';
export { computeDiff, tagsToString, SYNC_STRATEGY_LABELS, type GithubRemoteEntry, type GithubSyncDiff, type GithubSyncDetailItem, type LocalRowEntry, type SyncStrategy, type SyncTimeFilter, } from './sync/github-sync-diff.js';
export { getGithubConfig, setGithubConfig, isGithubConfigComplete, buildRawUrl, getSyncStrategy, setSyncStrategy, getSyncSourceType, setSyncSourceType, getManualShards, setManualShards, DEFAULT_GITHUB_CONFIG, type GithubSyncConfig, type SyncSourceType, } from './sync/github-config.js';
export { bgmLog, getApp, columnNumberToLetter, getCell, getCellValue, setCellValue, getSheetByIndex, escapeHtml, storeBgToken, clearBgToken, loadBgToken, storeTokenExpires, loadTokenExpires, clearTokenExpires, getTokenRemainingTime, copyTokenToClipboard, copyTextWithResult, _getBgmUserId, _setBgmUserId, _getBgmUsername, _setBgmUsername, fetchBgmUserInfo, trim, BGM, _getUserApiPath, _fetchBgmUserInfo, fetchBgmMe, showBangumiPanel, showSettingsPanel, showEnrichPanel, showCleanPanel, showHighlightPanel, showConditionalFormatPanel, showDonatePanel, closeAllPanels, markCleanPaneLoaded, markHighlightPaneLoaded, sleep, delay, readRangeValues, getColumnMap, cacheGet, clearSheetCache, getLastRow, isEmptyValue, getDataSheet, findHeaderRow, shellExecuteByOAAssist, getUrlPath, calcFingerprint, createBatchFieldGetter, calcSyncRowFingerprint, } from './tools/util/index.js';
export { CONFIG_KEYS, setConfig, getConfig, removeConfig, setIncrementalSync, isIncrementalSyncEnabled, setSkipConflicts, isSkipConflictsEnabled, setSyncRecordEnabled, isSyncRecordEnabled, setNavIconsOnly, areNavIconsOnly, setTheme, getTheme, type ThemeMode, setThemeSchedule, getThemeSchedule, type ThemeSchedule, setModalButtonsPosition, getModalButtonsPosition, type ModalButtonsPosition, setClusterMode, getClusterMode, CLUSTER_MODE_LABELS, type ClusterMode, setMergeMode, getMergeMode, MERGE_MODE_LABELS, mergeModeLabel, type MergeMode, setListType, getListType, type ListType, setTimeFilter, getTimeFilter, type TimeFilterRange, setRefreshInterval, getRefreshInterval, setExportPath, getExportPath, setImportPath, getImportPath, setLogLevel, getLogLevel, applyLogLevel, } from './tools/config.js';
export { applyTheme, initializeTheme, saveTheme, resolveTheme, startThemeSync, startThemeScheduleWatch, switchThemeAnimated, } from './tools/theme.js';
export { startNavModeSync } from './tools/nav-mode.js';
export { autoFillUrls, showAutoFillUrlDialog, type AutoFillResult, type NameUrlMap, } from './tools/auto-fill-url.js';
export type { BGMCache, BGMSheet, BGMSync, BGMUserInfo } from './core/types.js';
export { refreshSheets, refreshWorkbooks, toggleSheetLock, refreshData, enlargePreview, } from './panel/panel-page.js';
export type { DetailItem, PreviewItem, DetailPreviewData, } from './ui/preview.js';
export { previewSyncContent, closeDetailModal, syncAllRows, } from './ui/preview.js';
export { isWpsApp, isWpsWorksheet, isWpsRange, wpsMessageBox, } from './tools/wps.js';
export type { BgmWindow, WpsApp, WpsWorkbook, WpsWorksheets, WpsSheets, WpsWorksheet, WpsRows, WpsRow, WpsColumns, WpsRange, WpsAutoFilter, WpsFilters, WpsFilter, WpsInterior, WpsFont, WpsAreas, WpsPluginStorage, WpsOAAssist, WpsTaskPane, } from './tools/wps.js';
export { detectConflicts, getSyncPreview, detectGithubConflicts, type Conflict, type ConflictResolution, } from './services/ribbon-service.js';
export { showConflictResolver } from './ui/conflict-resolver.js';
export { showSyncResultDialog, hideSyncResultDialog, computeDateStatsFromSheet, formatDuration, type DateStats, type SyncResultDialogOptions, } from './ui/sync-result-dialog.js';
export { showSyncMappingDialog } from './ui/sync-mapping-dialog.js';
export { exportSheetToJsonlFile, buildJsonlFromSheet } from './sync/export-jsonl.js';
export { cleanSheetDuplicates, planDuplicateRows, planDuplicateUrlRows, planEmptyNameRows, applyRowPlan, type CleanDuplicatesResult, type RowChange, type RowPlan, } from './sync/sheet-cleaning.js';
export { detectColumns, detectAnimeSourceLayout, findAliasColumn, getBangumiColumnMap, readPlatformValues, } from './sync/enrich-layout.js';
export { readNewAnimeRow, matchEntries, isBangumiSheetEmpty, } from './sync/enrich-matching.js';
export { enrichTags, enrichPlatform, enrichDate, enrichEpisodes, enrichFeatures, } from './sync/enrich-fields.js';
export { enrichIntroData, enrichOpEdPv, readIntroSheetRow, isIntroSheet, findIntroSheetInWorkbook, buildIntroSheetContext, enrichIntroFromContext, } from './sync/enrich-intro.js';
export { normalizeName, mergeTags, splitTags, splitAliases, appendFeatures, shouldFilterNoise, resetNoiseKeywordCache, } from './sync/enrich-normalize.js';
export { enrichEntries, enrichAlias, resolveConflictField, ensureBangumiColumns, searchSheet, } from './sync/enrich-engine.js';
export type { EnrichColumnMapping, AnimeSourceLayout } from './sync/enrich-layout.js';
export type { EnrichConfig, MatchResult, EnrichResultItem, EnrichedField, ConflictInfo, EnrichStats, EnrichProgress, ProgressCallback, } from './sync/enrich-types.js';
export type { IntroSheetContext } from './sync/enrich-intro.js';
export type { SearchResult } from './sync/enrich-engine.js';
export { getOrCreateEnrichRecordSheet, getEnrichRecordSheetIfExists, getAllEnrichRecords, addEnrichRecord, addEnrichRecords, clearEnrichRecords, openEnrichRecordSheet, formatEnrichRecordSheet, type EnrichRecord, type AddEnrichRecordParameters, ENRICH_RECORD_SHEET_NAME, ENRICH_RECORD_COLUMNS, ENRICH_RECORD_COLUMN, } from './sync/enrich-record.js';
export { initializeEnrichPage, selectNewAnimeFile, autoDetectHeader, previewMatch, startEnrichment, cancelEnrichment, openEnrichRecordSheet as openEnrichRecordSheetFromPage, clearRecords, } from './panel/enrich-page.js';
export { refreshEnrichWorkbooks, refreshEnrichSheets, toggleEnrichWorkbookLock, updateEnrichLockButton, getLockedEnrichSheet, findWorkbookByName, initializeEnrichLock, findBangumiTargetSheets, lockEnrichWorkbookByName, autoSelectEnrichTarget, } from './sync/enrich-lock.js';
export { initializeWorkbookAutoDetection, scanMatchingWorkbooks, isMatchingWorkbook, isAnimeSourceFilename, extractFileNameFromPath, findAnimeSourceSheetInWorkbook, loadDetectedPaths, persistDetectedPaths, isWorkbookOpen, mergeCandidatePaths, collectDetectedWorkbookPaths, mergeDetectedPathsIntoStorage, describeOpenWorkbooks, ANIME_SOURCE_DETECTOR, BANGUMI_TARGET_DETECTOR, ALL_DETECTORS, ANIME_SOURCE_FILENAME_KEYWORDS, } from './sync/workbook-auto-detect.js';
//# sourceMappingURL=index.d.ts.map