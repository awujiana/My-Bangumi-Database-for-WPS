# BGM 加载项修复验证清单（2026-06）

> 本清单基于本轮修复（P0/P1/P2/P3 + Token 明文存储 + 状态机事件化）编写，共 21 项实测验证。
> 用户需在 WPS 加载项中逐项执行，记录结果（✓ 通过 / ✗ 失败 / ⚠️ 部分通过）。
> 失败项需附控制台截图和日志片段。

## 修复摘要

| 类别 | 修复数 | 详情 |
| --- | --- | --- |
| P0 并发同步控制 | 4 处 | BS-1/BS-2/BS-3 + _doAPISync |
| P1 安全修复 | 2 处 | S-1 JSON.parse 包裹、EH-1 ontimeout |
| Token 改造 | 1 项 | 明文存储 + 可复制按钮（Taskpane + Ribbon） |
| 状态机事件化 | 1 项 | 5 处 emit SYNC_STATE_CHANGED |
| 深色模式 | 1 处 | chkIncremental |
| a11y 增强 | 多处 | role/aria-live/aria-label |
| any 整改 | 5 处 | events.ts/result.ts/exceltobangumi.ts |
| Vitest 引入 | 1 项 | 33 个测试用例 |
| 渐进拆分 | 2 项 | stringUtils.ts、pureUtils.ts |

## 验证前准备

1. 启动 WPS 加载项（开发模式或安装版）
2. 打开 DevTools Console（F12）
3. 准备测试工作簿：至少 5 行数据，含 Bangumi URL、状态、标签、集数列
4. 准备有效 Bangumi Token（可在 https://next.bgm.tv/demo/access-token 申请）
5. 测试网络环境：大陆需确保能访问 api.bgm.tv（可能需要代理）

## 21 项验证清单

### 12.1 数据预览边界（4 项）

#### ✓ 12.1.1 空表预览
- [ ] **执行**：选择空表（仅表头），点击"刷新预览"
- [ ] **预期**：显示"暂无数据"，无异常
- [ ] **结果**：______
- [ ] **控制台关键词**：`[refreshData] 未检测到数据行`

#### ✓ 12.1.2 单行表预览
- [ ] **执行**：选择仅 1 行数据的工作表，点击"刷新预览"
- [ ] **预期**：显示 1 行，表头识别正确
- [ ] **结果**：______
- [ ] **控制台关键词**：`[detectHeaderAndColumns] headerRow=1, dataStartRow=2`

#### ✓ 12.1.3 筛选状态下预览
- [ ] **执行**：应用 AutoFilter 筛选"在看"，点击"刷新预览"
- [ ] **预期**：仅显示筛选后的可见行
- [ ] **结果**：______
- [ ] **控制台关键词**：`[getFilterStatus] isFiltered=true`

#### ✓ 12.1.4 跳行数据预览
- [ ] **执行**：选择中间有空行的工作表，点击"刷新预览"
- [ ] **预期**：按行号升序显示，跳过空行
- [ ] **结果**：______
- [ ] **控制台关键词**：`[refreshData] previewRows.length=N`

### 12.2 同步操作边界（5 项）

#### ⚠️ 12.2.1 Token 失效同步（重点验证 S-1 修复）
- [ ] **执行**：设置无效 Token（如 `invalid_token_12345`），点击"同步全部可见行"
- [ ] **预期**：3 行均标记失败，每行显示"Token 无效或已过期（401）"
- [ ] **结果**：______
- [ ] **重点**：S-1 修复后，jsonBody 解析失败不再中断 syncSelectedRows
- [ ] **控制台关键词**：`[bgmRequestSync] HTTP 401`、`[syncSelectedRows] jsonBody 解析失败`

#### ⚠️ 12.2.2 网络断开同步（重点验证 EH-1 修复）
- [ ] **执行**：开始同步后第 3 行时断网，等待 30 秒
- [ ] **预期**：第 3 行显示"请求章节数据超时（30s）"，自动重试 3 次后标记失败，继续处理第 4 行
- [ ] **结果**：______
- [ ] **重点**：EH-1 修复后，fetchEpisodeIds 超时不再永挂
- [ ] **控制台关键词**：`[HTTP] 网络错误，第 N 次重试`、`请求章节数据超时`

#### ⚠️ 12.2.3 并发触发同步（重点验证 BS-1/BS-2/BS-3 修复）
- [ ] **执行**：快速连续点击"同步全部可见行"5 次
- [ ] **预期**：仅第 1 次触发同步，后续 4 次提示"同步正在进行中，请稍后"
- [ ] **结果**：______
- [ ] **重点**：BS-1/BS-2/BS-3 修复后，三处入口（preview/handlers/ribbonService）均使用 enterRunningState
- [ ] **控制台关键词**：`[sync] startSync: isRunning=true, 拒绝重入`

#### 12.2.4 超大表同步
- [ ] **执行**：10000 行数据，点击"同步全部可见行"，中途暂停 5 秒后恢复
- [ ] **预期**：进度流畅，内存 < 100MB，断点续传正常
- [ ] **结果**：______

#### 12.2.5 特殊字符同步
- [ ] **执行**：含 emoji `看哭了😭`、控制字符、超长评论的数据同步
- [ ] **预期**：emoji 正常上传，控制字符过滤，超长截断至 1000 字符
- [ ] **结果**：______

### 12.3 工作表操作边界（4 项）

#### 12.3.1 切换工作表
- [ ] **执行**：同步进行中切换到另一个工作表
- [ ] **预期**：同步继续在原表执行
- [ ] **结果**：______

#### 12.3.2 锁定工作表后切换工作簿
- [ ] **执行**：锁定工作表后关闭重开工作簿
- [ ] **预期**：Taskpane 自动恢复锁定状态
- [ ] **结果**：______

#### 12.3.3 删除工作表
- [ ] **执行**：同步进行中删除当前工作表
- [ ] **预期**：捕获异常，状态重置，弹窗关闭
- [ ] **结果**：______
- [ ] **重点**：exitRunningState 在 catch 中调用，状态不会泄漏

#### 12.3.4 重命名工作表
- [ ] **执行**：重命名已锁定的工作表
- [ ] **预期**：锁定状态更新为新名称
- [ ] **结果**：______

### 12.4 Ribbon ↔ Taskpane 状态同步（4 项）

#### ⚠️ 12.4.1 Ribbon 触发全面同步（重点验证 BS-2 修复）
- [ ] **执行**：点击 Ribbon"全面同步"
- [ ] **预期**：立即弹出确认框，确认后显示进度
- [ ] **结果**：______
- [ ] **重点**：BS-2 修复后，syncWithConfirmation 在执行前检查 isRunning
- [ ] **控制台关键词**：`[ribbon] btnSyncBangumi 触发`、`[syncWithConfirmation]`

#### ⚠️ 12.4.2 Token 设置后状态同步（重点验证事件总线）
- [ ] **执行**：从 Ribbon 或 Taskpane 设置 Token
- [ ] **预期**：Taskpane Token 状态立即更新
- [ ] **结果**：______
- [ ] **控制台关键词**：`[handlers] TOKEN_UPDATED 事件触发`

#### 12.4.3 Ribbon 冲突检测 GFW 场景
- [ ] **执行**：网络受限时点击"全面同步"
- [ ] **预期**：确认框立即弹出，冲突检测超时后提示继续
- [ ] **结果**：______

#### 12.4.4 Taskpane 关闭后 Ribbon 操作
- [ ] **执行**：关闭 Taskpane，从 Ribbon 触发同步
- [ ] **预期**：同步正常执行，结果通过状态栏显示
- [ ] **结果**：______

### 12.5 同步记录开关验证（4 项）

#### 12.5.1 启用同步记录后同步
- [ ] **执行**：勾选"启用同步记录"，同步 3 行
- [ ] **预期**：自动创建"同步记录"工作表，含 3 行记录
- [ ] **结果**：______

#### 12.5.2 关闭同步记录后同步
- [ ] **执行**：取消勾选，同步 3 行
- [ ] **预期**：同步正常完成，记录表行数不增加
- [ ] **结果**：______

#### 12.5.3 同步记录表不存在时的只读操作
- [ ] **执行**：删除"同步记录"工作表后点击"查看同步记录"
- [ ] **预期**：提示"未找到同步记录工作表"，不创建新表
- [ ] **结果**：______

#### 12.5.4 同步记录开关持久化
- [ ] **执行**：取消勾选 → 关闭 → 重开 Taskpane
- [ ] **预期**：复选框为未勾选，与持久化值一致
- [ ] **结果**：______

## 附加验证（本次新增功能）

### A.1 Token 复制功能（Taskpane）
- [ ] **执行**：设置 Token 后点击"📋 复制"按钮
- [ ] **预期**：弹出"Token 已复制到剪贴板"toast，剪贴板可粘贴出 Token
- [ ] **结果**：______

### A.2 Token 复制功能（Ribbon）
- [ ] **执行**：点击 Ribbon"复制Token"按钮
- [ ] **预期**：弹出 MessageBox"Token 已复制到剪贴板"
- [ ] **结果**：______

### A.3 Token 明文存储验证
- [ ] **执行**：设置 Token 后，用 PluginStorage.getItem('bgm_token') 读取
- [ ] **预期**：返回明文 Token（非 "v1." 开头的加密格式）
- [ ] **结果**：______
- [ ] **验证方法**：在 DevTools Console 执行
  ```javascript
  // 通过 WPS API 读取 PluginStorage
  window.Application?.PluginStorage?.getItem('bgm_token')
  ```

### A.4 状态机事件订阅验证
- [ ] **执行**：开始同步 → 暂停 → 恢复 → 停止
- [ ] **预期**：每个状态转换在控制台输出 `[handlers] 同步状态变更: running/paused/resumed/stopped/idle`
- [ ] **结果**：______
- [ ] **重点**：A-9 修复后，BGM.sync 在 5 处 emit SYNC_STATE_CHANGED

### A.5 深色模式覆盖
- [ ] **执行**：切换系统到深色模式，检查 Taskpane
- [ ] **预期**：`chkIncremental` 和 `chkEnableSyncRecord` 均显示深色背景（#3a3a3a）
- [ ] **结果**：______

### A.6 a11y 验证
- [ ] **执行**：用屏幕阅读器（NVDA/VoiceOver）打开同步进度弹窗
- [ ] **预期**：朗读"同步进度对话框"，进度更新被朗读
- [ ] **结果**：______

### A.7 Vitest 测试运行
- [ ] **执行**：在项目根目录运行 `npx vitest run`
- [ ] **预期**：33 个测试全部通过
- [ ] **结果**：______

## 汇总统计

| 类别 | 项数 | 已通过 | 失败 | 跳过 |
| --- | --- | --- | --- | --- |
| 数据预览 | 4 | | | |
| 同步操作 | 5 | | | |
| 工作表操作 | 4 | | | |
| Ribbon ↔ Taskpane | 4 | | | |
| 同步记录开关 | 4 | | | |
| 附加验证 | 7 | | | |
| **合计** | **28** | | | |

## 失败项处理

若任一项失败：
1. 记录失败项编号
2. 截图 DevTools Console 错误日志
3. 截图 UI 异常表现
4. 提供以下信息：
   - WPS 版本
   - 操作系统
   - 网络环境（是否需要代理）
   - 复现步骤
5. 将以上信息反馈，便于定位修复

---

# P0 修复验证清单（2026-07-05）

> 本节基于 `multi-dimension-audit-2026-06-27` 审查报告的 7 项 P0 问题修复。
> 修复范围：postMessage origin 校验、CSP、tsconfig 严格性、setSyncRunning 状态机统一、.status 对比度、HTML lang/viewport。
> Token 按用户指示保持明文存储（仅添加 JSDoc 标注）。

## 静态验证（AI 已执行，全部通过）

| 验证项 | 结果 | 证据 |
|--------|------|------|
| `tsc --noEmit` 退出码 0 | ✅ 通过 | 2026-07-05 编译验证 |
| `: any` / `as any` 残留 | ✅ 0 处 | Grep 全库无匹配 |
| `@ts-ignore` / `@ts-nocheck` | ✅ 0 处 | Grep 全库无匹配 |
| `eval(` / `new Function(` / `setTimeout("` / `setInterval("` | ✅ 0 处 | Grep 全库无匹配 |
| `document.write` | ✅ 0 处 | Grep 全库无匹配 |
| `setAttribute("on...")` | ✅ 0 处 | Grep 全库无匹配 |
| `innerHTML` 安全性 | ✅ 12 处全部安全 | 均为静态字符串或经 escapeHtml |
| `JSON.parse` 异常处理 | ✅ 12 处全部在 try/catch 中 | 逐处确认 |
| message 监听器 origin 校验 | ✅ 3 处全部有校验 | handlers.ts:1189 + ribbon.ts:58 + message.ts:30 |
| `<html lang="zh-CN">` | ✅ 已添加 | taskpane.html 第 2 行 |
| viewport meta | ✅ 已添加 | taskpane.html head |
| color-scheme meta | ✅ 已添加 | taskpane.html head |
| theme-color meta | ✅ 已添加 | taskpane.html head |
| CSP meta | ✅ 已添加 | taskpane.html head |
| 内联 `<script>` 移除 | ✅ 已移至 taskpane-bootstrap.js | taskpane.html |
| 内联 `onchange`/`onclick` | ✅ 0 处 | Grep 无匹配 |
| tsconfig 三个严格选项 | ✅ 已开启 | noUncheckedIndexedAccess + exactOptionalPropertyTypes + useUnknownInCatchVariables |
| `setSyncRunning` 移除 | ✅ 已删除 | Grep 仅 index.ts 无导出 |
| `.status` 对比度 | ✅ 8.74:1（≥ 4.5:1）| #cdd6f4 vs #333 |
| Token 明文存储 JSDoc | ✅ 已标注 | util.ts storeBgToken/loadBgToken |

## 运行时验证（需用户执行）

### V-P0-1: postMessage origin 校验

**目的**：验证非预期 origin 的 message 被拒绝

**步骤**：
1. 打开 WPS 加载项 Taskpane
2. 打开 DevTools Console（F12）
3. 在 Console 执行：
   ```javascript
   window.postMessage({ type: 'showAlert', message: '测试' }, 'https://evil.example.com');
   ```
4. 观察是否有 alert 弹窗

**预期**：
- ✅ 无 alert 弹窗
- ✅ Console 有日志：`[message] 拒绝非预期 origin: https://evil.example.com`

**结果**：______

### V-P0-2: CSP 生效验证

**目的**：验证 CSP 阻止内联脚本和外域脚本加载

**步骤**：
1. 打开 WPS 加载项 Taskpane
2. 打开 DevTools Console
3. 在 Console 执行：`eval('1+1')`
4. 在 Console 执行：`var s = document.createElement('script'); s.text = 'console.log("inline")'; document.body.appendChild(s);`
5. 观察 Console 输出

**预期**：
- ✅ `eval` 报错：`Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed`
- ✅ 内联 script 被拒绝：`Refused to execute inline script because it violates the following Content Security Policy directive: "script-src 'self'"`

**结果**：______

### V-P0-3: tsconfig 严格性验证

**目的**：确认三个严格选项已开启

**步骤**：
1. 在项目根目录运行：`npx tsc --noEmit`
2. 检查退出码：`echo $LASTEXITCODE`（PowerShell）

**预期**：
- ✅ 退出码 0
- ✅ 无任何错误输出

**结果**：______

### V-P0-4: setSyncRunning 移除验证

**目的**：确认 setSyncRunning 已无业务调用

**步骤**：
1. 在项目根目录运行：`Select-String -Path "ts\*.ts" -Pattern "setSyncRunning" -Recurse`
2. 检查输出

**预期**：
- ✅ 无匹配（或仅文档/注释中的历史引用）

**结果**：______

### V-P0-5: .status 颜色对比度验证

**目的**：确认状态栏文字在深色背景下清晰可读

**步骤**：
1. 打开 WPS 加载项 Taskpane
2. 触发任意同步操作（如点击"同步到 Bangumi"）
3. 观察 `.status` 元素的文字
4. 打开 DevTools Elements 面板，选中 `.status` 元素
5. 查看计算样式 `color` 值

**预期**：
- ✅ 文字清晰可读
- ✅ `color: rgb(205, 214, 244)`（即 #cdd6f4）
- ✅ DevTools 显示对比度 ≥ 4.5:1

**结果**：______

### V-P0-6: HTML lang/viewport 验证

**目的**：确认 lang 和 viewport meta 正确设置

**步骤**：
1. 打开 WPS 加载项 Taskpane
2. 打开 DevTools Elements 面板
3. 检查 `<html>` 标签
4. 检查 `<head>` 内的 meta 标签

**预期**：
- ✅ `<html lang="zh-CN">`
- ✅ `<meta name="viewport" content="width=device-width, initial-scale=1">`
- ✅ `<meta name="color-scheme" content="dark light">`
- ✅ `<meta name="theme-color" content="#1e1e2e">`
- ✅ `<meta http-equiv="Content-Security-Policy" content="...">`

**结果**：______

### V-P0-7: Token 明文存储验证

**目的**：确认 Token 以明文存储，可复制使用

**步骤**：
1. 打开 WPS 加载项 Taskpane
2. 在 Token 输入框输入测试 Token（如 `test_token_12345`）
3. 点击保存
4. 打开 DevTools Console
5. 执行：`Application.PluginStorage.getItem('bgm_token')`（或在 Console 调用 `loadBgToken()`）
6. 点击"复制 Token"按钮
7. 在剪贴板粘贴查看

**预期**：
- ✅ PluginStorage 中存储的值为明文 `test_token_12345`（无 `v1.` 前缀）
- ✅ 复制按钮可正常复制
- ✅ 粘贴后为明文 Token

**结果**：______

### V-P0-8: 历史加密 Token 自动升级验证

**目的**：确认历史 XOR 加密的 Token 能自动升级为明文

**步骤**：
1. 准备一个历史版本的加密 Token（`v1.` 前缀）
2. 手动写入 PluginStorage：`Application.PluginStorage.setItem('bgm_token', 'v1.xxx.yyy')`
3. 调用 `loadBgToken()`
4. 再次读取 PluginStorage

**预期**：
- ✅ `loadBgToken()` 返回解密后的明文 Token
- ✅ PluginStorage 中的值已升级为明文（无 `v1.` 前缀）
- ✅ Console 有日志：`[crypto] ...`

**结果**：______

## P0 验证汇总

| 验证项 | 类型 | 结果 |
|--------|------|------|
| V-P0-1 postMessage origin | 运行时 | ______ |
| V-P0-2 CSP 生效 | 运行时 | ______ |
| V-P0-3 tsconfig 严格性 | 静态+运行时 | ______ |
| V-P0-4 setSyncRunning 移除 | 静态 | ✅ 通过 |
| V-P0-5 .status 对比度 | 运行时 | ______ |
| V-P0-6 HTML lang/viewport | 运行时 | ______ |
| V-P0-7 Token 明文存储 | 运行时 | ______ |
| V-P0-8 历史加密升级 | 运行时 | ______ |
