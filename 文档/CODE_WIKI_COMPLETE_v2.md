# BGM 追番标记助手 - 完整Code Wiki

## 1. 项目概述

### 1.1 项目简介
**BGM 追番标记助手**是一款用于 WPS Office Excel 的加载项工具，旨在帮助用户将 Excel 中的番剧数据批量同步到 Bangumi (bgm.tv) 收藏。支持双向同步、增量更新、冲突检测等功能。

### 1.2 核心特性
- ✅ Excel 到 Bangumi 双向同步
- ✅ 智能表头识别与列映射
- ✅ 增量同步与跳过冲突
- ✅ 同步记录与进度追踪
- ✅ Ribbon 与侧边栏双界面
- ✅ Token 加密存储
- ✅ PluginStorage 配置共享

### 1.3 技术栈
- **语言**: TypeScript 6.0+
- **构建工具**: Vite 6.0
- **运行环境**: WPS Office JSAPI
- **第三方服务**: Bangumi API v0

---

## 2. 项目架构

### 2.1 目录结构
```
BGM/
├── ts/                           # TypeScript 源代码
│   ├── core/                    # 核心模块
│   │   ├── constants.ts         # 全局常量定义
│   │   ├── crypto.ts            # Token 加密/解密
│   │   └── result.ts            # 结果类型与错误处理
│   ├── tools/                   # 工具模块
│   │   ├── config.ts            # 统一配置管理
│   │   ├── events.ts            # 事件总线系统
│   │   ├── http.ts              # HTTP 请求封装
│   │   ├── util.ts              # 通用工具函数
│   │   └── wps.ts               # WPS 类型定义
│   ├── sync/                    # 同步模块
│   │   ├── exceltobangumi.ts    # Excel → Bangumi 同步
│   │   ├── scraping.ts          # 从 Bangumi 抓取收藏
│   │   └── syncRecord.ts        # 同步记录管理
│   ├── ui/                      # 界面模块
│   │   ├── dialog.ts            # 对话框组件
│   │   ├── handlers.ts          # 事件处理器
│   │   ├── message.ts           # 消息通知
│   │   └── preview.ts           # 同步预览
│   ├── services/                # 服务模块
│   │   └── ribbonService.ts     # Ribbon 服务
│   ├── index.ts                 # 统一导出模块
│   ├── ribbon.ts                # Ribbon 回调
│   └── taskpane.ts              # 任务窗格入口
├── ui/                          # 界面资源
│   └── taskpane.html            # 侧边栏 HTML
├── css/                         # 样式文件
├── images/                      # 图片资源
├── manifest.xml                 # WPS 加载项清单
├── ribbon.xml                   # Ribbon 界面定义
├── package.json                 # 项目配置
├── tsconfig.json                # TypeScript 配置
└── vite.config.js               # Vite 构建配置
```

### 2.2 架构图
```
┌─────────────────────────────────────────────────────────────┐
│                         用户界面层                             │
├─────────────────────────────────────────────────────────────┤
│  Ribbon (ribbon.ts)  │  Task Pane (taskpane.ts)            │
├─────────────────────────────────────────────────────────────┤
│                     UI 事件处理层                             │
│                 (ui/handlers.ts)                             │
├─────────────────────────────────────────────────────────────┤
│                        业务服务层                             │
│         (services/ribbonService.ts)                          │
├─────────────────────────────────────────────────────────────┤
│                        同步核心层                             │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ exceltobangumi.ts│  │   scraping.ts    │                │
│  │ Excel → Bangumi  │  │ Bangumi → Excel  │                │
│  └──────────────────┘  └──────────────────┘                │
│  ┌──────────────────┐                                        │
│  │  syncRecord.ts  │  同步记录管理                          │
│  └──────────────────┘                                        │
├─────────────────────────────────────────────────────────────┤
│                        工具支撑层                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ config  │ │ events  │ │  http   │ │  util   │          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
├─────────────────────────────────────────────────────────────┤
│                        核心支撑层                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │constants │ │  crypto  │ │  result  │                     │
│  └──────────┘ └──────────┘ └──────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 核心模块详解

### 3.1 核心模块 (core/)

#### 3.1.1 constants.ts - 全局常量
**文件路径**: [core/constants.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\core\constants.ts)

**主要功能**:
- 错误级别枚举 (`ErrorLevel`)
- WPS 枚举值 (`WPS_ENUM`, `XL`)
- Bangumi API 配置 (`BGM_CONFIG`)
- 颜色常量 (`BGM_COLOR`)
- 日志级别 (`LOG_LEVELS`)
- 面板配置 (`PANEL_CONFIG`)
- 表头关键字映射 (`HEADER_KEYWORDS`)
- 字段名称映射 (`FIELD_NAME_MAP`)
- URL 模式匹配 (`URL_PATTERNS`)
- 观看状态映射 (`WATCH_STATUS_MAP`)
- 同步记录列定义 (`SYNC_RECORD_COLUMNS`)

**关键常量**:
```typescript
// API 配置
const BGM_CONFIG = {
    API_BASE: 'https://api.bgm.tv',
    MAX_RETRIES: 3,
    TIMEOUT: 10000
};

// 颜色常量
const BGM_COLOR = {
    SUCCESS: 0x00C000,  // 绿色
    FAIL: 0xFF0000,     // 红色
    SKIP: 0x808080      // 灰色
};

// 观看状态映射
const WATCH_STATUS_MAP: Record<string, number> = {
    '想看': 1,
    '在看': 2,
    '看过': 3,
    '搁置': 4,
    '抛弃': 5
};
```

#### 3.1.2 crypto.ts - Token 加密
**文件路径**: [core/crypto.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\core\crypto.ts)

**主要功能**:
- XOR 加密/解密 Token
- 校验和计算
- 安全存储 Token

**关键函数**:
| 函数名 | 说明 |
|--------|------|
| `calcChecksum(str)` | 计算字符串校验和 |
| `encryptToken(token)` | 加密 Token |
| `decryptToken(encrypted)` | 解密 Token |
| `extractToken(decrypted)` | 从解密字符串提取 Token |

#### 3.1.3 result.ts - 结果与错误处理
**文件路径**: [core/result.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\core\result.ts)

**主要功能**:
- 统一业务错误类 `BgmError`
- 操作结果类型 `Result<T>`
- 批量同步结果 `BatchSyncResult`

### 3.2 工具模块 (tools/)

#### 3.2.1 config.ts - 配置管理
**文件路径**: [tools/config.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\tools\config.ts)

**主要功能**:
- 统一 PluginStorage 配置管理
- Ribbon ↔ Task Pane 双向同步
- postMessage 配置更新通知

**核心配置键**:
```typescript
const CONFIG_KEYS = {
    TOKEN: 'bgm_token',
    USER_ID: 'bgm_user_id',
    INCREMENTAL_SYNC: 'bgm_incremental_sync',
    SKIP_CONFLICTS: 'bgm_skip_conflicts',
    LOCKED_SHEET: 'bgm_locked_sheet'
};
```

**消息类型**:
```typescript
const CONFIG_MESSAGE_TYPES = {
    CONFIG_UPDATED: 'BGM:configUpdated',
    SYNC_PROGRESS: 'BGM:syncProgress'
};
```

**关键函数**:
| 函数名 | 说明 |
|--------|------|
| `setConfig(key, value, notify)` | 设置配置 |
| `getConfig(key, defaultValue)` | 获取配置 |
| `removeConfig(key)` | 删除配置 |
| `setIncrementalSync(enabled)` | 设置增量同步 |
| `getIncrementalSync()` | 获取增量同步状态 |
| `setSkipConflicts(enabled)` | 设置跳过冲突 |
| `getSkipConflicts()` | 获取跳过冲突状态 |
| `sendConfigUpdateToRibbon(key, value)` | 发送配置更新到 Ribbon |
| `sendSyncProgressToRibbon(progress)` | 发送同步进度到 Ribbon |
| `listenToRibbonConfigUpdates(callback)` | 监听 Ribbon 配置更新 |

#### 3.2.2 events.ts - 事件总线
**文件路径**: [tools/events.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\tools\events.ts)

**主要功能**:
- 发布-订阅事件系统
- 模块间松耦合通信

**关键事件类型**:
```typescript
const BGM_EVENTS = {
    TOKEN_UPDATED: 'state:tokenUpdated',
    USER_ID_UPDATED: 'state:userIdUpdated',
    USER_NAME_UPDATED: 'state:userNameUpdated',
    SYNC_PROGRESS: 'sync:progress',
    SYNC_COMPLETED: 'sync:completed',
    SYNC_ERROR: 'sync:error',
    CONFIG_UPDATED: 'config:updated',
    SHEET_LOCKED: 'sheet:locked',
    SHEET_UNLOCKED: 'sheet:unlocked'
};
```

**EventBus 类方法**:
| 方法 | 说明 |
|------|------|
| `on(eventName, handler, once)` | 订阅事件 |
| `once(eventName, handler)` | 订阅单次事件 |
| `off(eventName, handler)` | 取消订阅 |
| `emit(eventName, data)` | 发布事件 |
| `has(eventName)` | 检查是否有订阅者 |

#### 3.2.3 http.ts - HTTP 请求
**文件路径**: [tools/http.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\tools\http.ts)

**主要功能**:
- 封装 XMLHttpRequest
- 支持自动重试
- 统一错误处理

**关键函数**:
| 函数名 | 说明 |
|--------|------|
| `httpRequest(options)` | 发送 HTTP 请求（支持重试） |

#### 3.2.4 util.ts - 通用工具
**文件路径**: [tools/util.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\tools\util.ts)

**主要功能**:
- WPS Application 对象获取
- Excel 单元格操作
- Token/用户ID 存储
- 日志系统
- 表头识别与列映射

**关键函数**:
| 函数名 | 说明 |
|--------|------|
| `getApp()` | 获取 WPS Application 对象 |
| `getCell(ws, row, col)` | 获取单元格对象 |
| `getCellValue(ws, row, col)` | 获取单元格值 |
| `getLastRow(ws)` | 获取最后一行 |
| `findHeaderRow(ws)` | 查找表头行 |
| `getColumnMap(ws)` | 构建列名→索引映射 |
| `extractSubjectId(url)` | 从 URL 提取 Subject ID |
| `calcFingerprint(data)` | 计算数据指纹 |
| `bgmLog(level, message)` | 记录日志 |
| `storeBgToken(token)` | 存储 Token |
| `loadBgToken()` | 加载 Token |
| `_setBgmUserId(id)` | 设置用户ID |
| `_getBgmUserId()` | 获取用户ID |

#### 3.2.5 wps.ts - WPS 类型定义
**文件路径**: [tools/wps.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\tools\wps.ts)

**主要功能**:
- TypeScript 类型定义
- WPS Office COM 对象接口

### 3.3 同步模块 (sync/)

#### 3.3.1 exceltobangumi.ts - Excel → Bangumi
**文件路径**: [sync/exceltobangumi.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\sync\exceltobangumi.ts)

**主要功能**:
- 读取 Excel 番剧数据
- 智能表头识别
- 观看状态转换
- 批量同步到 Bangumi
- 同步结果标记

**核心流程**:
```
1. 读取 Excel 数据
   ↓
2. 查找表头，构建列映射
   ↓
3. 解析每一行数据
   ↓
4. 提取 Subject ID
   ↓
5. 构建 API 请求体
   ↓
6. 批量发送请求（并发控制）
   ↓
7. 处理响应，标记结果
   ↓
8. 记录同步日志
```

**关键函数**:
| 函数名 | 说明 |
|--------|------|
| `SyncToBangumiAsync(options)` | 主同步函数 |
| `syncCollectionFromBgm(sheetIndex)` | 从 Bangumi 同步收藏 |
| `markSyncResultColor(ws, row, success)` | 标记同步结果颜色 |
| `testSingleUpdate()` | 测试单条更新 |

**配置选项**:
```typescript
interface SyncOptions {
    sheetIndex?: number;           // 工作表索引
    colMap?: Map<string, number>;  // 列映射
    concurrency?: number;          // 并发数（默认5）
    onlyNew?: boolean;             // 仅同步新条目
    startRow?: number;             // 起始行
    endRow?: number;               // 结束行
}
```

#### 3.3.2 scraping.ts - Bangumi 数据抓取
**文件路径**: [sync/scraping.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\sync\scraping.ts)

**主要功能**:
- 验证 Token 有效性
- 获取用户收藏列表
- 获取单个条目的收藏信息
- 分页加载所有收藏

**关键函数**:
| 函数名 | 说明 |
|--------|------|
| `verifyToken(token)` | 验证 Token 是否有效 |
| `fetchAllUserCollections(token, type)` | 获取所有收藏（自动分页） |
| `fetchSubjectCollection(token, subjectId)` | 获取单个条目收藏状态 |

#### 3.3.3 syncRecord.ts - 同步记录管理
**文件路径**: [sync/syncRecord.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\sync\syncRecord.ts)

**主要功能**:
- 创建/获取同步记录工作表
- 添加同步记录
- 设置记录颜色标记
- 获取所有同步记录
- 清空同步记录

**同步记录列**:
| 列 | 说明 |
|----|------|
| 1 | 序列号 |
| 2 | 同步时间 |
| 3 | 名称 |
| 4 | URL |
| 5 | Subject ID |
| 6 | 类型（想看/在看/看过） |
| 7 | 第几次同步 |
| 8 | 同步内容 |
| 9 | 状态（成功/失败） |
| 10 | 消息 |
| 11 | 数据指纹 |

**关键函数**:
| 函数名 | 说明 |
|--------|------|
| `getOrCreateSyncRecordSheet()` | 获取或创建记录工作表 |
| `addSyncRecord(record)` | 添加同步记录 |
| `setSyncRecordColors()` | 设置记录颜色 |
| `getAllSyncRecords()` | 获取所有记录 |
| `clearSyncRecords()` | 清空记录 |
| `openSyncRecordSheet()` | 打开记录工作表 |

### 3.4 UI 模块 (ui/)

#### 3.4.1 dialog.ts - 对话框组件
**文件路径**: [ui/dialog.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\ui\dialog.ts)

**主要功能**:
- 各种对话框封装
- Toast 通知

**关键函数**:
| 函数名 | 说明 |
|--------|------|
| `showAlert(message, title)` | 警告提示 |
| `showConfirm(message, onConfirm, onCancel)` | 确认对话框 |
| `showError(error)` | 错误提示 |
| `showSuccess(message)` | 成功提示 |
| `showInput(message, placeholder, onConfirm, default)` | 输入对话框 |
| `showToast(message, type)` | Toast 通知 |

#### 3.4.2 handlers.ts - 事件处理器
**文件路径**: [ui/handlers.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\ui\handlers.ts)

**主要功能**:
- 按钮事件绑定
- 业务逻辑处理
- Token/用户ID 设置
- 面板初始化

**支持的操作**:
| 操作 (data-action) | 说明 |
|-------------------|------|
| `sync` | 同步到 Bangumi |
| `requestStopSync` | 停止同步 |
| `test` | 单条测试 |
| `syncCollectionFromBgm` | 从 BGM 同步收藏 |
| `previewSyncContent` | 预览同步 |
| `showTokenDialog` | 显示 Token 对话框 |
| `testToken` | 测试 Token |
| `showUserIdDialog` | 显示用户ID对话框 |
| `openUserCollection` | 打开收藏页 |
| `toggleSheetLock` | 切换工作表锁定 |
| `clearSyncRecords` | 清空同步记录 |
| `refreshSheets` | 刷新工作表 |
| `refreshData` | 刷新数据 |
| `markUploadedItems` | 标记已上传项目 |
| `showClearSyncRecordsDialog` | 显示清空记录对话框 |

**关键函数**:
| 函数名 | 说明 |
|--------|------|
| `setupButtonListeners()` | 设置按钮监听 |
| `handleActionClick(event)` | 处理按钮点击 |
| `showTokenDialog()` | Token 设置对话框 |
| `showUserIdDialog()` | 用户ID 设置对话框 |
| `initIncrementalSyncFromRibbon()` | 从 Ribbon 读取增量同步状态 |
| `openUserCollection(isRibbon)` | 打开用户收藏页 |

#### 3.4.3 message.ts - 消息通知
**文件路径**: [ui/message.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\ui\message.ts)

**主要功能**:
- 面板状态更新
- 消息发送

#### 3.4.4 preview.ts - 同步预览
**文件路径**: [ui/preview.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\ui\preview.ts)

**主要功能**:
- 同步内容预览
- 冲突检测与提示

### 3.5 服务模块 (services/)

#### 3.5.1 ribbonService.ts - Ribbon 服务
**文件路径**: [services/ribbonService.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\services\ribbonService.ts)

**主要功能**:
- Ribbon 按钮回调
- 同步确认对话框
- 冲突检测
- Ribbon 事件处理

**关键函数**:
| 函数名 | 说明 |
|--------|------|
| `syncWithConfirmation(sheetIndex, colMap, lastRow)` | 带确认的同步 |
| `getSyncPreview(ws, colMap, lastRow)` | 获取同步预览统计 |
| `detectConflicts(ws, colMap, lastRow)` | 检测同步冲突 |
| `setUserIdForRibbon(id)` | 为 Ribbon 设置用户ID |
| `openCollectionForRibbon()` | Ribbon 打开收藏页 |

### 3.6 入口模块

#### 3.6.1 index.ts - 统一导出
**文件路径**: [index.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\index.ts)

**主要功能**:
- 统一导出所有模块
- 降低模块间耦合
- 类型定义导出

**导出分类**:
1. 核心常量与枚举
2. 错误处理与结果类型
3. Token 加密/解密
4. HTTP 请求模块
5. UI 对话框
6. WPS 类型定义
7. UI 消息与状态
8. Ribbon 服务
9. 同步记录
10. 同步收藏抓取
11. 通用工具函数
12. 配置管理模块
13. 同步引擎
14. UI 事件处理

#### 3.6.2 ribbon.ts - Ribbon 回调
**文件路径**: [ribbon.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\ribbon.ts)

**主要功能**:
- Ribbon 按钮点击回调
- 复选框状态读取/保存
- 加载初始化

**导出函数**:
| 函数名 | 说明 |
|--------|------|
| `OnAddinLoad(ribbonUI)` | 加载时回调 |
| `OnAction(control)` | 按钮点击回调 |
| `GetSkipConflictsPressed(control)` | 获取"跳过冲突"状态 |
| `OnSkipConflictsChange(control)` | "跳过冲突"变更回调 |
| `GetIncrementalSyncPressed(control)` | 获取增量同步状态 |
| `OnIncrementalSyncChange(control)` | 增量同步变更回调 |

#### 3.6.3 taskpane.ts - 任务窗格
**文件路径**: [taskpane.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\taskpane.ts)

**主要功能**:
- 任务窗格初始化
- 按钮事件绑定
- 面板状态更新

---

## 4. 关键数据流

### 4.1 Excel → Bangumi 同步流程
```
用户点击"同步到 Bangumi"按钮
    ↓
[handlers.ts] handleActionClick('sync')
    ↓
[exceltobangumi.ts] SyncToBangumiAsync()
    ├─ 查找表头 findHeaderRow()
    ├─ 构建列映射 getColumnMap()
    ├─ 读取数据 readRangeValues()
    ├─ 解析每行数据
    │   ├─ 提取 Subject ID extractSubjectId()
    │   ├─ 转换观看状态
    │   └─ 计算数据指纹 calcFingerprint()
    ├─ 批量发送请求 httpRequest()
    ├─ 处理响应，标记颜色 markSyncResultColor()
    └─ 记录同步日志 addSyncRecord()
    ↓
[ui/dialog.ts] showSuccess() 提示完成
```

### 4.2 Bangumi → Excel 同步流程
```
用户点击"从BGM同步收藏"按钮
    ↓
[handlers.ts] handleActionClick('syncCollectionFromBgm')
    ↓
[scraping.ts] fetchAllUserCollections()
    ├─ 验证 Token verifyToken()
    ├─ 分页加载所有收藏
    │   └─ API: /v0/users/{user_id}/collections?type=anime
    └─ 返回收藏列表
    ↓
[exceltobangumi.ts] syncCollectionFromBgm()
    ├─ 匹配 Excel 中的条目
    └─ 标记到 Excel
```

### 4.3 配置更新流程 (双向同步)
```
【侧边栏 → Ribbon】
用户操作配置
    ↓
[config.ts] setConfig(key, value, true)
    ├─ 保存到 PluginStorage
    ├─ 触发内部事件
    └─ sendConfigUpdateToRibbon(key, value)
    ↓
postMessage (BGM:configUpdated)
    ↓
Ribbon 接收并更新


【Ribbon → 侧边栏】
用户操作 Ribbon 配置
    ↓
[ribbon.ts] OnIncrementalSyncChange() / OnSkipConflictsChange()
    ↓
[config.ts] setConfig(key, value, false)
    └─ 保存到 PluginStorage
    ↓
侧边栏轮询或按需读取
    ↓
[config.ts] getConfig(key)
```

---

## 5. 核心数据结构

### 5.1 同步任务
```typescript
interface SyncTask {
    rowNum: number;
    sid: string;
    bgmUrl: string;
    name: string;
    jsonBody: string;
    fingerprint?: string;
    type: number;
}
```

### 5.2 同步记录
```typescript
interface SyncRecord {
    name: string;
    url: string;
    sid: string;
    type: string;
    content: string;
    status: 'success' | 'failed';
    message: string;
    count: number;
    fingerprint?: string;
}
```

### 5.3 收藏条目
```typescript
interface CollectionItem {
    subject_id: number;
    type: number;
    rate?: number;
    tags?: string[];
    comment?: string;
    ep_status?: number;
    vol_status?: number;
    updated_at?: string;
    subject_type?: number;
    subject?: {
        id: number;
        name: string;
        name_cn?: string;
        type?: number;
    };
}
```

### 5.4 全局状态
```typescript
interface BGMCache {
    totalRows: number;
    userId: string | null;
    username: string | null;
    sidCache: Map<string, string>;
    listCache: unknown[];
}

interface BGMSync {
    isSyncing: boolean;
    stopRequested: boolean;
    batchSize: number;
    concurrency: number;
}

interface BGMSheet {
    lockedIndex: number | null;
    lockedName: string | null;
    isLocked: boolean;
}

interface BGMGlobal {
    cache: BGMCache;
    sync: BGMSync;
    sheet: BGMSheet;
}
```

---

## 6. Bangumi API 集成

### 6.1 主要 API 端点
| 端点 | 方法 | 说明 |
|------|------|------|
| `/v0/me` | GET | 获取当前用户信息（验证 Token） |
| `/v0/users/{user_id}/collections` | GET | 获取用户收藏列表（分页） |
| `/v0/users/{user_id}/collections/{subject_id}` | GET | 获取单个条目的收藏 |
| `/v0/users/{user_id}/collections/{subject_id}` | PUT | 更新收藏 |
| `/v0/users/{user_id}/collections/{subject_id}` | DELETE | 删除收藏 |

### 6.2 API 请求体格式
```typescript
{
    "type": 1|2|3|4|5,           // 1=想看, 2=在看, 3=看过, 4=搁置, 5=抛弃
    "rate": 0-10,                // 评分
    "comment": "评论内容",       // 评论
    "private": false,            // 是否私有
    "tags": ["标签1", "标签2"],  // 标签数组
    "ep_status": 0-...           // 看到第几集
}
```

### 6.3 API 响应格式
```typescript
{
    "total": 100,
    "limit": 30,
    "offset": 0,
    "data": [
        {
            "subject_id": 12345,
            "type": 2,
            "rate": 8,
            "comment": "好看",
            "tags": ["燃", "科幻"],
            "ep_status": 12,
            "updated_at": "2024-01-01T00:00:00Z"
        }
    ]
}
```

---

## 7. 构建与运行

### 7.1 开发环境设置
```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建 TypeScript
npm run build:ts

# 完整构建
npm run build
```

### 7.2 项目脚本
| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器（端口3889） |
| `npm run build` | Vite 生产构建 |
| `npm run build:ts` | 仅编译 TypeScript |
| `npm run debug` | 调试模式（带监控） |

### 7.3 WPS 加载项调试
1. 确保已安装 WPS Office
2. 运行 `npm run debug`
3. WPS 会自动加载并调试加载项

### 7.4 部署
构建输出:
- `dist/` - Vite 打包资源
- `dist-ts/` - 编译后的 TypeScript 模块

---

## 8. 依赖关系图

### 8.1 主要模块依赖
```
index.ts (统一入口)
├── core/
│   ├── constants.ts
│   ├── crypto.ts
│   └── result.ts
├── tools/
│   ├── config.ts
│   ├── events.ts
│   ├── http.ts
│   ├── util.ts
│   └── wps.ts
├── sync/
│   ├── exceltobangumi.ts
│   ├── scraping.ts
│   └── syncRecord.ts
├── ui/
│   ├── dialog.ts
│   ├── handlers.ts
│   ├── message.ts
│   └── preview.ts
├── services/
│   └── ribbonService.ts
├── ribbon.ts
└── taskpane.ts
```

### 8.2 第三方依赖
| 包 | 版本 | 说明 |
|----|------|------|
| typescript | ^6.0.3 | TypeScript 编译器 |
| vite | ^6.0.0 | 构建工具 |
| vite-plugin-static-copy | ^4.1.0 | 静态资源复制 |
| wpsjs | latest | WPS JSAPI 工具 |
| concurrently | ^9.2.1 | 并行命令执行（调试用） |
| et-jsapi-declare | latest | WPS Excel API 类型声明 |

---

## 9. 配置文件说明

### 9.1 package.json
```json
{
    "name": "test",
    "addonType": "et",
    "version": "1.0.0",
    "description": "WPS Excel 加载项 - 追番标记助手"
}
```

### 9.2 tsconfig.json
TypeScript 编译器配置，支持 ES2020+

### 9.3 vite.config.js
Vite 构建配置，配置静态资源复制等

### 9.4 manifest.xml
WPS 加载项清单，定义加载项基本信息
```xml
<?xml version="1.0" encoding="UTF-8"?>
<JsPlugin>
  <ApiVersion>1.0.0</ApiVersion>
  <Name>HelloEt</Name>
  <Description>addon Description</Description>
</JsPlugin>
```

### 9.5 ribbon.xml
Ribbon 界面定义
```xml
<customUI onLoad="OnAddinLoad">
  <ribbon>
    <tabs>
      <tab id="wpsAddinTab" label="Bangumi同步">
        <group id="bangumiGroup" label="Bangumi">
          <button id="btnShowPanel" label="打开同步面板"/>
          <button id="btnSyncBangumi" label="全面同步"/>
          <checkBox id="chkIncrementalSync" label="仅同步变更"/>
          <checkBox id="chkSkipConflicts" label="跳过冲突"/>
          <!-- 更多按钮 -->
        </group>
      </tab>
    </tabs>
  </ribbon>
</customUI>
```

---

## 10. Excel 数据格式规范

### 10.1 支持的表头关键字
| 关键字 | 说明 |
|--------|------|
| `Bangumi_URL`, `Bangumi URL` | Bangumi 条目 URL |
| `名称`, `作品名称` | 作品名称 |
| `是否看完`, `状态`, `观看状态` | 观看状态 |
| `打分`, `评分`, `分数` | 评分 (1-10) |
| `标签/分级`, `标签` | 标签 |
| `完播日`, `观看日期` | 完成日期 |
| `剧透/感言`, `评论` | 评论 |
| `集号`, `集数` | 看到第几集 |
| `类别`, `类型` | 作品类型 |
| `序列号` | 序列号列（用于标记同步状态） |

### 10.2 观看状态值
| 值 | 含义 |
|----|------|
| `想看` | 1 |
| `在看` | 2 |
| `看过` | 3 |
| `搁置` | 4 |
| `抛弃` | 5 |

### 10.3 URL 格式
支持的 URL 格式:
- `https://bgm.tv/subject/{id}`
- `https://bangumi.tv/subject/{id}`
- `https://chii.in/subject/{id}`
- 短格式: `bgm.tv/{id}` 或 `{id}`

---

## 11. 常见问题解答 (FAQ)

### Q: 如何获取 Bangumi Access Token?
A: 访问 https://next.bgm.tv/demo/access-token/create 创建

### Q: 增量同步是如何工作的?
A: 通过计算每一行的数据指纹（fingerprint），如果与上次同步的一致，则跳过

### Q: 什么是"跳过冲突"?
A: 当本地数据与 Bangumi 数据不一致时，跳过该条目而不是覆盖

### Q: 如何启用调试日志?
A: 打开浏览器开发者工具，查看 Console 输出

### Q: Token 是如何存储的?
A: 使用 XOR 加密后存储在 WPS 的 PluginStorage 中

---

## 12. 开发指南

### 12.1 代码风格
- 使用 TypeScript 严格模式
- 使用 ES6+ 语法
- 使用 `const` 优先，`let` 其次，避免 `var`
- 完整的类型注解
- JSDoc 注释

### 12.2 模块添加新功能
1. 在对应目录添加 `.ts` 文件
2. 在 `index.ts` 中导出
3. 如需类型，在 `tools/wps.ts` 定义
4. 编写测试（如需要）

### 12.3 调试技巧
1. 打开浏览器开发者工具
2. 查看 Console 日志
3. 使用 `debugger` 语句
4. 检查 Network 面板的 API 请求

---

## 13. 更新日志

### 1.1.0 (当前)
- ✅ 添加统一配置管理模块 ([tools/config.ts](file:///d:\编程\Excel加载项\BGM\BGM\ts\tools\config.ts))
- ✅ 实现 Ribbon ↔ Task Pane 双向同步
- ✅ 添加 CONFIG_UPDATED 事件
- ✅ 完善配置通知机制

### 1.0.0 (初始)
- ✅ 基础同步功能
- ✅ 智能表头识别
- ✅ 同步记录管理
- ✅ Token 加密存储

---

## 14. 贡献指南

欢迎提交 Issue 和 PR！

---

## 15. 许可证

此项目遵循内部使用许可证。

---

**文档生成时间**: 2026-05-13  
**项目版本**: 1.1.0  
**维护者**: BGM Development Team
