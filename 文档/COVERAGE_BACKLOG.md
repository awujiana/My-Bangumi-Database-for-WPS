# 补测待办清单（按性价比排序）

> **首次生成**：2026-09-13（基线 46.82% lines / 2348 测试）
> **基线刷新**：2026-09-14（第二轮）—— 清单第 1~4 批全部完成；`ui-bridge` flaky 已消除；`npm run gate` 七关全绿
> **测试**：**3190 条 / 101 文件，全绿**
> **全项目覆盖率**：**75.07% stmts / 64.74% branch / 78.49% funcs / 76.03% lines**（较首次生成 **+29.21 个点**）
> **可执行行数**：13402，已覆盖 10190，**未覆盖 3212**
> **换算**：全项目**每提升 1 个百分点 ≈ 134 行**（= 13402 / 100）
>
> 注：第二轮涨幅主体是 §三 第 3、4 批 —— `ribbon-service`、`ui/handlers/sync`、`clean-page`、`scraping`、`sheet-cleaning`、`shell-nav` 等
> 由 0~30% 补到 88~100%，未覆盖行 **5118 → 3212（−1906 行）**。
> **关键结论（累积）**：清单前列的「大文件 / COM 模块」**都没有走「先拆后测」**——依赖收敛到单一 barrel、依赖宿主对象、或依赖 ≤3 个薄封装的，就地测即可，
> 断言打到真实 state 变迁 / 真实写盘调用 / 真实 DOM 写入，**不存在假覆盖**（判据见 `.workbuddy/memory/REF-testing.md`）。

数据来源：`coverage/coverage-summary.json`（`npx vitest run --coverage --config vitest.cov.config.ts --coverage.reporter=json-summary`）。
复算脚本：`scripts/calc-coverage-backlog.mjs`（读 summary → 按未覆盖行数排序 → 输出本文档表格）。

```bash
npx vitest run --coverage --config vitest.cov.config.ts --coverage.reporter=json-summary
node scripts/calc-coverage-backlog.mjs
```

---

## 一、为什么不按「未覆盖行数」从上往下做

清单前列全是 **2000+ 行、覆盖率 < 6% 的大文件**（首轮快照：`enrich-page.ts` 658 行未覆盖、`panel-lifecycle.ts` 474 行）。
它们单看收益最高（+4.92% / +3.55%），但**直接补测的代价被严重低估**：

> 📌 2026-09-14 复盘：上面两个文件**已就地补完**（88.21% / 97.4% lines），且**都没拆文件**；
> 本节原来的「必须先用 `REF-big-file-splitting.md` 拆模块」结论已被 §三 第 2 批改写为**按依赖形状分三条路**。本节保留作为当时的推理留档。

- 写一个能加载这类文件的测试，需要 mock 掉它所有的依赖；一个 mock 写错，整个文件加载失败、测试全红；
- 即使写通了，断言的是「mock 的行为」而非真实行为，产出的是**假覆盖**。

项目已有的结论（见 `.workbuddy/memory/REF-big-file-splitting.md`）：**先把自洽的纯逻辑切片抽成独立小模块，再为小模块写单测**，每步都能用 `tsc` / `eslint` 验证。

---

## 二、清单（按未覆盖行数排序）

| 未覆盖 | 全补完提升 | 当前行覆盖 | 难度 | 文件 |
| -----: | ---------: | ---------: | ---- | ---- |
| 394 | +2.94% | 1% | 中-DOM/UI | `ts/panel/enrich-preview-flow.ts` |
| 339 | +2.53% | 7.37% | 中-DOM/UI | `ts/ui/preview.ts` |
| 315 | +2.35% | 44.54% | 难-COM/网络 | `ts/sync/enrich-engine.ts` |
| 279 | +2.08% | 48.33% | 难-COM/网络 | `ts/sync/exceltobangumi/index.ts` |
| 180 | +1.34% | 2.17% | 中-DOM/UI | `ts/ui/sync-result-dialog.ts` |
| 176 | +1.31% | 1.67% | 难-COM/网络 | `ts/sync/enrich-record.ts` |
| 154 | +1.15% | 44% | 中-DOM/UI | `ts/ui/dialog.ts` |
| 153 | +1.14% | 1.92% | 难-COM/网络 | `ts/sync/exceltobangumi/api.ts` |
| 114 | +0.85% | 0% | 中-DOM/UI | `ts/panel/user-info-polling.ts` |
| 104 | +0.78% | 5.45% | 中-DOM/UI | `ts/ui/handlers/incremental-bindings.ts` |
| 78 | +0.58% | 88.21% | 中-DOM/UI | `ts/panel/enrich-page.ts` |
| 77 | +0.57% | 1.28% | 中-DOM/UI | `ts/panel/panel-page.ts` |
| 69 | +0.51% | 59.17% | 难-COM/网络 | `ts/sync/workbook-auto-detect.ts` |
| 58 | +0.43% | 40.2% | 中-DOM/UI | `ts/ui/handlers/github-settings.ts` |
| 53 | +0.40% | 0% | 中-DOM/UI | `ts/panel/enrich-conflict-dialog.ts` |
| 53 | +0.40% | 0% | 中-DOM/UI | `ts/panel/enrich-record-view.ts` |
| 46 | +0.34% | 0% | 中-DOM/UI | `ts/panel/enrich-source-detail.ts` |
| 40 | +0.30% | 0% | 难-COM/网络 | `ts/sync/exceltobangumi/chapter-marker.ts` |
| 32 | +0.24% | 81.39% | 易-纯逻辑 | `ts/tools/zod-compat.ts` |
| 31 | +0.23% | 3.12% | 中-DOM/UI | `ts/ui/message.ts` |
| 29 | +0.22% | 0% | 中-DOM/UI | `ts/panel/settings-bootstrap.ts` |
| 28 | +0.21% | 88.97% | 易-纯逻辑 | `ts/tools/util/sheet.ts` |
| 26 | +0.19% | 96% | 难-COM/网络 | `ts/sync/github-sync.ts` |
| 24 | +0.18% | 92.4% | 中-DOM/UI | `ts/panel/clean-engine.ts` |
| 24 | +0.18% | 0% | 中-DOM/UI | `ts/ui/handlers/sheet.ts` |
| 22 | +0.16% | 0% | 中-DOM/UI | `ts/panel/panel-bootstrap.ts` |
| 22 | +0.16% | 76.34% | 中-DOM/UI | `ts/ui/handlers/index.ts` |
| 22 | +0.16% | 18.51% | 中-DOM/UI | `ts/ui/handlers/path-controls.ts` |
| 20 | +0.15% | 0% | 中-DOM/UI | `ts/panel/enrich-bootstrap.ts` |
| 20 | +0.15% | 0% | 中-DOM/UI | `ts/panel/enrich-result-view.ts` |

> **难度列是按目录粗判的**：`ts/tools`、`ts/core` 多为纯逻辑 → 易；`ts/panel`、`ts/ui` 依赖 DOM → 中；`ts/sync`、`ts/services` 依赖 COM / 网络 → 难。
> 实际动手前仍需扫一眼文件内的依赖（例如 `tools/util/index.ts` 是聚合桶，可能混入依赖 WPS 全局对象的函数）。

---

## 三、建议推进顺序

**第 1 批（低风险、立刻能做，合计约 +3%）**

1. ~~`ts/tools/util/index.ts`（+2.47%，纯逻辑）~~ ✅ **基本完成**（2026-09-13，实测约 **+2.06%**）：行覆盖 **30.81% → 88.05%**（未覆盖 332 → 57 行），新增 `tests/utility-index.test.ts`（62 条）+ `tests/utility-bgm-api.test.ts`（60 条）。
   **没有拆文件** —— 这是对「先拆后测」的一次修正。该文件未覆盖的部分主要是**薄封装**（Token / 用户信息读写、四个任务面板的创建与自愈、URL 构造、`BGM.Dialog` 降级链、同步状态机），它们的依赖是**宿主对象**（`window.Application` / `window.BGMDialog`）而非一堆兄弟模块。造一个假宿主就能驱动真实实现，断言的是真实写盘 / 真实可见性切换 / 真实 URL，**不存在假覆盖**。
   **分界线**：依赖宿主对象 → 造假宿主就地测；依赖一堆兄弟模块（如 `enrich-page.ts`）→ 才需要先拆。
   剩余 57 行：`_fetchBgmUserInfo` / `fetchBgmUserInfo`（XHR 状态机，需假 `XMLHttpRequest`）与 `getCallerFunctionName` 尾部。
2. ~~`ts/tools/auto-fill-url.ts`（+0.43%）~~ ✅ **已完成**（2026-09-13，提交 `ed66b8fd`）：新增 18 条测试，statements / functions / lines 100%、branches 96.66%（余 1 条为不可达防御分支，见 REF-gates-scripts.md）；单文件自查命令见该文件；
3. ~~`ts/ui/handlers/panel-events.ts`（+0.63%）、`settings-bindings.ts`（+0.57%）~~ ✅ **已完成**（2026-09-13）：两个文件均达 statements / branches / functions / lines **100%**（29 + 34 = 63 条测试）。做法是「每个 handler 都覆盖『控件/依赖缺失 → 早退』与『控件存在 → 落盘 + toast 文案』两侧」，因为这两个文件的共同风险正是**取不到元素就静默 return**（id 拼错、DOM 重构后忘同步，表现都是「改了设置但不生效」且不报错）。

**第 2 批（先拆后测，单项收益最大）** —— ✅ **2026-09-14 全部完成，但结论改写了：三个文件都没拆**

4. ~~`ts/panel/enrich-page.ts`（+4.92%）~~ ✅ **已完成**：行覆盖 **0.6% → 88.21%**（新增 `tests/enrich-page.test.ts` 49 条）。
   **没有拆** —— 它虽是 1603 行编排控制器、import 15+ 兄弟模块，但**全部依赖都收敛进同一个 `ts/index.js` barrel**，`vi.mock` 单点即可接管；`enrich-page-context`（state 单例 + `safeGet*` 取元素）与 `enrich-file-name`（纯函数）用**真实现**。测试用真 DOM 驱动绑定路由、断言真实 state 变迁与真实点击分发的副作用。
   **修正判据**：「依赖一堆兄弟模块 → 先拆」的前提是**无法用一个 mock 点接管全部依赖**。若依赖已收敛到单一 barrel，就地测同样不是假覆盖。
5. ~~`ts/panel/panel-lifecycle.ts`（+3.55%）、`ts/ui/handlers/action-handlers.ts`（+3.07%）~~ ✅ **已完成**：
   - `panel-lifecycle.ts` 5.2% → **97.4% lines / 100% funcs**（74 条）；`action-handlers.ts` 29.67% → **97.59% lines**（100 条）。
   - **顺带抓到一处真生产 bug**：无表头回退分支 push 的是 `{text, important}` 对象，却标记为 `aligned: true`，而表格渲染对 aligned 行按 `string[]` 输出 → 用户在数据预览里看到一串 `[object Object]`。已修（回退分支直接 push 字符串）。
   - **又一处死分支（未改，待拍板）**：397-404 行「多行表头补齐」中 `headerNames` 恒被填满 `MAX_SCAN_COLUMNS` 个元素 → `Object.hasOwn` 恒真 → `filled >= 3` **永不成立**，多行表头检测功能实际失效。涉及业务语义，不擅删。

**第 3 批（`ts/sync/**`）—— 原判断「不要为了数字去 mock」已被证伪**

6. ~~`ts/sync/**` 的 COM 模块 —— 建议改为用集成测试或人工验收覆盖，不要为了数字去 mock。~~ ✅ **结论已修正（2026-09-14）**：
   `ts/sync/**` 里**薄依赖的模块反而最好补**：`scraping.ts`（只依赖 `core/constants` + `bgmLog`）用**假 XHR**、`sheet-cleaning.ts`（只依赖 `core/constants` + 6 个 COM 薄封装）用**假工作表模型**驱动真实实现，
   断言真实的分页计划 / 真实 `Range.Delete` 区间 / 真实 `setCellValue` 调用，**没有一个断言打在 mock 上**，分别达 100% 全指标与 100% lines。
   真正不建议硬补的只剩 `entry/**`、`panel/*-bootstrap.ts` 这类**宿主装配脚本**（只做事实转发，覆盖无信息量）。

**第 4 批（2026-09-14 第二轮，已完成）**

7. ~~`ts/services/ribbon-service.ts`（+2.74%）、`ts/ui/handlers/sync.ts`（+3.04%）~~ ✅ **已完成**：`ribbon-service` 0% → **99.45% lines / 100% funcs**（83 条）；`handlers/sync.ts` 0% → **100% stmts/lines/funcs**（62 条）。
   两者与 `ts/index.js` 互相 re-export，**对 barrel 用 `vi.mock(async (importOriginal) => …)` 会死锁**、vitest 静默回退真实现（mock 调用恒 0、走真网络）→ 改**逐层 mock 叶子模块**（见 `REF-testing.md`）。
8. ~~`ts/panel/clean-page.ts`（+2.55%）、`ts/sync/scraping.ts`、`ts/sync/sheet-cleaning.ts`、`ts/panel/shell-nav.ts`~~ ✅ **已完成**：
   `clean-page.ts` 0% → **99.41% lines**（54 条）；`scraping.ts` 0% → **100% 全指标**（33 条）；`sheet-cleaning.ts` 0% → **100% lines**（49 条）；`shell-nav.ts` 0% → **100% lines**（30 条）。
9. 🔎 **死分支（未改生产代码，待拍板）**：`clean-page.ts` 的 `handleScan` 里 `if (!getApp())` **不可达** —— `getSelectedSheetKeys()` 自身要经 `getApp()?.PluginStorage` 读存储，未连接宿主时集合必为空、前面的检查先 return，
   即「未连接到 Excel / WPS」提示**永远不会显示**；建议把 `getApp()` 检查提到最前。
10. 🧹 **顺带修掉的历史门禁红灯**：`tests/shell-nav.test.ts` 带着 6 处 lint 错误入过库（3 处 `no-manually-wrapped-comments` + 3 处 `prefer-object-define-properties`），已用带断言的 node 脚本修复，gate 恢复 0。

---

## 四、门禁现状

`vitest.config.ts` 的全局阈值（2026-09-13 上调）：
`statements 40 / branches 35 / functions 45 / lines 40`（`perFile: false`）。

留 5~8 个点安全余量，只拦真实回归。

> ⚠️ **已知无效配置**：`perFile: false` 下 vitest 的「glob 单文件阈值」**不会被检查**（实测把某文件阈值改成 101 也不报错）。
> 想给单个文件（如 `module-state.ts`）锁 100%，只能靠测试本身维持，**不要写进 thresholds 假装它有保护**。

