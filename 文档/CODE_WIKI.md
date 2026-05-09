# Bangumi同步助手 - 代码维基文档

## 目录
- [项目概述](#项目概述)
- [项目架构](#项目架构)
- [核心模块](#核心模块)
- [关键类与函数](#关键类与函数)
- [配置与依赖](#配置与依赖)
- [开发指南](#开发指南)
- [常见问题与优化建议](#常见问题与优化建议)

---

## 项目概述

### 项目简介
Bangumi同步助手是一个 WPS Excel 加载项，用于将 Excel 表格中的番剧/动画数据批量同步到 [Bangumi](https://bgm.tv) 网站的个人收藏中。该工具支持：

- **双向同步**：Excel → Bangumi 和 Bangumi → Excel
- **智能识别**：自动识别表头和数据结构
- **批量操作**：支持筛选可见行数据同步
- **进度显示**：同步过程实时进度反馈
- **同步记录**：自动创建同步历史记录工作表
- **Token管理**：加密存储 Bangumi API Token

### 技术栈
- **开发语言**：TypeScript 6+
- **构建工具**：Vite 6
- **运行环境**：WPS Office（Excel）
- **API服务**：Bangumi API v0

### 项目目录结构
```
BGM/
├── ts/                          # TypeScript 源代码目录
│   ├── core/                    # 核心模块
│   │   ├── constants.ts         # 常量定义
│   │   ├── crypto.ts            # 加密模块
│   │   └── result.ts            # 结果类型
│   ├── sync/                    # 同步模块
│   │   ├── exceltobangumi.ts    # Excel→Bangumi同步
│   │   ├── scraping.ts          # Bangumi→Excel同步
│   │   └── syncRecord.ts        # 同步记录管理
│   ├── tools/                   # 工具模块
│   │   ├── http.ts              # HTTP请求
│   │   ├── util.ts              # 通用工具
│   │   └── wps.ts               # WPS类型定义
│   ├── ui/                      # UI模块
│   │   ├── dialog.ts            # 对话框组件
│   │   ├── handlers.ts          # 事件处理器
│   │   ├── message.ts           # 消息通信
│   │   └── preview.ts           # 预览模块
│   ├── index.ts                 # 统一导出入口
│   ├── ribbon.ts                # 功能区回调
│   └── taskpane.ts              # 任务面板
├── ui/                          # UI资源
│   └── taskpane.html            # 任务面板HTML
├── css/                         # 样式文件
├── images/                      # 图标资源
├── docs/                        # 文档
├── dist-ts/                     # TypeScript编译输出
├── dist/                        # Vite构建输出
├── package.json                 # 项目配置
├── tsconfig.json                # TypeScript配置
├── vite.config.js               # Vite配置
├── manifest.xml                 # WPS加载项清单
└── ribbon.xml                   # 功能区配置
```

---

## 项目架构

### 整体架构图
```
┌─────────────────────────────────────────────────────────────┐
│                        WPS Excel                             │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌───────────────────────────────────┐  │
│  │  Ribbon UI   │───▶│  ribbon.ts (功能区回调)           │  │
│  └──────────────┘    └───────────────────────────────────┘  │
│         │                                                  │  │
│         ▼                                                  │  │
│  ┌──────────────┐    ┌───────────────────────────────────┐  │
│  │  Taskpane UI │───▶│  taskpane.ts (任务面板逻辑)        │  │
│  └──────────────┘    └───────────────────────────────────┘  │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    业务逻辑层                                 │
│  ┌───────────────────┐  ┌───────────────────────────────┐  │
│  │  exceltobangumi   │  │       scraping.ts             │  │
│  │  (Excel→Bangumi)  │  │      (Bangumi→Excel)          │  │
│  └───────────────────┘  └───────────────────────────────┘  │
│  ┌───────────────────┐  ┌───────────────────────────────┐  │
│  │   syncRecord.ts   │  │        index.ts               │  │
│  │  (同步记录管理)   │  │      (统一导出入口)           │  │
│  └───────────────────┘  └───────────────────────────────┘  │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                   工具与核心层                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ http.ts │ │ util.ts │ │ crypto  │ │result.ts│          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
│  ┌───────────────────────────────────────────────────┐     │
│  │              constants.ts (常量)                   │     │
│  └───────────────────────────────────────────────────┘     │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                   UI组件层                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  dialog  │ │handlers  │ │ message  │ │ preview  │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                     Bangumi API                              │
│              https://api.bgm.tv/v0/...                       │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

#### Excel → Bangumi 同步流程
```
1. 用户在Excel中准备数据
2. 选择工作表（或自动检测）
3. 解析表头 → 获取列映射
4. 逐行提取数据（支持筛选可见行）
5. 构建API请求Payload
6. 通过http.ts调用Bangumi API
7. 记录同步结果到「同步记录」工作表
8. 标记原数据行颜色（成功/失败/跳过）
```

#### Bangumi → Excel 同步流程
```
1. 用户设置Token和UserID
2. 调用/scraping.ts获取用户收藏
3. 解析API返回数据
4. 在Excel中创建/填充数据
5. 记录同步历史
```

---

## 核心模块

### 1. 核心模块 (`ts/core/`)

#### constants.ts - 常量定义
**职责**：统一定义项目所有常量，避免硬编码分散在各处。

**主要常量**：
- `WPS_ENUM`: WPS Office枚举值
- `XL`: Excel常量（如xlUp、xlDown等）
- `BGM_CONFIG`: Bangumi API配置（基础URL、重试次数等）
- `BGM_COLOR`: Excel单元格颜色常量
- `TOKEN_CONFIG`: Token加密配置
- `LOG_LEVELS`: 日志级别（DEBUG/INFO/WARN/ERROR）
- `PANEL_CONFIG`: 任务面板配置（扫描行列限制等）
- `BGM_SUBJECT_TYPES`: 条目类型映射（1=书籍, 2=动画等）
- `SYNC_STATUS`: 同步状态常量

**关键常量值**：
```typescript
BGM_CONFIG = {
  API_BASE: "https://api.bgm.tv",
  REQUEST_DELAY: 800,          // 请求间隔（ms）
  MAX_RETRIES: 3,              // 最大重试次数
  RETRY_DELAY_BASE: 2000       // 重试等待基础时间
}
```

#### result.ts - 结果类型
**职责**：统一的操作结果类型和错误处理机制。

**核心类**：
- `BgmError`: 继承自Error，增加code、details、timestamp
- `Result<T>`: 泛型结果类，包装成功/失败状态

**Result 常用方法**：
```typescript
Result.ok<T>(data: T)           // 创建成功结果
Result.fail<T>(error: BgmError) // 创建失败结果
result.isOk()                   // 检查是否成功
result.unwrap()                 // 获取数据（失败则抛错）
result.unwrapOr(defaultValue)   // 获取数据或默认值
```

#### crypto.ts - 加密模块
**职责**：安全加密存储用户的Bangumi Token。

**主要功能**：
- `calcChecksum()`: 计算校验和
- `encryptToken()`: 加密Token
- `decryptToken()`: 解密Token
- `extractToken()`: 从加密字符串中提取Token

**安全机制**：
- AES加密 + 备用XOR加密方案
- 带版本前缀和校验和
- 密钥硬编码在代码中（非生产环境最佳实践）

---

### 2. 同步模块 (`ts/sync/`)

#### exceltobangumi.ts - Excel→Bangumi同步
**职责**：核心同步引擎，处理从Excel读取数据并同步到Bangumi。

**核心功能**：
- **表头识别**：自动检测表头行和列映射
- **数据提取**：从Excel行提取条目信息
- **API调用**：构建Payload并调用Bangumi API
- **状态标记**：通过颜色标记同步结果
- **进度回调**：支持进度更新回调

**主要函数**：

| 函数名 | 说明 |
|--------|------|
| `findHeaderRow()` | 查找表头行 |
| `getColumnMap()` | 获取列名到字段的映射 |
| `getLastRow()` | 获取最后数据行 |
| `extractSubjectId()` | 从URL或文本提取条目ID |
| `mapWatchStatus()` | 映射观看状态文本到API值 |
| `buildJsonPayload()` | 构建API请求JSON |
| `bgmRequestSync()` | 发送同步请求 |
| `SyncToBangumi()` | 主同步入口函数 |
| `clearRowColors()` | 清除行颜色标记 |
| `testSingleUpdate()` | 测试单个条目的更新 |

**表头关键字**（自动识别）：
- 名称、别名、条目ID、SID、URL
- 状态、类型、观看状态
- 评分、打分、标签
- 感言、剧透/感言、备注
- 开播时间、完播日期

**观看状态映射**：
| Excel文本 | Bangumi值 |
|-----------|----------|
| 看过/看完/已看/完 | 3 |
| 在看/在看动画/在追/追 | 2 |
| 想看/想看动画/否/想看 | 0 |
| 搁置/暂停/停 | 4 |
| 抛弃/弃/弃番 | 5 |

#### scraping.ts - Bangumi→Excel同步
**职责**：从Bangumi API获取用户收藏并同步到Excel。

**主要函数**：
- `verifyToken()`: 验证Token有效性
- `fetchAllUserCollections()`: 获取用户所有收藏（分页）

**API端点**：
- `GET /v0/me` - 获取当前用户信息
- `GET /v0/users/{user_id}/collections` - 获取用户收藏

#### syncRecord.ts - 同步记录管理
**职责**：管理「同步记录」工作表，记录所有同步操作历史。

**核心功能**：
- 自动创建/获取「同步记录」工作表
- 缓存机制优化读取性能
- 支持新增和更新记录
- 按SID去重（同一SID只保留最新记录）
- 记录同步次数和颜色标记

**主要函数**：

| 函数名 | 说明 |
|--------|------|
| `getOrCreateSyncRecordSheet()` | 获取或创建同步记录工作表 |
| `addSyncRecord()` | 添加/更新同步记录 |
| `getAllSyncRecords()` | 获取所有同步记录 |
| `clearSyncRecords()` | 清除所有同步记录 |
| `openSyncRecordSheet()` | 打开同步记录工作表 |

**同步记录表格结构**：
| 列 | 标题 | 说明 |
|----|------|------|
| A | 序号 | 自动递增序号 |
| B | 同步时间 | 记录时间 |
| C | 名称 | 条目标题 |
| D | URL | 条目链接 |
| E | SID | 条目ID |
| F | 条目类型 | 动画/书籍等 |
| G | 次数 | 同步次数 |
| H | 内容 | 同步Payload摘要 |
| I | 状态 | 成功/失败/跳过/已收藏 |
| J | 备注 | 其他信息 |

**颜色标记**：
- 绿色（0xCCFFCC）：成功/已收藏
- 红色（0xFFCCCC）：失败
- 黄色（0xFFFFCC）：跳过
- 紫色（0x7030A0）：已收藏(1次)
- 浅绿（0x92D050）：已收藏(2次)
- 深绿（0x00B050）：已收藏(3次+)

---

### 3. 工具模块 (`ts/tools/`)

#### http.ts - HTTP请求模块
**职责**：封装Bangumi API调用，支持重试、限流、进度回调。

**核心函数**：
```typescript
httpRequest<T>(endpoint, options) // 通用HTTP请求
httpGet<T>(endpoint, token)       // GET快捷方法
httpPost<T>(endpoint, body, token)// POST快捷方法
httpPut<T>(endpoint, body, token) // PUT快捷方法
httpDelete<T>(endpoint, token)    // DELETE快捷方法
```

**特性**：
- 自动重试（429限流指数退避）
- 请求超时控制
- 进度回调支持
- 统一Result包装返回

#### util.ts - 通用工具
**职责**：提供全局工具函数和状态管理。

**主要功能**：
- `getApp()`: 获取WPS Application对象
- `colNumToLetter()`: 列号转字母（1→A，2→B...）
- `getCell()` / `getCellValue()` / `readCell()`: 安全读取单元格
- `setCellValue()`: 安全设置单元格值
- `bgmLog()`: 统一日志函数
- `escapeHtml()`: HTML转义
- `storeBgToken()` / `loadBgToken()`: Token存储/加载
- `_getBgmUserId()` / `_setBgmUserId()`: UserID管理

**全局对象 BGM**：
```typescript
BGM = {
  cache: { ... },          // 缓存数据
  sheet: { ... },          // 工作表锁定状态
  sync: { ... },           // 同步状态
  LOG_LEVELS: { ... },     // 日志级别
  Dialog: { ... },         // 对话框工具
  Message: { ... },        // 消息通信
  handleError: fn,         // 错误处理
  safeExecute: fn          // 安全执行
}
```

#### wps.ts - WPS类型定义
**职责**：提供WPS Office COM对象的TypeScript类型定义和守卫。

**类型守卫函数**：
- `isWpsApp()`: 判断是否为WPS Application
- `isWpsWorksheet()`: 判断是否为工作表
- `isWpsRange()`: 判断是否为Range对象

---

### 4. UI模块 (`ts/ui/`)

#### dialog.ts - 对话框组件
**职责**：提供统一的对话框UI组件。

**主要函数**：
- `showAlert()`: 警告对话框
- `showConfirm()`: 确认对话框
- `showError()`: 错误对话框
- `showInput()`: 输入对话框
- `showToast()`: 轻提示（Toast）

#### handlers.ts - 事件处理器
**职责**：处理用户交互事件。

**主要函数**：
- `showUserIdDialog()`: 用户ID设置对话框
- `markUploadedItems()`: 标记已上传条目
- `clearSheetMarks()`: 清除标记
- `updateTokenStatus()`: 更新Token状态显示
- `updateUserIdStatus()`: 更新UserID状态显示

#### message.ts - 消息通信
**职责**：处理任务面板与主窗口之间的消息通信。

**主要函数**：
- `initMessageListener()`: 初始化消息监听器
- `setStatus()`: 设置状态栏消息

#### preview.ts - 预览模块
**职责**：处理数据预览和详情弹窗。

**主要函数**：
- `previewSyncContent()`: 显示同步内容预览

---

### 5. 入口模块

#### index.ts - 统一导出入口
**职责**：集中导出所有模块，方便其他文件统一导入。

**导出内容**：
- 所有常量、类型、接口
- 所有工具函数
- 所有业务逻辑函数
- 全局BGM对象

**使用方式**：
```typescript
import { BGM_CONFIG, Result, httpRequest, SyncToBangumi } from './index.js'
```

#### ribbon.ts - 功能区回调
**职责**：处理WPS功能区（Ribbon）按钮的点击事件。

**功能区按钮**：
| 按钮ID | 标签 | 功能 |
|--------|------|------|
| btnShowPanel | 打开同步面板 | 显示任务面板 |
| btnSyncBangumi | 全面同步 | 执行完整同步 |
| btnSetToken | 设置Token | 输入并保存API Token |
| btnTestToken | 测试Token | 验证Token有效性 |
| btnSetUserId | 设置用户ID | 输入并保存用户ID |
| btnOpenCollection | 打开收藏页 | 跳转到Bangumi收藏页 |
| btnClearColors | 清除标记 | 清除行颜色标记 |

**回调函数**：
- `OnAddinLoad()`: 加载时初始化
- `OnAction()`: 按钮点击分发
- `GetBangumiImage()`: 获取按钮图标

#### taskpane.ts - 任务面板
**职责**：任务面板的UI逻辑和事件处理。

**主要功能**：
- 工作表选择与锁定
- 自动检测数据工作表
- 表头识别与数据预览
- 筛选状态检测
- 同步操作触发

**核心函数**：
- `initPanel()`: 初始化面板
- `refreshData()`: 刷新数据预览
- `toggleSheetLock()`: 切换工作表锁定
- `refreshSheets()`: 刷新工作表列表
- `detectHeaderAndColumns()`: 检测表头和列
- `autoDetectSheet()`: 自动检测最佳工作表
- `updateFilterStatus()`: 更新筛选状态显示

---

## 关键类与函数

### 核心函数速查表

#### 同步相关

| 函数 | 模块 | 说明 |
|------|------|------|
| `SyncToBangumi()` | sync/exceltobangumi | 主同步入口 |
| `fetchAllUserCollections()` | sync/scraping | 获取Bangumi收藏 |
| `addSyncRecord()` | sync/syncRecord | 添加同步记录 |
| `getOrCreateSyncRecordSheet()` | sync/syncRecord | 获取同步记录表 |

#### Excel操作

| 函数 | 模块 | 说明 |
|------|------|------|
| `getApp()` | tools/util | 获取WPS Application |
| `readCell()` | tools/util | 读取单元格值 |
| `getCell()` | tools/util | 获取单元格对象 |
| `colNumToLetter()` | tools/util | 列号转字母 |
| `getLastRow()` | sync/exceltobangumi | 获取最后数据行 |
| `findHeaderRow()` | sync/exceltobangumi | 查找表头行 |

#### API调用

| 函数 | 模块 | 说明 |
|------|------|------|
| `httpRequest()` | tools/http | 通用HTTP请求 |
| `httpGet()` | tools/http | GET请求 |
| `httpPost()` | tools/http | POST请求 |
| `verifyToken()` | sync/scraping | 验证Token |
| `bgmRequestSync()` | sync/exceltobangumi | 发送同步请求 |

#### UI相关

| 函数 | 模块 | 说明 |
|------|------|------|
| `showAlert()` | ui/dialog | 显示警告 |
| `showConfirm()` | ui/dialog | 显示确认 |
| `showToast()` | ui/dialog | 显示Toast |
| `refreshData()` | taskpane | 刷新预览 |
| `initPanel()` | taskpane | 初始化面板 |

### Result<T> 类详解

```typescript
class Result<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: BgmError | null;
  
  // 静态工厂方法
  static ok<T>(data: T): Result<T>;
  static fail<T>(error: BgmError): Result<T>;
  
  // 实例方法
  isOk(): boolean;
  isFail(): boolean;
  unwrap(): T;               // 失败抛错
  unwrapOr(defaultValue: T): T;
  map<U>(fn: (T) => U): Result<U>;
  mapErr(fn: (BgmError) => BgmError): Result<T>;
}
```

**使用示例**：
```typescript
const result = await httpGet<UserInfo>('/v0/me', token);
if (result.isOk()) {
  const user = result.unwrap();
  console.log(user.name);
} else {
  console.error(result.error?.message);
}

// 使用map转换
const nameResult = result.map(user => user.name);
```

### BGM全局对象详解

```typescript
BGM = {
  // 缓存数据
  cache: {
    totalRows: number;
    userId: string | null;
    username: string | null;
    sidCache: Map<string, any>;
    listCache: any[];
  },
  
  // 工作表锁定状态
  sheet: {
    lockedIndex: number | null;
    lockedName: string | null;
    isLocked: boolean;
  },
  
  // 同步运行状态
  sync: {
    isRunning: boolean;
    lastSyncTime: string;
  },
  
  // 日志系统
  LOG_LEVELS: { DEBUG, INFO, WARN, ERROR },
  LOG_LEVEL: LOG_LEVELS.INFO,
  
  // 对话框工具
  Dialog: {
    alert(title, message);
    confirm(message, onConfirm?, onCancel?);
    error(title, message);
    input(title, prompt, defaultValue?, onOk?, onCancel?);
    show(type, title, message, options?);
  },
  
  // 消息通信
  Message: {
    send(data, targetOrigin?);
    postMessage(data, targetOrigin?);
  },
  
  // 错误处理
  handleError(error, options?);
  safeExecute(fn, context?, options?);
}
```

---

## 配置与依赖

### package.json

```json
{
  "name": "test",
  "addonType": "et",
  "version": "1.0.0",
  "description": "WPS Excel 加载项 - 追番标记助手",
  "scripts": {
    "dev": "vite --port 3889",           // 开发服务器
    "build": "vite build",               // 构建打包
    "build:ts": TypeScript编译声明文件
    "debug": "WPS调试",
    "lint": "代码检查",
    "format": "格式化代码"
  },
  "devDependencies": {
    "typescript": "^6.0.3",
    "vite": "^6.0.0",
    "vite-plugin-static-copy": "^4.1.0",
    "wpsjs": "latest",
    "et-jsapi-declare": "latest",
    "concurrently": "^9.2.1"
  }
}
```

### TypeScript配置 (tsconfig.json)

```json
{
  "target": "ES2022",
  "module": "ESNext",
  "strict": true,
  "outDir": "./dist-ts",
  "rootDir": "ts/",
  "baseUrl": ".",
  "typeRoots": ["./node_modules/@types", "./dist-ts/ts"],
  "include": ["ts/"],
  "exclude": ["node_modules", "dist", "dist-ts"]
}
```

### Vite配置 (vite.config.js)

**关键配置**：
- `base: './'`: 相对路径
- `outDir: 'dist'`: 构建输出目录
- `viteStaticCopy` 插件：复制静态资源到dist

**复制的资源**：
- manifest.xml
- ribbon.xml
- images/*
- ui/*
- main.js
- wpsjsrpcsdk.js

### Bangumi API 配置

**基础URL**：`https://api.bgm.tv`

**主要端点**：
| 端点 | 方法 | 说明 |
|------|------|------|
| `/v0/me` | GET | 获取当前用户信息 |
| `/v0/users/{user_id}/collections` | GET | 获取用户收藏列表 |
| `/v0/users/-/collections/{subject_id}` | POST/PUT | 更新收藏 |
| `/v0/subjects/{subject_id}` | GET | 获取条目详情 |

**认证方式**：Bearer Token (HTTP Header: `Authorization: Bearer {token}`)

**获取Token**：https://bgm.tv/dev/app

---

## 开发指南

### 环境准备

1. **安装Node.js**：建议 v18+
2. **安装依赖**：
```bash
npm install
```

3. **WPS Office**：确保已安装WPS Office并支持加载项开发

### 开发流程

#### 1. 开发调试
```bash
npm run debug
```
- 启动TypeScript监听编译
- 启动WPS调试模式

#### 2. 构建生产版本
```bash
npm run build
```
- 编译TypeScript
- Vite打包到dist目录
- 复制静态资源

#### 3. 仅编译TypeScript
```bash
npm run build:ts
```

### 代码规范

#### TypeScript严格模式
项目启用了完整的strict模式：
- `noImplicitAny`: true
- `strictNullChecks`: true
- `strictFunctionTypes`: true
- `noImplicitReturns`: true
- `noFallthroughCasesInSwitch`: true

#### 模块导入规范
**推荐**：从index.ts统一导入
```typescript
import { Result, BGM_CONFIG, httpGet } from './index.js';
```

#### 错误处理规范
使用Result类型处理可能失败的操作：
```typescript
// Bad: 直接抛错
const data = JSON.parse(str);

// Good: 使用Result包装
const result = safelyParseJson(str);
if (result.isOk()) {
  process(result.unwrap());
} else {
  handleError(result.error);
}
```

#### 日志规范
使用bgmLog统一记录日志：
```typescript
import { bgmLog, LOG_LEVELS } from './index.js';

bgmLog(LOG_LEVELS.DEBUG, '调试信息');
bgmLog(LOG_LEVELS.INFO, '一般信息');
bgmLog(LOG_LEVELS.WARN, '警告信息');
bgmLog(LOG_LEVELS.ERROR, '错误信息', errorObj);
```

### 添加新功能

#### 示例：添加新的API调用
```typescript
// 1. 在constants.ts添加端点常量
export const BGM_CONFIG = {
  // ...
  NEW_ENDPOINT: '/v0/some/endpoint'
};

// 2. 在http.ts添加便捷方法（或直接用httpRequest）
export const httpGetSomething = (token?: string) =>
  httpRequest<Something>(BGM_CONFIG.NEW_ENDPOINT, { method: 'GET', token });

// 3. 在index.ts导出
export { httpGetSomething } from './tools/http.js';

// 4. 使用
const result = await httpGetSomething(token);
```

#### 示例：添加新的列识别
```typescript
// 在exceltobangumi.ts的FIELD_NAME_MAP添加
const FIELD_NAME_MAP: {[key: string]: string} = {
  // ...现有映射...
  '新列名': '新字段名',
  '另一名称': '新字段名'
};

// 同时在HEADER_KEYWORDS添加（用于自动检测表头）
export const HEADER_KEYWORDS = [
  // ...现有关键字...
  '新列名',
  '另一名称'
];

// 在IMPORTANT_COLS添加（用于高亮重要列）
export const IMPORTANT_COLS: {[key: string]: boolean} = {
  // ...现有列...
  '新列名': true,
  '另一名称': true
};
```

### 调试技巧

#### 1. 使用bgmLog输出调试信息
```typescript
bgmLog(LOG_LEVELS.DEBUG, '变量值:', variable);
```

#### 2. 使用浏览器开发者工具
任务面板是WebView，可以：
- 右键 → 检查元素
- 使用Console调试
- 查看Network请求

#### 3. 检查同步记录
同步记录工作表中包含详细的同步历史，包括：
- 发送的Payload（H列）
- 状态（I列带颜色）
- 错误信息（J列）

---

## 优化建议


### 优化建议

#### 1. 性能优化
**当前问题**：逐行同步较慢（为了避免限流）
**优化建议**：
- 实现更智能的批处理（在API允许的情况下）
- 本地缓存已同步的SID，跳过无需更新的行
- 并行发送多个请求（需注意限流）

#### 2. 代码质量
**建议**：
- 添加单元测试（特别是核心逻辑）
- 增加JSDoc注释覆盖所有公共API
- 引入ESLint进行代码检查
- 使用Prettier统一格式化

#### 3. 安全性
**当前问题**：Token加密密钥硬编码
**优化建议**：
- 使用系统密钥链存储（Windows Credential Locker）
- 或要求用户每次输入主密码
- 添加Token过期检测和自动刷新

#### 4. 用户体验
**建议**：
- 添加同步预览功能（先显示将要同步的内容）
- 支持撤销同步操作
- 添加数据模板生成功能
- 支持导入/导出配置

#### 5. 功能增强
**建议**：
- 支持更多Bangumi字段（章节、标签、私人备注等）
- 添加冲突检测与解决机制
- 支持多账户切换
- 导出同步报告
- 增量同步（只同步变更）

#### 6. 架构优化
**建议**：
- 引入依赖注入容器，降低耦合
- 使用状态管理库（如Redux/Zustand）管理UI状态
- 分离业务逻辑与UI逻辑
- 添加事件总线解耦模块通信

### 已知限制
1. Bangumi API有请求频率限制（当前设置间隔800ms）
2. 大量数据同步可能耗时较长
3. 需要手动创建Bangumi开发者应用获取Token
4. 仅支持WPS Excel（理论上也支持MS Excel，但未测试）

---

## 参考资料

### 相关链接
- Bangumi API文档: https://bangumi.github.io/api/
- Bangumi开发者中心: https://bgm.tv/dev/app
- WPS加载项开发文档: 参见项目内 `docs/` 目录
- TypeScript官方文档: https://www.typescriptlang.org/docs/
- Vite官方文档: https://vitejs.dev/

### 相关文件
- [代码审查报告](./代码审查报告.md)
- [代码审查报告v4](./代码审查报告_v4.md)
- [代码审查报告v5](./代码审查报告_v5.md)

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | - | 初始版本 |

---

**文档最后更新**: 2026-05-09
