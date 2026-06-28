/**
 * BGM 全局类型定义（统一中转模块）
 * @module types/index
 * @description 所有项目的全局类型、接口、类、枚举的统一导出入口。
 *              其他模块只需 `import { ... } from '../types/index.js'`
 *              即可获取所有核心功能与类型，降低模块间耦合。
 */

// 类型导入：用于 BGMSync 接口中的 currentSheet 字段类型
import type { WpsWorksheet } from './tools/wps.js';

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
    BGM_SUBJECT_TYPES, COLLECTION_TYPE_NAMES,
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
    showSyncResult,      // 同步结果（可展开详情）
    showSyncProgressDialog,
    updateSyncProgressDialog,
    completeSyncProgressDialog,
    hideSyncProgressDialog,
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
    updateTokenStatus, 
    updateUserIdStatus, 
    showTokenDialog,
    testDebugConnection,
    syncCollectionFromBgm,
    openUserCollection
} from './ui/handlers.js';

// ============================================================================
// 8. 同步记录工作表（来自 sync/syncRecord.js）
// ============================================================================
export {
    // 导入同步记录模块的函数
    getOrCreateSyncRecordSheet,
    getSyncRecordSheetIfExists,
    getAllSyncRecords,
    addSyncRecord,
    deduplicateSyncRecords,
    formatSyncRecordSheet,
    openSyncRecordSheet,
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
    // 同步选中行
    syncSelectedRows,
    mapWatchStatus,
    buildJsonPayload,
    bgmRequestSync,
    setBangumiToken,
    openBangumiTokenPage,
    testTokenValidityForRibbon,
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
    calcFingerprint
} from './tools/util.js';

// ============================================================================
// 12. 配置管理模块（来自 tools/config.js）
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
    getIncrementalSync,
    // 跳过冲突配置
    setSkipConflicts,
    getSkipConflicts,
    // 同步记录开关
    setSyncRecordEnabled,
    getSyncRecordEnabled,
} from './tools/config.js';

// ============================================================================
// 13. URL 自动补全（来自 tools/autoFillUrl.js）
// ============================================================================
export {
    // 执行 URL 自动补全
    autoFillUrls,
    // 显示确认对话框后执行
    showAutoFillUrlDialog,
    type AutoFillResult,
    type NameUrlMap,
} from './tools/autoFillUrl.js';

// ========== BGM 缓存数据结构 ==========
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

// BGM 状态接口（用于描述 BGM 对象的类型）
// ========== BGM 工作表状态 ==========
export interface BGMSheet {
    /** 锁定的工作表索引 */
    lockedIndex: number | null;
    /** 锁定的工作表名称 */
    lockedName: string | null;
    /** 是否已锁定 */
    isLocked: boolean;
}

// ========== BGM 同步状态 ==========
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

// ========== BGM 用户信息 ==========
export interface BGMUserInfo {
    /** 用户 ID */
    id: string;
    /** 用户名 */
    username: string;
}



// ============================================================================
// 14. 页面逻辑（来自 taskpane.js）
// ============================================================================

export {
    refreshSheets, 
    toggleSheetLock, 
     // 刷新数据预览
    refreshData,

     
} from './taskpane.js';
// ============================================================================
// 15. 预览模块（类型部分）
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
    syncAllRows,

    
} from './ui/preview.js';

// ============================================================================
// 16. WPS 操作接口（类型守卫与类型定义）
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




// ============================================================================
// 17. 服务层（来自 services/ribbonService.js）
// ============================================================================
export { detectConflicts, getSyncPreview }from'./services/ribbonService.js';
