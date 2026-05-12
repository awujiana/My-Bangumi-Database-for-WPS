# BGM 追番标记助手 - Code Wiki

## 项目概述

**BGM 追番标记助手** 是一款面向 WPS Office ET（Excel）的加载项插件，用于帮助用户管理番剧/动漫收藏列表，并与 Bangumi（追番网站）进行数据同步。

### 核心功能

- 📊 **Excel 数据管理**：在 WPS Excel 中管理番剧条目信息
- 🔄 **双向同步**：将 Excel 数据同步至 Bangumi，或从 Bangumi 拉取收藏
- 🔐 **Token 管理**：安全存储和验证 Bangumi API Access Token
- 🎨 **智能识别**：自动检测 Excel 表头和关键列
- 📝 **同步记录**：记录所有同步操作，支持增量同步
- 🎯 **冲突检测**：检测 Excel 与 Bangumi 之间的数据冲突

### 技术栈

| 类别 | 技术 |
|------|------|
| 开发框架 | WPS Office ET Add-in |
| 语言 | TypeScript 6.0+ |
| 构建工具 | Vite 6.0+ |
| 类型声明 | et-jsapi-declare |
| 开发调试 | wpsjs |

---

## 项目架构

### 目录结构

```
BGM/
├── ts/                         # TypeScript 源代码
│   ├── index.ts                # 主入口模块，统一导出所有API
│   ├── ribbon.ts               # 功能区(Ribbon)回调处理
│   ├── taskpane.ts             # 任务面板主逻辑
│   ├── core/                   # 核心模块
│   │   ├── constants.ts        # 全局常量与枚举定义
│   │   ├── crypto.ts           # Token 加密解密
│   │   └── result.ts           # 结果类型与错误类
│   ├── services/               # 服务层
│   │   └── ribbonService.ts    # Ribbon 业务逻辑服务
│   ├── sync/                   # 同步模块
│   │   ├── exceltobangumi.ts   # Excel → Bangumi 同步核心
│   │   ├── scraping.ts         # Bangumi API 数据拉取
│   │   └── syncRecord.ts       # 同步记录管理
│   ├── tools/                  # 工具模块
│   │   ├── events.ts           # 事件总线
│   │   ├── http.ts             # HTTP 请求封装
│   │   ├── util.ts             # 通用工具函数
│   │   └── wps.ts              # WPS API 类型定义
│   └── ui/                     # UI 模块
│       ├── dialog.ts           # 自定义对话框
│       ├── handlers.ts         # UI 事件处理器
│       ├── message.ts          # 消息通信
│       └── preview.ts          # 数据预览
├── ui/
│   └── taskpane.html           # 任务面板 HTML
├── css/                        # 样式文件
├── images/                     # 图标资源
├── dist-ts/                    # TypeScript 编译输出
├── manifest.xml                # WPS 加载项清单
├── package.json                # 项目配置
├── vite.config.js              # Vite 构建配置
└── tsconfig.json               # TypeScript 配置
```

### 模块依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                      index.ts (统一导出)                       │
│   导入 core/services/sync/tools/ui 模块，提供单一入口          │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   ribbon.ts   │    │  taskpane.ts  │    │   main.js    │
│  Ribbon回调   │    │  面板逻辑     │    │   初始化     │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                      核心业务模块                             │
├─────────────┬─────────────┬─────────────┬───────────────────┤
│   core/     │   services/ │    sync/    │      tools/       │
│  - constants│  - ribbon   │  - excelto   │  - util           │
│  - crypto   │    Service  │    bangumi   │  - events         │
│  - result   │             │  - scraping  │  - http           │
│             │             │  - syncRecord│  - wps            │
├─────────────┴─────────────┴─────────────┴───────────────────┤
│                         ui/                                  │
│  - dialog   - handlers   - message   - preview              │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心模块详解

### 1. 核心模块 (core/)

#### 1.1 constants.ts - 全局常量定义

**文件位置**：[ts/core/constants.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/constants.ts)

**职责**：存储所有全局常量、枚举、配置值和映射表。

**主要常量**：

| 常量名 | 类型 | 说明 |
|--------|------|------|
| `WPS_ENUM` | Object | WPS 枚举值（任务窗格停靠位置等） |
| `XL` | Object | Excel 方向常量（xlUp, xlDown 等） |
| `BGM_CONFIG` | Object | Bangumi API 配置（API_BASE, REQUEST_DELAY 等） |
| `BGM_COLOR` | Object | 单元格颜色常量（SUCCESS, FAIL, SKIP 等） |
| `LOG_LEVELS` | Object | 日志级别（DEBUG, INFO, WARN, ERROR） |
| `WATCH_STATUS_MAP` | Record | 观看状态文本到数值的映射 |
| `HEADER_KEYWORDS` | string[] | 表头识别关键字列表 |
| `COLUMN_RULES` | Array | 列名匹配规则（正则 → 标准列名） |
| `FIELD_NAME_MAP` | Record | 字段名标准化映射 |
| `URL_PATTERNS` | RegExp[] | Bangumi URL 匹配模式 |

**示例**：

```typescript
// 观看状态映射
export const WATCH_STATUS_MAP: Record<string, number> = {
    "看过": 3, "看完": 3, "completed": 3,  // 已看完
    "在看": 2, "watching": 2,               // 正在看
    "想看": 0, "wish": 0,                   // 想看
    "搁置": 4, "on_hold": 4,                 // 搁置
    "抛弃": 5, "drop": 5                    // 抛弃
};

// 表头关键字（用于自动识别）
export const HEADER_KEYWORDS = [
    "序列号", "是否看完", "完播日", "打分",
    "名称", "bangumi url", "观看状态", ...
];
```

#### 1.2 result.ts - 结果类型与错误处理

**文件位置**：[ts/core/result.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/result.ts)

**核心类**：

##### BgmError 类

继承自 Error 的业务错误类：

```typescript
class BgmError extends Error {
    code: string;           // 错误码（TOKEN_INVALID, NETWORK_ERROR 等）
    details: Record<string, any>;  // 错误详情
    timestamp: string;       // 错误发生时间
    
    constructor(message: string, code: string = 'UNKNOWN', details: object = {});
    toString(): string;     // 格式：[错误码] 消息
}
```

##### Result<T> 泛型类

用于包装操作结果（成功/失败）：

```typescript
class Result<T> {
    readonly success: boolean;
    readonly data: T | null;
    readonly error: BgmError | null;
    
    static ok<T>(data: T): Result<T>;           // 创建成功结果
    static fail<T>(error: BgmError): Result<T>;  // 创建失败结果
    static fromCode<T>(code: number, data?): Result<T>;  // 根据HTTP状态码
    
    isOk(): boolean;     // 判断是否成功
    isFail(): boolean;   // 判断是否失败
    unwrap(): T;         // 获取数据，失败抛异常
    unwrapOr(defaultValue: T): T;  // 获取数据或默认值
    map<U>(fn: (data: T) => U): Result<U>;  // 转换数据
}
```

#### 1.3 crypto.ts - Token 加密解密

**文件位置**：[ts/core/crypto.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/crypto.ts)

**主要函数**：

| 函数 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `encryptToken(token: string)` | 明文 Token | 加密字符串 | XOR 加密 |
| `decryptToken(encrypted: string)` | 加密字符串 | 明文 Token | XOR 解密 |
| `calcChecksum(str: string)` | 原始字符串 | number | 计算校验和（用于指纹） |
| `extractToken(decrypted: string)` | 解密字符串 | string \| null | 从解密结果提取 Token |

---

### 2. 工具模块 (tools/)

#### 2.1 util.ts - 通用工具函数

**文件位置**：[ts/tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)

**核心功能**：

##### Application 获取

```typescript
function getApp(): WpsApplication | null
// 获取 WPS Application 对象（使用类型守卫）
```

##### 单元格操作

```typescript
function colNumToLetter(col: number): string
// 列号转字母：A, B, ..., Z, AA, AB, ...

function getCell(ws, row, col): Range | null
// 获取单元格对象

function getCellValue(ws, row, col): string
// 获取单元格值（兼容多种取值方式）

function readCell(ws, row, col): string
// 读取单元格文本（统一接口）

function setCellValue(ws, row, col, value): boolean
// 设置单元格值

function readRangeValues(ws, startRow, endRow, startCol, endCol): string[][]
// 批量读取范围值，返回二维数组
```

##### 表头与列操作

```typescript
function findHeaderRow(ws, startRow?): number
// 查找表头行（根据 HEADER_KEYWORDS 匹配）

function getColumnMap(ws, headerRow): Map<string, number>
// 获取列名到列号的映射

function getLastRow(ws, forceRefresh?, headerRow?): number
// 获取最后数据行（支持多列回退）
```

##### Token 管理

```typescript
function storeBgToken(token: string): boolean
// 加密存储 Token

function loadBgToken(): string | null
// 解密加载 Token

function clearBgToken(): boolean
// 清除 Token
```

##### 用户信息

```typescript
function _getBgmUserId(): string | null
// 获取 Bangumi 用户 ID

function _setBgmUserId(id: string): void
// 设置 Bangumi 用户 ID

function _getUserApiPath(): string
// 获取用户 API 路径（格式：/-/{userId}）
```

##### 面板与同步

```typescript
function showBangumiPanel(): void
// 显示/隐藏同步面板

function getDataSheet(): Worksheet | null
// 获取当前数据工作表

function calcFingerprint(fields: string[]): string
// 计算数据指纹（用于增量同步）
```

##### 缓存管理

```typescript
function cacheGet<T>(key: string, factory: () => T): T
// 获取或设置缓存

function clearSheetCache(ws): void
// 清除工作表相关缓存
```

#### 2.2 events.ts - 事件总线

**文件位置**：[ts/tools/events.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/events.ts)

**核心 API**：

```typescript
// 事件名称常量
BGM_EVENTS = {
    TOKEN_UPDATED,      // Token 更新
    USER_ID_UPDATED,    // 用户 ID 更新
    USER_NAME_UPDATED,  // 用户名更新
    SYNC_PROGRESS,      // 同步进度
    SYNC_COMPLETED,     // 同步完成
    SYNC_ERROR          // 同步错误
};

// 事件总线
eventBus = {
    on(event, handler): void,      // 订阅事件
    off(event, handler): void,    // 取消订阅
    emit(event, data?): void,     // 触发事件
    once(event, handler): void     // 单次订阅
};
```

#### 2.3 http.ts - HTTP 请求封装

**文件位置**：[ts/tools/http.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/http.ts)

```typescript
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

function httpRequest(
    url: string,
    method: HttpMethod,
    options?: {
        headers?: Record<string, string>;
        body?: string;
        retries?: number;
        retryDelay?: number;
    }
): Promise<{ status: number; data: any; message: string }>
```

#### 2.4 wps.ts - WPS API 类型定义

**文件位置**：[ts/tools/wps.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/wps.ts)

**主要接口**：

```typescript
interface WpsApplication {
    ActiveWorkbook: WpsWorkbook;
    Selection: any;
    StatusBar: any;
    Enum: typeof WPS_ENUM;
    PluginStorage: WpsPluginStorage;
    RibbonUI: any;
    CreateTaskPane(url: string): WpsTaskPane;
    GetTaskPane(id: string): WpsTaskPane;
}

interface WpsWorkbook {
    Worksheets: WpsWorksheets;
    ActiveSheet: WpsWorksheet;
    Sheets: WpsSheets;
}

interface WpsWorksheet {
    Name: string;
    Range(addr: string): WpsRange;
    Cells(row, col): WpsRange;
    AutoFilter: WpsAutoFilter;
    UsedRange: WpsRange;
    Rows: WpsRows;
    Columns: WpsColumns;
}

interface WpsRange {
    Value: any;
    Value2: any;
    Text: string;
    Row: number;
    Column: number;
    Rows: WpsRows;
    Columns: WpsColumns;
    Interior: WpsInterior;
    Areas: WpsAreas;
    End(direction: number): WpsRange;
    SpecialCells(type: number): WpsRange;
}

interface WpsAutoFilter {
    Mode: boolean;
    Range: WpsRange;
    Filters: WpsFilters;
}
```

**类型守卫**：

```typescript
function isWpsApp(obj: any): boolean
function isWpsWorksheet(obj: any): boolean
function isWpsRange(obj: any): boolean
```

---

### 3. 同步模块 (sync/)

#### 3.1 exceltobangumi.ts - 同步核心

**文件位置**：[ts/sync/exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts)

**核心函数**：

##### URL 处理

```typescript
function extractSubjectId(input: string): string
// 从 URL 或文本提取 Bangumi Subject ID
// 支持：bgm.tv/subject/123, bangumi.tv/subject/123, 直接数字
```

##### 状态转换

```typescript
function mapWatchStatus(status: string): number
// 观看状态文本 → Bangumi API 数值
// 返回：0=想看, 2=在看, 3=看过, 4=搁置, 5=抛弃
```

##### 标签处理

```typescript
function addTagsFromStr(tagSet: Set<string>, raw: string): void
// 从字符串解析标签（支持 , | ; 等分隔符）

function buildTagsArray(tagsRaw: string): string[]
// 构建标签数组
```

##### 筛选状态

```typescript
function getFilterStatus(lastRow?, headerRow?): {
    hasFilter: boolean;
    visibleRows: number[];  // 可见行列表
    hiddenRows: number[];   // 隐藏行列表
}
// 检测工作表筛选状态，返回可见行
```

##### 同步构建

```typescript
function buildJsonPayload(
    ws,              // 工作表
    rowNum,          // 行号
    colMap,          // 列映射
    finishedDate     // 完播日期
): string
// 构建 Bangumi API 请求体 JSON

function bgmRequestSync(
    method,          // HTTP 方法
    endpoint,        // API 端点
    jsonBody,        // 请求体
    token            // API Token
): { code: number; message: string }
// 发送 Bangumi 同步请求
```

##### 主同步函数

```typescript
async function SyncToBangumiAsync(
    ws,
    colMap,
    token,
    lastRow,
    headerRow,
    options?: {
        onProgress?: (current, total, message) => void;
        onItemComplete?: (row, success, result) => void;
        skipSids?: Set<string>;     // 冲突跳过
        incremental?: boolean;      // 增量同步
    }
): Promise<{ success: number; fail: number; skip: number }>

// 主要同步入口：
// 1. 获取筛选可见行
// 2. 批量读取单元格数据
// 3. 增量同步指纹检查
// 4. 调用 Bangumi API
// 5. 标记同步结果颜色
// 6. 记录同步历史
```

#### 3.2 scraping.ts - 数据拉取

**文件位置**：[ts/sync/scraping.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/scraping.ts)

**核心函数**：

```typescript
interface TokenVerifyResult {
    valid: boolean;
    message: string;
    userId?: string;
    username?: string;
}

async function verifyToken(token: string): Promise<TokenVerifyResult>
// 验证 Bangumi API Token（调用 /v0/me）

async function fetchAllUserCollections(
    token: string,
    userId?: string,
    options?: {
        limit?: number;       // 每页数量，默认30
        maxTotal?: number;    // 最大获取数，默认1000
        onProgress?: (page, total) => void;
    }
): Promise<any[]>
// 获取用户全部收藏（自动分页）

async function fetchSubjectCollection(
    token: string,
    subjectId: string
): Promise<ApiResponse>
// 获取单个条目收藏状态
```

#### 3.3 syncRecord.ts - 同步记录

**文件位置**：[ts/sync/syncRecord.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/syncRecord.ts)

**核心函数**：

```typescript
interface SyncRecord {
    seq?: number;
    time?: string;
    name?: string;
    url?: string;
    sid?: string;
    type?: string;
    count?: number;
    content?: string;
    status?: string;
    message?: string;
    fingerprint?: string;
    row?: number;
}

function getOrCreateSyncRecordSheet(): Worksheet
// 获取或创建「同步记录」工作表

function addSyncRecord(params: UpdateRecordParams): boolean
// 添加同步记录（同一 SID 更新次数，已上传标记颜色）

function getAllSyncRecords(): SyncRecord[]
// 获取所有同步记录（带缓存）

function clearSyncRecords(): boolean
// 清除所有同步记录

function openSyncRecordSheet(): void
// 打开同步记录工作表

function clearSheetMarksInSheet(sheetIndex: number): void
// 清除指定工作表的颜色标记
```

---

### 4. 服务模块 (services/)

#### 4.1 ribbonService.ts - Ribbon 业务逻辑

**文件位置**：[ts/services/ribbonService.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/services/ribbonService.ts)

**核心函数**：

```typescript
function getSyncPreview(
    ws, colMap, lastRow, headerRow
): { total, valid, willSync, willSkip, alreadyUploaded }
// 预览同步统计（不发送请求）

async function detectConflicts(
    ws, colMap, lastRow, headerRow, token
): Promise<{
    conflicts: Array<{ row, sid, name, existingType, newType }>;
    conflictCount: number;
    bgmCollectionReady: boolean;
}>
// 检测 Excel 与 Bangumi 收藏的冲突

async function syncWithConfirmation(): Promise<void>
// Ribbon 完整同步流程：
// 1. 预览统计
// 2. 冲突检测
// 3. 确认弹窗
// 4. 执行同步

function setTokenForRibbon(): Promise<boolean>
// 设置 Token（使用 InputBox）
function testTokenForRibbon(): void
// 测试 Token 有效性
function setUserIdForRibbon(): void
// 设置用户 ID
function openCollectionForRibbon(): void
// 打开 Bangumi 收藏页面
function clearColorsForRibbon(): void
// 清除颜色标记
```

---

### 5. UI 模块 (ui/)

#### 5.1 dialog.ts - 对话框组件

**文件位置**：[ts/ui/dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts)

**公开 API**：

```typescript
function showAlert(message: string, title?: string, onOk?: () => void): void
function showConfirm(message: string, callback: (confirmed: boolean) => void, title?: string): void
function showError(message: string, title?: string, onOk?: () => void): void
function showWarning(message: string, title?: string, onOk?: () => void): void
function showSuccess(message: string, title?: string, onOk?: () => void): void
function showInput(title: string, prompt: string, defaultValue?: string, onOk?: (value) => void, onCancel?: () => void): void
function showToast(message: string, type?: string): void  // type: 'info', 'success', 'warn', 'error'
```

#### 5.2 handlers.ts - UI 事件处理

**文件位置**：[ts/ui/handlers.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts)

**主要处理器**：

```typescript
function showUserIdDialog(): void
// 显示用户 ID 设置对话框
function showTokenDialog(): void
// 显示 Token 设置对话框
function markUploadedItems(): void
// 标记已上传条目
function clearSheetMarks(): void
// 清除所有颜色标记
function updateTokenStatus(): void
// 更新 Token 状态显示
function updateUserIdStatus(): void
// 更新用户 ID 状态显示
function testDebugConnection(): void
// 测试调试连接
async function syncCollectionFromBgm(): Promise<void>
// 从 Bangumi 同步收藏到 Excel
```

#### 5.3 message.ts - 消息通信

**文件位置**：[ts/ui/message.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/message.ts)

```typescript
function initMessageListener(): void
// 初始化消息监听（用于与其他任务窗格通信）

function setStatus(message: string): void
// 设置状态栏消息

function setSyncRunning(isRunning: boolean): void
// 设置同步运行状态
```

#### 5.4 preview.ts - 数据预览

**文件位置**：[ts/ui/preview.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts)

```typescript
interface PreviewItem {
    row: number;
    cols: Array<{ text: string; important: boolean }>;
    isHeader: boolean;
    aligned: boolean;
}

interface DetailItem {
    row: number;
    sid: string;
    name: string;
    type: number;
    rate: string;
    tags: string[];
    comment: string;
}

interface DetailPreviewData {
    items: DetailItem[];
    ws: any;
}

function previewSyncContent(): void
// 显示同步预览内容

function closeDetailModal(): void
// 关闭详情模态框
```

---

### 6. 主模块

#### 6.1 index.ts - 统一导出

**文件位置**：[ts/index.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/index.ts)

该模块作为单一入口，统一导出所有其他模块的公共 API。其他模块只需从 `'./index.js'` 导入即可获取全部功能。

#### 6.2 ribbon.ts - 功能区回调

**文件位置**：[ts/ribbon.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ribbon.ts)

**Ribbon 回调函数**（在 Ribbon XML 中通过 `onAction` 调用）：

| 函数 | 说明 |
|------|------|
| `OnAddinLoad(ribbonUI)` | 加载项初始化 |
| `OnAction(control)` | 按钮点击处理（分发到具体功能） |
| `GetBangumiImage(control)` | 获取按钮图标 |
| `GetSkipConflictsPressed(control)` | 获取「跳过冲突」复选框状态 |
| `OnSkipConflictsChange(control)` | 「跳过冲突」状态变更 |
| `GetIncrementalSyncPressed(control)` | 获取「增量同步」复选框状态 |
| `OnIncrementalSyncChange(control)` | 「增量同步」状态变更 |

**按钮 ID 映射**：

| ID | 功能 |
|----|------|
| `btnShowPanel` | 显示面板 |
| `btnSyncBangumi` | 同步到 Bangumi |
| `btnSetToken` | 设置 Token |
| `btnTestToken` | 测试 Token |
| `btnSetUserId` | 设置用户 ID |
| `btnOpenCollection` | 打开收藏页 |
| `btnClearColors` | 清除颜色 |

#### 6.3 taskpane.ts - 任务面板逻辑

**文件位置**：[ts/taskpane.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/taskpane.ts)

**核心功能**：

##### 初始化

```typescript
function initPanel(): void
// 初始化面板：设置枚举、初始化消息监听、恢复锁定工作表、自动检测工作表
```

##### 工作表管理

```typescript
function refreshSheets(): void
// 刷新工作表列表

function toggleSheetLock(): void
// 切换工作表锁定状态

function saveLockedSheet(info: LockedSheetInfo | null): void
function restoreLockedSheet(): boolean
// 保存/恢复锁定状态到 PluginStorage
```

##### 表头检测

```typescript
function detectHeaderAndColumns(
    ws, 
    opts?: { visibleRowSet?, isFiltered? }
): HeaderMeta
// 检测表头行和数据范围
// 返回：headerRow, headerNames, isImportant, dataStartRow, lastCol 等

function autoDetectSheet(): { sheetIndex, sheetName, headerRow, ... } | null
// 自动检测最佳数据工作表（根据列数和关键词匹配）
```

##### 筛选状态

```typescript
function updateFilterStatus(targetWs?): void
// 更新筛选状态显示
```

##### 数据预览

```typescript
function refreshData(): void
// 刷新数据预览表格

function renderPreviewTable(rows, sheetIndex, sheetName, headerRow): string
// 渲染预览表格 HTML
```

---

## BGM 全局命名空间

**定义位置**：[ts/tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)

```typescript
export const BGM = {
    // 缓存数据
    cache: {
        totalRows: number;
        userId: string | null;
        username: string | null;
        sidCache: Map<string, string>;
        listCache: any[];
    };
    
    // 工作表状态
    sheet: {
        lockedIndex: number | null;
        lockedName: string | null;
        isLocked: boolean;
    };
    
    // 同步状态
    sync: {
        isRunning: boolean;
        lastSyncTime: string | null;
        startSync(): void;
    };
    
    // 日志配置
    LOG_LEVEL: number;
    LOG_LEVELS: typeof LOG_LEVELS;
    ERROR_LEVELS: typeof ERROR_LEVELS;
    ErrorLevel: typeof ErrorLevel;
    BgmError: typeof BgmError;
    
    // 预览数据
    dataPreview?: {
        ws: any;
        visibleRows: number[];
        headerRow: number;
        dataStartRow: number;
        previewColStart: number;
        previewColEnd: number;
        columnCount: number;
        headerNames: string[];
        isImportant: boolean[];
    };
    
    // 统一对话框
    Dialog: {
        alert(title, message): void;
        confirm(message, onConfirm?, onCancel?): void;
        error(title, message): void;
        input(title, prompt, defaultValue?, onOk?, onCancel?): void;
        show(type, title, message, options?): void;
    };
    
    // 消息通信
    Message: {
        send(data, targetOrigin?): boolean;
    };
    
    // 便捷方法
    showAlert(title, message): void;
    showConfirm(title, message, onConfirm?, onCancel?): void;
    handleError(error, options?): BgmError;
    safeExecute(fn, context?, options?): T | BgmError;
    
    // 用户信息
    setUserId(id: string | null): void;
    setUsername(name: string | null): void;
    notifyTokenUpdated(): void;
    
    // 同步状态
    setSyncProgress(current, total, message): void;
    setSyncComplete(results?): void;
    setSyncError(error): void;
};
```

---

## 配置文件

### package.json

**文件位置**：[package.json](file:///d:/编程/Excel加载项/BGM/BGM/package.json)

```json
{
    "name": "test",
    "addonType": "et",           // WPS Excel 加载项
    "version": "1.0.0",
    "scripts": {
        "dev": "vite --port 3889",     // 开发服务器
        "build": "vite build",         // 生产构建
        "build:ts": "tsc --project tsconfig.build.json",  // TS 编译
        "debug": "npm run build:ts && concurrently ..."   // 调试模式
    },
    "devDependencies": {
        "et-jsapi-declare": "latest",  // WPS JSAPI 类型声明
        "typescript": "^6.0.3",
        "vite": "^6.0.0",
        "vite-plugin-static-copy": "^4.1.0",
        "wpsjs": "latest"              // WPS 开发工具
    }
}
```

### manifest.xml

**文件位置**：[manifest.xml](file:///d:/编程/Excel加载项/BGM/BGM/manifest.xml)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<JsPlugin>
  <ApiVersion>1.0.0</ApiVersion>
  <Name>HelloEt</Name>
  <Description>addon Description</Description>
  <Functions>
    <Uri>/functions.json</Uri>
    <Namespace>HelloEt</Namespace>
  </Functions>
</JsPlugin>
```

---

## 项目运行方式

### 开发环境

```bash
# 安装依赖
npm install

# 开发模式（启动热重载开发服务器）
npm run dev

# 调试模式（编译 TS + 监听变化）
npm run debug
```

### 生产构建

```bash
# 构建生产版本
npm run build

# 编译 TypeScript
npm run build:ts
```

### WPS 加载项调试

1. 确保已安装 WPS Office
2. 使用 `wpsjs debug` 命令启动调试
3. 在 WPS 中打开 Excel 文件，加载插件
4. 使用 Ribbon 按钮或任务面板进行操作

---

## 数据流

### 同步流程

```
┌─────────────────┐
│  用户选择工作表  │
│  (taskpane.ts)  │
└────────┬────────┘
         ▼
┌─────────────────┐
│  表头自动检测    │
│  (constants.ts) │
└────────┬────────┘
         ▼
┌─────────────────┐
│  构建列映射      │
│  getColumnMap() │
└────────┬────────┘
         ▼
┌─────────────────┐
│  获取筛选状态    │
│ getFilterStatus │
└────────┬────────┘
         ▼
┌─────────────────┐
│  批量读取数据    │
│ readRangeValues│
└────────┬────────┘
         ▼
┌─────────────────┐
│  逐条同步到 BGM  │
│ SyncToBangumi   │
│   Async()       │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│ 成功  │ │ 失败  │
│ 绿色  │ │ 红色  │
└───┬───┘ └───┬───┘
    │         │
    └────┬────┘
         ▼
┌─────────────────┐
│  写入同步记录    │
│ addSyncRecord() │
└─────────────────┘
```

### Token 流程

```
┌─────────────────┐
│  用户输入 Token │
│  showInput()    │
└────────┬────────┘
         ▼
┌─────────────────┐
│  XOR 加密存储    │
│ storeBgToken()  │
│ (PluginStorage) │
└────────┬────────┘
         ▼
┌─────────────────┐
│  同步时加载解密  │
│  loadBgToken()  │
└────────┬────────┘
         ▼
┌─────────────────┐
│  验证 Token      │
│ verifyToken()   │
└────────┬────────┘
         ▼
┌─────────────────┐
│  提取用户信息    │
│  /v0/me API    │
└─────────────────┘
```

---

## 注意事项

1. **WPS API 兼容性**：代码使用类型守卫（如 `isWpsApp()`）兼容 WPS 的特殊 API
2. **单元格取值**：优先使用 `Value2`，失败回退到 `Value`，最后尝试 `Text`
3. **缓存策略**：使用 Map 缓存表头、行号等数据，避免重复计算
4. **请求限流**：Bangumi API 请求间隔 800ms，支持指数退避重试
5. **增量同步**：通过数据指纹（`calcFingerprint`）检测变更，避免重复同步
6. **筛选支持**：同步时自动识别筛选状态，仅处理可见行

---

## 扩展指南

### 添加新字段

1. 在 [constants.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/constants.ts) 的 `FIELD_NAME_MAP` 添加映射
2. 在 [exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts) 的 `buildJsonPayload` 中处理
3. 在 [syncRecord.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/syncRecord.ts) 的 `SYNC_RECORD_COLUMNS` 添加列

### 添加新 API

1. 在 [scraping.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/scraping.ts) 实现 API 调用
2. 从 [index.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/index.ts) 导出
3. 在 [ribbonService.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/services/ribbonService.ts) 或 [handlers.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts) 调用

### 添加新对话框

1. 在 [dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts) 的 `DIALOG_TYPES` 添加配置
2. 实现对话框创建和事件绑定
3. 导出公开函数

---

**文档版本**：1.0  
**最后更新**：2026年5月12日  
**维护团队**：BGM Development Team