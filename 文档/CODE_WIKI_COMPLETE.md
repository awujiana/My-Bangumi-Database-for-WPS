# BGM 追番标记助手 - 完整代码文档

## 项目概述

**BGM 追番标记助手** 是一款面向 WPS Office ET（Excel）的加载项插件，用于帮助用户管理番剧/动漫收藏列表，并与 Bangumi（追番网站）进行数据同步。

### 核心功能

- 📊 **Excel 数据管理**：在 WPS Excel 中管理番剧条目信息
- 🔄 **双向同步**：将 Excel 数据同步至 Bangumi，或从 Bangumi 拉取收藏
- 🔐 **Token 管理**：安全存储和验证 Bangumi API Access Token
- 🎨 **智能识别**：自动检测 Excel 表头和关键列
- 📝 **同步记录**：记录所有同步操作，支持增量同步
- 🎯 **冲突检测**：检测 Excel 与 Bangumi 之间的数据冲突
- 📋 **筛选支持**：同步时自动识别筛选状态，仅处理可见行
- 🚀 **批量读取**：优化性能，批量读取 Excel 数据

### 技术栈

| 类别 | 技术 |
|------|------|
| 开发框架 | WPS Office ET Add-in |
| 语言 | TypeScript 6.0+ |
| 构建工具 | Vite 6.0+ |
| 类型声明 | et-jsapi-declare |
| 开发调试 | wpsjs |

---

## 目录结构

```
BGM/
├── ts/                          # TypeScript 源代码
│   ├── index.ts                 # 主入口模块，统一导出所有API
│   ├── ribbon.ts                # 功能区(Ribbon)回调处理
│   ├── taskpane.ts              # 任务面板主逻辑
│   ├── core/                    # 核心模块
│   │   ├── constants.ts         # 全局常量与枚举定义
│   │   ├── crypto.ts            # Token 加密解密
│   │   └── result.ts            # 结果类型与错误类
│   ├── services/                # 服务层
│   │   └── ribbonService.ts     # Ribbon 业务逻辑服务
│   ├── sync/                    # 同步模块
│   │   ├── exceltobangumi.ts    # Excel → Bangumi 同步核心
│   │   ├── scraping.ts          # Bangumi API 数据拉取
│   │   └── syncRecord.ts        # 同步记录管理
│   ├── tools/                   # 工具模块
│   │   ├── events.ts            # 事件总线
│   │   ├── http.ts              # HTTP 请求封装
│   │   ├── util.ts              # 通用工具函数
│   │   └── wps.ts               # WPS API 类型定义
│   └── ui/                      # UI 模块
│       ├── dialog.ts            # 自定义对话框
│       ├── handlers.ts          # UI 事件处理器
│       ├── message.ts           # 消息通信
│       └── preview.ts           # 数据预览
├── ui/
│   └── taskpane.html            # 任务面板 HTML
├── css/                         # 样式文件
├── images/                      # 图标资源
├── dist-ts/                     # TypeScript 编译输出
├── manifest.xml                 # WPS 加载项清单
├── package.json                 # 项目配置
├── vite.config.js               # Vite 构建配置
├── tsconfig.json                # TypeScript 配置
└── index.html                   # 加载项入口页面
```

---

## 模块架构与依赖关系

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    index.ts (统一导出)                        │
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

### 模块依赖说明

1. **index.ts**：统一导出所有模块的公共 API，作为单一入口点
2. **core/**：核心基础设施模块，被所有其他模块依赖
3. **tools/**：通用工具模块，提供跨模块的辅助功能
4. **sync/**：业务核心模块，实现同步逻辑
5. **services/**：服务层，封装业务逻辑供 UI 调用
6. **ui/**：用户界面相关模块
7. **ribbon.ts / taskpane.ts**：入口模块，依赖所有业务模块

---

## 核心模块详解

### 1. 核心模块 (core/)

#### 1.1 constants.ts - 全局常量定义

**文件位置**：[ts/core/constants.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/constants.ts)

**职责**：存储所有全局常量、枚举、配置值和映射表。

##### 主要常量

| 常量名 | 类型 | 说明 |
|--------|------|------|
| `ErrorLevel` | `enum` | 错误级别枚举（SILENT/WARN/ERROR/THROW/DEBUG） |
| `WPS_ENUM` | `object` | WPS 枚举值（任务窗格停靠位置等） |
| `XL` | `object` | Excel 方向常量（xlUp/xlDown/xlToLeft/xlToRight 等） |
| `BGM_CONFIG` | `object` | Bangumi API 配置（API_BASE/REQUEST_DELAY/MAX_RETRIES/RETRY_DELAY_BASE） |
| `BGM_COLOR` | `object` | 单元格颜色常量（SUCCESS/FAIL/SKIP/BGM_SYNC/LIGHT_GREEN/DARK_GREEN/GRAY/WHITE） |
| `LOG_LEVELS` | `object` | 日志级别（DEBUG/INFO/WARN/ERROR） |
| `ERROR_LEVELS` | `Record<number, number>` | HTTP 状态码到错误级别的映射 |
| `PANEL_CONFIG` | `object` | 面板配置（MAX_SCAN_COLUMNS/MAX_SCAN_ROWS/PREVIEW_LIMIT/MAX_FILTER_SCAN_ROWS/FILTER_FALLBACK_LIMIT） |
| `BGM_SUBJECT_TYPES` | `Record<number, string>` | Bangumi 条目类型映射 |
| `SYNC_STATUS` | `object` | 同步状态常量（SUCCESS/FAIL/SKIP/COLLECTED/NO_UPDATE） |
| `COLUMNS` | `object` | 列索引常量（SEQUENCE/DEFAULT_START/NAME/URL/STATUS） |
| `HEADER_KEYWORDS` | `string[]` | 表头识别关键词列表 |
| `IMPORTANT_COLS` | `Record<string, boolean>` | 重要列标记 |
| `FIELD_NAME_MAP` | `Record<string, string>` | 字段名标准化映射 |
| `URL_PATTERNS` | `RegExp[]` | Bangumi URL 匹配模式 |
| `TOKEN_CONFIG` | `object` | Token 加密配置（VERSION/XOR_KEY） |
| `WATCH_STATUS_MAP` | `Record<string, number>` | 观看状态文本到数值的映射 |
| `SYNC_RECORD_SHEET_NAME` | `string` | 同步记录工作表名称 |
| `SYNC_RECORD_COLUMNS` | `string[]` | 同步记录列配置 |

##### WATCH_STATUS_MAP 观看状态映射

```typescript
{
    // 看过/已完成 (3)
    "看过": 3, "看完": 3, "已看": 3, "完": 3, "completed": 3, "3": 3, "是": 3, "true": 3,
    // 在看/进行中 (2)
    "在看": 2, "看动画": 2, "在看动画": 2, "在追": 2, "追": 2, "watching": 2, "2": 2,
    // 想看/计划看 (0)
    "想看": 0, "想看动画": 0, "否": 0, "wish": 0, "1": 0, "false": 0,
    // 搁置 (4)
    "搁置": 4, "暂停": 4, "停": 4, "on_hold": 4, "4": 4,
    // 抛弃/放弃 (5)
    "抛弃": 5, "弃": 5, "弃番": 5, "drop": 5, "dropped": 5, "5": 5
}
```

##### BGM_CONFIG API 配置

```typescript
{
    API_BASE: "https://api.bgm.tv",
    REQUEST_DELAY: 800,           // 请求间隔 800ms，防止限流
    MAX_RETRIES: 3,               // 最大重试次数 3 次
    RETRY_DELAY_BASE: 2000        // 指数退避基准延迟 2000ms
}
```

---

#### 1.2 result.ts - 结果类型与错误处理

**文件位置**：[ts/core/result.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/result.ts)

##### BgmError 类

继承自 Error 的业务错误类：

```typescript
class BgmError extends Error {
    code: string;                    // 错误码（TOKEN_INVALID/NETWORK_ERROR 等）
    details: Record<string, any>;    // 错误详情对象
    timestamp: string;               // 错误发生时间的 ISO 格式字符串
    
    constructor(message: string, code: string = 'UNKNOWN', details: Record<string, any> = {});
    toString(): string;              // 格式：[错误码] 消息
}
```

##### Result<T> 泛型类

用于包装操作结果（成功/失败），避免使用 try-catch 处理可预期的失败：

```typescript
class Result<T> {
    readonly success: boolean;
    readonly data: T | null;
    readonly error: BgmError | null;
    
    // 静态工厂方法
    static ok<T>(data: T): Result<T>;                    // 创建成功结果
    static fail<T>(error: BgmError): Result<T>;          // 创建失败结果
    static fromCode<T>(code: number, data?: T | null): Result<T>;  // 根据 HTTP 状态码创建
    
    // 实例方法
    isOk(): boolean;                   // 判断是否成功
    isFail(): boolean;                 // 判断是否失败
    unwrap(): T;                       // 获取数据，失败时抛出异常
    unwrapOr(defaultValue: T): T;      // 获取数据或默认值
    map<U>(fn: (data: T) => U): Result<U>;  // 转换成功数据
    mapErr(fn: (error: BgmError) => BgmError): Result<T>;  // 转换错误
}
```

##### BatchSyncResult 接口

```typescript
interface BatchSyncResult {
    success: number;    // 成功同步的数量
    fail: number;       // 同步失败的数量
    skip: number;       // 跳过的数量（如数据无效或无需更新）
}
```

---

#### 1.3 crypto.ts - Token 加密解密

**文件位置**：[ts/core/crypto.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/crypto.ts)

**主要函数**：

| 函数 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `calcChecksum(str: string)` | 原始字符串 | `number` | 计算字符串的校验和（0-255），用于数据完整性验证 |
| `extractToken(encrypted: string)` | 解密后的字符串 | `string \| null` | 从 Payload 中提取 Token，同时验证版本和校验和 |
| `encryptToken(token: string)` | 明文 Token | `string` | XOR 加密 Token，返回格式：`{VERSION}.{IV_BASE64}.{ENCRYPTED_BASE64}` |
| `decryptToken(encrypted: string)` | 加密字符串 | `string \| null` | XOR 解密 Token，失败返回 null |
| `encryptTokenAsync(token: string)` | 明文 Token | `Promise<string>` | AES-GCM 异步加密（更安全） |
| `decryptTokenAsync(encrypted: string)` | 加密字符串 | `Promise<string \| null>` | AES-GCM 异步解密 |

##### Token Payload 格式

```
{VERSION}:{CHECKSUM}:{TOKEN}
例如：1:123:my-secret-token-12345
```

---

### 2. 工具模块 (tools/)

#### 2.1 util.ts - 通用工具函数

**文件位置**：[ts/tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)

##### BGM 全局命名空间

BGM 是项目的核心全局对象，提供统一的状态管理和工具方法：

```typescript
const BGM = {
    // 缓存数据
    cache: {
        totalRows: number;
        userId: string | null;
        username: string | null;
        sidCache: Map<string, string>;
        listCache: unknown[];
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
        startSync(): void;  // 启动同步流程
    };
    
    // 日志级别
    LOG_LEVEL: number;
    LOG_LEVELS: typeof LOG_LEVELS;
    ERROR_LEVELS: typeof ERROR_LEVELS;
    ErrorLevel: typeof ErrorLevel;
    BgmError: typeof BgmError;
    
    // 数据预览（由 taskpane.ts 设置）
    dataPreview?: {
        ws: WpsWorksheet | null | undefined;
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
        alert(title: string, message: string): void;
        confirm(message: string, callback: (confirmed: boolean) => void, title?: string): void;
        error(title: string, message: string): void;
        input(title: string, prompt: string, defaultValue?: string, onOk?: (value: string) => void, onCancel?: () => void): void;
        show(type: 'alert' | 'confirm' | 'error' | 'input', title: string, message: string, options?: DialogOptions): void;
    };
    
    // 消息通信
    Message: {
        send(data: Record<string, unknown>, targetOrigin?: string): boolean;
    };
    
    // 便捷方法
    showAlert(title: string, message: string): void;
    showConfirm(title: string, message: string, onConfirm?: () => void, onCancel?: () => void): void;
    handleError(error: unknown, options?: ErrorOptions): BgmError;
    safeExecute<T>(fn: () => T, context?: string, options?: ErrorOptions): T | BgmError;
    
    // 用户信息管理
    setUserId(id: string | null): void;
    setUsername(name: string | null): void;
    notifyTokenUpdated(): void;
    
    // 同步状态通知
    setSyncProgress(current: number, total: number, message: string): void;
    setSyncComplete(results?: { success: number; fail: number; skip: number }): void;
    setSyncError(error: unknown): void;
};
```

##### Application 获取

```typescript
function getApp(): WpsApplication | null;
// 获取 WPS Application 对象，使用类型守卫验证
```

##### 单元格操作

```typescript
function colNumToLetter(col: number): string;
// 列号转字母：A, B, ..., Z, AA, AB, ...

function getCell(ws: WpsWorksheet | null | undefined, row: number, col: number): WpsRange | null;
// 获取单元格对象

function getCellValue(ws: WpsWorksheet | null | undefined, row: number, col: number): string;
// 获取单元格值（字符串形式），兼容 WPS 的特殊 API，优先 Value2，回退 Value，最后 Text

function readCell(ws: WpsWorksheet | null | undefined, row: number, col: number): string;
// 读取单元格文本（统一接口）

function setCellValue(ws: WpsWorksheet | null | undefined, row: number, col: number, value: unknown): boolean;
// 设置单元格值

function readRangeValues(ws: any, startRow: number, endRow: number, startCol: number, endCol: number): string[][];
// 批量读取范围值，返回二维数组 [行][列]，用于优化性能
```

##### 表头与列操作

```typescript
function findHeaderRow(ws: any, startRow?: number): number;
// 查找表头行（根据 HEADER_KEYWORDS 匹配），支持缓存

function getColumnMap(ws: any, headerRow: number): Map<string, number>;
// 获取列名到列号的映射，使用 COLUMN_RULES 正则匹配

function getLastRow(ws: WpsWorksheet | null | undefined, forceRefresh: boolean = false, headerRow?: number): number;
// 获取最后数据行，支持多种策略：
// 1. 如果提供 headerRow，自动检测锚定列并定位
// 2. 优先使用 D 列（常见序号列）
// 3. 回退到 A 列
// 4. 最后使用 UsedRange
// 支持缓存，forceRefresh=true 时强制刷新

function clearSheetCache(ws: any): void;
// 清除指定工作表的所有缓存

function cacheGet<T>(key: string, factory: () => T): T;
// 获取或设置缓存，通用缓存工具
```

##### Token 管理

```typescript
function storeBgToken(token: string): boolean;
// 加密存储 Token 到 PluginStorage

function loadBgToken(): string | null;
// 解密加载 Token，失败返回 null

function clearBgToken(): boolean;
// 清除 Token
```

##### 用户信息管理

```typescript
function _setBgmUserId(id: string): void;
// 设置 Bangumi 用户 ID（存储到全局缓存）

function _getBgmUserId(): string | null;
// 获取 Bangumi 用户 ID

function _getUserApiPath(): string;
// 获取用户 API 路径（格式：/-/{userId}），用于拼接用户收藏请求 URL

function _fetchBgmUserInfo(callback?: (userInfo: BGMUserInfo | null) => void): void;
// 异步获取 Bangumi 当前登录用户信息

function fetchBgmUserInfo(): Promise<BGMUserInfo | null>;
// Promise 版本的获取用户信息
```

##### 面板与同步辅助

```typescript
function showBangumiPanel(): void;
// 显示或隐藏同步任务面板

function getDataSheet(): WpsWorksheet | null | undefined;
// 获取当前数据工作表（优先使用锁定的工作表）

function calcFingerprint(fields: string[]): string;
// 计算 Excel 行数据的指纹，用于增量同步比较

function trim(str: string | null | undefined): string;
// 安全的字符串去除首尾空格

function sleep(ms: number): void;
// 同步延迟（使用 WPS 的 Wait API 或自旋+DoEvents）

function delay(ms: number): Promise<void>;
// 异步延迟

function escapeHtml(text: string | null | undefined): string;
// HTML 转义，防止 XSS

function getSheetByIndex(sheetIndex: number): unknown;
// 根据索引获取工作表

function shellExecuteByOAAssist(param: string): void;
// 通过 WPS 提供的 OAAssist 执行外部程序

function GetUrlPath(): string;
// 获取插件基础 URL 路径

function isEmptyValue(val: any): boolean;
// 判断值是否为空（null/undefined/''/'null'/'NULL'/'Null'/'undefined'）

function safeActivate(ws: WpsWorksheet | null | undefined): void;
// 安全激活工作表
```

##### 日志函数

```typescript
function bgmLog(level: number, message: string | null | undefined): void;
// 日志函数，支持日志级别控制
// level 取值：LOG_LEVELS.DEBUG(0)/INFO(1)/WARN(2)/ERROR(3)
```

---

#### 2.2 events.ts - 事件总线

**文件位置**：[ts/tools/events.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/events.ts)

##### EventBus 类

实现发布-订阅模式，支持多个订阅者订阅同一事件：

```typescript
class EventBus {
    on(event: string, handler: EventHandler): () => void;
    // 订阅事件，返回退订函数
    
    off(event: string, handler: EventHandler): void;
    // 退订事件
    
    emit(event: string, data?: any): void;
    // 发布事件，执行时会复制一份订阅者列表防止影响
    
    once(event: string, handler: EventHandler): () => void;
    // 单次订阅，事件触发后自动退订
    
    clear(): void;
    // 清除所有事件订阅
    
    clearEvent(event: string): void;
    // 清除特定事件的所有订阅
    
    listenerCount(event: string): number;
    // 获取事件订阅数量
}
```

##### 预定义事件常量

```typescript
// 旧版事件常量
const EVENTS = {
    SYNC_START: 'sync:start',
    SYNC_PROGRESS: 'sync:progress',
    SYNC_COMPLETE: 'sync:complete',
    SYNC_ERROR: 'sync:error',
    TOKEN_UPDATED: 'token:updated',
    USERID_UPDATED: 'userid:updated',
    PANEL_READY: 'panel:ready'
};

// 新版事件常量（BGM 命名空间使用）
const BGM_EVENTS = {
    TOKEN_UPDATED: 'state:tokenUpdated',
    USER_ID_UPDATED: 'state:userIdUpdated',
    USER_NAME_UPDATED: 'state:userNameUpdated',
    SYNC_PROGRESS: 'sync:progress',
    SYNC_COMPLETED: 'sync:completed',
    SYNC_ERROR: 'sync:error',
    SHEET_LOCKED: 'sheet:locked',
    SHEET_UNLOCKED: 'sheet:unlocked'
};
```

##### 使用示例

```typescript
// 订阅事件
const unsubscribe = eventBus.on('sync:complete', (data) => {
    console.log('同步完成:', data);
});

// 发布事件
eventBus.emit('sync:progress', { current: 5, total: 10 });

// 单次订阅
eventBus.once('app:ready', () => {
    console.log('应用已就绪');
});

// 退订
unsubscribe();
```

---

#### 2.3 http.ts - HTTP 请求封装

**文件位置**：[ts/tools/http.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/http.ts)

##### 类型定义

```typescript
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
type SyncProgressCallback = (current: number, total: number, message: string) => void;
```

##### 主要函数

```typescript
async function httpRequest<T = unknown>(
    endpoint: string,
    options: {
        method?: HttpMethod;
        body?: string | null;
        token?: string;
        timeout?: number;
        retries?: number;
        onProgress?: (current: number, total: number) => void;
    } = {}
): Promise<Result<{ status: number; data: T | null }>>;
// 异步发送 HTTP 请求，支持：
// - 自动重试（指数退避，默认 3 次）
// - 限流（429）自动处理
// - 进度回调
// - Token 自动添加 Authorization 头
// - 自动 JSON 解析
// 返回 Result 包装的响应
```

##### 便捷方法

```typescript
const httpGet = <T = unknown>(endpoint: string, token?: string) =>
    httpRequest<T>(endpoint, { method: 'GET', token });

const httpPost = <T = unknown>(endpoint: string, body: string, token?: string) =>
    httpRequest<T>(endpoint, { method: 'POST', body, token });

const httpPut = <T = unknown>(endpoint: string, body: string, token?: string) =>
    httpRequest<T>(endpoint, { method: 'PUT', body, token });

const httpDelete = <T = unknown>(endpoint: string, token?: string) =>
    httpRequest<T>(endpoint, { method: 'DELETE', token });
```

---

#### 2.4 wps.ts - WPS API 类型定义

**文件位置**：[ts/tools/wps.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/wps.ts)

##### 主要接口

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
    MessageBox?(text: string, type: number, icon?: number): number;
    InputBox?(prompt: string, title: string, default?: string, type?: number): string | false;
}

interface WpsWorkbook {
    Worksheets: WpsWorksheets;
    ActiveSheet: WpsWorksheet;
    Sheets: WpsSheets;
}

interface WpsWorksheets {
    Count: number;
    Item(index: number): WpsWorksheet;
}

interface WpsWorksheet {
    Name: string;
    Range(addr: string): WpsRange;
    Cells(row: number, col: number): WpsRange;
    AutoFilter: WpsAutoFilter;
    AutoFilterMode: boolean;
    UsedRange: WpsRange;
    Rows: WpsRows;
    Columns: WpsColumns;
    Activate(): void;
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

interface WpsInterior {
    Color: number;
    ColorIndex: number;
}

interface WpsPluginStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
```

##### 类型守卫

```typescript
function isWpsApp(obj: any): boolean;
function isWpsWorksheet(obj: any): boolean;
function isWpsRange(obj: any): boolean;

function wpsMsgBox(text: string, type: number, icon?: number): number | void;
// WPS 消息框封装
```

---

### 3. 同步模块 (sync/)

#### 3.1 exceltobangumi.ts - 同步核心

**文件位置**：[ts/sync/exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts)

##### URL 与 ID 处理

```typescript
function extractSubjectId(input: string): string;
// 从 URL 或文本提取 Bangumi Subject ID
// 支持格式：
// - https://bgm.tv/subject/123
// - https://bangumi.tv/subject/123
// - https://chii.in/subject/123
// - 直接数字 123
```

##### 状态转换

```typescript
function mapWatchStatus(status: string): number;
// 观看状态文本 → Bangumi API 数值
// 返回：0=想看, 2=在看, 3=看过, 4=搁置, 5=抛弃
// 支持模糊匹配、布尔值转换、数字字符串转换
```

##### 标签处理

```typescript
function addTagsFromStr(tagSet: Set<string>, raw: string): void;
// 从字符串解析标签（支持 , | ; 等分隔符）

function buildTagsArray(tagsRaw: string): string[];
// 构建标签数组
```

##### 筛选状态检测

```typescript
function getFilterStatus(
    lastRow?: number,
    headerRow?: number
): {
    hasFilter: boolean;
    visibleRows: number[];  // 可见行列表
    hiddenRows: number[];   // 隐藏行列表
};
// 检测工作表筛选状态，返回可见行
// 使用 SpecialCells 方法获取可见单元格，解析行号
```

##### 同步 Payload 构建

```typescript
function buildJsonPayload(
    ws: any,
    rowNum: number,
    colMap: Map<string, number>,
    finishedDate: string
): string;
// 构建 Bangumi API 请求体 JSON
// 处理字段：
// - 是否看完 → type
// - 打分 → rate
// - 标签/分级 → tags
// - 剧透/感言 或 感言 → comment
// - 集数 或 集号 → ep
// - 私密收藏 → private (仅当明确标记时)
```

##### API 请求发送

```typescript
function bgmRequestSync(
    method: string,
    endpoint: string,
    jsonBody: string,
    token: string
): { code: number; message: string };
// 发送 Bangumi 同步请求（同步版本）
// 使用 XMLHttpRequest，支持 Authorization Bearer Token
```

##### 主同步函数（核心）

```typescript
async function SyncToBangumiAsync(
    ws: any,
    colMap: Map<string, number>,
    token: string,
    lastRow: number,
    headerRow: number,
    options?: {
        onProgress?: (current: number, total: number, message: string) => void;
        onItemComplete?: (row: number, success: boolean, result: { code: number; message: string }) => void;
        skipSids?: Set<string>;     // 冲突的 SID 集合，用于跳过
        incremental?: boolean;      // 增量同步开关
    }
): Promise<{ success: number; fail: number; skip: number }>;

// 主要同步流程：
// 1. 获取筛选状态（如果是筛选状态则只处理可见行）
// 2. 批量读取单元格数据（性能优化）
// 3. 增量同步指纹检查（如果启用）
// 4. 遍历每一行数据：
//    - 提取 Subject ID
//    - 跳过已上传（D列颜色标记）
//    - 构建 JSON Payload
//    - 动态请求间隔（避免限流）
//    - 调用 Bangumi API
//    - 标记同步结果颜色（D列）
//    - 记录同步历史
// 5. 返回统计结果
```

##### 颜色标记管理

```typescript
function clearRowColors(): void;
// 清除当前活动工作表的 D 列颜色标记

function clearSheetMarksInSheet(sheetIndex: number): void;
// 清除指定工作表的颜色标记
```

##### 其他工具函数

```typescript
function openBangumiTokenPage(): void;
// 打开 Bangumi Token 申请页面

function testTokenValidityForRibbon(token?: string): void;
// 测试 Token 有效性（Ribbon 版本）

function openUserCollection(): void;
// 打开用户收藏页面

function testSingleUpdate(): void;
// 测试单个条目更新（当前选中行）

function setBangumiToken(token: string): boolean;
// 设置 Bangumi Token 并保存

function getSequentialRowsBySeqCol(startRow: number, endRow: number): {
    validRows: number[];
    seqMap: Map<string, number>;
};
// 根据 D 列序列号获取连续的有效行（旧版本功能）
```

---

#### 3.2 scraping.ts - 数据拉取

**文件位置**：[ts/sync/scraping.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/scraping.ts)

##### 主要类型

```typescript
interface BangumiUserData {
    id?: string | number;
    user_id?: string | number;
    username?: string;
    user_name?: string;
    name?: string;
}

interface TokenVerifyResult {
    valid: boolean;
    message: string;
    userId?: string;
    username?: string;
}

interface ApiResponse<T = any> {
    status: number;
    data: T | null;
    message: string;
}
```

##### 主要函数

```typescript
async function verifyToken(token: string): Promise<TokenVerifyResult>;
// 验证 Bangumi API Token，调用 /v0/me 接口

async function fetchAllUserCollections(
    token: string,
    userId?: string,
    options?: {
        limit?: number;               // 每页数量，默认 30
        maxTotal?: number;            // 最大获取数，默认 1000
        onProgress?: (page: number, total: number) => void;
    }
): Promise<any[]>;
// 获取用户全部收藏（自动分页）

async function fetchSubjectCollection(
    token: string,
    subjectId: string
): Promise<ApiResponse>;
// 获取单个条目的收藏状态
```

---

#### 3.3 syncRecord.ts - 同步记录管理

**文件位置**：[ts/sync/syncRecord.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/syncRecord.ts)

##### 主要类型

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

interface UpdateRecordParams {
    name?: string;
    url?: string;
    sid?: string;
    type?: string;
    content?: string;
    status?: string;
    message?: string;
    fingerprint?: string;
}
```

##### 主要函数

```typescript
function getOrCreateSyncRecordSheet(): any;
// 获取或创建「同步记录」工作表
// 如果不存在，创建并添加表头

function getAllSyncRecords(): SyncRecord[];
// 获取所有同步记录（带缓存）

function addSyncRecord(params: UpdateRecordParams): boolean;
// 添加同步记录
// 同一 SID 会更新次数，并保留最新状态

function clearSyncRecords(): boolean;
// 清除所有同步记录

function openSyncRecordSheet(): void;
// 打开同步记录工作表

function clearSheetMarksInSheet(sheetIndex: number): void;
// 清除指定工作表的 D 列颜色标记
```

---

### 4. 服务模块 (services/)

#### 4.1 ribbonService.ts - Ribbon 业务逻辑服务

**文件位置**：[ts/services/ribbonService.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/services/ribbonService.ts)

##### 同步预览统计

```typescript
function getSyncPreview(
    ws: any,
    colMap: Map<string, number>,
    lastRow: number,
    headerRow: number
): { total: number; valid: number; willSync: number; willSkip: number; alreadyUploaded: number };
// 获取同步预览统计（不发送请求，仅扫描 Excel）
// - 批量读取数据（性能优化）
// - 检查可见行
// - 统计有效/无效/已上传/待同步/跳过条目
```

##### 冲突检测

```typescript
async function detectConflicts(
    ws: any,
    colMap: Map<string, number>,
    lastRow: number,
    headerRow: number,
    token: string
): Promise<{
    conflicts: Array<{ row: number; sid: string; name: string; existingType?: number; newType: number }>;
    conflictCount: number;
    bgmCollectionReady: boolean;
}>;
// 异步检测 Excel 与 Bangumi 收藏之间的冲突
// 1. 获取 Bangumi 收藏快照
// 2. 遍历 Excel 可见行，比对 type 字段差异
// 3. 返回冲突条目列表及统计
```

##### 完整同步流程

```typescript
async function syncWithConfirmation(): Promise<void>;
// Ribbon 专用的完整同步流程：
// 1. 获取数据工作表和 Token
// 2. 检测表头和列映射
// 3. 同步预览统计
// 4. 读取 Ribbon 复选框状态（冲突策略 + 增量同步）
// 5. 冲突检测
// 6. 确认弹窗
// 7. 执行同步（传入跳过冲突集合和增量同步开关）
// 8. 显示结果
```

##### 其他 Ribbon 服务函数

```typescript
async function setTokenForRibbon(): Promise<boolean>;
// 设置 Token（Ribbon 版本，使用 InputBox）

function testTokenForRibbon(): void;
// 测试 Token（Ribbon 版本）

function setUserIdForRibbon(): void;
// 设置用户 ID（Ribbon 版本）

function openCollectionForRibbon(): void;
// 打开收藏页面（Ribbon 版本）

function clearColorsForRibbon(): void;
// 清除颜色标记（Ribbon 版本）
```

---

### 5. UI 模块 (ui/)

#### 5.1 dialog.ts - 对话框组件

**文件位置**：[ts/ui/dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts)

##### 公开 API

```typescript
function showAlert(message: string, title?: string, onOk?: () => void): void;
// 显示警告对话框

function showConfirm(message: string, callback: (confirmed: boolean) => void, title?: string): void;
// 显示确认对话框

function showError(message: string, title?: string, onOk?: () => void): void;
// 显示错误对话框

function showSuccess(message: string, title?: string, onOk?: () => void): void;
// 显示成功对话框

function showInput(title: string, prompt: string, defaultValue?: string, onOk?: (value: string) => void, onCancel?: () => void): void;
// 显示输入对话框

function showToast(message: string, type?: string): void;
// 显示 Toast 通知（type: 'info'/'success'/'warn'/'error'）
```

---

#### 5.2 handlers.ts - UI 事件处理器

**文件位置**：[ts/ui/handlers.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts)

##### 主要处理器

```typescript
function showUserIdDialog(): void;
// 显示用户 ID 设置对话框

function showTokenDialog(): void;
// 显示 Token 设置对话框

function markUploadedItems(): void;
// 标记已上传条目

function clearSheetMarks(): void;
// 清除所有颜色标记

function updateTokenStatus(): void;
// 更新 Token 状态显示

function updateUserIdStatus(): void;
// 更新用户 ID 状态显示

function testDebugConnection(): void;
// 测试调试连接

async function syncCollectionFromBgm(): Promise<void>;
// 从 Bangumi 同步收藏到 Excel
```

---

#### 5.3 message.ts - 消息通信

**文件位置**：[ts/ui/message.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/message.ts)

```typescript
function initMessageListener(): void;
// 初始化消息监听（用于与其他任务窗格通信）

function setStatus(message: string): void;
// 设置状态栏消息

function setSyncRunning(isRunning: boolean): void;
// 设置同步运行状态
```

---

#### 5.4 preview.ts - 数据预览

**文件位置**：[ts/ui/preview.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts)

##### 主要类型

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
```

##### 主要函数

```typescript
function previewSyncContent(): void;
// 显示同步预览内容

function closeDetailModal(): void;
// 关闭详情模态框

async function syncAllRows(): Promise<void>;
// 同步所有行
```

---

### 6. 主模块

#### 6.1 index.ts - 统一导出入口

**文件位置**：[ts/index.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/index.ts)

该模块作为单一入口，统一导出所有其他模块的公共 API。其他模块只需从 `./index.js` 导入即可获取全部功能，降低模块间耦合。

##### 导出内容分类

1. **Core 模块**：constants、crypto、result
2. **Tools 模块**：events、http、util、wps
3. **Sync 模块**：exceltobangumi、scraping、syncRecord
4. **UI 模块**：dialog、handlers、message、preview
5. **Services 模块**：ribbonService
6. **主模块**：taskpane、ribbon

##### 额外导出的接口

```typescript
interface BGMCache {
    totalRows: number;
    userId: string | null;
    username: string | null;
    sidCache: Map<string, string>;
    listCache: unknown[];
}

interface BGMSheet {
    lockedIndex: number | null;
    lockedName: string | null;
    isLocked: boolean;
}

interface BGMSync {
    isRunning: boolean;
    lastSyncTime: string | null;
    startSync(): void;
}

interface BGMUserInfo {
    id: string;
    username: string;
}
```

---

#### 6.2 ribbon.ts - 功能区回调处理

**文件位置**：[ts/ribbon.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ribbon.ts)

##### Ribbon 回调函数

| 函数 | 说明 |
|------|------|
| `OnAddinLoad(ribbonUI: any): boolean` | 加载项初始化，保存 ribbonUI 引用 |
| `OnAction(control: { Id: string }): boolean` | 按钮点击处理，分发到具体功能 |
| `GetBangumiImage(control: { Id: string }): string` | 获取按钮图标 |
| `GetSkipConflictsPressed(control: any): boolean` | 获取「跳过冲突」复选框状态 |
| `OnSkipConflictsChange(control: any): void` | 「跳过冲突」状态变更 |
| `GetIncrementalSyncPressed(control: any): boolean` | 获取「增量同步」复选框状态 |
| `OnIncrementalSyncChange(control: any): void` | 「增量同步」状态变更 |

##### 按钮 ID 映射

| ID | 功能 |
|----|------|
| `btnShowPanel` | 显示/隐藏同步面板 |
| `btnSyncBangumi` | 开始同步到 Bangumi |
| `btnSetToken` | 设置 Token |
| `btnTestToken` | 测试 Token 有效性 |
| `btnSetUserId` | 设置用户 ID |
| `btnOpenCollection` | 打开 Bangumi 收藏页面 |
| `btnClearColors` | 清除 D 列颜色标记 |

##### 初始化

在模块加载完成时，会调用 `(window as any)._bgmRibbonReady?.(OnAddinLoad, OnAction, GetBangumiImage)` 通知 index.html 的早期占位代码，替换为真实实现。

---

#### 6.3 taskpane.ts - 任务面板主逻辑

**文件位置**：[ts/taskpane.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/taskpane.ts)

##### 类型定义

```typescript
interface LockedSheetInfo {
    index: number;
    name: string;
}

interface CandidateHeader {
    row: number;
    matchCount: number;
    colCount: number;
}

interface HeaderMeta {
    headerRow: number;
    headerNames: string[];
    isImportant: boolean[];
    dataStartRow: number;
    lastCol: number;
    firstDataCol: number;
    previewColStart: number;
    previewColEnd: number;
    previewColStartAbsolute: number;
    headerMatchCount: number;
}

interface FilterState {
    isFiltered: boolean;
    visibleRowSet: Set<number> | null;
}

interface PreviewRow {
    row: number;
    cols: string[] | { text: string; important: boolean }[];
    isHeader: boolean;
    aligned: boolean;
    isImportant?: boolean[];
}
```

##### 工作表管理

```typescript
function refreshSheets(): void;
// 刷新工作表列表

function toggleSheetLock(): void;
// 切换工作表锁定状态

function saveLockedSheet(info: LockedSheetInfo | null): void;
// 保存锁定状态到 PluginStorage

function restoreLockedSheet(): boolean;
// 恢复锁定状态

function updateLockButton(): void;
// 更新锁定按钮显示
```

##### 表头检测

```typescript
function detectHeaderAndColumns(
    ws: WpsWorksheet | null | undefined,
    opts: { visibleRowSet?: Set<number> | null; isFiltered?: boolean } = {}
): HeaderMeta;
// 检测表头行和数据范围
// 流程：
// 1. 扫描前 MAX_SCAN_ROWS 行，找出匹配 HEADER_KEYWORDS 的候选表头
// 2. 选择列数最多、行号最小的作为表头
// 3. 读取表头名称
// 4. 检测多行表头（下一行填充当前表头的空列）
// 5. 计算实际使用的列范围
// 6. 确定预览显示的列范围

function autoDetectSheet(): {
    sheetIndex: number;
    sheetName: string;
    headerRow: number;
    matchCount: number;
    colCount: number;
} | null;
// 自动检测最佳数据工作表
// 遍历所有工作表，找出匹配度最高的
// 跳过系统表（同步记录、模糊、搜索等）
```

##### 筛选状态

```typescript
function updateFilterStatus(targetWs?: WpsWorksheet): void;
// 更新筛选状态显示（任务面板上的提示）
```

##### 数据预览

```typescript
function refreshData(): void;
// 刷新数据预览表格
// 流程：
// 1. 获取工作表
// 2. 清除该工作表缓存
// 3. 检测筛选状态
// 4. 检测表头
// 5. 保存数据预览到 BGM.dataPreview
// 6. 生成预览行数据
// 7. 渲染 HTML

function renderPreviewTable(rows: PreviewRow[], sheetIndex: number, sheetName: string, headerRow: number): string;
// 渲染预览表格 HTML
```

##### 初始化

```typescript
function initPanel(): void;
// 初始化面板：
// 1. 设置 WPS 枚举
// 2. 初始化消息监听
// 3. 恢复锁定工作表
// 4. 自动检测最佳工作表
// 5. 刷新数据预览
// 6. 更新 Token 和用户 ID 状态
// 7. 绑定事件监听器

function safeInitPanel(): void;
// 安全初始化，捕获异常
```

##### 激活工作表辅助

```typescript
function activateSheetIfNeeded(ws: WpsWorksheet): (() => void) | false;
// 如果需要，激活工作表
// 返回一个恢复函数，用于恢复原来的活动工作表
```

---

## 配置文件详解

### package.json

**文件位置**：[package.json](file:///d:/编程/Excel加载项/BGM/BGM/package.json)

```json
{
    "name": "test",
    "addonType": "et",           // WPS Excel 加载项
    "version": "1.0.0",
    "description": "WPS Excel 加载项 - 追番标记助手",
    "scripts": {
        "dev": "vite --port 3889",           // 开发服务器
        "build": "vite build",               // 生产构建
        "build:ts": "tsc --project tsconfig.build.json",  // TypeScript 编译
        "debug": "npm run build:ts && concurrently \"tsc --project tsconfig.build.json --watch\" \"wpsjs debug\"",
        "lint": "eslint . --ext .vue,.js,.jsx,.cjs,.mjs --fix --ignore-path .gitignore",
        "format": "prettier --write src/"
    },
    "devDependencies": {
        "concurrently": "^9.2.1",
        "et-jsapi-declare": "latest",         // WPS JSAPI 类型声明
        "typescript": "^6.0.3",
        "vite": "^6.0.0",
        "vite-plugin-static-copy": "^4.1.0",
        "wpsjs": "latest"                      // WPS 开发工具
    }
}
```

---

### tsconfig.json

**文件位置**：[tsconfig.json](file:///d:/编程/Excel加载项/BGM/BGM/tsconfig.json)

```json
{
    "compilerOptions": {
        "target": "ES2022",                         // 编译目标
        "module": "ESNext",                         // 使用 ES Module
        "moduleResolution": "bundler",              // 使用 bundler 模式
        "lib": ["ES2022", "DOM", "DOM.Iterable"],   // 包含的库
        "strict": true,                              // 严格模式
        "noImplicitAny": true,
        "strictNullChecks": true,
        "strictFunctionTypes": true,
        "noUnusedLocals": false,
        "noUnusedParameters": false,
        "noImplicitReturns": true,
        "noFallthroughCasesInSwitch": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "declaration": false,
        "declarationMap": false,
        "sourceMap": true,
        "outDir": "./dist-ts",
        "rootDir": "ts/",
        "baseUrl": ".",
        "resolveJsonModule": true,
        "isolatedModules": true,
        "allowSyntheticDefaultImports": true,
        "allowJs": false,
        "typeRoots": [
            "./node_modules/@types",
            "./dist-ts/ts"
        ],
        "types": [],
        "ignoreDeprecations": "6.0"
    },
    "include": ["ts/"],
    "exclude": [
        "node_modules",
        "dist",
        "dist-ts",
        "**/*.spec.ts"
    ]
}
```

---

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

### index.html - 加载项入口

**文件位置**：[index.html](file:///d:/编程/Excel加载项/BGM/BGM/index.html)

此页面是 WPS 加载项的入口页面，主要功能：

1. 引入 main.js
2. 提供 Ribbon 回调的早期占位代码（因为 WPS 会在模块加载前调用这些函数）
3. 处理 Ribbon 函数就绪后的真实实现替换
4. 提供 Ribbon 函数超时检测（15秒）
5. 调试通知功能

**早期占位流程**：

```
WPS 启动 → 调用 OnAddinLoad/OnAction/GetBangumiImage → 暂存 ribbonUI 和 actions
→ main.js 加载 → ribbon.ts 调用 _bgmRibbonReady
→ 替换为真实实现 → 重放暂存的 actions
```

---

## 项目运行方式

### 开发环境

```bash
# 安装依赖
npm install

# 开发服务器（热重载）
npm run dev

# 调试模式（编译 TypeScript + 监听变化 + wpsjs）
npm run debug
```

### 生产构建

```bash
# 构建生产版本
npm run build

# 仅编译 TypeScript
npm run build:ts
```

### WPS 加载项调试

1. 确保已安装 WPS Office
2. 使用 `npm run debug` 启动调试
3. 在 WPS 中打开 Excel 文件
4. 在「开发工具」或「加载项」中加载插件
5. 使用 Ribbon 按钮或任务面板进行操作

---

## 核心数据流

### 同步流程详解

```
┌─────────────────────────────────────────────────────────────────┐
│                      用户点击「同步」按钮                        │
│                   (Ribbon 或 Taskpane)                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. 验证 Token 并获取用户信息                                    │
│     - loadBgToken() 解密加载 Token                              │
│     - verifyToken() 验证有效性（可选）                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. 准备工作表                                                   │
│     - getDataSheet() 获取数据工作表                             │
│     - findHeaderRow() 查找表头行                                │
│     - getLastRow() 获取最后数据行                               │
│     - getColumnMap() 构建列映射                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. 预览统计与冲突检测 (Ribbon 流程)                             │
│     - getSyncPreview() 预览统计                                 │
│     - detectConflicts() 检测冲突                                │
│     - 显示确认弹窗                                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 获取筛选状态                                                 │
│     - getFilterStatus() 检测是否启用筛选                        │
│     - 获取可见行列表                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. 批量读取数据 (性能优化)                                      │
│     - readRangeValues() 一次性读取所有需要的单元格               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. 遍历每一行进行同步                                           │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  6.1 提取 Subject ID                                       │ │
│  │      extractSubjectId() 从 URL 或文本提取                   │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  6.2 检查是否跳过                                          │ │
│  │      - 无有效 SID → skip                                   │ │
│  │      - 冲突 SID (skipSids) → skip                          │ │
│  │      - 已上传 (D列颜色) 且非增量 → skip                     │ │
│  │      - 增量模式且指纹未变化 → skip                          │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  6.3 构建请求 Payload                                      │ │
│  │      buildJsonPayload() 从 Excel 数据构建                  │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  6.4 发送 API 请求                                          │ │
│  │      - 动态请求间隔 (MIN_INTERVAL=200ms)                   │ │
│  │      - bgmRequestSync() 调用 API                          │ │
│  │      - 失败重试 (指数退避)                                  │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  6.5 标记结果                                               │ │
│  │      - 成功 → 绿色 (BGM_COLOR.SUCCESS)                     │ │
│  │      - 失败 → 红色 (BGM_COLOR.FAIL)                        │ │
│  │      - 更新同步计数 (addSyncRecord)                        │ │
│  │      - 更新进度显示                                        │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. 显示同步结果                                                 │
│     - 成功/失败/跳过数量统计                                    │
│     - 可选：打开同步记录工作表                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Token 管理流程

```
┌─────────────────────────────────────────────────────────────────┐
│                      用户输入 Token                             │
│                (showInput 或 Ribbon InputBox)                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. 加密 Token                                                  │
│     - encryptToken() XOR 加密                                  │
│     - 生成 Payload: {VERSION}:{CHECKSUM}:{TOKEN}                │
│     - 生成随机 IV                                               │
│     - 返回: {VERSION}.{IV_BASE64}.{ENCRYPTED_BASE64}            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. 保存到 PluginStorage                                        │
│     - storeBgToken() 保存                                       │
│     - key: "bgm_token"                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. 同步时加载解密                                               │
│     - loadBgToken() 从存储读取                                  │
│     - decryptToken() XOR 解密                                   │
│     - extractToken() 验证版本和校验和                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 验证 Token (可选)                                           │
│     - verifyToken() 调用 /v0/me                                 │
│     - 提取用户信息 (userId/username)                            │
│     - 保存到 BGM.cache                                          │
└─────────────────────────────────────────────────────────────────┘
```

### 增量同步流程

```
┌─────────────────────────────────────────────────────────────────┐
│              增量同步启用 (incremental = true)                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. 加载历史记录                                                │
│     - getAllSyncRecords() 获取所有历史                         │
│     - 构建 SID → fingerprint 映射                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. 计算当前行指纹                                               │
│     calcFingerprint([name, type, rate, tags, comment, ep])     │
│     计算方式: calcChecksum()                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. 比对指纹                                                    │
│     - 有历史记录 且 指纹相同 → skip                             │
│     - 无历史记录 或 指纹不同 → sync                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 同步成功后更新指纹                                          │
│     - addSyncRecord() 保存新指纹                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 最佳实践与注意事项

### 1. WPS API 兼容性

- 使用类型守卫函数（`isWpsApp()`/`isWpsWorksheet()`/`isWpsRange()`）验证对象
- 单元格取值优先顺序：`Value2` → `Value` → `Text`
- 注意 WPS COM 对象的特殊行为（某些属性可能是函数）
- 使用 `PluginStorage` 存储配置，而非 localStorage

### 2. 性能优化

- 批量读取：使用 `readRangeValues()` 而非多次 `readCell()`
- 缓存机制：使用 `cacheGet()`/`clearSheetCache()` 避免重复计算
- 懒加载：只在需要时读取数据
- 防抖：避免频繁的 UI 更新

### 3. 错误处理

- 使用 `BGM.handleError()` 统一处理错误
- 提供错误上下文（`context` 参数）
- 根据严重程度选择合适的 `ErrorLevel`
- 使用 `Result<T>` 包装可预期的失败，而非抛异常

### 4. API 限流

- 请求间隔至少 200ms（`MIN_INTERVAL`）
- 支持指数退避重试（`RETRY_DELAY_BASE` * 2^attempt）
- 429 状态码自动重试
- 最大重试次数 3 次

### 5. 数据安全

- Token 使用 XOR 加密存储（不明文保存）
- 包含校验和，防止数据篡改
- 不要在日志中输出完整 Token

### 6. 增量同步

- 使用 `calcFingerprint()` 计算数据指纹
- 指纹包含关键字段：name, type, rate, tags, comment, ep
- 只有指纹变化时才同步，减少 API 调用

### 7. 筛选支持

- 使用 `getFilterStatus()` 检测筛选状态
- 仅处理可见行
- 解析 `SpecialCells(12)` 获取可见单元格

### 8. 事件驱动

- 使用 `eventBus` 实现模块间松耦合通信
- 订阅相关事件更新 UI
- 单次订阅使用 `once()` 避免内存泄漏

---

## 扩展开发指南

### 添加新字段到同步

1. **在 constants.ts 中添加字段映射**：
   ```typescript
   // HEADER_KEYWORDS 添加关键词
   // IMPORTANT_COLS 标记是否重要（可选）
   // FIELD_NAME_MAP 添加字段名标准化映射
   // COLUMN_RULES 添加列名匹配规则
   ```

2. **在 exceltobangumi.ts 的 buildJsonPayload() 中处理**：
   ```typescript
   if (colMap.has('新字段')) {
       const value = trim(readCell(ws, rowNum, colMap.get('新字段')!));
       if (value) {
           payload.新字段 = value;
       }
   }
   ```

3. **在 syncRecord.ts 的 SYNC_RECORD_COLUMNS 中添加列**（可选）：
   ```typescript
   export const SYNC_RECORD_COLUMNS = [
       // ... 现有列
       '新字段'
   ];
   ```

4. **在 calcFingerprint() 中包含新字段**（用于增量同步）：
   ```typescript
   function calcFingerprint(fields: string[]): string {
       // fields 数组中包含新字段
   }
   ```

### 添加新的 API 接口

1. **在 scraping.ts 中实现 API 调用**：
   ```typescript
   async function fetchSomething(token: string, param: string): Promise<Result<Something>> {
       return await httpRequest<Something>('/v0/some/endpoint', {
           method: 'GET',
           token
       });
   }
   ```

2. **从 index.ts 导出**：
   ```typescript
   export { fetchSomething } from './sync/scraping.js';
   ```

3. **在 ribbonService.ts 或 handlers.ts 中调用**：
