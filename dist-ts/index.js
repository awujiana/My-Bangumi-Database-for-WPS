/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口。
 *              其他模块只需 `import { ... } from '../types/index.js'`
 *              即可获取所有核心功能与类型，降低模块间耦合。
 */
// ========== 全局未捕获 Promise 拒绝处理（兜底机制） ==========
// 监听 unhandledrejection 事件，作为异步错误处理的最后一道防线。
// 此处理只作为兜底，不能替代局部 try/catch 与 Promise.catch()。
if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        // 使用 console.error 而非 bgmLog，避免在模块初始化阶段产生循环依赖
        console.error('[unhandledrejection]', message);
        // 阻止默认的控制台报错行为（已由本处理器记录）
        event.preventDefault();
    });
}
// ============================================================================
// 1. 核心常量与枚举（来自 core/constants.js）
// ============================================================================
export { 
// 错误级别枚举（SILENT, WARN, ERROR, THROW）
ErrorLevel, 
// WPS 枚举值（如 xlUp, xlNone 等）
WPS_ENUM, XL, 
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
BGM_SUBJECT_TYPES, COLLECTION_TYPE_NAMES, 
// 同步状态常量
SYNC_STATUS, COLUMN_RULES, HEADER_KEYWORDS, IMPORTANT_COLS, FIELD_NAME_MAP, URL_PATTERNS, TOKEN_CONFIG, WATCH_STATUS_MAP, COLUMNS, SYNC_RECORD_SHEET_NAME, SYNC_RECORD_COLUMNS, SYNC_RECORD_COL, SYNC_RECORD_TYPE_COLOR, } from './core/constants.js';
// ============================================================================
// 2. 错误处理与结果类型（来自 core/result.js）
// ============================================================================
export { 
// 统一的业务错误类
BgmError, 
// 操作结果类型（成功/失败）
Result, } from './core/result.js';
// ============================================================================
// 3. Token 加密/解密（来自 core/crypto.js）
// ============================================================================
export { 
// 计算校验和
calcChecksum, 
// 从解密字符串提取 Token
extractToken, 
// XOR 加密
encryptToken, 
// XOR 解密
decryptToken, } from './core/crypto.js';
// ============================================================================
// 4. HTTP 请求模块（来自 tools/http.js）
// ============================================================================
export { 
// 异步 HTTP 请求（支持重试）
httpRequest, } from './tools/http.js';
// ============================================================================
// 5. UI 对话框（对话框函数与类型）
// ============================================================================
export { showAlert, // 提示
showConfirm, // 确认
showError, // 错误
showSuccess, // 成功
showInput, // 输入
showToast, // Toast 通知
showSyncResult, // 同步结果（可展开详情）
showSyncProgressDialog, updateSyncProgressDialog, completeSyncProgressDialog, hideSyncProgressDialog, } from './ui/dialog.js';
// ============================================================================
// 6. UI 消息通信（来自 ui/message.js）
// ============================================================================
export { 
// 设置状态栏消息
setStatus, initMessageListener, } from './ui/message.js';
// ============================================================================
// 7. UI 事件处理（来自 ui/handlers.js）
// ============================================================================
export { 
// 显示用户 ID 设置对话框
showUserIdDialog, updateTokenStatus, updateUserIdStatus, showTokenDialog, testDebugConnection, syncCollectionFromBgm, openUserCollection, 
// 资源清理（防止事件监听器与定时器泄漏）
removeMessageListener, clearAllPendingTimeouts, } from './ui/handlers.js';
// ============================================================================
// 8. 同步记录工作表（来自 sync/syncRecord.js）
// ============================================================================
export { 
// 导入同步记录模块的函数
getOrCreateSyncRecordSheet, getSyncRecordSheetIfExists, getAllSyncRecords, addSyncRecord, deduplicateSyncRecords, formatSyncRecordSheet, openSyncRecordSheet, clearSyncRecords, } from './sync/syncRecord.js';
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
syncSelectedRows, mapWatchStatus, buildJsonPayload, bgmRequestSync, setBangumiToken, openBangumiTokenPage, testTokenValidityForRibbon, buildTagsArray, addTagsFromStr, } from './sync/exceltobangumi.js';
// ============================================================================
// 10. 同步收藏抓取（来自 sync/scraping.js）
// ============================================================================
export { 
// 异步验证 Token
verifyToken, 
// 异步获取所有收藏
fetchAllUserCollections, } from './sync/scraping.js';
// ============================================================================
// 11. GitHub 仓库增量同步（来自 sync/githubSync.js + sync/githubConfig.js）
// ============================================================================
export { 
// 主入口：从 GitHub 同步到本地 Excel
syncFromGithub, 
// 下载远程 JSON
fetchGithubJson, 
// 读取本地条目（封装入口）
readLocalEntriesForSync, 
// 应用差异到工作表
applyDiffToSheet, 
// 应用用户冲突解决决策到 diff 列表
applyConflictResolutions, } from './sync/githubSync.js';
export { 
// 纯函数：差异计算（零依赖，可在 Node 测试环境运行）
computeDiff, mapTypeToWatchStatus, tagsToString, SYNC_STRATEGY_LABELS, } from './sync/githubSyncDiff.js';
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
DEFAULT_GITHUB_CONFIG, } from './sync/githubConfig.js';
// ============================================================================
// 12. 通用工具函数与全局状态（来自 tools/util.js）
// ============================================================================
export { 
// 日志函数
bgmLog, 
// 获取 WPS Application 对象
getApp, 
// 列号转字母
colNumToLetter, 
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
calcFingerprint, } from './tools/util.js';
// ============================================================================
// 13. 配置管理模块（来自 tools/config.js）
// ============================================================================
export { 
// 配置键名常量
CONFIG_KEYS, 
// 配置操作函数
setConfig, getConfig, removeConfig, 
// 增量同步配置
setIncrementalSync, getIncrementalSync, 
// 跳过冲突配置
setSkipConflicts, getSkipConflicts, 
// 同步记录开关
setSyncRecordEnabled, getSyncRecordEnabled, } from './tools/config.js';
// ============================================================================
// 14. URL 自动补全（来自 tools/autoFillUrl.js）
// ============================================================================
export { 
// 执行 URL 自动补全
autoFillUrls, 
// 显示确认对话框后执行
showAutoFillUrlDialog, } from './tools/autoFillUrl.js';
// ============================================================================
// 15. 页面逻辑（来自 taskpane.js）
// ============================================================================
export { refreshSheets, toggleSheetLock, 
// 刷新数据预览
refreshData, } from './taskpane.js';
// 预览函数
export { 
// 显示预览内容
previewSyncContent, closeDetailModal, syncAllRows, } from './ui/preview.js';
// ============================================================================
// 17. WPS 操作接口（类型守卫与类型定义）
// ============================================================================
export { 
// 判断对象是否为 WPS Application
isWpsApp, 
// 判断对象是否为 WPS 工作表
isWpsWorksheet, 
// 判断对象是否为 WPS Range
isWpsRange, wpsMsgBox, } from './tools/wps.js';
// ============================================================================
// 18. 服务层（来自 services/ribbonService.js）
// ============================================================================
export { detectConflicts, getSyncPreview, detectGithubConflicts, } from './services/ribbonService.js';
// ============================================================================
// 19. 冲突解决 UI（来自 ui/conflictResolver.js）
// ============================================================================
export { showConflictResolver } from './ui/conflictResolver.js';
