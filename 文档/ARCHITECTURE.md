# Bangumi WPS Excel 加载项 - 架构与项目知识文档

> 版本: 1.0 | 更新日期: 2026-08-10

---

## 一、架构概览

### 1.1 系统分层模型

本项目采用**五层架构**设计，自上而下依次为：

```
┌─────────────────────────────────────────────────────────────┐
│  表示层 (UI)          ts/ui/     对话框、预览、事件处理器     │
├─────────────────────────────────────────────────────────────┤
│  状态层 (State)       BGM 命名空间 + EventBus                │
├─────────────────────────────────────────────────────────────┤
│  业务层 (Services)    ts/services/   Ribbon 服务、配置导入导出 │
├─────────────────────────────────────────────────────────────┤
│  数据层 (Sync)        ts/sync/     同步引擎、Undo栈、冲突解决  │
├─────────────────────────────────────────────────────────────┤
│  基础设施层 (Core)    ts/core/ + ts/tools/ 常量、加密、HTTP、日志 │
└─────────────────────────────────────────────────────────────┘
```

**核心设计原则：**

- 统一 barrel export 入口 (`ts/index.ts`)，所有模块通过 `index.js` 中转导入，降低模块间耦合
- 显式入口模式：`ts/entry/` 下的文件负责启动副作用，模块本身不自动初始化
- 跨 WebView 通信使用 PluginStorage 轮询 + postMessage 双通道保障

### 1.2 模块依赖关系

```
ts/index.ts (barrel export)
  ├── ts/core/           (零依赖基础层)
  │   ├── constants.ts     → 常量、枚举、映射表
  │   ├── crypto.ts        → Token 加解密 (XOR 历史兼容)
  │   └── result.ts        → Result<T> 类型 + BgmError
  │
  ├── ts/tools/          (基础设施层)
  │   ├── events.ts        → EventBus (发布-订阅)
  │   ├── logger.ts        → 分级日志 + Token 脱敏
  │   ├── http.ts          → XHR 封装 + 重试 + Zod 校验
  │   ├── config.ts        → PluginStorage 配置读写
  │   ├── util/            → 单元格/工作表操作、Token 存储、BGM 命名空间
  │   ├── stringUtils.ts   → colNumToLetter, trim, escapeHtml, calcFingerprint
  │   └── wps.ts           → WPS 类型守卫与类型定义
  │
  ├── ts/services/       (业务逻辑层)
  │   ├── ribbonService.ts → Ribbon 按钮业务逻辑
  │   └── configService.ts → 配置导入/导出 (Zod 校验)
  │
  ├── ts/sync/           (数据同步层)
  │   ├── exceltobangumi.ts → Excel → Bangumi 上传引擎
  │   ├── scraping.ts       → Bangumi → Excel 收藏抓取
  │   ├── githubSync.ts     → GitHub 仓库同步
  │   ├── githubConfig.ts   → GitHub 配置 (PluginStorage)
  │   ├── githubSyncDiff.ts → 差异计算 (纯函数，零依赖)
  │   ├── githubCache.ts    → 远程数据缓存
  │   ├── syncSourceRegistry.ts → 多源同步注册表
  │   ├── gistSync.ts       → Gist 同步源
  │   ├── giteeSync.ts      → Gitee 同步源
  │   ├── gitlabSync.ts     → GitLab 同步源
  │   ├── localFileSync.ts  → 本地文件同步源
  │   ├── syncRecord.ts     → 同步记录工作表管理
  │   ├── undoStack.ts      → 撤销栈 (单元格变更 + 行删除)
  │   ├── conflictResolver.ts → 冲突检测与解决
  │   ├── pureUtils.ts      → 纯工具函数
  │   ├── pureUtilsCore.ts  → 核心纯工具
  │   └── exportJsonl.ts    → JSONL 导出
  │
  ├── ts/ui/             (表示层)
  │   ├── dialog.ts         → 对话框系统 (alert/confirm/error/input/toast)
  │   ├── message.ts        → 状态栏消息
  │   ├── preview.ts        → 数据预览组件
  │   ├── conflictResolver.ts → 冲突解决 UI
  │   ├── syncResultDialog.ts → 同步结果弹窗
  │   └── handlers/         → 事件处理器
  │       ├── index.ts      → 主 handler 分发
  │       ├── sync.ts       → 同步相关 handler
  │       ├── token.ts      → Token 相关 handler
  │       ├── sheet.ts      → 工作表相关 handler
  │       └── _constants.ts → 中文常量
  │
  ├── ts/taskpane/       (任务面板子模块)
  │   ├── index.ts          → initTaskpane 初始化
  │   ├── panelLifecycle.ts → 工作表锁定/解锁
  │   └── userInfoPolling.ts → 用户信息轮询 (PluginStorage)
  │
  └── ts/schemas/        (Zod 校验模式)
      ├── pluginStorage.ts  → FullConfigSchema
      ├── bgmCollection.ts  → 收藏数据校验
      ├── bgmUser.ts        → 用户数据校验
      └── githubEntry.ts    → GitHub 条目校验
```

### 1.3 入口点

#### Ribbon 入口

- **文件**: `ts/entry/ribbon-entry.ts`
- **启动链**: `startRibbon()` → `initRibbon()` →
  1. 注册 window message 监听器（接收 Taskpane 发来的 `BGM:configUpdated` 消息）
  2. 启动 PluginStorage 配置轮询（每 2 秒检查增量同步/跳过冲突/同步记录开关的变化）
- **自动启动条件**: `typeof window !== 'undefined'`（浏览器上下文）

#### Taskpane 入口

- **文件**: `ts/entry/taskpane-entry.ts`
- **启动链**: `startTaskpane()` →
  1. `initTaskpane()`: 工作表锁定状态恢复、用户信息轮询、Token 状态检查
  2. `initHandlers()`: 注册按钮监听器、消息监听器、事件总线监听器
- **自动启动条件**: `typeof window !== 'undefined' && window.location.pathname.includes('taskpane.html')`

---

## 二、模块详解

### 2.1 核心模块 (`ts/core/`)

#### `constants.ts` — 全局常量中心

- **错误级别枚举** (`ErrorLevel`): SILENT(0), WARN(1), ERROR(2), THROW(3), INFO(4)
- **WPS 枚举** (`WPS_ENUM`): 停靠位置 (msoCTPDockPositionLeft=0, msoCTPDockPositionRight=2)
- **Excel 方向常量** (`XL`): UP(-4162), DOWN(-4121), TO_LEFT(-4159), TO_RIGHT(-4161), NONE(-4142), CELL_TYPE_VISIBLE(12)
- **Bangumi API 配置** (`BGM_CONFIG`): API_BASE=`https://api.bgm.tv`, MAX_RETRIES=3, RETRY_DELAY_BASE=2000, REQUEST_DELAY=800
- **颜色常量** (`BGM_COLOR`): SUCCESS(浅绿), FAIL(浅红), SKIP(浅黄), BGM_SYNC(紫色), LIGHT_GREEN, DARK_GREEN, GRAY, WISH(粉色), WATCHING(蓝色)
- **日志级别** (`LOG_LEVELS`): INFO(1), WARN(2), ERROR(3)
- **面板配置** (`PANEL_CONFIG`): MAX_SCAN_COLUMNS=60, MAX_SCAN_ROWS=10, PREVIEW_LIMIT=200, MAX_FILTER_SCAN_ROWS=5000
- **条目类型映射** (`BGM_SUBJECT_TYPES`): 1=书籍, 2=动画, 3=音乐, 4=游戏, 6=真人剧
- **观看状态映射** (`WATCH_STATUS_MAP`): 文本→数值 (想看=1, 看过=2, 在看=3, 搁置=4, 抛弃=5, 忽略=0)
- **收藏状态名称** (`COLLECTION_TYPE_NAMES`): 数组下标即 API 数值 ['', '想看', '看过', '在看', '搁置', '抛弃']
- **URL 匹配模式** (`URL_PATTERNS`): 支持 bgm.tv, bangumi.tv, chii.in 三种域名
- **列规则** (`COLUMN_RULES`): 37 条正则→标准字段映射规则
- **表头关键字** (`HEADER_KEYWORDS`): 52 个关键字用于自动检测表头行
- **标准表头** (`STANDARD_HEADERS`): 37 列标准模板列序
- **同步记录表列** (`SYNC_RECORD_COLUMNS`): 12 列 (SID/同步时间/名称/URL/条目类型/来源/次数/内容/状态/收藏状态/备注/数据指纹)
- **Token 配置** (`TOKEN_CONFIG`): VERSION='1'（用于识别历史 XOR 加密数据）

#### `crypto.ts` — Token 加密/解密

- **当前策略**: Token 明文存储，XOR 加密仅用于兼容历史数据读取
- `encryptToken(token)`: XOR 加密（已废弃，仅保留用于向后兼容）
- `decryptToken(encrypted)`: 解密历史 XOR 数据，自动升级为明文
- `calcChecksum(input)`: 32 位左移+求和校验和
- `buildPayload(token)`: 构建 `{version}:{checksum}:{token}` 格式
- `extractToken(encrypted)`: 从 Payload 提取 Token 并校验版本号与校验和
- **历史 XOR 密钥**: `LEGACY_XOR_KEY = 'bgmtoken_secret_key_2024'`（仅在模块内部保留）

#### `result.ts` — 结果类型封装

- **`BgmError`** 类: 继承 Error，扩展 `code`(错误码), `details`(详情对象), `timestamp`(ISO 时间戳)
- **`Result<T>`** 类: Rust 风格的 Result 类型
  - `Result.ok(data)` / `Result.fail(error)`: 静态工厂
  - `Result.okVoid()` / `Result.failVoid(error)`: void 版本
  - `Result.fromCode(code, data)`: 从 HTTP 状态码创建
  - `.isOk()` / `.isFail()`: 状态判断
  - `.unwrap()` / `.unwrapOr(default)`: 数据提取
  - `.map(fn)` / `.mapErr(fn)`: 函子映射
- **`BatchSyncResult`**: 批量同步结果统计 (success/fail/skip)

### 2.2 服务模块 (`ts/services/`)

#### `ribbonService.ts` — Ribbon 按钮业务逻辑

- **`syncWithConfirmation()`**: 完整同步流程（预览统计 → 读取配置 → 用户确认 → 冲突检测 → 执行同步 → 结果提示）
  - 预览统计由 `getSyncPreview()` 执行（纯扫描，不发网络请求）
  - 冲突策略读取 PluginStorage (`bgm_skip_conflicts`)
  - 增量同步读取 PluginStorage (`bgm_incremental_sync`)
  - 冲突检测调用 `detectConflicts()`（需要 Bangumi API）
  - 执行调用 `SyncToBangumiAsync()`
- **`getSyncPreview()`**: 纯扫描统计（total/valid/willSync/willSkip/alreadyUploaded/noUrl/emptyStatus/incrementalSkipped）
- **`detectConflicts()`**: 异步冲突检测（对比 Excel 本地数据与 Bangumi 远程收藏的 type 字段差异）
- **`detectGithubConflicts()`**: GitHub 远程条目与本地 Excel 行的字段级冲突检测（纯函数，零依赖）
- **`setTokenForRibbon()`**: 通过 InputBox 设置 Token
- **`testTokenForRibbon()`**: 使用 XHR 直接请求 `https://api.bgm.tv/v0/me` 验证 Token
- **`copyTokenForRibbon()`**: 通过 execCommand('copy') 复制 Token
- **`setUserIdForRibbon()`**: 设置用户 ID
- **`openCollectionForRibbon()`**: 打开 Bangumi 收藏页面
- **`syncFromGithubForRibbon()`**: 写入 PluginStorage 信号（`bgm_request_github_sync`），由 Taskpane 轮询后执行
- **`undoLastSyncForRibbon()`**: 写入 PluginStorage 信号（`bgm_request_undo_sync`），由 Taskpane 轮询后执行
- **`executeUndoLastSync()`**: Taskpane 上下文中的撤销执行（调用 `undoStack.undoLastSync()`）

#### `configService.ts` — 配置导入/导出

- **`exportConfig()`**: 导出 Token + 用户ID + GitHub 配置 + 同步策略为 JSON 字符串
- **`importConfig(json)`**: 使用 `FullConfigSchema` (Zod) 严格校验后写回 PluginStorage
- **配置版本**: 固定为 `CONFIG_VERSION = 1`
- **校验失败返回**: `Result.failVoid(new BgmError(...))`，不修改任何已存储配置

### 2.3 同步模块 (`ts/sync/`)

#### `githubConfig.ts` — 配置存储中心

- **PluginStorage 键清单**（详见第三章）
- **默认配置**: `DEFAULT_GITHUB_CONFIG = { owner: 'awujiana', repo: 'Bangumi-Archive-Anime-Excel', branch: 'main', path: 'data/bangumi.jsonl', sourceType: 'github' }`
- **同步策略** (`SyncStrategy`): 'add-update' | 'add-only' | 'update-only' | 'mirror' | 'force-overwrite'
- **同步源类型** (`SyncSourceType`): 'github' | 'gitlab' | 'gitee' | 'local' | 'gist'
- **收藏回写数据源** (`CollectionWritebackSource`): 'api' | 'github'
- **配置完整性校验**: `isGithubConfigComplete()` 检查 owner/repo/path 非空
- **Gist 配置校验**: `isGistConfigured()` 检查 gistId 非空（独立于 GitHub 配置）
- **Raw URL 构造**: `buildRawUrl()` → `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}`
- **首次读取自动填充**: 当所有关键字段为空时，自动写入默认配置

#### `githubSync.ts` — GitHub 数据同步

- **`syncFromGithub()`**: GitHub 专用同步入口
- **`fetchGithubJson()`**: 下载远程 JSON/JSONL 文件
- **`readLocalEntriesForSync()`**: 读取本地 Excel 条目
- **`applyDiffToSheet()`**: 将差异应用到工作表
- **`applyConflictResolutions()`**: 应用用户冲突解决决策
- **缓存管理**: `clearGithubDataCache()`, `isGithubDataCacheValid()`, `getGithubDataCacheAge()`, `loadGithubDataCache()`

#### `githubSyncDiff.ts` — 差异计算 (纯函数)

- **`computeDiff()`**: 零依赖差异计算，可在 Node 测试环境运行
- **`GithubRemoteEntry`**: 远程条目类型 (sid, name, meta_tags, '话数', 等)
- **`LocalRowEntry`**: 本地行条目类型 (row, fields)
- **`GithubSyncDiff`**: 差异记录类型 (sid, changedFields)
- **`SyncStrategy`**: 五种同步策略
- **`SyncTimeFilter`**: 同步时间筛选类型
- **`SYNC_STRATEGY_LABELS`**: 策略中文标签映射

#### `syncSourceRegistry.ts` — 多源同步注册表

- **`syncFromRemote()`**: 按 `sourceType` 选择对应同步源执行
- **`registerSyncSource()`**: 注册自定义同步源
- **`getSyncSource()` / `getRegisteredSourceTypes()` / `isSyncSourceRegistered()`**: 查询注册表

#### `exceltobangumi.ts` — Excel → Bangumi 同步引擎

- **`SyncToBangumiAsync()`**: 核心上传引擎（异步，支持暂停/停止/进度回调）
- **`syncSelectedRows()`**: 仅同步选中行
- **`extractSubjectId()`**: 从 URL 提取 Bangumi Subject ID
- **`mapWatchStatus()`**: 观看状态文本→API 数值
- **`buildJsonPayload()`**: 构建 API 请求体
- **`bgmRequestSync()`**: 发送同步请求到 Bangumi API
- **`setBangumiToken()` / `openBangumiTokenPage()` / `testTokenValidityForRibbon()`**: Token 管理
- **`buildTagsArray()` / `addTagsFromStr()`**: 标签处理

#### `scraping.ts` — Bangumi → Excel 收藏抓取

- **`verifyToken()`**: 异步验证 Token 有效性
- **`fetchAllUserCollections()`**: 分页获取用户全部收藏
- **类型**: `BangumiUserData`, `TokenVerifyResult`, `ApiResponse`

#### `syncRecord.ts` — 同步记录管理

- **工作表名称**: `同步记录` (`SYNC_RECORD_SHEET_NAME`)
- **12 列结构**: SID | 同步时间 | 名称 | URL | 条目类型 | 来源 | 次数 | 内容 | 状态 | 收藏状态 | 备注 | 数据指纹
- **内存缓存**: `_syncRecordSidCache` (SID→行号映射), `_syncRecordListCache` (记录列表)
- **`addSyncRecord()`**: 单条写入（自动去重、颜色标记、合并次数）
- **`addSyncRecords()`**: 批量写入（Range.Value2 一次性写入二维数组）
- **`addSyncRecordSummary()`**: 汇总记录（SID 为空标识）
- **`deduplicateSyncRecords()`**: 按 SID 分组去重，合并次数
- **`formatSyncRecordSheet()`**: 格式化（字体、行高、列宽、边框、居中）
- **`migrateSyncRecordSchema()`**: 旧版 schema 自动迁移（支持 11 列和旧 12 列两种结构）
- **`clearSyncRecords()` / `openSyncRecordSheet()`**: 清空与导航

#### `undoStack.ts` — 撤销栈

- **`UndoEntry` 类型**: `{ type: 'cell', row, col, oldValue, newValue }` | `{ type: 'row-delete', rowSnapshot }`
- **`UndoSession`**: 一次同步操作的所有变更 (timestamp + description + entries[])
- **最大会话数**: 20 (`MAX_SESSIONS`)
- **`beginUndoSession(description)`**: 开始新会话
- **`recordUndoEntry(entry)`**: 记录单元格变更
- **`recordRowDeleteEntry(rowSnapshot)`**: 记录行删除快照
- **`endUndoSession()`**: 结束会话并压入栈
- **`undoLastSync()`**: 撤销最近一次（逆序恢复单元格 → 按行号从大到小恢复删除行）
- **`getLastSessionDescription()`**: 获取最近会话描述（用于 UI 提示）

#### 其他同步模块

- **`githubCache.ts`**: 远程 JSON 数据本地缓存管理
- **`gistSync.ts`**: GitHub Gist 同步源（通过 `api.github.com/gists/{id}` 获取）
- **`giteeSync.ts`**: Gitee 仓库同步源
- **`gitlabSync.ts`**: GitLab 仓库同步源
- **`localFileSync.ts`**: 本地文件同步源
- **`conflictResolver.ts`**: 冲突检测与解决策略
- **`pureUtils.ts` / `pureUtilsCore.ts`**: 零依赖纯工具函数
- **`exportJsonl.ts`**: Excel → JSONL 文件导出

### 2.4 UI 模块 (`ts/ui/`)

#### `dialog.ts` — 对话框系统

- `showAlert()`: 提示对话框
- `showConfirm()`: 确认对话框（带回调）
- `showError()`: 错误对话框
- `showSuccess()`: 成功提示
- `showInput()`: 输入对话框
- `showToast()`: Toast 通知
- `showSyncResult()`: 同步结果弹窗（可展开详情）
- `showSyncProgressDialog()` / `updateSyncProgressDialog()` / `completeSyncProgressDialog()`: 进度弹窗
- `hideSyncProgressDialog()`: 关闭进度弹窗
- 类型: `DialogButton`, `DialogConfig`, `DialogCallback`, `DialogOptions`, `SyncProgressStats`

#### `preview.ts` — 预览组件

- `previewSyncContent()`: 预览同步内容
- `closeDetailModal()`: 关闭详情弹窗
- `syncAllRows()`: 执行全量同步（从 UI 层调用 sync 引擎）
- 类型: `DetailItem`, `PreviewItem`, `DetailPreviewData`

#### `handlers/` — 事件处理器

- **`index.ts`**: 主 handler 分发，`initHandlers()` 注册所有监听器
- **`sync.ts`**: 同步相关 handler（GitHub 同步、撤销等）
- **`token.ts`**: Token 相关 handler（设置、验证、状态更新）
- **`sheet.ts`**: 工作表相关 handler（锁定、切换、表头检测）
- **`_constants.ts`**: 中文常量映射

#### 其他 UI 模块

- **`message.ts`**: 状态栏消息 (`setStatus()`, `initMessageListener()`)
- **`conflictResolver.ts`**: 冲突解决 UI (`showConflictResolver()`)
- **`syncResultDialog.ts`**: 同步结果增强弹窗 (`showSyncResultDialog()`, `computeDateStatsFromSheet()`)

### 2.5 工具模块 (`ts/tools/`)

#### `events.ts` — 事件总线

- **`EventBus` 类**: 发布-订阅系统
  - `.on(eventName, handler, once?)`: 订阅
  - `.once(eventName, handler)`: 单次订阅
  - `.off(eventName, handler?)`: 退订
  - `.emit(eventName, data?)`: 发布（捕获异常，不中断其他处理器）
  - `.has(eventName)` / `.listenerCount(eventName)`: 查询
  - `.clear()`: 清空
- **`BGM_EVENTS` 常量**:
  - `TOKEN_UPDATED`, `USER_ID_UPDATED`, `USER_NAME_UPDATED`
  - `SYNC_PROGRESS`, `SYNC_COMPLETED`, `SYNC_ERROR`
  - `SYNC_STATE_CHANGED` (running/idle/paused/resumed/stopped)
  - `SHEET_LOCKED`, `SHEET_UNLOCKED`
  - `CONFIG_UPDATED`
  - `REQUEST_GITHUB_SYNC`, `REQUEST_UNDO_LAST_SYNC`
- **全局实例**: `eventBus`（单例）

#### `logger.ts` — 日志系统

- **分级日志**: `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()`
- **RingBuffer**: 容量 1000 条，先进先出
- **Token 脱敏**: `maskToken()` (保留后 4 位), `maskSensitiveData()` (检测 token/Bearer 模式)
- **导出**: `exportLogsToFile()` 下载日志文件
- **不污染全局 console**: 由 `bgmLog()` 上层控制是否输出

#### `http.ts` — HTTP 客户端

- **`httpRequest<T>(endpoint, options)`**: 核心请求函数
  - 自动重试（429 限流时指数退避）
  - 支持 AbortSignal 取消
  - 可选 Zod Schema 运行时校验
  - 返回 `Result<{ status, data }>` 类型
- **便捷方法**: `httpGet()`, `httpPost()`, `httpPut()`, `httpDelete()`
- **Endpoint 安全校验**: 禁止 `..` 路径遍历和 `http` 前缀
- **进度回调**: `onProgress(current, total)` 用于上传进度
- **默认超时**: 30000ms
- **错误消息**: 内置 HTTP 状态码→中文描述映射

#### `config.ts` — 配置工具

- **`CONFIG_KEYS`**: TOKEN, USER_ID, INCREMENTAL_SYNC, SKIP_CONFLICTS, LOCKED_SHEET, LOCKED_WORKBOOK, ENABLE_SYNC_RECORD
- **`setConfig(key, value)`**: 写入 PluginStorage + 触发 eventBus + 跨文档 postMessage 广播
- **`getConfig(key, defaultValue, silent)`**: 读取（支持静默模式用于轮询）
- **`removeConfig(key)`**: 删除配置
- **布尔配置便捷方法**: `setIncrementalSync()`, `getIncrementalSync()`, `setSkipConflicts()`, `getSkipConflicts()`, `setSyncRecordEnabled()`, `getSyncRecordEnabled()`

#### `util/` — 通用工具

- **`cell.ts`**: `getCell()`, `getCellValue()`, `setCellValue()`, `getSheetByIndex()`
- **`sheet.ts`**: `readRangeValues()`, `cacheGet()`, `findHeaderRow()`, `getColumnMap()`, `clearSheetCache()`, `getLastRow()`, `isEmptyValue()`, `getDataSheet()`, `ensureSheetHeaders()`
- **`sleep.ts`**: `sleep()`, `delay()`
- **`index.ts`**: `BGM` 全局命名空间、`bgmLog()`、`getApp()`、Token 存储、用户信息、`showBangumiPanel()`、辅助函数
- **`stringUtils.ts`**: `colNumToLetter()`, `trim()`, `escapeHtml()`, `calcFingerprint()`

#### 其他工具

- **`debounce.ts`**: 防抖函数
- **`sanitize.ts`**: HTML 清洗
- **`autoFillUrl.ts`**: URL 自动填充 (`autoFillUrls()`, `showAutoFillUrlDialog()`)
- **`wps.ts`**: WPS 类型守卫 (`isWpsApp()`, `isWpsWorksheet()`, `isWpsRange()`) 与完整 WPS 类型定义

### 2.6 Schema 模块 (`ts/schemas/`)

#### `pluginStorage.ts` — PluginStorage 类型校验

- **`FullConfigSchema`**: 完整配置校验（version + exportedAt + githubConfig + token + userId）
- **`SyncStrategySchema`**: 同步策略校验

#### `bgmCollection.ts` — 收藏数据校验

- Bangumi 收藏条目的 Zod Schema 定义

#### `bgmUser.ts` — 用户数据校验

- Bangumi 用户信息的 Zod Schema 定义

#### `githubEntry.ts` — GitHub 条目校验

- GitHub 远程条目的 Zod Schema 定义

---

## 三、配置体系

### 3.1 PluginStorage 键清单

以下是项目使用的全部 PluginStorage 键及其默认值和用途：

#### 用户身份配置

| 键名                | 类型   | 默认值    | 说明                           |
| ------------------- | ------ | --------- | ------------------------------ |
| `bgm_token`         | string | `''` (空) | Bangumi Access Token，明文存储 |
| `bgm_token_expires` | string | `''` (空) | Token 过期时间戳（秒）         |
| `bgm_user_id`       | string | `null`    | Bangumi 用户 ID                |
| `bgm_username`      | string | `null`    | Bangumi 用户名（昵称）         |
| `bgm_avatar_url`    | string | `''` (空) | 用户头像 URL                   |

#### 功能开关配置

| 键名                     | 类型   | 默认值    | 说明                          |
| ------------------------ | ------ | --------- | ----------------------------- |
| `bgm_incremental_sync`   | string | `'false'` | 增量同步开关 ('true'/'false') |
| `bgm_skip_conflicts`     | string | `'false'` | 跳过冲突开关 ('true'/'false') |
| `bgm_enable_sync_record` | string | `'false'` | 同步记录开关 ('true'/'false') |
| `bgm_locked_sheet`       | string | `null`    | 锁定的工作表索引              |
| `bgm_locked_workbook`    | string | `null`    | 锁定的工作簿名称              |

#### GitHub / 远程同步配置

| 键名                          | 类型   | 默认值                          | 说明              |
| ----------------------------- | ------ | ------------------------------- | ----------------- |
| `github_sync_owner`           | string | `'awujiana'`                    | GitHub 仓库所有者 |
| `github_sync_repo`            | string | `'Bangumi-Archive-Anime-Excel'` | GitHub 仓库名     |
| `github_sync_branch`          | string | `'main'`                        | 分支名            |
| `github_sync_path`            | string | `'data/bangumi.jsonl'`          | JSONL 文件路径    |
| `github_sync_strategy`        | string | `'add-update'`                  | 同步策略          |
| `github_sync_source_type`     | string | `'github'`                      | 同步源类型        |
| `github_sync_gist_id`         | string | `''` (空)                       | GitHub Gist ID    |
| `collection_writeback_source` | string | `'api'`                         | 收藏回写数据源    |

#### UI 与通信配置

| 键名                      | 类型   | 默认值    | 说明                                      |
| ------------------------- | ------ | --------- | ----------------------------------------- |
| `EnableFlag`              | string | `'false'` | WPS 加载项启用标志（Ribbon 初始化时设置） |
| `ApiEventFlag`            | string | `'false'` | API 事件标志（Ribbon 初始化时设置）       |
| `taskpane_id`             | string | `null`    | 任务面板 ID（由 `CreateTaskPane` 返回）   |
| `bgm_panel_shown_at`      | string | 时间戳    | 面板显示信号（用于触发 Taskpane 刷新）    |
| `bgm_request_github_sync` | string | 时间戳    | GitHub 同步请求信号（Ribbon→Taskpane）    |
| `bgm_request_undo_sync`   | string | 时间戳    | 撤销同步请求信号（Ribbon→Taskpane）       |
| `manifest_base_path`      | string | `null`    | 清单基础路径（用于 URL 解析）             |

### 3.2 默认值与初始化

**首次初始化流程：**

1. `ribbon-entry.ts` 启动 → `OnAddinLoad()` → 设置 `EnableFlag='false'` 和 `ApiEventFlag='false'`
2. `taskpane-entry.ts` 启动 → `initTaskpane()` → 从 PluginStorage 恢复用户信息
3. `getGithubConfig()` 首次读取时，若 owner/repo/path 全为空，自动写入 `DEFAULT_GITHUB_CONFIG`
4. Token 通过 `loadBgToken()` 读取，检测到历史 XOR 加密格式（`v1.` 前缀）时自动升级为明文

### 3.3 配置读写路径

```
写入路径:
  setConfig(key, value)
    → PluginStorage.setItem(key, value)
    → eventBus.emit(CONFIG_UPDATED, { key, value })
    → postMessage({ type: 'BGM:configUpdated', data: { key, value } })

读取路径:
  getConfig(key, defaultValue, silent?)
    → PluginStorage.getItem(key) ?? defaultValue

跨 WebView 同步:
  Ribbon ↔ Taskpane:
    - postMessage (同源 iframe 直接通信)
    - PluginStorage 轮询 (每 2 秒，兜底方案)
```

---

## 四、数据流

### 4.1 上传同步流程 (Excel → Bangumi)

```
用户点击「同步到 Bangumi」
    │
    ▼
ribbonService.syncWithConfirmation()
    │
    ├─ getDataSheet() → 获取数据工作表
    ├─ findHeaderRow() → 定位表头行
    ├─ getColumnMap() → 构建列映射
    ├─ getLastRow() → 获取数据末行
    │
    ├─ getSyncPreview() → 预览统计（纯扫描）
    │   ├─ readRangeValues() → 批量读取 Excel 数据
    │   ├─ getFilterStatus() → 检测筛选状态
    │   └─ 逐行统计：有效/待同步/已上传/无URL/空状态
    │
    ├─ 读取 PluginStorage → 冲突策略 + 增量同步开关
    │
    ├─ WPS MessageBox → 用户确认
    │
    ├─ detectConflicts() → 冲突检测（异步）
    │   ├─ fetchAllUserCollections(token) → 获取 Bangumi 收藏快照
    │   └─ 遍历 Excel 可见行，比对 type 字段差异
    │
    ├─ BGM.sync.enterRunningState() → 进入运行状态
    │
    ▼
SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, options)
    │
    ├─ 遍历可见行
    │   ├─ extractSubjectId(bgmUrl) → 提取 SID
    │   ├─ mapWatchStatus(status) → 文本→API 数值
    │   ├─ buildJsonPayload(rowData) → 构建请求体
    │   ├─ bgmRequestSync(payload) → HTTP POST 到 Bangumi API
    │   └─ 更新 Excel 单元格颜色 (SUCCESS/FAIL/SKIP)
    │
    ├─ 支持暂停/停止/恢复 (waitForResume 每 50ms 轮询)
    ├─ 进度回调 (StatusBar 更新)
    │
    └─ addSyncRecords() → 批量写入同步记录
    │
    ▼
BGM.sync.exitRunningState() → 退出运行状态
    │
    └─ WPS MessageBox → 显示同步结果统计
```

### 4.2 收藏回写流程 (Bangumi → Excel)

```
用户点击「从 Bangumi 同步收藏」
    │
    ▼
handlers/sync.ts → syncCollectionFromBgm
    │
    ├─ loadBgToken() → 读取 Token
    ├─ fetchAllUserCollections(token) → 分页获取全部收藏
    │   ├─ BGM API /v0/users/-/collections?type=...&limit=50
    │   └─ 自动处理分页 offset
    │
    ▼
遍历 Excel 行
    │
    ├─ 对每行提取 SID
    ├─ 在 Bangumi 收藏 Map 中查找匹配
    ├─ 将远程数据回写到 Excel 对应列
    │   ├─ 打分 → 打分列
    │   ├─ 标签 → 标签/分级列
    │   ├─ 感言 → 剧透/感言列
    │   └─ 类型 → 是否看完列
    │
    └─ 更新单元格颜色标记
```

### 4.3 数据同步流程 (远程仓库 → Excel)

```
用户点击「从仓库同步」或 Ribbon 按钮
    │
    ▼
syncFromRemote(sourceType)
    │
    ├─ getSyncSource(sourceType) → 从注册表获取同步源
    │
    ▼
syncSource.fetch() → 下载远程数据
    │
    ├─ GitHub: fetchGithubJson() → raw.githubusercontent.com
    ├─ Gist: fetchGithubJson() → api.github.com/gists/{id}
    ├─ GitLab/Gitee: 对应 API
    ├─ 本地文件: 读取本地路径
    │
    ▼
computeDiff(remoteEntries, localEntries, strategy)
    │
    ├─ 按 SID 匹配远程与本地条目
    ├─ 根据 SyncStrategy 计算差异
    │   ├─ 'add-update': 新增 + 更新
    │   ├─ 'add-only': 仅新增
    │   ├─ 'update-only': 仅更新
    │   ├─ 'mirror': 镜像同步（含删除）
    │   └─ 'force-overwrite': 强制覆盖
    │
    ▼
用户确认（预览变更）
    │
    ├─ 冲突检测：detectGithubConflicts() → 字段级差异
    ├─ showConflictResolver() → 冲突解决 UI
    │
    ▼
applyDiffToSheet(diffList)
    │
    ├─ beginUndoSession(description) → 开始撤销会话
    ├─ 遍历差异列表
    │   ├─ 新增行 → 插入新行 + 写入数据 + recordUndoEntry
    │   ├─ 更新行 → 覆盖单元格 + recordUndoEntry
    │   └─ 删除行 → 移除行 + recordRowDeleteEntry
    ├─ 应用颜色标记
    ├─ endUndoSession() → 结束会话压入撤销栈
    │
    └─ addSyncRecordSummary() → 写入汇总记录
```

---

## 五、错误处理体系

### 5.1 错误分类

| 错误级别 | 常量值 | 行为                  | 使用场景               |
| -------- | ------ | --------------------- | ---------------------- |
| `SILENT` | 0      | 静默处理              | 内部轮询、非关键路径   |
| `WARN`   | 1      | 控制台警告            | 可恢复的异常、降级场景 |
| `ERROR`  | 2      | 控制台错误 + 可选弹窗 | 用户可见的操作失败     |
| `THROW`  | 3      | 抛出 BgmError         | 需要上层处理的严重错误 |
| `INFO`   | 4      | 信息级日志            | 调试信息               |

**错误码规范：**

- `TOKEN_INVALID` / `TOKEN_EXPIRED`: Token 相关
- `NETWORK_ERROR`: 网络不可达
- `HTTP_ERROR`: HTTP 状态码错误
- `VALIDATION_ERROR`: 输入校验失败
- `SCHEMA_VALIDATION_ERROR`: Zod 响应校验失败
- `CONFIG_PARSE_ERROR` / `CONFIG_INVALID`: 配置导入失败
- `MAX_RETRIES_EXCEEDED`: 超过最大重试次数
- `ABORTED`: 请求被取消

### 5.2 全局兜底

```
第一层: 局部 try/catch
    每个异步操作都有独立的 try/catch，使用 BGM.handleError() 统一处理

第二层: BGM.handleError(error, options)
    - 自动 Error → BgmError 转换
    - 根据 level 决定输出行为
    - 可选 showAlert 弹窗
    - 自动记录调用上下文

第三层: unhandledrejection 监听
    在 ts/index.ts 中注册全局 Promise 拒绝监听
    - 仅做 console.error 记录
    - event.preventDefault() 阻止默认行为

第四层: EventBus 隔离
    EventBus.emit() 内部捕获每个处理器的异常
    单个处理器失败不影响其他处理器执行
```

### 5.3 用户提示策略

| 场景       | Ribbon 环境                           | Taskpane 环境                        |
| ---------- | ------------------------------------- | ------------------------------------ |
| Token 设置 | `app.InputBox()` + `app.MessageBox()` | DOM `<input>` + `showToast()`        |
| Token 验证 | XHR + `wpsMsgBox()`                   | `httpRequest()` + `showToast()`      |
| 同步确认   | `app.MessageBox(confirmMsg, 4+32)`    | `showConfirm()` 对话框               |
| 进度反馈   | `app.StatusBar` 状态栏文本            | `showSyncProgressDialog()` 进度弹窗  |
| 成功通知   | `app.MessageBox('同步完成！...')`     | `showSuccess()` + `showSyncResult()` |
| 错误通知   | `wpsMsgBox('错误信息', 0, 16)`        | `showError()` + 错误弹窗             |

**Ribbon 环境特殊处理：** Ribbon 上下文中 `index.html` 对用户不可见，DOM 弹窗（showAlert/showSuccess）无法展示。因此 Ribbon 版本的用户交互统一使用 `wpsMsgBox()`（带浏览器 `alert` 兜底）。

---

## 六、跨 WebView 通信

### 6.1 Ribbon ↔ Taskpane 通信机制

WPS 中 Ribbon 和 Taskpane 是**独立的 iframe**（独立 WebView 上下文），通信存在障碍。项目采用双通道保障：

#### 通道 1: postMessage（主通道）

- **方向**: Taskpane → Ribbon
- **触发**: `config.setConfig()` / `config.removeConfig()`
- **实现**:
  ```typescript
  window.parent.postMessage({ type: 'BGM:configUpdated', data: { key, value } }, '*')
  window.top.postMessage({ type: 'BGM:configUpdated', data: { key, value } }, '*')
  window.postMessage({ type: 'BGM:configUpdated', data: { key, value } }, '*')
  ```
- **Ribbon 侧监听**: `initRibbonMessageListener()` 注册 `window.addEventListener('message', handler)`
- **Origin 校验**: 白名单 `['null', '', window.location.origin]`

#### 通道 2: PluginStorage 轮询（兜底通道）

- **方向**: 双向
- **间隔**: 每 2 秒
- **Ribbon 侧**: `startRibbonConfigPolling()` 轮询 `bgm_incremental_sync`, `bgm_skip_conflicts`, `bgm_enable_sync_record`
- **Taskpane 侧**: `userInfoPolling` 轮询用户信息、Token 状态、面板显示信号
- **检测到变化时**: 调用 `ribbonUI.InvalidateControl()` 刷新 Ribbon 按钮状态

#### 通信信号约定

| PluginStorage 键                  | 方向              | 触发时机                      | 接收方行为                                      |
| --------------------------------- | ----------------- | ----------------------------- | ----------------------------------------------- |
| `bgm_request_github_sync`         | Ribbon → Taskpane | 用户点击 Ribbon「从仓库同步」 | Taskpane 轮询检测 → 触发 syncFromGithub handler |
| `bgm_request_undo_sync`           | Ribbon → Taskpane | 用户点击 Ribbon「撤销同步」   | Taskpane 轮询检测 → 触发 executeUndoLastSync    |
| `bgm_panel_shown_at`              | Taskpane → 自身   | 面板从隐藏变为显示            | Taskpane 轮询检测 → 刷新工作表列表              |
| `BGM:configUpdated` (postMessage) | Taskpane → Ribbon | 配置变更                      | Ribbon InvalidateControl 刷新按钮               |

### 6.2 PluginStorage 轮询

```
Ribbon 侧 (每 2 秒):
  setInterval(() => {
    incrementalSync = getIncrementalSync(true)  // silent=true
    skipConflicts = getSkipConflicts(true)
    enableSyncRecord = getSyncRecordEnabled(true)

    if (值变化) ribbonUI.InvalidateControl(controlId)
  }, 2000)

Taskpane 侧 (每 2 秒):
  setInterval(() => {
    // 检测面板显示信号
    bgm_panel_shown_at → 刷新工作表

    // 检测同步请求信号
    bgm_request_github_sync → 触发 syncFromGithub
    bgm_request_undo_sync → 触发 executeUndoLastSync

    // 恢复用户信息
    _getBgmUserId() → 若缓存为空则从 PluginStorage 回读
  }, 2000)
```

### 6.3 EventBus 事件

EventBus 仅在**同一 WebView 上下文**内生效，用于模块间松耦合通信：

| 事件名                            | 触发方                 | 订阅方                  | 说明                           |
| --------------------------------- | ---------------------- | ----------------------- | ------------------------------ |
| `state:tokenUpdated`              | Token 写入后           | Taskpane 面板、handlers | 刷新 Token 状态显示            |
| `state:userIdUpdated`             | 用户 ID 写入后         | Taskpane 面板           | 刷新用户信息显示               |
| `state:userNameUpdated`           | 用户名写入后           | Taskpane 面板           | 刷新用户信息显示               |
| `sync:progress`                   | 同步引擎               | Taskpane 进度弹窗       | 更新进度条                     |
| `sync:completed`                  | 同步引擎               | Taskpane 结果弹窗       | 显示同步结果                   |
| `sync:error`                      | 同步引擎               | Taskpane 错误提示       | 显示错误信息                   |
| `sync:stateChanged`               | BGM.sync 状态变更      | UI 组件                 | running/idle/paused 等状态切换 |
| `sheet:locked` / `sheet:unlocked` | 工作表锁定/解锁        | UI 组件                 | 刷新锁定状态                   |
| `config:updated`                  | 配置写入后             | Ribbon/TaksPane 多处    | 配置变更广播                   |
| `request:githubSync`              | PluginStorage 信号触发 | sync handler            | 执行 GitHub 同步               |
| `request:undoLastSync`            | PluginStorage 信号触发 | sync handler            | 执行撤销操作                   |

---

## 七、构建与发布

### 7.1 构建脚本

项目使用 TypeScript 编译，构建流程由以下步骤组成：

```
源文件 (ts/*.ts)
    │
    ▼
TypeScript 编译器 (tsconfig.json)
    │
    ▼
编译输出 (dist/ 或 lib/)
    │
    ▼
打包为 WPS 加载项 (manifest.xml + HTML + JS)
```

**关键配置：**

- 所有模块使用 ES Module 导出
- 模块路径统一使用 `.js` 扩展名（TypeScript 标准约定）
- 通过 barrel export (`index.ts`) 控制公共 API 面
- `typeof window !== 'undefined'` 守卫确保 Node 环境（测试）不触发副作用

### 7.2 测试命令

项目使用 Vitest 作为测试框架：

```bash
# 运行全部测试
npx vitest run

# 运行测试并查看覆盖率
npx vitest run --coverage

# 开发模式持续监听
npx vitest
```

**可测试的纯函数模块：**

- `sync/githubSyncDiff.ts`: 差异计算（零依赖，可在 Node 环境直接运行）
- `sync/pureUtils.ts` / `pureUtilsCore.ts`: 纯工具函数
- `core/crypto.ts`: Token 加解密逻辑
- `core/result.ts`: Result 类型
- `tools/events.ts`: EventBus
- `tools/logger.ts`: 日志与脱敏
- `sync/githubConfig.ts`: 配置读写
- `sync/undoStack.ts`: 撤销栈逻辑

**测试隔离设计：**

- `entry/` 模块使用 `typeof window !== 'undefined'` 守卫，测试环境导入不触发副作用
- `ribbon.ts` 的消息监听和轮询通过显式 `initRibbon()` 调用启动
- `taskpane/index.ts` 的 DOM 操作通过 `initTaskpane()` 显式调用触发

### 7.3 代码规范

**TypeScript 严格模式：**

- `strict: true`（所有严格类型检查）
- `exactOptionalPropertyTypes: true`（可选属性不允许赋 undefined）
- `useUnknownInCatchVariables: true`（catch 变量为 unknown 类型）
- `no-invalid-void-type: true`（禁止 void 类型误用）

**代码风格：**

- **不添加注释**（除非明确要求）
- 所有错误通过 `BGM.handleError()` 或 `Result<T>` 统一处理
- 异步操作必须有 try/catch 或 `.catch()` 防止未处理的 Promise rejection
- Token 等敏感信息通过 `logger.maskSensitiveData()` 自动脱敏
- 模块通过 barrel export 导入，避免循环依赖
- PluginStorage 键统一在常量中定义，禁止硬编码字符串

**命名约定：**

- PluginStorage 键: `bgm_*` 前缀（用户配置）、`github_sync_*` 前缀（仓库配置）
- 事件名: `state:*`（状态）、`sync:*`（同步）、`sheet:*`（工作表）、`config:*`（配置）、`request:*`（请求）
- 错误码: 大写下划线命名 (`TOKEN_INVALID`, `NETWORK_ERROR`)
- 配置常量: `UPPER_CASE` 命名 (`CONFIG_KEYS`, `BGM_CONFIG`)

**文件组织约定：**

- 单文件不超过 500 行，超过时拆分为子模块
- 每个模块单一职责
- `index.ts` 作为 barrel export 入口
- `entry/` 目录存放显式启动入口
- `schemas/` 目录存放 Zod 校验模式
- `util/` 子目录拆分工具函数（cell.ts / sheet.ts / sleep.ts）
