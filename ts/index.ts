/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口。
 *              其他模块只需 `import { ... } from '../index.js'`
 *              即可获取所有核心功能与类型，降低模块间耦合。
 */

// ========== 全局错误处理初始化 ==========
import { initGlobalErrorHandler } from './core/error-handler.js'

initGlobalErrorHandler()

// ============================================================================
// 0. 全局初始化（来自 core/error-handler.js）
// ============================================================================
export { initGlobalErrorHandler } from './core/error-handler.js'

// ============================================================================
// 1. 核心常量与枚举（来自 core/constants.js）
// ============================================================================
export {
  // 错误级别枚举（SILENT, WARN, ERROR, THROW）
  ErrorLevel,
  // 错误处理选项类型
  type ErrorOptions,
  // WPS 枚举值（如 xlUp, xlNone 等）
  WPS_ENUM,
  XL,
  // Bangumi API 配置（API_BASE, MAX_RETRIES 等）
  BGM_CONFIG,
  // 常用颜色常量（SUCCESS, FAIL, SKIP 等）
  BGM_COLOR,
  // 日志级别（DEBUG, INFO, WARN, ERROR）
  LOG_LEVELS,
  // 错误级别常量
  ERROR_LEVELS,
  // 面板配置（扫描行列限制等）
  PANEL_CONFIG,
  // Bangumi 条目类型映射
  BGM_SUBJECT_TYPES,
  COLLECTION_TYPE_NAMES,
  // 同步状态常量
  SYNC_STATUS,
  COLUMN_RULES,
  HEADER_KEYWORDS,
  IMPORTANT_COLS,
  FIELD_NAME_MAP,
  URL_PATTERNS,
  TOKEN_CONFIG,
  WATCH_STATUS_MAP,
  COLUMNS,
  SYNC_RECORD_SHEET_NAME,
  SYNC_RECORD_COLUMNS,
  SYNC_RECORD_COL,
  SYNC_RECORD_TYPE_COLOR,
} from './core/constants.js'

// ============================================================================
// 2. 错误处理与结果类型（来自 core/result.js）
// ============================================================================
export {
  // 统一的业务错误类
  BgmError,
  // 操作结果类型（成功/失败）
  Result,
  type BatchSyncResult,
} from './core/result.js'

// ============================================================================
// 3. Token 加密/解密（来自 core/crypto.js）
// ============================================================================
export {
  // 计算校验和
  calcChecksum,
  // 从解密字符串提取 Token
  extractToken,
} from './core/crypto.js'

// ============================================================================
// 4. HTTP 请求模块（来自 tools/http.js）
// ============================================================================
export {
  // 异步 HTTP 请求（支持重试）
  httpRequest,
  // HTTP 方法类型（GET/POST/PUT/DELETE/PATCH）
  type HttpMethod,
} from './tools/http.js'

// ============================================================================
// 5. UI 对话框（对话框函数与类型）
// ============================================================================
export {
  // 提示
  showAlert,
  // 确认
  showConfirm,
  // 错误
  showError,
  // 成功
  showSuccess,
  // 输入
  showInput,
  // Toast 通知
  showToast,
  // 同步结果（可展开详情）
  showSyncResult,
  showSyncProgressDialog,
  updateSyncProgressDialog,
  completeSyncProgressDialog,
  type SyncProgressStats,
  type SyncConfigSummary,
  type BuildSyncConfigContext,
  buildSyncConfig,
  renderConfigSummary,
  hideSyncProgressDialog,
} from './ui/dialog.js'

export {
  // 对话框按钮配置
  type DialogButton,
  // 对话框配置
  type DialogConfig,
  // 对话框回调
  type DialogCallback,
  // 对话框选项
  type DialogOptions,
} from './ui/dialog.js'

// ============================================================================
// 6. UI 消息通信（来自 ui/message.js）
// ============================================================================
export {
  // 设置状态栏消息
  setStatus,
  initMessageListener,
} from './ui/message.js'

// ============================================================================
// 7. UI 事件处理（来自 ui/handlers.js）
// ============================================================================
export {
  // 显示用户 ID 设置对话框
  showUserIdDialog,
  updateTokenStatus,
  updateUserIdStatus,
  showTokenDialog,
  testDebugConnection,
  syncCollectionFromBgm,
  openUserCollection,
  // 资源清理（防止事件监听器与定时器泄漏）
  removeMessageListener,
  clearAllPendingTimeouts,
} from './ui/handlers.js'

// ============================================================================
// 8. 同步记录工作表（来自 sync/sync-record.js）
// ============================================================================
export {
  // 导入同步记录模块的函数
  getOrCreateSyncRecordSheet,
  getSyncRecordSheetIfExists,
  getAllSyncRecords,
  addSyncRecord,
  addSyncRecords,
  addSyncRecordSummary,
  deduplicateSyncRecords,
  formatSyncRecordSheet,
  openSyncRecordSheet,
  type SyncRecord,
  type UpdateRecordParameters,
  clearSyncRecords,
} from './sync/sync-record.js'

// ============================================================================
// 9. 同步引擎（来自 sync/exceltobangumi.js）
// ============================================================================
export {
  // 提取 Subject ID
  extractSubjectId,
  // 获取筛选状态
  getFilterStatus,
  // 根据 D 列序列号获取连续行
  getSequentialRowsBySeqCol,
  // 异步同步到 Bangumi
  SyncToBangumiAsync,
  // 同步选中行
  syncSelectedRows,
  mapWatchStatus,
  buildJsonPayload,
  bgmRequestSync,
  setBangumiToken,
  openBangumiTokenPage,
  testTokenValidityForRibbon,
  buildTagsArray,
  addTagsFromString,
} from './sync/exceltobangumi.js'

// ============================================================================
// 10. 同步收藏抓取（来自 sync/scraping.js）
// ============================================================================
export {
  // 异步验证 Token
  verifyToken,
  // 异步获取所有收藏
  fetchAllUserCollections,
  // Bangumi 用户数据
  type BangumiUserData,
  // Token 验证结果
  type TokenVerifyResult,
  // API 响应结构
  type ApiResponse,
} from './sync/scraping.js'

// ============================================================================
// 11. GitHub 仓库增量同步（来自 sync/github-sync.js + sync/github-config.js）
// ============================================================================
export {
  // GitHub 源专用入口
  syncFromGithub,
  // 下载远程 JSON
  fetchGithubJson,
  // 读取本地条目（封装入口）
  readLocalEntriesForSync,
  // 应用差异到工作表
  applyDiffToSheet,
  // 应用用户冲突解决决策到 diff 列表
  applyConflictResolutions,
  // 同步结果统计类型
  type GithubSyncResult,
} from './sync/github-sync.js'

export {
  // 多源统一调度入口（按 sourceType 选择 GitHub/GitLab/Gitee/本地/Gist）
  syncFromRemote,
  // 同步源注册与查询
  registerSyncSource,
  getSyncSource,
  getRegisteredSourceTypes,
  isSyncSourceRegistered,
} from './sync/sync-source-registry.js'

export {
  // 纯函数：差异计算（零依赖，可在 Node 测试环境运行）
  computeDiff,
  tagsToString,
  SYNC_STRATEGY_LABELS,
  // 远程条目类型
  type GithubRemoteEntry,
  // 差异记录类型
  type GithubSyncDiff,
  // 同步明细类型（用于详情表格展示）
  type GithubSyncDetailItem,
  // 本地行条目类型
  type LocalRowEntry,
  // 同步策略类型
  type SyncStrategy,
  // 同步时间筛选类型
  type SyncTimeFilter,
} from './sync/github-sync-diff.js'

export {
  // 读取 GitHub 仓库配置
  getGithubConfig,
  // 保存 GitHub 仓库配置
  setGithubConfig,
  // 校验配置是否完整
  isGithubConfigComplete,
  // 构造 Raw 文件下载 URL
  buildRawUrl,
  // 读取同步策略
  getSyncStrategy,
  // 保存同步策略
  setSyncStrategy,
  // 读取同步源类型
  getSyncSourceType,
  // 保存同步源类型
  setSyncSourceType,
  // 预设默认仓库配置
  DEFAULT_GITHUB_CONFIG,
  // 配置类型
  type GithubSyncConfig,
  // 同步源类型
  type SyncSourceType,
} from './sync/github-config.js'

// ============================================================================
// 12. 通用工具函数与全局状态（来自 tools/utility.js）
// ============================================================================
export {
  // 日志函数
  bgmLog,
  // 获取 WPS Application 对象
  getApp,
  // 列号转字母
  colNumberToLetter,
  // 安全获取单元格对象
  getCell,
  // 安全获取单元格值（单元格文本兼容多种取值方式）
  getCellValue,
  // 设置单元格值
  setCellValue,
  // 根据索引获取工作表对象
  getSheetByIndex,
  // HTML 转义
  escapeHtml,
  // 加密并存储 Token
  storeBgToken,
  // 清除 Token
  clearBgToken,
  // 加载并解密 Token
  loadBgToken,
  // 存储 Token 过期时间戳
  storeTokenExpires,
  // 加载 Token 过期时间戳
  loadTokenExpires,
  // 清除 Token 过期时间戳
  clearTokenExpires,
  // 计算 Token 剩余有效期
  getTokenRemainingTime,
  // 复制 Token 到剪贴板
  copyTokenToClipboard,
  // 获取用户 ID
  _getBgmUserId,
  // 设置用户 ID
  _setBgmUserId,
  // 获取用户名
  _getBgmUsername,
  // 设置用户名
  _setBgmUsername,
  // Promise 版本获取用户信息
  fetchBgmUserInfo,
  // 去除首尾空格
  trim,
  // BGM 全局命名空间（包含 Dialog, Message, handleError 等）
  BGM,
  // 获取用户 API 路径（用于 API 调用）
  _getUserApiPath,
  // 获取 Bangumi 当前登录用户信息
  _fetchBgmUserInfo,
  // 显示主面板
  showBangumiPanel,
  // 显示设置面板（带动态停靠位置）
  showSettingsPanel,
  // 显示新番表富化面板
  showEnrichPanel,
  // 显示通用数据清理面板
  showCleanPanel,
  // 标记清理面板已成功加载（面板 ID 自愈）
  markCleanPaneLoaded,
  // 等待指定毫秒数
  sleep,
  // 延迟执行（用于模拟异步操作）
  delay,
  // 读取指定范围的单元格值
  readRangeValues,
  // 获取列映射（固定表头名称到列号的映射）
  getColumnMap,
  // 获取最后一行（包含数据的最后一行）
  cacheGet,
  // 清除工作表缓存
  clearSheetCache,
  // 获取最后一行
  getLastRow,
  // 检查单元格是否为空（兼容多种取值方式）
  isEmptyValue,
  // 获取数据工作表
  getDataSheet,
  // 查找表头行
  findHeaderRow,
  // 根据表头关键字获取列映射
  shellExecuteByOAAssist,
  // 获取 URL 路径（用于 API 调用）
  getUrlPath,
  // 计算数据指纹（用于缓存）
  calcFingerprint,
} from './tools/utility.js'

// ============================================================================
// 13. 配置管理模块（来自 tools/config.js）
// ============================================================================
export {
  // 配置键名常量
  CONFIG_KEYS,
  // 配置操作函数
  setConfig,
  getConfig,
  removeConfig,
  // 增量同步配置
  setIncrementalSync,
  isIncrementalSyncEnabled,
  // 跳过冲突配置
  setSkipConflicts,
  isSkipConflictsEnabled,
  // 同步记录开关
  setSyncRecordEnabled,
  isSyncRecordEnabled,
  // 导航显示模式
  setNavIconsOnly,
  areNavIconsOnly,
  // 外观主题
  setTheme,
  getTheme,
  type ThemeMode,
  // 默认收藏列表类型
  setListType,
  getListType,
  type ListType,
  // 默认时间筛选范围
  setTimeFilter,
  getTimeFilter,
  type TimeFilterRange,
  // 自动刷新间隔
  setRefreshInterval,
  getRefreshInterval,
  // 默认导出位置 / 默认导入文件夹
  setExportPath,
  getExportPath,
  setImportPath,
  getImportPath,
} from './tools/config.js'

// ============================================================================
// 13.1 外观主题应用（来自 tools/theme.js）
// ============================================================================
export { applyTheme, initTheme, saveTheme, resolveTheme, startThemeSync } from './tools/theme.js'

// ============================================================================
// 13.2 导航显示模式跨页同步（来自 tools/nav-mode.js）
// ============================================================================
export { startNavModeSync } from './tools/nav-mode.js'

// ============================================================================
// 14. URL 自动补全（来自 tools/auto-fill-url.js）
// ============================================================================
export {
  // 执行 URL 自动补全
  autoFillUrls,
  // 显示确认对话框后执行
  showAutoFillUrlDialog,
  type AutoFillResult,
  type NameUrlMap,
} from './tools/auto-fill-url.js'

// ========== 核心类型（从 core/types.ts re-export） ==========
export type { BGMCache, BGMSheet, BGMSync, BGMUserInfo } from './core/types.js'

// ============================================================================
// 15. 页面逻辑（来自 panel/panel-page.js）
// ============================================================================

export {
  refreshSheets,
  refreshWorkbooks,
  toggleSheetLock,
  // 刷新数据预览
  refreshData,
  // 放大预览表格
  enlargePreview,
} from './panel/panel-page.js'
// ============================================================================
// 16. 预览模块（类型部分）
// ============================================================================
export type {
  // 数据预览单项
  DetailItem,
  // 预览项（HTML+类型）
  PreviewItem,
  // 预览数据状态
  DetailPreviewData,
} from './ui/preview.js'

// 预览函数
export {
  // 显示预览内容
  previewSyncContent,
  closeDetailModal,
  syncAllRows,
} from './ui/preview.js'

// ============================================================================
// 17. WPS 操作接口（类型守卫与类型定义）
// ============================================================================
export {
  // 判断对象是否为 WPS Application
  isWpsApp,
  // 判断对象是否为 WPS 工作表
  isWpsWorksheet,
  // 判断对象是否为 WPS Range
  isWpsRange,
  wpsMessageBox,
} from './tools/wps.js'

export type {
  // 扩展的 Window 接口（挂载了大量 BGM 函数）
  BgmWindow,
  // WPS Application 最小化接口
  WpsApp,
  WpsWorkbook,
  WpsWorksheets,
  WpsSheets,
  WpsWorksheet,
  WpsRows,
  WpsRow,
  WpsColumns,
  WpsRange,
  WpsAutoFilter,
  WpsFilters,
  WpsFilter,
  WpsInterior,
  WpsFont,
  WpsAreas,
  WpsPluginStorage,
  WpsOAAssist,
  WpsTaskPane,
} from './tools/wps.js'

// ============================================================================
// 18. 服务层（来自 services/ribbon-service.js）
// ============================================================================
export {
  detectConflicts,
  getSyncPreview,
  detectGithubConflicts,
  type Conflict,
  type ConflictResolution,
} from './services/ribbon-service.js'

// ============================================================================
// 19. 冲突解决 UI（来自 ui/conflict-resolver.js）
// ============================================================================
export { showConflictResolver } from './ui/conflict-resolver.js'

// ============================================================================
// 20. 同步结果增强弹窗（来自 ui/sync-result-dialog.js）
// ============================================================================
export {
  showSyncResultDialog,
  hideSyncResultDialog,
  computeDateStatsFromSheet,
  formatDuration,
  type DateStats,
  type SyncResultDialogOptions,
} from './ui/sync-result-dialog.js'

// ============================================================================
// 21. JSONL 导出（来自 sync/export-jsonl.js）
// ============================================================================
export { exportSheetToJsonlFile, buildJsonlFromSheet } from './sync/export-jsonl.js'

// ============================================================================
// 22. 新番表富化引擎（来自 sync/enrich-engine.js + sync/enrich-record.js）
// ============================================================================
export {
  // 富化引擎核心函数
  detectColumns,
  matchEntries,
  enrichEntries,
  normalizeName,
  mergeTags,
  splitTags,
  splitAliases,
  appendFeatures,
  findAliasColumn,
  getBangumiColumnMap,
  readNewAnimeRow,
  enrichTags,
  enrichDate,
  enrichEpisodes,
  enrichFeatures,
  // 简介工作表富化函数（第二阶段）
  enrichIntroData,
  enrichOpEdPv,
  readIntroSheetRow,
  isIntroSheet,
  // 别名富化函数
  enrichAlias,
  // 冲突解决函数
  resolveConflictField,
  // 列管理函数
  ensureBangumiColumns,
  // 搜索与查询函数
  searchSheet,
  // 远程仓库函数
  fetchRemoteFile,
  parseRemoteContent,
  writeRemoteDataToSheet,
  // 富化引擎类型
  type EnrichColumnMapping,
  type EnrichConfig,
  type MatchResult,
  type EnrichResultItem,
  type EnrichedField,
  type ConflictInfo,
  type SearchResult,
  type RemoteRepoConfig,
  type EnrichProgress,
  type ProgressCallback,
} from './sync/enrich-engine.js'

export {
  // 富化记录表函数
  getOrCreateEnrichRecordSheet,
  getEnrichRecordSheetIfExists,
  getAllEnrichRecords,
  addEnrichRecord,
  addEnrichRecords,
  clearEnrichRecords,
  openEnrichRecordSheet,
  formatEnrichRecordSheet,
  // 富化记录表类型
  type EnrichRecord,
  type AddEnrichRecordParameters,
  // 富化记录表常量
  ENRICH_RECORD_SHEET_NAME,
  ENRICH_RECORD_COLUMNS,
  ENRICH_RECORD_COL,
} from './sync/enrich-record.js'

// ============================================================================
// 23. 富化页面 UI 控制器（来自 panel/enrich-page.js）
// ============================================================================
export {
  initEnrichPage,
  selectNewAnimeFile,
  autoDetectHeader,
  previewMatch,
  startEnrichment,
  cancelEnrichment,
  openEnrichRecordSheet as openEnrichRecordSheetFromPage,
  clearRecords,
} from './panel/enrich-page.js'

// ============================================================================
// 24. 富化工作簿锁定（来自 sync/enrich-lock.js，底层委托 tools/locked-sheet.js）
// ============================================================================
export {
  refreshEnrichWorkbooks,
  refreshEnrichSheets,
  toggleEnrichWorkbookLock,
  updateEnrichLockButton,
  getLockedEnrichSheet,
  findWorkbookByName,
  initEnrichLock,
  findBangumiTargetSheets,
  lockEnrichWorkbookByName,
  autoSelectEnrichTarget,
} from './sync/enrich-lock.js'

// ============================================================================
// 24.1 工作簿自动识别通用模块（来自 sync/workbook-auto-detect.js）
//      识别新番表 / Bangumi 数据表工作簿，识别方式参考 Bangumi 同步工具：
//      名称预筛 + 表头/数据行校验
// ============================================================================
export {
  initWorkbookAutoDetection,
  scanMatchingWorkbooks,
  isMatchingWorkbook,
  isAnimeSourceFilename,
  extractFileNameFromPath,
  findAnimeSourceSheetInWorkbook,
  loadDetectedPaths,
  persistDetectedPaths,
  isWorkbookOpen,
  mergeCandidatePaths,
  collectDetectedWorkbookPaths,
  mergeDetectedPathsIntoStorage,
  describeOpenWorkbooks,
  ANIME_SOURCE_DETECTOR,
  BANGUMI_TARGET_DETECTOR,
  ALL_DETECTORS,
  ANIME_SOURCE_FILENAME_KEYWORDS,
} from './sync/workbook-auto-detect.js'
