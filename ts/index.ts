/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口。
 *              其他模块只需 `import { ... } from '../types/index.js'`
 *              即可获取所有核心功能与类型，降低模块间耦合。
 */

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
    // 同步状态常量
    SYNC_STATUS,
    COLUMN_RULES,
    HEADER_KEYWORDS, 
    IMPORTANT_COLS,
    TYPE_TEXT_MAP,
    FIELD_NAME_MAP,
    URL_PATTERNS,
    TOKEN_CONFIG,
    WATCH_STATUS_MAP,
    COLUMNS,
} from './core/constants.js';

// ============================================================================
// 2. 错误处理与结果类型（来自 core/result.js）
// ============================================================================
export {
    // 统一的业务错误类
    BgmError,
    // 操作结果类型（成功/失败）
    Result,
    
    type BatchSyncResult,
} from './core/result.js';

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
    decryptToken,
} from './core/crypto.js';

// ============================================================================
// 4. HTTP 请求模块（来自 tools/http.js）
// ============================================================================
export {
    // 异步 HTTP 请求（支持重试）
    httpRequest,
    // HTTP 方法类型（GET/POST/PUT/DELETE/PATCH）
    type HttpMethod,
} from './tools/http.js';

// ============================================================================
// 5. UI 对话框（对话框函数与类型）
// ============================================================================
export {
    showAlert,           // 提示
    showConfirm,         // 确认
    showError,           // 错误
    showSuccess,         // 成功
    showInput,           // 输入
    showToast,           // Toast 通知
} from './ui/dialog.js';

export {
    // 对话框按钮配置
    type DialogButton,
    // 对话框配置
    type DialogConfig,
    // 对话框回调
    type DialogCallback,
    // 对话框选项
    type DialogOptions,
   
} from './ui/dialog.js';

// ============================================================================
// 6. UI 消息通信（来自 ui/message.js）
// ============================================================================
export {
    // 设置状态栏消息
    setStatus,
    initMessageListener,
    // 设置同步运行状态（是否正在同步）
     setSyncRunning,
} from './ui/message.js';

// ============================================================================
// 7. UI 事件处理（来自 ui/handlers.js）
// ============================================================================
export {
    // 显示用户 ID 设置对话框
    showUserIdDialog,
    markUploadedItems, 
    clearSheetMarks, 
    updateTokenStatus, 
    updateUserIdStatus, 
    showTokenDialog,
    testDebugConnection,
    syncCollectionFromBgm
} from './ui/handlers.js';

// ============================================================================
// 8. 同步记录工作表（来自 sync/syncRecord.js）
// ============================================================================
export {
    // 导入同步记录模块的函数
    getOrCreateSyncRecordSheet,
    getAllSyncRecords,
    addSyncRecord,
    openSyncRecordSheet,
    // 清除 D 列颜色标记（COM 版本）
    clearSheetMarksInSheet,
   type SyncRecord,
    type UpdateRecordParams,
    clearSyncRecords,
} from './sync/syncRecord.js';


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
    // 清除所有行颜色标记
    clearRowColors,
    // 测试单个条目更新
    testSingleUpdate,
    mapWatchStatus,
    buildJsonPayload,
    bgmRequestSync,
    setBangumiToken,
    openBangumiTokenPage,
    testTokenValidityForRibbon,
    openUserCollection,
    buildTagsArray,
    addTagsFromStr,
 
} from './sync/exceltobangumi.js';

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
} from './sync/scraping.js';

// ============================================================================
// 11. 通用工具函数与全局状态（来自 tools/util.js）
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
    // 安全获取单元格值
    getCellValue,
    // 读取单元格文本（兼容多种取值方式）
    readCell,
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
    // 获取用户 ID
    _getBgmUserId,
    // 设置用户 ID
    _setBgmUserId,
    // Promise 版本获取用户信息
    fetchBgmUserInfo,
    // 去除首尾空格
    trim,
    // BGM 全局命名空间（包含 Dialog, Message, handleError 等）
    BGM,
    _getUserApiPath, 
   _fetchBgmUserInfo,
    showBangumiPanel,
   
    sleep,
    delay,
    readRangeValues,
     // 获取列映射（固定表头名称到列号的映射）
    getColumnMap,
    cacheGet,
    clearSheetCache,
      // 获取最后一行
    getLastRow,
    isEmptyValue,
    getDataSheet,
      // 查找表头行
    findHeaderRow,
    shellExecuteByOAAssist,
    GetUrlPath,

} from './tools/util.js';

// BGM 状态接口（用于描述 BGM 对象的类型）
export type {
    // 缓存数据结构（totalRows, userId 等）
    BGMCache,
    // 工作表锁定状态
    BGMSheet,
    // 同步运行状态
    BGMSync,
    // 用户信息
    BGMUserInfo,
    
} from './tools/util.js';

// ============================================================================
// 12. 页面逻辑（来自 taskpane.js）
// ============================================================================

export {
    refreshSheets, 
    toggleSheetLock, 
     // 刷新数据预览
    refreshData,

     
} from './taskpane.js';
// ============================================================================
// 13. 预览模块（类型部分）
// ============================================================================
export type {
    // 数据预览单项
    DetailItem,
    // 预览项（HTML+类型）
    PreviewItem,
    // 预览数据状态
    DetailPreviewData,
} from './ui/preview.js';

// 预览函数
export {
    // 显示预览内容
    previewSyncContent,
    closeDetailModal,
} from './ui/preview.js';

// ============================================================================
// 14. WPS 操作接口（类型守卫与类型定义）
// ============================================================================
export {
    // 判断对象是否为 WPS Application
    isWpsApp,
    // 判断对象是否为 WPS 工作表
    isWpsWorksheet,
    // 判断对象是否为 WPS Range
    isWpsRange,
     wpsMsgBox,
} from './tools/wps.js';

export type {
    // 扩展的 Window 接口（挂载了大量 BGM 函数）
    BgmWindow,
    // WPS Application 最小化接口
    WpsApplication,
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
} from './tools/wps.js';