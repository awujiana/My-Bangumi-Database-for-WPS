# BGM Excel 加载项 — 全面代码审查报告

> 审查日期：2026-05-06 | 审查范围：全项目 | 语言：TypeScript + JavaScript | 框架：WPS 加载项

---

## 目录

1. [项目结构概览](#1-项目结构概览)
2. [🔴 关键问题（Critical）](#2-关键问题critical)
3. [🟡 构建与配置问题](#3-构建与配置问题)
4. [🟡 类型系统问题](#4-类型系统问题)
5. [🟡 模块架构问题](#5-模块架构问题)
6. [🟠 运行时与安全问题](#6-运行时与安全问题)
7. [🔵 代码质量问题](#7-代码质量问题)
8. [优化建议](#8-优化建议)
9. [修复优先级排序](#9-修复优先级排序)

---

## 1. 项目结构概览

```
BGM/
├── index.html              # WPS 主入口（Ribbon 功能区加载）
├── main.js                 # 动态模块加载器（15个模块顺序加载）
├── ui/taskpane.html        # 任务面板独立入口
├── manifest.xml            # WPS 加载项清单
├── ribbon.xml              # Ribbon 功能区按钮定义
├── package.json            # wpsjs + vite + typescript^6
├── tsconfig.json           # 主 TS 配置（strict, ES2024, outDir=dist）
├── tsconfig.build.json     # 构建用 TS 配置（non-strict, ES2020, outDir=.）
├── vite.config.js          # Vite + wpsjs copyFile 插件
├── css/styles.css          # 全局样式（~400行）
├── images/                 # 10 个 SVG 按钮图标
├── docs/                   # 文档与审查报告
├── dist/                   # 构建输出
│   ├── index.html
│   ├── assets/             # Vite 打包产物
│   └── js/                 # 源文件副本（copyFile 插件）
├── js/
│   ├── util.ts             # ⚙️ 核心工具库（TS 编译 → util.js）
│   ├── util.d.ts           # 工具类型声明
│   ├── http.ts             # HTTP 请求模块（TS 编译 → http.js）
│   ├── http.d.ts           # HTTP 类型声明
│   ├── ribbon.js           # Ribbon 回调处理
│   ├── taskpane.js         # 任务面板主逻辑（~900行）
│   ├── functions.js        # WPS 自定义函数
│   ├── systemdemo.js       # 🗑️ 脚手架模板（建议删除）
│   ├── core/
│   │   ├── constants.js    # 常量定义
│   │   ├── constants.d.ts  # 常量类型声明
│   │   ├── crypto.js       # Token 加密/解密
│   │   ├── crypto.d.ts     # 加密类型声明
│   │   └── unified.js      # 统一对话框 + 消息通信
│   ├── sync/
│   │   ├── exceltobangumi.js  # Bangumi API 同步引擎（~900行）
│   │   ├── syncRecord.js      # 同步记录工作表管理
│   │   └── scraping.js        # 收藏列表批量抓取
│   ├── ui/
│   │   ├── dialog.js       # 自定义对话框系统
│   │   ├── handlers.js     # UI 事件处理 + onAction 分发
│   │   ├── message.js      # postMessage 通信监听
│   │   └── preview.js      # 数据预览与同步内容展示
│   ├── types/
│   │   ├── result.ts       # Result<T> / BgmResultError
│   │   └── index.ts        # 全局类型声明
│   └── @types/             # API 类型声明（4个 .d.ts）
└── 文档/                    # 历史文档和开发参考
```

**源文件统计**：
| 语言 | 文件数 | 行数（约） |
|------|--------|-----------|
| TypeScript (.ts) | 5 | ~900 |
| JavaScript (.js) | 12 | ~5,700 |
| 类型声明 (.d.ts) | 8 | ~500 |
| HTML | 2 | ~600 |
| 配置 (json/xml) | 6 | ~200 |

---

## 2. 🔴 关键问题（Critical）

### 2.1 ⛔ `tsconfig.json` 使用无效编译目标 `"ES2024"`

**文件**: `tsconfig.json:4`

```json
"target": "ES2024"
```

TypeScript 5.x/6.x 不支持 `ES2024` 作为 `target` 值。每次编译均有 warning：
```
▲ [WARNING] Unrecognized target environment "ES2024"
```

**修复**: 改为 `"ES2022"` 或 `"ESNext"`。

---

### 2.2 ⛔ 两套 tsconfig 配置严重冲突

| 配置项 | `tsconfig.json` | `tsconfig.build.json` |
|--------|----------------|----------------------|
| `target` | ~~ES2024~~ | ES2020 |
| `strict` | **true** | **false** |
| `noImplicitAny` | true | false |
| `strictNullChecks` | true | false |
| `outDir` | `./dist` | `.` (当前目录!) |
| `rootDir` | — | `.` |
| `declaration` | true | 未设置 |
| `include` | `js/**/*` | 仅 3 个 .ts 文件 |

**严重性**: ⛔ **极高**

`tsconfig.build.json` 设置 `outDir: "."` + `rootDir: "."`，TypeScript 编译器将编译后的 `.js` **直接覆盖写入源目录**。

这意味着：
1. 对 `js/util.js` 的任何手动修改都会被 `tsc` 覆盖
2. 构建使用 **non-strict** 模式，类型错误被静默忽略
3. 两个配置的 `include` 范围不一致，类型检查覆盖不全

**这是之前多次手动修复 `js/util.js` 后又被还原的根本原因。**

**修复**:
```json
// tsconfig.build.json 应修改为：
{
  "outDir": "./dist",
  "rootDir": "./js"
  // 或删除此文件，统一使用 tsconfig.json
}
```

---

### 2.3 ⛔ 模块加载器静默吞下所有错误

**文件**: `main.js:85-98`

```javascript
for (const mod of MODULES) {
    try {
        await loadModule(mod.src);
    } catch (e) {
        console.error('[BGM] Module loading failed:', e);
        // ⚠️ 继续加载下一个模块！
    }
}
```

`handlers.js` 因 `fetchBgmUserInfo` 导出缺失而加载失败 → 加载器**继续加载后续模块** → `taskpane.js` 加载成功但 `window.onAction` 永远未设置 → 用户看到的只有 "模块加载超时"。

**修复**: 关键模块加载失败后停止，显示降级 UI：
```javascript
const CRITICAL_MODULES = ['js/util.js', 'js/ribbon.js', 'js/taskpane.js'];
for (const mod of MODULES) {
    try {
        await loadModule(mod.src);
    } catch (e) {
        if (CRITICAL_MODULES.includes(mod.src)) {
            document.body.innerHTML = `<div class="error">核心模块加载失败: ${mod.src}</div>`;
            return;  // 停止加载
        }
    }
}
```

---

### 2.4 ⛔ `BgmError` 与 `BgmResultError` 命名冲突

| 类 | 文件 | 用途 | 字段 |
|----|------|------|------|
| `BgmError` | `js/util.ts` | 通用业务错误 | `code`, `details`, `timestamp` |
| `BgmResultError` | `js/types/result.ts` | API 结果错误 | `code`, `message`, `details?` |

两者功能高度重叠，命名极易混淆。`http.ts` 使用 `BgmResultError`，而 `unified.js` 和 `handlers.js` 使用 `BgmError`。

**修复**: 统一为一个 `BgmError` 类，放在 `types/` 中。

---

## 3. 🟡 构建与配置问题

### 3.1 Vite `copyFile` 在 build 模式不可靠

`vite.config.js` 使用 `wpsjs/vite_plugins` 的 `copyFile` 复制文件到 dist，但 `vite build` 输出显示仅 "4 modules transformed"（只打包了入口），未实际复制 `js/`、`ui/` 等目录。

**现象**: 每次 `npm run build` 后需手动执行批量 `Copy-Item` 命令同步 dist。

**修复**: 使用 Vite 原生的 `publicDir` 或 `vite-plugin-static-copy`。

### 3.2 WPS SDK 路径硬编码

```html
<!-- ui/taskpane.html:82 -->
<script src="../.debugTemp/wpsjsrpcsdk.js"></script>
```

`.debugTemp` 仅在 wpsjs dev server 运行时存在，生产部署时需改为 `../wpsjsrpcsdk.js`。

**修复**: 使用环境变量或 HTML 注释标记，构建时替换。

### 3.3 依赖版本使用 `latest`

```json
"et-jsapi-declare": "latest",  // 不稳定
"wpsjs": "latest"              // 不稳定
"typescript": "^6.0.3"         // 可能不兼容 WPS API 声明
```

**修复**: 锁定具体版本号。

### 3.4 Vite 端口配置不一致

| 位置 | 端口 |
|------|------|
| `package.json` dev 脚本 | `--port 3889` |
| `vite.config.js` | `3891` |

命令行参数会覆盖配置文件，但容易造成混淆。

---

## 4. 🟡 类型系统问题

### 4.1 类型声明分散重复

`BGMUserInfo` 在 **3 个文件** 中独立定义：
- `js/util.ts:35`
- `js/types/index.ts:118`
- `js/@types/bangumi.d.ts`（间接）

`BGMCache`、`BGMSheet`、`BGMSync` 在 `util.ts` 和 `types/index.ts` 各定义一次。

**修复**: 统一在 `types/` 中定义，其他文件 `import type` 引用。

### 4.2 构建不生成 `.d.ts`

`tsconfig.build.json` 未设置 `declaration: true`，构建产物缺少类型声明文件。实际使用的 `dist/js/util.d.ts` 等是手动维护的，可能与源码不一致。

### 4.3 `window` 全局类型不完整

`js/types/index.ts` 的 `BgmWindow` 接口缺少约 **20 个** 运行时挂载的函数声明：
- `readCell`, `_bgmRibbonReady`, `OnAddinLoad`, `OnAction`
- `GetBangumiImage`, `safeCall`, `_modulesReady`
- `refreshData`, `onAction`, `toggleSheetLock`

### 4.4 `unknown` 类型过度使用与不安全转换

```typescript
// util.ts:362
export function getCell(ws: unknown, row: number, col: number): unknown {
    const wsObj = ws as { Range?: (addr: string) => unknown; Cells?: unknown };
    // 多次 as 强制转换，无运行时类型守卫
}
```

**修复**: 定义最小化 WPS 接口，使用类型守卫替代强制转换。

---

## 5. 🟡 模块架构问题

### 5.1 双重模块加载路径（严重）

项目同时存在两套互不知晓的模块加载系统：

**路径 A — `index.html` → `main.js`**（动态创建 `<script>` 加载 15 个模块）
**路径 B — `taskpane.html`**（内联 `<script type="module">` 直接 import 11 个模块）

两套路径各自独立运行，模块可能被重复加载，且**依赖顺序不同**。

**修复**: 统一入口，任务面板也通过 `main.js` 初始化。

### 5.2 全局 `window` 命名空间严重污染

| 文件 | 挂载到 window 的函数/变量数 |
|------|--------------------------|
| `util.js` | 23+ |
| `taskpane.js` | 20+ |
| `exceltobangumi.js` | 18 |
| `handlers.js` | 18 |
| `unified.js` | 8 |
| `ribbon.js` | 4 |
| **总计** | **~91** |

**后果**: 
- 函数来源难以追踪
- `onclick="safeCall('xxx')"` 中的目标函数必须是全局的
- 无法使用 Tree Shaking
- 命名冲突风险高

**修复**: 迁移到 `BGM.actions.xxx` 命名空间，HTML 中改为 `data-action` 属性 + 事件委托。

### 5.3 隐式循环依赖

```
exceltobangumi.js → handlers.js (import showTokenDialog)
handlers.js → [window].SyncToBangumi (运行时动态引用)
```

通过 `window` 全局对象形成的依赖循环无法被静态分析工具检测。

### 5.4 Ribbon 占位机制缺少超时降级

`index.html` 定义了 `OnAction` stub → WPS 调用 stub → 暂存到队列 → `ribbon.js` 加载后重放。

但如果 `ribbon.js` 永远不加载（网络故障），队列永远不会被重放，且无超时告警。

**修复**: 添加 15 秒超时，超时后显示错误提示。

### 5.5 `systemdemo.js` 应删除

wpsjs 脚手架生成的模板代码，含硬编码演示逻辑，与业务完全无关。但仍被 `main.js` 加载。

---

## 6. 🟠 运行时与安全问题

### 6.1 Token "加密" 仅为 XOR 混淆

**文件**: `js/core/crypto.js`

```javascript
// 注释承认"仅用于防止明文存储"
function xorEncrypt(dataBytes) {
    const keys = TOKEN_CONFIG.FALLBACK_KEYS;  // 硬编码密钥
    // key[i % 8] ^ iv[i % 8] — 安全性极低
}
```

- 密钥硬编码在 `TOKEN_CONFIG.KEY_BYTES`（`BGM_TOKEN_SECURE_KEY_2024_AES_25` 的 ASCII 码）
- XOR + 8 字节随机 IV，已知明文攻击下可完全破解
- 代码中预留了 AES-GCM 密钥但未实现

**风险**: 任何能读取 Excel 文件的人可提取并解密 Token。

**修复**: 实现 Web Crypto API AES-GCM，或由用户每次输入 Token（不持久化）。

### 6.2 同步 XMLHttpRequest 阻塞 UI 线程

```javascript
// exceltobangumi.js
xhr.open(method, endpoint, false);  // false = 同步模式！
```

大批量同步（500+ 条目）时，WPS 完全冻结，显示"无响应"。

**修复**: 全部迁移到异步请求（`http.ts` 中已有 `httpRequest` 异步实现），配合 UI 进度条。

### 6.3 无客户端主动限速

`BGM_CONFIG.REQUEST_DELAY = 800` 通过同步 `sleep()` 延迟，但异步爬取 (`scraping.js`) 使用 `delay()` 仅在收到 429 后退避，不主动限速。连续请求可能触发 Bangumi API 临时封禁。

### 6.4 Token 验证使用 fetch（不受 WPS WebView 限制？）

`scraping.js` 使用标准 `fetch()` API 发送请求，但 WPS 旧版 WebView（IE 内核）不支持 `fetch`。

---

## 7. 🔵 代码质量问题

### 7.1 Unicode 转义严重影响可读性

```javascript
// handlers.js — 30+ 个常量全部 Unicode 转义
const _T = {
    setBgmToken: '\u8BBE\u7F6E Bangumi Access Token',
    tokenSaved: 'Token \u5DF2\u4FDD\u5B58',
};
```

注释说是"避免 WPS WebView 编码问题"，但现代 WPS（2019+）的 Chromium WebView 完全支持 UTF-8。

### 7.2 冗余的包装函数

```javascript
// syncRecord.js
export function sendToTaskpaneSR(data) { return BGM.postMessage(data); }
export function showDialogSR(title, message) { BGM.showDialog(title, message); }
```

一层转发无实际逻辑，且 `SR` 后缀含义不明。

### 7.3 Magic Number 缺少命名常量

```javascript
// exceltobangumi.js
const COLUMNS = { SEQUENCE: 4 };  // 为什么是第 4 列？

// taskpane.js
if (_checkCount > 200) {}  // 200 = 10秒 / 50ms
```

### 7.4 混合使用 `let`/`const`/`var`

同一文件内交替使用 `var`（`main.js` 中大量）和 `let`/`const`（`exceltobangumi.js`），风格不一致。

### 7.5 重复代码

`detectHeaderAndColumns`（`taskpane.js`）和 `findHeaderRow`/`getColumnMap`（`exceltobangumi.js`）功能高度重叠——两者都在做表头识别和列映射。

---

## 8. 优化建议

### 8.1 架构：推荐目录结构

```
src/
├── core/
│   ├── constants.ts          # 所有常量（带类型）
│   ├── crypto.ts             # AES-GCM 加密
│   ├── errors.ts             # BgmError 统一类
│   └── dialog-core.ts        # 对话框核心逻辑
├── sync/
│   ├── bangumi-client.ts     # 异步 API 客户端
│   ├── sync-engine.ts        # 同步引擎
│   └── sync-record.ts
├── ui/
│   ├── panel.ts              # 任务面板
│   ├── handlers.ts           # 事件处理
│   ├── dialog-ui.ts          # 对话框 UI
│   └── preview.ts
├── ribbon.ts                 # Ribbon 回调
├── entry.ts                  # 统一入口
└── types/
    └── index.ts              # 所有类型声明
```

### 8.2 统一模块加载

1. 删除 `main.js` 动态加载方案
2. 使用 `index.html` 中单个 `<script type="module" src="./entry.js">` 
3. `taskpane.html` 也通过统一入口加载
4. Ribbon 回调使用 WPS 标准全局函数模式

### 8.3 将所有 `.js` 迁移到 `.ts`

当前仅 3 个文件用 TypeScript，其余 12 个模块仍是 JavaScript。全部迁移后将获得：
- 编译时错误检查
- 自动 `.d.ts` 生成
- IDE 智能提示和重构支持

### 8.4 性能优化

- `detectHeaderAndColumns` 限制扫描列为 30（Bangumi 字段有限）
- `detectFilterState` 预检查 `SpecialCells` 可用性
- CSS 按需拆分（dialog 样式可独立）

### 8.5 测试策略

- 对 `extractSubjectId`、`mapWatchStatus`、`buildJsonPayload` 等纯函数编写单元测试
- 对 `Result<T>` 类型编写类型测试
- 添加模块加载的集成测试

---

## 9. 修复优先级排序

### 🔴 P0 — 立即修复

| # | 问题 | 影响 |
|---|------|------|
| 1 | `tsconfig.json` target ES2024 无效 | 构建 warning，可能编译结果异常 |
| 2 | `tsconfig.build.json` outDir="." 覆盖源码 | 手动修改被反复覆盖 |
| 3 | `main.js` 模块加载静默吞错 | 功能不可用但无明确错误提示 |
| 4 | `copyFile` 在 build 中不可靠 | dist 每次需手动同步 |

### 🟡 P1 — 尽快修复

| # | 问题 |
|---|------|
| 5 | Ribbon stub 缺少超时降级 |
| 6 | 同步 XHR 阻塞 UI（用户体验） |
| 7 | Token XOR 加密不安全 |
| 8 | 双重模块加载路径冲突 |

### 🔵 P2 — 计划修复

| # | 问题 |
|---|------|
| 9 | 类型声明分散重复 |
| 10 | Unicode 转义可读性 |
| 11 | 全局变量污染（91 个 window 属性） |
| 12 | 删除 `systemdemo.js` |
| 13 | 统一 `BgmError` / `BgmResultError` |

### ⚪ P3 — 长期优化

| # | 建议 |
|---|------|
| 14 | 迁移到 `src/` 目录结构 |
| 15 | 全部 `.js` → `.ts` |
| 16 | 添加单元测试 |
| 17 | AES-GCM 加密替代 XOR |
| 18 | CSP + 构建完整性校验 |

---

## 附录 A：模块依赖关系图

```
constants.js ←── crypto.js ←── util.ts ──────────────────────┐
     │              │              │                            │
     └──────→ unified.js ←────────┘                            │
                  │                                            │
          ┌───────┼────────┬──────────┐                        │
          ▼       ▼        ▼          ▼                        │
      dialog  message  preview   handlers.js ──────────────────┤
        │                            │                         │
        └────────────┬───────────────┘                         │
                     ▼                                         │
              exceltobangumi.js ←── http.ts ←── result.ts       │
                     │              │                           │
              syncRecord.js        │                           │
                     │              │                           │
              scraping.js ←────────┘                           │
                     │                                          │
              ribbon.js ←──→ window (OnAction/GetBangumiImage)  │
                     │                                          │
              taskpane.js ←────────────────────────────────────┘

实线 = ES import    虚线 = window 全局隐式依赖
```

## 附录 B：关键文件行数统计

| 文件 | 行数 | 复杂度评估 |
|------|------|-----------|
| `js/taskpane.js` | ~910 | ⬆️ 高（UI + 业务 + 初始化混合） |
| `js/sync/exceltobangumi.js` | ~910 | ⬆️ 高（同步引擎 + 表头识别 + API 请求） |
| `js/util.ts` | ~800 | ⬆️ 中高（工具函数 + BGM 命名空间） |
| `js/ui/dialog.js` | ~380 | 中（纯 UI 逻辑） |
| `js/ui/preview.js` | ~350 | 中（预览渲染 + 功能检测） |
| `js/core/unified.js` | ~220 | 中 |
| `css/styles.css` | ~400 | 中 |
