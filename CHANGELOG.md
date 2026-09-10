# 更新日志（CHANGELOG）

> 本文件按「内部功能版本」记录重大变更。注意：`package.json` 中的 `version` 字段（当前 `1.0.0`）为 npm 包发布版本，与本文档的 `v3.x` 内部功能版本相互独立，二者不要求一致。

本文档与 [`文档/USER_OPERATIONS.md`](文档/USER_OPERATIONS.md)（用户手册版本历史）、[`文档/ARCHITECTURE.md`](文档/ARCHITECTURE.md)（架构文档版本历史）互为补充：架构级变更以架构文档为准，操作级变更以用户手册为准，本文件提供跨文档的总览索引。

---

## [未发布]

### 新增（工程化 · `tests/` 类型门禁 `npm run typecheck:tests`）

- **问题**：`tests/tsconfig.json` 早已存在，但**没有任何脚本运行它** —— `tsc` 主门禁只覆盖 `ts/`，于是 `tests/` 里 **254 个类型错误**长期无人知晓。这些错误本身就是证据：mock 的形状与真实接口脱节、断言参数与签名不符，个别还指向生产代码的类型缺口（如 `GithubRemoteEntry` 缺 `desc`/`rating`、`SyncTimeFilter` 缺 `'week'`）。
- **做法（带基线，而不是一次要求 0）**：新增 `scripts/check-tests-types.mjs`，判定规则是「某文件错误数超过基线 / 基线外文件出现错误」即失败，错误数下降只提示可 `--update` 下调基线。理由：一次性修完 254 个会把门禁与重构绑死、风险集中；先把闸门关上防新增，再逐批清账，进度是单调可度量的。
- **实现坑**：脚本直接用本机 node 跑 `node_modules/typescript/bin/tsc`，不经 `npx`/shell —— Windows 下 `npx.cmd` 经 `execFileSync` 解析失败会抛错，若容错写成「拿不到输出就当 0 错误」，门禁会空转（实测踩到）。
- **批次一：254 → 125**。清除的全部是「mock 只实现被测路径访问到的成员」这一类，手法是把形状不完整**收敛到单点**：每个测试文件的 mock 工厂声明一个 `MockWorksheet` 类型并在工厂内做一次 `as unknown as`，调用点仍按真实接口 `WpsWorksheet` 校验（`Mock<T>` 携带 `T` 的调用签名，因此交集类型可双向使用）；配套 `createRangeMock` / `createCellItemMock` / `createMockWorkbook` / `createMockApp` helper。效果：`sheet.test.ts` 79→0、`cell.test.ts` 32→0、`sync-record.test.ts` 18→0。
  - 保留的逃逸点都写明理由：`asMalformedApp` / `malformedSheet`（用例本身就是验证「宿主返回 `null`/半成品」时的降级）、`{ ...createMockSheet(), Activate: undefined }` 这类刻意畸形构造。
- 剩余 125 个曾按「真实接口漂移 / 可空性 / 断言过窄 / 其他」四类写进审查报告 §3.2.1，逐批清账后下调基线。**后续三批：125 → 106 → 63 → 0，基线已归零**（每批一次提交、每批 `--update` 下调）：
  - **批次二（125 → 106）· 测试的全局装配断言**：`(globalThis as { XMLHttpRequest: typeof MockXHR }).XMLHttpRequest = X` 被判 TS2352 —— MockXHR 与 lib.dom 的构造函数形状不充分重叠，而 mock 的本意正是不兼容；改走 `Reflect.set`（运行时属性写入，与原写法语义完全一致）。`window.Application` 的读 / 写 / 删统一为 `Reflect.get` / `Reflect.set` / `Reflect.deleteProperty`，`workbook-auto-detect` 另加 `getMockApp()` 收敛取值。
  - **批次三（106 → 63）· github 同步测试族与生产接口对齐**：删掉测试虚构的 `remote.desc` / `rating`（`GithubRemoteEntry` 无此字段）、修正写错的 `ConflictResolution.choice` → `chosenValue`、补必填的 `changedFields`、`changedFields: new Set(['*'])` → `['*']`、修正 `getFilterStatus` 与 `syncFromGithub` 的参数错位、给 `createMockSource` 补 `getSourceType()`（生产接口演进后 mock 未跟上），并把 `validateConfig` 的自造 `{isFail, error}` 形状换成生产的 `Result.okVoid()`（原形状缺 `success`/`data`/`isOk`/`unwrap` 等 7 个成员）。
  - **批次四（63 → 0）· mock 基础设施**：① `sync-flow` 里 5 个无类型的 `vi.fn()` 被 TS 推断成「无参 / 返回 `never`」，`mockReturnValue` 因此连环报错 → 补显式签名；② vitest 的 `Mock<T>` 要求 `mockReturnValue` 收完整 `T`（参数逆变），于是「返回形状稍有不同的另一处赋值」被判不兼容 → 新增 `asRangeMock()` 单点收敛（17 处 `Range` 赋值）；③ `noUncheckedIndexedAccess` 下 18 处 `arr[0].x` 补 `?.`；④ `exceltobangumi` 的 `createMockWorksheet` 返回类型由 `unknown` 收敛为 `WpsWorksheet`，连带修正一处 `getFilterStatus` 的参数错位（漏传 `headerRow`，`false` 落在了 `headerRow` 上）。
- **清账顺带修出 1 处生产类型缺口**：`httpRequest` 的 `zodSchema` 原为 `ZodSchema<T>` —— 那是本地降级实现的形状（带 `[k: string]: any` 索引签名），而真实 zod 的 `ZodObject` 是类实例、没有索引签名，因此被它拒之门外；该函数实际只调用 `schema.parse()`。改为 `Pick<ZodSchema<T>, 'parse'>` 后，真实 zod 与本地降级实现都能传入。
- 取舍口径（详见审查报告 §3.2.1）：**刻意的越界输入不改生产类型** —— `range: 'week'/'invalid'`、`quarter: 5/99`、数字型 `话数` 都是覆盖防御分支的健壮性测试（生产确实有 `default → false`、`toExtensionStringValue` 的 `String(value)` 等分支），加显式断言 + 注释即可；**`vi.hoisted` 内不能引用 import 绑定**（vitest 会报 `Cannot access '__vi_import_N__' before initialization`），该处只能保留最小形状并注明原因。
- `npm run gate` 现在是五道关：`lint:check` → DOMPurify 版本一致 → 导入图（分层 + 致命环）→ tests 类型 → 全量测试。

### 重构（架构 · 消除分层反向依赖，P1-5）

- **问题**：`tools/`、`sync/` 等底层模块直接 `import` 上层的 `ui/dialog.ts` 来弹窗 / 报错 / 更新同步进度条，形成「底层 → 上层」的反向依赖，并在 barrel（`ts/index.ts`、`tools/util/index.ts`）参与下构成运行时循环。后果是模块初始化顺序敏感（本项目历史上踩过 barrel 顶层读到 `undefined` 的坑），底层模块也无法脱离 UI 独立测试。
- **做法（依赖反转）**：新增 `ts/core/ui-bridge.ts`，定义三个接口 —— `NotifyApi`（alert/confirm/error/success/toast/input）、`SyncProgressApi`（show/update/complete/hide）、`SyncRunner` —— 并提供 `registerXxx()` / `getXxx()`。**未注册时返回降级实现**（写一次告警日志后忽略，`confirm` 按「未确认」回调，避免调用方把默认值当作用户同意），而不是抛错或静默。
- **改动点**：5 处反向依赖全部改为走桥 —— `tools/util/index.ts`（对话框 + `BGM.sync.startSync` 的 `syncAllRows`）、`tools/wps.ts`（输入 / 确认 / 提示框）、`sync/exceltobangumi/api.ts`、`sync/exceltobangumi/index.ts`（Toast / 确认框 / 进度弹窗四件套）。实现方 `ui/dialog.ts`、`ui/preview.ts` 在模块求值时调用 `registerNotifyApi()` / `registerSyncProgressApi()` / `registerSyncRunner()`。
- **纯数据下沉**：`buildSyncConfig` / `SyncConfigSummary` / `BuildSyncConfigContext` → `ts/sync/sync-config-summary.ts`；`SyncProgressStats` → `ts/core/types.ts`。原位置保留 re-export，调用点零改动。
- **顺带修掉一个真实的初始化陷阱**：`ui/preview.ts` 顶层 `const VALID_STATUSES = new Set(Object.keys(WATCH_STATUS_MAP)...)` 此前经 barrel 导入该常量，构成「运行时环 + 顶层读取」的组合（初始化期可能拿到 `undefined`）。现改为直接从 `core/constants.ts` 导入 `BGM_COLOR` / `LOG_LEVELS` / `WATCH_STATUS_MAP`。
- 新增 `tests/ui-bridge.test.ts`（9 条）：未注册时的降级行为、注册后透传，以及**生产装配断言**（仅 `import ui/dialog.ts` / `ui/preview.ts` 即完成注册 —— 防止「忘了注册」导致通知与进度弹窗静默失效）。总计 1856 条全绿。

### 新增（工程化 · 导入图门禁 `npm run check:cycles`）

- 新增 `scripts/check-import-cycles.mjs`（基于 TypeScript AST，非正则），并纳入 `npm run gate`。核心是**两个区分**，否则满屏假阳性会淹没真问题：
  1. **运行时边 vs 类型边**：`import type` / `export type` 编译后没有对应 import 语句，不产生运行时依赖 —— 把类型边算成环是「本项目环很多」的主因。
  2. **致命环 vs 良性环**：ESM 的 import 是 live binding，环本身不必然出错；真正会炸的是**在模块顶层读取了环上另一模块的绑定**（对方 body 还没执行，拿到 `undefined`）。函数体内读取是安全的。
- 判定为错误（退出码 1）：① 分层反向依赖（底层 runtime-import 上层）；② 致命环（环 + 顶层读取）。良性环仅提示。当前状态：分层反向依赖 **0 处**、致命环 **0 个**、良性环 17 个（待后续拆除 barrel 自引用，属 P1-6 范畴）。

### 修复（安全 · 阻断级：运行时 HTML 的 data-* 属性被静默剥离）

- **同步弹窗与清理页的进度条在真实环境中必然抛错**：所有任务窗格（`ui/*.html`、`index.html`）都会先加载 `libs/purify.js`（DOMPurify 3.4.12 UMD），使 `sanitizeHtml` 走**严格白名单**路径；而白名单 `ALLOW_DATA_ATTR` 曾设为 `false` 且 `ALLOWED_ATTR` 只登记 5 个 `data-*`（`data-event/status/type/row/sid`），导致其余 `data-*` 属性被**静默剥离**。影响面：① `progress.ts` 模板 `data-el` 全丢 → `collectElements` 抛「进度组件缺少必需元素」；② `clean-page` 的 `data-workbook-key`/`data-sheet-name`/`data-group-toggle`/`data-group-all`/`data-group-none` 全丢 → **勾选不持久化、分组折叠与本簿全选失效**；③ `enrich-page` 的 `data-batch-remove`/`data-field`/`data-match-index` 全丢 → **批量删除、列映射、匹配跳转失效**。
- 根因修复：`ts/tools/sanitize.ts` 的 `ALLOW_DATA_ATTR` 改回 DOMPurify 默认值 `true`（`data-*` 不具可执行语义，非 URI、非事件、非脚本；标签白名单 / `on*` 清除 / `javascript:` 拦截等真正防线保持不变）。
- **该缺陷在 1835 条全绿测试下 100% 隐身**：jsdom 默认无 DOMPurify，`sanitizeHtml` 走「保留 `data-*`」的轻量降级路径，与生产路径属性行为不一致，且此前无任何测试覆盖生产路径。新增 `tests/progress.test.ts`（43 条）与 `tests/xss.test.ts`（+6 条），**显式注入 `dompurify@3.4.12`**（与 `libs/purify.js` 同版本）复现生产路径并锁死该类回归。

### 新增（UI 组件化 · 通用进度组件）

- 新增 `ts/ui/components/progress.ts`：统一状态机 + 三渲染模式（`modal` 全屏阻塞 / `inline` 页面内嵌 / `detach` 角落浮层），API 为 `showProgress`/`updateProgress`/`appendProgressLog`/`setProgressPaused`/`completeProgress`/`hideProgress`/`getActiveProgress`；含日志行数上限 500、ETA（单步 + 全局，扣除暂停时长）、`aria-live`/`role="progressbar"`、ESC 关闭与焦点恢复。
- 引擎侧 `onProgress(current, total, message)` 协议全库早已统一，**本次只替换渲染层，引擎零改动**。已接入：清理页（`inline` + 实时日志面板 + 完成态摘要）、同步弹窗（`modal`，`ts/ui/dialog.ts` 降级为兼容层，对外 API 与回调协议不变，`preview`/`handlers`/`ribbon-service` 零改动）。
- CSS 类名收敛：`bgm-sync-progress__*` → `bgm-progress__*`。

### 文档（项目审查）

- 新增 [`文档/TS_AUDIT_2026_09_10.md`](文档/TS_AUDIT_2026_09_10.md)：TypeScript 项目开发规范全面审查报告（结构审查 / 8 维度核查 / 29 项问题清单 / 优化建议 / 边界情况梳理 / 可执行验证方案）。

### 修复（数据清理 · 识别口径对齐「有表头 + Bangumi_URL」）

- **「剧集和小说」这类表被判为「非数据表」而无法默认清理**：此前清理页要求必须有归一化后的「名称」列（`colMap.has('名称')`），而同一份 Bangumi 数据在不同工作簿里列名并不统一（列名叫「剧集名 / 小说名」时不会归一化成「名称」）。现在判定改为**配置驱动的特征列**（`CLEAN_TARGETS.identityColumns = ['名称', 'Bangumi_URL']`，**命中任一即视为 Bangumi 数据表**），月历式新番表签名同样算命中；只要有表头行 + `Bangumi_URL` 列就能被识别与清理。缺列的规则不会硬跑，会返回跳过原因写入预览说明（如未找到「名称」列的行级规则）。
- 提示文案同步更新：未识别时提示「未识别到「名称 / Bangumi_URL」列的数据表……」；`SheetInspection` 新增 `isBangumiSheet` 字段（页面仍只需 `eligible` / `reason`）。
- 新增/调整 3 条测试（仅有 `Bangumi_URL` 的「剧集和小说」默认入选、两者皆无则跳过、显式勾选仍可绕过硬门槛），总计 1786 条全绿。

### 修复（数据清理 · 工作表选择）

- **所有工作表都显示「约 0 行」**：页面探测时的行数是硬编码 0，从未实测。现由引擎 `inspectWorksheet()` 统一探测（`UsedRange` 末行 − 表头行），显示真实数据行数。
- **未识别表头的工作表无法勾选**：页面此前把「缺少名称表头」当作禁用条件。现改为**全部可选**，仅标注 ⚠️ 原因（如「未识别到 Bangumi 数据表特征列」），并在说明中提示规则会按列缺失自动跳过。
- **页面能勾选、引擎却查无此表**：页面自行探测表头、引擎另有一套判定（`getColumnMap` 归一化「名称 / 标题 / 作品名」），两套逻辑不一致导致勾选后扫描为空。现将探测逻辑收敛到引擎 `inspectWorksheet()`，页面只消费结果；同时**用户显式勾选的工作表会跳过「必须有特征列」的硬门槛**（`listCleanTargets` 的 `isForced`），保证勾选即生效，缺列时由规则返回跳过原因。
- **工作簿多时的展示**：列表改为固定高度内滚动（340px，粘性工作簿标题）；顶部新增统计行「共 N 个工作簿 · M 张工作表 · 已选 K 张」；每个工作簿标题可点击折叠，并提供「本簿全选 / 清空」；首次加载自动勾选「识别成功」的工作表（已有持久化选择的工作簿不受影响）。
- 新增 15 条测试（`inspectWorksheet` 探测、显式勾选绕过硬门槛、UsedRange 行数），总计 1783 条全绿。

### 新功能（通用数据清理页面）

- **新增「数据清理」页面**（功能区新按钮 `btnOpenCleanPanel`，图标 `images/cleanPage.svg`，页面 `ui/clean.html` + `css/clean.css` + `ts/panel/clean-page.ts`）：对已打开工作簿中的 Bangumi 数据表执行可勾选的批量清理。
- **规则与展示彻底分离**：清理项清单全部在 `ts/panel/clean-rules.ts` 的 `CLEAN_RULES` 配置数组（id / 名称 / 分组 / 风险等级 / 默认勾选 / 目标列关键词），**新增同类清理项只需追加一条配置**，页面勾选列表、预览统计、执行与日志自动适配；清理目标（`CLEAN_TARGETS`：工作簿路径包含/排除、表名过滤、Bangumi 数据表特征列、最大行数护栏）与排除规则（`CLEAN_EXCLUDES`：排除表名、排除行文本、最小数据行数）同为配置，页面不硬编码任何路径。
- **页面五区块**：清理范围（配置只读展示）→ 清理项勾选列表（按分组渲染，风险徽标，勾选状态持久化到 PluginStorage）→ 执行前预览（待清理条目数、预计释放空间、逐规则明细）→ 执行（进度条 + 结果日志）→ 结果日志。
- **扫描 / 执行两阶段**：`scanCleanRules` 只读扫描产出计划（不写任何单元格），执行 `runCleanPlans` 先写单元格变更再批量删行（`aggregatePlans` 自动剔除落在待删除行上的写入并合并同格变更），逐目标异常隔离。
- **内置清理项**：重复名称行（保留含 URL 行、合并标签）、同 URL 重复行、空白数据行（默认关闭）、噪声标签移除、标签格式统一、类别数字前缀、别名去重、原作标签归一化。规则常量移植自 `clean/` Python 子项目（`rules_loader.py` 噪声词表、`tag_normalize_rules.yaml` 归一化规则），单元格变换全部为纯函数（`ts/panel/clean-transforms.ts`），预览与执行共用同一份逻辑保证条数严格一致。
- **`ts/sync/sheet-cleaning.ts` 重构**：拆出 `planDuplicateRows` / `planDuplicateUrlRows` / `planEmptyNameRows`（纯扫描，支持 `excludedRows`）与 `applyRowPlan`（批量删行），`cleanSheetDuplicates` 保持原 API 复用同一实现；行删除合并为范围删除减少 COM 调用。
- 新增 66 条测试（`clean-transforms` / `clean-rules` / `clean-engine`），总计 1768 条全绿。

### 改进（富化预览着色 + 富化后自动去重）

- **TAGS 标签彩色化**：数据预览 / 完整表格弹窗中 TAGS 列按 `/`、`|`、逗号、顿号拆分为独立彩色徽章，不再显示 `/` 分隔符；颜色由标签文本的稳定哈希决定（相同标签永远同色，跨预览 / 弹窗 / 匹配结果一致）。设置页「🎨 富化预览」新增开关，默认开启。
- **首播日期着色**：首播列按日期文本稳定着色，相同日期同色，一眼区分播出时间分组。可开关，默认开启。
- **播放平台着色**：平台徽章由统一青色改为按平台名稳定着色（相同平台同色）。可开关，默认开启。
- **完整表格弹窗修复**：「新番数据完整表格」此前按"有表头的列"过滤，导致 Hazx 模板无表头的名称列整列丢失（弹窗列数不全）；现改为「有表头的列 ∪ 列映射命中的列」，无表头的映射列用字段名兜底显示（如「名称」）。单元格复用数据预览渲染（周几七色 / 集数徽章 / TAGS 彩色标签 / 首播与平台着色），并修复弹窗内表格横向滚动（旧 `overflow: visible` 会溢出弹窗）。
- **富化完成后自动合并去重**：单文件富化（无冲突时立即执行；有冲突时在全部冲突解决后执行）与批量富化（全部文件写完后统一执行一次）完成后，自动对目标 Bangumi 表执行「合并去重」清洗（按名称保留含 URL 行、合并标签、删除重复行）。核心逻辑迁移至新模块 `ts/sync/sheet-cleaning.ts`（`cleanSheetDuplicates(ws)` 可指定任意工作表），主面板「数据清洗」按钮行为不变。设置页新增开关，默认开启。
- 配置键新增：`bgm_enrich_tags_color` / `bgm_enrich_premiere_color` / `bgm_enrich_platform_color` / `bgm_enrich_auto_clean`（布尔，仅显式 `'false'` 视为关闭）。

### 修复

- **设置面板 URL 重复 `/ui` 段**：在面板页面（`/ui/panel.html`）内点击「打开设置」时，`getUrlPath()` 返回的是页面所在目录 `.../ui`，拼接出 `.../ui/ui/settings.html`，WPS 调试服务器因找不到文件报 `ENOENT`。新增 `buildTaskPaneUrl(page)` 统一归一化基址（去掉尾斜杠与重复的 `/ui`），主面板 / 富化面板 / 设置面板三处创建任务窗格均改用它。
- **失效设置面板自愈**：设置页成功加载后写入 `settings_pane_url` 标记；`showSettingsPanel` 发现缓存的面板 ID 从未成功加载（无标记）时，隐藏旧面板并重建，避免旧版本留下的坏 ID 导致设置面板永远打不开。
- 补充 4 条回归用例（URL 归一化 × 3、失效面板自愈 × 1）。

### 改进

- **新番表文件支持真正的批量选择**：`selectNewAnimeFile` 改为优先调用 `Application.FileDialog(msoFileDialogFilePicker)` 并设 `AllowMultiSelect = true`，该对话框调用 Windows 原生文件管理器，支持 Ctrl/Shift 多选，一次选完即可，不再需要「循环单选 + 询问是否继续」。原 `GetOpenFilename` 循环方案保留为回退：FileDialog 缺失或任何环节抛错（部分 WPS 版本可能声明了但实际不可用）时自动启用，保证旧环境不受影响。

### 改进（导航栏统一）

- **三页面统一「顶栏 + 侧栏导航 + 滚动高亮」外壳**：
  - 新增共享模块 `ts/panel/shell-nav.ts`（吸顶偏移测量 + IntersectionObserver 滚动高亮），panel / settings / enrich 三页面启动时统一调用。
  - 修复设置页侧栏被顶栏遮挡、锚点跳转错位：此前 `--topbar-h` / `--nav-h` 仅主面板测量，设置页侧栏吸顶位置落在顶栏之下导致导航按钮显示不全、跳转标题被顶栏盖住。
  - 主面板（panel.html）补上滚动高亮（此前只有锚点跳转），并为顶部指令中心增加导航项「🚀 同步操作」。
  - 富化页（enrich.html）重构为与另两页一致的顶栏 + 侧栏布局，六个区块（新番表文件 / 目标工作表 / 数据预览 / 富化执行 / 富化记录 / 使用提示）均有导航项，支持锚点跳转、滚动高亮与「仅图标」模式。
  - 点击导航项立即高亮（不等平滑滚动完成）。

### 改进（平台聚合 + 简介工作表 + 多工作簿切换）

- **播放平台多列聚合**：Hazx 新番表的「播放平台」横向占多列（如 F/G/H/I）且「独播」为 J 列——列识别现把独播前的空表头列与重复「播放平台」表头列一并归入平台列（`platformExtraCols`）；预览与匹配结果中平台/独播聚合为一栏去重徽章展示（bilibili/优酷/爱奇艺/腾讯/B站港澳台/AcFun 等）。
- **平台信息富化到目标表**：新增 `enrichPlatform`，聚合平台写入目标表「在线播放平台」列；目标单元格已有内容时逐项去重合并（mergeTags），不重复写入已有平台。
- **简介工作表关联富化**：富化执行时自动查找「新番简介」工作表（源工作簿内优先，兜底其他已打开工作簿；表头命中 ≥2 个简介关键字且非主新番表布局），按名称与主表条目关联，把 导演→导演、编剧→脚本、人设→人物设定、CG导演→演出、音乐→音乐、动画制作→动画制作公司、系列构成→系列构成、分镜→分镜、原作→原作 写入目标表（目标列缺失时自动创建）。
- **简介字段进入预览与匹配结果**：数据预览「新番表数据」页签在主表字段后追加简介字段列（按名称关联行），匹配结果源数据同步展示。
- **多新番表工作簿切换**：数据预览顶部新增「26年4月」式月份按钮条（横向排列 + 横向滚动条），从自动识别的新番表工作簿列表生成，点击即切换源工作簿并刷新预览与匹配结果；仅一个候选时隐藏。
- **噪声过滤统一至引擎层**：`shouldFilterNoise` 移入富化引擎，预览徽章与富化写入共用一套内置规则 + 设置页自定义关键词（保存设置后缓存立即失效）；新增 9 条单元测试。

### 改进（富化预览六项）

- **放大预览对话框修复**：移除 `transform: scale(1.3)`（导致内容溢出窗口）与重复的底部「关闭」按钮，仅保留右上角 `×`；字号提升至 15px 替代缩放。
- **匹配详情弹窗化**：「🔍 详情」改为弹出 modal 展示该行完整对比信息（源/目标/别名/错误），并新增「📋 查看全部」按钮一次性浏览所有匹配（按精确/别名/未匹配/错误分组，可跳转单条详情）。
- **刷新即预览匹配**：富化页「刷新」按钮在目标工作表与列映射就绪时自动执行一次匹配预览，无需再点「预览匹配」。
- **数据表格横向滚动**：`.preview-table` 恢复 `overflow-x` + `scrollbar-gutter: stable`，表格 `width: max-content`，单元格省略宽度放宽至 220px，TAGS/标签列不再被截断。
- **周几七色徽章**：周一~周日各配独立颜色（红/橙/黄/青柠/绿/青/紫）。
- **集数阈值徽章（可设置）**：集数 = 单集阈值（默认 1）显示橙色、介于单集与完结阈值之间显示黄色、等于完结阈值（默认 12）不着色、大于显示绿色。
- **噪声过滤（可设置）**：内置过滤「新番表 by Hazx.」「版权平台标注示例」「播放平台示例」「示例」等署名/占位文本；设置页新增「🎨 富化预览」区块，可配置单集/完结阈值与自定义过滤关键词（换行/逗号分隔，去重保存），新增 8 条单元测试。

### 改进（标准图标集规范）

- **新增 [`文档/图标规范.md`](文档/图标规范.md)**：定义「SVG（顶栏 / Ribbon）+ emoji（页面内容）」双体系边界、「语义 → 图标」唯一映射表与 VS16 变体选择符规则。
- **统一三页面图标语义**：数据预览统一 `👁️`（panel 原 `📋`）、远程数据同步统一 `🗄️`（panel 原 `📥`，`📥` 保留给收藏下载/导入）、记录统一 `📊`（enrich 原 `📋`）、富化冲突「保留原名」改用 `🛡️`（原 `📋` 与复制混淆）、「选中行同步」改用 `👆`。
- **补齐 VS16**：`⚡` → `⚡️`（富化执行 / 冲突确认）、`✋` → `✋️`（手动选择）、`⏳` → `⏳️`（富化中），确保跨平台彩色 emoji 呈现。
- **同步更新文档**：`文档/ui-and-interaction.md` 9.2 图标规范、`README.md` 文档索引、`文档/USER_OPERATIONS.md` 版本历史 v3.7。

---

## [v3.7] - 2026-08-31

### 变更

- **ESLint 升级为全严格并清零**：`.eslintrc.cjs` 新增 `plugin:@typescript-eslint/strict-type-checked` 类型检查档，全量 `ts/` 的 error 从 1535 逐步降至 **0**（`npx eslint ts/ --ext .ts` 0 errors / 0 parse errors）。手段：类型感知 codemod 批量修正 `restrict-template-expressions` 非 string 插值、`eslint --fix` 自动清理部分断言/转换/条件类规则、对 `no-unsafe-*` / `no-floating-promises` 等做根因手工修复（`any` 边界、WPS 对象、zod `.default()`、null 守卫）。
- 保留既有审慎例外为 `warn`（不阻断提交）：`no-non-null-assertion`、`import/no-cycle`（另含 4 条 `no-console`）。
- 门禁验证：`tsc --noEmit` exit 0；测试 45 failed / 1582 passed，与 HEAD 基线一致（无净回归）。

---

## [v3.6] - 2026-08-30

### 新增

- **设置面板重构**：`ui/settings.html` 重构为「顶栏 + 侧边功能导航 + 主区」布局，新增滚动高亮（scrollspy）与锚点跳转，功能导航支持「仅显示图标、鼠标悬停显示名称」模式（`bgm_nav_icons_only`）。
- **外观主题**：新增深色 / 浅色 / 跟随系统三种主题模式（`bgm_theme`），通过 `data-theme` 属性切换 CSS 变量，跟随系统模式监听 `prefers-color-scheme` 实时响应系统外观变化。新增 `ts/tools/theme.ts` 主题应用模块。
- **同步偏好扩展**：新增默认收藏列表类型（`bgm_list_type`）、默认时间筛选范围（`bgm_time_filter`）、自动刷新间隔（`bgm_refresh_interval`，0–1440 分钟，0 表示关闭）三个配置项，均带输入校验与即时保存反馈。

### 修复

- 设置面板按钮延迟 5 秒才可用：`settings-entry.ts` 改为 `queueMicrotask` 异步派发 `bgm:modulesReady`，保证 `settingsBootstrap` 注册监听器后立即启用按钮。
- 导航悬停 tooltip 被侧栏滚动容器裁剪：图标仅模式下侧栏改为 `overflow: visible`，tooltip 可正常显示。
- 主题预览卡片在保存失败时不同步：改为乐观更新，视觉始终与选择一致。

---

## [v3.5] - 2026-08-28

### 新增

- **收藏回写空表自动填充**：当工作表为空（无 Bangumi URL 数据行）时，`syncCollectionFromBgm` 在验证 Token 并拉取用户收藏列表后，会弹出确认对话框，经用户确认后自动写入标准表头并将 Bangumi 账号收藏条目（URL、名称、别名、类别、是否看完、打分、标签、感言、序列号）填充到 Excel，随后继续原有颜色标记流程。详见 `ts/ui/handlers/sync.ts` 的 `_fillSheetWithCollections` 与重构后的 `_doAPISync`。

### 修复

- 恢复缺失的 `css/panel-theme.css` 源文件（此前仅 `dist/css/panel-theme.css` 被跟踪，源码缺失会导致 Vite 构建后面板样式 404）。

---

## [v3.4] - 2026-08-26

### 变更

- **移除收藏回写数据源选择**：收藏回写固定走 Bangumi API，删除「Bangumi API / GitHub 仓库」二选一下拉框、对应 UI、配置键 `bgm_writeback_source` 及文档说明。相关提交：`ad6e6f18`。

---

## [v3.3] - 2026-08-26

### 变更

- 循环依赖治理：创建 `types.ts`/`container.ts`/`services.ts`/`errorHandler.ts` 核心模块；扩展 EventBus 新增 `STATE_CHANGED`/`CONFIG_CHANGED` 事件；`index.ts` 瘦身为纯 re-export 便利桶；移除各模块对 `index.ts` 的直接依赖；函数名统一（`initTaskpane`→`initPanel` 等）。

---

## [v3.2] - 2026-08-26

### 变更

- 命名规范重构：`taskpane/` 目录重命名为 `panel/`，页面文件使用 `Page` 后缀（`panelPage.ts`/`enrichPage.ts`），`taskpane-entry.ts` → `panel-entry.ts`；删除旧兼容文件 `ts/taskpane.ts`；统一 `@module` JSDoc 标签。

---

## [v3.1] - 2026-08-26

### 修复

- enrichLock.ts 边界加固：WPS API null 返回安全处理、冗余查找逻辑简化、边界情况文档完善。

---

## [v3.0] - 2026-08-26

### 新增

- 富化功能工作簿选择与锁定机制（`enrichLock.ts`）：跨工作簿 Bangumi 追踪表选择、PluginStorage 持久化、启动恢复校验、与面板锁定独立运行。

---

## [v2.9] - 2026-08-26

### 新增

- 新增 enrichEngine 富化引擎（新番表 + 简介工作表双阶段富化）、标注白名单机制、自动添加缺失列、声优字段支持、数据同步列位置无关性验证、边界情况修复（parseRemoteContent 空值检查、getAnnotatedValue 空值守卫）、42 项边界测试。

---

## [v2.8] - 2026-08-21

### 修复

- 修复 GitHub 同步编译错误、同步完成弹窗支持明细表格。

---

## [v1.0] - 2026-08-10

### 初始版本

- WPS Excel 加载项基础能力：上传同步、数据同步（远程仓库 → Excel）、收藏下载、5 种同步策略、同步偏好、新番表富化、Token 管理、双面板 UI。
