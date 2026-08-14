# Bangumi 同步工具 — UI 与交互流程文档

> **版本**: v3.0  
> **最后更新**: 2026-08-13  
> **适用**: WPS/Excel 加载项 Bangumi 同步工具

---

## 1. 概述

Bangumi 同步工具是一个 WPS/Excel 加载项，用于在本地 Excel 表格和 Bangumi 番组计划（Bangumi.tv）之间同步收藏数据。

**核心能力**：

- 📤 **上传同步**：将 Excel 中的观看状态、评分、标签同步到 Bangumi
- 📥 **数据同步**：从远程仓库（GitHub/GitLab/Gitee）下载 Bangumi 资料数据到 Excel
- ↩️ **收藏回写**：从 Bangumi 拉取收藏列表标记到 Excel

**界面模式**：采用"主面板 + 设置面板"的双面板任务窗格（Task Pane）设计，支持动态位置协调。

---

## 2. 界面架构

### 2.1 双面板布局

```
┌───────────────────────────────────────────────────────────┐
│                    WPS/Excel 主窗口                         │
│                                                           │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │   主面板          │  │   设置面板        │              │
│  │   taskpane.html  │  │   settings.html   │              │
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
| URL       | `ui/taskpane.html`   | `ui/settings.html` |
| 默认停靠  | 左侧                 | 动态（见下方）     |
| 生命周期  | 持久化，由功能区创建 | 按需创建/销毁      |
| 持久化 ID | `taskpane_id`        | `settings_pane_id` |

### 2.2 动态停靠逻辑

设置面板的停靠位置由主面板的可见性决定：

```
showSettingsPanel() 调用时：
    │
    ├── 读取 PluginStorage['taskpane_id']
    ├── GetTaskPane(taskpane_id) → 检查主面板 Visible
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

位于面板顶部标题栏右侧，提供 4 个图标式快捷操作按钮（统一 SVG 线性图标风格）：

```
┌─────────────────────────────────────────────────────────────┐
│  Bangumi 同步工具                           💾  ⬆️  ⚙️  ✖️  │
│  Bangumi 数据管理工具 · 上传同步 / 数据同步 / 收藏回写        │
└─────────────────────────────────────────────────────────────┘
```

| 按钮     | ID            | Data-Action     | 图标含义    | 功能                                                      |
| -------- | ------------- | --------------- | ----------- | --------------------------------------------------------- |
| **保存** | `saveBtn`     | `saveAllConfig` | 云存储+对勾 | 一键保存所有配置（Token/GitHub/同步偏好）到 PluginStorage |
| **导出** | `exportBtn`   | `exportConfig`  | 向上箭头    | 导出当前配置为 JSON，复制到剪贴板                         |
| **设置** | `settingsBtn` | `openSettings`  | 齿轮        | 打开独立设置面板（动态停靠位置）                          |
| **关闭** | `closeBtn`    | `closePanel`    | ×           | 隐藏主面板（设置面板自动移至左侧）                        |

### 3.2 功能区块

主面板采用从上到下的分区布局：

#### A. 快捷操作区

- 📤 **上传同步**：将 Excel 数据同步至 Bangumi API
- 📋 **选中行同步**：仅同步当前选中的单元格范围
- 📥 **收藏回写**：从 Bangumi 拉取收藏列表标记到 Excel
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
- **📥 收藏回写**：快速触发回写流程

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
- 按级别（ERROR/WARN/INFO/DEBUG）筛选
- 导出日志

---

## 4. 设置面板 UI 结构

设置面板 (`ui/settings.html`) 提供集中化的配置管理界面：

```
┌─────────────────────────────────────────────────────────────┐
│  ⚙️ BGM 设置                                            ✖️   │
│  插件配置管理 · Token · 同步偏好 · 数据源                     │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 功能区块

| 区块              | 内容                                       |
| ----------------- | ------------------------------------------ |
| 🔑 Token 管理     | 状态显示、设置/修改、复制、清除、测试      |
| 👤 用户信息       | 用户 ID 设置、打开收藏页                   |
| 🔄 同步偏好       | 增量同步开关、冲突跳过开关、同步记录开关   |
| ⚔️ 冲突处理策略   | 跳过冲突 / Excel 覆盖                      |
| 📥 收藏回写数据源 | Bangumi API / GitHub 仓库选择              |
| 🗄️ 远程仓库配置   | owner/repo/branch/path、保存/测试/清除缓存 |
| 📦 配置导入导出   | 导出配置 / 导入配置                        |
| 📜 系统日志       | 查看日志 / 清空日志                        |
| ℹ️ 关于           | 版本信息与功能说明                         |

### 4.2 关闭机制

设置面板的关闭按钮（`closeSettingsPanel`）采用**双重保障**机制：

```
用户点击 ✖️ 关闭按钮
    │
    ▼
closeSettingsPanel 处理器
    │
    ├── 1. 获取 Application 对象（getApp）
    │   └── 失败 → Toast 报错 + 日志 ERROR
    │
    ├── 2. 主路径：通过 PluginStorage 获取 settings_pane_id
    │   └── GetTaskPane(id) → pane.Visible = false
    │       └── 成功 → Toast "设置面板已关闭"
    │
    └── 3. 兜底路径：若 ID 失效，遍历 TaskPanes 数组
        └── 查找 ID 包含 "settings-pane" 的面板
            └── pane.Visible = false
                └── 成功 → Toast "设置面板已关闭"
                    失败 → Toast "关闭失败，请尝试手动关闭"
```

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
[点击 ✖️ 关闭主面板]
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
| `taskpane_id`             | string      | 主面板实例 ID      |
| `settings_pane_id`        | string      | 设置面板实例 ID    |
| `bgm_token`               | string      | Bangumi API Token  |
| `bgm_user_id`             | string      | 用户 ID            |
| `github_config`           | JSON string | GitHub/GitLab 配置 |
| `bgm_incremental_sync`    | boolean     | 增量同步开关       |
| `bgm_skip_conflicts`      | boolean     | 跳过冲突开关       |
| `bgm_sync_record_enabled` | boolean     | 同步记录开关       |
| `bgm_conflict_strategy`   | string      | 冲突处理策略       |
| `bgm_writeback_source`    | string      | 收藏回写数据源     |

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

- **尺寸**：统一 16×16px SVG
- **风格**：线性（stroke）为主，填充（fill）为辅
- **颜色**：继承父元素 `currentColor`，自动适配主题
- **间距**：按钮间距 4px，无文字标签时使用 aria-label 替代

### 9.3 操作反馈规范

- 所有操作必须有即时反馈（Toast 或进度指示）
- 耗时操作需显示加载状态
- 批量操作需显示进度计数（如"已完成 3/10"）
- 危险操作（删除/清空/覆盖）需二次确认

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
| `syncCollectionFromBgm` | handlers/index.ts | 收藏回写                 |
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
| `exportLogs`            | handlers/index.ts | 导出日志                 |
| …                       | …                 | （共 30+ 个 action）     |
