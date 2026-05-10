# Bangumi同步助手 - 完整代码维基文档

## 目录

- [项目概述](#项目概述)
- [项目架构](#项目架构)
- [核心模块详解](#核心模块详解)
- [同步模块详解](#同步模块详解)
- [工具模块详解](#工具模块详解)
- [UI模块详解](#ui模块详解)
- [入口与界面模块](#入口与界面模块)
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

**技术选型**：

- **开发语言**：TypeScript 6.x，采用强类型系统保障代码质量
- **构建工具**：Vite 6.x，支持快速开发和高效打包
- **目标平台**：WPS Office Excel（兼容模式支持MS Office Excel）
- **外部服务**：Bangumi API v0（RESTful API）

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
│   ├── tools/                       # 工具函数库
│   │   ├── events.ts               # 事件总线
│   │   ├── http.ts                # HTTP请求封装
│   │   ├── util.ts                # 通用工具函数
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

项目采用经典的分层架构模式，自上而下分为四个主要层次：

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
│  │                   业务逻辑层（Service Layer）               │  │
│  │  ┌──────────────────────┐  ┌──────────────────────────┐  │  │
│  │  │  exceltobangumi.ts   │  │      scraping.ts          │  │  │
│  │  │  Excel→Bangumi同步   │  │   Bangumi→Excel同步      │  │  │
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
| ts/core | constants.ts | 存储所有全局常量、枚举、配置值 | ✅ |
| ts/core | result.ts | 提供Result<T>类型和BgmError类 | ✅ |
| ts/core | crypto.ts | Token的加密和解密处理 | ✅ |
| ts/sync | exceltobangumi.ts | Excel数据读取、转换为API格式、上传 | ✅ |
| ts/sync | scraping.ts | 从Bangumi API获取用户收藏数据 | ✅ |
| ts/sync | syncRecord.ts | 同步历史记录工作表的CRUD操作 | ✅ |
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

**同步流程A：Excel → Bangumi**

```
用户触发同步
     │
     ▼
┌─────────────────┐
│ taskpane.ts     │
│ 选择工作表       │
└─────────────────┘
     │
     ▼
┌─────────────────┐
│ exceltobangumi  │
│ 解析表头行       │
└─────────────────┘
     │
     ▼
┌─────────────────┐
│ exceltobangumi  │
│ 构建列映射       │
└─────────────────┘
     │
     ▼
┌─────────────────┐
│ 遍历数据行       │
│ （支持筛选）     │
└─────────────────┘
     │
     ├──────────────────┐
     ▼                  ▼
┌──────────┐      ┌──────────┐
│ 提取数据  │      │ 跳过无效行 │
└──────────┘      └──────────┘
     │                  │
     ▼                  ▼
┌─────────────────┐
│ http.ts         │
│ 构建HTTP请求    │
└─────────────────┘
     │
     ▼
┌─────────────────┐
│ Bangumi API     │
│ 发送PUT请求     │
└─────────────────┘
     │
     ├──────────────┐
     ▼              ▼
┌────────┐    ┌────────┐
│ 同步成功│    │ 同步失败│
└────────┘    └────────┘
     │              │
     ▼              ▼
┌─────────────────────────┐
│ syncRecord.ts           │
│ 记录到「同步记录」工作表 │
│ 设置单元格颜色标记      │
└─────────────────────────┘
     │
     ▼
显示同步结果
```

---

## 核心模块详解

### 1. 常量模块 (ts/core/constants.ts)

**文件路径**：[constants.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/constants.ts)

**核心职责**：作为项目的「配置中心」，集中存储所有常量值，消除硬编码分散在代码各处的问题。

**常量分类说明**：

#### WPS Office 枚举值

```typescript
export const WPS_ENUM = {
  msoCTPDockPositionLeft: 0,    // 任务窗格停靠左侧
  msoCTPDockPositionRight: 2   // 任务窗格停靠右侧
};
```

#### Excel 方向常量（xl系列）

```typescript
export const XL = {
  UP: -4162,              // 向上定位（xlUp）
  DOWN: -4121,            // 向下定位（xlDown）
  TO_LEFT: -4159,         // 向左定位（xlToLeft）
  TO_RIGHT: -4161,        // 向右定位（xlToRight）
  NONE: -4142,            // 无特殊填充（xlNone）
  CELL_TYPE_VISIBLE: 12   // 可见单元格类型（xlCellTypeVisible）
};
```

#### Bangumi API 配置

```typescript
export const BGM_CONFIG = {
  API_BASE: "https://api.bgm.tv",    // Bangumi API基础URL
  REQUEST_DELAY: 800,                // 请求间隔（毫秒），防止限流
  MAX_RETRIES: 3,                   // 失败后最大重试次数
  RETRY_DELAY_BASE: 2000            // 重试等待基础时间（指数退避）
};
```

#### 颜色常量（用于单元格标记）

```typescript
export const BGM_COLOR = {
  SUCCESS: 0xCCFFCC,      // 浅绿色 - 同步成功
  FAIL: 0xFFCCCC,         // 浅红色 - 同步失败
  SKIP: 0xFFFFCC,         // 浅黄色 - 跳过
  BGM_SYNC: 0x7030A0,      // 紫色 - 从Bangumi同步
  LIGHT_GREEN: 0x92D050,   // 浅绿色 - 已同步1次
  DARK_GREEN: 0x00B050,   // 深绿色 - 已同步2次以上
  GRAY: 0xD3D3D3,         // 灰色 - 表头背景
  WHITE: 0xFFFFFF          // 白色 - 清除标记
};
```

#### 任务面板配置

```typescript
export const PANEL_CONFIG = {
  MAX_SCAN_COLUMNS: 60,           // 表头检测的最大列数
  MAX_SCAN_ROWS: 10,              // 表头检测的最大行数
  PREVIEW_LIMIT: 8,               // 预览显示的数据行数上限
  MAX_FILTER_SCAN_ROWS: 5000,     // 筛选检测最大行数
  FILTER_FALLBACK_LIMIT: 200      // 回退检测的最大行数
};
```

#### 错误级别枚举

```typescript
export const ErrorLevel = {
  SILENT: 0,   // 静默处理，不输出任何信息
  WARN: 1,     // 输出警告信息
  ERROR: 2,    // 输出错误信息
  THROW: 3     // 抛出异常
} as const;
```

**使用规范**：所有模块应从本模块导入常量，避免在业务代码中直接写死数值。

---

### 2. 结果类型模块 (ts/core/result.ts)

**文件路径**：[result.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/result.ts)

**核心职责**：提供统一的操作结果包装类型，替代传统的try-catch和直接抛错模式。

#### BgmError 类

自定义错误类型，继承自Error，并扩展了错误码、详情和时间戳。

```typescript
export class BgmError extends Error {
  code: string;                      // 错误码，如'TOKEN_INVALID'
  details: Record<string, any>;      // 错误详情对象
  timestamp: string;                 // 错误发生时间（ISO格式）

  constructor(
    message: string,                 // 错误消息
    code: string = 'UNKNOWN',        // 错误码，默认'UNKNOWN'
    details: Record<string, any> = {} // 额外详情
  ) {
    super(message);
    this.name = 'BgmError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toString(): string {
    return `[${this.code}] ${this.message}`;
  }
}
```

#### Result<T> 泛型类

包装操作结果，支持链式调用和模式匹配。

```typescript
export class Result<T> {
  readonly success: boolean;         // 是否成功
  readonly data: T | null;          // 成功时的数据
  readonly error: BgmError | null;   // 失败时的错误信息

  // 静态工厂方法
  static ok<T>(data: T): Result<T>           // 创建成功结果
  static fail<T>(error: BgmError): Result<T>  // 创建失败结果
  static fromCode<T>(code: number): Result<T> // 根据HTTP状态码创建

  // 实例方法
  isOk(): boolean                  // 判断是否成功
  isFail(): boolean                // 判断是否失败
  unwrap(): T                      // 获取数据，失败则抛错
  unwrapOr(defaultValue: T): T     // 获取数据或默认值
  map<U>(fn: (data: T) => U): Result<U>  // 转换成功值
  mapErr(fn: (error: BgmError) => BgmError): Result<T> // 转换错误
}
```

**Result 使用模式**：

```typescript
// 模式1：条件判断
const result = await httpGet<UserInfo>('/v0/me', token);
if (result.isOk()) {
  console.log(result.unwrap().username);
} else {
  console.error(result.error?.message);
}

// 模式2：链式调用
const nameResult = result.map(user => user.name);

// 模式3：获取或默认值
const userId = result.unwrapOr({ id: 0 }).id;
```

---

### 3. 加密模块 (ts/core/crypto.ts)

**文件路径**：[crypto.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/crypto.ts)

**核心职责**：安全存储用户的Bangumi API Token，防止明文泄露。

#### 加密策略

采用双层加密方案：

1. **Payload构建**：在Token前后附加版本前缀和校验和
2. **数据混淆**：使用XOR加密（同步可用）或AES-GCM（更强安全）

#### 核心函数

| 函数名 | 同步/异步 | 功能描述 |
|--------|----------|---------|
| `buildPayload()` | 同步 | 构建加密前的Payload（版本+校验和+Token） |
| `calcChecksum()` | 同步 | 计算Token的校验和（用于验证完整性） |
| `extractToken()` | 同步 | 从解密字符串中提取Token并校验 |
| `encryptToken()` | 同步 | 使用XOR加密Token |
| `decryptToken()` | 同步 | 解密XOR加密的Token |
| `encryptTokenAsync()` | 异步 | 使用AES-GCM加密Token（更强保护） |
| `decryptTokenAsync()` | 异步 | 解密AES-GCM加密的Token |

#### 加密格式

```
同步XOR加密输出格式：1:iv.base64.encrypted.base64
   └─版本 │  ┌─IV向量 └───加密数据
```

---

## 同步模块详解

### 1. Excel到Bangumi同步 (ts/sync/exceltobangumi.ts)

**文件路径**：[exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts)

**核心职责**：实现从Excel表格读取番剧数据并同步到Bangumi网站的核心业务逻辑。

#### 表头识别机制

系统通过关键字匹配自动识别表头行：

```typescript
export const HEADER_KEYWORDS = [
  "序列号", "是否看完", "看完时间", "开播季度",
  "开播日期", "完播日", "类别", "原作标签", "制作公司",
  "标签/分级", "特点/印象", "打分", "集号", "集数",
  "名称", "别名", "剧透/感言", "感言", "备注", "评价",
  "bangumi url", "url", "制片国家", "语言", "类型",
  "导演", "音乐", "原作", "标签",
  "条目id", "sid", "状态", "status", "rate",
  "番剧", "动画", "书", "名字", "链接",
  "观看状态", "收藏类型", "章节状态", "同步状态",
  "关联的动漫", "系列", "季数", "时长"
];
```

**识别规则**：扫描前10行，找到包含3个及以上关键字的行即判定为表头行。

#### 字段映射表

```typescript
const FIELD_NAME_MAP: {[key: string]: string} = {
  "名称": "name", "name": "name", "作品名": "name",
  "条目id": "subjectId", "sid": "subjectId",
  "bangumi url": "url", "url": "url",
  "状态": "type", "type": "type", "观看状态": "type",
  "是否看完": "watchStatus",
  "评分": "rate", "rate": "rate",
  "标签": "tags", "tags": "tags",
  "评价": "comment", "comment": "comment",
  // ... 更多映射
};
```

#### 观看状态映射

| Excel中填写 | 映射值 | Bangumi含义 |
|-------------|--------|------------|
| 看过/看完/已看/完/completed/3 | 3 | 已完成 |
| 在看/在看动画/在追/追/watching/2 | 2 | 正在看 |
| 想看/想看动画/否/wish/1 | 0 | 想看 |
| 搁置/暂停/on_hold/4 | 4 | 搁置 |
| 抛弃/弃/弃番/drop/dropped/5 | 5 |抛弃 |

#### 关键函数列表

| 函数名 | 功能 |
|--------|------|
| `findHeaderRow()` | 查找并定位表头行 |
| `getColumnMap()` | 获取列名到字段的映射关系 |
| `getLastRow()` | 获取最后有数据的行号 |
| `extractSubjectId()` | 从URL或文本提取Bangumi条目ID |
| `mapWatchStatus()` | 将观看状态文本转换为API数值 |
| `buildJsonPayload()` | 构建API请求的JSON Body |
| `bgmRequestSync()` | 发送同步请求到Bangumi |
| `SyncToBangumi()` | 主同步入口，协调整个同步流程 |
| `clearRowColors()` | 清除所有行的颜色标记 |

---

### 2. Bangumi数据拉取 (ts/sync/scraping.ts)

**文件路径**：[scraping.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/scraping.ts)

**核心职责**：从Bangumi API获取用户的收藏数据，并写入Excel表格。

#### 主要API端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/v0/me` | GET | 获取当前登录用户信息 |
| `/v0/users/{user_id}/collections` | GET | 获取指定用户的收藏列表 |

#### 关键函数

| 函数名 | 功能 |
|--------|------|
| `verifyToken()` | 异步验证Token的有效性 |
| `fetchAllUserCollections()` | 异步获取用户所有收藏（自动分页） |

---

### 3. 同步记录管理 (ts/sync/syncRecord.ts)

**文件路径**：[syncRecord.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/syncRecord.ts)

**核心职责**：管理「同步记录」工作表，记录每一次同步操作的详细信息。

#### 工作表结构

| 列号 | 列名 | 数据类型 | 说明 |
|------|------|----------|------|
| A | 序号 | 数字 | 自动递增序号 |
| B | 同步时间 | 文本 | 格式：YYYY-MM-DD HH:mm:ss |
| C | 名称 | 文本 | 条目的中文/日文名称 |
| D | URL | 文本 | Bangumi条目链接 |
| E | SID | 文本 | 条目在Bangumi的数字ID |
| F | 条目类型 | 数字 | 1=书籍 2=动画 3=音乐 4=游戏 6=真人剧 |
| G | 次数 | 数字 | 累计同步次数 |
| H | 内容 | 文本 | 本次同步的Payload摘要 |
| I | 状态 | 文本 | 成功/失败/跳过/已收藏 |
| J | 备注 | 文本 | 错误信息或其他备注 |

#### 缓存优化机制

为避免频繁读取Excel降低性能，实现了内存缓存：

```typescript
let _syncRecordSidCache = new Map<string, number>();  // SID -> 行号
let _syncRecordListCache: SyncRecord[] = [];           // 完整记录列表
let _syncRecordCacheValid = false;                     // 缓存有效标志

function buildCache(sheet: any): void { /* 构建缓存 */ }
function invalidateCache(): void { /* 使缓存失效 */ }
```

#### 关键函数

| 函数名 | 功能 |
|--------|------|
| `getOrCreateSyncRecordSheet()` | 获取或新建「同步记录」工作表 |
| `addSyncRecord()` | 添加或更新一条同步记录 |
| `getAllSyncRecords()` | 获取所有同步记录（从缓存） |
| `clearSyncRecords()` | 清除所有同步记录 |
| `openSyncRecordSheet()` | 切换到同步记录工作表 |

---

## 工具模块详解

### 1. HTTP请求模块 (ts/tools/http.ts)

**文件路径**：[http.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/http.ts)

**核心职责**：封装XMLHttpRequest，提供统一HTTP请求能力，支持自动重试和限流处理。

#### 核心函数

```typescript
// 通用HTTP请求（支持所有HTTP方法）
httpRequest<T>(
  endpoint: string,
  options?: {
    method?: HttpMethod;           // GET/POST/PUT/DELETE/PATCH
    body?: string | null;         // 请求体
    token?: string;               // Bearer Token
    timeout?: number;             // 超时时间（毫秒）
    retries?: number;             // 重试次数
    onProgress?: (current, total) => void; // 进度回调
  }
): Promise<Result<{ status: number; data: T | null }>>

// 快捷方法
httpGet<T>(endpoint: string, token?: string): Promise<Result<...>>
httpPost<T>(endpoint: string, body: string, token?: string): Promise<Result<...>>
httpPut<T>(endpoint: string, body: string, token?: string): Promise<Result<...>>
httpDelete<T>(endpoint: string, token?: string): Promise<Result<...>>
```

#### 重试机制

当遇到以下情况时自动重试：

- HTTP 429（请求过于频繁）
- 网络错误（超时、连接失败）

重试策略采用指数退避：`等待时间 = RETRY_DELAY_BASE * 2^(尝试次数-1)`

#### 错误映射

```typescript
const statusMessages: Record<number, string> = {
  400: '请求参数错误',
  401: 'Token无效或已过期',
  403: '没有权限访问该资源',
  404: '请求的资源不存在',
  429: '请求过于频繁，已被限流',
  500: '服务器内部错误',
  502: '网关错误',
  503: '服务暂时不可用'
};
```

---

### 2. 通用工具模块 (ts/tools/util.ts)

**文件路径**：[util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)

**核心职责**：提供各类通用工具函数，以及维护BGM全局命名空间对象。

#### BGM 全局对象

```typescript
export const BGM: {
  // 缓存数据
  cache: {
    totalRows: number;
    userId: string | null;
    username: string | null;
    sidCache: Map<string, any>;
    listCache: any[];
  };

  // 工作表锁定状态
  sheet: {
    lockedIndex: number | null;   // 锁定的Sheet索引
    lockedName: string | null;    // 锁定的Sheet名称
    isLocked: boolean;            // 是否已锁定
  };

  // 同步运行状态
  sync: {
    isRunning: boolean;           // 是否正在同步
    lastSyncTime: string;         // 上次同步时间
  };

  // 日志系统
  LOG_LEVELS: typeof LOG_LEVELS;
  LOG_LEVEL: number;

  // 对话框接口
  Dialog: {
    alert(title: string, message: string): void;
    confirm(message: string, onConfirm?: () => void, onCancel?: () => void): void;
    error(title: string, message: string): void;
    input(title: string, prompt: string, defaultValue?: string, onOk?: (value: string) => void, onCancel?: () => void): void;
    show(type: 'alert' | 'confirm' | 'error' | 'input', title: string, message: string, options?: DialogOptions): void;
  };

  // 消息通信
  Message: {
    send(data: Record<string, unknown>, targetOrigin?: string): boolean;
    postMessage(data: Record<string, unknown>, targetOrigin?: string): boolean;
  };

  // 错误处理
  handleError(error: unknown, options?: ErrorOptions): BgmError;
  safeExecute<T>(fn: () => T, context?: string, options?: ErrorOptions): T | BgmError;
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
| `fetchBgmUserInfo()` | 异步获取用户信息 |

---

### 3. 事件总线模块 (ts/tools/events.ts)

**文件路径**：[events.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/events.ts)

**核心职责**：实现模块间的松耦合通信，替代直接函数调用。

#### 事件系统设计

采用发布-订阅模式，模块间通过事件进行通信，无需直接依赖。

```typescript
// 事件类型定义
type EventHandler = (data?: any) => void;

// 事件总线接口
interface EventBus {
  on(event: string, handler: EventHandler): () => void;  // 订阅事件
  off(event: string, handler: EventHandler): void;        // 取消订阅
  emit(event: string, data?: any): void;                   // 发布事件
  once(event: string, handler: EventHandler): () => void; // 单次订阅
}
```

#### 预定义事件

| 事件名 | 触发时机 | 数据载荷 |
|--------|----------|----------|
| `sync:start` | 开始同步时 | `{ sheetIndex, sheetName }` |
| `sync:progress` | 同步进度更新 | `{ current, total, message }` |
| `sync:complete` | 同步完成时 | `{ success, fail, skip }` |
| `sync:error` | 同步出错时 | `{ error: BgmError }` |
| `token:updated` | Token更新后 | `{ valid: boolean }` |
| `userid:updated` | UserID更新后 | `{ userId: string }` |

---

### 4. WPS类型定义 (ts/tools/wps.ts)

**文件路径**：[wps.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/wps.ts)

**核心职责**：为WPS Office的COM对象提供TypeScript类型定义和类型守卫。

#### 类型守卫函数

```typescript
// 判断是否为WPS Application对象
function isWpsApp(obj: unknown): obj is WpsApplication

// 判断是否为WPS Worksheet对象
function isWpsWorksheet(obj: unknown): obj is WpsWorksheet

// 判断是否为WPS Range对象
function isWpsRange(obj: unknown): obj is WpsRange
```

#### 主要类型定义

```typescript
interface WpsApplication {
  ActiveWorkbook: WpsWorkbook;
  Sheets: WpsSheets;
  Enum: typeof WPS_ENUM;
  PluginStorage: WpsPluginStorage;
  InputBox(prompt: string, title?: string, default?: any, type?: number): any;
}

interface WpsWorkbook {
  ActiveSheet: WpsWorksheet;
  Worksheets: WpsWorksheets;
}

interface WpsWorksheet {
  Name: string;
  Range(reference: string): WpsRange;
  Cells(row: number, col: number): WpsRange;
  Rows: WpsRows;
  Columns: WpsColumns;
  AutoFilter: WpsAutoFilter;
}

interface WpsRange {
  Value2: any;
  Interior: WpsInterior;
  Font: WpsFont;
  Row: number;
  Column: number;
  Activate(): void;
}
```

---

## UI模块详解

### 1. 对话框组件 (ts/ui/dialog.ts)

**文件路径**：[dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts)

**核心职责**：提供统一的对话框和提示组件。

#### 主要函数

| 函数名 | 功能 | 返回值 |
|--------|------|--------|
| `showAlert()` | 显示警告对话框 | Promise |
| `showConfirm()` | 显示确认对话框（支持回调） | void |
| `showError()` | 显示错误对话框 | Promise |
| `showSuccess()` | 显示成功提示 | Promise |
| `showInput()` | 显示输入对话框 | Promise\<string\> |
| `showToast()` | 显示轻提示（自动消失） | void |
| `showConfirmDialog()` | 确认对话框（别名） | Promise |

---

### 2. 事件处理器 (ts/ui/handlers.ts)

**文件路径**：[handlers.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts)

**核心职责**：处理用户交互事件，包括Token设置、用户ID设置、标记操作等。

#### 主要函数

| 函数名 | 功能 |
|--------|------|
| `showUserIdDialog()` | 弹出用户ID设置对话框 |
| `showTokenDialog()` | 弹出Token设置对话框 |
| `markUploadedItems()` | 标记已上传的条目 |
| `clearSheetMarks()` | 清除工作表的颜色标记 |
| `updateTokenStatus()` | 更新Token状态显示 |
| `updateUserIdStatus()` | 更新UserID状态显示 |

---

### 3. 消息通信 (ts/ui/message.ts)

**文件路径**：[message.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/message.ts)

**核心职责**：处理主窗口与任务窗格（WebView）之间的postMessage通信。

#### 主要函数

| 函数名 | 功能 |
|--------|------|
| `initMessageListener()` | 初始化消息监听器 |
| `setStatus()` | 设置状态栏消息 |

---

### 4. 数据预览 (ts/ui/preview.ts)

**文件路径**：[preview.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts)

**核心职责**：生成数据预览HTML和详情弹窗。

#### 主要函数

| 函数名 | 功能 |
|--------|------|
| `previewSyncContent()` | 生成并显示同步内容预览 |
| `closeDetailModal()` | 关闭详情弹窗 |

#### 预览数据类型

```typescript
interface DetailItem {
  row: number;
  values: Record<string, string>;
}

interface PreviewItem {
  row: number;
  html: string;           // 渲染后的HTML
  type: 'header' | 'data';
}

interface DetailPreviewData {
  items: DetailItem[];
  total: number;
  headers: string[];
}
```

---

## 入口与界面模块

### 1. 统一导出入口 (ts/index.ts)

**文件路径**：[index.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/index.ts)

**核心职责**：集中导出所有模块的公共API，方便其他文件统一导入。

**导出结构**：

```typescript
// 从 core/constants.js 导出
export { BGM_CONFIG, BGM_COLOR, XL, LOG_LEVELS, PANEL_CONFIG, ... }

// 从 core/result.js 导出
export { BgmError, Result }

// 从 core/crypto.js 导出
export { encryptToken, decryptToken, calcChecksum, ... }

// 从 tools/http.js 导出
export { httpRequest, httpGet, httpPost, ... }

// 从 tools/util.js 导出
export { getApp, bgmLog, BGM, storeBgToken, ... }

// 从 sync/*.js 导出
export { SyncToBangumi, fetchAllUserCollections, addSyncRecord, ... }

// 从 ui/*.js 导出
export { showAlert, showConfirm, showToast, ... }
```

**使用方式**：

```typescript
// 推荐：从 index.ts 统一导入
import { Result, BGM_CONFIG, httpGet, SyncToBangumi } from './index.js';

// 而不是：从各子模块分别导入
import { BGM_CONFIG } from './core/constants.js';
import { httpGet } from './tools/http.js';
```

---

### 2. 功能区回调 (ts/ribbon.ts)

**文件路径**：[ribbon.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ribbon.ts)

**核心职责**：处理WPS功能区（Ribbon）按钮的点击事件。

#### 按钮配置 (ribbon.xml)

```xml
<tab id="wpsAddinTab" label="Bangumi同步">
  <group id="bangumiGroup" label="Bangumi">
    <button id="btnShowPanel" label="打开同步面板" />
    <button id="btnSyncBangumi" label="全面同步" />
    <button id="btnSetToken" label="设置Token" />
    <button id="btnTestToken" label="测试Token" />
    <button id="btnSetUserId" label="设置用户ID" />
    <button id="btnOpenCollection" label="打开收藏页" />
    <button id="btnClearColors" label="清除标记" />
  </group>
</tab>
```

#### 回调函数

| 函数名 | 触发时机 | 职责 |
|--------|----------|------|
| `OnAddinLoad()` | 加载项加载时 | 初始化ribbonUI和枚举 |
| `OnAction()` | 按钮点击时 | 分发到对应处理函数 |
| `GetBangumiImage()` | 获取按钮图标 | 返回SVG图标路径 |

#### OnAction 分发逻辑

```typescript
export function OnAction(control: { Id: string }): boolean {
  switch (control.Id) {
    case 'btnShowPanel': showBangumiPanel(); break;
    case 'btnSyncBangumi': SyncToBangumi?.(); break;
    case 'btnSetToken': /* 设置Token */ break;
    case 'btnTestToken': /* 测试Token */ break;
    case 'btnSetUserId': /* 设置UserID */ break;
    case 'btnOpenCollection': openUserCollection(); break;
    case 'btnClearColors': clearRowColors?.(); break;
  }
}
```

---

### 3. 任务窗格 (ts/taskpane.ts)

**文件路径**：[taskpane.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/taskpane.ts)

**核心职责**：实现任务窗格的UI交互逻辑，包括工作表选择、表头检测、数据预览等。

#### 核心功能流程

```
initPanel()
     │
     ├─▶ initMessageListener()      // 初始化消息监听
     ├─▶ restoreLockedSheet()       // 恢复上次锁定的工作表
     ├─▶ refreshSheets()           // 刷新工作表列表
     ├─▶ autoDetectSheet()         // 自动检测最佳工作表
     └─▶ refreshData()             // 刷新数据预览
```

#### 表头检测算法

```typescript
function detectHeaderAndColumns(ws: any, opts): HeaderMeta {
  // 1. 扫描前N行，统计每行的关键字匹配数
  // 2. 匹配数>=3的行候选为表头行
  // 3. 按列数降序、匹配数降序、行号升序排序
  // 4. 取最优候选作为表头行
  // 5. 读取表头各列名称
  // 6. 识别第一行和第二行是否为双层表头
  // 7. 确定数据起始行
}
```

#### 筛选状态检测

```typescript
function detectFilterState(ws: any): FilterState {
  // 1. 检查AutoFilterMode是否为true
  // 2. 使用SpecialCells(12)获取可见单元格
  // 3. 提取所有可见行的行号
  // 4. 回退方案：逐行检查Rows.Hidden属性
}
```

#### 关键函数

| 函数名 | 功能 |
|--------|------|
| `initPanel()` | 初始化任务窗格 |
| `refreshData()` | 刷新数据预览 |
| `refreshSheets()` | 刷新工作表下拉列表 |
| `toggleSheetLock()` | 切换工作表锁定状态 |
| `autoDetectSheet()` | 自动检测最佳工作表 |
| `detectHeaderAndColumns()` | 检测表头和列信息 |
| `detectFilterState()` | 检测筛选状态 |
| `updateFilterStatus()` | 更新筛选状态显示 |
| `renderPreviewTable()` | 渲染预览表格HTML |

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
     ├──▶ http.ts (依赖 constants.ts, result.ts)
     │         │
     │         └──▶ util.ts (BGM对象)
     │
     ├──▶ util.ts (依赖 constants.ts, result.ts, crypto.ts, wps.ts)
     │
     ├──▶ events.ts (无依赖)
     │
     ├──▶ wps.ts (无依赖)
     │
     ├──▶ exceltobangumi.ts (依赖 constants.ts, util.ts, http.ts, dialog.ts, result.ts)
     │         │
     │         └──▶ scraping.ts
     │
     ├──▶ scraping.ts (依赖 http.ts, util.ts)
     │
     ├──▶ syncRecord.ts (依赖 constants.ts, util.ts)
     │
     ├──▶ dialog.ts (无依赖)
     │
     ├──▶ handlers.ts (依赖 util.ts, dialog.ts, syncRecord.ts)
     │
     ├──▶ message.ts (无依赖)
     │
     ├──▶ preview.ts (无依赖)
     │
     ├──▶ ribbon.ts (依赖 constants.ts, util.ts, exceltobangumi.ts, handlers.ts)
     │
     └──▶ taskpane.ts (依赖 constants.ts, util.ts, exceltobangumi.ts, message.ts, handlers.ts, dialog.ts, preview.ts, syncRecord.ts)
```

### 配置文件依赖

```
package.json
     │
     ├──▶ tsconfig.json ──▶ tsconfig.build.json
     │
     └──▶ vite.config.js

tsconfig.json
     │
     └──▶ 定义编译选项、路径别名、类型查找路径

vite.config.js
     │
     ├──▶ 依赖 vite、vite-plugin-static-copy
     │
     └──▶ 配置静态资源复制：manifest.xml, ribbon.xml, images/*, ui/*, main.js
```

### NPM依赖关系

**devDependencies**（开发依赖）：

| 依赖包 | 版本 | 用途 |
|--------|------|------|
| typescript | ^6.0.3 | TypeScript编译器 |
| vite | ^6.0.0 | 构建工具和开发服务器 |
| vite-plugin-static-copy | ^4.1.0 | 静态文件复制插件 |
| wpsjs | latest | WPS加载项开发工具 |
| et-jsapi-declare | latest | ET(Jia) API类型声明 |
| concurrently | ^9.2.1 | 并行运行多个npm脚本 |

---

## 项目运行方式

### 环境准备

#### 系统要求

- **操作系统**：Windows 7/8/10/11
- **办公软件**：WPS Office 2016及以上版本
- **运行时**：Node.js 18.x 或更高版本

#### 安装步骤

```bash
# 1. 克隆或下载项目代码
cd BGM

# 2. 安装依赖
npm install

# 3. 验证安装
npm run build:ts
```

### 开发模式

```bash
# 启动TypeScript编译监听 + WPS调试模式
npm run debug
```

**说明**：此命令会同时运行两个进程：
1. TypeScript编译器监听文件变化，自动重新编译
2. WPS加载项调试服务器

### 生产构建

```bash
# 构建生产版本
npm run build

# 仅编译TypeScript
npm run build:ts
```

**构建产物位置**：`dist/` 目录

### 常用命令

| 命令 | 功能 |
|------|------|
| `npm run dev` | 启动Vite开发服务器（端口3889） |
| `npm run build` | 执行完整构建（TS编译 + Vite打包） |
| `npm run build:ts` | 仅编译TypeScript到dist-ts |
| `npm run debug` | 启动调试模式 |
| `npm run lint` | 运行ESLint代码检查 |
| `npm run format` | 运行Prettier代码格式化 |

### 加载项部署

1. 构建完成后，将 `dist/` 目录打包
2. 在WPS中打开「插入」→「应用」→「本地安装」
3. 选择打包后的 `manifest.xml` 文件
4. 加载成功后，功能区会出现「Bangumi同步」标签页

---

## 关键类与函数参考

### Result<T> 类型系统

```typescript
// 创建成功结果
const successResult = Result.ok<User>(userData);

// 创建失败结果
const failResult = Result.fail<User>(new BgmError('Not found', 'USER_NOT_FOUND'));

// 判断和处理
if (result.isOk()) {
  const data = result.unwrap();  // 获取数据
} else {
  const error = result.error;   // 处理错误
}

// 链式转换
const nameResult = result.map(user => user.name);

// 获取或默认值
const userId = result.unwrapOr({ id: 0 }).id;
```

### BGM 全局对象使用

```typescript
// 日志记录
BGM.handleError(error, { level: ErrorLevel.ERROR, context: '同步失败' });

// 安全执行
const result = BGM.safeExecute(() => {
  return someOperation();
}, '操作描述');

// 对话框
BGM.Dialog.alert('标题', '内容');
BGM.Dialog.confirm('确定继续？', () => doSomething());
BGM.Dialog.input('输入', '请输入内容', '', (value) => useValue(value));

// 消息通信
BGM.Message.send({ type: 'sync:complete' });
```

### HTTP请求模式

```typescript
// GET请求
const result = await httpGet<UserInfo>('/v0/me', token);
if (result.isOk()) {
  console.log(result.unwrap());
}

// POST请求
const payload = JSON.stringify({ type: 3, rate: 8 });
const postResult = await httpPost('/v0/users/-/collections/123', payload, token);

// 通用请求
const genericResult = await httpRequest({
  endpoint: '/v0/some/endpoint',
  method: 'PUT',
  body: jsonPayload,
  token: accessToken,
  retries: 3,
  onProgress: (loaded, total) => updateProgress(loaded / total)
});
```

### 同步记录操作

```typescript
// 获取或创建同步记录工作表
const sheet = getOrCreateSyncRecordSheet();

// 添加同步记录
addSyncRecord({
  name: '某动画',
  url: 'https://bgm.tv/subject/123',
  sid: '123',
  type: '2',
  status: SYNC_STATUS.SUCCESS,
  message: '同步成功'
});

// 获取所有记录
const records = getAllSyncRecords();

// 清除记录
clearSyncRecords();
```

### Excel操作工具

```typescript
// 获取Application
const app = getApp();

// 列号转字母
const colLetter = colNumToLetter(27);  // 返回 'AA'

// 读取单元格
const value = readCell(worksheet, row, col);

// 设置单元格
setCellValue(worksheet, row, col, '新值');

// 获取最后数据行
const lastRow = getLastRow(worksheet);
```

---

## 问题与优化建议

### 一、当前存在的问题

#### 1. 安全性问题

**问题描述**：
- Token加密密钥硬编码在源代码中（crypto.ts的KEY_BYTES）
- XOR加密强度较低，可被轻易逆向
- 缺少Token过期检测机制

**优化建议**：
```typescript
// 建议1：使用系统密钥链存储
import { keytar } from 'keytar';
const token = await keytar.getPassword('BGM-Addon', 'bgm-token');

// 建议2：添加Token过期检测
interface TokenInfo {
  token: string;
  expiresAt: number;  // 过期时间戳
  userId: string;
}
```

#### 2. 性能问题

**问题描述**：
- 同步采用逐行处理，为防止限流设置800ms间隔
- 大量数据同步耗时长，用户体验差
- 缓存机制仅在syncRecord模块实现，其他模块未使用

**优化建议**：
```typescript
// 建议1：智能批量处理（需Bangumi API支持）
const batchSize = 25;  // 每批处理数量
const batchDelay = 1000;  // 批次间延迟

// 建议2：增量同步
interface SyncState {
  lastSyncTime: string;
  lastSyncRow: number;
  changedSids: Set<string>;
}

// 建议3：添加进度预估
function estimateSyncTime(totalRows: number): string {
  const perItemTime = 850;  // 包括请求间隔
  const totalMs = totalRows * perItemTime;
  return formatDuration(totalMs);
}
```

#### 3. 代码质量问题

**问题描述**：
- 缺少单元测试和集成测试
- 部分函数缺少JSDoc注释
- 存在类型断言（as）使用不规范的情况

**优化建议**：
```typescript
// 建议1：添加单元测试
describe('exceltobangumi', () => {
  it('should extract subject ID from URL', () => {
    expect(extractSubjectId('https://bgm.tv/subject/123456')).toBe('123456');
  });
});

// 建议2：完善类型定义
interface SyncOptions {
  onProgress?: (current: number, total: number, message: string) => void;
  onItemComplete?: (row: number, success: boolean, result: SyncResult) => void;
  dryRun?: boolean;  // 模拟运行，不实际发送请求
}
```

#### 4. 错误处理问题

**问题描述**：
- 部分API调用缺少错误处理
- 错误信息不够详细，不利于调试
- 没有统一的错误恢复策略

**优化建议**：
```typescript
// 建议：实现错误恢复策略
interface RetryPolicy {
  maxRetries: number;
  backoffMultiplier: number;
  shouldRetry: (error: BgmError) => boolean;
}

const defaultPolicy: RetryPolicy = {
  maxRetries: 3,
  backoffMultiplier: 2,
  shouldRetry: (error) => ['NETWORK_ERROR', 'RATE_LIMIT'].includes(error.code)
};
```

### 二、功能增强建议

#### 1. 同步预览功能

在执行同步前，先显示将要同步的数据预览，让用户确认：

```typescript
interface SyncPreview {
  totalItems: number;
  items: Array<{
    row: number;
    name: string;
    currentStatus: string;
    newStatus: string;
    willChange: boolean;
  }>;
  warnings: string[];
}
```

#### 2. 冲突检测与解决

当Excel数据与Bangumi数据不一致时，提供冲突解决选项：

```typescript
interface ConflictItem {
  row: number;
  sid: string;
  excelValue: FieldValue;
  bgmValue: FieldValue;
}

type ConflictResolution = 'keep_excel' | 'keep_bgm' | 'merge' | 'ask';
```

#### 3. 增量同步模式

只同步自上次同步以来发生变化的数据：

```typescript
interface IncrementalSync {
  lastSyncTimestamp: string;
  changedRows: SyncChange[];
}

interface SyncChange {
  row: number;
  field: string;
  oldValue: any;
  newValue: any;
  changeType: 'add' | 'update' | 'delete';
}
```

#### 4. 多账户支持

支持管理多个Bangumi账户：

```typescript
interface Account {
  id: string;
  name: string;
  token: string;
  userId: string;
}

class AccountManager {
  accounts: Account[];
  activeAccountId: string;

  addAccount(account: Account): void;
  removeAccount(id: string): void;
  switchAccount(id: string): void;
}
```

#### 5. 同步报告导出

生成详细的同步报告：

```typescript
interface SyncReport {
  startTime: string;
  endTime: string;
  duration: number;
  totalRows: number;
  successCount: number;
  failCount: number;
  skipCount: number;
  errors: Array<{ row: number; sid: string; error: string }>;
  summary: string;
}

function exportReport(report: SyncReport, format: 'json' | 'csv' | 'html'): void
```

### 三、架构优化建议

#### 1. 引入状态管理

当前UI状态分散在各个模块，建议引入集中式状态管理：

```typescript
// 使用Zustand或Redux Toolkit
import { create } from 'zustand';

interface AppState {
  token: string | null;
  userId: string | null;
  lockedSheet: { index: number; name: string } | null;
  syncProgress: { current: number; total: number };
  // ...
}

export const useStore = create<AppState>((set) => ({
  token: null,
  setToken: (token) => set({ token }),
  // ...
}));
```

#### 2. 事件总线规范化

建议定义更完善的事件系统：

```typescript
// 事件总线类型定义
interface TypedEventBus {
  on<E extends keyof BgmEvents>(event: E, handler: BgmEvents[E]): () => void;
  emit<E extends keyof BgmEvents>(event: E, data: Parameters<BgmEvents[E]>[0]): void;
}

// 预定义事件类型
interface BgmEvents {
  'sync:start': (data: { sheetIndex: number }) => void;
  'sync:progress': (data: { current: number; total: number }) => void;
  'sync:complete': (data: { results: SyncResults }) => void;
  'sync:error': (data: { error: BgmError }) => void;
}
```

#### 3. 配置外部化

将硬编码的配置值提取到外部配置文件：

```typescript
// config.json
{
  "api": {
    "baseUrl": "https://api.bgm.tv",
    "requestDelay": 800,
    "maxRetries": 3
  },
  "sync": {
    "batchSize": 25,
    "previewLimit": 8
  },
  "ui": {
    "panelWidth": 400,
    "theme": "light"
  }
}
```

#### 4. 依赖注入容器

降低模块间耦合，使用依赖注入：

```typescript
// 简单的DI容器示例
class Container {
  private services = new Map();

  register<T>(token: string, factory: () => T): void {
    this.services.set(token, factory);
  }

  resolve<T>(token: string): T {
    const factory = this.services.get(token);
    if (!factory) throw new Error(`Service not found: ${token}`);
    return factory();
  }
}
```

### 四、测试建议

#### 1. 单元测试覆盖

建议为以下模块添加单元测试：

- `exceltobangumi.ts`：表头识别、字段映射、状态转换
- `crypto.ts`：加密解密正确性、校验和验证
- `http.ts`：请求构建、错误处理、重试逻辑
- `syncRecord.ts`：缓存机制、记录增删改查

#### 2. 集成测试场景

- 完整的同步流程（模拟WPS环境）
- Token验证流程
- 错误恢复流程

#### 3. E2E测试

使用Playwright或Cypress测试完整的用户操作流程。

### 五、文档改进建议

#### 1. API文档

建议使用TypeDoc自动生成API文档：

```bash
npm install --save-dev typedoc
npx typedoc --out docs/api ts/
```

#### 2. 用户手册

补充面向终端用户的操作手册，包括：

- 如何获取Bangumi API Token
- 推荐的Excel表格格式
- 常见问题解答

#### 3. 开发者指南

补充开发相关文档：

- 如何添加新的同步字段
- 如何扩展新的API端点
- 如何调试和测试

---

## 版本历史

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| 1.0.0 | - | 初始版本发布 |
| 当前 | 2026-05-09 | 完成Code Wiki文档编写 |

---

## 参考资料

### 外部资源

- [Bangumi API 文档](https://bangumi.github.io/api/)
- [Bangumi 开发者中心](https://bgm.tv/dev/app)
- [WPS加载项开发文档](https://open.wps.cn/docs/office/)
- [TypeScript 官方文档](https://www.typescriptlang.org/docs/)
- [Vite 官方文档](https://vitejs.dev/)

### 项目内文档

- [代码审查报告](./代码审查报告.md)
- [代码审查报告v4](./代码审查报告_v4.md)
- [代码审查报告v5](./代码审查报告_v5.md)

---

**文档信息**

- **编写日期**：2026-05-09
- **文档版本**：1.0
- **维护者**：项目开发团队
- **许可协议**：MIT License
