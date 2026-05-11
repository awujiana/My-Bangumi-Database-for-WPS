# Bangumi同步助手 - 完整代码维基文档 V3

## 目录

- [项目概述](#项目概述)
- [项目架构](#项目架构)
- [核心模块详解](#核心模块详解)
- [同步模块详解](#同步模块详解)
- [服务模块详解](#服务模块详解)
- [工具模块详解](#工具模块详解)
- [UI模块详解](#ui模块详解)
- [依赖关系](#依赖关系)
- [项目运行方式](#项目运行方式)
- [关键类与函数参考](#关键类与函数参考)
- [问题与优化建议](#问题与优化建议)

---

## 项目概述

### 项目简介

Bangumi同步助手是一个面向WPS Office Excel的加载项，用于实现Excel表格数据与Bangumi（追番网站）个人收藏之间的双向同步。该工具特别适合管理大量动画、漫画、游戏等多媒体条目的收藏信息。

**核心功能特性**：

- **双向同步能力**：支持从Excel向Bangumi上传数据，也支持从Bangumi拉取收藏到Excel
- **智能表头识别**：自动扫描并识别Excel表格的表头结构，无需手动配置
- **批量处理**：支持对筛选后的可见行进行定向同步，提高效率
- **实时进度反馈**：同步过程中显示详细进度和状态信息
- **操作历史记录**：自动创建「同步记录」工作表，保留完整同步日志
- **安全凭证管理**：采用加密方式存储用户的Bangumi API访问令牌
- **颜色标记系统**：通过单元格颜色直观展示同步结果（成功/失败/跳过）
- **冲突检测**：同步前自动检测Excel与Bangumi收藏之间的状态冲突
- **同步预览**：执行同步前显示统计信息，帮助用户了解同步范围

**技术选型**：

- **开发语言**：TypeScript 6.x，采用强类型系统保障代码质量
- **构建工具**：Vite 6.x，支持快速开发和高效打包
- **目标平台**：WPS Office Excel（兼容模式支持MS Office Excel）
- **外部服务**：Bangumi API v0（RESTful API）
- **事件系统**：自定义EventBus实现模块间松耦合通信

### 项目结构

```
BGM/
├── ts/                              # TypeScript 源代码（主开发目录）
│   ├── core/                        # 核心基础设施
│   │   ├── constants.ts             # 全局常量定义
│   │   ├── crypto.ts               # Token加密解密
│   │   └── result.ts               # Result类型系统
│   ├── sync/                        # 同步业务逻辑
│   │   ├── exceltobangumi.ts       # Excel数据上传至Bangumi
│   │   ├── scraping.ts             # Bangumi数据拉取至Excel
│   │   └── syncRecord.ts           # 同步记录管理
│   ├── services/                    # 服务层
│   │   └── ribbonService.ts        # Ribbon回调服务（含冲突检测和预览）
│   ├── tools/                       # 工具函数库
│   │   ├── events.ts               # 事件总线
│   │   ├── http.ts                 # HTTP请求封装
│   │   ├── util.ts                 # 通用工具函数
│   │   └── wps.ts                 # WPS COM类型定义
│   ├── ui/                         # 用户界面组件
│   │   ├── dialog.ts              # 对话框组件
│   │   ├── handlers.ts            # 事件处理器
│   │   ├── message.ts             # 消息通信
│   │   └── preview.ts             # 数据预览
│   ├── index.ts                    # 统一导出入口
│   ├── ribbon.ts                   # 功能区(Ribbon)回调
│   └── taskpane.ts                 # 任务窗格逻辑
├── ui/                              # UI静态资源
│   └── taskpane.html               # 任务窗格HTML模板
├── css/                              # 样式表
│   ├── preview.css                 # 预览区样式
│   └── styles.css                  # 主样式
├── images/                           # 图标资源（SVG格式）
│   ├── panel.svg                   # 面板图标
│   ├── sync.svg                    # 同步图标
│   ├── token.svg                   # Token图标
│   └── ...                         # 其他功能图标
├── docs/                             # 文档目录
│   └── CODE_WIKI_V3.md             # 本文档
├── dist-ts/                          # TypeScript编译输出
├── dist/                             # Vite构建产物
├── package.json                      # NPM包配置
├── tsconfig.json                     # TypeScript编译配置
├── vite.config.js                    # Vite构建配置
├── manifest.xml                      # WPS加载项清单
└── ribbon.xml                       # 功能区按钮配置
```

---

## 项目架构

### 分层架构设计

项目采用分层架构模式，自上而下分为五个主要层次：

```
┌─────────────────────────────────────────────────────────────────┐
│                        WPS Excel 环境                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    表现层（UI Layer）                      │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │  │
│  │  │ Ribbon UI   │  │ Taskpane UI │  │ Dialog/Toast    │  │  │
│  │  │ 功能区按钮   │  │ 任务窗格    │  │ 对话框提示      │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    服务层（Service Layer）                 │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │          ribbonService.ts（Ribbon专用服务）         │  │  │
│  │  │  - getSyncPreview（同步预览统计）                    │  │  │
│  │  │  - detectConflicts（冲突检测）                      │  │  │
│  │  │  - syncWithConfirmation（确认式同步流程）           │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                   业务逻辑层（Service Layer）               │  │
│  │  ┌──────────────────────┐  ┌──────────────────────────┐  │  │
│  │  │  exceltobangumi.ts  │  │      scraping.ts          │  │  │
│  │  │  Excel→Bangumi同步  │  │   Bangumi→Excel同步      │  │  │
│  │  └──────────────────────┘  └──────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │               syncRecord.ts（同步记录管理）          │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                   工具层（Tool Layer）                     │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │  │
│  │  │ http   │ │ util   │ │ events │ │ crypto │ │  wps   │  │  │
│  │  │ HTTP   │ │ 通用   │ │ 事件   │ │ 加密   │ │ 类型   │  │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                  核心层（Core Layer）                      │  │
│  │  ┌────────────────────┐  ┌─────────────────────────────┐  │  │
│  │  │    constants.ts    │  │       result.ts             │  │  │
│  │  │    全局常量定义     │  │   Result<T>类型系统         │  │  │
│  │  └────────────────────┘  └─────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     外部服务                                │  │
│  │                 Bangumi API (api.bgm.tv)                   │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 模块职责矩阵

| 模块路径 | 文件名 | 主要职责 | 对外暴露 |
|---------|--------|---------|---------|
| ts/core | constants.ts | 存储所有全局常量、枚举、配置值、表头规则 | ✅ |
| ts/core | result.ts | 提供Result<T>类型和BgmError类 | ✅ |
| ts/core | crypto.ts | Token的加密和解密处理 | ✅ |
| ts/sync | exceltobangumi.ts | Excel数据读取、转换为API格式、上传 | ✅ |
| ts/sync | scraping.ts | 从Bangumi API获取用户收藏数据 | ✅ |
| ts/sync | syncRecord.ts | 同步历史记录工作表的CRUD操作 | ✅ |
| ts/services | ribbonService.ts | Ribbon专用服务（预览、冲突检测、同步确认） | ✅ |
| ts/tools | http.ts | 封装XMLHttpRequest，支持重试和限流 | ✅ |
| ts/tools | util.ts | 全局工具函数、BGM命名空间 | ✅ |
| ts/tools | events.ts | 事件总线实现，解耦模块通信 | ✅ |
| ts/tools | wps.ts | WPS COM对象的TypeScript类型定义 | ✅ |
| ts/ui | dialog.ts | 各种对话框和Toast提示组件 | ✅ |
| ts/ui | handlers.ts | 用户交互事件的处理逻辑 | ✅ |
| ts/ui | message.ts | 主窗口与任务窗格间的消息传递 | ✅ |
| ts/ui | preview.ts | 数据预览和详情弹窗 | ✅ |
| ts | index.ts | 统一导出所有模块的入口文件 | ✅ |
| ts | ribbon.ts | WPS功能区按钮的回调实现 | ✅ |
| ts | taskpane.ts | 任务窗格的主要UI逻辑 | ✅ |

### 数据流动图

**同步流程：Excel → Bangumi（含预览和冲突检测）**

```
用户点击"全面同步"
     │
     ▼
┌─────────────────────────────────────────────────┐
│ ribbonService.ts - syncWithConfirmation()       │
│  1. 获取数据工作表                               │
│  2. 查找表头和列映射                             │
└─────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────┐
│ ribbonService.ts - getSyncPreview()             │
│  扫描Excel数据，统计：                            │
│  - 总行数、有效条目、已上传、待同步、跳过等      │
└─────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────┐
│ ribbonService.ts - detectConflicts()             │
│  1. 获取Bangumi收藏快照（fetchAllUserCollections）│
│  2. 比对Excel与Bangumi的状态差异                 │
│  3. 返回冲突列表                                 │
└─────────────────────────────────────────────────┘
     │
     ▼
显示预览对话框 + 冲突信息 + 确认按钮
     │
     ├──────────────────┐
     ▼                  ▼
   取消                确认
     │                  │
     │                  ▼
     │        ┌────────────────────────────────┐
     │        │ exceltobangumi.ts              │
     │        │ SyncToBangumiAsync()           │
     │        │  1. 获取筛选状态（可见行）     │
     │        │  2. 批量读取单元格数据         │
     │        │  3. 逐行处理：                 │
     │        │     - 提取Subject ID           │
     │        │     - 构建JSON Payload         │
     │        │     - 发送API请求              │
     │        │     - 标记颜色结果             │
     │        │  4. 记录同步历史               │
     │        └────────────────────────────────┘
     │                  │
     │                  ▼
     │        显示同步结果统计
     │
结束
```

---

## 核心模块详解

### 1. 常量模块 (ts/core/constants.ts)

**文件路径**：[constants.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/constants.ts)

**核心职责**：作为项目的「配置中心」，集中存储所有常量值，消除硬编码分散在代码各处的问题。

#### 核心常量分类

**错误级别枚举**：

```typescript
export const ErrorLevel = {
    SILENT: 0,   // 静默处理
    WARN: 1,     // 输出警告
    ERROR: 2,    // 输出错误
    THROW: 3    // 抛出异常
} as const;
```

**Bangumi API 配置**：

```typescript
export const BGM_CONFIG = {
    API_BASE: "https://api.bgm.tv",
    REQUEST_DELAY: 800,      // 请求间隔（毫秒）
    MAX_RETRIES: 3,         // 最大重试次数
    RETRY_DELAY_BASE: 2000  // 重试等待基础时间
};
```

**列规则配置（正则表达式 → 标准列名映射）**：

```typescript
export const COLUMN_RULES: [RegExp, string][] = [
    [/bangumi.*url|bgm.*url|subject.*url|url.*bgm/i, "Bangumi_URL"],
    [/是否看完|观看状态/, "是否看完"],
    [/完播日|完播时间|看完时间/, "完播日"],
    [/打分|评分|分数|\brate\b/i, "打分"],
    [/感言|剧透|评价|评论|\bcomment\b/i, "剧透/感言"],
    [/标签|分级|\btag\b/i, "标签/分级"],
    // ... 更多规则
];
```

**表头关键字列表**（用于自动识别表头行）：

```typescript
export const HEADER_KEYWORDS = [
    "序列号", "是否看完", "看完时间", "开播季度",
    "名称", "别名", "剧透/感言", "打分",
    "bangumi url", "条目id", "sid",
    // ... 共48个关键字
];
```

**颜色常量**（用于单元格标记）：

```typescript
export const BGM_COLOR = {
    SUCCESS: 0xCCFFCC,      // 浅绿色 - 同步成功
    FAIL: 0xFFCCCC,         // 浅红色 - 同步失败
    SKIP: 0xFFFFCC,         // 浅黄色 - 跳过
    BGM_SYNC: 0x7030A0,     // 紫色 - 已收藏1次
    LIGHT_GREEN: 0x92D050,  // 浅绿色 - 已同步2次
    DARK_GREEN: 0x00B050    // 深绿色 - 已同步3次+
};
```

---

### 2. 结果类型模块 (ts/core/result.ts)

**文件路径**：[result.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/result.ts)

**核心职责**：提供统一的操作结果包装类型，替代传统的try-catch和直接抛错模式。

#### BgmError 类

```typescript
export class BgmError extends Error {
    code: string;                      // 错误码
    details: Record<string, any>;      // 错误详情
    timestamp: string;                 // 错误时间

    constructor(
        message: string,
        code: string = 'UNKNOWN',
        details: Record<string, any> = {}
    );
}
```

#### Result<T> 泛型类

```typescript
export class Result<T> {
    readonly success: boolean;
    readonly data: T | null;
    readonly error: BgmError | null;

    static ok<T>(data: T): Result<T>;           // 创建成功结果
    static fail<T>(error: BgmError): Result<T>;  // 创建失败结果
    static fromCode<T>(code: number, data?: T | null): Result<T>;

    isOk(): boolean;
    isFail(): boolean;
    unwrap(): T;                    // 获取数据（失败则抛错）
    unwrapOr(defaultValue: T): T;   // 获取数据或默认值
    map<U>(fn: (data: T) => U): Result<U>;
    mapErr(fn: (error: BgmError) => BgmError): Result<T>;
}
```

---

### 3. 加密模块 (ts/core/crypto.ts)

**文件路径**：[crypto.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/crypto.ts)

**核心职责**：安全存储用户的Bangumi API Token。

#### 核心函数

| 函数名 | 功能 |
|--------|------|
| `buildPayload()` | 构建加密前的Payload（版本+校验和+Token） |
| `calcChecksum()` | 计算Token的校验和 |
| `extractToken()` | 从解密字符串中提取Token并校验 |
| `encryptToken()` | 使用XOR加密Token |
| `decryptToken()` | 解密XOR加密的Token |
| `encryptTokenAsync()` | 使用AES-GCM加密Token（异步，更安全） |
| `decryptTokenAsync()` | 解密AES-GCM加密的Token（异步） |

---

## 同步模块详解

### 1. Excel到Bangumi同步 (ts/sync/exceltobangumi.ts)

**文件路径**：[exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts)

**核心职责**：实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。

#### 关键函数

| 函数名 | 功能 |
|--------|------|
| `extractSubjectId()` | 从URL或文本提取Bangumi Subject ID |
| `mapWatchStatus()` | 将观看状态文本转换为API数值 |
| `buildTagsArray()` | 构建标签数组 |
| `getFilterStatus()` | 获取筛选状态（可见行/隐藏行） |
| `buildJsonPayload()` | 构建API请求的JSON Body |
| `bgmRequestSync()` | 发送同步请求到Bangumi |
| `SyncToBangumiAsync()` | 主同步入口，协调整个同步流程 |
| `clearRowColors()` | 清除所有行的颜色标记 |
| `testSingleUpdate()` | 测试单个条目的更新 |

#### 主同步函数详解

```typescript
/**
 * 异步批量同步 Excel 数据到 Bangumi
 * - 支持筛选状态下仅处理可见行
 * - 批量读取单元格数据，提高性能
 * - 动态请求间隔，避免限制的同时提升速度
 * - 统一错误处理，带详细日志
 *
 * @param ws 工作表对象
 * @param colMap 列名到列号的映射 Map
 * @param token Bangumi API 访问令牌
 * @param lastRow 数据区域最后一行
 * @param headerRow 表头行号
 * @param options 可选项（onProgress, onItemComplete 回调）
 * @returns 同步结果统计 { success, fail, skip }
 */
export async function SyncToBangumiAsync(
    ws: any,
    colMap: Map<string, number>,
    token: string,
    lastRow: number,
    headerRow: number,
    options?: SyncOptions
): Promise<{ success: number; fail: number; skip: number }>
```

#### 观看状态映射

| Excel中填写 | 映射值 | Bangumi含义 |
|-------------|--------|------------|
| 看过/看完/已看/完/completed | 3 | 已完成 |
| 在看/在看动画/在追/追/watching | 2 | 正在看 |
| 想看/想看动画/否/wish | 0 | 想看 |
| 搁置/暂停/on_hold | 4 | 搁置 |
| 抛弃/弃/弃番/drop/dropped | 5 | 抛弃 |

---

### 2. Bangumi数据拉取 (ts/sync/scraping.ts)

**文件路径**：[scraping.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/scraping.ts)

**核心职责**：从Bangumi API获取用户的收藏数据。

#### 关键函数

| 函数名 | 功能 |
|--------|------|
| `verifyToken()` | 异步验证Token的有效性 |
| `fetchAllUserCollections()` | 异步获取用户所有收藏（自动分页） |
| `fetchSubjectCollection()` | 获取单个条目的收藏状态 |

---

### 3. 同步记录管理 (ts/sync/syncRecord.ts)

**文件路径**：[syncRecord.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/syncRecord.ts)

**核心职责**：管理「同步记录」工作表，记录每一次同步操作的详细信息。

#### 关键函数

| 函数名 | 功能 |
|--------|------|
| `getOrCreateSyncRecordSheet()` | 获取或新建「同步记录」工作表 |
| `addSyncRecord()` | 添加或更新一条同步记录 |
| `getAllSyncRecords()` | 获取所有同步记录（从缓存） |
| `clearSyncRecords()` | 清除所有同步记录 |
| `openSyncRecordSheet()` | 切换到同步记录工作表 |
| `clearSheetMarksInSheet()` | 清除指定工作表的颜色标记 |

---

## 服务模块详解

### Ribbon服务 (ts/services/ribbonService.ts)

**文件路径**：[ribbonService.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/services/ribbonService.ts)

**核心职责**：提供Ribbon按钮的专用服务，包括同步预览、冲突检测和确认式同步流程。

#### 关键函数

| 函数名 | 功能 |
|--------|------|
| `getSyncPreview()` | 获取同步预览统计（不发送API请求，仅扫描Excel） |
| `detectConflicts()` | 异步检测Excel与Bangumi收藏之间的冲突 |
| `syncWithConfirmation()` | Ribbon专用的完整同步流程：预览→冲突检测→确认→执行 |
| `setTokenForRibbon()` | 设置Token（Ribbon版本） |
| `testTokenForRibbon()` | 测试Token（Ribbon版本） |
| `setUserIdForRibbon()` | 设置用户ID（Ribbon版本） |
| `openCollectionForRibbon()` | 打开收藏页面 |
| `clearColorsForRibbon()` | 清除颜色标记 |

#### 同步预览函数详解

```typescript
/**
 * 获取同步预览统计（不发送请求，仅扫描 Excel）
 * @param ws 工作表对象
 * @param colMap 列映射
 * @param lastRow 数据最后一行
 * @param headerRow 表头行
 * @returns 统计信息 { total, valid, willSync, willSkip, alreadyUploaded }
 */
export function getSyncPreview(
    ws: any,
    colMap: Map<string, number>,
    lastRow: number,
    headerRow: number
): { total: number; valid: number; willSync: number; willSkip: number; alreadyUploaded: number }
```

**返回统计说明**：

- `total`：总行数（可见行）
- `valid`：有效条目（有有效SID）
- `willSync`：待同步（状态非"想看"且未上传）
- `willSkip`：不上传（状态为"想看"）
- `alreadyUploaded`：已上传（颜色标记为成功）

#### 冲突检测函数详解

```typescript
/**
 * 异步检测 Excel 与 Bangumi 收藏之间的冲突
 * @returns 包含冲突条目列表及统计信息的对象
 */
export async function detectConflicts(
    ws: any,
    colMap: Map<string, number>,
    lastRow: number,
    headerRow: number,
    token: string
): Promise<{
    conflicts: Array<{
        row: number;      // Excel行号
        sid: string;      // Subject ID
        name: string;     // 条目名称
        existingType?: number;  // Bangumi现有状态
        newType: number;       // Excel新状态
    }>;
    conflictCount: number;     // 冲突数量
    bgmCollectionReady: boolean;  // Bangumi收藏是否获取成功
}>
```

#### 确认式同步流程

```typescript
/**
 * Ribbon 专用的完整同步流程：预览 → 冲突检测 → 确认 → 执行
 * @param conflictResolution 冲突处理策略，默认 'excel'（覆盖）
 */
export async function syncWithConfirmation(conflictResolution: 'excel' | 'skip' = 'excel')
```

**流程说明**：

1. **预览统计**：调用`getSyncPreview()`获取Excel数据统计
2. **冲突检测**：调用`detectConflicts()`获取Bangumi收藏并比对差异
3. **确认弹窗**：显示预览信息和冲突提示，等待用户确认
4. **执行同步**：用户确认后调用`SyncToBangumiAsync()`执行同步
5. **结果展示**：显示同步完成统计

---

## 工具模块详解

### 1. 事件总线模块 (ts/tools/events.ts)

**文件路径**：[events.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/events.ts)

**核心职责**：实现模块间的发布-订阅事件系统，提供松耦合的组件通信方式。

#### 事件总线类

```typescript
export class EventBus {
    on(event: string, handler: EventHandler): () => void;  // 订阅事件
    off(event: string, handler: EventHandler): void;      // 退订事件
    emit(event: string, data?: any): void;                // 发布事件
    once(event: string, handler: EventHandler): () => void; // 单次订阅
    clear(): void;                                          // 清除所有订阅
    clearEvent(event: string): void;                        // 清除特定事件
    listenerCount(event: string): number;                  // 获取订阅数量
}
```

#### 预定义事件常量

```typescript
export const BGM_EVENTS = {
    TOKEN_UPDATED:   'state:tokenUpdated',      // Token更新
    USER_ID_UPDATED: 'state:userIdUpdated',     // 用户ID更新
    USER_NAME_UPDATED: 'state:userNameUpdated', // 用户名更新
    SYNC_PROGRESS:   'sync:progress',           // 同步进度
    SYNC_COMPLETED:  'sync:completed',          // 同步完成
    SYNC_ERROR:      'sync:error',              // 同步出错
    SHEET_LOCKED:    'sheet:locked',            // 工作表锁定
    SHEET_UNLOCKED:  'sheet:unlocked'          // 工作表解锁
} as const;
```

---

### 2. 通用工具模块 (ts/tools/util.ts)

**文件路径**：[util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)

**核心职责**：提供各类通用工具函数，以及维护BGM全局命名空间对象。

#### BGM 全局对象

```typescript
export const BGM: {
    cache: BGMCache;          // 缓存数据
    sheet: BGMSheet;         // 工作表状态
    sync: BGMSync;           // 同步状态
    LOG_LEVEL: number;       // 日志级别
    LOG_LEVELS: typeof LOG_LEVELS;
    ERROR_LEVELS: typeof ERROR_LEVELS;
    ErrorLevel: typeof ErrorLevel;
    BgmError: typeof BgmError;

    Dialog: {                 // 对话框接口
        alert: (title: string, message: string) => void;
        confirm: (message: string, onConfirm?: () => void, onCancel?: () => void) => void;
        error: (title: string, message: string) => void;
        input: (title: string, prompt: string, defaultValue?: string, onOk?: (value: string) => void, onCancel?: () => void) => void;
        show: (type: 'alert' | 'confirm' | 'error' | 'input', title: string, message: string, options?: DialogOptions) => void;
    };

    Message: {                // 消息通信
        send: (data: Record<string, unknown>, targetOrigin?: string) => boolean;
    };

    setUserId: (id: string | null) => void;
    setUsername: (name: string | null) => void;
    notifyTokenUpdated: () => void;
    setSyncProgress: (current: number, total: number, message: string) => void;
    setSyncComplete: (results?: { success: number; fail: number; skip: number }) => void;
    setSyncError: (error: unknown) => void;
}
```

#### 常用工具函数

| 函数名 | 功能 |
|--------|------|
| `getApp()` | 获取WPS Application对象 |
| `colNumToLetter()` | 将列号转换为字母（1→A, 27→AA） |
| `getCell()` | 安全获取单元格对象 |
| `getCellValue()` | 安全获取单元格值 |
| `readCell()` | 读取单元格（兼容多种取值方式） |
| `setCellValue()` | 安全设置单元格值 |
| `bgmLog()` | 统一日志函数 |
| `escapeHtml()` | HTML特殊字符转义 |
| `storeBgToken()` | 加密并存储Token |
| `loadBgToken()` | 加载并解密Token |
| `_getBgmUserId()` | 获取用户ID |
| `_setBgmUserId()` | 设置用户ID |
| `_getUserApiPath()` | 获取Bangumi API用户路径 |
| `fetchBgmUserInfo()` | 异步获取用户信息 |
| `findHeaderRow()` | 查找并定位表头行 |
| `getColumnMap()` | 获取列名到字段的映射（使用正则规则） |
| `getLastRow()` | 获取最后有数据的行号 |
| `readRangeValues()` | 批量读取工作表中指定范围的值 |
| `getFilterStatus()` | 获取筛选状态（可见行/隐藏行） |
| `isEmptyValue()` | 判断值是否为空 |
| `clearSheetCache()` | 清除指定工作表的缓存 |
| `getDataSheet()` | 获取数据工作表（考虑锁定状态） |
| `delay()` | 异步延迟函数 |
| `showBangumiPanel()` | 显示同步面板 |
| `wpsMsgBox()` | 显示WPS消息框 |
| `trim()` | 字符串去除首尾空格 |

---

## UI模块详解

### 1. 对话框组件 (ts/ui/dialog.ts)

**文件路径**：[dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts)

**核心职责**：提供统一的对话框和提示组件。

#### 主要函数

| 函数名 | 功能 |
|--------|------|
| `showAlert()` | 显示警告对话框 |
| `showConfirm()` | 显示确认对话框（支持回调） |
| `showError()` | 显示错误对话框 |
| `showSuccess()` | 显示成功提示 |
| `showInput()` | 显示输入对话框 |
| `showToast()` | 显示轻提示（自动消失） |

---

### 2. 事件处理器 (ts/ui/handlers.ts)

**文件路径**：[handlers.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts)

**核心职责**：处理用户交互事件，包括Token设置、用户ID设置、标记操作等。

---

### 3. 消息通信 (ts/ui/message.ts)

**文件路径**：[message.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/message.ts)

**核心职责**：处理主窗口与任务窗格（WebView）之间的postMessage通信。

---

### 4. 数据预览 (ts/ui/preview.ts)

**文件路径**：[preview.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts)

**核心职责**：生成数据预览HTML和详情弹窗。

---

## 依赖关系

### 模块依赖图

```
index.ts (统一导出入口)
     │
     ├──▶ constants.ts (无依赖)
     │
     ├──▶ result.ts (无依赖)
     │
     ├──▶ crypto.ts (依赖 constants.ts)
     │
     ├──▶ events.ts (无依赖)
     │
     ├──▶ http.ts (依赖 result.ts)
     │
     ├──▶ util.ts (依赖 constants.ts, result.ts, crypto.ts, events.ts)
     │
     ├──▶ exceltobangumi.ts (依赖 util.ts, syncRecord.ts, constants.ts)
     │
     ├──▶ scraping.ts (依赖 util.ts)
     │
     ├──▶ syncRecord.ts (依赖 util.ts)
     │
     ├──▶ ribbonService.ts (依赖 util.ts, exceltobangumi.ts, scraping.ts)
     │
     ├──▶ dialog.ts (无依赖)
     │
     ├──▶ handlers.ts (依赖 util.ts)
     │
     ├──▶ message.ts (无依赖)
     │
     ├──▶ preview.ts (无依赖)
     │
     ├──▶ ribbon.ts (依赖 util.ts, ribbonService.ts)
     │
     └──▶ taskpane.ts (依赖多个模块)
```

---

## 项目运行方式

### 环境准备

- **操作系统**：Windows 7/8/10/11
- **办公软件**：WPS Office 2016及以上版本
- **运行时**：Node.js 18.x 或更高版本

### 常用命令

| 命令 | 功能 |
|------|------|
| `npm install` | 安装依赖 |
| `npm run dev` | 启动Vite开发服务器（端口3889） |
| `npm run build` | 执行完整构建（TS编译 + Vite打包） |
| `npm run build:ts` | 仅编译TypeScript到dist-ts |
| `npm run debug` | 启动调试模式 |
| `npm run lint` | 运行ESLint代码检查 |
| `npm run format` | 运行Prettier代码格式化 |

---

## 关键类与函数参考

### BGM 全局对象使用

```typescript
// 发送消息
BGM.Message.send({ type: 'sync:complete' });

// 事件通知
BGM.notifyTokenUpdated();
BGM.setUserId('123456');
BGM.setSyncProgress(5, 10, '处理中...');
BGM.setSyncComplete({ success: 8, fail: 1, skip: 1 });
BGM.setSyncError(new Error('同步失败'));
```

### 事件订阅

```typescript
import { eventBus, BGM_EVENTS } from '../tools/events.js';

// 订阅同步进度
eventBus.on(BGM_EVENTS.SYNC_PROGRESS, (data) => {
    console.log(`进度: ${data.current}/${data.total}`);
});

// 订阅同步完成
eventBus.on(BGM_EVENTS.SYNC_COMPLETED, (results) => {
    console.log(`完成: 成功=${results.success}, 失败=${results.fail}`);
});
```

### 同步记录操作

```typescript
import { addSyncRecord, getOrCreateSyncRecordSheet } from './syncRecord.js';

addSyncRecord({
    name: '某动画',
    url: 'https://bgm.tv/subject/123',
    sid: '123',
    status: SYNC_STATUS.SUCCESS,
    message: '同步成功',
    count: 1
});
```

---

## 问题与优化建议

### 一、当前存在的问题

#### 1. 安全性问题

- Token加密密钥硬编码在源代码中
- XOR加密强度较低
- 缺少Token过期检测机制

#### 2. 性能问题

- 同步采用逐行处理
- 为防止限流设置800ms间隔
- 大量数据同步耗时长

#### 3. 代码质量问题

- 缺少单元测试
- 部分函数缺少JSDoc注释（已部分完成）

### 二、功能增强建议

#### 1. 冲突解决机制

当前`detectConflicts()`仅检测冲突，建议扩展：

```typescript
type ConflictResolution = 'keep_excel' | 'keep_bgm' | 'merge' | 'ask';
```

#### 2. 增量同步模式

只同步自上次同步以来发生变化的数据：

```typescript
interface IncrementalSync {
    lastSyncTimestamp: string;
    changedRows: SyncChange[];
}
```

#### 3. 多账户支持

```typescript
interface Account {
    id: string;
    name: string;
    token: string;
    userId: string;
}
```

### 三、架构优化建议

#### 1. 状态管理

引入集中式状态管理（Zustand/Redux Toolkit）

#### 2. 单元测试

建议为以下模块添加测试：

- `exceltobangumi.ts`：表头识别、字段映射、状态转换
- `scraping.ts`：Token验证、收藏获取
- `ribbonService.ts`：预览统计、冲突检测

#### 3. 依赖注入

降低模块间耦合，使用简单的DI容器

---

## 版本历史

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| 1.0.0 | - | 初始版本发布 |
| V2 | - | 添加JSDoc注释、完善文档 |
| V3 | 2026-05-09 | 新增ribbonService.ts服务层、实现冲突检测和同步预览功能、优化事件系统 |

---

**文档信息**

- **编写日期**：2026-05-09
- **文档版本**：V3
- **维护者**：BGM开发团队
- **许可协议**：MIT License
