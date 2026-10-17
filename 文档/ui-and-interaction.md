# Bangumi 同步工具 — UI 与交互流程文档

> **版本**: v3.5  
> **最后更新**: 2026-08-28  
> **适用**: WPS/Excel 加载项 Bangumi 同步工具

---

## 1. 概述

Bangumi 同步工具是一个 WPS/Excel 加载项，用于在本地 Excel 表格和 Bangumi 番组计划（Bangumi.tv）之间同步收藏数据。

**核心能力**：

- 📤 **上传同步**：将 Excel 中的观看状态、评分、标签同步到 Bangumi
- 📥 **数据同步**：从远程仓库（GitHub/GitLab/Gitee）下载 Bangumi 资料数据到 Excel
- ↩️ **收藏下载**：从 Bangumi 拉取收藏列表；工作表为空时可自动填充为 Bangumi 账号的收藏条目，再标记到 Excel

**界面模式**：采用"主面板 + 设置面板"的双面板（WPS 任务窗格）设计，支持动态位置协调。

---

## 2. 界面架构

### 2.1 双面板布局

```
┌───────────────────────────────────────────────────────────┐
│                    WPS/Excel 主窗口                         │
│                                                           │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │   主面板          │  │   设置面板        │              │
│  │   panel.html     │  │   settings.html   │              │
│  │                  │  │                  │              │
│  │   默认停靠: 左侧  │  │   动态停靠:       │              │
│  │                  │  │ 主面板可见 → 右侧  │              │
│  └──────────────────┘  │ 主面板隐藏 → 左侧  │              │
│                         └──────────────────┘              │
│  ↑ 用户关闭主面板后，设置面板自动切换到左侧                    │
└───────────────────────────────────────────────────────────┘
```

| 属性      | 主面板               | 设置面板           |
| --------- | -------------------- | ------------------ |
| URL       | `ui/panel.html`      | `ui/settings.html` |
| 默认停靠  | 左侧                 | 动态（见下方）     |
| 生命周期  | 持久化，由功能区创建 | 按需创建/销毁      |
| 持久化 ID | `panel_id`           | `settings_pane_id` |

### 2.2 动态停靠逻辑

设置面板的停靠位置由主面板的可见性决定：

```
showSettingsPanel() 调用时：
    │
    ├── 读取 PluginStorage['panel_id']
    ├── GetTaskPane(panel_id) → 检查主面板 Visible
    │
    ├── 主面板可见？
    │   ├── 是  → 设置面板 DockPosition = Right
    │   └── 否  → 设置面板 DockPosition = Left
    │
    └── 显示设置面板
```

---

## 3. 主面板 UI 结构

### 3.1 顶部操作栏

位于面板顶部标题栏右侧，提供 3 个图标式快捷操作按钮（统一 SVG 线性图标风格）与用户头像：

```
┌─────────────────────────────────────────────────────────────┐
│  Bangumi 同步工具                           💾  ⬆️  ⚙️  [头像]│
│  Bangumi 数据管理工具 · 上传同步 / 数据同步 / 收藏下载        │
└─────────────────────────────────────────────────────────────┘
```

| 按钮     | ID             | Data-Action     | 图标含义    | 功能                                                                                   |
| -------- | -------------- | --------------- | ----------- | -------------------------------------------------------------------------------------- |
| **保存** | `saveBtn`      | `saveAllConfig` | 云存储+对勾 | 一键保存所有配置（Token/GitHub/同步偏好）到 PluginStorage                              |
| **导出** | `exportBtn`    | `exportConfig`  | 向上箭头    | 导出当前配置为 JSON，复制到剪贴板                                                      |
| **设置** | `settingsBtn`  | `openSettings`  | 齿轮        | 打开独立设置面板（动态停靠位置）                                                       |
| **头像** | `topbarAvatar` | —               | 用户头像    | 窄屏（≤880px）下显示在顶栏右上角，展示当前登录用户头像；宽屏时隐藏（由侧栏账户卡展示） |

> 面板不再内置自定义关闭按钮，关闭由 WPS 任务窗格标题栏自带的 × 完成。

### 3.2 功能区块

主面板采用从上到下的分区布局：

#### A. 快捷操作区

- 📤 **上传同步**：将 Excel 数据同步至 Bangumi API
- 📋 **选中行同步**：仅同步当前选中的单元格范围
- 📥 **收藏下载**：从 Bangumi 拉取收藏列表；工作表为空时先自动填充 Bangumi 账号收藏条目，再标记到 Excel
- 👁️ **预览同步**：弹窗形式预览即将同步的数据

#### B. Token 设置区

- 显示 Token 状态（未设置/有效/已过期）
- **设置/修改**：打开输入对话框
- **📋 复制**：复制 Token 到剪贴板
- **测试**：调用 API 验证 Token 有效性
- **清除**：移除当前存储的 Token

#### C. 用户信息区

- 设置/查看用户 ID
- 快速跳转到 Bangumi 用户收藏页

#### D. 数据选择区

- **选择模式**：🤖 自动模式（识别筛选后可见数据）/ ✋ 手动模式（指定行号范围）
- **选择工作簿**：下拉列表选择目标 Excel 文件
- **选择工作表**：下拉列表选择目标 Sheet
- **工作表锁定**：锁定后防止误操作
- **数据清洗**：去除重复行，合并标签

#### E. 数据预览区

- 展示将被同步的数据摘要
- **🔍 放大预览**：弹窗查看详细列表
- **📋 预览详情**：查看完整同步内容
- **📥 收藏下载**：快速触发回写流程

#### F. 冲突处理策略区

- **策略选择**：跳过冲突（保留 Bangumi 数据）/ Excel 覆盖
- **增量同步**：仅同步有变化的条目

#### G. 同步记录区

- 启用/禁用同步历史记录
- 查看/清除/去重同步记录
- 设置记录表格式（字体/边框/列宽）

#### H. 数据同步区（远程仓库 → Excel）

- 支持 5 种数据源：GitHub / GitLab / Gitee / Gist / 本地文件
- 多种同步策略：新增+更新、仅新增、镜像同步、强制覆盖等
- 时间筛选器：按开播日期过滤
- 操作按钮：💾保存配置 / ⬇️立即同步 / ↩️撤销 / 🔌测试 / 🗑️清缓存

#### I. 系统日志区

- 查看最近 1000 条日志
- 按级别（ERROR/WARN/INFO/DEBUG）筛选 —— 该筛选**同时决定「导出」的内容范围**，避免「眼前筛过、导出却是全量」
- 导出日志（TXT；带级别筛选时文件名形如 `bgm-系统日志-ERROR-<时间戳>.txt`）

---

## 4. 设置面板 UI 结构

设置面板 (`ui/settings.html`) 提供集中化的配置管理界面：

```
┌─────────────────────────────────────────────────────────────┐
│  ⚙️ BGM 设置                     [导出所有配置] [导入配置]    │
│  插件配置管理 · Token · 同步偏好 · 外观 · 数据源              │
├──────────┬──────────────────────────────────────────────────┤
│ 功能导航  │  主区（按区块纵向排列，滚动高亮联动）            │
│ 🎨 外观   │  🎨 外观主题                                     │
│ 🔑 账户   │  🔑 账户与凭证                                   │
│ 🔄 同步   │  🔄 同步偏好                                     │
│ ⚖️ 冲突   │  ⚖️ 冲突处理策略                                 │
│ 🗄️ 远程   │  🗄️ 远程仓库配置                                 │
│ 📦 导入   │  📦 配置导入导出                                 │
│ 📜 日志   │  📜 系统日志                                     │
│ ℹ️ 关于   │  ℹ️ 关于                                         │
└──────────┴──────────────────────────────────────────────────┘
```

> 功能导航支持「仅显示图标」模式（`bgm_nav_icons_only`）：宽屏下只显示图标、鼠标悬停显示名称；窄屏（≤880px）自动恢复为图标+文字横排。

### 4.1 功能区块

设置面板采用「顶栏 + 侧边功能导航 + 主区」布局，侧边导航支持滚动高亮（scrollspy）与锚点跳转，并可通过「导航仅显示图标」开关切换为纯图标模式（鼠标悬停显示名称）。

| 区块            | 内容                                                                           |
| --------------- | ------------------------------------------------------------------------------ |
| 🎨 外观主题     | 主题模式（深色 / 浅色 / 跟随系统）、主题预览卡片                               |
| 🔑 Token 管理   | 状态显示、设置/修改、复制、清除、测试                                          |
| 👤 用户信息     | 用户 ID 设置、打开收藏页                                                       |
| 🔄 同步偏好     | 增量同步、冲突跳过、同步记录、导航仅图标开关、默认列表类型、时间筛选、刷新间隔 |
| ⚔️ 冲突处理策略 | 跳过冲突 / Excel 覆盖                                                          |
| 🗄️ 远程仓库配置 | owner/repo/branch/path、保存/测试/清除缓存                                     |
| 📦 配置导入导出 | 导出配置 / 导入配置                                                            |
| 📜 系统日志     | 查看日志 / 清空日志                                                            |
| ℹ️ 关于         | 版本信息与功能说明                                                             |

### 4.2 关闭机制

设置面板不再内置自定义关闭按钮，由 WPS 任务窗格标题栏自带的 × 关闭（与主面板一致）。关闭后下次打开时会根据主面板可见性重新协调停靠位置。

---

## 5. 核心交互流程

### 5.1 配置保存流程（💾 保存按钮）

```
用户点击 💾 保存
    │
    ▼
handleActionClick('saveAllConfig')
    │
    ▼
依次收集并持久化：
    ├── Token → storeBgToken(token)
    ├── 用户 ID → _getBgmUserId()
    ├── GitHub 配置 → setGithubConfig(cfg)
    ├── 增量同步 → setIncrementalSync(val)
    ├── 冲突策略 → setSkipConflicts(val)
    ├── 同步记录 → setSyncRecordEnabled(val)
    └── 同步策略 → setSyncStrategy(val)
    │
    ▼
Toast 提示："配置已保存: Token; 用户ID: xxx; GitHub: ..."
```

> 设置面板中部分配置采用**即时保存**（无需点击保存按钮）：主题模式、默认列表类型、时间筛选范围、刷新间隔、导航仅图标开关等在 `change` 事件触发时即校验并写入 PluginStorage，并 Toast 反馈成功 / 失败；刷新间隔非法输入（非 0–1440 整数）会弹出警告并回滚为上次有效值。

### 5.2 配置导出流程（⬆️ 导出按钮）

```
用户点击 ⬆️ 导出
    │
    ▼
handleActionClick('exportConfig')
    │
    ├── 收集所有配置项
    ├── 序列化为 JSON 字符串
    ├── 复制到剪贴板
    └── Toast 提示导出结果
```

### 5.3 数据同步流程（📤 上传同步）

```
1. 选择目标工作表/范围
        ↓
2. 点击 📤 上传同步 / 📋 选中行同步
        ↓
3. 系统自动执行：
   a. 检测筛选状态（getFilterStatus）
   b. 收集可见行数据（getSequentialRowsBySeqCol）
   c. 预处理同步任务（buildJsonPayload）
      - 空状态默认设为"想看"(type=1)
   d. 批量同步请求（batchSyncRequests）
      - 指数退避重试
      - 竞态防护（递增请求 ID）
        ↓
4. 实时反馈：
   - 进度条更新
   - 成功/失败/跳过计数
   - 异常行高亮
        ↓
5. 完成：写入同步记录 + Toast 总结
```

### 5.4 双面板位置协调流程

```
[初始] 主面板创建 → DockPosition = Left
        ↓
[点击 ⚙️ 设置]
    showSettingsPanel()
        ↓
    ┌─ 主面板可见？ ──┐
    │                  │
   是                 否
    │                  │
    ▼                  ▼
设置面板 → Right   设置面板 → Left
    │                  │
    ↓                  ↓
[通过 WPS 任务窗格标题栏 × 关闭主面板]
    closePanel() → mainPane.Visible = false
        ↓
[再次点击 ⚙️ 设置]
    showSettingsPanel()
        ↓
    主面板已隐藏 → 设置面板 → Left
```

### 5.5 撤销同步流程

```
1. 点击 ↩️ 撤销上次同步
        ↓
2. undoLastSync 处理器触发
        ↓
3. 系统读取同步记录中最后一次操作
        ↓
4. 执行逆向操作：
   - 删除已同步的记录行
   - 恢复 Excel 原始数据（如有快照）
        ↓
5. Toast 提示撤销结果
```

---

## 6. 事件机制

### 6.1 数据驱动事件绑定

所有交互通过 `data-action` 属性绑定，由统一事件处理器 `handleActionClick` 分发：

```html
<button data-action="saveAllConfig">保存</button>
<button data-action="openSettings">设置</button>
<button data-action="closePanel">关闭</button>
```

### 6.2 事件处理架构

```
用户点击
    │
    ▼
全局监听器 (document.querySelectorAll('[data-action]').forEach)
    │
    ▼
setupButtonListeners()
    │
    ▼
handleActionClick(action, event)
    │  ←  action = button.dataset.action
    ▼
ACTION_HANDLERS[action]  ←  路由表（30+ 个 action）
    │
    ├── closePanel
    ├── closeSettingsPanel
    ├── saveAllConfig
    ├── exportConfig
    ├── openSettings
    ├── sync
    ├── testSelected
    ├── ...
    └── （每个 action 对应独立处理器）
```

### 6.3 跨面板通信

| 通道              | 机制                            | 用途                         |
| ----------------- | ------------------------------- | ---------------------------- |
| 主面板 ↔ 设置面板 | `BroadcastChannel`              | 配置实时同步、Token 状态更新 |
| 主面板 ↔ 功能区   | Ribbon `onButtonClick`          | 触发相同 action 流程         |
| UI ↔ 服务层       | `configService` / `syncService` | 数据持久化与业务解耦         |

### 6.4 处理器执行上下文

每个 action 处理器接收统一的 `ctx` 参数：

```typescript
interface HandlerContext {
  action: string // 当前 action 名称
  startTime: number // 处理器开始时间戳
  button: HTMLElement // 触发的按钮元素
  event: Event // 原始 DOM 事件
}
```

---

## 7. 状态持久化

### 7.1 PluginStorage 存储项

| Key                       | 类型        | 说明               |
| ------------------------- | ----------- | ------------------ |
| `panel_id`                | string      | 主面板实例 ID      |
| `settings_pane_id`        | string      | 设置面板实例 ID    |
| `bgm_token`               | string      | Bangumi API Token  |
| `bgm_user_id`             | string      | 用户 ID            |
| `github_config`           | JSON string | GitHub/GitLab 配置 |
| `bgm_incremental_sync`    | boolean     | 增量同步开关       |
| `bgm_skip_conflicts`      | boolean     | 跳过冲突开关       |
| `bgm_sync_record_enabled` | boolean     | 同步记录开关       |
| `bgm_conflict_strategy`   | string      | 冲突处理策略       |
| `bgm_nav_icons_only`      | boolean     | 导航仅显示图标开关 |

### 7.2 生命周期

```
加载项启动
    ↓
    ├── 读取 PluginStorage 配置
    ├── 初始化 UI 状态（Token 状态、表单值等）
    └── 绑定事件监听

[用户操作中]
    ↓
    ┌── 修改配置 ──┐
    │               │
    │  更新 PluginStorage
    │  BroadcastChannel 同步到其他面板
    │  显示 Toast 反馈
    │               │
    └───────────────┘

加载项卸载
    ↓
    ├── 清理定时器/事件监听
    └── 持久化配置保留（下次启动可用）
```

---

## 8. 错误处理

### 8.1 用户可见反馈

| 场景         | 反馈方式                             |
| ------------ | ------------------------------------ |
| 操作成功     | Toast（绿色/蓝色）                   |
| 操作失败     | Toast（红色）+ 日志 ERROR            |
| 需要确认     | Modal 对话框（如清除记录、撤销同步） |
| 面板关闭失败 | Toast + 兜底尝试 + 明确错误提示      |

### 8.2 错误分级

| 级别  | 处理方式                | 用户可见        |
| ----- | ----------------------- | --------------- |
| INFO  | Toast + 日志            | ✅ 是           |
| WARN  | 日志记录（不打断用户）  | ❌ 否（仅日志） |
| ERROR | Toast（红色）+ 详细日志 | ✅ 是           |
| FATAL | 对话框 + 降级处理       | ✅ 是           |

### 8.3 关闭失败的容错策略

当设置面板关闭失败时：

1. 主路径：通过 `PluginStorage` 中存储的 ID 直接访问面板 → 设置 `Visible = false`
2. 兜底路径：遍历 `TaskPanes` 数组，查找 ID 包含 `settings-pane` 的面板
3. 最终反馈：告知用户"关闭失败，请尝试手动关闭"

---

## 9. 无障碍与交互规范

### 9.1 ARIA 与可访问性

- 所有图标按钮配备 `aria-label`（如 `aria-label="保存所有配置"`）
- 所有按钮配备 `title` 属性作为 Tooltip
- 支持 Tab 键遍历所有交互元素
- 对话框关闭后焦点返回触发元素

### 9.2 图标规范

项目采用「SVG 图标 + emoji 图标」双体系，完整标准见 [`图标规范.md`](图标规范.md)：

- **SVG 图标**（顶栏按钮 / Ribbon 功能区按钮）：统一 16×16px，线性（stroke）为主、填充（fill）为辅；颜色继承父元素 `currentColor` 自动适配主题；纯图标按钮间距 4px，无文字标签时使用 `aria-label` / `title` 替代。
- **emoji 图标**（页面内容：导航项 / 区块标题 / 按钮文字前缀 / 状态提示）：按 [`图标规范.md`](图标规范.md) 的「语义 → 图标」唯一映射表使用——一个核心语义只对应一个图标，跨页同语义必须同图标（如「数据预览」统一 `👁️`、「远程仓库」统一 `🗄️`、「记录」统一 `📊`、「复制」统一 `📋`）；导航、区块标题、主按钮图标保持一致。
- **变体选择符（VS16）**：默认文本呈现的码点必须追加 `U+FE0F` 强制 emoji 呈现（如 `⚖️` `👁️` `⚡️` `✋️` `🗄️` `🛡️` 等），默认 emoji 呈现的码点禁止追加；完整清单见 [`图标规范.md`](图标规范.md) §4。

### 9.3 操作反馈规范

- 所有操作必须有即时反馈（Toast 或进度指示）
- 耗时操作需显示加载状态
- 批量操作需显示进度计数（如"已完成 3/10"）
- 危险操作（删除/清空/覆盖）需二次确认

---

## 10. 布局响应式规则

### 10.1 断点定义

| 断点               | 面板宽度   | 布局行为                             |
| ------------------ | ---------- | ------------------------------------ |
| 宽面板             | ≥ 1180px   | 完整两列布局：侧栏 64px + 主区自适应 |
| 中面板             | 880~1179px | 侧栏缩窄 + 卡片紧凑排列              |
| 窄面板（WPS 默认） | 620~879px  | 侧栏自动转为顶部横向导航             |
| 超窄面板           | < 620px    | 单列堆叠 + 卡片内部元素自动换行      |

> **注意**：WPS Task Pane 默认停靠宽度约 480~550px，属于「窄面板」范围，导航自动横排是常态。

### 10.2 Grid 防溢出铁律

任何使用 Grid 布局的容器，必须对可能溢出的方向设置以下约束：

```css
/* 1. Grid 容器：防止子元素撑开 */
.content-grid {
  display: grid;
  min-width: 0; /* 🔴 必加：阻止 grid item 以 max-content 撑爆容器 */
  grid-template-columns: minmax(0, 64px) minmax(0, 1fr);
}

/* 2. 内容分区：隐藏溢出 */
.section {
  overflow: hidden; /* 🔴 必加：防止内部长文本/固定宽元素撑破 */
}

/* 3. 可横向滚动的表格单元格 */
.preview-box td {
  white-space: nowrap; /* 单行不换行 */
}
.preview-box {
  overflow-x: auto; /* 超出时提供横向滚动条 */
}
```

**反例**（已在代码库修复）：

```css
/* ❌ 旧代码：缺少 min-width:0，导致 500px 面板下内容撑爆 700px+ */
.content-grid {
  grid-template-columns: 64px 1fr; /* 1fr 内的内容按 max-content 计算 */
}
```

### 10.3 图标仅模式的优先级陷阱

**问题**：当图标仅模式开启（`body.nav-icons-only`），CSS 选择器 `body.nav-icons-only .global`（2 类）优先级高于媒体查询内的 `.global`（1 类），导致窄窗口下图标模式布局（侧栏 64px 固定）无法被媒体查询覆盖，内容区被挤爆。

**解决**：在每个媒体查询断点中显式覆盖图标模式：

```css
/* 基础：图标模式（仅在宽窗口下作为预期行为） */
body.nav-icons-only .global {
  grid-template-columns: 64px minmax(0, 1fr);
}

/* 窄窗口：显式覆盖，强制降级 */
@media (max-width: 880px) {
  .global,                    /* 普通模式 */
  body.nav-icons-only .global {
    /* 图标模式 ← 必须一起覆盖 */
    grid-template-columns: 1fr;
  }

  .sidebar,
  body.nav-icons-only .sidebar {
    /* 同理：侧栏方向也要覆盖 */
    flex-direction: row;
  }

  /* 窄窗口下图标模式自动恢复文字（不再隐藏） */
  body.nav-icons-only .nav a .nav-text {
    display: inline;
  }
}
```

**核心原则**：任何通过 `body.X .Y` 这类"body 状态类 + 元素"组合选择器定义的样式，在媒体查询中必须用**相同或更高优先级的选择器**覆盖，不能依赖单独的 `.Y`。

### 10.4 模态框显示机制

所有模态框 CSS 默认 `display: none`，JS 显示时设置 `display: flex`。HTML 中内联 `style="display:none;"` 作为双重保障，防止 CSS 加载前闪烁：

```html
<!-- ✅ 正确 -->
<div id="syncPreviewModal" class="modal sync-preview-modal" style="display:none;"></div>
```

---

## 11. Chrome 预览测试规范

### 11.1 为什么用 Chrome

WPS/Excel 加载项的 Task Pane 本质是一个嵌在 Office 宿主内的 WebView（Chromium 内核），使用 Chrome 做 UI 预览是**最接近真实运行环境**的选择：

- **DOM/CSS 渲染完全一致**：Chrome DevTools 的 Elements/Styles 面板可精确模拟 Task Pane 内的渲染结果
- **CSS Grid/Flex 调试工具**：DevTools 可视化的 Grid 叠加层、Flex 箭头指示能快速定位布局问题
- **响应式模拟**：Device Toolbar 可精确设定 Task Pane 停靠宽度（480~880px）
- **与 Playwright 兼容**：自动化测试用的就是 Chrome，手工预览环境一致

### 11.2 启动预览服务

```bash
# 项目根目录下（端口与 wpsjs 调试端口 3889 错开，避免冲突）
python -m http.server 5173 --directory .

# 打开预览页
# http://localhost:5173/ui/panel.html       （真实面板）
# http://localhost:5173/ui/settings.html    （设置面板）
```

### 11.3 Task Pane 宽度模拟

在 Chrome DevTools → Device Toolbar 中设定以下宽度验证响应式：

| 模拟场景         | 视口宽度 | 验证要点                             |
| ---------------- | -------- | ------------------------------------ |
| WPS 左侧停靠默认 | 500px    | 导航横排、单列、内容不溢出           |
| WPS 手动拉宽     | 700px    | 导航横排、侧栏紧凑                   |
| 宽桌面面板       | 900px    | 侧栏恢复纵向、图标模式隐藏文字       |
| 宽桌面（极宽）   | 1280px   | 完整两列、卡片布局舒展               |
| 超窄（极限测试） | 400px    | 所有按钮横排可滚动、表单元素自动换行 |

### 11.4 图标仅模式测试步骤

1. 打开 Chrome DevTools → Console
2. 模拟窄窗口（`deviceToolbar` → 500px）
3. 注入：`document.body.classList.add('nav-icons-only')`
4. **预期**：Grid 变为单列（`grid-template-columns: 1fr`），侧栏变为横向（`flex-direction: row`），导航文字显示（`.nav-text { display: inline }`）
5. 拉宽到 1280px
6. **预期**：Grid 恢复 `64px 1fr`，侧栏恢复纵向，导航文字隐藏

**自动化验证脚本**（Console 一行命令）：

```js
;(() => {
  const g = document.querySelector('.global')
  const s = document.querySelector('.sidebar')
  const t = getComputedStyle
  return {
    w: innerWidth,
    grid: t(g).gridTemplateColumns,
    sidebarDir: t(s).flexDirection,
    navText: t(document.querySelector('.nav a .nav-text')).display,
  }
})()
```

### 11.5 常见问题排查

| 现象                             | 原因                                                  | 排查方法                                                                            |
| -------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 内容区被挤爆，出现横向溢出滚动条 | Grid 子元素缺少 `min-width: 0`                        | DevTools Elements 面板看 `.content-grid` 子元素的 computed `width` 是否远大于父容器 |
| 图标模式下窄窗口布局不降级       | 媒体查询未覆盖 `body.nav-icons-only`                  | 用 DevTools Styles 面板看 @media 内的选择器是否命中                                 |
| 模态框打开时页面闪烁白底         | CSS 还没加载完，默认 `display: block`                 | 检查 HTML 模态框是否有内联 `style="display:none;"`                                  |
| 滚动条不出现但内容被裁切         | 缺少 `overflow-x: auto` 或容器用了 `overflow: hidden` | 检查 `.preview-box` 和其父级的 overflow 属性                                        |

---

## 附录：Action 处理器清单

| Action                  | 处理器文件        | 描述                     |
| ----------------------- | ----------------- | ------------------------ |
| `closePanel`            | handlers/index.ts | 隐藏主面板               |
| `closeSettingsPanel`    | handlers/index.ts | 关闭设置面板（双重保障） |
| `openSettings`          | handlers/index.ts | 打开/切换设置面板        |
| `saveAllConfig`         | handlers/index.ts | 保存所有配置             |
| `exportConfig`          | handlers/index.ts | 导出配置为 JSON          |
| `importConfig`          | handlers/index.ts | 从 JSON 导入配置         |
| `sync`                  | handlers/index.ts | 上传同步主流程           |
| `testSelected`          | handlers/index.ts | 选中行同步               |
| `syncCollectionFromBgm` | handlers/index.ts | 收藏下载                 |
| `previewSyncContent`    | handlers/index.ts | 预览同步内容             |
| `undoLastSync`          | handlers/index.ts | 撤销上次同步             |
| `saveGithubConfig`      | handlers/index.ts | 保存 GitHub 配置         |
| `syncFromGithub`        | handlers/index.ts | 立即远程同步             |
| `testGithubConfig`      | handlers/index.ts | 测试远程连接             |
| `clearGithubCache`      | handlers/index.ts | 清除本地缓存             |
| `showTokenDialog`       | handlers/index.ts | 显示 Token 输入框        |
| `copyToken`             | handlers/index.ts | 复制 Token               |
| `clearToken`            | handlers/index.ts | 清除 Token               |
| `testToken`             | handlers/index.ts | 测试 Token 有效性        |
| `showLogPanel`          | handlers/index.ts | 显示日志面板             |
| `clearLogs`             | handlers/index.ts | 清空日志                 |
| `exportLogs`            | handlers/index.ts | 导出日志（跟随级别筛选） |
| …                       | …                 | （共 30+ 个 action）     |
