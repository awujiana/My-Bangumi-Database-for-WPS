# 补测待办清单（按性价比排序）

> **首次生成**：2026-09-13（基线 46.82% lines / 2348 测试）
> **基线刷新**：2026-09-14（第二轮）—— 清单第 1~4 批全部完成；`ui-bridge` flaky 已消除；`npm run gate` 七关全绿
> **基线刷新**：2026-09-14（第三轮）—— 清单第 5 批（`enrich-preview-flow` 补测 + `panel-lifecycle` 表头检测修复）；`npm run gate` 七关全绿
> **基线刷新**：2026-09-14（第四轮）—— 清单第 6 批（清掉第 9 / 11 条待办隐患：`clean-page` 死分支前移 + `enrich-preview-flow` 读名收口）；`npm run gate` 七关全绿
> **基线刷新**：2026-09-14（第五轮）—— 清单第 7 批（`panel-lifecycle` 收尾到 100% lines + `ui/preview.ts` 补测）；`npm run gate` 七关全绿
> **基线刷新**：2026-09-14（第六轮）—— 清单第 8 批（`sync/enrich-engine.ts` 假绿测试改写 + 切片补测、`ui/sync-result-dialog.ts` 零测试起步补测、清掉第 14 条的 preview.ts 两个隐患）；`npm run gate` 七关全绿
> **基线刷新**：2026-09-14（第七轮）—— 清单第 9 批：`sync/enrich-record.ts` 1.67% → **100%**（未覆盖 176 → 0）、`ui/dialog.ts` 44% → **99.63%**（154 → 1，新增 `tests/dialog.ui.test.ts` 覆盖全部 UI 层）、`sync/exceltobangumi/index.ts` 48.33% → **74.62%**（279 → 137，只吃选区收集 / 行校验 / 筛选检测等纯逻辑切片，网络请求与重 COM 编排未硬造）；`npm run gate` 七关全绿
> **基线刷新**：2026-09-15（第八轮）—— 清单第 10 批：`sync/exceltobangumi/api.ts` 1.92% → **100% lines/funcs/stmts**（153 → 0）、`ui/handlers/incremental-bindings.ts` 5.45% → **100% 四项全满**（104 → 0）、`panel/user-info-polling.ts` 0% → **100% 四项全满**（114 → 0），新增 3 个测试文件 / 133 条；`npm run gate` 七关全绿
> **基线刷新**：2026-09-15（第九轮）—— 清单第 11 批：`panel/enrich-conflict-dialog.ts` 0% → **100% 四项全满**（53 → 0）、`panel/enrich-record-view.ts` 0% → **100% 四项全满**（53 → 0）、`panel/enrich-source-detail.ts` 0% → **100% lines/funcs/stmts**（46 → 0，branch 96.66% 余 1 条不可达兜底）、`panel/{panel,settings,enrich}-bootstrap.ts` 0% → **100% lines/funcs/stmts**（71 → 0）；新增 4 个测试文件 / 80 条；首次抽出 `tests/helpers/` 共享桩并修掉 `coverage.exclude` 漏排 `tests/**` 的统计缺陷；`npm run gate` 七关全绿
> **基线刷新**：2026-09-15（第十轮）—— 清单第 12 批（纯逻辑小块批量）：`ts/tools/zod-compat.ts` 81.39% → **100% lines**（32 → 0）、`ts/tools/util/sheet.ts` 88.97% → **100% lines**（28 → 0，顺带修一处 getLastRow「来自缓存」文案永远误报的生产 bug）、`ts/tools/wps.ts` 64.91% → **100% lines**（20 → 0）、`ts/tools/locked-sheet.ts` 90.55% → **100% lines**（17 → 0）、`ts/tools/http.ts` 89.55% → **99.25% lines**（14 → 1，余 1 行为 MAX_RETRIES_EXCEEDED 不可达出口）；追加到既有测试文件 + 新建 `tests/wps-dialog-fallback.test.ts`（jsdom 侧降级链），合计 **+63 条**；`npm run gate` 七关全绿
> **基线刷新**：2026-09-15（第十一轮）—— 清单第 13 批（中-DOM/UI 批量）：`ts/ui/handlers/path-controls.ts` 18.51% → **100% lines / 100% funcs**（22 → 0）、`ts/panel/enrich-result-view.ts` 0% → **100% 四项全满**（20 → 0）、`ts/ui/handlers/sheet.ts` 0% → **100% lines / 100% funcs / 100% stmts**（24 → 0）；新增 3 个测试文件 / 25 条；`npm run gate` 七关全绿
> **测试**：**3917 条 / 119 文件，全绿**
> **全项目覆盖率**：**93.66% stmts / 84.30% branch / 94.23% funcs / 94.52% lines**（较首次生成 **+47.70 个点**）
> **可执行行数**：13411，已覆盖 12676，**未覆盖 735**
> **换算**：全项目**每提升 1 个百分点 ≈ 134 行**（= 13410 / 100）
>
> 注：第二轮涨幅主体是 §三 第 3、4 批 —— `ribbon-service`、`ui/handlers/sync`、`clean-page`、`scraping`、`sheet-cleaning`、`shell-nav` 等
> 由 0~30% 补到 88~100%，未覆盖行 **5118 → 3212（−1906 行）**；第三轮（第 5 批）**3212 → 2811（−401 行）**；第四轮（第 6 批）**2811 → 2808（−3 行）**；第五轮（第 7 批）**2808 → 2467（−341 行）**；第六轮（第 8 批）**2467 → 1976（−491 行）**；第七轮（第 9 批）**1976 → 1505（−471 行）**；第八轮（第 10 批）**1505 → 1134（−371 行）**；第九轮 **1134 → 911（−223 行）**；第十轮（第 12 批）**911 → 801（−110 行）**；第十一轮（第 13 批）**801 → 735（−66 行）**。
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
| 137 | +1.02% | 74.62% | 难-COM/网络 | `ts/sync/exceltobangumi/index.ts` |
| 78 | +0.58% | 88.21% | 中-DOM/UI | `ts/panel/enrich-page.ts` |
| 77 | +0.57% | 1.28% | 中-DOM/UI | `ts/panel/panel-page.ts` |
| 69 | +0.51% | 59.17% | 难-COM/网络 | `ts/sync/workbook-auto-detect.ts` |
| 58 | +0.43% | 40.2% | 中-DOM/UI | `ts/ui/handlers/github-settings.ts` |
| 40 | +0.30% | 0% | 难-COM/网络 | `ts/sync/exceltobangumi/chapter-marker.ts` |
| 31 | +0.23% | 3.12% | 中-DOM/UI | `ts/ui/message.ts` |
| 26 | +0.19% | 96% | 难-COM/网络 | `ts/sync/github-sync.ts` |
| 24 | +0.18% | 92.4% | 中-DOM/UI | `ts/panel/clean-engine.ts` |
| 22 | +0.16% | 76.34% | 中-DOM/UI | `ts/ui/handlers/index.ts` |
| 19 | +0.14% | 0% | 中-DOM/UI | `ts/ui/github-config-dialog.ts` |
| 17 | +0.13% | 0% | 中-DOM/UI | `ts/panel/clean-bootstrap.ts` |
| 14 | +0.10% | 97.59% | 中-DOM/UI | `ts/ui/handlers/action-handlers.ts` |
| 13 | +0.10% | 96.58% | 难-COM/网络 | `ts/sync/sync-record.ts` |
| 13 | +0.10% | 90.07% | 易-纯逻辑 | `ts/tools/config.ts` |
| 12 | +0.09% | 67.56% | 易-纯逻辑 | `ts/tools/logger.ts` |
| 11 | +0.08% | 83.07% | 易-纯逻辑 | `ts/tools/sanitize.ts` |
| 8 | +0.06% | 85.71% | 易-纯逻辑 | `ts/tools/util/cell.ts` |
| 6 | +0.04% | 95.45% | 中-DOM/UI | `ts/ui/handlers/module-order.ts` |
| 5 | +0.04% | 96.75% | 难-COM/网络 | `ts/sync/enrich-lock.ts` |
| 5 | +0.04% | 96.73% | 难-COM/网络 | `ts/sync/github-sync-diff.ts` |
| 4 | +0.03% | 55.55% | 易-纯逻辑 | `ts/core/error-handler.ts` |

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
   - **又一处死分支（已于第三轮修改，见第 12 条）**：397-404 行「多行表头补齐」中 `headerNames` 恒被填满 `MAX_SCAN_COLUMNS` 个元素 → `Object.hasOwn` 恒真 → `filled >= 3` **永不成立**，多行表头检测功能实际失效。**第三轮已改**：新增 `hasHeaderName(index)`（判值非空）替换 4 处 `Object.hasOwn`；**第七轮进一步收口风险 A**（宽而稀疏表头被数据行补满空隙列时误判，见第 12 条风险 A 项）。

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
9. ~~`clean-page.ts` 的 `handleScan` 宿主检查死分支~~ ✅ **已修复（2026-09-14）**：原顺序是「校验勾选清理项 → 校验已勾选工作表 → `if (!getApp())` 弹提示」，而第二道校验要经 `getApp()?.PluginStorage` 读存储 → 未连接宿主时集合必为空、前面的检查先 return，
   **「未连接到 Excel / WPS」提示永远不会显示**。修复：把该检查**整块前移到函数入口**（不是删掉）。
   用户可见变化：无宿主点「扫描」原本得到**误导提示**「请先…加载并勾选至少一张工作表」，现在得到准确的宿主提示。「死分支」的第三种处理方式（补测 / 删除 / **前移**）见 `REF-testing.md`。
10. 🧹 **顺带修掉的历史门禁红灯**：`tests/shell-nav.test.ts` 带着 6 处 lint 错误入过库（3 处 `no-manually-wrapped-comments` + 3 处 `prefer-object-define-properties`），已用带断言的 node 脚本修复，gate 恢复 0。
11. ~~`ts/panel/enrich-preview-flow.ts`（+2.94%）~~ ✅ **已完成**（2026-09-14）：行覆盖 **1% → 99.74%**（新增 `tests/enrich-preview-flow.test.ts` 77 条，funcs 100%）。
    **没有拆文件** —— 16 个 import 全是叶子模块、不回引 barrel，逐模块 `vi.mock` 就地测；`enrich-page-context` 用真实现（state 单例 + 真 `getElementById`），
    所以「元素缺失 → 早退」是真删 DOM 驱动的。
    - ✅ **隐患已修（2026-09-14）**：`activeWorkbookName()` 原先裸读 `.Name`（同文件 `collectWorkbookTabs()` 包了 try），源工作簿关闭后抛错 → 被 `detectHeaderOnSheet` 的 catch 接住并 **返回 null**，而 state 已写入 → 「列映射编辑器 + 源数据预览 + 工作簿按钮条」整链不渲染，用户只看到「识别表头失败」。
      修复：新增 `readWorkbookName(wb)`，把该文件**全部 5 处读名**（3 处内联 IIFE + 1 处裸读 + 源表名）收口到一处；读名失败降级为空串（该工作簿本就该被跳过 / 不高亮），链继续走。
    - ✅ **316-322 行那个「不可达 catch」随收口消失**：它被合并进 `readWorkbookName()`，并由新增的「源工作簿已关闭」用例真正覆盖，不再是未覆盖分支。

12. 🔧 **`ts/panel/panel-lifecycle.ts` 表头检测修复**（第三轮，**已改生产代码**）：`detectHeaderAndColumns` 的「多行表头检测」是死分支，但**不是功能不需要，而是判据写错** ——
    `headerNames` 由 `push` 填满 `MAX_SCAN_COLUMNS` 项（定长稠密数组），4 处却用 `Object.hasOwn(headerNames, c - 1)` 探测「该列有无表头名」→ **恒真**。
    探针实测：`filled` 恒 0（多行表头永不触发、`dataStartRow` 不推进）、`headerLastCol` 恒 60（预览 `columnCount` 恒 60、应 4）、预览起始列恒为 `firstDataCol - 5`（左扩循环空转）。
    修复：新增 `hasHeaderName(index)`（判值非空）替换 4 处；并把锚点行**向上回溯到连续候选块首行**，解决「补齐行比主表头行更宽时主表头列名整行丢失」。    测试 78 条全绿，文件行覆盖 **98.99%**。
    - 🔧 **风险 A（阈值误判窗口）已收口（2026-09-14 第七轮）**：上轮修复后多行表头检测第一次真正生效，但 `filled >= 3` 会把「宽而稀疏的表头行（留 ≥3 个内部空隙）+ 下方数据行恰好填了这些空隙列」误判成多行表头、把数据行 `dataStartRow` 后移吃掉。根因是判据把锚点**内部空隙列**也计入「补齐」。改为：续行只在「锚点最右列**右侧**向右延伸 ≥3 列且**不填补任何内部空隙**」时才认作多行表头；新增回归用例（`tests/panel-lifecycle.test.ts` 的「风险A回归：宽而稀疏的表头行…」）。探针确认此为真实 bug，触发窗口极窄（表头须为最宽候选且下一行恰填 ≥3 空隙列），最坏后果仅预览少一行、不影响按列名同步。
    - 🔎 **未做**：`candidates.sort` 本身未动（它还承担「表头上方有零散关键词行」的取舍）；`autoDetectSheet` 走 `findBangumiTargetSheets()`（`tools/locked-sheet.ts` 里另一套实现），与本函数**不共用**，未受牵连。

13. 🔧 **清掉第 9 / 11 条的待办隐患**（第三轮，**已改生产代码**）：
    - `ts/panel/clean-page.ts`：宿主检查前移到 `handleScan` 入口；行覆盖 99.41% → **100% lines / 100% funcs**（55 条）。
    - `ts/panel/enrich-preview-flow.ts`：读名收口到 `readWorkbookName()`；行覆盖 99.74% → **100% lines / 100% funcs**（78 条）。
    - **验证方式：「回滚 → 复跑」**。两条新用例断言的是**可观察结果**（`dialogAlert` 调用次数 / `.mapping-select` 是否渲染），不是 `not.toThrow()` —— 后者对 `detectHeaderOnSheet` 的 try/catch 是**无效断言**（异常被吞、恒过）。临时回滚两处修复后复跑：`dialogAlert` 调用 **0 次**、`dialogError` 被调用 1 次且消息为 `识别表头失败: workbook closed`，证明用例真抓得住旧 bug。
    - 未扩面的同源点（刻意不动）：`switchSourceWorkbook` 337/358 行（操作的是用户刚点的工作簿）、`previewMatch` 的两处 `state.*.Name`（在 try 内）；其它模块（`tools/locked-sheet.ts`、`sync/workbook-auto-detect.ts`、`panel/panel-lifecycle.ts`）的同类模式各自已有守卫。

14. ~~`ts/panel/panel-lifecycle.ts` 收尾 + `ts/ui/preview.ts`（+2.53%）~~ ✅ **已完成**（2026-09-14 第五轮）：
    - `panel-lifecycle.ts` 97.4% → **100% lines / 100% funcs**（84 条；stmts 99.64 / branch 88.39）。补的是 202-204（锁定索引悬空时的「回退到活动工作表」兜底）、659-662（宿主对**单格** Range 返回标量时的取值路径）、435（数据区全空 → `firstDataCol` 回退 1）、576（`AutoFilterMode` 为假时靠 `AutoFilter.Mode` 兜底）、874（可见行跳号 → 拆成多段各读一次）。
      剩 315 / 885 两条**不可达防御语句**：`isRowVisible` 的 `r === headerRow` 早退（调用点 `dr` 恒 ≥ `dataStartRow > headerRow`）、`segStart === undefined` 早退（被 `index < maxPreview ≤ dataRows.length` 保证）。
    - `ts/ui/preview.ts` 7.37% → **99.18% lines / 92% funcs**（新增 `tests/preview.test.ts` 54 条）。
      依赖形状与 `panel-lifecycle` 同型（mock barrel 一层 + 4 个叶子模块），**没有拆文件**；`core/constants.js` **刻意不 mock** —— 模块顶层用真实 `WATCH_STATUS_MAP` 构造 `VALID_STATUSES`，mock 掉会让状态筛选器恒空、断言失去意义。
      剩两处不可达：排序比较器（非优先标签需 ≥2 个，而 `normalizeStatus` 把所有可识别中文都收敛到 7 个标准名，非优先只有「忽略」）、`typeof getAllSyncRecords !== 'function'`（静态 import 绑定恒为函数）。
    - ✅ **两个新发现的隐患（2026-09-14 第六轮已全部修复，见第 8 批 15 条）**：
      ① `uploadSingleRow` 的 `document.getElementById('sheetSelect')` **无判空**（preview.ts 684 行）→ 元素缺失时 `select.value` 抛 TypeError，被外层 catch 兜成 `上传出错: Cannot read properties of null (reading 'value')`，用户看不懂；写测试时必须先挂该元素，否则一批用例会被同一个假错误掩盖。
      ② `syncAllRows` 声明返回 `{success, fail, skip}`，实际把 `SyncToBangumiAsync` 的结果**整个透传**（含 `stopped`）。

**第 8 批（2026-09-14 第六轮，已完成）**

15. ~~`ts/sync/enrich-engine.ts`（315 行未覆盖 / 44.54%）+ `ts/ui/sync-result-dialog.ts`（180 行 / 2.17%）+ 第 14 条的 preview.ts 两个隐患~~ ✅ **已完成**：
    - **A · 先拆掉一个「假绿」文件**：`tests/enrich-engine.intro.test.ts`（885 行 / 49 条）**不 import 任何生产模块**，而是把生产逻辑复制成副本（`simulateEnrichIntroData` / `simulateEnrichOpEdPv` / `simulateEnrichAlias`）→ intro 家族（≈160 条语句）**零覆盖却有一个专测文件撑门面**。
      改写为**直接 import 真实现**（`isIntroSheet` / `enrichIntroData` / `enrichOpEdPv` / `enrichAlias` / `readIntroSheetRow` / `buildIntroSheetContext` / `enrichIntroFromContext` …），断言全部打在真实现 + 内存工作表桩上；未导出的常量（`INTRO_FIELD_TO_BANGUMI` / 标注白名单）改为**经行为间接验证**。
    - **B · 按 38 组切片地图补其余纯逻辑切片**（新增 `tests/enrich-engine.fields.test.ts`）：`detectColumns` / `readPlatformValues` / `readNewAnimeRow` / `getBangumiColumnMap` / `isBangumiSheetEmpty` / `matchEntries` / `enrichTags|Platform|Date|Episodes|Features` / `enrichEntries` / `ensureBangumiColumns` / `detectAnimeSourceLayout` / `searchSheet`。
    - **C · `ui/sync-result-dialog.ts` 从 2.17% 起步**（新增 `tests/sync-result-dialog.test.ts`）：`formatDuration` / `computeDateStatsFromSheet` / `showSyncResultDialog`（标题图标随 `stopped`、完成度环配色、失败与跳过徽标、日期统计区块、确定/ESC 关闭、替换旧弹窗、导出成功与失败文案）/「查看详情」三分支 / 同步详情预览弹窗。
    - **结果**：`enrich-engine.ts` 行覆盖 **44.54% → 99.47%**（未覆盖 315 → **3 行**）；`sync-result-dialog.ts` **2.17% → 99.45%**（未覆盖 180 → **1 行**）。
    - **两个 preview.ts 隐患（第 14 条 ①②）**：
      ① `uploadSingleRow` 改 `instanceof HTMLSelectElement` 判空，元素缺失时**回退工作表 1 + 记 WARN** —— 不再抛 TypeError 被外层 catch 兜成用户看不懂的「Cannot read properties of null」；
      ② `syncAllRows` 收敛为**显式返回三字段**（`stopped` 只驱动本函数内的进度弹窗文案），「声明与运行时不符」消除。
    - **顺带修掉一处生产类型缺口**：`EnrichedField` 运行时会带 `note`（「字段名差异: 编剧 → 脚本」），接口却没声明 —— 由 `scripts/check-tests-types.mjs` 抓出（测试读 `.note` 报 TS2339）。与 ①② 同类：**声明漏字段**。修法是一行 `note?: string`。
    - **口径提示**：`ts/sync/**` 按项目方针**只吃纯逻辑切片**，COM 交互重的部分不硬造（A/B 全走内存工作表桩，断言打在真实 `setCellValue` / 真实返回结构上）。

**第 10 批（2026-09-15 第八轮，已完成）**

16. ~~`ts/sync/exceltobangumi/api.ts`（153 行 / 1.92%）、`ts/ui/handlers/incremental-bindings.ts`（104 行 / 5.45%）、`ts/panel/user-info-polling.ts`（114 行 / 0%）~~ ✅ **三个全部收口**（2026-09-15，新增 3 个测试文件 / 133 条）：
    - **`api.ts`**：1.92% → **100% lines / 100% funcs / 100% stmts**（153 → **0**，55 条）。**清单里给的「难-COM/网络」标签偏高，已证伪**：它一行 COM 都不碰，258 行是 `testTokenValidityForRibbon` + `bgmRequestSync` 两段 `XMLHttpRequest` 编排 → 把全局 `XMLHttpRequest` 换成一个**不自动完成**的假实现、由用例显式 `emit('load' | 'error')` / `fireTimeout()` 驱动，200 / 401 / 429 / 5xx / 非 JSON / 网络错误 / 超时 / abort 各条分支逐条打进。
      残余 branch 92.2% 全是 `instanceof Error ? … : String(error)` 的**后半侧**，只有刻意让被依赖方抛「非 Error 值」才可达，按既有判据不造。
    - **`incremental-bindings.ts`**：5.45% → **100% 四项全满**（104 → **0**，43 条）。依赖形状是「单一 barrel + 两个薄叶子」：barrel 单点 mock（工厂内只 `await import('core/constants.js')`，**不用** `importOriginal`）；`resource-tracking` 用**真模块**，于是「挂载 DOM → 派发 `change` 事件 → handler 真被执行」是可断言的事实，而不是「某个 mock 被调用过」。
      重试链路（3 次 × 100ms）用假时钟逐跳验证：未找到 → 排定时器 → 命中 / 退 radio / 退 checkbox / 静默结束。
    - **`user-info-polling.ts`**：0% → **100% 四项全满**（114 → **0**，35 条）。13 个符号来自 barrel + 4 个来自 `panel-lifecycle`，两个单点 mock；`tools/events.js` **不 mock**，直接对**真实** `eventBus` 打 spy，从而对真实 `BGM_EVENTS` 常量断言。
      轮询是 `setInterval(pollOnce, 2000)` → 假时钟按 tick 驱动，`pollOnce` 内各条「检测到变化」分支（工作簿数量 / 活动工作簿 / 用户信息 / Token / 三个配置开关 / 面板显示信号 / 两个跨上下文请求信号）逐条打到位。
    - **本轮新踩的三个坑（已写进 `.workbuddy/memory/REF-testing.md`）**：
      ① jsdom 里 `select.value = 'skip'` 在**没有同名 `<option>`** 时会被静默丢弃（值保持 `''`）→ 缺选项的用例会得到「看似没生效」的假失败；
      ② `window` 上的 `beforeunload` 监听器**跨用例累积**（每次 `startUserInfoPolling` 注册一个且从不摘除）→ 直接 `dispatchEvent` 会一次打中历史上所有用例的 handler，必须改成「抓本次注册的那个 handler 单独调用」；
      ③ `startUserInfoPolling()` 在**启动瞬间**就快照一次 `loadBgToken()`，想在首轮 tick 观察到 Token 变更就必须**先启动再注入**，否则用例恒不触发。
    - **全项目**：88.77% → **91.54% lines**（未覆盖 1505 → **1134**，吃掉 371 行）；测试 3616 → **3749 条 / 111 文件**；`npm run gate` 七关全绿。

**第 11 批（2026-09-15 第九轮，已完成）**

19. ~~`ts/panel/enrich-conflict-dialog.ts`（53 行 / 0%）、`enrich-record-view.ts`（53 行 / 0%）、`enrich-source-detail.ts`（46 行 / 0%）~~ ✅ **三个 0% 子流程全部收口**，合计 152 → **0 行**（新增 3 个测试文件 / 62 条）：
    - `enrich-conflict-dialog.ts` → **100% 四项全满**（53 → 0，20 条）。`handleConflictResolution` 是**私有函数**，只能经「带 `[data-resolution]` 的按钮点击」驱动，故每条用例都先建对话框骨架再派发 `click`；`enrich-progress-hosts` 用真模块（`progressHosts` 的赋值/清空本身就是断言目标），只把它下层的 `ui/components/progress.js` 换成返回桩的假工厂。
    - `enrich-record-view.ts` → **100% 四项全满**（53 → 0，20 条）。`sanitizeHtml` mock 成恒等（DOMPurify 会重排属性顺序，逐字断言模板变脆），但 `escapeHtml` **保持真实** —— 本文件要断言的正是「用户数据进模板前被转义」，把它一起 mock 掉就等于把被测行为也 mock 掉了。
    - `enrich-source-detail.ts` → **100% lines/funcs/stmts**（46 → 0，22 条）。`renderSourceDetailTable` 同为私有函数，经 `showSourceDetail()` 渲染后对 DOM 断言（「容器缺失 → 早退」是真删 DOM 驱动的）。
      branch 96.66%：余 1 条是第 74 行 `|| \`第${col}列\`` 兜底，**逻辑不可达** —— 进入该表达式的前提是 `header || field` 为真，header 为空时 field 必来自 `fieldByCol`，其取值只可能是 `COLUMN_MAPPING_FIELDS` 的 key 或 `'platformCol'`，两者都在 `labelByField` 里。已在测试文件头写明不追。
    - **踩坑**：不能用 `innerHTML` 里找 `&lt;` 断言属性转义 —— HTML 序列化会把属性值里的实体还原成字面量（`title="A&lt;B"` 解析后再序列化就是 `title="A<B"`），断言会假失败。改为直接取证「值有没有逃出属性上下文」（注入 `" onmouseover="alert(1)` 后断言 `getAttributeNames()` 只有 `title`）。
20. ~~`ts/panel/panel-bootstrap.ts`（22 行 / 0%）、`settings-bootstrap.ts`（29 行 / 0%）、`enrich-bootstrap.ts`（20 行 / 0%）~~ ✅ **三个启动脚本全部收口**，合计 71 → **0 行**（`tests/panel-bootstrap.test.ts`，17 条）：
    - 三个文件都是**导入即执行**（无导出、靠模块求值时的副作用工作），故用例 `vi.resetModules()` 后重新 `import()`，对「按钮禁用/启用、初始化函数被调用、console 输出」这些外部可观察量断言，而非断言内部变量。
    - 16 个纯副作用 import（`../index.js` barrel、`../ui/dialog.js` 等）mock 成空对象 —— 否则会拖进整张真实依赖图（barrel 循环还会静默回退真实现）；有具名导出的 8 个模块（`installModalA11y` / `initShellNav` / `startNavOrderSync` …）换成 spy。
    - **三条让该文件稳定的做法**：① `vi.clearAllTimers()` 必须留在 `beforeEach` —— settings 的 5 秒兜底定时器会随历史实例累积，不清理就会在下条用例推进时钟时替「本该超时」的实例把按钮启用，断言直接反向；② `document.readyState` 要显式复位成 `'complete'`（用例改成 `'loading'` 后 jsdom 不会自己改回来）；③ `bgm:modulesReady` 监听器跨用例累积（挂在 document 上，清 body 清不掉），断言一律用 `.some(...)` / 状态而非精确调用次数。
    - branch 停在 61~77%：余下全是 `typeof window/document !== 'undefined'` 的**另一侧**，只在无宿主环境可达，收益是 0 行覆盖（lines 已 100%），**刻意不追**。
21. **首次抽出 `tests/helpers/` 共享桩**（本轮新基建，本轮 4 个新文件已全部复用）：
    - `dom.ts` —— `clearDom` / `mountElement` / `mountSelect` / `mountCheckbox` / `mountInput` / `mountButton` / `dispatch{Change,Input,Click}` / `settleMacrotasks`。把两个非显然的 jsdom 行为写成文档：`select.value = 'x'` 在无同名 `<option>` 时被**静默丢弃**；模块级监听器不随 `clearDom()` 消失。
    - `utility-mock.ts` —— `ts/tools/util/index.js` barrel 的共享替身（`utilityMock` / `resetUtilityMock` / `loggedMessages` / `hasLogMessage`）。**用法**：`vi.mock(path, async () => (await import('./helpers/utility-mock.js')).utilityMock)` —— mock 工厂与测试文件静态 import 解析到**同一模块实例**，断言的 spy 就是被 mock 进去的那批（本模式先用探针验证过才铺开）。`resetUtilityMock` 走 `mockReset` + 重锚中性默认实现：`clearAllMocks` **不清实现**，上条用例的抛错实现会泄漏。
    - `enrich-context.ts` —— `resetEnrichState()`：在 **helper 首次求值时**对 `state` 单例深拷贝一张默认快照，重锚时写回，故生产改了默认字段会**自动跟随**、不漂移。
    - **顺带修掉一个被掩盖的统计缺陷**：`vitest.config.ts` 的 `coverage.exclude` 是**显式数组**，会整体替换 vitest 的默认 exclude（默认含 `test?(s)/**`）。少了这一条，`tests/helpers/**` 一旦被测试 import 就被 v8 采样进报告 —— 实测虚增 35 行未覆盖、把全项目 lines 从 93.2% 稀释到 92.97%。已在 `coverage.exclude` 补 `'tests/**'`（补后复核：`coverage-summary.json` 非 `ts/` 条目 = 0）。
    - **全项目**：91.54% → **93.2% lines**（未覆盖 1134 → **911**，吃掉 223 行 = 152 + 71，数字吻合）；测试 3749 → **3829 条 / 115 文件**；`npm run gate` 七关全绿。

---

**第 12 批（2026-09-15 第十轮，已完成）**

22. ~~`ts/tools/zod-compat.ts`（32 行 / 81.39%）、`ts/tools/util/sheet.ts`（28 行 / 88.97%）、`ts/tools/wps.ts`（20 行 / 64.91%）、`ts/tools/locked-sheet.ts`（17 行 / 90.55%）、`ts/tools/http.ts`（14 行 / 89.55%）~~ ✅ **五个纯逻辑小块全部收口**（2026-09-15，追加到既有测试文件 + 新建 1 个测试文件 / 合计 +63 条）：
    - **`zod-compat.ts`**：81.39% → **100% lines**（32 → 0，36 条）。补了包装类 full API 面（LiteOptional / LiteNullable / LiteWithDefault 的 optional / nullable / nullish / default / parse）与 `resolveZod()` 对 `globalThis.z` 的探测（用 `vi.resetModules()` + 动态 import 重求值观察）。
    - **`util/sheet.ts`**：88.97% → **100% lines**（28 → 0，+18 条）。补 `readRangeCellValues`（保留原始类型 / 空值 / 二维 / 一维 / 异常）、`safeStringify` 对象分支、`getLastRow` 异常回退（锚定列抛错回退 D 列 / UsedRange 抛错 / 空名缓存键 / 首次 vs 缓存日志文案）。**顺带修一处生产 bug**：`getLastRow` 的「来自缓存」文案取样时机错误（在 `cacheGet` 之后查 `has` 恒为 true），改为调用前取样 `isCached`；之前日志永远显示「来自缓存」会把首算误报成缓存命中。
    - **`wps.ts`**：64.91% → **100% lines**（20 → 0，新建 `tests/wps-dialog-fallback.test.ts` 10 条，jsdom 环境）。`wpsPrompt` / `wpsMessageBox` 三级降级链（InputBox 抛错→`window.BGMInput`→`getNotifyApi().input`；MessageBox 抛错→`window.BGMConfirm`/`BGMAlert`→`confirm`/`alert`；`(buttons ?? 0) + (icon ?? 64)` 默认值；取消 / undefined 归 null）。node 侧 `wps.test.ts` 已覆盖 `typeof window === 'undefined'` 分支，jsdom 侧补剩余链，两侧合起来 100%。
    - **`locked-sheet.ts`**：90.55% → **100% lines**（17 → 0，+18 条，复用现有 `tests/enrich-lock.test.ts` 假宿主、未建新文件）。补 `getOpenWorkbooks` 容错（无 App / FullName 抛错 / Count 抛错 / Windows.Count 抛错 / Windows 补齐）、`getLockedSheet` 回退（活动工作簿回退 / 无活动工作簿清锁 / 空 lockedName 清锁 / 无 App 时 save+restore 只记警告 / 空白名返回 null）、`findBangumiTargetSheets` 过滤、`findBangumiTargetSheetInWorkbook`（名称命中优先 / 无命中取首个 / 全无返回 null）。
    - **`http.ts`**：89.55% → **99.25% lines**（14 → 1，+7 条，51 条）。补 XHR 层细节（响应头非空读取 / onProgress 注册 + lengthComputable=false 不回调 / `xhr.send` 抛错降级 NETWORK_ERROR / XHR 初始化抛非 Error 用 String() 兜底 / zodSchema.parse 抛非 Error 用 String() 兜底）+ `signal` 竞态（入口已 aborted 即失败）。**刻意不追**：`MAX_RETRIES_EXCEEDED` 不可达出口（重试循环出口逻辑使其无法到达）。
    - **本轮新踩的坑（已写进 `REF-testing.md`）**：① 两个并行 Edit 写同一测试文件只落地一处（`nullish` 进了、`vi` 导入没进）→ 改为带断言的 `tmp-spec.mjs` 批量修；② `class-methods-use-this` 在 XHR 抛错测试桩上用 `/* eslint-disable class-methods-use-this */` 包子类；③ `typecheck:tests` 基线门禁（`scripts/check-tests-types.mjs`）对新增用例的 TS 错误只许下降，本次 `LiteIssue` 缺 `message?` 触发 2 个 TS2339 当场修；④ `--reporter=basic` 在新版 vitest 已移除，改默认 reporter + `Out-File` 落盘。
    - **全项目**：93.2% → **94.03% lines**（未覆盖 911 → **801**，吃掉 110 行，与 5 文件合计 111 行口径吻合，余 1 行是 http 不可达）；测试 3829 → **3892 条 / 116 文件**；`npm run gate` 七关全绿。


**第 13 批（2026-09-15 第十一轮，已完成）**

23. ~~`ts/ui/handlers/path-controls.ts`（22 行 / 18.51%）、`ts/panel/enrich-result-view.ts`（20 行 / 0%）、`ts/ui/handlers/sheet.ts`（24 行 / 0%）~~ ✅ **三个 DOM/UI 文件全部收口**（2026-09-15，新增 3 个测试文件 / 25 条）：
    - **`path-controls.ts`**：18.51% → **100% lines / 100% funcs**（22 → 0，11 条）。`selectDefaultFolder` 覆盖 8 分支（getApp 空 / FileDialog 选择 / 取消 / GetOpenFilename 回退取目录 / 取消 / 抛错兜底 / 无斜杠文件名返回 null / 既无 FileDialog 也无 GetOpenFilename）、`updatePathDisplay` 2 分支、`initConfigPathControls` 1 分支。branch 余 21/24（87.5%）：`initConfigPathControls` 开头 `if (typeof document === 'undefined') return` 的另一侧（无宿主早退）**刻意不追**（与三个 bootstrap 同判据，收益 0 行覆盖）。
    - **`enrich-result-view.ts`**：0% → **100% 四项全满**（20 → 0，8 条）。`maybeAutoCleanAfterEnrich`（早退 / 成功 / 异常兜底）+ `showEnrichDetailButton` / `showEnrichDetail` / `hideEnrichDetail`（DOM 切换）。branch 余 13/16（81.25%）：`maybeAutoCleanAfterEnrich` 的 bangumiSheet 空判定两侧与 catch 属不可达/已前移分支。
    - **`sheet.ts`**：0% → **100% lines / 100% funcs / 100% stmts**（24 → 0，6 条）。驱动真实 `cleanLockedDataSheet`，覆盖空工作表 / 有数据 / 异常兜底各分支。branch 余 18/20（90%）：两条 `typeof X === 'undefined'` 另一侧。
    - **mock 策略（三个都走「单一 barrel 单点 mock」）**：`../ts/index.js` 提供 `getApp` / `getExportPath` / `getImportPath` / `LOG_LEVELS` / `bgmLog` / `BGM` 等；叶子模块（`enrich-page-state` / `enrich-page-context` / `sheet-cleaning` / `dialog` / `tools/util/index`）单点 mock，断言打在真实 DOM 写入 / 真实 `cleanSheetDuplicates` 调用 —— 与第 11 批「0% 子流程就地测」同型，不存在假覆盖。
    - **本轮新踩的 typecheck 坑（已写进 `REF-testing.md`）**：① `vi.fn(() => null)` 被推断返回类型 `null`，后续 `mockReturnValue(对象)` 报「not assignable to null」→ 写成 `vi.fn((): unknown => null)`；② `vi.hoisted` 里 `null as never` 会让后续 `= null` / `= {Name}` 都报「not assignable to never」→ 改成 `null as { Name: string } | null`。
    - **全项目**：94.03% → **94.52% lines**（未覆盖 801 → **735**，吃掉 66 行 = 22 + 20 + 24，数字吻合）；测试 3892 → **3917 条 / 119 文件**；`npm run gate` 七关全绿。

## 四、门禁现状

`vitest.config.ts` 的全局阈值（2026-09-13 上调）：
`statements 40 / branches 35 / functions 45 / lines 40`（`perFile: false`）。

留 5~8 个点安全余量，只拦真实回归。

> ⚠️ **已知无效配置**：`perFile: false` 下 vitest 的「glob 单文件阈值」**不会被检查**（实测把某文件阈值改成 101 也不报错）。
> 想给单个文件（如 `module-state.ts`）锁 100%，只能靠测试本身维持，**不要写进 thresholds 假装它有保护**。

