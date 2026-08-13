# Bangumi 同步工具 - UI 与交互流程文档

## 1. 概述

Bangumi 同步工具是一个 WPS/Excel 加载项，用于在本地 Excel 表格和 Bangumi 番组计划（Bangumi.tv）之间同步收藏数据。工具采用“主面板 + 设置面板”的双面板交互模式，并提供功能区（Ribbon）入口。

## 2. 界面结构

### 2.1 双面板架构

本工具采用**任务窗格（Task Pane）**形式的双面板设计，具备动态位置协调逻辑：

- **主面板 (TaskPane)**
  - URL: `ui/taskpane.html`
  - 默认停靠：**左侧**（`DockPosition = Left`）
  - 功能：承载绝大多数核心功能（Token管理、同步操作、数据预览等）
  - 生命周期：由功能区按钮或初始化代码创建，持久化 ID 至 `PluginStorage`

- **设置面板 (Settings Panel)**
  - URL: `ui/settings.html`
  - **动态停靠逻辑**（关键交互特性）：
    - 当主面板**可见**时，设置面板停靠**右侧**（`DockPosition = Right`）
    - 当主面板**隐藏**时，设置面板停靠**左侧**（`DockPosition = Left`）
  - 目的：确保两个面板不会同时占用同一侧，提供更好的阅读体验
  - 生命周期：通过主面板右上角的“齿轮”图标或功能区按钮动态创建/显示

### 2.2 界面层级

```
┌───────────────────────────────────────────────┐
│  WPS/Excel 主窗口                               │
│  ┌───────────┐  ┌───────────┐                 │
│  │ 主面板     │  │ 设置面板   │  (动态切换位置)  │
│  │ (左侧) ←──┤  ├──→ (右侧)  │                 │
│  └───────────┘  └───────────┘                 │
└───────────────────────────────────────────────┘
  ↑ 主面板隐藏时，设置面板自动切换到左侧
```

## 3. 主面板 UI 元素

主面板 (`ui/taskpane.html`) 采用从上到下的分区布局，共包含以下主要区块：

### 3.1 头部操作区 (Header Actions)

位于面板顶部标题栏右侧，提供四个图标式快捷操作：

| 按钮    | ID            | Data-Action     | 功能描述                                                              |
| ------- | ------------- | --------------- | --------------------------------------------------------------------- |
| 💾 保存 | `saveBtn`     | `saveAllConfig` | 一键保存所有当前配置（Token、GitHub配置、同步偏好等）到 PluginStorage |
| 📤 导出 | `exportBtn`   | `exportConfig`  | 导出当前所有配置为 JSON 字符串，复制到剪贴板                          |
| ⚙️ 设置 | `settingsBtn` | `openSettings`  | 打开独立的设置面板（动态位置）                                        |
| ✖️ 关闭 | `closeBtn`    | `closePanel`    | 关闭主面板（设置面板会自动切换到左侧）                                |

### 3.2 功能区块详情

#### A. 快捷操作区

- **📤 上传同步**: 将 Excel 数据同步至 Bangumi API
- **📋 选中行同步**: 仅同步当前选中的单元格范围
- **📥 收藏回写**: 从 Bangumi 拉取收藏数据并标记到 Excel
- **👁️ 预览同步**: 在弹窗中预览即将同步的数据

#### B. Token 设置区

- 显示当前 Token 状态（未设置/有效/已过期）
- **设置/修改**: 打开输入对话框
- **📋 复制**: 将 Token 复制到剪贴板
- **测试**: 调用 API 验证 Token 有效性
- **清除**: 移除当前存储的 Token

#### C. 收藏页面访问区

- 设置/查看用户 ID
- 快速跳转到 Bangumi 用户收藏页

#### D. 数据选择区

- **选择模式**: 自动（筛选后可见数据）/ 手动（指定行号范围）
- **选择工作簿**: 下拉列表选择目标 Excel 文件
- **选择工作表**: 下拉列表选择目标 Sheet
- **工作表锁定**: 锁定后防止误操作
- **数据清洗**: 去除重复行，合并标签

#### E. 数据预览区

- 展示将被同步的数据摘要
- **🔍 放大预览**: 弹窗形式查看详细列表
- **📋 预览详情**: 查看完整同步内容
- **📥 收藏回写**: 快速触发回写流程

#### F. 冲突处理策略区

- **策略选择**: 跳过冲突（保留Bangumi数据）/ Excel覆盖
- **增量同步**: 仅同步有变化的条目

#### G. 同步记录区

- 启用/禁用同步历史记录
- 查看、清除、去重同步记录
- 设置记录表格式（字体、边框、列宽等）

#### H. 数据同步区（远程仓库 → Excel）

- 支持 GitHub / GitLab / Gitee / Gist / 本地文件 五种数据源
- 多种同步策略（新增+更新、仅新增、镜像同步等）
- 时间筛选器（按开播日期过滤）
- 💾 保存配置 / ⬇️ 立即同步 / ↩️ 撤销 / 🔌 测试 / 🗑️ 清缓存

#### I. 系统日志区

- 查看最近 1000 条日志
- 支持按级别（ERROR/WARN/INFO/DEBUG）筛选
- 支持导出日志

## 4. 核心交互流程

### 4.1 同步配置管理流程

```
用户操作               │ 系统行为
──────────────────────┼──────────────────────────────────────
点击 ⚙️ 设置           │ → showSettingsPanel()
                      │   → 检查主面板可见性
                      │   → 确定停靠位置（可见→右侧/隐藏→左侧）
                      │   → 创建或获取设置面板实例
                      │   → 设置 DockPosition
                      │   → 显示面板

点击 💾 保存           │ → handleActionClick('saveAllConfig')
                      │   → 收集当前 Token/UserID/GitHub配置等
                      │   → 依次调用对应的 storeXxx() 方法
                      │   → 显示 Toast 提示保存结果

点击 📤 导出           │ → handleActionClick('exportConfig')
                      │   → 收集所有配置项
                      │   → 序列化为 JSON
                      │   → 调用 configService.exportConfig()
                      │   → 复制到剪贴板 + Toast 提示
```

### 4.2 数据同步流程（上传同步）

```
1. 选择目标工作表/范围
        ↓
2. 点击 📤 上传同步 / 📋 选中行同步
        ↓
3. 系统自动：
   a. 检测筛选状态（getFilterStatus）
   b. 收集可见行数据（getSequentialRowsBySeqCol）
   c. 预处理同步任务（buildJsonPayload）
   d. 执行批量同步请求（batchSyncRequests）
        ↓
4. 实时反馈：
   - 进度条更新
   - 成功/失败/跳过计数
   - 异常行高亮
        ↓
5. 完成：写入同步记录 + Toast 总结
```

### 4.3 双面板位置协调流程

```
[初始状态] 主面板创建 → DockPosition = Left
                ↓
[用户点击 ⚙️ 设置]
    showSettingsPanel() 被调用
                ↓
    ┌─ 主面板可见？ ──┐
    │                  │
   是                 否
    │                  │
    ↓                  ↓
设置面板 → Right   设置面板 → Left
    │                  │
    ↓                  ↓
[用户关闭主面板]
    closePanel() 被调用
                ↓
[用户再次打开设置面板]
    showSettingsPanel() 被调用
                ↓
    主面板已隐藏 → 设置面板 → Left
```

### 4.4 撤销同步流程

```
1. 点击 ↩️ 撤销上次同步
        ↓
2. undoLastSync 处理器被触发
        ↓
3. 系统从同步记录中读取最后一次操作
        ↓
4. 逆向操作：
   - 删除已同步的记录行
   - 恢复 Excel 原始数据（如有快照）
        ↓
5. Toast 提示撤销结果
```

## 5. 事件机制

### 5.1 数据驱动事件绑定

所有交互通过 `data-action` 属性绑定，由统一的事件处理器 `handleActionClick` 分发：

```html
<button data-action="saveAllConfig">保存</button>
<button data-action="openSettings">设置</button>
<button data-action="closePanel">关闭</button>
```

### 5.2 事件处理架构

```
用户点击
    │
    ▼
全局事件监听器 (document.addEventListener)
    │
    ▼
handleActionClick(action)  ←  action = button.dataset.action
    │
    ▼
ACTION_HANDLERS[action]  ←  路由到对应的处理函数
    │
    ├── → saveAllConfig处理器
    ├── → exportConfig处理器
    ├── → openSettings处理器 → showSettingsPanel()
    ├── → closePanel处理器
    └── → ...（共30+个action）
```

### 5.3 消息通信

- **主面板 ↔ 设置面板**：通过 `BroadcastChannel` 跨面板通信，支持配置实时同步
- **主面板 ↔ 功能区**：通过 Ribbon 回调 `onButtonClick` 触发相同的 action 流程
- **UI ↔ 后端服务**：通过 `configService`、`syncService` 等服务层抽象解耦

## 6. 状态持久化

### 6.1 存储位置

- **PluginStorage**（宿主级存储）：
  - `taskpane_id`: 主面板实例 ID
  - `settings_pane_id`: 设置面板实例 ID
  - `bgm_token`: Bangumi API Token
  - `bgm_user_id`: 用户 ID
  - `github_config`: GitHub/GitLab 配置
  - `sync_preferences`: 同步偏好设置

### 6.2 生命周期

```
加载项启动
    ↓
    ├── 读取 PluginStorage 中的配置
    ├── 初始化 UI 状态
    └── 绑定事件监听
            ↓
        [用户操作中]
            ↓
    ┌── 保存/修改配置 ──┐
    │                     │
    │  更新 PluginStorage  │
    │  同步到设置面板      │
    │  显示 Toast 反馈    │
    │                     │
    └─────────────────────┘
            ↓
加载项卸载
    ↓
    清理定时器/事件监听
    持久化的配置保留（下次启动可用）
```

## 7. 错误处理

### 7.1 用户可见反馈

- **Toast 提示**：操作成功/失败的即时反馈
- **Modal 对话框**：重要确认操作（如清除记录、撤销同步）
- **状态栏**：底部状态栏显示当前就绪/处理中状态

### 7.2 错误分级

| 级别  | 处理方式                               |
| ----- | -------------------------------------- |
| INFO  | Toast + 日志记录                       |
| WARN  | Toast（黄色）+ 日志记录                |
| ERROR | Toast（红色）+ 详细日志 + 可能的对话框 |
| FATAL | 对话框 + 日志 + 降级处理               |

## 8. 无障碍与交互细节

- **ARIA 标签**：所有图标按钮配备 `aria-label`
- **Tooltip**：所有按钮配备 `title` 属性说明功能
- **键盘导航**：支持 Tab 键遍历所有交互元素
- **焦点管理**：对话框关闭后焦点返回触发元素
- **图标风格**：统一使用 SVG 线性图标，16×16px 尺寸
