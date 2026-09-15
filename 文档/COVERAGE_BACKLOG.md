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
> **基线刷新**：2026-09-15（第十二轮）—— 清单**第 16 批（P0 五文件速赢）+ 第 14 批（P1-5/6/9）一次收口**：`tools/config.ts` / `tools/logger.ts` / `tools/sanitize.ts` / `tools/util/cell.ts` / `core/error-handler.ts` 五个纯逻辑文件 **100% lines**（48 → 0），`panel/clean-engine.ts`（24 → 0）/ `ui/handlers/index.ts`（22 → 0）/ `ui/handlers/action-handlers.ts`（14 → 0）也全部 **100% lines**；8 个文件合计吃掉 **109 行**；新增 `tests/error-handler.test.ts`，其余 7 个文件就地扩写（+82 条）；`npm run gate` 七关全绿
> **基线刷新**：2026-09-15（第十三轮）—— 清单**第 15 批（P1 其余 7 文件）一次收口**：`panel/enrich-page.ts`（78 → 0，另建 `tests/enrich-page-watch.test.ts` 隔离模块级轮询状态）、`panel/panel-page.ts`（78 → 0）、`ui/handlers/github-settings.ts`（58 → 0）、`ui/message.ts`（32 → 0）、`ui/github-config-dialog.ts`（19 → 0）、`panel/clean-bootstrap.ts`（17 → 0）、`ui/handlers/module-order.ts`（6 → 0），**7 个文件全部 100% lines，合计 288 行**；顺带修掉 `ui/github-config-dialog.ts` 里一处**属性注入漏洞**（自建 `escapeHtml` 不转义引号却拼进 `title="..."`，改用 `tools/string-utilities-pure.ts` 的规范实现，因此该文件可执行行 19 → 16）；新增 4 个测试文件 / 116 条；`npm run gate` 七关全绿
> **基线刷新**：2026-09-15（第十四轮）—— 清单**第 17 批（P2 七个难-COM/网络文件）一次收口**：`sync/exceltobangumi/index.ts`（137 → 0，顺带把 `createFieldGetter` 批量缓存、增量指纹跳过、最小请求间隔节流、`jsonBody` 解析降级、无法提取 Subject ID、`visibleCells.Areas` 缺失六类分支逐条打通）、`sync/workbook-auto-detect.ts`（69 → 0）、`sync/exceltobangumi/chapter-marker.ts`（40 → 0）、`sync/github-sync.ts`（26 → 0）、`sync/sync-record.ts`（13 → 0）、`sync/enrich-lock.ts`（5 → 0）、`sync/github-sync-diff.ts`（5 → 0），**7 个文件全部 100% lines，合计 295 行**；新增 `tests/chapter-marker.test.ts`（15 条）、`tests/workbook-auto-detect-scan.test.ts`（35 条），其余 5 个文件就地扩写，合计 **+111 条 / +2 文件**；`npm run gate` 七关全绿
> **基线刷新**：2026-09-15（第十五轮）—— 清单**已全部清空**，本轮做 §6 非补测待办 **O-2（锁表查找加索引快路径）**：`tools/locked-sheet.ts` 的 `getLockedSheet()` 从「按名线性扫描 N 张表」改为「先用 `BGM.sheet.lockedIndex` 单次探测 + 按名复核、不过再回落扫描」，命中路径 COM 往返 **N → 1**；同时把 `Worksheets.Count` 提出循环条件（原来每轮多一次 COM 往返）。**无新增未覆盖行**（154 → 183 可执行行，仍 100% lines），配套 `tests/enrich-lock.test.ts` **+5 条**（断言 `Worksheets.Item` 调用次数，即优化本身）；`npm run gate` 七关全绿
> **测试**：**4231 条 / 127 文件，全绿**
> **全项目覆盖率**：**98.86% stmts / 89.81% branch / 99.06% funcs / 99.65% lines**（较首次生成 **+52.83 个点**）
> **可执行行数**：13411，已覆盖 13365，**未覆盖 46**
> **换算**：全项目**每提升 1 个百分点 ≈ 134 行**（= 13411 / 100）
>
> 注：第二轮涨幅主体是 §三 第 3、4 批 —— `ribbon-service`、`ui/handlers/sync`、`clean-page`、`scraping`、`sheet-cleaning`、`shell-nav` 等
> 由 0~30% 补到 88~100%，未覆盖行 **5118 → 3212（−1906 行）**；第三轮（第 5 批）**3212 → 2811（−401 行）**；第四轮（第 6 批）**2811 → 2808（−3 行）**；第五轮（第 7 批）**2808 → 2467（−341 行）**；第六轮（第 8 批）**2467 → 1976（−491 行）**；第七轮（第 9 批）**1976 → 1505（−471 行）**；第八轮（第 10 批）**1505 → 1134（−371 行）**；第九轮 **1134 → 911（−223 行）**；第十轮（第 12 批）**911 → 801（−110 行）**；第十一轮（第 13 批）**801 → 735（−66 行）**；第十二轮（P0 + 第 14 批）**735 → 626（−109 行）**；第十三轮（第 15 批）**626 → 341（−285 行）**；第十四轮（第 17 批）**341 → 46（−295 行，与台账 295 行精确吻合）**；第十五轮（O-2 收尾优化）**未覆盖行维持 46**（可执行行 13408 → 13411，lines 维持 99.65%）；第十六轮（第 18 批长尾清零）**46 → 7（−39 行）**，未覆盖文件 → **5 个**。
> **关键结论（累积）**：清单前列的「大文件 / COM 模块」**都没有走「先拆后测」**——依赖收敛到单一 barrel、依赖宿主对象、或依赖 ≤3 个薄封装的，就地测即可，
> 断言打到真实 state 变迁 / 真实写盘调用 / 真实 DOM 写入，**不存在假覆盖**（判据见 `.workbuddy/memory/REF-testing.md`）。

数据来源：`coverage/coverage-summary.json`（`npx vitest run --coverage --config vitest.cov.config.ts --coverage.reporter=json-summary`）。
复算脚本：`scripts/calc-coverage-backlog.mjs`（读 summary → 按未覆盖行数排序 → 输出本文档表格）；
**逐行定位**用 `scripts/calc-coverage-lines.mjs`（读 `coverage-final.json` → `istanbul-lib-coverage.getLineCoverage()` → 列出未覆盖行号，与本文档的未覆盖行数**逐行吻合**）。

> ⚠️ **行口径陷阱**：`coverage-summary.json` 的 `lines` **不能**由 `coverage-final.json` 的 `statementMap` 行区间求和推导 ——
> 实测 `ts/panel/clean-engine.ts` 求和得 531 行、台账口径是 316 行。`getLineCoverage()` 是「同一行取该行所有
> statement 计数的**最大值**」（见 `istanbul-lib-coverage/lib/file-coverage.js`）。照 `statementMap` 求和去补测会跑偏。
>
> 由此派生一条实用结论：形如 `if (cond) return X` 的**单行守卫**，IfStatement 每轮都会求值（计数 > 0），
> 所以即便 `return X` 从未走到，**该行仍算已覆盖**。这类残留只会出现在 `calc-coverage-lines.mjs` 输出的
> `uncovered stmts` 里，不会进 `uncovered lines` —— 想把 stmts 也刷满得单独造边界输入，本台账只按行统计。

```bash
# 跑覆盖率复核：两个环境变量/参数都不能省
#   CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD 放行 coverage/.tmp 的批量删除（否则撞 safe-delete 守卫）
#   --config vitest.cov.config.ts 让 clean:false 生效（否则收尾 cleanAfterRun 失败、进程 exit 1）
#   两个 reporter 都要给：只给 --coverage.reporter=json 时 coverage-summary.json 不会重写，
#   复算脚本里的 summary lines 会读到上一次的陈旧值（uncovered lines 仍准确）
CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=1000000 \
npx vitest run --coverage --config vitest.cov.config.ts \
  --coverage.reporter=json-summary --coverage.reporter=json
node scripts/calc-coverage-backlog.mjs
node scripts/calc-coverage-lines.mjs panel/clean-engine.ts   # 逐行定位（按路径子串过滤）
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

**✅ 第十四轮后清单已清空** —— 原 22 个待补测文件全部收口，下表保留收口时的口径备查：

| 未覆盖 | 全补完提升 | 当前行覆盖 | 难度 | 文件 | 收口结果 |
| -----: | ---------: | ---------: | ---- | ---- | ---- |
| ~~137~~ **0** | +1.02% | **100%** | 难-COM/网络 | `ts/sync/exceltobangumi/index.ts` | ✅ 第 17 批 |
| ~~69~~ **0** | +0.51% | **100%** | 难-COM/网络 | `ts/sync/workbook-auto-detect.ts` | ✅ 第 17 批 |
| ~~40~~ **0** | +0.30% | **100%** | 难-COM/网络 | `ts/sync/exceltobangumi/chapter-marker.ts` | ✅ 第 17 批 |
| ~~26~~ **0** | +0.19% | **100%** | 难-COM/网络 | `ts/sync/github-sync.ts` | ✅ 第 17 批 |
| ~~13~~ **0** | +0.10% | **100%** | 难-COM/网络 | `ts/sync/sync-record.ts` | ✅ 第 17 批 |
| ~~5~~ **0** | +0.04% | **100%** | 难-COM/网络 | `ts/sync/enrich-lock.ts` | ✅ 第 17 批 |
| ~~5~~ **0** | +0.04% | **100%** | 难-COM/网络 | `ts/sync/github-sync-diff.ts` | ✅ 第 17 批 |

> 📌 **第十四轮后清单形态**：`ts/panel`、`ts/ui`、`ts/tools`、`ts/core`、`ts/sync` 五档**均无成规模待补文件**。
> 全项目剩余 **46 行**全部是长尾零头（单文件 ≤3 行，合计摊平在 ~30 个文件里，收益 ≤ +0.02%/文件），
> **再往下做只能靠逐文件清零头，边际收益已接近 0**。
>
> 📌 **第十三轮后清单形态变了**：上表已无 `ts/panel` / `ts/ui` 文件 —— 中-DOM/UI 档**全部收口**（仅剩 `enrich-preview-cell` 3 行、
> `ui/preview` 3 行这类零头）。剩下的 341 行里，前 5 个文件就占 285 行（84%），且**全是难-COM/网络**；
> 其余 30 个文件每只差 1~3 行，合计 56 行（长尾已摊平，单文件收益 ≤ +0.02%）。
> 也就是说：再往后**没有「顺手就能吃一大口」的目标了**，要么啃 COM 大块（需先评估是否真能造出宿主），
> 要么逐个清 1~3 行的零头。

> **难度列是按目录粗判的**：`ts/tools`、`ts/core` 多为纯逻辑 → 易；`ts/panel`、`ts/ui` 依赖 DOM → 中；`ts/sync`、`ts/services` 依赖 COM / 网络 → 难。
> 实际动手前仍需扫一眼文件内的依赖（例如 `tools/util/index.ts` 是聚合桶，可能混入依赖 WPS 全局对象的函数）。

> 📌 **第十六轮后（第 18 批长尾清零）**：长尾也被吃掉了 —— 未覆盖 **46 → 7 行 / 5 个文件**，全项目 **99.94% lines**。
> 余下 7 行**全部是经可达性分析判定的不可达 / 死代码**（逐条依据见 §三 第 18 批），**不是「还没做」**。
> 也就是说：**补测这条线已经做完** —— 想继续降只能「删死代码」或「重构掉不可达分支」，
> 那属于**代码清理**任务，不属于补测任务，不应再挂在这份清单下。

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

**第 16 批 · P0 五文件速赢 + 第 14 批（2026-09-15 第十二轮，已完成）**

24. ~~P0 五文件：`ts/tools/config.ts`（13 行）、`ts/tools/logger.ts`（12 行）、`ts/tools/sanitize.ts`（11 行）、`ts/tools/util/cell.ts`（8 行）、`ts/core/error-handler.ts`（4 行）~~ ✅ **五个纯逻辑文件全部收口**（2026-09-15，就地扩写 4 个既有文件 + 新建 `tests/error-handler.test.ts`，合计 +27 条）：
    - **`config.ts`**：90.07% → **100% lines**（13 → 0，32 → 38 条）。补 postMessage 抛错吞并 + WARN、`areNavIconsOnly()` 非静默 INFO 日志、以及整个 `describe('全局日志级别')`（`setLogLevel` 落盘 `'3'` + 写 `BGM.LOG_LEVEL`、`setLogLevel(0)` 走 DEBUG、`[-1, LOG_LEVELS.ERROR+1, 1.5, NaN, Infinity]` 全部拒绝、`getLogLevel` 兜底、`applyLogLevel()`）。
      **顺带修掉 mock 里的一个真实缺陷**：`LOG_LEVELS` 被误 mock 成**字符串**（`{WARN:'warn',INFO:'info',ERROR:'error'}`），导致 `LOG_LEVEL_MAX = LOG_LEVELS.ERROR` 变成字符串、`level > LOG_LEVEL_MAX` 守卫失效（比较恒 false）→ 改为与生产一致的**数字** `{INFO:1,WARN:2,ERROR:3}`（对照 `ts/core/constants.ts:157`）。这类「mock 把常量类型改错」会让守卫分支静默失效，是假绿测试的典型来源。
    - **`logger.ts`**：67.56% → **100% lines**（12 → 0，18 → 30 条）。整文件切 `// @vitest-environment jsdom`（`exportLogsToFile` 需要 Blob / anchor / `URL.createObjectURL`）；新增 `describe('exportLogsToFile')`，用窄视图接口 `ObjectUrlApi` 替掉 `as unknown as typeof URL.createObjectURL`，用 `HTMLAnchorElement.prototype.click` 的 `this` 抓临时 `<a>`（避免 `vi.spyOn(document, 'createElement')` 触发 `@typescript-eslint/no-deprecated`）。覆盖：文本格式 `[ISO] [LEVEL] msg`、`download` 匹配 `/^bgm-logs-\d+\.txt$/`、anchor 移除 + URL revoke、空缓冲 → `''`、导出前仍走脱敏。
    - **`sanitize.ts`**：83.07% → **100% lines**（11 → 0，42 → 47 条）。新增 `describe('降级路径与无 DOM 环境的兜底分支')` + 模块级 `useFallback()`（**必须同时** `delete globalThis.DOMPurify` **和** `resetSanitizerCache()`，只删一个不生效）。覆盖：降级实现剥离 `javascript:` / `vbscript:` URI 属性但保留安全属性；`vi.stubGlobal('document', undefined)` → 正则粗粒度兜底（script/style/iframe/meta + 三种 `on*=` 形态全清、`<div>` 与正文保留）；`sanitizeTableRows` 无 DOM 时的字符串剥离分支；`document.createElement` 抛错 → 正则回退。
    - **`util/cell.ts`**：85.71% → **100% lines**（8 → 0，38 → 44 条）。新增 `describe('tryGetProperty 属性探测边界（间接）')`：函数返回原生函数 / 函数抛错 / 对象 `toString` 含 `'function'` / 仅含 `'[native code]'` / 普通对象直通，外加一条**真正走到 try/catch 的 own-accessor 抛错**（既有 Proxy 用例因 `Object.hasOwn === false` 在早退处就返回了，从没进过 catch）。
    - **`error-handler.ts`**：55.55% → **100% lines（四项全满）**（4 → 0，新建 `tests/error-handler.test.ts` 5 条）。用 `Object.assign(new Event('unhandledrejection'), { reason, preventDefault })` 派发合成事件；断言 `console.error('[unhandledrejection]', message)`、`preventDefault` 被调、非 Error reason 走 `String()`、以及 `resetErrorHandlerState()` 允许重新注册。
      **关键坑**：`initGlobalErrorHandler` 只用 `isInitialized` 幂等，但**每次调用都会再注册一个 listener**，而 `resetErrorHandlerState()` 会把开关放回未初始化 → 跨用例 listener 数会累积。因此这里的断言必须用**增量计数**，不能用绝对次数。
    - **全项目**：94.52% → **94.87% lines**（未覆盖 735 → **687**，吃掉 48 行，与 5 文件合计 48 行**精确吻合**）；测试 3917 → **3944 条 / 120 文件**。

25. ~~第 14 批：`ts/panel/clean-engine.ts`（24 行 / 92.4%）、`ts/ui/handlers/index.ts`（22 行 / 76.34%）、`ts/ui/handlers/action-handlers.ts`（14 行 / 97.59%）~~ ✅ **三个文件全部 100% lines**（2026-09-15，全部就地扩写，+55 条）：
    - **`clean-engine.ts`**：92.4% → **100% lines / 100% funcs / 100% stmts**（24 → 0，41 → 71 条）。台账口径的 24 行**逐行**对齐（`coverage-summary.json` 的 lines 与 `coverage-final.json` 的 statement 口径不同，见 `REF-testing.md`）：
      - **COM 异常兜底**：`FullName` getter 抛错 → `readWorkbookPath` 回退 `Name`；`Worksheets` getter 抛错 → `readWorksheets` 记 WARN；`ws.Name` getter 抛错 → `safeSheetName` 返回 `''` 且该表被 `shouldScanSheet` 跳过（**不误伤同簿其他表**）；`findHeaderRow` / `getColumnMap` / `getLastRow` 抛错 → 各自退化为「未识别表头 / 空列映射 / 末行 0」。
      - **新番表识别链**：命中签名但**无「周更时间」锚点** → 名称列缺省、TAGS 列仍映射；锚点左侧列**已有表头文本** → 停止名称列回退探测。
      - **配置驱动分支（临时注入 + `finally` 还原）**：`includeWorkbookPath` / `includeSheetName` 非空时的白名单过滤（路径不命中 → 整簿跳过；表名不命中 → 该表跳过）、`excludeSheetName` 空词表视为不排除（顺带覆盖 `hasAnyKeyword` 的 `keywords.length === 0` 早退 —— 该行在默认配置下**被 177/184 行的 length 守卫完全遮蔽，只能靠注入空词表到达**）、`rowText` / `noiseRowText` 空词表、`maxDataRows` 护栏（`inspectWorksheet` 给原因 / `buildTarget` 不入选）。
      - **规则分派**：`emptyNameRows` 分派、`scanRowRule` 的 `default` 未知种类（临时 push 一条 `kind: 'notAKind'` 规则）、`scanRowRule` catch（行扫描器抛错 → `扫描失败：…` 写 notes 且不影响其他规则）、`cellTransform` 缺 `transform` 配置、`resolveColumn` 的**包含式退化匹配**（列键 `标签/分级（备注）` 命中关键词 `标签/分级`）与完全不匹配返回 `undefined`、`columnName` 的 `第N列` 兜底。
      - **执行/统计**：`runCleanPlans` 待删除行**去重升序排序**（≥2 行才触发比较器）、多个单元格变更按行号升序写入、`countCleanTargets()`、`scanCleanRules` 在「已勾选但无目标」时的专门提示、`estimateRowBytes` 无数据行返回 0 / 末行非有限值时回退 `ROW_BYTES_FALLBACK`。
      - **`inspectWorksheet` 表头展示**：`readHeaderLabels` 的「非空才 push」需要表头行**真有文本**才能覆盖 —— 既有用例的 `getCellValue` 桩恒返回 `''`，所以这一行一直是空的。
    - **`handlers/index.ts`**：76.34% → **100% lines / 100% stmts**（22 → 0，69 → 77 条）。补 `initHandlers` 的三条分支（`typeof document === 'undefined'` 同步兜底 / `readyState === 'loading'` 挂 `DOMContentLoaded` / 直接执行）、`setupButtonListeners` 的设置页控件回填与三处 try/catch、`onAction('clear' / 'showClearConfirm')`。
      - **`readyState === 'loading'` 的解法**：用 **`Proxy` 包住真实 `document`** —— `get` 陷阱只把 `readyState` 改成 `'loading'`、拦下 `addEventListener` 收集 `DOMContentLoaded` 回调，其余成员 `value.bind(target)` 绑回真实 document，这样回调真正执行时 `startHandlers()` 能跑完（否则只能断言「抛错」，等于没测）。
      - **发现并绕开两处测试基建缺陷（不是生产 bug，但会让覆盖率凭空失真）**：① 本仓库 `tests/` 下 **`vi.mock('../index.js')` 根本解析不了**（只有 `../ts/index.js` 可解析），所以该 factory 是**死 mock**，barrel 上的 `showConfirm` / `refreshData` / `bgmLog` / `previewSyncContent` 等断言全部无效 —— 实际跑的是**真实实现**（用探针实测：`onAction('clear')` 命中真实 `showConfirm` → 无对话框 DOM → 落到原生 `window.confirm`，`mockState.showConfirm.mock.calls.length === 0`）。② 因此确认/取消分支改用 `vi.stubGlobal('confirm', …)` 驱动，日志断言改打在 **`logger.*` 的 spy** 上（`bgmLog` 是真实现，且会先过 `BGM.LOG_LEVEL` 门槛）。③ 设置页 `select` 回填必须**预置同值 `<option>`** —— jsdom 对无匹配 option 的 `select.value = 'x'` 会**静默丢弃**赋值，直接断言 value 只会拿到空串。
    - **`action-handlers.ts`**：97.59% → **100% lines**（14 → 0，100 → 111 条）。补三个「barrel 导出缺失」的 WARN 守卫（`syncSelectedRows` / `previewSyncContent` / `enlargePreview`）、`clearToken` 正常路径（`{ PluginStorage: { setItem } }` → 断言 `bgm_user_id` / `bgm_username` 被清）、`clearToken` / `copyToken` 的 catch → `BGM.handleError(…, { context })` + 恒定收尾日志、`timeFilter` 剩余三个 case（`future` / `year` / `month`）、`app.StatusBar = false` 的失败复位、`resetAllConfig` 的 600ms reload。
      - **「导出缺失」怎么驱动**：`withBarrelExportCleared(name, run)` —— Vite 的 SSR 转换会把具名 import 改写成**调用点**读命名空间属性（`__vite_ssr_import_x__.name`），所以临时把 `barrel[name] = undefined` 就能让 `typeof X === 'function'` 守卫走另一侧，`finally` 还原。
      - **假定时器与 `Date.now()` 的取舍**：`runCleanPlans` 用 `Date.now()` 算耗时，而 `tests/action-handlers.test.ts` 的策略是**只断言稳定项**。`resetAllConfig` 的 600ms reload 用 `vi.useFakeTimers()` 只包住 `advanceTimersByTime(600)` 那一段、随后立刻 `vi.useRealTimers()`，保住真实 `Date.now()`（否则总耗时断言会变成 `1s` 之类的墙钟依赖）。
      - **`timeFilter` 三个 case 的断言技巧**：把 `mocks.answer.confirm` 置 `false`，只走到确认弹窗、**不真正执行同步**，于是能干净地断言弹窗文案（`🔮 时间筛选：预告/未来动漫（无开播日期）` / `📅 时间筛选：2025年全年` / `📅 时间筛选：2026年7月`），再另加一条真跑同步的用例断言第 6 个实参 `{enabled:true, year:2026, range:'month', month:7}`。
    - **本轮新踩的坑（已写进 `REF-testing.md`）**：① **`coverage-summary.json` 的 `lines` 指标不能由 `coverage-final.json` 的 `statementMap` 推导** —— 求和 statement 行区间会把 `clean-engine.ts` 算成 531 行（summary 是 316）；行口径要**用 `istanbul-lib-coverage` 的 `getLineCoverage()` 复刻**（本轮新增 `.workbuddy/tmp-lines.mjs`，读 `coverage-final.json` → 精确列出未覆盖行号，与台账数字**逐行吻合**），`coverage-final.json` 只用来定位哪些 statement / function / branch 计数为 0。② 跑覆盖率复核**必须**带 `--config vitest.cov.config.ts`（`clean:false`）+ `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=1000000`，否则收尾 `V8CoverageProvider.cleanAfterRun` 会撞 safe-delete 守卫并让进程 exit 1。③ 一批新用例写完后**先跑 `npx eslint <files>` 再跑 `tsc`**：本轮 lint 报了 11 处（`unicorn/name-replacements` 把 `prevX` / `tempRule` 判为应写全 `previousX` / `temporaryRule`、`@typescript-eslint/no-unsafe-return` 在 `mock.calls.map(call => call[1])` 上、`no-unnecessary-type-assertion` 在 `new Proxy(doc, …) as Document` 上、`unicorn/consistent-function-scoping` 要求把 `mountSelectWithOption` 提到模块级）。
    - **全项目**：94.87% → **95.33% lines**（未覆盖 687 → **626**，吃掉 **61 行** —— 三文件台账合计 60 行，多出的 1 行来自 `action-handlers.test.ts` 新增用例顺带打到的相邻模块）；测试 3944 → **3999 条**（文件数仍 120）；`npm run gate` 七关全绿。

**第 15 批 · P1 其余 7 文件（2026-09-15 第十三轮，已完成）**

26. ~~`ts/panel/enrich-page.ts`（78 行 / 88.21%）、`ts/panel/panel-page.ts`（78 行 / 1.28%）、`ts/ui/handlers/github-settings.ts`（58 行 / 41.23%）、`ts/ui/message.ts`（32 行 / 3.12%）、`ts/ui/github-config-dialog.ts`（19 行 / 0%）、`ts/panel/clean-bootstrap.ts`（17 行 / 0%）、`ts/ui/handlers/module-order.ts`（6 行 / 95.45%）~~ ✅ **7 个文件全部 100% lines**（2026-09-15，就地扩写 3 个既有文件 + 新建 4 个测试文件，合计 **+116 条**；P1 档至此清空）：
    - **`enrich-page.ts`**：88.21% → **100% lines**（78 → 0，49 → 68 条）。这是本批最大的一块，78 行分散在十来个流程块的早退/catch 分支上，逐块补：
      - **绑定路由**：`workbookSelect` 的 change（取消兜底重试 + 刷新表列表 + 同步锁定按钮）、`viewEnrichDetailBtn`。
      - **`refreshSheets` 的 `queueMicrotask(previewMatch)`**：需要 `await vi.waitFor(...)` 让出微任务；**坑**：刷新按钮会先跑 `selectTargetSheet()`，它读「工作簿下拉 + 活动工作簿」，两者都拿不到时会把 `state.bangumiSheet` **清空**，于是后面的 `animeSourceSheet && bangumiSheet && columnMapping` 守卫直接不成立 —— 必须先 `stubApp` 给出活动工作簿。
      - **`selectTargetSheet`**：空值分支（jsdom 里 `select.value = ''` 会被静默丢弃，**必须显式造一个空 `<option>`**）、`Worksheets.Item` 抛错 → `applyTargetSheet(null)` + `handleError`。
      - **`refreshWorkbookList` 已锁定**：回填 `lockedWorkbookName` 到下拉框（要先把默认选项换成别的值，否则断言恒真）。
      - **`autoDetectHeaderFromFile`**：切换源工作簿时先回收上一个、文件无工作表且由本插件打开 → 回收 + 提示。
      - **`mergeSelectedPaths`**：多选结果含已选文件 → 跳过重复项（区别于回退路径那条同义日志）。
      - **`selectNewAnimeFile` 外层 catch**：`getApp` 抛错时，`pickFilesWithMultiSelect` 内部会先吞掉一次（触发回退），**回退路径里的第二次 `getApp`** 才冒到外层 catch。
      - **`renderEnrichSummary` catch**：`getOrCreateEnrichRecordSheet` 抛错 → INFO 级 `handleError`，富化结果不受影响。
      - **`autoAddOpenAnimeWorkbooks`**：added > 0 的完整链路（加入列表 + `showAutoDetectNotice` + 单文件自动识别）与 added === 0 的静默返回；`collectDetectedWorkbookPaths` 抛错时**两个检查点各自兜底**（`autoAddOpenAnimeWorkbooks` 与 `checkBangumiAutoDetectRecords`）。
      - **`batchRemoveFile`**：列表移除按钮 → 删除 + `filePath` 跟随首位；由多文件移除到只剩一个 → 补跑一次 `maybeAutoDetectSingleFile`。
      - **批量边界**：布局命中但 `columnMapping.nameCol === 0` → 标记错误且**不进入匹配**；`wb.Close()` 抛错 → WARN 但不影响该文件结果；`createInlineProgress` 的「停止」回调 → 置位 `batchCancelRequested` 并按停止收尾；批量模式刻意不回调进度。
      - **模块级轮询状态另立文件**：`enrichWatchTimer` / `enrichWatchRetriesLeft` 是 **`enrich-page.ts` 的模块级状态** —— 前者让 `startEnrichWorkbookWatch` 幂等，后者**只递减、永不回补**，而本文件里任何一次 `select` 的 change 都会把它清零。因此 `recheckEnrichTarget` / `takeRecheckReason` / `pollOnce` / `stopEnrichWorkbookWatch` 这 29 行无法在 `enrich-page.test.ts` 里稳定复现，单独建 **`tests/enrich-page-watch.test.ts`**（8 条），每条用例先 `vi.resetModules()` 取一份全新注册表（`state` 也必须从新注册表里取，不能用顶层静态 import），再捕获 `window.setInterval` 的回调手动驱动。
      - **顺手修正两条名不副实的既有用例**：`refreshSheets → 未锁定时走自动选择并联动预览匹配` 实际没断言 `previewMatch`（已改名）；`lockSheetBtn → 解锁后…` 因为 `toggleEnrichWorkbookLock` 是 mock、`isLocked` 根本没被翻成 `false`，走的其实是**锁定**分支（已改成真的翻 `false`，这才覆盖到解锁分支）。
    - **`panel-page.ts`**：1.28% → **100% lines**（78 → 0，新建 `tests/panel-page.test.ts` 23 条）。四组依赖全 mock（barrel 里放一个**可变的** `stubs.bgm.sheet`，便于逐用例翻 `isLocked` / `lockedIndex`）。覆盖 `window` 桥接契约（`initPanelCore` / `refreshPanelUI` 的 descriptor 必须 `writable + configurable`）、`initPanel` 的 `readyState === 'complete'` 立即执行 / 非 complete 挂 `load` / 抛错 → `handleError` **且仍然广播 `bgm:modulesReady`**（否则按钮永远停在禁用态）/ 无 `document` 的同步分支、`initPanelCore` 的 WPS 枚举注入（仅缺失时）+ 用户信息恢复 + 锁定表恢复 + `setTimeout(…, 0)` 延后扫描 + 四条自动检测分支 + 全部事件绑定（含 `beforeunload` 摘掉 keydown 监听 —— 用「再按一次 Escape」反证）。
      - **两个坑**：① jsdom 的 `select.value` 静默丢弃（同上），需要 `addOptions(id, ...values)` 预置选项；② `vi.stubGlobal('document', undefined)` 让 `typeof document === 'undefined'` 成立，但紧接着的 `document.getElementById` 抛的是 **`TypeError` 而不是 `ReferenceError`**。
    - **`github-settings.ts`**：41.23% → **100% lines**（58 → 0，新建 `tests/github-settings.test.ts` 25 条）。刻意使用**真实** `debounce` + **真实** `trackedAddEventListener`，让「input → 300ms → 落盘」端到端可观测。覆盖 `toggleSourceFields` 三种来源类型 + 容器缺失、`saveGithubConfigFromDom`（trim、`branch` 兜底 `main`、必填缺失跳过、local 读 `localFilePath` 而非 `githubPath`、任一 setter 返回 false 则不打成功日志）、`debouncedSaveGithubConfig`（300ms / 合并 / 抛错 → WARN）、`refreshGithubConfigInputs`、`loadGithubConfigIntoForm`（含「配置为空时不打已加载日志」与 change → 立即切换可见性 + 防抖保存）。
    - **`message.ts`**：3.12% → **100% lines**（32 → 0，新建 `tests/message.test.ts` 18 条）。覆盖重复 `initMessageListener` 会**摘掉旧 listener**（否则一条消息触发两次动作）、origin 白名单（`https://evil.example.com` 静默丢弃、`https://bgm.tv` 与自身 origin 放行、缺 `type` 丢弃）、5 种消息类型 + `default` → WARN、`setStatus` 写 `#statusBox`（`status info` 类名）/ 显式类型 / 回退 `#statusDisplay` / 两者都缺时静默返回。
    - **`github-config-dialog.ts`**：0% → **100% lines**（19 → 0，新建 `tests/github-config-dialog.test.ts` 12 条）。**同时修掉一处真实的生产漏洞**：该文件自己实现的 `escapeHtml` 只做 `textContent → innerHTML`（转义 `< > &`，**不转义引号**），却被拼进 `title="${escapeHtml(url)}"` —— 攻击者可控的 `"` 能闭合属性并注入新属性。先跑探针确认 jsdom 行为（`innerHTML` 实测得到 `x" onmouseover="alert(1)`，引号确实未转义），再删掉本地实现、改用 `tools/string-utilities-pure.ts` 里的规范 `escapeHtml`（它额外做 `.replace(/"/g,'&quot;').replace(/'/g,'&#39;')`）。`ts/ui/` 引 `ts/tools/` 属合规方向，`check:cycles` 的分层约束不受影响；因该文件可执行行 19 → 16，全项目总行数也由 13411 降到 13408。断言用 `getAttributeNames()` 确认只多出 `title`、`childElementCount === 0`、`<img>` / `<script>` 未被创建。
      - **坑**：`.detail-value` 这个 span 自带 `class`，所以 `getAttributeNames()` 是 `['class','title']`；另外**文本节点里的裸引号是合法的**（文本上下文不解析属性），断言不能写成「innerHTML 不含 `onmouseover="`」，要精确匹配转义后的 `title="…&quot;…"` 子串。
    - **`clean-bootstrap.ts`**：0% → **100% lines**（17 → 0，扩写既有 `tests/panel-bootstrap.test.ts` 17 → 22 条）。覆盖 import 时禁用按钮、`bgm:modulesReady` 启用 + `[BGM Clean] 模块加载完成，按钮已启用`、ready 后 `initCleanPage` + `startNavModeSync` + `startNavOrderSync('clean')` + `startModuleStateSync('clean')`、`readyState === 'loading'` 延后到 `DOMContentLoaded`、以及「不安装主题 / 壳层导航」的反向断言。
    - **`module-order.ts`**：95.45% → **100% lines**（6 → 0，扩写既有 `tests/module-order.test.ts` 25 → 30 条）。覆盖恢复默认顺序写盘失败（`mockSetConfig` 返回 `false` 的唯一可达路径，用 `vi.hoisted` 里一个可控开关驱动）、`dragstart` 写 `setData('text/plain', …)` + `effectAllowed = 'move'`、`dragover` 清掉上一个落点高亮、`drop` 源 id 不在顺序里 → `调整顺序失败`、`beforeunload` 清掉 2s 轮询定时器。
      - **行口径注意**：该文件 `uncovered stmts` 里仍有 12 条零计数（如 `if (!modules || modules.length === 0) return ''` 的 `return`），但**这些行都算已覆盖**（同行的 IfStatement 每轮都求值）—— 见本文档开头「行口径陷阱」。
    - **全项目**：95.33% → **97.45% lines**（未覆盖 626 → **341**，吃掉 **285 行**；7 个文件台账合计 288 行，其中 `github-config-dialog.ts` 因生产修复少了 3 行可执行行，288 − 3 = 285 **精确吻合**）；stmts 94.54% → 96.68%、branch 85.25% → 87.57%、funcs 95.00% → 97.19%；测试 3999 → **4115 条 / 125 文件**。
    - **本轮新踩的坑（已写进 `REF-testing.md` / `REF-eslint-tests.md`）**：
      ① **`npx eslint <dir> --fix` 会删掉它判定为「未使用」的 `eslint-disable-next-line` 注释** —— 本轮对 `tests/` 整目录跑 `--fix`，把 `github-sync-core.test.ts` / `sheet.test.ts` / `utility.test.ts` 里三条 `// eslint-disable-next-line unicorn/no-unused-properties -- 预留测试选项…` 抹掉了，于是三个**与本批无关**的文件凭空冒出 7 个 error（`git checkout --` 已还原）。**结论：`--fix` 只对本轮改动的那几个文件跑，别扫目录。**
      ② 只给 `--coverage.reporter=json` 时 `coverage-summary.json` **不会重写**，`calc-coverage-lines.mjs` 里 `summary lines` 那一行会读到上一次的陈旧值（`uncovered lines` 仍准确）—— 两个 reporter 都要给。
      ③ 本批 lint 又撞到 `unicorn/consistent-boolean-name`（`confirmed` → `isConfirmed`、`writeShouldFail` → `isWriteShouldFail`）、`unicorn/no-non-function-verb-prefix`（`removeButtons` / `setDataCalls` 这类以动词开头的**数组变量**要改名）、`unicorn/no-return-array-push`（`() => arr.push(x)` 隐式返回 push 的返回值，要改成块体）、`@typescript-eslint/no-unnecessary-condition`（参数已声明 `{ name?: string }` 时 `detector?.name` 的可选链多余）。

**第 17 批 · P2 七个难-COM/网络文件（2026-09-15 第十四轮，已完成）**

用户指令：`完成待办清单的全部`（`文档/待办任务清单.md`）。本批把 §三 剩下的 7 个「难-COM/网络」文件**一次吃完**，全部 **100% lines**，实测 **341 → 46（−295 行，与台账 295 行精确吻合）**，全项目 lines **97.45% → 99.65%**。

**先扫依赖的结论（延续第 8/10 批的证伪）**：7 个文件**没有一个**是 `entry/**` / `*-bootstrap.ts` 那类真 COM 装配脚本 —— 依赖全部收敛到 1~3 个薄叶子（`tools/util/index.js` barrel、`sync/sync-record.js`、`exceltobangumi/{api,chapter-marker}.js`、`tools/locked-sheet.js`、`sync/enrich-engine.js`），因此**全部就地测**，无一项需要降级为人工验收。

- **`ts/sync/exceltobangumi/index.ts`**：74.62% → **100% lines**（137 → 0）。本批最大的一块（1556 行）。扩写既有 `tests/exceltobangumi.selection.test.ts`（39 → **70 条**，未新建文件），新增两个 describe：`executeSelectedSync 执行链路`（15 条，走 `syncSelectedRows` 选区链路）与 `批量链路补测`（14 条，走 `SyncToBangumiAsync` 批量链路）。剩下 6 类零散分支逐条打通：
  - **`createFieldGetter` 批量缓存命中**（167-169）：`mockReadRangeValues` 返回非空二维数组（下标 i 对应第 i+1 列），同时 `mockGetCellValue` 一律返回空串 —— 若走了逐格回退就必然拿不到 URL、产生不了任务，反过来证明命中的是缓存。
  - **增量指纹一致跳过**（440）：`getAllSyncRecords` 给 `{ sid: '1', fingerprint: 'fp-1' }`、`calcFingerprint` 恒返 `'fp-1'`、URL 取 `subject/1` → `storedFingerprint === currentFingerprint` 成立，整批 `skip` 且不发请求。
  - **最小请求间隔节流**（627）：造 **7 个可见行 → 6 个任务**，`DEFAULT_CONCURRENCY = 5` → 恰好两批；再用 `vi.spyOn(Date, 'now').mockReturnValue(5_000_000)` 让第二批 `elapsed === 0`，`delay(100)` 必然被调用（try/finally 里 `mockRestore()`）。顺带把 `delay: vi.fn()`（匿名）改成 hoisted 命名 mock `mockDelay` 才能断言。
  - **`jsonBody` 解析失败降级**（1107）：`buildJsonPayload` 的出口是 `JSON.stringify(payload)`，**产出永远是合法 JSON**，所以只能 `vi.spyOn(JSON, 'parse').mockImplementation(() => { throw new SyntaxError('请求体损坏') })`（沿用 `tests/gist-sync.test.ts:686` 的先例 + try/finally 还原）；断言 `watchType` 回落为 0 → 走「非看过/在看 → 跳过章节标记」。
  - **无法提取 Subject ID**（1154-1159）：用 `'123456789'`（9 位纯数字）—— `isBangumiUrl` 的 `/^\d+$/` 放行、`extractSubjectId` 的 `/^\d{1,8}$/` 拒绝，这是**唯一**能同时满足「过了 URL 校验」又「拿不到 SID」的输入形态。
  - **`visibleCells.Areas` 缺失**（1418）：给 `createVisibleCells` / `createWorksheet` 加 `missingAreas` 开关（`Areas` getter 返回 `undefined`，区别于原有的 `throwOnAreas`）→ 走 `areas.push(visibleCells)` 的单区间降级，且**不**触发 `handleError`。
  - **顺带清掉上一轮遗留的 3 类 lint 错误**（该文件上一轮只跑了 vitest、没跑 eslint）：`prefer-destructuring`（`const cellValue = options.cellValue` → `const { cellValue } = options`）、两处 `unicorn/consistent-function-scoping`（`fullCellValue` / `batchCellValue` 提到模块作用域，与既有 `setupExecution` / `progressHandlers` 同层）、两处 `@typescript-eslint/no-unsafe-assignment`（`expect.objectContaining({ context: expect.stringContaining('…') })` 里嵌套 matcher 返回 `any` → 改成精确字符串 `'SyncToBangumiAsync:preprocess'` / `'SyncToBangumiAsync:createSheet'`，断言反而更强）。
- **`ts/sync/workbook-auto-detect.ts`**：59.17% → **100% lines**（69 → 0）。新建 `tests/workbook-auto-detect-scan.test.ts`（**35 条**）+ 扩写 `tests/workbook-auto-detect.test.ts`（+4 条 `monthLabelFromWorkbookName`）。三个依赖全 mock（`tools/util/index.js` 的 `getApp` 改为读 `Reflect.get(globalThis, 'Application')`、`tools/locked-sheet.js`、`sync/enrich-engine.js`）。
  - **模块级一次性标志**：`isEventsRegistered` 只在首次 `initWorkbookAutoDetection` 时置位 → 每条用例必须 `vi.resetModules()` + 动态 `import()` 取全新模块实例（顶层静态 import 在 reset 之后就是陈旧单例）。
  - **踩坑**：断言持久化结果时误比较了**原始存储字符串**（`'["C:\\新番表.xlsx"]'`，反斜杠已被 JSON 转义）→ 4 条断言全红。改为统一通过 `autoDetect.loadDetectedPaths(...)` 取**解析后**的路径数组；「不重复记录」那条要把 storage 预置成已记录状态。
  - **踩坑**：`unicorn/name-replacements` 会把 `mod` 判成需改写为 `module_` → 变量统一改名 `autoDetect`（44 处）；`unicorn/consistent-function-scoping` 要求把 `setupEvents` 提到模块作用域。
- **`ts/sync/exceltobangumi/chapter-marker.ts`**：0% → **100% lines**（40 → 0）。新建 `tests/chapter-marker.test.ts`（**15 条**，`// @vitest-environment jsdom`，可编程 `FakeXhr` 类沿用 `exceltobangumi.api.test.ts` 的成员形状）。
  - **本批最耗时的坑**：`markEpisodesComplete` **内部自己会调 `fetchEpisodeIds`**，而后者会创建**属于它自己的** `FakeXhr`。最初的 `primeEpisodeIds()` 辅助函数驱动的是**另一个** XHR（对应另一个 Promise），于是内部的 `await` 永不 settle → **5 条用例各 5000ms 超时**。修法是反过来：**先启动 `markEpisodesComplete`，再取 `latestXhr()` 驱动**（Promise executor 同步执行，函数返回时内部 XHR 必然已构造）→ 15 条用例 **18ms** 跑完。
- **`ts/sync/github-sync.ts`**：96% → **100% lines**（26 → 0）。扩写 `tests/github-sync.test.ts`（165 → **168 条**），新增 `describe('applyDiffToSheet 批量更新回退 / 写入阶段取消 / 同步记录告警')` + 一个 `asThrowingRowRangeMock()` 模块级辅助（`Value2` setter 抛错、`get` 返回 `[['']]`）。
  - **踩坑**：非 `writeAll` 的更新把远程**名称**追加到**「别名」列**（`safeAppend`），colMap 里只给「名称」时 `safeAppend` 会在 `if (!col) return` 处直接返回 → `attempted = false` → 走「没有写入需要尝试 → 视为成功」，**回退分支根本测不到**。新 describe 的 `beforeEach` 必须同时映射 `['名称', 2]` 与 `['别名', 3]`。（定位手段：`-t` 单跑通过 / 整文件失败 → 顺序依赖；再 `console.log` 探针打出真实 colMap 与 `result`。）
  - **口径**：`batchUpdateRows` 返回 0 时调用方按 `batch.length - batchUpdated` 记失败，所以「无值可写」应断言 `updated 0 / failed 1`（不是 `failed 0`）。
  - **`typecheck:tests` 是独立一关**：顺带修掉 `tests/github-sync-diff.test.ts` 两处 `SyncTimeFilter` 缺 `year` 的 `tsc` 报错 —— **vitest 跑得通、`tsc` 才报**，别只看 vitest。
- **`ts/sync/sync-record.ts`**（96.58% → **100%**，13 → 0）/ **`ts/sync/enrich-lock.ts`**（96.75% → **100%**，5 → 0）/ **`ts/sync/github-sync-diff.ts`**（96.73% → **100%**，5 → 0）：就地扩写既有测试文件，复用既有假宿主，未新建基础设施。
- **全项目**：97.45% → **99.65% lines**（未覆盖 341 → **46**，吃掉 **295 行**）；stmts 96.68% → **98.86%**、branch 87.57% → **89.80%**、funcs 97.19% → **99.06%**；测试 4115 → **4226 条 / 127 文件**。
- **本轮新踩的坑（已写进 `REF-testing.md` / `REF-eslint-tests.md`）**：
  ① **被测函数内部自建 XHR 时，「先 prime 再调用」是错的** —— 必须「先调用、再取 `latestXhr()` 驱动」，否则内部 `await` 永不 settle、表现为 5s 超时。
  ② **非 `writeAll` 的更新写「别名」列而非「名称」列** —— colMap 少一列会**静默**走「成功」路径，测试看起来绿、实际没测到回退。
  ③ `buildJsonPayload` 产出恒为合法 JSON → 想覆盖 `JSON.parse` 的 catch 只能 spy 内建 `JSON.parse`（配 try/finally 还原）。
  ④ `isBangumiUrl`（`/^\d+$/`）与 `extractSubjectId`（`/^\d{1,8}$/`）**校验强度不一致**，9 位纯数字是唯一能命中「无法提取 Subject ID」的输入。
  ⑤ **节流分支（`elapsed < MIN_REQUEST_INTERVAL`）必须造出第二个并发批次 + 固定 `Date.now`** —— 同一批内所有任务都在写 `lastRequestTime` **之前**就各自算完了 `elapsed`，只加任务数是打不到的。
  ⑥ 模块级一次性标志（`isEventsRegistered`）→ `vi.resetModules()` + 动态 `import()`；`vi.hoisted` 里的命名 mock 必须**先声明再被 `vi.mock` 工厂引用**（漏了声明就是 `ReferenceError: xxx is not defined`，且报错指向被 mock 的模块而非测试文件）。

**§6 非补测待办 O-2 · 锁表查找加索引快路径（2026-09-15 第十五轮，已完成）**

本批是**清单清空后的收尾优化**，不增加覆盖率（`locked-sheet.ts` 本就是 100% lines），目标是消除 `getLockedSheet()` 的**线性扫描成本**。

- **问题**：`getLockedSheet()` 每次调用都要 `wb.Worksheets.Item(1..N)` 逐张比 `Name`，而它在同步链路里被高频调用（每个条目、每个面板刷新都可能走）—— N 张表就是 N 次 COM 往返，跨进程 COM 单次往返在毫秒量级，大工作簿下累积明显。
- **方案（关键取舍）**：**不引入模块级缓存变量**。模块级缓存会带来两个麻烦：① 同一测试文件内的用例互相污染，每条用例都得 `vi.resetModules()` + 动态 `import()`；② 需要在**四个**写锁点（`initEnrichLock` / 面板切表 / 清锁 / 工作簿切换）挂失效钩子，漏一个就是「锁的是 A 表、实际去操作 B 表」的静默错。
  改为**复用锁状态里已经在维护的 `BGM.sheet.lockedIndex`**：它是 `{ isLocked, lockedWorkbookName, lockedName, lockedIndex }` 的一部分，**缓存键就是锁状态本身** —— 任何一次写锁都会顺带改写索引，**天然失效，零钩子**。
- **实现**：抽出 `resolveSheetInWorkbook(wb, sheetName, hintIndex)`：`hintIndex != null` 时先 `readSheetAtIndex(wb, hintIndex)`（`try/catch` 吞越界与宿主切表异常），**必须 `hinted?.Name === sheetName` 复核通过**才直接返回；否则回落原有全表扫描。索引只是**提示、不是真相**，所以行为与改造前逐字节等价。
  `findSheetInWorkbook(wbName, sheetName)` 改为复用同一函数并传 `hintIndex = null`（按名查表的调用方没有索引可用），顺手删掉一份重复的扫描逻辑。
- **顺带修掉**：`for (let index = 1; index <= wb.Worksheets.Count; index += 1)` —— `Count` 是 COM 属性，写在循环条件里**每轮都要读一次**，已提前取出为 `const sheetCount`。
- **测试**（`tests/enrich-lock.test.ts` 71 → **76 条**，新增 `场景 13`）：**断言的是 `Worksheets.Item` 的调用次数**，因为「少几次 COM 往返」正是优化的全部意义，只断言返回的表名对是测不出退化的（改造前后都会返回同一张表）。用 `vi.spyOn(wb.Worksheets, 'Item')` 计数，5 条覆盖：
  ① 命中 → `toHaveBeenCalledTimes(1)` 且参数为索引；② 提示过期（索引指向别的表）→ 复核失败、回落扫描（2 次）；③ 索引越界（`lockedIndex = 99`，桩抛 `RangeError`）→ 吞异常后回落；④ 提示过期且目标表已不存在 → 仍按原语义清锁；⑤ 只有索引没有名字 → 复核挡住、不误命中。
- **口径**：可执行行 13408 → **13411**（+3），`locked-sheet.ts` 154 → **183 可执行行**，覆盖率维持 **100% lines**；项目未覆盖行 **46 不变**，lines 维持 **99.65%**（分母变大、分子同增）。
- **本轮新踩的坑（已写进 `REF-testing.md`）**：
  ① **「用索引当提示」优于「模块级缓存」的判据**：缓存失效点分散在多个写入口时，优先找**已经是状态一部分的字段**做 hint —— 缓存键 == 状态 → 不需要任何失效钩子。
  ② 测试**性能优化**要断言**调用次数**，不能只断言结果 —— 结果在优化前后相同，只有计数能证伪退化。

**第 18 批 · 长尾清零（2026-09-15 第十六轮，已完成）**

> 承接第十四轮后残留的 **46 行长尾**（单文件 ≤3 行、摊在二十多个文件里）。本轮**不新增文件级目标**，
> 而是按目录分 A/B/C/D 四组，把「读得懂、测得出」的零头逐条吃掉。**动机**：把 lines 做成**二值不变量** ——
> 一旦全项目 lines 触到 100%，此后覆盖率报告里**出现的任何一行未覆盖都等于一次真实回归**，
> 比「99.65% 这种带小数点的指标」可读得多。

18. ~~46 行长尾~~ ✅ **一次吃到 7 行**（−39 行；未覆盖文件 → **5 个**；全项目 lines **99.65% → 99.94%**）：
    - **A 组 `ts/tools/` + `ts/core/`（7 文件）**：`http.ts`（`retries: -1` 使 `while` 不进入 → 落到循环后的 `MAX_RETRIES_EXCEEDED`，**该出口此前被判「不可达」是误判**）、`debounce.ts`（`throttle` 的 `clearTimeout` 清理）、`theme.ts`（模块级 `systemMedia` 的 change 分支，见下）、`jsonl-response.ts`（`DecompressionStream` 缺失降级）、`export-jsonl.ts`（10s 后才 `revokeObjectURL`）、`local-file-sync.ts`（解码失败 + **非 Error 抛值**包装）、`token-payload.ts`（`extractToken` 的 catch）。
    - **B 组 `ts/sync/`（7 文件）**：`github-config.ts`（旧路径自愈 + 回写持久化）、`github-cell-value.ts`（扩展字段值类型兜底：`undefined` / `null` / boolean / 数字）、`sync-config-summary.ts`（**新建** `tests/sync-config-summary.test.ts`，11 条覆盖 `timeFilter.range` 四分支 `future` / `year` / `quarter` / `month`）、`clean-transforms.ts`（2 字节 UTF-8 分支 + `normalizeOriginalTag` 自定义改编优先）、`events.ts`、`nav-mode.ts`、`nav-order.ts`。
    - **C 组 `ts/panel/` + `ts/services/`（5 文件）**：`enrich-page-state.ts`（`getConfig` 抛错 → 整体回落出厂默认，即 `isToggleEnabled` 的 fail-open）、`enrich-preview-cell.ts`（阈值回落 1 / 12 后仍能渲染）、`config-service.ts`（`applyPreferences` 走**真实** `tools/config.ts#setConfig`，靠 `vi.stubGlobal('window', { Application: { PluginStorage: 假存储 } })` 提供真存储，断言只写白名单内的字符串键）、`enrich-engine.ts`、`ribbon-service.ts`（`testTokenForRibbon` 两条 `wpsMessageBox` 拒绝路径）。
    - **D 组 `ts/ui/`（6 文件）**：`dialog.ts`（`readyState === 'loading'` → 挂 `DOMContentLoaded` 而非 `setTimeout`）、`preview.ts`（优先状态在前 / 「忽略」在后 + `getAllSyncRecords` 非函数守卫）、`sync-result-dialog.ts`（无 ESC handler 时安全早退）、`progress.ts`（可见时点 `stopBtn` → `onStop`；`appendProgressLog` / `completeProgress` 两个全局入口）、`enrich-preview-settings.ts`（`setConfig` 抛错 → `handleError` 且不弹成功提示）、`token.ts`（见下表，不可达）。
    - **三条可复用的判定（已写进 `REF-testing.md`）**：
      ① **`getLineCoverage()` 取「该行所有语句的最大命中数」** —— `if (cond) return X` 这类一行两语句会被算作**已覆盖**，残余只体现在 `uncovered stmts`。所以「某行从未执行」**不等于**「该行会出现在 `uncovered lines` 里」，两个口径要分清（也是「不能用 `statementMap` 行区间求和」的同一件事）。
      ② **`vi.mock` 工厂里的 getter 能让「静态 import 绑定恒为函数」的守卫变可达** —— 第 8 批把 `preview.ts` 的 `typeof getAllSyncRecords !== 'function'` 记为不可达（理由：静态 import 绑定恒为函数），本轮用 `get getX() { return mocks.getX }` 的工厂 + `Reflect.set(mocks, 'getX', undefined)` 打通。**判「不可达」之前，先确认这条依赖能不能被 mock 改写**。
      ③ **假时钟与定时器队列是两件事**：`vi.setSystemTime(0)` 排下定时器后再 `vi.setSystemTime(1000)`，可造出「`remaining <= 0` 且 `timerId !== null`」这个**唯一**能命中 `throttle` 里 `clearTimeout` 清理的状态（用 `vi.getTimerCount()` 断言）。
    - **残留 7 行：全部经可达性分析判定为不可达 / 死代码，按既有判据不造假测**（延续「不追」口径）：

      | 文件:行 | 判定依据 |
      | --- | --- |
      | `ts/sync/enrich-engine.ts:632,633,639` | `matchEntriesInner` 每行的 `try` 体里只做 Map / 数组操作，容器由 `buildBangumiIndexes` 内部构造（值恒为 `number[]`）；`normalizeName()` / `getCellValue()` 都在 `try` **之外**调用 → 该 `catch` 不可达 |
      | `ts/panel/enrich-preview-cell.ts:48` | `CHIP_COLOR_PALETTE` 12 项全非空，`stableColorIndex()` 返回 `hash % length`（恒在范围内），且表达式已有 `?? CHIP_COLOR_PALETTE[0]` → `!palette` 恒假，属**死代码** |
      | `ts/services/config-service.ts:203` | `GithubConfigSchema.strategy` 是 `SyncStrategySchema.optional().default('add-update')`，zod 已把值收敛到合法枚举 → `else` 兜底不可达 |
      | `ts/ui/handlers/token.ts:720` | 外层 `if (avatarUrl \|\| username)`（654 行）已蕴含内层 `if (username \|\| userId \|\| avatarUrl)`（698 行），且两个变量都是 `const` 解构、区间内无重赋值 → `else` 不可达 |
      | `ts/ui/preview.ts:528` | 排序比较器：`dataset.status` 恒为 `normalizeStatus()` 的产物，只可能是 `WATCH_STATUS_MAP` 反查出的 **6 个**标准名；其中 5 个已在 `priorityStatus` 里，非优先集合最多只剩「忽略」**一个**元素，而 `Array#sort` 对长度 ≤1 **不调用比较器**（第 8 批已记录，本批复核确认） |

    - **口径**：可执行行 **13411 不变**（**零生产代码改动**，只有测试与文档）；测试 **4231 → 4283 条 / 127 → 129 文件**；`npm run gate` 七关全绿。
    - **本轮新踩的坑（已补进 `REF-eslint-tests.md`）**：4 个新写的测试文件在 `lint:check`（gate **第一关**）一次性爆出 **10 个 error** ——
      `unicorn/no-return-array-push`（箭头函数体直接返回 `.push()` 的返回值）、`unicorn/numeric-separators-style`（4 位数 `9_999` **不许**加分隔符）、
      `@stylistic/line-comment-position`（行尾注释）、`@typescript-eslint/array-type`（`Array<T>` → `T[]`）、
      `n/no-top-level-await`（顶层 `await import()`）。**写测试文件后先对本文件单独 `npx eslint <file>` 过一遍**，别等全量 gate。

## 四、门禁现状

`vitest.config.ts` 的全局阈值（2026-09-13 上调）：
`statements 40 / branches 35 / functions 45 / lines 40`（`perFile: false`）。

留 5~8 个点安全余量，只拦真实回归。

> ⚠️ **已知无效配置**：`perFile: false` 下 vitest 的「glob 单文件阈值」**不会被检查**（实测把某文件阈值改成 101 也不报错）。
> 想给单个文件（如 `module-state.ts`）锁 100%，只能靠测试本身维持，**不要写进 thresholds 假装它有保护**。

