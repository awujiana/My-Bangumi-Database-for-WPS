# 更新日志（CHANGELOG）

> 本文件按「内部功能版本」记录重大变更。注意：`package.json` 中的 `version` 字段（当前 `1.0.0`）为 npm 包发布版本，与本文档的 `v3.x` 内部功能版本相互独立，二者不要求一致。

本文档与 [`文档/USER_OPERATIONS.md`](文档/USER_OPERATIONS.md)（用户手册版本历史）、[`文档/ARCHITECTURE.md`](文档/ARCHITECTURE.md)（架构文档版本历史）互为补充：架构级变更以架构文档为准，操作级变更以用户手册为准，本文件提供跨文档的总览索引。

---

## [未发布]

- **进度弹窗阶段时间线**：通用进度组件新增可选 `phases`（`controller.setPhase(i)` 推进），
  三态（待办 / 进行中呼吸 / 已完成+耗时）。远程同步接入「下载 → 比对 → 写入」
  （`REMOTE_SYNC_PHASES`，下标由编排层与弹窗共用一份常量）。时间线刻意放在
  `.bgm-progress__section` **之外**——完成态会隐藏 section，各阶段耗时是要留给用户看的。
  被「停止」时保留未完成阶段为 pending，用户能看出卡在哪一步。
- **动效**：面板入场（`.global` 整块淡入上移 260ms）；主题切换 120ms 颜色过渡。
  入场只动 `.global` 一层——逐块动画会在模块重排（nav-order 重渲染 main 子元素）时
  反复重播，看起来像闪烁。主题过渡在 `.section` 上是**追加**进既有 transition 列表，
  不能整条覆盖（会盖掉 hover 的 transform / box-shadow）。已有 `prefers-reduced-motion`
  全局规则自动降级。

### 新增（功能 · 番剧高亮独立页：按季度起点高亮最新番剧）

把 WPS 宏「高亮最新日期」移植成插件独立页（ribbon「番剧高亮」→ 高亮面板），并修正宏的两处问题：

- **季度映射修正**：宏按「|当前月-季度起点| 取最小」定位当前季，**12 月会错算成 10 月季且无跨年**。
  改用数据页公式同款 LOOKUP 表：air 月 → 所属季 `{1,2→1月季; 3,4,5→4月季; 6,7,8→7月季;
9,10,11→10月季; 12→次年1月季}`。与用户口径一致：10 月高亮 9/10/11 月，7 月高亮 6/7/8 月。
- **Range 地址串上限 255 字符**：宏逐行拼地址（`H123,H124,…`），匹配行约 40 个就静默失败。
  改为**连续行合并 + 分块**（`H100:H105` 式区域，200 字符装车），按日期排序的数据一季通常
  只剩一两个区域。纯函数 + 单测覆盖。
- **日期解析三形态**：中文文本（`25年4月`/`2026年10月1日`）、ISO（`2026-10-01`）、
  Excel 日期序列值（`readRangeValues` String() 化后的纯数字串，UTC 读取防时区拨偏）。
- **匹配口径双源**：公式列（开播季度，值已归一并排除电影/剧场版/格式错误）优先，直接比；
  原始日期列（开播日期/完播日）先归一再比。用户可下拉自选日期源。
- **交互按用户裁定**：A 口径（面板实时预览不动表）+ 应用后立即生效；C（SheetChange 常驻）
  做成**默认关**的可选开关，开启后面板保持打开才生效。手动指定年月模式保留。
- **高亮列自定义 + 缓存**：多选列表（默认源列+名称），选择存 PluginStorage 下次自动带上；
  **序列号列刻意排除**——它的绿色是「已上传」判定色，混用会混淆语义。
- **清除只抹本插件的绿**：上次应用的区域地址记录在 PluginStorage，清除精确重放，
  不整列 ColorIndex 乱扫（那会抹掉用户手工填的色）。填充色与宏一致 RGB(0,176,80)。

页面接入全套门禁：nav-order（5 页/32 模块）、ribbon（13 按钮）、com-in-loop、lint/tsc/prettier、
4618 测试全绿。引擎 `highlight-season.ts` 为纯函数，28 个单测覆盖 12 个月映射/跨年/三格式/边界。

### 修复 / 体验（完播日闭环：数据仓库侧章节推导补全，2026-10-19）

- **上期排查结论（infobox 源缺失）成立，本期补上第二个数据源**：infobox 的
  「播放结束」Bangumi 页面普遍没登记（约 25% 非空），但**章节数据本来就在每周
  官方 dump 里**。本期在数据仓库 dump 侧做完播日推导，插件侧**零改动**：
  - 修了一个一直存在的拆分 bug：`step01` 此前按 episode 自身的 `type`
    （章节类型：0=本篇/1=SP/2=OP…）拆分，170 万条章节里 99.6% 落进
    `type0_episode.jsonlines`，`type2_episode.jsonlines` 只剩 291 条 OP——
    与文档声明的「按 subject_id 归属 type」相反。修正后 34.8 万条动画章节就位。
  - `step09` 新增推导：infobox 未登记「播放结束」时，取该条目全部章节的
    最大 airdate 兜底（格式与 infobox 一致「2008年9月28日」）；infobox 有登记
    值时优先，冲突不覆盖。实测（dump 2026-10-13，31,174 条）：播放结束非空
    7,891 → 13,913（25.3% → 44.6%），新增 6,022 条全来自推导，0 个旧值被改动。
  - 为什么不在加载项侧做：「从远端仓库更新」的设计初衷就是不调 Bangumi API
    （免 token、免限流）；逐条拉 `/v0/episodes` 对 3 万条既慢又必然撞限流。
    章节标记（chapter-marker）按单条调该接口的既有行为不变。
  - 用户可感知的变化：点「从远端仓库更新」后，此前因 infobox 缺登记而空着的
    「完播日」列会被补上；动画完结的那周起该列随周更自动推进。

### 性能 / 重构（confirmAsync + 别名缓存 + 预览死字段）

- **重构**：`showConfirm` 的 Promise 版 `confirmAsync` 收敛到 `dialog.ts`——
  `syncFromPanel` / `_doAPISync` 两条 async 链路此前各逐字重复一段
  `new Promise` 包装；回调式 `BGM.showConfirm` 随之删除，barrel 改导
  `confirmAsync`。测试替身与 `showConfirm` 共用同一份「用户回答」队列，
  避免异步链路上「用户点否」跑出相反结果。
- **性能**：`getExcelAliases` 按字段名缓存——它是纯函数，但调用点在
  「每行 × 每字段」热路径（computeDiff 对 3 万行 ≈ 72 万次调用），每次都要
  线性 `find` + 新建数组/Set。实测 717k 次调用 124ms → 20ms（-84%）。
- **性能**：删除 `DetailItem.urlCell` 死字段——全仓无消费方，却每条预览行
  都要付一次 `getCell` COM 调用（500 行预览 ≈ 500 次 IPC）。

### 修复 / 体验（「从远端仓库更新」未更新完结日期排查）

- **排查结论：加载项的更新逻辑正确，是上游数据缺失**。用户报「7 月新番完结后，
  从远端仓库更新没更新完结日期与动画制作公司」。直接拉数据仓库
  `awujiana/Bangumi-Archive-Anime-Excel`（清单 `updatedAt=2026-10-13`）验证：
  meta 片该行（sid 590786）`播放结束=""`、`动画制作公司=""`；infobox 原始文本里
  `|播放结束= ` 为空、**且没有「动画制作」键**；2026-07 开播 141 条中仅 40 条
  （28.4%）有完结日期、77 条（54.6%）有制作公司 → 是整体现象。
  加载项侧已用 5 条用例证明判定正确：远程有值+本地空→更新；远程空/缺字段→
  不视为差异（**刻意不用远程空值抹掉本地数据**）；本地有值+远程空→不覆盖；
  别名列名「动画制作公司」同样命中。
- **新增第三种体检「远程也无数据的字段」**（`collectRemoteEmptyFields`）：远程字段
  为空导致跳过时原本**完全静默**，用户看到「同步成功」却无从区分「远程没数据」
  与「同步没生效」——这次误判成 bug 的直接原因。现在按本地列名聚合命中条数，
  **只进完成弹窗、不弹 Toast**（这类字段本就普遍缺失，弹 Toast 太吵），
  并明确写出「这不是同步失败」。口径与缺列体检互斥：本地**没有**该列归缺列体检，
  本地有列但为空才归这里。

### 新增 / 体验（前端体检报告落地：视觉 P0 + 性能 + 重试入口）

按体检报告的建议执行顺序逐项落地（每项独立提交、独立过 gate 八关）：

- **预览自动刷新**（`ef6f8ebc`）：新增 `panel/panel-auto-refresh.ts`。两条互补触发源共用
  一套防抖（400ms）与闸门——① 宿主 `SheetChange` 事件（面板可见时旁边改数据）；
  ② `window.focus` / `visibilitychange`（切走编辑 → 切回面板，零宿主依赖，保底路径）。
  闸门只放行「编辑的是当前预览的表」且「没有同步在跑」。
- **预览表视觉升级**（`1c4b91c0`）：斑马纹、表头行粘性（sticky 打在 `td` 上）、
  单元格 `title` 全文、空状态块、行号列去硬编码；`rgba(74,158,255,α)` 与橙色
  改 `color-mix` / 新 token `--accent-amber`；顺带把 17 条 `.preview-table` 规则
  收窄到 `.preview-box`（styles.css 被所有页面加载，原先会串到 enrich 页——那里
  `.preview-table` 是外层 div 而不是 table），删死规则 `.preview-important`。
- **预览按指纹跳过重建**（`8f43427c`）：自动刷新让 `refreshData` 频繁入口，数据
  没变时不再整表 sanitize + 重排。判据两条：HTML 指纹相同 **且** 容器根节点仍是
  预览表/空态（否则提示类消息会被误判成「已渲染」而刷不掉）。
- **「重试失败行」入口**（本次）：新增 `core/failed-rows.ts` + 面板「🎯 重试失败行」
  按钮。同步原本把失败任务压成计数就丢掉，现在留一份失败行号；按钮只**选中**
  这些行，同步仍复用「📋 选中行同步」。刻意不持久化——行号会随增删行错位。

### 重构 / 性能（§5.6 全部 10 项落地：3 项性能收益 + 2 项新发现 + 5 项去重）

按 §5.6「评估后不做 / 新发现重构点」逐项落地（从难到易），每项独立提交：

- **A1 清理多规则共享表结构**（`a10774a9`）：`planDuplicateRows` / `planDuplicateUrlRows` / `planEmptyNameRows` 原先各自 `readSheetLayout`（每目标 3 次解析）→ `scanTarget` 每目标惰性解析一次、三规则共用。**无需 `isXinFan` 前置条件**——共享的是 `readSheetLayout` 的同一结果（新番表标准路径本就返回 null），语义天然不变。
- **A2 布局探测跨调用缓存**（`ef46ba87`）：`detectAnimeSourceLayout` 加同族键缓存 + 复用 `clearSheetCache` 失效入口；`findIntroSheetInWorkbook` 刻意不缓存（增删表无失效事件），理由写入 JSDoc。
- **A3 收藏填充批量写**（`b80f8a99`）：`_fillSheetWithCollections` 从逐格 ~8 次/条 → 连续行合并的 `Range.Value2` 矩形写（每批 ≤200 行），旧值基底 + 批失败逐格 `setCellValue` 回退。
- **B1/B2 简介识别与别名列改矩形读**（`413ddabf`）：`countIntroHeaderHits` 每候选表最坏 500 次逐格读 → 1 次；`findAliasColumn` 每次 50 次 → 1 次；均含形状守卫回退。
- **C1 handlers 工厂**（`f11b037b`）：5 处逐字重复 + 1 处空实现 → `core/sync-progress-handlers.ts` 叶子模块（依赖注入，避开 mock 口径坑）。
- **C2 verifyToken 委托**（`b973fedc`）：`GET /v0/me` 管道核心 `requestBgmMeRaw` 显式 token 参数化，两处语义差异（username 取值顺序 / 超时）逐字保留。
- **C3 双轨 barrel 合一**（`958c5b00`）：40 个文件统一到 `tools/util/index.js`，删兼容壳与数据路径 typeof 死守卫。
- **C4 toggleSheetLock 统一**（`2903dafa`）：共享状态核心（`applyLockedSheet` / `isLockedAt`）与渲染（`renderSheetLockUi`），页面流程原样保留。
- **C5 删死 API**（`c94775ff`）：`getSequentialRowsBySeqCol` 连 12 条测试一起删。

验证：每项独立过 gate 八关；最终 vitest **137 文件 / 4528 用例全绿**（4540 → 4528，差额即 C5 删除的 12 条）。

### 文档（COM 优化清单盘点：评估后不做 / 新发现重构点汇总，TECH_KNOWLEDGE §5.6）

- **背景**：`文档/TECH_KNOWLEDGE_COM_DATA_SAFETY.md` §5.1–§5.5 的重构点大多已标注「已修」，但「**未做**」的项散落四节（§5.1 主动搁置 / §5.2 主动搁置 / §5.4 取舍③ / §5.5.3 末尾），且从未按「有无性能收益」归类——想捡起某一项时要在全文档里人肉找前置条件。
- **新增 §5.6「评估后不做 / 新发现重构点汇总」**，三桶分类：
  - **A · 评估后不做、有性能收益（3 项，各附重启前置条件）**：A1 清理多规则重复解析表结构（`planDuplicateRows`/`planDuplicateUrlRows`/`planEmptyNameRows` 三处各自 `readSheetLayout`；共享 layout 会改变新番表语义，前置 = 先给 `CleanTargetInfo` 记 `isXinFan` 再分流）；A2 富化布局探测无跨调用缓存（`detectAnimeSourceLayout`/`findIntroSheetInWorkbook` 每次进富化页 / SheetActivate 全簿重跑；前置 = 失效机制，可复用 `clearSheetCache(ws)` 激活即清的先例）；A3 收藏填充逐格写（`_fillSheetWithCollections` 每条约 8 次 COM；前置 = 读旧值做基底 + 批量失败逐格 `setCellValue` 兜底，保 `Formula`/`Value` 回退链）。
  - **B · 新发现、有性能收益（2 项，2026-10-18 只读盘点，未评估未改代码）**：B1 `countIntroHeaderHits` 每候选表最坏 10 行 × 50 列 = **500 次逐格读**（`findIntroSheetInWorkbook`/`buildIntroSheetContext` 调用）；B2 `findAliasColumn` 每次 ~50 次逐格读。两者均可按项目统一改法「矩形读 + 形状守卫失败回退逐格」收敛，行为逐字一致。
  - **C · 无性能收益的搁置项（5 项）**：handlers 工厂 / `verifyToken` 委托 `fetchBgmMe` / tools 双轨 barrel 全局合一 / `toggleSheetLock` 两套统一 / `getSequentialRowsBySeqCol` 删除——纯去重或语义取舍，备查。
- 所有位置与行号按当前代码重新核对（三处 `readSheetLayout` 调用点、`_fillSheetWithCollections` 逐格写循环、`clearSheetCache` 激活即清的先例均实证）。
- §8 末尾新增「性能重构备查」指针；§5.5.3 末尾与两处「主动搁置」表格行补 §5.6 交叉引用。

### 新增（功能 · 清理页执行前预览：diff 视图 + 横屏排版 + 性能优化）

- **背景**：清理页「执行前预览」原先只有一个「扫描预览」按钮和一句提示——扫完之后也只显示一张「规则 × 目标」汇总表（几行数字），用户**看不到将删哪些行、那些行里是什么数据、引擎会保留哪一行**。而删除行不可撤销，等于闭眼执行。同时任务窗格横屏停靠时主区单列铺不满、大表扫描期间界面冻结、每次勾选工作表都明显卡顿。
- **diff 视图模块**（`ts/ui/diff-view.ts` + `css/diff.css`，四页共用）：参考 diff2html 交互范式、零依赖（CSP 禁外链）。行类型四态——保留行（`=`）/ 待删行或旧值（`-`，红）/ 新值（`+`，绿）/ 分组说明行（跨列）；单元格变更带**行内高亮**（公共前后缀裁剪，差异中段删红线 / 新增绿底）；重复组呈现「保留行 vs 待删除行」对比，用户可逐组核对引擎留对了行；大列表分页（每页 50 行，「显示更多」按批追加）。
- **预览数据零额外 COM 采集**：`RowPlan` 新增 `rowPreviews`（行号 + 名称 + URL）与 `groupPreviews`（保留/删除结构），`RowChange` 新增 `oldValue`（标签合并的旧值）——全部取自扫描期已在内存的列，不增加一次 COM 读取。
- **横屏排版**：窗格 ≥960px 时主区切两列、≥1440px 三列（确定性列数 + `1fr` 铺满，实测 `auto-fit + 400px 上限` 会在 1500px 档右侧空出约 1/4 宽度，已弃用）；预览区块 `.section-wide` 跨全部列。
- **UI 风格统一**：统计显示收敛为**一套** `.stat-grid`/`.stat-card`（导航栏视觉语言：横排胶囊 + r-md 圆角 + 语义色只作用于数值），取代此前的六套手写变体（`preview.ts` 手写卡——含硬编码 hex、enrich 三处静态卡、两处死 CSS）；enrich 静态统计块只换类名、保留 JS 依赖的 id。
- **性能**（详见 `文档/TECH_KNOWLEDGE_COM_DATA_SAFETY.md` §5.5）：① 工作表勾选状态改 write-through 内存缓存（一次勾选从 ~N 次 WebView 桥 IPC 降为 1 次）；② 扫描数据区整块只读一次，排除行判定 / 行字节估算 / 噪声行扫描共用（每目标至多 32 次 COM → 1 次）；③ `scanCleanRules` 异步化，逐目标让出宏任务，大表扫描期间任务窗格不再冻结。
- **安全修复（真机 bug，单测抓到）**：`sanitize.ts` 的 ALLOWED_ATTR 补 `colspan`——diff 视图的跨列说明行是运行时拼装表格首次使用该属性，严格白名单会静默剥掉它导致跨列失效。
- **测试**：新增 `tests/diff-view.test.ts`（21 条：裁剪边界 / 渲染结构 / XSS 转义 / 分页追加 / 空区块）；`tests/clean-page.test.ts` +4（分组对比 / 变更行对 / 平铺空白行 / 分页）；`tests/sheet-cleaning.test.ts` 4 处 changes 断言补 `oldValue`；`clean-engine.test.ts` 16 处调用随异步化改 `await`。
- **验证**：tsc 0 / eslint 0 / gate 八关 / 全量 vitest **136 文件 4511 用例全绿** / `audit:layout` 窄档 5 页面 × 2 档无异常 / 宽视口 Chrome 探针（grid 列数、预览跨列、零横向溢出 + 截图）。

### 优化（富化目标表写穿透缓存：逐格读全部命中缓存，~9N 次 COM → 1 次矩形读）

- **背景**：`enrichEntries` 对每条匹配在 Bangumi 目标表上做约 9 次逐格读（标签 / 开播日期 / 集数 / 平台 / 特点 / OP·ED·PV / 别名）。此前只给源表（新番表 / 简介表）建了 `readRowsCache` 只读缓存，目标表（`bangumiSheet`）**没有**缓存——而它恰是「读之间夹着写」的那张表：`enrichIntroData` 写「特点」列后 `enrichOpEdPv` 会再读同一格，只读缓存会拿到写前旧值导致 `appendFeatures` 合并出错（`文档/TECH_KNOWLEDGE_COM_DATA_SAFETY.md` §5.1 记录过的隐患）。
- **新增 `createSheetCellCache`**（`ts/tools/util/sheet.ts`）：`readRowsCache` 一次矩形读播种 + **写穿透**——`write` 先写 COM、成功后才更新缓存；写抛错时不更新（缓存保持与工作表一致）。后备 IO 为可注入参数（默认真实 COM 封装）；`enrichEntries` 传入 barrel 级 `getCellValue`/`setCellValue`，与各 enrich 函数同一条依赖路径（测试对 barrel 的 mock 生效）。
- **接线**（`ts/sync/enrich-engine.ts`）：循环外按 `matches` 的 `bangumiRow` 与 `bangumiColMap` 最大列建缓存，经 `readTargetCell`/`writeTargetCell` 两个小助手贯穿 `enrichTags`/`enrichDate`/`enrichEpisodes`/`enrichPlatform`/`enrichFeatures`/`enrichIntroData`/`enrichOpEdPv`/`enrichIntroFromContext`/`enrichAlias` 与空表追加路径。追加行（`nextAppendRow`）不在预读集合——首次读回落逐格读并回填，写后读仍正确。播种失败（跨度过大 / 形状不符）时不播种，读写全部回落逐格路径，行为与不建缓存一致。
- **测试**：`tests/sheet.test.ts` +5（写穿透 / 先写 COM 后更新缓存 / 读抛错不回填 / 播种命中零回落 / 播种失败回落）；`tests/enrich-engine.intro.test.ts` +3（写后读合并正确——只读缓存会把「编剧」整格覆盖掉的回归 / 无缓存路径等价 / 工作表桩不抛错）。
- **验证**：eslint 0 / gate 八关全绿 / 全量 vitest **136 文件 4519 用例全绿**。

### 优化（样式 · 横屏通栏区块操作区限宽）

- **现象**：横屏（宽窗格）停靠时，通栏区块（`.section-wide`）内带 `flex: 1` 的操作横条被拉到整个主区宽——clean 页「扫描预览」按钮从 ~150px 变成 ~1200px 巨条，enrich 页数据预览的两个页签（各占一半）变成 750px 巨型 tab。
- **修法**：`.section-wide` 内按钮行 `max-width: 720px`、页签改内容宽度、统计条 `max-width: 880px`；`#cleanScanBtn` 的行内 `flex: 1` 下沉为 `clean.css` 基础规则（列内/窄屏行为不变），通栏时覆盖。数据表格与 diff 明细仍全宽。⚠️ 限宽规则与栅格同断点（960px）——`.section-wide` 类不区分宽度，不加断点会改变窄屏行为。
- **验证**：双档 Chrome 探针（1500/1000px 按钮 < 320px；500px 按钮 > 400px 且 tab 均分，窄屏不回退）+ `audit:layout` 窄档无异常。

### 修复（同步预览样式丢失 + 死样式引用）

- **现象**：主面板控制台报 `Refused to apply style from '.../css/preview.css' because its MIME type ('text/html')`；同步预览弹窗的统计卡左侧色条（待上传/已上传）、详情列表间距、面板右下角「回到顶部/滚到底部」按钮样式、窄窗格响应式**全部失效**。
- **根因**：`f499c955` 删除孤儿页面 `panel-preview.html` 时把 `css/preview.css` 一并删除，但 ① `ui/panel.html` 仍 `<link>` 该文件（wpsjs 对缺失文件回退 `index.html` → MIME 报错）；② 该文件里有 **7 条规则未并入 `styles.css`**：`.detail-list`、`.stat-cards-centered`、`.stat-card-pending`/`.stat-card-uploaded`、`.scroll-btn`(+hover/active/hidden)、`.scroll-to-top`/`.scroll-to-bottom`；③ `.sync-preview-modal .modal-content` 的 `position: relative`（滚动按钮的定位上下文）与 **P2-11 的 480px 响应式块**也一并丢失。
- **修复**：按原文件逐字恢复上述规则到 `styles.css`（颜色刻意保留原值——`--success`/`--warning` 的 token 值与原值不同，换 token 会改变既有渲染）；`ui/panel.html` 移除对已删除文件的 `<link>`。
- **验证**：`ui/*.html` + `index.html` 全部资源引用可达（0 缺失）、CSS 括号平衡、`npm run audit:layout` 5 页面 × 500/400px **全部无异常**、`prettier --check` 通过。

### 新增（功能 · 同步前列映射确认框 + 缺列主动通知）

- **背景**：两个用户可见缺口。① 勾了分片但表里没有对应列时，字段被**静默丢弃**——只有完成弹窗里的一个小区块和一条 WARN 日志，不翻日志的用户完全无感；② 同步前无法确认「远程字段 → 本地列」的对应关系，也没有取消某列同步 / 改目标列 / 补缺失列的入口。
- **新增模块**：
  - `ts/sync/sync-mapping.ts`（纯逻辑，零 UI/COM）：从 `EXTENDED_FIELD_MAP` + `CORE_FIELD_COLUMNS` **派生**可同步字段行（不复制第二份字段表）；提供 `buildSyncMappingRows` / `resolveSyncMappingConfig` / `findOverrideConflicts` / `applyColumnOverrides` / `excludedColumnClosure` / `withoutColumns` / `remapColumnIndices` / `excludedJsonlFields`；`UNMAPPED_REMOTE_FIELDS` 列明「随分片下载但不落盘」的字段（简介原文 / infobox / 用户标签等）。
  - `ts/ui/sync-mapping-dialog.ts`：同步前确认框（`.bgm-modal` + 复用既有 dialog 样式类）。每行 = 勾选 + 拖拽手柄 + 字段 → 目标列下拉 + 状态徽章 + ▲▼；「一键补齐缺失列」写表头并**读回校验**（P2-6 纪律）；目标列冲突时拦下确认并给出提示。
- **主流程贯通**（`remote-sync-core.ts` / `remote-sync-apply.ts`）：
  - 排除列：① 从 `neededFields` 剔除（整片无所需字段时不再下载）；② update diff 的显式字段过滤（滤空的 update 移出，计数如实）；③ 写入层从 colMap 摘列（含别名闭包，`制作公司` 与 `动画制作公司` 同步排除）——所有写入点（批量写 / 逐字段写 / 回退）自动跳过，无需逐函数加参；④ 缺列体检过滤掉用户主动排除的列。
  - 改目标列：本地侧把目标列的值复制到默认列名键（`applyColumnOverrides`），写入侧把默认列号指向目标列（`remapColumnIndices`），`computeDiff` / 写入函数零改动。
  - 缺列主动通知：core 在缺列体检后调 `getNotifyApi().toast(..., 'warning')`（前 5 个字段名 + 条数 + 「添加同名列后重新同步」指引）；完成弹窗的缺列区块补上「怎么补」的说明。
- **接线**：`ACTION_HANDLERS.syncFromGithub` 在用户确认「是否继续」后、真正同步前弹列映射框；「取消同步」= 中止；弹窗不可用（测试环境 barrel 被整体 mock）时按默认继续，不阻塞既有链路。`syncFromGithub` / `syncFromRemote` 各新增末尾可选参数 `mapping`（既有调用方零改动）。
- **测试**：新增 `tests/sync-mapping.test.ts`（22 条）+ `tests/sync-mapping-dialog.test.ts`（8 条，jsdom：渲染 / 取消勾选 / 改目标列 / 补列读回 / 冲突拦截 / ESC / 上下移）；`tests/action-handlers.test.ts` 的同步调用断言补第 7 位实参。
- **验证**：tsc 0 / eslint 0 / prettier 通过 / check:cycles 0 / gate 八关 / 全量 vitest 通过。

### 变更（架构 · 收敛 `syncFromRemote` / `syncFromGithub` 双入口，sync 结构合并路线①）

- **背景**：`syncFromRemote`（sync-source-registry.ts，~190 行）与 `syncFromGithub`（github-sync.ts，~190 行）主体逐字重复 ~150 行，2026-10-15 逐行比对确认差异仅 5 处（source 获取方式 / 校验失败文案 / 日志 tag / 耗时格式 `${ms}` vs `formatDuration` / 时间筛选标签函数是否内联）。原阻塞点为循环依赖：抽 core 需要 `applyDiffToSheet` 等定义在 `github-sync.ts` 内的函数，而 `syncFromGithub` 又要调 core。
- **拆分结果**（`ts/sync/` 新增两个模块，两个入口变薄壳）：
  - `ts/sync/remote-sync-apply.ts`（1537 行，新建）：apply 阶段整体逐字迁入 —— `readLocalEntriesForSync` / `applyDiffToSheet` / `applyConflictResolutions` + 12 个私有辅助（`writeRemoteEntryToRow` / `batchWriteNewRows` / `batchUpdateRows` / `writeRowValuesWithUndo` / `fallbackWriteRemoteEntry` / `collectWriteCols` / `buildRemovalSnapshot` 等）。注释、边界处理与日志 tag（`[githubSync]`）逐字保留。
  - `ts/sync/remote-sync-core.ts`（295 行，新建）：`runRemoteSync(parameters)` 统一编排（校验 → 按表头选字段 → 下载 → 屏幕刷新 → 空表表头 / 选中行 / 时间筛选 → 读本地 → diff → 冲突决策 → apply → 体检 → 收尾）；两入口 5 处历史差异全部参数化（`source` / `logTag` / 校验失败兜底文案 / 进度口径 / 耗时口径）。
  - `ts/sync/github-sync.ts`（**1893 → 215 行，-88.6%**）：只剩 GitHub 源实现（`GithubSyncSource`）+ 取数（`fetchGithubText` / `fetchGithubJson`）+ `syncFromGithub` 薄壳；apply 三函数与 `GithubSyncResult` 经**兼容 re-export** 转出，`ts/index.ts` barrel 与既有消费方不变。
  - `ts/sync/sync-source-registry.ts`（**314 → 118 行，-62.4%**）：注册表机制 + `syncFromRemote` 薄壳。
- **设计决策**：选**路线①**（apply 整体搬进 core 方向）而非当时建议的 ②（调用方注入 apply）—— ② 会把夹在下载与 apply 之间的空文档表头填充 / 选中行 / 时间筛选 / 屏幕刷新收尾劈回调用方。① 的改动面风险由一条硬约束化解：**`vi.mock` 截不住模块内调用，apply 与编排必须分模块**，否则 registry 测试对 apply 三函数的 mock 会静默失效。最终依赖单向无环：`remote-sync-apply.ts` ← `remote-sync-core.ts` ← 两个薄壳。
- **行为口径**：进度分母统一为 registry 版 `0/1 → 1/3 → 2/3 → 3/3`；编排层耗时统一为裸毫秒 `${ms}ms`（**github 路径用户可见文案随之小改**，如「下载完成：N 条（耗时 123ms）」）；apply 阶段内部 `formatDuration` 生成的文案不变。
- **配套测试**：`tests/sync-source-registry.test.ts` mock 接缝随模块边界迁移（**零断言变更**）：github-sync.js mock 收缩为仅 `GithubSyncSource`、新增 `remote-sync-apply.js` 全量工厂（真实 apply 模块不加载，与改动前 github-sync.js 全量 mock 隔离级别一致）、github-sync-diff 部分 mock 补 `computeDiff`（core 改为从该模块导入）。
- **验证**：`tsc --project tsconfig.build.json` 0 / 全量 `eslint ts tests` 0 / 改动文件 `prettier --check` 通过 / `check:cycles` 0（无新增环）/ `check:ribbon-buttons` / `check:nav-order` / `check:com-in-loop` / `typecheck:tests` 全过；`vitest run --no-file-parallelism` 全量通过（含 sync-source-registry 70、github-sync 177、github-sync-core 45、sync-source 7、sync-result-dialog 35、sync-flow 15）。

### 变更（架构 · 拆分 `ui/handlers/index.ts` 2693 → 258 行，P1-G/P1-6/P1-H）

- **背景**：`ui/handlers/index.ts` 是改动第 1 名的上帝模块（2693 行），内部同时承载资源追踪、按钮绑定、`ACTION_HANDLERS` 59 键分发表、日志面板、消息监听、事件总线订阅、设置页绑定、增量同步回写、GitHub 配置表单读写。
- **拆分结果**（`ts/ui/handlers/` 现为 11 个单一职责模块，**index.ts 2693 → 258 行，-90.4%**）：
  - `action-handlers.ts`（1449 行）：`ACTION_HANDLERS` 59 键表（1274 行）+ `handleActionClick` 分发 + `computeSyncMetrics` 纯函数。
  - `incremental-bindings.ts`（284 行）：增量同步 / 跳过冲突复选框回写（含重试）+ 冲突策略单选 + Ribbon 初始化。
  - `panel-events.ts`（255 行）：window message 监听（origin 白名单）+ 8 个事件总线处理器 + `setupEventListeners`；`removeMessageListener` 仍经 index.ts 再导出（对外 API 不变）。
  - `github-settings.ts`（202 行）：配置输入框 ↔ PluginStorage 双向同步、按同步源类型切换字段、300ms 防抖自动保存。
  - `settings-bindings.ts`（172 行）：主题 / 列表类型 / 时间筛选 / 刷新间隔 / 同步记录开关。
  - `resource-tracking.ts`（93 行）：定时器 + DOM/事件总线监听器统一登记与清理。
  - `path-controls.ts`（75 行）：WPS 文件夹选择（FileDialog + GetOpenFilename 回退）+ 路径回填。
  - `clipboard.ts`（33 行）/ `log-panel.ts`（32 行）/ `panel-context.ts`（10 行）：剪贴板回退（`_copyTextToClipboard` 正名为 `copyTextToClipboard`）/ 日志面板渲染 / `isPanelContext`。
  - `index.ts`（258 行）：只剩 `onAction`、`setupButtonListeners`、`startHandlers`、`initHandlers` + 对外 re-export 聚合。
- **安全性**：新模块一律只依赖 barrel + 叶子模块，**不反向 import `index.ts`**（`isPanelContext` 特意抽成 `panel-context.ts` 以避免成环）。`check:cycles` 结果：无分层反向依赖、无致命环；新增环均为**良性环**（不在顶层读取环上绑定）。
- **搬运完整性**：脚本比对 `git show HEAD:<file>` 与拆分后文件的顶层定义名集合 —— `MISSING(丢失)=(无)`、`INTEGRITY_OK`；对 `ACTION_HANDLERS` 另做整对象字面量归一化比对（59 键完全一致，唯一差异是刻意的函数改名）。
- **配套测试（P1-H）**：新增 `tests/resource-tracking.test.ts`（假时钟按真实行为断言定时器清理）、`tests/handlers-split.test.ts`（jsdom：`isPanelContext` + `renderLogEntries`）。
- **验证**：每批 `tsc --noEmit` 0 / `tests` tsc 0 / 全量 `eslint ts tests` 0 / `check:cycles` 0 / `check:ribbon-buttons` 0 / `typecheck:tests` 0 / 逐文件 `prettier --check` 通过。覆盖率是否达 P1-1 目标需本地 `npm test` 与 `npx vitest run --coverage` 复核（沙箱内 vitest 运行器损坏）。

### 变更（架构 · 拆分 `panel/enrich-page.ts` + 清除死导出，P1-G/P1-6/P1-H）

- **背景**：`panel/enrich-page.ts` 3740 行、覆盖接近 0，同时是「上帝模块」与「覆盖率洼地」。沙箱内 vitest 运行器损坏、无法真跑测试，故采用**「先抽后测」**：先把自洽的纯逻辑切片抽成独立模块（改动可被 `tsc`/`eslint` 完整静态验证），再为小模块补单测 —— 而不是 in-place 写「mock 全部 14 个依赖」的不可验证测试。
- **拆分**（**3740 → 3227 行，-513**）：
  - `ts/panel/enrich-page-state.ts`：预览配置懒加载缓存（`EnrichPreviewConfig` / `getEnrichPreviewConfig` / `resetEnrichPreviewConfig`）+ 列映射字段元数据（`COLUMN_MAPPING_FIELDS`）+ `ScalarMappingKey`。仅依赖 `tools/config`。
  - `ts/panel/enrich-preview-cell.ts`：着色工具簇（TAGS / 首播 / 平台按内容稳定配色、weekday / episode 徽章、阈值读取），对外只导出生产实际引用的 `renderPreviewCell` / `renderPlatformChipsCell`。
  - `ts/panel/enrich-detail-render.ts`：富化详情渲染簇（匹配方式 / 字段操作枚举→中文标记 + 分组/条目/字段三级 HTML）。`EnrichDetailGroup` 类型随「渲染输入契约」一并迁入，依赖**单向无环**。
- **死代码清除**：`renderPreviewTable` / `renderMatchResults` / `renderProgress` 经三步判定（全库 grep 零调用方 → `ts/index.ts` 是显式 8 名再导出名单、可排除 `export *` 漏判 → UI 入口走的是另一条链路）确认无引用后删除（-109 行）；同时移除一处多余的 `enrich-page-state` 再导出。
- **配套测试（P1-H）**：`tools/config.ts`、`tools/wps.ts`、`tools/theme.ts`、`tools/auto-fill-url.ts`、`panel/enrich-page-state.ts`、`panel/enrich-preview-cell.ts`、`panel/enrich-detail-render.ts` 各自新增单测，均只 mock 其最小依赖。
- **验证**：每批 `tsc --noEmit` 0 / 全量 `eslint ts tests` 0 / `prettier --check` 通过。覆盖率是否达 P1-1 目标需本地 `npm test` 与 `npx vitest run --coverage` 复核（沙箱内 vitest 运行器损坏）。

### 变更（CSS · 响应式窄屏适配 + 令牌化收口，P2-11/P2-12）

- **P2-11 响应式**：`clean.css` / `preview.css` 文件末尾各补 `@media (max-width: 480px)` 断点（任务窗格拖窄到 <480px 时避免横向溢出与内容顶破）。`tokens.css` 仅变量定义、无布局，不需要媒体查询。
- **P2-12 令牌化**：新增可复跑工具 `scripts/tokenize-css.mjs`（默认 dry-run，`--write` 落盘），把 `styles.css` 中精确命中 token 值的 95 处硬编码 hex 替换为 `var(--token)`。替换约束：映射源只取 `tokens.css` 的 `:root`（跳过 `[data-theme=light]` 覆盖块，保护 preview.css 的 Catppuccin 独立调色板）、跳过 token 定义 RHS、排除目标文件自身重定义的同名 token、纯黑/纯白歧义色保留。结果：**深色渲染零变化**、浅色自动跟随主题。`panel-theme.css` / `enrich.css` 经工具扫描已无可替换项。
- **验证**：lint 0 / tsc 0 / DOMPurify 版本 / 导入图 / ribbon 12==7+5 / tests-types 0 全绿。

### 新增（无障碍 · 静态模态框 ESC 关闭 + 焦点陷阱 + role/aria-modal，P2-10）

- **问题**：`ui/*.html` 的静态模态框（`.modal` / `.detail-modal`）只能靠鼠标关闭 —— 无 `role="dialog"`/`aria-modal`（屏幕阅读器不识别为对话框）、无 ESC 关闭（仅进度组件支持）、无焦点陷阱（Tab 会逃逸到背景）；`index.html` 还缺 `lang`。
- **改法（document 级事件委托，零调用点改动）**：新增 `ts/ui/components/modal-a11y.ts`，页面入口（panel / settings / enrich 三个 `*-bootstrap`）调用一次 `installModalA11y()`：
  - **ESC** 关闭最上层可见静态模态框，且一律「点击模态框自身关闭控件」（`.modal-close-btn` / `.detail-close-btn` / `[data-action^="close"]`），保证既有清理与回调照常执行；**找不到关闭控件时不处理**，不强行 `display:none` 破坏状态机。
  - **焦点陷阱**：Tab / Shift+Tab 在模态框内环绕；焦点在框外时拉回第一个；无可聚焦元素时阻止 Tab 逃逸。
  - **明确不覆盖** `dialog.ts` / `progress.ts` 自管的 `.bgm-modal`（前者已自带 role/aria-modal；后者运行期需保持阻塞、完成态才允许 ESC），避免双重处理。
- **HTML 属性补齐**：11 个静态模态框补 `role="dialog"` / `aria-modal="true"` / `aria-label`（panel 4 + panel-preview 3 + enrich 3 + settings 1）；`index.html` 补 `lang="zh-CN"`；`#closeSyncPreview` 补 `modal-close-btn` 类（原先只有 id，ESC 认不出）。
- **测试**：新增 `tests/modal-a11y.test.ts`（14 条）。lint 0 / tsc 0 / cycles / ribbon / tests-types 0；**54 文件 1877 用例**。

### 安全（依赖 · DOMPurify 双份副本同升 3.4.15，P2-3）

- **问题**：`dompurify <= 3.4.12` 有中危 XSS 通告（GHSA-55q2-fjhq-7xh7：`IN_PLACE` hook 被移除后，残留的脱离子树仍可执行）。本项目同时存在**两份** DOMPurify：`libs/purify.js`（vendored UMD，`ui/*.html` 与 `index.html` 实际加载的就是它）与 `node_modules/dompurify`（测试与构建器解析的那份）。**`npm audit` / `npm update` 只作用于后者** —— 只升 npm 依赖会出现「通告看起来修好了、真机跑的仍是旧版」的假象。
- **改法**：两份同升 **3.4.15**，并保持 `check:dompurify-version` 门禁为绿（vendored 3.4.15 == 安装 3.4.15）。升级后 `npm audit` 不再报本条。
- **实施记录**：`npm install dompurify@3.4.15` 触发整树重解析，被 `eslint-config-airbnb-extended@3.2.0` 的 `peer eslint@^9` 与项目实际 `eslint@10.9.1` 的**既有**冲突挡住（该冲突早已存在，只是此前没做过会重解析整树的安装）。改用 `--legacy-peer-deps` 完成，并核对 lockfile 确认**只动了 dompurify（8 行）**，未让 npm 顺手重解析整棵树。

### 变更（工程化 · Ribbon 按钮收敛为单一分发表 + 新增一致性门禁，P2-9/P3-3）

- **问题**：按钮 ID 在 `ribbon.xml` 与 `ts/ribbon.ts` 两处维护，而 TS 侧还是「`PANEL_OPENERS` 映射表 + `OnAction` 的 `switch`」**两套机制并存**（12 个按钮 vs 4 项映射表 + 8 个 case）。两侧不同步的表现是**静默失效**：按钮点下去没有任何反应，只在日志里留一条 `[BGM] 未知按钮: xxx`，真机上极难察觉。
- **改法**：
  - 合并为 `SYNC_ACTIONS`（7 个同步处理器）/ `ASYNC_ACTIONS`（5 个异步处理器）两张表，5 段重复的「async IIFE + try/catch + `handleError`」收进 `runAsyncRibbonAction()`。`ts/ribbon.ts` 518 → **451 行**。
  - 顺带清掉 `ICON_PATHS` 中指向已删除按钮的**孤儿图标项** `btnClearColors`。
  - **新增 `scripts/check-ribbon-buttons.mjs` 并接入 `npm run gate`**：校验 `ribbon.xml` 的每个按钮都在分发表与图标表中、图标文件真实存在、`ICON_PATHS` 无孤儿键、`onAction`/`getImage` 指向的函数确有导出；**解析结果为空即报错**（避免门禁静默空转）。漂移从「静默」变成「红灯」。
  - 门禁有效性用**负向测试**验证：临时注入一个幽灵按钮，确认报错并给出两条正确的定位信息，再还原。
- **顺带清理同类问题**：`ts/sync/github-config.ts` 的模块私有 `CONFIG_KEYS`（`github_sync_*` 键）改名为 **`GITHUB_CONFIG_KEYS`**，不再与 `ts/tools/config.ts` 导出的 `CONFIG_KEYS`（`bgm_*` 键）同名不同义。
- **另两组平行清单的核实结论**：清理规则 TS↔Python 双份 —— Python 侧（`clean/`）**未入库**（被 `.gitignore` 忽略），TS 侧是唯一事实来源且已注明移植出处，无仓库内漂移风险，不做改动。

### 移除（死代码 · DI 容器与 GitHub 数据缓存，P2-8）

- **`ts/core/services.ts`**：全库 0 引用，模块顶层的 `container.register()` 从未执行。
- **`ts/core/container.ts`**：本不在清单里 —— 它**仅被 `services.ts` 引用**，删掉上游后自动成为下一个孤儿，一并删除。（死代码会**级联**：删完要回头再扫一遍。）
- **`ts/sync/github-cache.ts`**：生产代码 0 引用，**仅 `tests/github-cache.test.ts` 引用**，其 TTL 逻辑（`isCacheValid`）从未被任何代码调用；下载链路早已由 `sync-source-registry` 的 JSONL 数据源（GitHub/GitLab/Gitee/本地文件/Gist）接管。随被测模块一并删除的 19 条测试，正是本条要消除的「有测试所以看着还活着」的错觉。

### 变更（仓库卫生 · `v0.yaml` 迁入 `文档/`，P3-5）

- **临时产物部分无需改动**：`.dry.json`、`.stats.tmp.json`、`.backup_before_recovery/`、`.archify-delivery-*/`、`__pycache__/`、`bgm-runtime-architecture.{html,json}` 经逐项 `git check-ignore` 验证**已全部被 `.gitignore` 覆盖**。
- **`v0.yaml` 是规范文件而非临时产物**（Bangumi 官方 OpenAPI 规范，4170 行），故既不删除也不取消跟踪，而是连同 git 历史迁至 **`文档/bangumi-openapi-v0.yaml`**，让仓库根不再堆放规范文件。全库无脚本或文档引用该路径，迁移零风险。

### 变更（工程化 · `debug-panel.ts` 入口归属整理，P3-4）

- **问题**：`ts/debug-panel.ts`（956 行）是 `index.html` 入口，却与 `panel-entry`/`ribbon-entry`/`settings-entry` 三个入口文件散落在不同目录，入口组织不一致；且它不在 `ts/entry/`，未被 vitest 的「入口文件排除」规则覆盖，实测 **0% 覆盖**。
- **改法**：`git mv` 到 `ts/entry/debug-panel.ts`，与其它入口并排；同步修正内部 `await import('./tools/logger.js')` → `'../tools/logger.js'`；`index.html` 的 `<script>` 路径由 `./dist-ts/debug-panel.js` 改为 `./dist-ts/entry/debug-panel.js`（`tsc` 保留目录结构，产物落 `dist-ts/entry/`）。清理遗留的死构建产物 `dist-ts/debug-panel.js`。
- **效果**：迁入后该文件与其它 entry 一并被排除覆盖率（同因：依赖 WPS 宿主、无法在 Node 测试环境执行），原「0% 覆盖」告警随之消解。文件内约 22 处 `as unknown as` 为读取 `window` 全局态所需，属调试面板常态，不在本次范围。

### 变更（工程化 · `npm run gate` 增至六道关）

`lint:check` → `check:dompurify-version` → `check:cycles` → **`check:ribbon-buttons`** → `typecheck:tests` → `test`。本轮结束全绿：53 测试文件 / 1863 用例。

### 修复（数据安全 · 自动添加列不再静默部分成功，P2-6）

- **问题**：`ensureBangumiColumns()` 在 `try` 内逐个把新列写进映射、`catch` 里只记日志后**返回已部分更新的映射** —— 表头其实没写成功时，映射里已经有这些列，下游便按映射往空列写值。用户看到的是「表头缺失 + 数据错位」，且无法回滚。
- **改法（全成或全不成）**：写入表头 → **读回校验** → 校验通过才把新列合并进映射；失败则返回不含新列的映射并 `toast` 提示用户（下游按既有回退列处理）。读回拿不到数据时**不据此判失败**（与 `buildCache` 同一降级口径：本次不下结论，下次运行从表头重新识别）。
- **实施顺带修掉一处会改用户数据的真缺陷**：表头值原为 `Array.from(missing, (m) => [m.field])`，即 **N×1**，而范围是单行 `C1:E1`。Excel/WPS 对二维数组是**按数组自身形状写入**的（不按范围尺寸改写形状），因此第二个表头会落到起始列**下方那一行**，覆盖该行数据。既有约定（`sync-record.ts` 的表头写入）是 `headerRange.Value2 = [COLUMNS]`（1×N），据此改为 `[missing.map((m) => m.field)]`。
- 该函数此前**零测试覆盖**（正是这类「单元测试全绿、真机上改数据」缺陷的温床）。新增 `tests/enrich-engine.columns.test.ts`（6 条），锁死写入成功、读回为空、读回列数不足、写入抛错、读回本身失败、无缺失列六种情形。

### 修复（异步 · 数据同步的写入阶段可被「停止」中断，P2-7）

- **问题**：`AbortSignal` 只作用于下载阶段。用户点「停止」后 `applyDiffToSheet()` 仍会把整批 diff 写完（原注释「`applyDiffToSheet` 为同步函数，不支持取消」即是自认），进度状态与实际不符。
- **改法**：`applyDiffToSheet()` 增加可选 `signal`，在**每个 add 批次 / update 批次 / 每条 delete** 前各检查一次取消；已完成的下载阶段就已被取消时直接不进入写入。未处理条目计入 `result.skipped`，并如实上报「已停止：已写入 N 条，剩余 M 条未处理」。
- **已写入部分不回滚**：同步记录、undo 栈、行颜色都按**实际写入量**收敛，保证「表里有什么」与「记录里写了什么」一致（否则正是 P1-E 要消除的静默不一致）。
- 两条入口 `syncFromGithub` / `syncFromRemote` 透传 `signal`；面板侧收尾按 `wasStopped` 把摘要标成「⏹️ 已停止（写入阶段中断）」，进度弹窗与结果弹窗都不再报成一次完整同步。新增 2 条测试。

### 性能（面板 · 首屏不再被全工作簿扫描阻塞，P2-13）

- **问题**：`initPanelCore()` 里 `refreshSheets` / `refreshWorkbooks` / `autoDetectSheet` / 首帧预览全部同步执行，而 `autoDetectSheet` → `findBangumiTargetSheets()` 会遍历**每个已打开工作簿的每一张工作表**（读表头、数数据行、比名称关键词）。工作簿一多，任务窗格打开就明显卡住。
- **改法**：这四步收进 `bootstrapSheetSelection()`，用 `setTimeout(…, 0)` 挪到首屏之后。用**宏任务**而非微任务 —— 微任务仍在本次渲染前执行，等于没挪。`bgm:modulesReady` 仍在 `initPanelCore` 内同步派发，因此按钮可用性不受影响；`restoreLockedSheet()` 保持同步（只读 PluginStorage），`BGM.sheet` 状态与原先一样在初始化返回时就绪。

### 移除（死代码 · 废弃的远程仓库下载三函数，P2-4/P2-5）

- **背景**：审查报告 P2-4/P2-5 指出 `fetchRemoteFile`（裸 `fetch`，无超时/无 `AbortSignal`）与其 `catch → null` 会让「网络悬挂时任务永久卡死」「以空数据覆盖本地有效数据」。
- **现场核实：条目锚定的代码没有调用方，两条风险不可达**。`fetchRemoteFile` / `parseRemoteContent` / `writeRemoteDataToSheet` 是 v1 的「raw URL 直接拉 CSV/TSV 写表」实现，已被 `syncSourceRegistry` 的 JSONL 数据源（GitHub/GitLab/Gitee/本地文件/Gist，超时与 `AbortSignal` 齐备）取代 —— 全库零生产调用、零测试引用（仅 `parseRemoteContent` 有 9 条自测）、barrel 无全局暴露，UI 的「🗄️ 数据同步」走的是 registry。
- **处置**：删除这套平行实现，而不是为一个不存在的调用方补超时与 `Result`。barrel 导出、对应测试块与 `文档/ARCHITECTURE.md` 的说明同步清理（与 P2-8「清理死代码」同性质）。

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
- `npm run gate` 当时是五道关（后续增至六道，见本文档顶部「`npm run gate` 增至六道关」）：`lint:check` → DOMPurify 版本一致 → 导入图（分层 + 致命环）→ tests 类型 → 全量测试。

### 修复（数据安全 · 记录写入失败不再静默，P1-E）

- **问题**：写记录的函数（`addSyncRecord(s)`、`addEnrichRecord(s)`）失败时只写日志、返回 `false`/`void`，而调用方普遍**不看返回值**。用户看到「同步完成」「富化完成」并被打上成功色标，实际情况是记录一条都没落盘 —— 即审查报告所说的**静默数据丢失**。
- **改法**：① `addEnrichRecord` / `addEnrichRecords` 改为返回 `boolean`；② 各批量写入点检查返回值，失败时**按批次**提示一次（不逐行刷屏）：`progress-reporter` 的成功/失败两处、`handlers/sync` 阶段 1、`github-sync`、`enrich-engine`、`preview` 单行上传（抽 `writeSyncRecord()` helper）。
- **为什么没有改 `handleError` 的默认级别**：现有实现里 `level` 默认已是 `ERROR`（会写错误日志），只是 `showAlert:false`；若把 `showAlert` 默认打开，**逐单元格**写入失败（`setCellValue` 内部即调用 `handleError`）在批量场景会弹出成百上千次，反而淹没真正的失败。可感知性的正确粒度是**批次**。
- **36 处 `showAlert:false` 的分类结论**：绝大多数是内部降级路径（建表/建表头、缓存构建、格式设置、解析与筛选探测、面板刷新、Ribbon 冲突检测），**保留静默是对的**；真正会造成「以为成功但没落盘」的只有写入类调用，已全部覆盖。
- 新增 3 条回归锁（`tests/progress-reporter.test.ts`）：写入失败必须提示、提示文案与级别正确、写入成功时不得打扰用户。

### 修复（性能 · 富化记录改为批量写入，P1-C 批次二）

- **问题（第三次同形态）**：`enrich-record.ts` 里 `addEnrichRecords()`（一次取表句柄 + 一次 `Range.Value2`）与 `addEnrichRecord()` 并列存在，但 `enrich-engine` 在 `for (const field of enrichedFields)` 里**逐条调用后者** —— 每条记录 9 次 `setCellValue`，**并且每次都重新走 `getOrCreateEnrichRecordSheet()`（查表 + 逐列校表头）**。按「条目数 × 字段数」估算，一次富化的 COM 调用量比同步记录那条链路更大。
- **改法**：`enrichIntoRow` 只把记录 `push` 进调用方传入的累积数组，`enrichEntries` 在循环外一次 `addEnrichRecords(records)` 批量写入（含用户取消 `break` 的分支：对应单元格已写入，记录必须保持一致）。
- **顺带消除一处重复定义**：`enrich-engine.ts` 内自带一份与 `enrich-record.ts` 导出**完全相同**的 `AddEnrichRecordParameters`（注释写「内部使用」）。两份同形接口会随字段演进静默漂移，已删除本地副本、改为导入唯一来源。

### 修复（性能 · 同步记录表读写改为矩形批量，P1-C）

- **问题**：WPS 的每次单元格读写都是一次跨进程 IPC。同步记录表却把读写拆到了逐单元格粒度：写入分散在 4 处逐单元格 `setCellValue`（新增一行 = 12 次调用），读取有 3 处逐行 `getCellValue`。项目中其实早已有两个现成范式 —— `tools/util/sheet.ts` 的 `readRangeValues()`（矩形读）与 `Range.Value2 = 二维数组`（矩阵写）—— 只是同步记录表没用它们。
- **改法**：
  - 新增 `writeSheetRows()`，成为同步记录表**唯一**的写入路径（表头、新增行、迁移回写、批量写入全部走它）：表头一次写值 + 一次设底色，新增行 12 次 → 1 次，迁移回写 12×N → 1 次。
  - `groupRowsBySid()` 由逐行读改为**整列一次矩形读**。这一处意义超出它本身：它由 `deduplicateSyncRecords()` 在**每次写入前**调用，是 P1-B 把写入次数从 N² 降到 N 之后、链路里最后一次 O(n) 放大。
  - `migrateSyncRecordSchema()`：旧表迁移由「11 次/行读 + 12 次/行写」改为「一次矩形读 + 一次矩形写」。
  - `enrich-engine.buildBangumiIndexes()`：名称/别名索引构建由逐行 1~2 次读改为一次覆盖两列的矩形读。
- **测试**：新增 `Range` 写入捕获桩（`createRangeStub` + `rangeWrites` + `getWrittenRows`），把原先「`setCellValue` 被调用次数 ≥8 / ≥10」这类**弱断言**换成**逐列校验实际落盘内容**（更强，且直接锁住「整行写入」的新形态）；`migrateSyncRecordSchema` 的数据行用例同步改为经 `readRangeValues` 注入旧结构数据。enrich-engine 的 util mock 补上 `readRangeValues`（mock 需跟上生产接口）。
- **经核实已过时的条目**：审查报告 P1-4 中 `github-sync.ts:1204-1248`（`writeRowValuesWithUndo`）早就是「一次 COM 调用写入整行」＋逐单元格 undo 记录，无需改动。
- **有意暂缓的一处（已收口，`0a3fbbd7`）**：「已存在 SID 的逐字段更新」原本仍是每行 3~11 次 `setCellValue`。合并成一次整行写入必须**读-改-写整行**（未提供的字段要读回原值，否则会被空值覆盖），而旧 `readRangeValues()` 会把所有单元格 `String()` 化、读失败会用空值覆盖整行（静默清空记录）。现按 §3.2.3 建议的推进顺序落地：先补 `readRangeCellValues(): WpsCellValue[][]`（保留原始类型，`null` 而非 `''`，单独测试），再整行读-改-写。详见下文「P1-C 残留」条目。

### 修复（性能 · P1-C 残留：已存在 SID 整行读-改-写，`0a3fbbd7`）

- **问题（§3.2.3 残留项）**：`appendOrUpdateSyncRecord` 的 else 分支（已存在 SID 单条更新）与 `appendOrUpdateSyncRecords` 的 `sidToUpdate` 循环（批量更新）仍是每行 3~11 次 `setCellValue`。合并成一次整行写入需读-改-写整行（未提供字段要读回原值，否则被空值覆盖），而旧 `readRangeValues()` 会 `String()` 化、读失败会用空值覆盖整行（静默清空记录）。
- **改法（按 §3.2.3 推进顺序）**：
  - 先在 `ts/tools/util/sheet.ts` 补 `readRangeCellValues(): WpsCellValue[][]`：保留原始类型（`string | number | boolean | Date | null`，`null` 而非 `''`，`null`/`undefined`/函数/原生代码返回 `null`），避免数字列被文本化；单独测试。
  - 新增 `buildUpdatedSyncRow()`：以读回原始整行为底，仅覆盖显式提供字段（`message`/`fingerprint`/`name`/`url`/`type`/`source`/`content`/`collType`），保留其余原值。
  - 两处更新改为 `readRangeCellValues` 整行读 → `buildUpdatedSyncRow` 构造 → `writeSheetRows` 整行落盘（一次 `Range.Value2`）。**读回失败（空数组）放弃写入并返回 `false`**，杜绝用空值覆盖用户同步记录。
  - lint 收口：`no-continue` 禁止 → 批量循环改 `if (existing) { ... }` 正向条件块；`buildUpdatedSyncRow` 参数 `i` → `index`。
- **测试**：`tests/sync-record.test.ts` 的「写入次数」弱断言（`mockSetCellValue.mock.calls.length ≥ N`）全部改为「捕获 `Range.Value2` 实际落盘内容」（`getWrittenRows(address)` 逐列比对 + `rangeWrites.size > 0`）；新增 `mockRangeWriteThrows` 让 `Value2` setter 抛错，覆盖写入失败返回 `false` 路径；两个 Proxy 异常用例显式注入正常行使更新路径读回真实整行。门禁：1863 用例全绿 / 53 文件。

### 修复（性能 · 消除同步记录的 O(n²) COM 链路，P1-B）

- **问题**：`sync-record.ts` 的写入入口在**每次写之前**都要先跑一次 `deduplicateSyncRecords()` 保证缓存干净，而它会遍历同步记录表 `2..lastRow` 的每一行读取 SID 列。于是「循环内逐条 `addSyncRecord`」把一次 O(n) 的全表扫描放大成 **N×N 次跨进程 COM 调用** —— 数千行的同步会让任务窗格实质长时间无响应。这是本次审查中唯一会导致「不可用」的性能缺陷。
- **审查报告定位修正**：报告把热点写成 `ui/preview.ts:722`，但那是 `uploadSingleRow()` 内的单行按钮路径，每次点击只写 1 条，不构成 O(n²)。真实的批量循环是两处：`sync/exceltobangumi/progress-reporter.ts` 的 `applySyncSuccessResults` / `applySyncFailResults`（批量同步主链路，与数据行同阶），以及 `ui/handlers/sync.ts` 的 `_doAPISync` 阶段 1（逐条写入账号收藏，与收藏数同阶，可达数千）。
- **改法**：两处都改为「循环内只累积 `UpdateRecordParameters[]`，循环外调用一次 `addSyncRecords()`」。该批量入口本就存在（内部一次去重 + 一次 `Range.Value2` 二维写入），此前仅 `github-sync.ts` 在用。写入次数由 N 降为 1，全表去重扫描由 N 次降为 1 次。
- **语义保持**：`_doAPISync` 阶段 1 之后紧跟 `getAllSyncRecords()`，批量写回仍在其之前执行，顺序不变；循环中因用户停止而 `break` 时，已累积的记录照样落盘，与原逐条写入的可见性一致；保留原有的 `typeof addSyncRecords === 'function'` 守卫。
- **回归锁**：新增 `tests/progress-reporter.test.ts`（17 条），核心断言是「**50 / 20 个任务时 `addSyncRecords` 只能被调用 1 次**」，改回逐条写入即失败。此前 `applySync*Results` 在两个测试文件里都被 `vi.mock` 掉了，无任何真实覆盖（该模块原覆盖率 6.66%）。全量 1873 条绿（52 文件）。

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

### 修复（数据安全 · 三处内联 `Range.Value2` 读入口收敛，§8 待办①）

- **问题**：`readLocalEntries` / `batchWriteNewRows` / `batchUpdateRows` 各自内联 `Range.Value2` 读，形状归一化各写一份。其中 `readLocalEntries` 有真 bug：本地只有 **1 条数据**时单行范围返回**一维**数组，`Array.isArray(raw)` 后直接当二维用 → 该行每个字段读成空串 → SID 提取失败 → 该行被跳过 → 远程同一 SID 被判为新增，**重复写一行**（与 §5.4 已修的 sync-record / enrich-engine / batchWriteNewRows 同类，唯独此处漏了）。
- **改法**：三处读路径全部改走统一入口 `readRangeValues` / `readRangeCellValues`（内部 `readRect` 的形状守卫只有一份：单行一维按请求形状升维、多行多列读回一维判读失败、宽度不足判读失败）。`readLocalEntries` 以「读回行数 === 请求行数」判可用（`readRangeValues` 无法区分真空区域与读失败），不符即回退逐格读并补一条 WARN；`batchUpdateRows` 读走 readRect、写单独取 `Range`（比旧实现「读+写复用同一 Range」多一次 Range 获取，换来形状守卫不漂移）；`batchWriteNewRows` 探测读必须保留原始类型（数字/日期列基线不能 `String()` 化）。**写路径仍用 `Range.Value2` 批量写**（有意的性能优化，形状由构造方保证）。
- 测试：`readRangeCellValues` 桩补进 3 个 mock（github-sync / github-sync-core / sync-flow），默认从 `getCellValue` 造保留类型的二维数组（宽度自动匹配，行为贴近真实宿主）；`readLocalEntries` 的「单行一维归一」回归归属 `tests/sheet.test.ts`（同一 `readRect`），原用例改为锁定读-改-写基底逻辑。

### 改进（可观测 · 数据源脏记录不再静默跳过，§8 待办②）

- **问题**：分片拼接后缺合法 sid 的记录按「与 `parseJsonl` 一致的非法行不中断口径」静默跳过，只进 WARN 日志。用户看到的是「下载了 N 条、只同步了一部分」却说不出原因。
- **改法**：`loadEntriesFromPath` 回报 `skippedInvalidRecords` → 各源 `fetchXxxJson` 经**可选出参** `FetchLoadStats`（不改返回类型契约）写进 `BaseSyncSource.loadStats`（实例级，每次同步新建实例，不串数据）→ `syncFromGithub` / `syncFromRemote` 填 `GithubSyncResult.skippedInvalidLines`（仅 >0）→ 结果弹窗新增「⚠️ 数据源含非法记录」段（与 `missingColumns` 同口径）。Gist 单片源保持原行为（全非法抛错、部分非法 WARN）。
- 新增覆盖：shard-fetch 2 条断言、github-sync 出参透传 2 条、syncFromRemote 2 条、gitee/gitlab/local-file 各 2 条（含「干净同步整体覆写不累加」）。

### 移除（死代码 · 孤儿页面 `panel-preview.html` 与死分支，§8 待办③）

- **四步判定**：① TS 无引用；② 构建入口无（rollup input 只有 `index.html`，`ui/*` 拷贝是 glob 不点名）；③ HTML/XML 无交叉引用、任务面板 URL 是 `ui/panel.html`；④ 无动态构造。连带删除只被它引用的 `css/preview.css`。
- **连带清理**：`ts/panel/user-info-polling.ts` 同步 `#chkIncremental` 复选框的分支随该控件消失（panel.html 的「仅同步变更」已收拢到设置页，主面板无此控件，该分支永久空转）；对应 4 条测试用例随死分支删除，`isIncrementalSyncEnabled` 从该测试 mock 移除。
- 同步更新：`ARCHITECTURE.md` 模态框清单、`ui-and-interaction.md` 调试 URL、`图标规范.md` 适用范围、`audit-layout.mjs` 注释、`TECH_KNOWLEDGE_COM_DATA_SAFETY.md` §8 与 §5.1（11 项「实际已修」补标注）。**旧日期文档与历史条目不改**（`TS_AUDIT_2026_09_10.md` 等）。

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
