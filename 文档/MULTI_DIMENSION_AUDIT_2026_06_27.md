# BGM 加载项多维度代码审查报告 2026-06-27

> **审查日期**: 2026-07-05
> **审查范围**: `ts/` 共 22 文件 10678 行 + `ui/taskpane.html` + `css/` + `package.json` + `tsconfig.json`
> **审查方法**: 4 个 Sub-Agent 并行执行 8 维度审查 + 边界方案 + 4 Skill 视角
> **基线**: 0 处 `any`，203 处 `unknown`，22 文件 10678 行
> **修复状态**: 只读审查，未修改代码
> **编译验证**: `npx tsc --noEmit` 退出码 0

> ⚠️ **历史文档**：本审查报告生成于 2026-06-27（审查日期 2026-07-05），早于 v3.2 的 `taskpane` → `panel` 命名规范重构与后续多项架构调整。文中 `ui/taskpane.html`、`ts/taskpane.ts` 等路径与代码行号已过时：当前主面板为 `ui/panel.html`，旧的 `ts/taskpane.ts` 已在 v3.2 删除，入口重构为 `ts/entry/panel-entry.ts`。问题清单与修复建议保留作为历史参考。

---

## 执行摘要

本次审查覆盖 8 个维度（可维护性/类型安全/错误处理/性能/UI-UX/安全/耦合聚合/组件化），发现 **P0×7、P1×28、P2×27、P3×17** 共 79 个问题，并产出 21 项可执行边界验证方案 + MCP 化可行性评估 + 安全最佳实践审查。

### 关键指标

| 指标         | 数值                                                  |
| ------------ | ----------------------------------------------------- |
| 文件总数     | 22 个 .ts                                             |
| 总行数       | 10678 行                                              |
| any 残留     | 0 ✅                                                  |
| unknown 使用 | 203 处                                                |
| >1000 行文件 | 3 个（exceltobangumi 1605、handlers 1521、util 1264） |
| >500 行文件  | 6 个                                                  |
| P0 问题      | 7                                                     |
| P1 问题      | 28                                                    |
| P2 问题      | 27                                                    |
| P3 问题      | 17                                                    |

### 关键发现 Top 7

1. 🔴 **B6-MSG-P0-1/2**：`handlers.ts:1187` 与 `ribbon.ts:58` 的 postMessage 监听器未校验 origin
2. 🔴 **B6-CSP-P0**：`taskpane.html` 完全无 CSP，配合内联 `<script>` 与 `onchange="..."`
3. 🔴 **B2-1**：`tsconfig.json` 缺失 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`
4. 🔴 **B3-1**：`setSyncRunning` 绕过 `enterRunningState/exitRunningState` 防重入机制
5. 🔴 **B5-P0-1**：`.status` 文字对比度 2.8:1，状态栏几乎不可读
6. 🔴 **B5-P0-2/3**：`<html>` 缺 `lang`，`<head>` 缺 viewport/color-scheme/theme-color
7. 🔴 **B6-STORAGE-P1**：Token 明文存储 + XOR 加密已废弃降级

---

## 一、可维护性审查（B1）

### 问题清单

| ID   | 等级 | 位置                                                                                                 | 问题                                                 | 建议                                                              |
| ---- | ---- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| B1-1 | P1   | [exceltobangumi.ts:1302](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts#L1302)        | `SyncToBangumiAsync` 使用 PascalCase，违反 camelCase | 重命名为 `syncToBangumiAsync`                                     |
| B1-2 | P1   | [util.ts:41-428](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L41-L428)                      | `BGM` 单一对象字面量 ~390 行，7 个子对象职责过度集中 | 拆分为 `bgmState.ts`/`bgmDialogBridge.ts`/`bgmErrorHandler.ts`    |
| B1-3 | P1   | [preview.ts:258-475](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts#L258-L475)                 | `previewSyncContent` 217 行，混合预览+进度+DOM+筛选  | 拆分为 `collectPreviewData`/`renderPreviewCards`/`attachFilterUI` |
| B1-4 | P2   | [handlers.ts:496-611](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts#L496-L611)               | `confirmAndExecuteSync` 115 行                       | 抽取 `executeSyncCore` 纯业务函数                                 |
| B1-5 | P2   | [ribbonService.ts:22-169](file:///d:/编程/Excel加载项/BGM/BGM/ts/services/ribbonService.ts#L22-L169) | `getSyncPreview` 147 行                              | 抽取 `PreviewStats` 类聚合统计                                    |
| B1-6 | P2   | 文档/CODE_REVIEW_2026_06.md                                                                          | 文档称 "23 文件 11000 行"，实际 22 文件 10678 行     | 更新文档                                                          |
| B1-7 | P3   | 文档/ex.copy、文档/expjs.copy                                                                        | 临时下载文件残留                                     | 清理或重命名                                                      |
| B1-8 | P3   | 文档/                                                                                                | 无 README.md 或架构图                                | 补充 `ARCHITECTURE.md`                                            |

### 注释覆盖率（抽样）

| 文件          | 覆盖率       |
| ------------- | ------------ |
| http.ts       | ~70%（高）   |
| util.ts       | ~35%（中）   |
| syncRecord.ts | ~60%（中高） |

---

## 二、类型安全审查（B2）

### 验证结果

| 检查项                                       | 结果               |
| -------------------------------------------- | ------------------ |
| `: any` / `as any` / `<any>` / `null as any` | ✅ 0 处            |
| `@ts-nocheck` / `@ts-ignore`                 | ✅ 0 处            |
| `unknown` 配合类型守卫                       | ✅ 205 处全部合规  |
| 导出函数显式返回类型                         | ✅ 全部通过        |
| `as unknown as` 断言                         | ⚠️ 30 处，3 处可疑 |

### 问题清单

| ID   | 等级   | 位置                                                                                        | 问题                                                                                      | 建议                                                      |
| ---- | ------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| B2-1 | **P0** | [tsconfig.json](file:///d:/编程/Excel加载项/BGM/BGM/tsconfig.json)                          | 缺 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables` | 添加三项严格子选项                                        |
| B2-2 | **P1** | 项目根                                                                                      | 无 ESLint 配置文件                                                                        | 添加 `eslint.config.js`，启用 `@typescript-eslint/strict` |
| B2-3 | P2     | [ribbon.ts:175-176](file:///d:/编程/Excel加载项/BGM/BGM/ts/ribbon.ts#L175-L176)             | `false as unknown as string` 类型语义不一致                                               | 改为 `String(false)`                                      |
| B2-4 | P2     | [http.ts:209](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/http.ts#L209)                    | `data = xhr.responseText as unknown as T` 伪造 T                                          | JSON.parse 失败时直接 `Result.fail`                       |
| B2-5 | P2     | [exceltobangumi.ts:814](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts#L814) | `null as unknown as Promise<void>` 占位                                                   | 改为 `Promise.resolve()`                                  |
| B2-6 | P2     | [wps.ts:243-264](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/wps.ts#L243-L264)             | `BGM?: unknown` 等字段类型过宽                                                            | 改为具体类型                                              |
| B2-7 | P3     | [wps.ts:67-79](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/wps.ts#L67-L79)                 | `WpsWorksheet` 缺 `Protect/Unprotect`                                                     | 补充方法声明                                              |

---

## 三、错误处理审查（B3）

### 验证结果

| 检查项                      | 结果                          |
| --------------------------- | ----------------------------- |
| Promise 链 `.catch` 覆盖    | ✅ 2 处 `.then` 均接 `.catch` |
| Ribbon OnAction try/catch   | ✅ 包裹完整                   |
| `xhr.onerror/ontimeout`     | ✅ 5 个 XHR 调用点全覆盖      |
| `catch (e: unknown)` + 守卫 | ✅ 100 处 catch，95%+ 合规    |
| `AbortController`           | ❌ **0 处使用**               |
| 防重入覆盖                  | ⚠️ 6 个入口，1 处绕过         |

### 问题清单

| ID    | 等级   | 位置                                                                                                 | 问题                                                       | 建议                                            |
| ----- | ------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| B3-1  | **P0** | [message.ts:81-89](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/message.ts#L81-L89)                     | `setSyncRunning` 绕过 `enterRunningState/exitRunningState` | 改为统一入口或删除                              |
| B3-2  | **P1** | [preview.ts:505-612](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts#L505-L612)                 | `uploadSingleRow` 无防重入                                 | 入口加 `isRunning` 检查                         |
| B3-3  | **P1** | [preview.ts:602,610](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts#L602)                      | `handleError` 被调用两次                                   | 删除重复调用                                    |
| B3-4  | **P1** | [ribbon.ts:202-213](file:///d:/编程/Excel加载项/BGM/BGM/ts/ribbon.ts#L202-L213)                      | async 调用未 `.catch()`                                    | 添加 `.catch(e => BGM.handleError(e, ...))`     |
| B3-5  | **P1** | 全库                                                                                                 | 0 处 `AbortController`                                     | `executeXhrRequest` 增加 `signal?: AbortSignal` |
| B3-6  | **P1** | [util.ts:126-150](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L126-L150)                    | `startSync` 无 `isRunning` 预检                            | 入口加预检                                      |
| B3-7  | P2     | [syncRecord.ts:498-535](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/syncRecord.ts#L498-L535)         | 8 处 `catch (_) {}` 静默吞错                               | 至少加 WARN 日志                                |
| B3-8  | P2     | [util.ts:1099](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L1099)                           | `findHeaderRow` 内 catch 静默                              | 加 WARN 日志                                    |
| B3-9  | P2     | [util.ts:721,754](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L721)                         | PluginStorage 读取失败静默                                 | 加 WARN 日志                                    |
| B3-10 | P2     | [handlers.ts:285-287](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts#L285-L287)               | `xhr.ontimeout` 仅 log 无用户提示                          | 改为 `showError`                                |
| B3-11 | P2     | [exceltobangumi.ts:703-712](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts#L703-L712) | onerror 调用 `resolve` 而非 `reject`                       | 改为 reject                                     |
| B3-12 | P3     | [dialog.ts:184](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts#L184)                            | catch 未先类型守卫                                         | 加 `instanceof Error`                           |
| B3-13 | P3     | 全库                                                                                                 | 无 `unhandledrejection` 全局兜底                           | 在入口注册全局监听器                            |

---

## 四、性能审查（B4）

### 验证结果

| 检查项                      | 结果                                                     |
| --------------------------- | -------------------------------------------------------- |
| 缓存策略                    | ✅ `sheetCache` Map + cacheGet/clear；⚠️ 无 LRU/大小限制 |
| DOM 节点增长                | ✅ 进度日志有 500 行限制；⚠️ 预览卡片无虚拟滚动          |
| addEventListener 配对       | ⚠️ 4 处匿名函数无法 remove                               |
| setInterval/setTimeout 清理 | ⚠️ 3 处递归 setTimeout 无清理                            |
| COM 批量读取                | ✅ 3 处使用 `readRangeValues`                            |
| 防抖/节流                   | ❌ **0 处使用**                                          |

### 问题清单

| ID   | 等级   | 位置                                                                                                                                                  | 问题                                                  | 建议                              |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------- |
| B4-1 | **P1** | [preview.ts:421](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts#L421)                                                                           | `body.innerHTML = statsHtml + cardsHtml` 10000 行卡死 | 虚拟滚动或分页渲染                |
| B4-2 | P2     | [util.ts:1065](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L1065)                                                                            | `sheetCache` 无 LRU，同名工作簿缓存命中陈旧           | 加 workbook 标识 + LRU            |
| B4-3 | P2     | [handlers.ts:1303,1327](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts#L1303)                                                                  | 递归 setTimeout 无清理                                | 保存 timer ID + beforeunload 清理 |
| B4-4 | P2     | [ribbon.ts:58](file:///d:/编程/Excel加载项/BGM/BGM/ts/ribbon.ts#L58)、[handlers.ts:1187](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts#L1187) | 匿名函数无法 removeEventListener                      | 提取具名函数                      |
| B4-5 | P2     | 全库                                                                                                                                                  | 0 处 debounce/throttle                                | 配置变更加 200ms debounce         |
| B4-6 | P3     | [util.ts:1083-1104](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L1083-L1104)                                                                 | `findHeaderRow` 首次扫描可能慢                        | 已有缓存，可接受                  |
| B4-7 | P3     | [util.ts:987-1015](file:///d://编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L987)                                                                        | Dialog 后端判断重复                                   | 模块级缓存判断结果                |

---

## 五、UI/UX 审查（B5）

### P0 严重

| ID      | 位置                                                                            | 问题                                         |
| ------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| B5-P0-1 | [styles.css:375](file:///d:/编程/Excel加载项/BGM/BGM/css/styles.css#L375)       | `.status` 对比度 2.8:1，远低于 WCAG AA 4.5:1 |
| B5-P0-2 | [taskpane.html:2](file:///d:/编程/Excel加载项/BGM/BGM/ui/taskpane.html#L2)      | `<html>` 缺 `lang="zh-CN"`                   |
| B5-P0-3 | [taskpane.html:4-7](file:///d:/编程/Excel加载项/BGM/BGM/ui/taskpane.html#L4-L7) | 缺 viewport/color-scheme/theme-color meta    |

### P1 高

| ID       | 位置                                                                               | 问题                                                                   |
| -------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| B5-P1-1  | [dialog.ts:67-194](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts#L67-L194)   | 6 个 bgm-modal 无 focus trap                                           |
| B5-P1-2  | [dialog.ts:620](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts#L620)          | ESC 仅完成态注册，运行中无 ESC                                         |
| B5-P1-3  | [dialog.ts:191](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts#L191)          | 使用废弃的 `keypress`，应改 `keydown`                                  |
| B5-P1-4  | [taskpane.html:225](file:///d:/编程/Excel加载项/BGM/BGM/ui/taskpane.html#L225)     | `closeSyncPreview` 缺 `aria-label`                                     |
| B5-P1-5  | [taskpane.html:102,107](file:///d:/编程/Excel加载项/BGM/BGM/ui/taskpane.html#L102) | `onchange="..."` 内联事件，违反 CSP                                    |
| B5-P1-6  | 多处                                                                               | 对比度不足：`.subtitle`/`.hint`/`.radio-desc`/`.stat-label` 均 < 4.5:1 |
| B5-P1-7  | styles.css 多处                                                                    | 5 处 `transition: all`，应列具体属性                                   |
| B5-P1-8  | styles.css 全局                                                                    | 完全缺失 `@media (prefers-reduced-motion: reduce)`                     |
| B5-P1-9  | styles.css 全局                                                                    | 无任何 `:focus-visible` 规则                                           |
| B5-P1-10 | taskpane.html 全局                                                                 | `.global { max-width: 480px }` 固定窄宽度，无媒体查询                  |

### P2 中

| ID      | 位置                               | 问题                                                                         |
| ------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| B5-P2-1 | styles.css:841 vs preview.css:74   | `.detail-item` 重复定义且属性冲突                                            |
| B5-P2-2 | styles.css:1281 vs preview.css:114 | `.upload-single-btn` 重复定义                                                |
| B5-P2-3 | styles.css 4 处                    | 4 套模态框样式并存（`.modal`/`.bgm-modal`/`.detail-modal`/`.preview-modal`） |
| B5-P2-4 | styles.css:943 vs :137             | 两套按钮系统并存（`.bgm-btn-*` vs `.btn-*`）                                 |
| B5-P2-5 | dialog.ts/preview.ts/taskpane.html | 多处内联 `style="..."` 残留                                                  |

---

## 六、安全审查（B6）

### JS-XSS-001: innerHTML 危险评估

✅ **12 处 innerHTML 全部安全**：所有用户数据均经 `escapeHtml()` 转义，`escapeHtml` 实现正确（`textContent → innerHTML` 标准模式）。

### JS-XSS-003: eval/Function

✅ **0 处** `eval`/`new Function`/`setTimeout("...")`/`setInterval("...")`。

### JS-MSG-001: postMessage origin 校验

| 位置                                                                                       | origin 校验              | 评估           |
| ------------------------------------------------------------------------------------------ | ------------------------ | -------------- |
| [message.ts:29-32](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/message.ts#L29-L32)           | `ALLOWED_ORIGINS` 白名单 | ✅ 正确        |
| [handlers.ts:1187-1239](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts#L1187-L1239) | **无任何校验**           | 🔴 **P0 危险** |
| [ribbon.ts:58-71](file:///d:/编程/Excel加载项/BGM/BGM/ts/ribbon.ts#L58-L71)                | **无任何校验**           | 🔴 **P0 危险** |

**B6-MSG-P0-1**：`handlers.ts:1187` 未校验 origin，恶意页面可伪造 `BGM:tokenUpdated`/`BGM:userIdUpdated` 消息，注入任意 Token/UserId。

**B6-MSG-P0-2**：`ribbon.ts:58` 同样无校验，可触发 Ribbon UI 失效（DoS）。

**修复**：复用 `message.ts` 的 `ALLOWED_ORIGINS` 模式。

### JS-STORAGE-001: Token 存储

| 位置                                                                                                                     | 评估                 |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| [util.ts:616](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L616) `app.PluginStorage.setItem("bgm_token", token)` | 🔴 **P1 明文存储**   |
| [util.ts:636-643](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L636-L643) 解密后明文回写                         | 🔴 **P1 降级安全**   |
| [crypto.ts:152-172](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/crypto.ts#L152-L172) XOR 加密                            | 🟡 **P2 混淆非加密** |

**XOR 加密强度评估**：

- XOR 不是真正加密，仅混淆
- `XOR_KEY` 硬编码在前端代码，任何能读 JS 的攻击者都能解密
- 已知明文攻击（token 通常以 `bgm_` 开头）可恢复密钥
- 缺少完整性校验

**建议**：升级到 Web Crypto API 的 AES-GCM + PBKDF2 密钥派生。

### JS-CSP-001: 内容安全策略

🔴 **P0**：`taskpane.html` 完全缺失 CSP meta 标签，配合内联 `<script>` 与 `onchange="..."`，XSS 防御为零。

**建议 CSP**：

```html
<meta
  http-equiv="Content-Security-Policy"
  content="
  default-src 'self';
  script-src 'self' 'nonce-<随机>';
  style-src 'self';
  img-src 'self' data:;
  connect-src https://bgm.tv https://api.bgm.tv 'self';
"
/>
```

### JSON.parse 安全

| 位置                                                                            | 评估                              |
| ------------------------------------------------------------------------------- | --------------------------------- |
| [taskpane.ts:93](file:///d:/编程/Excel加载项/BGM/BGM/ts/taskpane.ts#L93)        | 🟡 P2 未包裹 try/catch            |
| [util.ts:796](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L796)        | 🔴 P1 未包裹，解析失败导致 reject |
| [scraping.ts:103](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/scraping.ts#L103) | 🟡 P2 未包裹                      |
| 其他 9 处                                                                       | ✅ 在 try/catch 中                |

### 敏感信息日志

| 位置                                                                            | 评估                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [http.ts:169](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/http.ts#L169)        | 🟡 P2 Token 前 8 字符仍可缩小暴力破解范围，建议改 `***` |
| [handlers.ts:1191](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts#L1191) | 🟡 P2 postMessage 数据可能含 Token                      |

### 依赖漏洞

✅ 无运行时 dependencies，攻击面小。⚠️ `wpsjs@latest` 与 `et-jsapi-declare@latest` 使用 `latest` 标签，应锁定版本。

---

## 七、耦合/聚合审查（B7）

### BGM.sync 状态机单一职责

`BGM.sync` 至少承担 **5 类职责**：状态管理/停止控制/暂停恢复/位置追踪/UI 副作用/流程编排。

**B7-SRP-P1-1**：建议拆分：

- `BGM.sync` — 仅状态机 + 事件发布
- `BGM.syncPosition` — 位置追踪
- `BGM.syncOrchestrator` — 流程编排

### handlers.ts ↔ exceltobangumi.ts 耦合

通过 `index.ts` 中转导入 7 个 exceltobangumi 函数 + 9 个 util 函数，单 import 块 20+ 符号，违反"窄接口"原则。

### eventBus 协同

✅ `enterRunningState`/`exitRunningState` 等通过 `eventBus.emit(SYNC_STATE_CHANGED)` 发布事件。
🟡 **P2**：`SYNC_PROGRESS`/`SYNC_COMPLETED`/`SYNC_ERROR` 事件定义但全库无 emit 调用（死代码）。

### 循环依赖

实际循环链：

```
util.ts → crypto.ts → index.ts → util.ts
util.ts → preview.ts → index.ts → util.ts
util.ts → exceltobangumi.ts → index.ts → util.ts
```

**B7-CYCLE-P2-4**：循环依赖"运行时安全"依赖 ES 模块 hoisting，是脆弱假设。建议：

1. `crypto.ts` 不应 `import { BGM, bgmLog } from '../index.js'`
2. 抽出独立 `logger.ts`
3. `index.ts` 改为按目录 barrel

### 大文件拆分

| 文件              | 行数 | 拆分建议                                                                    |
| ----------------- | ---- | --------------------------------------------------------------------------- |
| exceltobangumi.ts | 1605 | 拆 7 个子模块（pipeline/selectedRows/episodes/api/fields/filter/colorMark） |
| handlers.ts       | 1521 | 拆 6 个子模块（token/userid/sync/debug/cleanSheet/setup）                   |
| util.ts           | 1264 | 拆 7 个子模块（logger/wpsAccess/token/userInfo/sheet/system/namespace）     |

---

## 八、组件化审查（B8）

### 5 个组件化机会

| #   | 组件        | 可行性 | 建议方案                                                         | 优先级 |
| --- | ----------- | ------ | ---------------------------------------------------------------- | ------ |
| 1   | ProgressBar | ✅ 高  | 抽出 `ts/ui/components/ProgressBar.ts` 工厂函数                  | P1     |
| 2   | Dialog 系统 | ✅ 高  | 统一 `createDialog({ type, title, ... })` 工厂，8 套 dialog 统一 | P1     |
| 3   | Button 系统 | ✅ 高  | 废弃 `.bgm-btn-*`，统一到 `.btn-*`                               | P2     |
| 4   | ScrollArea  | 🟡 中  | 抽 `.bgm-scroll` utility 类（不引入 shadcn）                     | P3     |
| 5   | Checkbox    | 🟡 中  | 抽 `.bgm-checkbox` + `bindCheckbox` 工具函数                     | P3     |

### shadcn 引入评估

**B8-SHADCN-P0-1**：**不建议引入 shadcn/ui**。原因：

- 项目是原生 TypeScript + Vite，无 React/JSX 运行时
- shadcn 强依赖 React + Radix UI + Tailwind CSS
- 引入意味新增 ~30 个运行时依赖 + 改写全部 UI 为 JSX

**替代方案**：采用"原生 TS Web Components + 工厂函数"模式。

---

## 九、边界验证方案（21 项）

### C1 数据预览边界（4 项）

#### C1-1 空表预览

- **数据准备**：新建工作簿，仅表头行（A1=「序号」B1=「Bangumi_URL」C1=「名称」D1=「是否看完」），无数据行。Token 有效。
- **操作步骤**：① 打开 Taskpane，选中该工作表 → ② 点击「同步到 Bangumi」→ ③ 确认框显示「总行数：0」→ ④ 点击「预览」
- **预期结果**：确认框 `总行数: 0, 有效条目: 0, 待同步: 0`；预览 Toast「没有可预览的数据行」；`BGM.sync.isRunning === false`
- **风险等级**：低

#### C1-2 单行表预览

- **数据准备**：表头 + 第 2 行 `1 | https://bgm.tv/subject/1 | 测试番剧 | 看过`
- **操作步骤**：点击「预览」
- **预期结果**：进度 `1/1`；模态框 1 张卡片；统计「总行数 1 / 待上传 1 / 已上传 0」
- **风险等级**：低

#### C1-3 筛选状态下预览

- **数据准备**：5 行数据，第 3、5 行「想看」，其他「看过」。Excel 自动筛选 = 「想看」
- **操作步骤**：启用筛选 → 点击「预览」
- **预期结果**：仅渲染 2 张卡片（第 3、5 行）；统计「总行数 2」
- **风险等级**：中

#### C1-4 跳行/合并单元格预览

- **数据准备**：第 2、4、6 行有数据（3、5 空）；B2:B3 合并单元格
- **操作步骤**：点击「预览」
- **预期结果**：渲染 3 张卡片；日志 `跳过行 3 (空卡片)`；无 COM 异常
- **风险等级**：中

### C2 同步操作边界（5 项）

#### C2-1 Token 失效时同步

- **数据准备**：PluginStorage 写入过期 Token。5 行有效数据
- **操作步骤**：点击 Ribbon「同步 Bangumi」→ 确认
- **预期结果**：每行 HTTP 401；最终弹窗「失败: 5 条」；5 行序列号列变红；状态机正确退出
- **风险等级**：低

#### C2-2 网络断开时同步

- **数据准备**：Token 有效，5 行数据。同步前断网
- **操作步骤**：点击「同步到 Bangumi」→ 确认
- **预期结果**：`xhr.onerror` 触发；进度弹窗 `✗ HTTP:0 Network error`；最终「失败: 5 条」
- **风险等级**：低

#### C2-3 并发触发同步

- **数据准备**：100 行数据
- **操作步骤**：快速连续点击 Ribbon 3 次 + Taskpane 2 次 + 预览 1 次（间隔 < 100ms）
- **预期结果**：第 1 次成功；后续全部被 `enterRunningState` 拦截；不出现多个同步循环；不出现多个进度弹窗
- **风险等级**：中

#### C2-4 超大表（10000 行）同步

- **数据准备**：脚本生成 10000 行 `https://bgm.tv/subject/N`
- **操作步骤**：点击「同步到 Bangumi」→ 5000 行时点击「停止」
- **预期结果**：进度条缓慢上升；停止后 `wasStopped = true`；`exitRunningState()` 调用；**风险**：preview 路径渲染 10000 卡片可能卡死
- **风险等级**：高

#### C2-5 特殊字符

- **数据准备**：3 行：emoji/控制字符/1500 字符超长感言
- **操作步骤**：点击「同步到 Bangumi」
- **预期结果**：emoji 正常；控制字符被 `replace(/[\x00-\x08...]/g, '')` 清除；超长感言 `slice(0, 1000)` 截断
- **风险等级**：低

### C3 工作表操作边界（4 项）

#### C3-1 同步中切换工作簿

- **数据准备**：Book1（5 行）、Book2（3 行）
- **操作步骤**：Book1 启动同步 → 第 2 行时切换到 Book2
- **预期结果**：`BGM.sync.currentSheet` 仍指向 Book1；同步继续；**风险**：Book1 关闭后 `ws.Range()` 抛异常
- **风险等级**：高

#### C3-2 同步中删除工作表

- **数据准备**：Sheet1（5 行）、Sheet2
- **操作步骤**：Sheet1 启动同步 → 删除 Sheet2 → 重复实验删除 Sheet1
- **预期结果**：删除 Sheet2 无影响；删除 Sheet1 → COM 异常 → `exitRunningState()` → 弹窗「同步失败」
- **风险等级**：高

#### C3-3 锁定工作表后切换

- **数据准备**：Sheet1 保护（密码 `123`）
- **操作步骤**：启动同步
- **预期结果**：`cell.Interior.Color` 抛异常；HTTP 请求仍成功；颜色标记未生效；日志含 COM 异常
- **风险等级**：中

#### C3-4 同步中重命名工作表

- **数据准备**：Sheet1（5 行）
- **操作步骤**：启动同步 → 第 2 行时重命名为「Sheet1_Renamed」
- **预期结果**：COM 引用仍有效；同步继续；**但** `sheetCache` key 含 `ws.Name`，旧缓存残留（内存泄漏）
- **风险等级**：中

### C4 Ribbon ↔ Taskpane 状态同步（4 项）

#### C4-1 Ribbon 触发，Taskpane 状态

- **数据准备**：Token 有效，5 行数据
- **操作步骤**：点击 Ribbon「同步 Bangumi」→ 观察 Taskpane 按钮
- **预期结果**：**当前问题**：Ribbon 同步时 Taskpane 按钮不被禁用；用户点击 Taskpane → `enterRunningState` 返回 false → 弹「同步进行中」
- **风险等级**：中

#### C4-2 Taskpane 触发，Ribbon 按钮

- **数据准备**：同上
- **操作步骤**：Taskpane 点击「同步到 Bangumi」→ 观察 Ribbon
- **预期结果**：Ribbon 无 disabled 状态；用户点击 Ribbon → `isRunning` 为 true → `wpsMsgBox`
- **风险等级**：低

#### C4-3 Token 跨面板同步

- **数据准备**：Token 未设置
- **操作步骤**：Ribbon「设置 Token」→ 输入有效 Token → 观察 Taskpane
- **预期结果**：2 秒内 Taskpane 状态栏从「未设置」变为「已设置: username」
- **风险等级**：低

#### C4-4 同步记录开关跨面板

- **数据准备**：Ribbon「启用同步记录」未选中
- **操作步骤**：Ribbon 勾选 → 观察 Taskpane → Taskpane 取消勾选 → 观察 Ribbon
- **预期结果**：Ribbon→Taskpane 2 秒内同步；Taskpane→Ribbon **不同步**（无 `InvalidateControl` 调用）
- **风险等级**：中

### C5 类型安全与错误处理边界（4 项）

#### C5-1 catch 块抛非 Error 对象

- **数据准备**：控制台模拟
- **操作步骤**：`BGM.handleError("string error", {showAlert: true})` / `BGM.handleError({custom: true}, ...)` / `BGM.handleError(null, ...)`
- **预期结果**：字符串→弹窗「string error」；对象→弹窗「[object Object]」⚠️；null→弹窗「null」⚠️；不崩溃
- **风险等级**：低

#### C5-2 API 返回非 JSON

- **数据准备**：Charles 拦截 `/v0/me` 响应替换为 `<html>Not Found</html>`
- **操作步骤**：点击 Ribbon「测试 Token」
- **预期结果**：`JSON.parse` 抛 SyntaxError → catch → `showError('解析失败', ...)`；不崩溃
- **风险等级**：中

#### C5-3 API 返回字段缺失

- **数据准备**：拦截 `/v0/me` 返回 `{"id":123}`（缺 username/nickname）
- **操作步骤**：点击 Ribbon「测试 Token」
- **预期结果**：显示「未知用户」；userId="123"；**但** `_setBgmUsername('未知用户')` 将占位符当真实用户名存储 ⚠️
- **风险等级**：中

#### C5-4 网络超时（>30s）

- **数据准备**：网络模拟工具设 `api.bgm.tv` 延迟 35 秒
- **操作步骤**：点击 Ribbon「测试 Token」→ 等待 30 秒
- **预期结果**：`xhr.ontimeout` 触发；**当前问题**（B3-10）：仅 log 无用户提示；用户看到 30 秒无反馈
- **风险等级**：中

---

## 十、MCP 化可行性评估（D1）

### 候选 MCP 工具（7 个）

| 工具名                   | 功能                  | 只读 | 对应现有函数                          |
| ------------------------ | --------------------- | ---- | ------------------------------------- |
| `bgm_search_subject`     | 搜索条目              | ✅   | 新增（API `/v0/search/subject`）      |
| `bgm_get_user_info`      | 验证 Token + 用户资料 | ✅   | `verifyToken`                         |
| `bgm_get_collection`     | 获取用户收藏          | ✅   | `fetchAllUserCollections`             |
| `bgm_get_sync_records`   | 查询本地同步记录      | ✅   | `getAllSyncRecords`                   |
| `bgm_extract_subject_id` | 从 URL 提取 SID       | ✅   | `extractSubjectId`（纯函数）          |
| `bgm_mark_episode`       | 标记章节已看          | ❌   | `markEpisodesComplete`                |
| `bgm_sync_to_collection` | 同步单条到收藏        | ❌   | `bgmRequestSync` + `buildJsonPayload` |

### 传输方式建议

**推荐：stdio 为主 + HTTP 为辅（分阶段）**

- Phase 1-2 采用 stdio：WPS 加载项场景天然单用户，Excel 数据交互是核心差异化能力
- Phase 3 评估 HTTP：当出现团队共享需求时追加，仅承载只读工具

### 与现有 bgmRequestSync 复用关系

**推荐策略**：重构为独立 HTTP 客户端模块 `ts/mcp/bgmHttpClient.ts`

- 使用 Node 内置 `fetch`（Node 18+），避免新增依赖
- 内置指数退避重试（1s → 2s → 4s）
- 抽离 `extractResponseMessage`/`parseErrorResponse` 到 `pureUtils.ts`，两环境共享
- `bgmRequestSync`（旧）改为薄包装，保持 WPS 加载项侧零行为变化

### Token 管理三层来源

1. **环境变量** `BGM_TOKEN`：CI/脚本场景
2. **本地配置文件** `~/.bgm-mcp/config.json`（chmod 600）：持久化场景
3. **工具调用参数** `token: string`：每次调用显式传入

### 实施路线图

| Phase             | 范围                                                                                                   | 验证标准                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Phase 1（2 周）   | 3 个只读工具 + bgmHttpClient 重构 + stdio                                                              | MCP Inspector 列出 3 工具；`bgm_extract_subject_id` 返回正确 SID |
| Phase 2（2-3 周） | 3 个写入/查询工具 + Token 三层来源 + 限流                                                              | `bgm_sync_to_collection` 创建收藏 HTTP 200；429 自动重试 3 次    |
| Phase 3（3-4 周） | Excel 数据交互 + `bgm_get_sync_records` + `bgm_read_subjects_from_sheet` + `bgm_batch_sync_from_sheet` | 10 条数据工作表读取正确；50 条批量同步 < 30s                     |

### 风险与约束

| 风险         | 缓解措施                                                |
| ------------ | ------------------------------------------------------- |
| Token 安全   | 环境变量优先 + 日志脱敏 + OS 钥匙串                     |
| 并发         | stdio 单连接串行化 + 全局速率限制（800ms 间隔）         |
| 错误处理     | 429 自动重试 + `isError: true` MCP 错误响应             |
| 与加载项并存 | 补充而非替代；共享 `pureUtils.ts` 与 `bgmHttpClient.ts` |

---

## 十一、安全最佳实践审查（D2）

基于 OWASP 前端安全规范，按 Rule ID 组织：

### JS-XSS-001（innerHTML）

- ✅ 12 处 innerHTML 全部安全
- `escapeHtml` 实现正确（`textContent → innerHTML`）

### JS-XSS-003（eval/Function）

- ✅ 0 处

### JS-URL-001/002（URL 注入）

- ✅ 无 `.href =` 或 `.src =` 来自用户输入

### JS-MSG-001（postMessage）

- 🔴 **P0×2**：`handlers.ts:1187` 与 `ribbon.ts:58` 未校验 origin
- 修复：复用 `message.ts` 的 `ALLOWED_ORIGINS` 模式

### JS-STORAGE-001（存储敏感数据）

- 🔴 **P1**：Token 明文存储 + XOR 混淆非加密
- 建议：升级到 AES-GCM + PBKDF2

### JS-CSP-001（CSP）

- 🔴 **P0**：完全无 CSP
- 建议：添加 CSP meta + 移除内联 script/handler

### JSON.parse 安全

- 🔴 **P1×1**：`util.ts:796` 未包裹
- 🟡 **P2×2**：`taskpane.ts:93`、`scraping.ts:103` 未包裹
- ✅ 其他 9 处在 try/catch 中

### 依赖漏洞

- ✅ 无运行时 dependencies
- ⚠️ `wpsjs@latest` 应锁定版本

### 敏感信息日志

- 🟡 **P2**：Token 前 8 字符仍可缩小暴力破解范围

---

## 十二、UI 设计规则审查（D3）

### 关键发现（file:line 格式）

```
ui/taskpane.html:2 - <html> missing lang="zh-CN"
ui/taskpane.html:3 - missing <meta name="viewport">
ui/taskpane.html:8 - missing color-scheme: dark on <html>
ui/taskpane.html:39 - starts with <h2>, missing <h1>
ui/taskpane.html:86 - <label> not associated with #listTypeSelect
ui/taskpane.html:102 - onchange="..." inline handler (CSP violation)
ui/taskpane.html:143 - #detailModal missing role="dialog" aria-modal="true"
ui/taskpane.html:219 - #syncPreviewModal missing role="dialog" aria-modal="true"
ui/taskpane.html:225 - #closeSyncPreview icon-only button missing aria-label
ui/taskpane.html:271 - all buttons disabled by default; no skeleton/aria-busy
css/styles.css:101 - .subtitle color #888 on #242424: contrast 3.5:1, fails WCAG AA
css/styles.css:222 - .hint color #888: contrast 3.5:1, fails WCAG AA
css/styles.css:369 - .status color #888 on #333: contrast 3.4:1, fails WCAG AA
css/styles.css:143 - .btn { transition: all 0.3s } → list specific properties
css/styles.css:194 - .btn.small padding 6px 12px → touch target ~28-32px, below 44×44
css/styles.css:847 - .bgm-modal missing overscroll-behavior: contain
css/styles.css:951 - .bgm-btn min-width 80px but no min-height for touch
css/preview.css:39 - #closeSyncPreview width:32px → below 44×44 touch target
css/preview.css:1 - entire file lacks @media (prefers-reduced-motion: reduce)
```

---

## 十三、关键界面截图说明（D4）

> 由于 BGM 在 WPS 任务窗格中渲染，无法通过 Playwright/agent-browser 直接截图。以下为基于代码分析的"应截图内容"描述。

### D4.1 主面板（taskpane 默认状态）

- **截图内容**：WPS 任务窗格垂直滚动长页面，11 个独立卡片区域
- **预期视觉**：背景 `#242424`，卡片 `#2d2d2d`，标题蓝色下划线 `#4a9eff`
- **可访问性检查点**：❌ 缺 lang/viewport；❌ label 未关联；❌ 模态无 role
- **潜在问题**：多套调色板混用（自定 + Catppuccin Mocha）

### D4.2 同步进度弹窗（运行中）

- **截图内容**：全屏模态，半透明遮罩 + 居中卡片（max-width 640px）
- **预期视觉**：进度条 `var(--green, #a6e3a1)`，日志背景 `var(--crust, #11111b)`
- **可访问性检查点**：✅ `role="dialog"` + `aria-modal` + `role="progressbar"` + `aria-live`；❌ 无 focus trap
- **潜在问题**：未实现焦点陷阱；运行中无 ESC

### D4.3 同步完成弹窗

- **截图内容**：状态切换为完成态，图标 ✅，摘要 + 详情区 + 显示详情/确定按钮
- **可访问性检查点**：✅ ESC 关闭；✅ 焦点切换；❌ 摘要无 `role="status"`
- **潜在问题**：状态切换无 `aria-live` 公告

### D4.4 预览面板

- **截图内容**：全屏模态 `#syncPreviewModal`，卡片列表（非表格）
- **预期视觉**：渐变标题栏，3 列统计卡片，卡片左侧 3px 状态色边
- **可访问性检查点**：❌ 缺 role="dialog"；❌ × 按钮缺 aria-label；❌ 无虚拟滚动；❌ 无键盘导航
- **潜在问题**：100+ 卡片性能下降；URL 下划线但不可点击误导

---

## 十四、优化建议汇总（按优先级排序）

### P0 立即修复（7 项）

1. **B6-MSG-P0-1/2**：`handlers.ts:1187` + `ribbon.ts:58` 添加 postMessage origin 校验
2. **B6-CSP-P0**：`taskpane.html` 添加 CSP meta + 移除内联 script/handler
3. **B2-1**：`tsconfig.json` 添加 `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `useUnknownInCatchVariables`
4. **B3-1**：删除或改造 `setSyncRunning`，统一走 `enterRunningState/exitRunningState`
5. **B5-P0-1**：`.status` 颜色对比度 2.8:1 → 提升到 ≥ 4.5:1
6. **B5-P0-2**：`<html>` 添加 `lang="zh-CN"`
7. **B5-P0-3**：`<head>` 添加 viewport/color-scheme/theme-color meta

### P1 高优先级（28 项，关键）

- B1-1/B1-2/B1-3：长函数/超大对象拆分
- B2-2：添加 ESLint 配置
- B3-2/B3-3/B3-4/B3-5/B3-6：防重入/错误处理/AbortController
- B4-1：preview 虚拟滚动
- B5-P1-1～10：focus trap/ESC/keypress/aria-label/对比度/transition/reduced-motion/focus-visible/响应式
- B6-STORAGE-P1：Token 存储升级 AES-GCM
- B6-JSON-P1-1：`util.ts:796` JSON.parse 包裹 try/catch
- B7-SRP-P1-1：BGM.sync 状态机拆分
- B7-FILE-P1-2：3 个文件拆分

### P2 中优先级（27 项）

类型断言/空 catch/监听器清理/缓存策略/内联样式/4 套 modal 不一致/2 套 button 不一致/循环依赖/JSON.parse 防御等

### P3 低优先级（17 项）

命名细节/文档同步/日志冗余/省略号/autocomplete/滚动条 Firefox/语义化标签等

---

## 十五、待办事项状态

### 在追（本次审查发现，待修复）

- 全部 P0/P1 问题
- 大部分 P2 问题

### 再看（暂保留）

- shadcn 引入（不建议，原生 TS 无 React）
- zod/io-ts 引入（破坏零依赖优势）
- `SYNC_PROGRESS`/`SYNC_COMPLETED`/`SYNC_ERROR` 死代码（保留供未来扩展）

### 搁置

- 无

### 抛弃

- 无

---

## 十六、验证执行建议

C1-C5 共 21 项验证方案，建议按以下顺序执行：

1. **先执行 C5（类型/错误）**：纯代码层面，可在开发环境快速验证
2. **再执行 C1（预览）**：验证基础数据流
3. **然后 C2（同步）**：需要 Token 和网络
4. **最后 C3/C4（跨面板）**：需要完整 WPS 环境

---

## 十七、编译验证

- **TypeScript 编译**: `npx tsc --noEmit` 退出码 0 ✅
- **全库 any 残留**: 0 处 ✅
- **unknown 使用**: 203 处（合规）
- **审查范围**: 22 个 .ts 文件 + 1 个 HTML + 2 个 CSS + package.json + tsconfig.json

---

_报告生成完毕。本次为只读审查，未修改任何代码。所有在追项待后续迭代修复。_
