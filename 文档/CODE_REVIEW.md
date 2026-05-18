# BGM Excel 加载项 — 全面代码审查报告

> 审查日期：2026-05-17  
> 代码行数：~5200 行 TypeScript + HTML/CSS/XML 配置  
> 审查范围：全部 21 个源文件

---

## 目录

1. [项目概览](#1-项目概览)
2. [架构分析](#2-架构分析)
3. [严重 Bug（P0）](#3-严重-bugp0)
4. [高优先级问题（P1）](#4-高优先级问题p1)
5. [中优先级问题（P2）](#5-中优先级问题p2)
6. [低优先级问题（P3）](#6-低优先级问题p3)
7. [模块逐文件审查](#7-模块逐文件审查)
8. [优化建议路线图](#8-优化建议路线图)

---

## 1. 项目概览

### 1.1 基本信息

| 项目 | 说明 |
|------|------|
| 名称 | BGM Excel 加载项（追番标记助手） |
| 类型 | WPS Excel 加载项（`et` 类型） |
| 技术栈 | TypeScript + Vite + WPS COM API |
| 构建 | `tsc` 输出到 `dist-ts/`，Vite 打包 `index.html` 到 `dist/` |
| 运行时 | WPS 内嵌浏览器（IE 兼容内核） |

### 1.2 目录结构

```
BGM/
├── ts/                        # TypeScript 源码
│   ├── core/                  # 核心：常量、加密、结果类型
│   │   ├── constants.ts       # 全局常量/枚举/映射表 (468行)
│   │   ├── crypto.ts          # Token 加密/解密 (316行)
│   │   └── result.ts          # Result<T> 类型 + BgmError (338行)
│   ├── services/              # 服务层
│   │   └── ribbonService.ts   # Ribbon 专用服务 (434行)
│   ├── sync/                  # 同步引擎
│   │   ├── exceltobangumi.ts  # Excel→Bangumi 批量同步 (1333行)
│   │   ├── scraping.ts        # Bangumi→Excel 数据抓取 (300行)
│   │   └── syncRecord.ts      # 同步记录工作表管理 (332行)
│   ├── tools/                 # 工具模块
│   │   ├── config.ts          # 配置管理 (PluginStorage) (137行)
│   │   ├── events.ts          # 事件总线 (157行)
│   │   ├── http.ts            # HTTP 请求封装 (284行)
│   │   ├── util.ts            # 核心工具库 (1204行)
│   │   └── wps.ts             # WPS 类型定义 (331行)
│   ├── ui/                    # 用户界面
│   │   ├── dialog.ts          # 对话框组件 (250行)
│   │   ├── handlers.ts        # 事件处理分发 (~1340行)
│   │   ├── message.ts         # 消息通信 (55行)
│   │   └── preview.ts         # 数据预览 (670行)
│   ├── index.ts               # 统一导出桶文件 (426行)
│   ├── ribbon.ts              # Ribbon 面板入口 (167行)
│   └── taskpane.ts            # 任务窗格入口 (~900行)
├── ui/
│   └── taskpane.html          # 任务窗格 HTML (260行)
├── index.html                 # Ribbon 入口 HTML (125行)
├── main.js                    # 模块加载器 (72行)
├── ribbon.xml                 # Ribbon XML 配置 (19行)
├── manifest.xml               # WPS 加载项清单
├── vite.config.js             # Vite 构建配置
├── tsconfig.json              # TS 基础配置
└── tsconfig.build.json        # TS 构建配置
```

### 1.3 架构评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 模块划分 | ⭐⭐⭐⭐ | 按功能域清晰划分：core/tools/sync/ui/services |
| 类型安全 | ⭐⭐ | 大量 `any` 类型、COM 对象未完整建模 |
| 错误处理 | ⭐⭐ | 部分模块完善，部分模块缺失 try-catch |
| 跨上下文通信 | ⭐⭐ | 三套机制并存，复杂且易出错 |
| 性能 | ⭐⭐⭐ | 批量读取已实现，但部分循环存在 COM 调用冗余 |
| 可维护性 | ⭐⭐⭐ | 文档注释较好，但大型函数需要拆分 |

---

## 2. 架构分析

### 2.1 双上下文架构（核心设计）

```
┌─────────────────────────────────────────────────┐
│                   WPS 宿主进程                   │
│  ┌─────────────┐          ┌───────────────────┐ │
│  │  Ribbon 面板  │          │   Taskpane 任务窗格 │ │
│  │  (index.html)│          │  (taskpane.html)  │ │
│  │              │          │                   │ │
│  │  独立 BGM 实例  │  ←??→  │  独立 BGM 实例     │ │
│  │  独立 EventBus │          │  独立 EventBus    │ │
│  │  独立 Cache   │          │  独立 Cache      │ │
│  └──────┬───────┘          └────────┬──────────┘ │
│         │                          │             │
│         └──────── PluginStorage ───┘             │
│              (唯一共享存储 + 轮询同步)             │
└─────────────────────────────────────────────────┘
```

**关键约束**：两个 iframe 是平级上下文，`postMessage` 无法跨 iframe 通信，`eventBus` 互不相通。

### 2.2 通信机制（当前方案）

| 机制 | 用途 | 延迟 | 可靠性 |
|------|------|------|--------|
| **PluginStorage 轮询** | Taskpane 每 5s 读取 Ribbon 写入的配置 | ≤5s | 高 |
| **PluginStorage 写入** | Ribbon/Taskpane 双向持久化状态 | 即时 | 高 |
| **eventBus** | 同上下文内模块通信 | 即时 | 高 |
| **GetTaskPane** | Ribbon 直接调用 Taskpane 函数 | 即时 | 低（需 try-catch） |

### 2.3 模块加载顺序

```
main.js → index.js (类型导出) → config.js → util.js (BGM全局对象) →
constants.js → crypto.js → events.js → wps.js → http.js → dialog.js →
message.js → preview.js → syncRecord.js → scraping.js →
exceltobangumi.js → ribbonService.js → ribbon.js → handlers.js → taskpane.js
```

⚠ **循环依赖风险**：`index.js` 从所有子模块重新导出，而子模块又从 `index.js` 导入，可能构成循环。

---

## 3. 严重 Bug（P0）

~~### 3.1 🔴 `WATCH_STATUS_MAP` 映射颠倒（数据正确性）~~ ✅ 已确认无问题
~~**文件**：[core/constants.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/core/constants.ts#L403-L414)~~
~~经用户通过单条测试同步按钮验证，映射实际正确，此条为误报。

---

### 3.2 🔴 `handlers.ts` 语法错误：多余的 `;5`

**文件**：[ui/handlers.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts#L21)

```typescript
} from '../index.js';5    // ← 多余的 ';5'
```

这是复制粘贴残留，运行时可能被解析为无害表达式语句，但属于代码缺陷。

---

### 3.3 🔴 `taskpane.html` 按钮禁用脚本在 DOM 前执行

**文件**：[ui/taskpane.html](file:///d:/编程/Excel加载项/BGM/BGM/ui/taskpane.html#L36-L40)

```html
<head>
  <script>
    // ❌ 此时 <body> 中的按钮尚未解析！
    document.querySelectorAll('button[data-action]').forEach(function(btn) {
        btn.disabled = true;  // 找不到任何按钮，逻辑完全失效
    });
  </script>
</head>
```

**修复**：将此脚本移到 `<body>` 末尾或包裹在 `DOMContentLoaded` 事件中。

---

### 3.4 🔴 `preview.ts` 事件监听器内存泄漏

**文件**：[ui/preview.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts#L332-L346)

`previewSyncContent()` 每次调用都向 `.modal-body` 添加新的 `click` 监听器，从不移除。多次打开预览 → 同一点击触发多次回调。

**修复**：添加前先 `removeEventListener`，或使用 `AbortController`。

---

### 3.5 🔴 `scraping.ts` 使用 `fetch()` API — 兼容性风险

**文件**：[sync/scraping.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/scraping.ts#L211-L216)

```typescript
const response = await fetch(url, { headers });
```

WPS 内嵌浏览器可能基于旧版 IE 引擎，不支持 `fetch()`。其他模块统一使用 `XMLHttpRequest`。

**修复**：改用 `XMLHttpRequest` 封装或已有的 `httpRequest` 工具函数。

---

### 3.6 🔴 `Dialog.show` 对 `'confirm'` 类型静默降级为 `alert`

**文件**：[tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L177-L192)

```typescript
show: function(type, ...) {
    switch (type) {
        case 'error': this.error(title, message); break;
        case 'input': ... 
        default:  // 'confirm' 落入这里 → 显示为 alert！无确认/取消按钮
            this.alert(title, message);
    }
}
```

用户调用 `BGM.Dialog.show('confirm', ...)` 时会看到一个无用的提示框。

---

## 4. 高优先级问题（P1）

### 4.1 🟠 同步 XHR 阻塞主线程（`bgmRequestSync`）

**文件**：[sync/exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts#L790)

```typescript
xhr.open(method, url, false);   // 同步模式！
```

批量同步期间 WPS 界面完全无响应。用户无法取消操作。如果网络挂起，WPS 进程假死。

**修复**：改为 `xhr.open(method, url, true)` + Promise 异步模式。

---

### 4.2 🟠 并发池设计形同虚设

**文件**：[sync/exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts#L885-L956)

代码设计了 `DEFAULT_CONCURRENCY = 5` 的并发池，但由于 `bgmRequestSync` 使用同步 XHR，所有请求**严格串行**执行。JavaScript 单线程意味着 `Promise.race` 仅在同步 XHR 返回后才轮到下一个。

---

### 4.3 🟠 `buildJsonPayload` 绕过批量读取优化

**文件**：[sync/exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts#L672-L759)

`SyncToBangumiAsync` 已通过 `createFieldGetter` 批量读取 Excel 数据。但 `buildJsonPayload` 内部全部使用 `readCell()` 逐格读取，每条记录产生 6 次额外 COM 调用。

---

### 4.4 🟠 两个 `xhr.timeout` 未设置导致 `ontimeout` 死代码

**文件**：
- [sync/scraping.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/scraping.ts#L103)
- [sync/exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts#L260-L264)

设置了 `xhr.ontimeout` 回调但从未设置 `xhr.timeout` 值（默认为 0 = 无超时），超时处理逻辑永远不会执行。

---

### 4.5 🟠 `readCell` 和 `getCellValue` 代码完全重复

**文件**：[tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L462-L501)

```typescript
export function getCellValue(ws, row, col): string {
    if (!ws) return '';
    try {
        const address = colNumToLetter(col) + row;
        const cell = ws.Range(address);
        if (!cell) return '';
        const raw = getCellRawValue(cell);
        return raw != null ? String(raw) : '';
    } catch { return ''; }
}
// readCell 完全相同的实现…
```

---

### 4.6 🟠 Console 猴子补丁全局不可逆

**文件**：[tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L825-L850)

IIFE 在加载时覆盖全局 `console.log/warn/error`，添加 `[BGM]` 前缀。不可逆且与其他插件冲突。

---

### 4.7 🟠 `buildCache` 逐行逐列 COM 读取

**文件**：[sync/syncRecord.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/syncRecord.ts#L128-L160)

循环中对每行 11 列调用 `getCellValue()`。1000 条记录 = 11000 次 COM 调用。

**修复**：使用 `readRangeValues` 一次性读取。

---

## 5. 中优先级问题（P2）

### 5.1 🟡 三套通信机制并存

同一状态更新（Token/UserID/Config）通过三通道传播：

1. `eventBus`（同上下文）
2. `postMessage`（跨上下文，但不可靠）
3. PluginStorage 轮询（跨上下文，可靠但有延迟）

导致 `updateTokenStatus()` 可能被多次冗余调用。

---

### 5.2 🟡 `syncRecord.ts` 多工作簿缓存污染

模块级全局缓存 `_syncRecordSidCache` / `_syncRecordListCache` 在切换工作簿时可能存在过期数据。

---

### 5.3 🟡 `sleep()` 同步忙等待阻塞 UI

**文件**：[tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L811-L821)

```typescript
const end = Date.now() + ms;
while (Date.now() < end) {
    app?.DoEvents();  // 忙等待！
}
```

同时导出了两个函数：`sleep`（阻塞）和 `delay`（Promise），调用方容易混淆。

---

### 5.4 🟡 PostMessage 使用 `'*'` 目标源

**文件**：[tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L199)

```typescript
window.parent.postMessage(..., '*');  // 安全风险
```

---

### 5.5 🟡 `getFilterStatus` 参数重载语义混乱

**文件**：[sync/exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts#L456-L463)

`getFilterStatus(wsOrLastRow?, lastRow?, headerRow?)` 支持两种调用模式，类型判断不可靠。

---

### 5.6 🟡 无限增长的无界 `sheetCache`

**文件**：[tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L933)

```typescript
const sheetCache = new Map<string, any>();  // 无 TTL、无上限、无 LRU
```

---

### 5.7 🟡 3 个重叠的 Native Code 检测函数

**文件**：[tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts)

`tryGetProperty` (L414)、`isNativeCode` (L874)、`safeCellValue` (L886) 各自实现了略有不同的 COM native code 检测逻辑。应合并。

---

### 5.8 🟡 `startSync` 不重置 `shouldStop`

**文件**：[tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L87-L88)

`.then()` 只设置 `isRunning = false`，不调用 `resetStopFlag()`。如果用户在之前的同步中点了停止，后续同步将永远被阻止。

---

### 5.9 🟡 `lastSyncTime` 语义错误

**文件**：[tools/util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L68)

```typescript
lastSyncTime: new Date().toISOString(),  // 模块加载时间，不是"上次同步时间"
```

`startSync` 从未更新此字段。

---

### 5.10 🟡 `clearSheetMarksInSheet` 硬编码 D 列

**文件**：[sync/syncRecord.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/syncRecord.ts#L323)

```typescript
const cell = ws.Range(`D${r}`);  // 硬编码 D 列
```

如果序列号列在不同位置，此函数将无效。

---

### 5.11 🟡 `testTokenValidityForRibbon` 日志冗余

单个 Token 验证操作（通常调用一次）产生约 15 条日志，包括完整的 HTTP 响应头。

---

### 5.12 🟡 重复错误处理

**文件**：[ui/preview.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/preview.ts#L520-L532)

同一个错误被 `BGM.handleError` 处理了两次，完全重复。

---

## 6. 低优先级问题（P3）

### 模块顶层立即执行代码

[dialog.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/dialog.ts#L59)、[handlers.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ui/handlers.ts#L1014)、[ribbon.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/ribbon.ts#L28) 在模块顶层直接执行代码，而非暴露初始化函数。

### TypeScript `any` 滥用

几乎所有 `catch` 块使用 `e: any`，WPS COM 对象使用 `(window as any)`。建议改用 `unknown` + 类型守卫。

### `WPS_ENUM` / `XL` 导入但使用魔法数字

`XL.xlUp` 已在 [util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L2) 导入，但在 [L1095](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L1095) 等处仍使用硬编码 `-4162`。

### 全局 Escape 键监听器未清理

[taskpane.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/taskpane.ts#L851) — 在 `document` 上注册的 keydown 监听器永不移除。

### `<label>` 缺少 `for` 属性

[taskpane.html](file:///d:/编程/Excel加载项/BGM/BGM/ui/taskpane.html) 多处 `<label>` 未关联表单控件，降低可访问性。

### `taskpane.html` 内联样式与外部 CSS 混用

[taskpane.html](file:///d:/编程/Excel加载项/BGM/BGM/ui/taskpane.html#L237-L248) `syncPreviewModal` 大量使用内联 `style`。

### `GetUrlPath` 命名风格不一致

[util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L740) — 项目中唯一使用 PascalCase 命名的函数（应为 `getUrlPath`）。

### `isEmptyValue` 将字符串 `"null"` 视为空值

[util.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/tools/util.ts#L1160-L1163) — 语义有争议。

### 硬编码值散落各处

| 值 | 应来自 | 文件 |
|---|---|---|
| `50000` | `PANEL_CONFIG` | util.ts:L1071,L1150 |
| `50` | `PANEL_CONFIG.MAX_SCAN_COLUMNS` | util.ts:L994,L1044 |
| `/v0/me` | `BGM_CONFIG` | util.ts:L660 |
| `'bgm_token'` | `CONFIG_KEYS.TOKEN` | util.ts:L549,L559,L569 |

### `buildJsonPayload` 失败返回 `'{}'` 可能破坏数据

[exceltobangumi.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/exceltobangumi.ts#L756-L759) — 空 JSON 发给 API 可能清空已有收藏。

### 429 限流重试可能无限循环

[scraping.ts](file:///d:/编程/Excel加载项/BGM/BGM/ts/sync/scraping.ts#L219-L222) — 缺少最大重试次数限制。

---

## 7. 模块逐文件审查

### 7.1 `tools/util.ts` (1204 行) — 总评 ⭐⭐

**职责过多**：既是工具函数库，又包含 BGM 全局状态对象（270 行）、对话框路由、消息通信、缓存管理。

**关键问题**：
- BGM 全局对象应拆分为 `BGM.cache`、`BGM.sync`、`BGM.Dialog` 独立模块
- `getLastRow` 94 行 5 级回退，应拆分为策略函数
- 6 个未使用的导入（WPS_ENUM, XL, BGM_COLOR 等）
- 空的 catch 块（L967）静默吞噬错误

### 7.2 `sync/exceltobangumi.ts` (1333 行) — 总评 ⭐⭐⭐

**最大的单个文件**。同步引擎逻辑正确但性能有瓶颈。

**关键问题**：
- 同步 XHR 阻塞主线程
- 并发池虚假
- `buildJsonPayload` 绕过批量优化
- `getFilterStatus` 日志过于详细

### 7.3 `sync/scraping.ts` (300 行) — 总评 ⭐⭐⭐

**关键问题**：使用 `fetch()` API（IE 兼容性风险）、`xhr.timeout` 未设置、429 重试无上限。

### 7.4 `sync/syncRecord.ts` (332 行) — 总评 ⭐⭐⭐

**关键问题**：`buildCache` 逐行 COM 读取、多工作簿缓存污染、空 SID 重复记录。

### 7.5 `ui/handlers.ts` (~1340 行) — 总评 ⭐⭐

**最大的 UI 模块**。承担了过多职责：事件分发、API 同步、按钮绑定、消息监听、状态更新。

**关键问题**：
- 语法错误 L21（`;5`）
- 三套通信机制并存导致状态更新冗余
- `_doAPISync` 函数过长（~130 行）

### 7.6 `tools/config.ts` (137 行) — 总评 ⭐⭐⭐⭐

**最干净的模块**。接口清晰，silent 参数设计良好。

### 7.7 `tools/events.ts` (157 行) — 总评 ⭐⭐⭐⭐

**EventBus 实现标准**。但存在两套事件常量 `BANGUMI_EVENTS` 和 `BGM_EVENTS`，功能重叠。

### 7.8 `tools/http.ts` (284 行) — 总评 ⭐⭐⭐⭐

**完善的 HTTP 封装**。支持重试、限流处理。但日志过于详细。

### 7.9 `core/constants.ts` (468 行) — 总评 ⭐⭐⭐⭐

**常量定义完善**。唯一问题是 WATCH_STATUS_MAP 映射颠倒（严重 Bug）。

### 7.10 `core/crypto.ts` (316 行) — 总评 ⭐⭐⭐

提供 XOR + AES-GCM 双加密方案。但 AES-GCM 函数实际未被使用。

### 7.11 `core/result.ts` (338 行) — 总评 ⭐⭐⭐⭐⭐

**设计最优秀的模块**。`Result<T>` 类型 + `BgmError` 类实现 Rust 风格错误处理。但实际使用率低。

### 7.12 `services/ribbonService.ts` (434 行) — 总评 ⭐⭐⭐

Ribbon 专用服务。`syncWithConfirmation` 流程设计合理。

---

## 8. 优化建议路线图

### 第一阶段：修复严重 Bug（1-2 天）

| 优先级 | 任务 | 文件 |
|--------|------|------|
| P0 | 移动 taskpane.html 按钮禁用脚本到 body 末尾 | taskpane.html |
| P0 | 修复 preview.ts 事件监听器内存泄漏 | preview.ts |
| P0 | 替换 scraping.ts 的 fetch() 为 XMLHttpRequest | scraping.ts |
| P0 | 修复 Dialog.show confirm 降级为 alert | util.ts |

### 第二阶段：解决性能与架构问题（3-5 天）

| 优先级 | 任务 | 文件 |
|--------|------|------|
| P1 | 将 `bgmRequestSync` 改为异步 XHR | exceltobangumi.ts |
| P1 | 设置 `xhr.timeout` | scraping.ts, exceltobangumi.ts |
| P1 | `buildJsonPayload` 使用 `getField` 替代 `readCell` | exceltobangumi.ts |
| P1 | 合并 `readCell`/`getCellValue` 重复代码 | util.ts |
| P1 | 统一通信机制（移除 postMessage，保留 PluginStorage+轮询） | handlers.ts, message.ts |
| P1 | `buildCache` 改用 `readRangeValues` 批量读取 | syncRecord.ts |
| P2 | `getFilterStatus` 减少日志量，使用 DEBUG 级别 | exceltobangumi.ts |
| P2 | 修复 `startSync` 的 `shouldStop` 重置 | util.ts |
| P2 | 修复 `lastSyncTime` 语义 | util.ts |

### 第三阶段：代码质量改进（3-5 天）

| 优先级 | 任务 |
|--------|------|
| P2 | 为 `sheetCache` 添加 LRU 淘汰 + TTL |
| P2 | 拆细 `util.ts` 中的 BGM 全局对象 |
| P2 | 合并 3 个 Native Code 检测函数 |
| P2 | 拆细 `getLastRow` 为策略函数 |
| P2 | 拆细 `_doAPISync` 为独立步骤 |
| P2 | 移除冗余的 `getFilterStatus` 调用 |
| P3 | 统一日志使用 `bgmLog` |
| P3 | 常量化所有硬编码魔法数字 |
| P3 | 修复 TypeScript `any` 滥用 |
| P3 | 添加 `<label for>` 属性 |
| P3 | 添加最大重试次数限制（429 处理） |
| P3 | `GetUrlPath` 重命名为 `getUrlPath` |

### 长期建议

1. **引入状态管理器**：替代分散在 BGM 全局对象中的可变状态，支持跨模块状态跟踪
2. **Result<T> 模式推广**：当前仅 `http.ts` 使用，应推广到所有异步操作
3. **单元测试**：为核心函数（`getLastRow`、`buildJsonPayload`、`addSyncRecord`等）添加测试
4. **类型安全升级**：完整定义 WPS COM 对象类型，减少 `any` 使用
5. **taskpane.html 模块化**：将内联脚本提取为独立 TypeScript 模块
6. **移除未使用代码**：AES-GCM 加密函数、`markUploadedItems` 的未完成实现等

---

> **总结**：项目整体架构合理，核心同步逻辑正确。主要问题集中在：
> 1. 同步 XHR 阻塞 UI（用户体验差）
> 2. 跨上下文通信混乱（三套机制并存）
> 3. 性能瓶颈（逐格 COM 读取）
>
> 建议按照三个阶段逐步推进修复和优化。