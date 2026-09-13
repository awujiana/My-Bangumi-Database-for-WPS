# 补测待办清单（按性价比排序）

> **首次生成**：2026-09-13（基线 46.82% lines / 2348 测试）
> **基线刷新**：2026-09-13 晚 —— 清单第 1 批已全部完成
> **测试**：2569 条 / 91 文件（2568 通过；唯一失败为 `ui-bridge` 的 5s 超时 flaky，隔离跑 9/9 稳过）
> **全项目覆盖率**：**50.34% stmts / 44.03% branch / 57.39% funcs / 50.67% lines**（较首次生成 **+3.85 个点**）
> **可执行行数**：13417，已覆盖 6799，**未覆盖 6618**
> **换算**：全项目**每提升 1 个百分点 ≈ 134 行**（= 13417 / 100）
>
> 注：本轮涨幅来自三处 —— `auto-fill-url.ts` →100%、`panel-events.ts` + `settings-bindings.ts` →100%、`tools/util/index.ts` 30.81→88.05%；可执行行总数从 13361 涨到 13417 是同期外部在途改动（`ts/sync/jsonl-response.ts` 等）带来的。

数据来源：`coverage/coverage-summary.json`（`npx vitest run --coverage --config vitest.cov.config.ts --coverage.reporter=json-summary`）。
复算脚本：`scripts/calc-coverage-backlog.mjs`（读 summary → 按未覆盖行数排序 → 输出本文档表格）。

```bash
npx vitest run --coverage --config vitest.cov.config.ts --coverage.reporter=json-summary
node scripts/calc-coverage-backlog.mjs
```

---

## 一、为什么不按「未覆盖行数」从上往下做

清单前列全是 **2000+ 行、覆盖率 < 6% 的大文件**（`enrich-page.ts` 658 行未覆盖、`panel-lifecycle.ts` 474 行）。
它们单看收益最高（+4.92% / +3.55%），但**直接补测的代价被严重低估**：

- 写一个能加载这类文件的测试，需要 mock 掉它所有的依赖；一个 mock 写错，整个文件加载失败、测试全红；
- 即使写通了，断言的是「mock 的行为」而非真实行为，产出的是**假覆盖**。

项目已有的结论（见 `.workbuddy/memory/REF-big-file-splitting.md`）：**先把自洽的纯逻辑切片抽成独立小模块，再为小模块写单测**，每步都能用 `tsc` / `eslint` 验证。

---

## 二、清单（按未覆盖行数排序）

| 未覆盖 | 全补完提升 | 当前行覆盖 | 难度 | 文件 |
| -----: | ---------: | ---------: | ---- | ---- |
| 658 | +4.92% | 0.6% | 中-DOM/UI | `ts/panel/enrich-page.ts` ⚠️ 2300+ 行，先拆后测 |
| 474 | +3.55% | 5.2% | 中-DOM/UI | `ts/panel/panel-lifecycle.ts` |
| 410 | +3.07% | 29.67% | 中-DOM/UI | `ts/ui/handlers/action-handlers.ts` |
| 406 | +3.04% | 0% | 中-DOM/UI | `ts/ui/handlers/sync.ts` |
| 394 | +2.95% | 1% | 中-DOM/UI | `ts/panel/enrich-preview-flow.ts` |
| 366 | +2.74% | 0.27% | 难-COM | `ts/services/ribbon-service.ts` |
| 365 | +2.73% | 0% | 中-DOM/UI | `ts/ui/handlers/token.ts` |
| 341 | +2.55% | 0% | 中-DOM/UI | `ts/panel/clean-page.ts` |
| 339 | +2.54% | 7.37% | 中-DOM/UI | `ts/ui/preview.ts` |
| **330** | **+2.47%** | 30.81% | **易-纯逻辑** | **`ts/tools/util/index.ts`** ⭐ 首选 |
| 315 | +2.36% | 44.54% | 难-COM | `ts/sync/enrich-engine.ts` |
| 279 | +2.09% | 48.33% | 难-COM | `ts/sync/exceltobangumi/index.ts` |
| 180 | +1.35% | 2.17% | 中-DOM/UI | `ts/ui/sync-result-dialog.ts` |
| 176 | +1.32% | 1.67% | 难-COM | `ts/sync/enrich-record.ts` |
| 165 | +1.23% | 0% | 难-COM | `ts/sync/sheet-cleaning.ts` |
| 154 | +1.15% | 44% | 中-DOM/UI | `ts/ui/dialog.ts` |
| 153 | +1.15% | 1.92% | 难-COM | `ts/sync/exceltobangumi/api.ts` |
| 139 | +1.04% | 0% | 中-DOM/UI | `ts/panel/shell-nav.ts` |
| 129 | +0.97% | 0% | 难-COM | `ts/sync/scraping.ts` |
| 114 | +0.85% | 0% | 中-DOM/UI | `ts/panel/user-info-polling.ts` |
| 104 | +0.78% | 5.45% | 中-DOM/UI | `ts/ui/handlers/incremental-bindings.ts` |
| 84 | +0.63% | 22.93% | 中-DOM/UI | `ts/ui/handlers/panel-events.ts` |
| 77 | +0.58% | 1.28% | 中-DOM/UI | `ts/panel/panel-page.ts` |
| 76 | +0.57% | 13.63% | 中-DOM/UI | `ts/ui/handlers/settings-bindings.ts` |
| 69 | +0.52% | 59.17% | 难-COM | `ts/sync/workbook-auto-detect.ts` |
| 58 | +0.43% | 26.58% | 易-纯逻辑 | `ts/tools/auto-fill-url.ts` ⭐ |
| 58 | +0.43% | 40.2% | 中-DOM/UI | `ts/ui/handlers/github-settings.ts` |
| 53 | +0.40% | 0% | 中-DOM/UI | `ts/panel/enrich-conflict-dialog.ts` |
| 53 | +0.40% | 0% | 中-DOM/UI | `ts/panel/enrich-record-view.ts` |
| 46 | +0.34% | 0% | 中-DOM/UI | `ts/panel/enrich-source-detail.ts` |

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

**第 2 批（先拆后测，单项收益最大）**

4. `ts/panel/enrich-page.ts`（+4.92%）—— **必须先拆**。按现有节奏一次抽 1~2 个自洽切片，每步 `tsc` + `eslint` 验证，抽出来的新模块直接配 100% 单测。
5. `ts/panel/panel-lifecycle.ts`（+3.55%）、`ts/ui/handlers/action-handlers.ts`（+3.07%）—— 同上，后者是分发表，抽出「入参解析」这类纯逻辑最好测。

**第 3 批（投入产出比最低，谨慎）**

6. `ts/sync/**` 的 COM 模块 —— 需要构造 Excel/WPS 对象模型，mock 出来的覆盖基本不反映真实行为。**建议改为用集成测试或人工验收覆盖，不要为了数字去 mock**。

---

## 四、门禁现状

`vitest.config.ts` 的全局阈值（2026-09-13 上调）：
`statements 40 / branches 35 / functions 45 / lines 40`（`perFile: false`）。

留 5~8 个点安全余量，只拦真实回归。

> ⚠️ **已知无效配置**：`perFile: false` 下 vitest 的「glob 单文件阈值」**不会被检查**（实测把某文件阈值改成 101 也不报错）。
> 想给单个文件（如 `module-state.ts`）锁 100%，只能靠测试本身维持，**不要写进 thresholds 假装它有保护**。
