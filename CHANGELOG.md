# 更新日志（CHANGELOG）

> 本文件按「内部功能版本」记录重大变更。注意：`package.json` 中的 `version` 字段（当前 `1.0.0`）为 npm 包发布版本，与本文档的 `v3.x` 内部功能版本相互独立，二者不要求一致。

本文档与 [`文档/USER_OPERATIONS.md`](文档/USER_OPERATIONS.md)（用户手册版本历史）、[`文档/ARCHITECTURE.md`](文档/ARCHITECTURE.md)（架构文档版本历史）互为补充：架构级变更以架构文档为准，操作级变更以用户手册为准，本文件提供跨文档的总览索引。

---

## [未发布]

### 规则管理器交互缺陷一轮修：分组收起 / 重命名 / 解散、上移下移、浮窗可拖（2026-10-24）

momo 实测「规则管理器」（条件格式页「既有规则」表格 + 三个模态框）六个缺陷，
根因各不相同，逐条修；顺带补登今早已经先行入代码、尚未入档的功能
（本地分组 / 行内改范围公式 / 可选择导入 / 导出 JSON，见文末）。

**① 分组点 ▾ 不收起来** —— 折叠 CSS 的选择器
`.conditional-format-group.is-collapsed .conditional-format-rule` 只对
**规则库列表**的行生效；既有规则表格的行是 `.conditional-format-row`，
选择器根本没命中它。状态机（`existingGroupCollapsed`）、▾/▸ 按钮、
`aria-expanded` 全都在，唯独 CSS 漏了行类名。补第二个选择器，并加用例
钉死 HTML 侧契约（`is-collapsed` / ▸ / `aria-expanded`）——这个契约
断过一次，断得毫无声息。

**② 点「上移/下移」像「变成了新分组」** —— `moveForeignRule` 用的是
`SetFirstPriority` / `SetLastPriority`，这两个是**绝对置顶 / 置底**：
点一次「上移」，第 20 条瞬移到第 1 条；分组视图按「组名桶 + 首现顺序」
渲染，整组跟着跳到表顶。tooltip 写的「上移（提高优先级）」是一格，
实现就必须是一格。改为**相邻交换**：两条规则互换 `Priority`（宿主负责
重排其余名次），写后**回读校验**——宿主忽略写入时 Priority 原样不动，
返回「写入未生效」的明确错误，不静默跳位置（项目铁律：写不进去就明说）。
附带修一个同源错位：`getForeignCondition` 走 UsedRange 级集合而读取走
Sheet 级，两个集合条目不一致时，表格第 N 行点「上移」动的是**另一条**
规则；现在统一「Sheet 级优先、老版本回退 UsedRange」，与读取同序。
新增 `tests/conditional-format-apply.test.ts`（假工作表 + 间谍）钉死：
只与邻居交换、两个 `Set*` 一次都不调、索引空间对齐、三类诚实失败。

**③ 分组不能手动命名 / 不能解散单个组** —— 组标题此前只有 ▾/▸，唯一
归组入口是「先勾行 → 批量条 🏷」，不符合「看到组名就能改」的心智。
组标题补 ✎（重命名：弹窗预填旧组名，确认后组内**全部**规则换组名）与
✕（解散：规则回「未分组」，不从工作表删除）。纯函数
`renameGroupMapping` / `dissolveGroupMapping` 落在 rules.ts 引擎层，
页面只接线；非法入参返回 null 由页面 toast，不静默成功。重命名后同步
清掉折叠集合里的旧名（不清则用户点展开永远匹配不上）。

**④ 编辑器浮窗拖不动 / 显示不全 / 取消按钮没描边** —— 模态框位置此前
完全由 CSS 决定（遮罩 absolute + top=scrollY 锚定，5022d6d1 的方案）：
页面滚动后模态框会落在可见区外（实测标题栏被切半个），用户还没法移动它。
新增 `ts/ui/components/modal-drag.ts`：标题栏把手 + 指针拖动（rAF 合帧、
视口钳制保证 ≥96px 可抓宽度，「拖出去找不回来」是最糟失败模式）、打开时
`bringModalIntoView` 量一次越界就 scrollBy 修正并**重锚遮罩 top**、每次
打开 reset 回居中位。四个模态框（编辑器 / 导入 / 组名 / 确认）同款接入。
窄任务窗格（<430px）下颜色行（选择器 48 + hex 文本 92 + 加粗框 ≈ 400px）
溢出模态框宽度出横向滚动条 → `flex-wrap: wrap`。「取消」没描边是因为
`.bgm-btn` 基类描边是 `transparent`、只有 primary 等变体可见 → 本页弹窗内
的次级按钮补 `border-strong`（不动全局按钮语言）。新增
`tests/modal-drag.test.ts`（jsdom + 真实指针事件）11 例：位移、钳制、
交互目标 / 非主键不启动、pointerup 补 flush、reset、bringModalIntoView
三分支。

**⑤ 联动缺陷：范围读不到的规则永远无法分组** —— 渲染层用行上的 `range`
（读不到时是显示兜底「（未读到范围）」）现算分组 key，存储层却用**原始**
范围存——两者永远对不上，这类规则死死掉进「未分组」，归组 / 重命名对它
全部静默失效。改为快照阶段预计算 `groupKey` 上行，渲染与存储同口径。

### 条件格式「规则管理器」三连发（2026-10-24，补登）

今日上午先行入代码、当时未入档的三个提交，随本轮修 bug 一并补登：

- **`a9079a5a`** 全选可点（三态半选）+ 分组收起展开 + 编辑器改浮动弹窗
  （独立于任何 section，「规则管理器」拖成浮动窗时也能编辑）+ 颜色三件套
  （选择器 / hex 手输 / 吸管，吸管失败不再静默）。
- **`3c193a8a`** 「应用于 / 公式」单元格点击原地变输入框（Enter/blur 保存、
  Esc 取消，写 COM 失败 toast + 还原）；导入手工规则改可选择弹框
  （公式类默认全选、不可导的禁用标注、全选/全不选快捷）；规则库导出 JSON。
- **`b8d548fd`** 既有规则本地分组：手动归类（批量条）+ 自动聚类（按公式
  模式，只归一字面串不动数字）+ 导入时组名带进规则库；分组映射按
  「公式@范围」稳定 key 存 PluginStorage（不用会漂移的序号）。

### 专注模式：只显示单个模块，可上下切换（2026-10-22）

`ts/tools/module-state.ts` 新增专注模式。每个模块标题（折叠按钮旁）多一个
「⛶ 只显示此模块」按钮，点它 → 本页只剩这一块，底部浮出控制条
（模块名 + ↑ / ↓ + ✕ 退出专注）。

- **与「隐藏」叠加而非替换**：用户原本隐藏的模块退出专注后还是要藏回去。
  专注模式只是临时视图，不吃掉配置。
- **目标模块强制展开**：收起状态进专注模式只看到一条标题栏，用户会以为功能坏了。
- **↑/↓ 遍历全部 DOM 中存在的模块**（含没有标题按钮的跨栏操作区）——
  它是「把每块都看一遍」的导航，跳过某块的后果是用户永远翻不到它。
- **专注时不弹「全部隐藏」兜底提示**：那是用户主动选的，不是误藏空；
  出口是控制条上的「退出专注」。
- **状态不持久化**：专注模式是「视图」不是「配置」。若写进
  `bgm_module_hidden`，退出时得把用户原来的隐藏集合原样还原（漏一个就丢配置），
  还会和设置页编辑器、跨页轮询、导入导出全缠在一起 —— 为「刷新后还在专注」
  这一点收益背一身状态，不值。刷新即退出，符合「临时看一眼」的语义。

按钮是**运行时注入**而非像折叠按钮那样写进 HTML：折叠按钮与 `PAGE_MODULES`
是一一对应的平行清单，必须静态可查（nav-order 门禁靠它抓「漏一个按钮」）；
专注按钮对所有模块是同一套逻辑，写 37 份纯属复制粘贴，漏一个也不影响其它模块。
故用注入 + 事件委托（与折叠按钮同套路，均幂等）。

新增单测 12 例（module-state 55 → 67）：只放行目标、锚点同步隐藏、强制展开、
退出恢复原状、拒绝未注册 id、循环轮转与越界回绕、非专注时 step 为空操作、
不弹全隐藏提示、注入幂等、点按钮进出、高亮跟随、控制条 ↑↓✕ 行为。

### Ribbon「关闭所有页面」：一键收起全部任务窗格（2026-10-22）

ribbon 新增 `btnCloseAllPanels`（Bangumi 组内，设置按钮之后），
图标 `images/closeAllPanels.svg`。

核心实现在 `tools/util/index.ts` 的 `closeAllPanels()`：遍历六个页面的 ID
存储键（`panel_id` / `enrich_pane_id` / `clean_pane_id` / `highlight_pane_id` /
`conditionalFormat_pane_id` / `settings_pane_id`），把可见窗格置 `Visible=false`。

**为什么是「置不可见」而不是清存储或 Delete**：

1. 清 ID 会让下次打开走 `CreateTaskPane` 重建，旧窗格还挂着只是看不见，
   最后堆出一串孤儿窗格（`pane-alive.ts` 记着这个坑）；
2. WPS 的 TaskPane 没有可靠销毁入口，删了对象反而让 `GetTaskPane` 返回 null，
   下次打开又要重建；
3. 置不可见可逆：下次点任意「打开 XX」，`showXxxPanel` 拿到缓存 ID、校验心跳
   （页面还活着）→ 直接切回 Visible，不重建、不丢页面状态。

只统计「原本可见」的窗格，否则按钮反馈「已关闭 6 个」但用户只开了 2 个。
读 `Visible` 与写 `Visible` 放在同一个 try 里 —— 两者都可能抛（宿主正忙 /
属性被占用），单个窗格失败不中断其余关闭。ribbon 侧按关闭数量播报 toast，
0 个时明确说「当前没有打开的工具页面」（否则用户以为按钮坏了）。

新增单测：utility-index +6 例、ribbon +3 例。

### 目标工作表：跨页「一键套用」+ 条件格式/高亮补「锁定」（2026-10-22）

五个页面各有一份「目标工作表」选择，此前的共享只到「通知条展示」——
高亮页选了表，跑到主面板还要把两级下拉重新点一遍。本轮补两块。

**① 通知条升级为「一键套用」**

`ts/tools/data-context.ts` 新增 applier 注册表（`registerTargetSheetApplier` /
`applyDataContextToPage` / `hasTargetSheetApplier` / `resetTargetSheetAppliers`）：

- 通知条上多一个「↧ 套用到本页」按钮，只在**本页注册过 applier** 时出现
  （清理页是多选语义、设置页没有目标表，给了也做不到，不如不给）；
- 点击后把快照里的 工作簿/工作表 落到**本页自己的键**上，按钮变「✓ 已套用」
  并禁用；失败变「✗ 套用失败」并在文案里说明「当前不可用」；
- applier 抛错不外溢（`applyDataContextToPage` 整体 try），便利功能不该把页面搞崩；
- **为什么用注册表而不是在 tools 层直接写各页的键**：tools 层反向 import
  panel/* 会成环（check:cycles 会红），且各页键格式不同、套用后往往还要
  顺带刷新预览，落到页内最自然。

四个页面注册了自己的实现：

| 页面               | 落到哪里                                        | 成功后还做什么                               |
| ------------------ | ----------------------------------------------- | -------------------------------------------- |
| panel              | `saveLockedSheet(..., 'panel')`                 | 切下拉 + `refreshSheets()` + `refreshData()` |
| enrich             | `lockEnrichSheetByName()`（新增，按名反查索引） | 刷两级下拉 + `selectTargetSheet()`           |
| highlight          | `setConfig('highlight.sheet', 'wb::sheet')`     | 重渲下拉 + `resetSheetData()`                |
| conditional-format | `setConfig(KEY_SHEET, ...)`                     | 重渲下拉 + `loadExistingRules()`             |

面板/富化走 `saveLockedSheet` 而不是直接改 `BGM.sheet`：持久化要跟上，
否则下次重开面板锁就丢了。索引**按名字反查**（新增
`lockEnrichSheetByName`）—— 索引跨会话会因用户增删表而漂移，名字不会。

**顺带修一个 bug**：`snapshotFromWorksheet` 曾把 `worksheet.Name` 同时填进
`workbook` 和 `sheet`，通知条于是显示成「动画 / 动画」，「一键套用」也无从
知道该切到哪个工作簿。现改为 `worksheet.Parent.Name`，取不到退
`ActiveWorkbook.Name`。

**② 条件格式 / 高亮补「锁定目标工作表」**

先说清楚**没有做的部分**：这两页原本就只有「选中键失效时兜底跳到活动表」
这一条路径会被活动表影响，用户手动选的表在有效期内本来就不会被覆盖 ——
所以「锁定后不被活动表切换覆盖」这个需求，**代码层面已经满足了**。

真正补的是**兜底策略**：勾选「锁定目标工作表」后，选中键失效（目标簿被关 /
目标表被删）时**不静默跳**到活动表或第一张，而是在工作表下拉里放一条
「⚠️ 原目标表 X 已不存在，请重新选择」。

理由：条件格式是**写操作**，静默应用到错表的代价比选不到表更高；高亮同理
（清/应用高亮都是写）。把「应用到哪张表」的决定权交回用户，而不是替他猜。

- 新增配置键 `conditionalFormat.sheetLock` / `highlight.sheetLock`（默认 `0`，
  保持既有兜底行为，升级无感）；
- 勾选/取消都立即重渲；**解锁时若正处于「原表已不存在」状态，会立刻补一次
  兜底定位**——否则用户要等到下次刷新才能选到表（解锁却选不了，像按钮失灵）；
- 用户主动切簿/切表会退出该状态，提示条不会赖着不走；
- 清理页**不加**：它是多选勾选语义，锁单张表没有意义。

### 修「主面板/设置打不开」：全局 wpsjs 绕过 patch，页面陷入刷新循环（2026-10-22）

**症状**：控制台刷 `Main resource content verification failed: http://127.0.0.1:3889/ui/panel.html`，
且**主同步面板、设置页打不开**，其余 4 个页面正常。

**根因不是 patch 失效，而是跑的根本不是打过 patch 的那份 wpsjs**：

- `patches/wpsjs+2.2.3.patch`（`prepare: patch-package` 自动应用）只作用于
  **项目本地** `node_modules/wpsjs`；
- 而 3889 上实际跑的进程是 `C:\Program Files\nodejs\node.exe ...\AppData\Roaming\npm\node_modules\wpsjs\src\index.js debug`
  —— **全局安装**的那份，没打 patch；
- 于是 wpsjs 继续往每个 `.html` 的 `<body` 前注入
  `<script src="./hot-update-inject.js">`，HTML 被改写 → 宿主报内容校验失败。

这条注入**不只是红字**：注入脚本里
`new EventSource('/hot-update/<rand>')` 收到 `{update:true}` 就执行
`window.location.reload()`，而 wpsjs 的 `rcWatch` 监听项目根目录 ——
`tsc --watch` 每次重写 `dist-ts/` 都推一次 update。**模块链最长的两个页面
（主面板 / 设置，各 142 个模块）永远加载不完**，表现为「打不开」；模块短的
页面在刷新间隙能被看到，所以另外 4 个页面看起来正常。

**修复**：

1. 新增门禁 `scripts/check-wpsjs-patch.mjs`（`npm run check:wpsjs-patch`），
   守三条：① 本地 wpsjs 两个 server 文件都带 patch 标记（node_modules 被
   重装即发现）；② **运行中的 3889** 返回的 panel.html 不含注入脚本 ——
   这一条直接对应用户症状，能在 gate 里当场抓住；③ 全局 wpsjs 若存在且未
   patch 则 WARN（提示 PATH 歧义风险：npm script 内优先本地，手工敲
   `wpsjs debug` 会解析到全局）。
2. 接入 `gate`；`debug` 脚本前置该自检（旧 server 还活着时会当场 FAIL 拦住）。
3. 全局副本的检测同时探 `npm root -g` + `%APPDATA%/npm/node_modules` +
   `C:\Program Files\nodejs\node_modules` —— 单靠 `npm root -g` 在
   managed node 环境下会漏判（本次就是这么漏的）。

**处置**：结束全局 wpsjs 进程，改用 `npm run debug` 重启（npm script 内 PATH
优先本地已 patch 的 wpsjs）。**注意**：在受限 shell 里 `npm run debug` 起不来
—— wpsjs 用 `REG QUERY HKEY_CLASSES_ROOT\KWPS.Document.12...` 探测 WPS 是否
安装，`reg.exe` 被沙箱拦会导致 `WPS未安装` 假报错，需在用户自己的终端执行。

### 测试基建：`isolate: false` 实测不可用，结论写进配置（2026-10-22）

vitest 每轮收尾都提示"至少可再省约 49s/轮"。本轮三轮实测证伪，把数据与理由
留档在 `vitest.config.ts`，避免后来者被提示无脑带跑：

- 基线（isolate 默认 true）：153 文件 / 4837 用例全过，**60.6s**。
- `--no-isolate` 跑三轮，**没有一轮既通过又更快**：
  - 第 1 轮：12 个文件 / 272 个用例失败，134.7s；
  - 第 2 轮：48.1s 处异常中断（未产出汇总，退出码非 0）；
  - 第 3 轮：8 个文件 / 102 个用例失败，192.3s。
- 两轮失败的文件集不同（第 1 轮含 gitee-sync，第 3 轮是 utility-index /
  nav-order / scraping 等）——**污染对象随文件执行顺序漂移**，这正是模块
  注册表跨文件共享的典型症状，比单纯失败更说明问题。
- 根因：worker 复用后模块注册表跨文件共享，模块级单例互相污染（实测
  gitee-sync 的 `getGithubConfig()` 读到上个文件留下的 undefined）。
- 本套件刻意依赖「每文件一个全新模块注册表」做隔离——例如
  `tests/enrich-page.test.ts` 文件头说明：`enrichWatchTimer` 等模块级状态
  一旦被某用例改写就再也拿不回初值，相关分支必须靠独立文件保证干净。
- 若未来要再评估：前置条件是先消灭跨文件污染的模块级单例（配置缓存、
  `_activeProgress`、`geometryMemory` 等），那是独立的还债项。

### 批量富化进度改浮动卡片（detach）：跑多久都能继续操作页面（2026-10-22）

批量富化此前的进度条是页面内嵌（inline）的：占页面布局，用户一滚动就滚出
视野，想看进度得滚回来。`detach` 模式（右下角浮动卡片）自通用进度组件支持
三模式起就**没有任何生产调用方**，本轮把它接到批量富化。

- `ts/panel/enrich-progress-hosts.ts` 新增 `createFloatingProgress(title, icon, onStop?)`
  工厂（`mode: 'detach'`，挂 body 右下角 `.bgm-progress__dock`）；文件头注释从
  「三处内嵌进度」更正为「两处 inline + 一处 detach」。
- `ts/panel/enrich-page.ts`：
  - `showBatchProgress()` 改建浮卡；**创建前先回收上一轮的完成态卡片**，连续
    两轮批量不会在右下角堆 dock。
  - 收尾从 `hide()` 改为 `finishBatchProgress()`：卡片切**完成态并保留摘要**
    （`N/N 个文件 · 成功 X · 失败 Y · 匹配 Z`，取消时 `ok: false` + 「批量富化
    已停止」）。批量可能跑好几分钟，用户早已滚到别处，卡片是唯一的「跑完了」
    提示；页面汇总（`batchSummary`）仍是详细视图，两者互补。
  - `renderBatchFileList()` 清空列表时回收完成态卡片，但**富化进行中不回收**
    （用户可能正靠着卡片看进度、点「停止」）。
- `ts/ui/components/progress.ts`：`complete()` 的「焦点移到关闭按钮」收紧为
  仅 `modal` —— detach 是非阻塞浮卡，用户完成前可能正在页面别处输入，把焦点
  拽到角落会打断操作；inline 完成态同样不抢焦点。
- 移除随之失效的页面宿主：`ui/enrich.html` 的 `#batchProgress` /
  `#batchProgressHost` 与 `css/enrich.css` 对应规则（测试夹具同步移除）。
- 单测：`enrich-progress-hosts.test.ts` 补 `createFloatingProgress` 4 用例
  （detach 模式 / 不传 hostId / onStop 开关 / 返回值透传）；`enrich-page.test.ts`
  的批量进度用例改走浮卡 mock，新增「完成态保留摘要不 hide / 取消态 ok:false /
  两轮回收旧卡 / 跑完后清空回收 / 富化中清空保留」5 条；`progress.test.ts` 补
  「detach 完成态不抢焦点」与「modal 完成态收拢焦点」两条对照。
- 踩坑记录：新用例「连续两轮批量」若不在结尾 `await` 第二轮跑完，在飞的
  `runBatchEnrichment` 会泄漏到后续用例——它的 `finishBatchProgress` 会对当时
  的 `progressHosts.batch`（已是下一个用例的卡片桩）补调 `complete`，表现为
  「单独跑通过、全文件跑挂」。**起了 async 流程的用例必须自己收尾。**

### 日志区滚动合帧：一行日志一次强制布局 → 一帧一次（2026-10-22）

与浮动窗口卡顿同源的第二个热点：进度日志 / 清理日志**每追加一行**就执行一次
`box.scrollTop = box.scrollHeight`。**读 `scrollHeight` 会强制同步布局（reflow）**
—— 一行一读，4000 行同步日志就是 4000 次强制布局，日志刷起来时任务窗格卡成
幻灯片。（写 style 不强制布局，浏览器在一帧的绘制点统一算一次；**读**才强制。）

- 新增 `ts/ui/dom-scroll.ts`：`scrollToBottomCoalesced(element)` —— 把
  「读 scrollHeight + 写 scrollTop」合帧，同一帧内的多行日志只读一次、帧末统一
  滚动；元素粒度去重（WeakMap，无需调用方管理生命周期）；无 rAF 的环境退化为
  同步执行（单测 node env 行为不变）。
- 接入两处逐行滚动：`ui/components/progress.ts` 的 `log()`（同步进度弹窗实时
  日志）与 `panel/clean-page.ts` 的 `appendLog()`（清理页日志区）。
- 单测：新增 `tests/dom-scroll.test.ts`（4 用例：一帧一次 / 元素粒度隔离 /
  跨帧各滚一次 / 无 rAF 降级）；`progress.test.ts` 补「三行日志零读取、帧末一次」
  的计数 getter 观测用例。
- 说明：`log-panel.ts` 的日志弹窗是整面板重渲染后只滚一次，本就不热，未改动。

### 浮动窗口卡顿根治：拖动走 transform 合成层 + 顶栏去逐帧模糊（2026-10-22）

上一轮修了「越拖越快」与 rAF 合帧，但**拖动仍掉帧**——真机拖着预览表几百行的
浮动窗口明显卡。根因不在事件层，在样式层：每帧写 `left/top` 会让浏览器
**重排 + 重绘整个面板内容**（几百行的预览表 / 规则表，一帧几十毫秒）。

- **拖动只写 `transform: translate()`**：位移相对 pointerdown 时捕获的基准几何
  计算（钳制逻辑不变，窗口仍永远完整留在视口内）；pointerup 时把「基准 + 最终
  位移」一次性提交回 `left/top` 并撤掉 transform —— 几何的单一来源始终是 `rect`，
  transform 只在拖动期存在。`bindDrag` 为此新增 `onEnd` 回调（保证先 flush 再提交，
  一个 rAF 都没等到就松手也不丢最后几像素）。
- **`.is-dragging` 挂 `will-change: transform`**：提示浏览器把面板提成合成层，
  每帧只做层平移，内容一次都不用重画；类随拖动结束即撤，不常驻占显存。
- **拖动期正文 `pointer-events: none`**：鼠标扫过表格行触发的 `:hover` 背景重绘
  一并省掉（pointer capture 在标题栏上，不影响拖动本身）。
- **缩放只写 `width/height`**（内容要重排，改不了定位方式），少两个属性的样式失效；
  标题栏与缩放手柄补 `touch-action: none`（触屏拖窗口不当成页面平移）。
- **顶栏去掉 `backdrop-filter: blur(10px)`**：sticky 顶栏滚动时要对背后内容逐帧
  模糊，WebView 里足以让整页滚动掉帧；浮动窗口拖过顶栏区域时每帧还要再模糊一次。
  换成不透明 `--bg-topbar`（`#141414` / `#f5f6f8`），观感几乎不变、开销归零。
- **native 模式轮询 1s → 2s**：每轮两次 COM 往返（`GetWebDialog` + `Visible`），
  占位块最多多留 1 秒，宿主演入减半。
- 单测：新增 `tests/detachable-panel-drag.test.ts`（6 用例，jsdom 真实指针事件：
  拖动中只写 transform / 提交落定 / 不等 rAF 松手不丢像素 / 拖动中仍受视口钳制 /
  连续拖动不重复累加 / 还原后几何记忆无残留）；native 轮询间隔回归同步更新。

### 目标表识别结果缓存：面板 / 富化打开不再全簿全表扫描（2026-10-22）

面板与富化页打开时都调 `findBangumiTargetSheets()`：遍历每个已打开工作簿的每一张
工作表（读表头、数数据行、比名称关键词），工作簿一多首帧就被 COM 扫描拖住。

- 新增 `ts/tools/target-detect-cache.ts`（零 COM 依赖、存储可注入）：
  `readWorkbookSignature(app)` 抽自富化页两页共用，签名 `Count|各簿Name|活动簿名`
  —— **含活动簿是刻意的**：两页候选排序都把活动簿排最前，只有签名含它，才能保证
  「命中缓存」≡「此刻全扫也会得到同一答案」。
- `load / save / clearTargetCache`：PluginStorage 键 `bgm_target_detect_cache`，
  按用途（panel / enrich）分开存；内容损坏 / 存储不可用一律视为未命中。
- `locked-sheet.ts` 新增 `resolveCachedTarget()`：按「索引提示 + 名称复核」定位并
  带回最新索引，再清一次该表缓存、读 1 次表头；表被删 / 表头丢失 → 判缓存失效。
- `panel-lifecycle.autoDetectSheet` 与 `enrich-lock.autoSelectEnrichTarget` 先查缓存，
  复核通过直接返回（≈ 3–5 次 COM），未命中才全扫并回写；新增 `options.force`。
- **手动刷新强制重扫**：面板工作簿下拉切换、富化页刷新按钮都走 `force`，缓存不会
  成为死角。
- 富化页打开检查顺带删掉一次重复全簿扫描（日志复用 `mergeDetectedPathsIntoStorage()`
  返回值）；`enrich-page.ts:726` 的「已锁定早退」语义风险已单独评估并处理。
- 已知取舍：同组工作簿内**新增第二张追踪表**不会失效签名（点刷新即回到全扫语义）；
  表头行变化会多 1 次矩形读复核。
- 单测：新增 `tests/target-detect-cache.test.ts`（18 用例）；`panel-lifecycle` +3、
  `enrich-lock` +4；vitest 151 文件 4816 用例全绿。

### 锁定各页独立键 + 数据上下文跨页重放 + 浮窗显式「还原」按钮（2026-10-21）

- **锁定各页独立键**：panel 与 enrich 曾共用 `bgm_locked_sheet` 一把锁互相覆盖
  （面板锁 A 表 → 富化页锁 B 表 → 回面板锁丢了）。`saveLockedSheet` /
  `restoreLockedSheet` / `clearLockedSheet` / `getLockedSheet` 增加 `page` 参数，
  键名变为 `bgm_locked_sheet_<page>`（panel / enrich 各存各的）。
  **注意**：旧键 `bgm_locked_sheet` 不再读取，升级后首次需重新锁定一次。
- **数据上下文跨页同步（进入时重放）**：新增 `ts/tools/data-context.ts`——
  页面获取到工作簿 / 工作表 / 列 / 行后写入 `bgm_data_context`（enrich 在
  识别表头成功时、highlight 在「加载并预览」时写入）；其它页**进入时**读一次
  并在 `<main>` 顶部重放成可关闭的通知条（「📋 富化页已获取：wb1 / Sheet1 · N 列 · M 行 · HH:MM」）。
  零轮询：只在「写入时」与「进入时」各碰一次存储，与卡顿根因（周期性同步 COM）划清界限。
  已接 reader：enrich / highlight / clean / panel；writer：enrich / highlight（其余页可后续接入）。
- **浮窗头部显式「还原」按钮**：右侧三个图标（▾ 折叠 / ⤢ 最大化 / ✕ 关闭）曾被当成
  「刷新窗口」——没人猜得到 ✕ 是「放回页面原位」。✕ 换成文字按钮**「还原」**，语义自明。
- 单测：新增 `tests/data-context.test.ts`（8 用例）；`enrich-lock.test.ts` 更新为各页独立键
  并补「enrich 锁不覆盖 panel 锁」隔离用例（77 用例）。

### 浮动窗口拖动 / 缩放掉帧修复 + 原位置「还原」按钮（2026-10-21）

用户反馈窗格内 float 浮动窗口拖动与缩放掉帧。查下来掉帧只是表象，同段代码里
还藏着一个**更严重的正确性 bug**：

- **窗口越拖越快（真 bug，必修）**：每帧用「当前 `rect` + 累计位移」算绝对位置，
  而 `rect` 已被上一帧改过 —— 位移被**重复累加**，拖一下窗口会飞出去。改为在
  pointerdown 时捕获**基准几何**，之后每帧用「基准 + 累计位移」计算。
- **掉帧三处**：① `readViewport()`（`window.innerWidth/Height`）逐帧调用，有挂起
  样式变更时会触发强制布局；② pointermove 未合帧，一帧内多次写 style 触发多次
  「样式重算 + 布局」；③ 置顶用的 `document.body.append(root)` 每次 pointerdown
  都执行，而重复 append 等于「移除再插入」 → 整树样式重算。
  改法：视口在 pointerdown 读一次并复用；用 `requestAnimationFrame` 合帧（一帧最多
  写一次 style）；已是 body 末元素时不再 append。
- **原位置还原入口更直白**：拖出后占位块上的按钮由「收回」改为「**还原**」并补
  提示文案（「关闭」容易被理解成把内容丢掉，而区块其实一直在、只是搬去了窗口里）。
- 说明：float 模式标题栏 `✕` 本就能把区块搬回原位；`native` 模式是宿主独立窗口
  （另一个 WebView，节点搬不过去），用户在 WPS 里点系统关闭后本页收不到事件，
  只能轮询 `isAlive()`，因此该窗口**内部**无法提供还原入口 —— 回路是原位置的
  「还原」按钮。

### 全量 COM 调用审计（2026-10-21）

为定位「初始化期自动 COM 撞宿主窗口」的扩散面，对源码做了一次全量扫描：

- `getApp()` 共 **118 处**；COM 密集文件：`tools/util/index.ts`(131)、
  `tools/locked-sheet.ts`(39)、`panel/panel-lifecycle.ts`(37)、
  `sync/workbook-auto-detect.ts`(35)、`services/ribbon-service.ts`(30)、
  `panel/enrich-page.ts`(30)。
- 仍存在「打开就自动读表」的页面：`clean`（`getDataSheet`）、`enrich`
  （`ActiveWorkbook.ActiveSheet`）、`panel`（`ActiveSheet`）—— 与高亮页此前的
  70 秒卡顿同一根因，计划改为显式选工作簿/工作表（复用 `tools/sheet-list.ts`）。
- **待决策**：`panel` 与 `enrich` 都往同一个 `bgm_locked_sheet` 键写锁，会互相
  覆盖 —— 这是「锁定跨页不同步」的根因之一，锁的归属需先定。

### 高亮页改为显式选簿/表/识别列：不再自动读、不再轮询（2026-10-21）

上一轮「重分片按需 + 闸门延迟」虽绕开了首屏卡死，但本质仍是「打开就尝试读表」——
只是把重读推迟到用户点击。用户指出更直接的做法：**让我自己选工作簿、工作表、识别列，
不要轮询**。于是高亮页改为纯显式选择：

- **两级下拉选工作簿 / 工作表**：抽 `collectSheets` / `activeWorksheet` 到共享
  `ts/tools/sheet-list.ts`（条件格式页同步复用，去掉重复实现）。首屏只枚举**表名**
  （轻量 COM，条件格式页已验证秒开），默认定位到「上次选的表 > 活动表 > 第一张表」。
- **「识别列」显式选**：原来 `resolveSource` 自动从 开播季度/开播日期/完播日 里猜；
  现下拉列出全部列，默认「自动识别」，也可直接指定任意一列来识别季度。
- **数据 100% 按需**：初始化只跑「恢复配置 + 事件接线」两个轻分片，**绝不读单元格**；
  真正读表（findHeaderRow / getColumnMap / 大 Range 读）只在用户点「加载并预览」时发生——
  那时宿主早已 attach，稀疏同步 COM 只要几百毫秒，不再撞窗口、也不轮询。
- **去掉自动轮询**：移除「自动跟随」开关随页面打开自动注册的逻辑（仅保留手动勾选才生效）。
- **选择被记住**：选中的工作簿::工作表键写入 PluginStorage（`highlight.sheet`），下次直接定位。
- `createHighlightPagePhases` 现在只返回 2 个轻分片。

### 清理 com-ready 死代码：删除已无调用方的 heavy 机制（2026-10-21）

显式选择方案落地后，高亮页不再给任何分片标 `heavy: true`，`com-ready.ts` 里的
`heavy` 按需机制（重分片挂起 / `点此加载数据` / 自愈 / stall 优先）成了**死代码**——
既无调用方，又引用已删的 bisect 探针概念。按「不保留假防御」原则清掉：

- 删除：`ComPhase.heavy` 字段、`ComPendingMode` 的 `awaiting` 分支、`HEAVY_KEY_PREFIX` /
  `HEAVY_AUTO_BUDGET_MS` 常量、`readHeavyCostMs` / `recordHeavyCost` / `clearStall` /
  `isHeavyAutoAllowed` 导出函数、`HeavyRun` / `finishHeavyRun` / `runHeavyRun` 及
  `runComPhases` 里的重段 split 逻辑；降级兜底 UI 只剩 `点此继续初始化`（degraded）一条路径。
- **保留**：light 闸门路径（首屏零 COM + 分片 + 单片超预算降级）与降级兜底按钮，
  仍被全部 6 个页面复用，属真实兜底而非死代码。
- 单测 23 → 15（删除 8 个 heavy 专属用例及 `capturePending` 辅助）。

### 重分片改为按需：闸门延迟绕不开窗口，重活交给用户点击（2026-10-21）

上一版的「自适应延迟」真机验证**失效**，日志给出了决定性对照：

```
[comReady] highlight 闸门已开（延迟 800ms，历史 stall 0ms）
1057ms  bgm:modulesReady          ← 轻分片全跑完，按钮已可用
[WARN] [comReady] highlight 分片「读取工作表」耗时 69735ms  ← 自动跑重 COM 仍撞
点击「继续」后：STALL 642ms       ← 用户点击时只花 642ms
```

结论修正：**这个窗口不是几秒级的，靠延迟绕不开；自动跑重 COM 必然撞。** 而且同步
COM 一旦阻塞，JS 线程自己无法中断或超时 —— 只能**事先不跑**。所以：

1. **分片支持 `heavy: true`**：`runComPhases` 把分片切成「轻段 + 重段」。轻段
   （恢复配置 / 事件接线 / 启动轮询）照常自动跑，保证按钮尽早可用；**重段默认挂起**，
   首屏直接给「点此加载数据」按钮（零等待，不是卡完才给）。
2. **会自愈**：重段跑完把实测耗时写进 `bgm_com_heavy_<pageKey>`；只有「从未 stall 过
   **且** 上次实测 <= 1500ms」才恢复自动跑。真机路径：首次挂起 → 点一次（642ms）→
   清掉 stall 记录 → 之后自动跑。
3. **闸门延迟上限从 15s 降到 3s**：延迟只是等宿主 attach，实测 800ms 下轻分片
   1057ms 就跑完；继续追着 stall 抬到 15s 只会让**按钮陪着等** —— 那是纯 UX 倒退。
   重活已由 `heavy` 按需承担。

> 注：高亮页随后改为「显式选簿/表/识别列 + 点「加载并预览」按需读」（见上条），
> 不再走 heavy 挂起；`heavy` 按需机制保留给其它页面。其它页面若真机观测到
> `[comReady] … 疑似撞上宿主初始化窗口`，只需给对应分片加 `heavy: true`，无需改其它代码。

### 打开高亮页面卡 70 秒：宿主 COM 就绪闸门（2026-10-21）

真机 bisect 定位到：**不是某个函数慢，而是首次同步 COM 落在宿主的初始化窗口里**。
WPS 任务窗格在「新窗格打开 → 渲染进程 attach → COM 桥建好」之间，从渲染进程发起
任何**同步跨进程 COM**（`getDataSheet` / `Worksheet.Range.Read` / `PluginStorage`）
都会让宿主主线程与渲染进程互锁死等，直到 JSAPI 桥看门狗超时：

| 对照                                     | 结果                                              |
| ---------------------------------------- | ------------------------------------------------- |
| 只 import highlight-page，不调任何函数   | 秒开                                              |
| 调 initializeHighlightPage（3 次轻 COM） | 卡 10 秒                                          |
| 原版（3 轻 COM + 一次大 Range 读）       | 卡 70 秒                                          |
| load + `setTimeout(0)` 后再调            | **仍卡**（离 load 只有几毫秒，宿主还在等 attach） |

所以固定延迟解决不了，改为 `ts/tools/com-ready.ts` 的三层组合：

1. **首屏零 COM**：bootstrap 模块执行期只做纯 DOM（按钮门禁 / 外壳导航 / 拖出面板 /
   兜底 UI）和 `openComGate()`（只注册事件）。所有 COM 任务进队列，闸门开才跑。
2. **初始化分片**：`createHighlightPagePhases()` 把高亮页初始化切成
   「恢复配置 → 事件接线 → 启动轮询 → 读取工作表 → 渲染预览」，片间让出主线程，
   最重的大 Range 读放最后（卡了也不影响按钮可用）。
3. **自适应延迟 + 降级按钮**：单片超 800ms 预算即记 stall 并写入 PluginStorage，
   下次开该页时闸门延迟 = 上次 stall + 200ms（上限 15s）——**第二次起直接绕开窗口**；
   万一仍踩中，立即停止后续分片并弹出「点此继续初始化」（用户点击时宿主必然空闲，
   不会互锁）。

7 个 bootstrap 全部接入闸门；新增 `scripts/check-boot-com.mjs` 门禁守住
「bootstrap 顶层不得直接同步调 COM 初始化」（已反向验证）。

### 富化页工作簿监听收敛：签名对比替代全量扫描（2026-10-21）

`startEnrichWorkbookWatch` 原来**每 2 秒全量扫一遍工作簿**（逐簿逐表读取 +
完整识别），工作簿多时对 COM 的压力可感知（与真机「卡顿」症状同期出现）。
现改为**签名对比**：

- `readWorkbookSignature(app)` 只读 `Workbooks.Count` + 各簿 `Name` +
  活动簿名，拼成 `${count}|${names}|${active}`——成本比全量识别低一个数量级
  （Count 提出循环外，守 com-in-loop 门禁）；
- 签名没变 → 本轮**什么都不做**（这是卡顿修复的核心：不再每 2s 全量扫描）；
- 签名变了（数量、簿名、活动簿任一变化）→ 触发一次完整刷新与自动识别；
- 移除旧版 `ENRICH_WATCH_MAX_RETRY` 3 次盲重试兜底：改由「集合未就绪时签名
  会在就绪后变化，自然触发一次识别」覆盖，且没有「3 次用完就再也不自动识别」
  的死角；
- 新增 `isAutoSelectSuppressed` 防覆盖语义：用户手动选过表 / 主动解锁后，
  监听只同步列表，**不再自动选表覆盖用户意图**。

### 窄任务窗格适配（<400px）+ 视口自愈（2026-10-21）

用户截图显示窄窗格（约 185px）下内容挤成竖条、右侧大片黑区。处理两层：

1. **CSS 兜底**（`css/panel-theme.css`）：`@media (max-width: 400px)` 下
   收紧区块内边距，`.bgm-btn-row` / `.conditional-format-sheet-row` /
   `.stat-grid` / `.command-actions` 换行堆叠，按钮 `flex:1 1 100%`，
   表格改块级横向滚动；7 个页面共用。
2. **视口自愈**（`libs/fit-viewport.js`，7 页注入）：检测
   `window.innerWidth` 与 `documentElement.clientWidth` 偏差 ≥24px（宿主
   缩放/viewport 污染场景）时重写 `meta viewport`，并挂 resize + 1s 兜底轮询。

无头 Chrome 实测（最小窗宽 485px）clean/panel/enrich 三页 0 横向溢出
（`scripts/probe-overflow.mjs` 为诊断工具，保留备用）。

### rpcsdk 改为条件加载（消除「黑 WebView + 零日志」链路）（2026-10-21）

7 个页面不再直接 `<script src="../wpsjsrpcsdk.js">`，改为
`<script src="../libs/wps-sdk-loader.js">`：**仅当 `window.Application` 不存在
（浏览器直接打开）时才动态插入 rpcsdk**，加载项环境根本不加载。

理由（真机日志提供的证据）：

- rpcsdk 为「浏览器唤起 WPS」服务，启动后向 WPS 客户端本地服务
  `http://127.0.0.1:58890` / `ws://127.0.0.1:58892` 探测 `/version`；
- 真机实测 `ws://127.0.0.1:58892/version ... ERR_CONNECTION_REFUSED`
  （注意：是连不上，不是被 CSP 拦 —— 说明放行已生效、rpcsdk 真的在连）；
- rpcsdk 的 `onerror` 会按 `tryCount` 重试（源码 `startWpsInnderWebsocket`：
  1s 一次 setTimeout 重连），重试耗尽后走 **`InitWpsCloudSvr()` 另开一个 WebView 传参**；
- 那块 WebView 里没有我们的代码 → 表现为「多出一块黑窗格、且任何调试器都看不到
  它的日志」。这与用户报的症状（右侧黑窗格 + 零日志）吻合。
- 加载项环境宿主已注入 `window.Application`，本项目 `getApp()` 读的就是它，
  **不依赖 rpcsdk**，所以不加载没有任何功能损失。

`check:csp` 门禁新增一条防回归：页面不得直接引用 `../wpsjsrpcsdk.js`
（已反向验证）。CSP 放行 58890/58891/58892 保留 —— 浏览器调试场景仍需要。

### 回退再恢复：wpsjs 热更新注入开关（2026-10-21）

上一轮为消除 `Main resource content verification failed` 而「默认关闭
`hot-update-inject.js` 注入」，真机上出现**整个插件卡住、调试器都不出日志**，
于是先回退（注入恢复默认开启，patch 回到只补响应头的状态）。

**回退后问题依旧，嫌疑排除**：真机日志显示页面完整初始化
（`initializeEnrichPage 完成`、按钮已启用）、功能正常，卡顿/黑屏照旧。
故**关闭注入的开关已恢复**（`WPSJS_HOT_UPDATE=1` 可开回注入），
`Main resource content verification failed` 这条红字属**无害提示**——它是宿主对
「主资源内容被改写」的提示，官方确认无功能影响。

### 目标工作表拆成两级：先选工作簿、再选工作表（2026-10-21）

条件格式页（含独立窗口版规则管理器）的「目标工作表」下拉，原来把所有已打开
工作簿的全部工作表平铺在一个下拉里（`工作簿名 · 表名`），表多时难找。现改为
两级联动：

1. **第一级「目标工作簿」**：去重后的已打开工作簿列表；
2. **第二级「目标工作表」**：只显示所选工作簿下的表。切簿时原选中表若属于
   新簿则保持，否则自动选中该簿第一张。

选中值仍存 `workbook::sheet` 键（兼容既有配置迁移与记忆）；默认选中活动
工作表的逻辑不变。涉及 `conditional-format-page.ts`（渲染拆分 + 联动 handler）
与两个页面的 HTML。

### 黑屏窗格自愈：页面心跳 + 开关面板前校验（2026-10-21）

**症状**：打开部分页面时，右侧出现一块**整体黑掉的任务窗格**，没有任何日志报错。

**根因**：`showXxxPanel` 的复用分支用 `GetTaskPane(id)` 拿到窗格对象就切 Visible ——
但 **拿到 COM 对象 ≠ 页面内容活着**。WebView 内容加载失败（dev server 停了 /
页面 JS 早崩 / 宿主回收后重载失败）时，窗格对象依然「活着」，复用分支把一块
黑屏窗格显示出来，且全程只有 INFO 日志 —— 用户侧就是「黑屏 + 零报错」。

**修复**（`ts/tools/pane-alive.ts`，依赖反转：不 import util/index，日志走 tools/logger）：

1. **页面侧心跳**：6 个窗格页 bootstrap 各起一个 30s 心跳，把 `Date.now()` 写进
   PluginStorage（app 级跨 WebView 共享）。Chromium 对隐藏页 setInterval 只是节流
   （下限约 1s），30s 周期照常执行，不怕窗格隐藏时误判。
2. **开关侧校验**：6 个 `showXxxPanel` 复用分支先查心跳——新鲜才复用；
   缺失 / 过期（90s ≈ 3 个周期）/ 脏值 → 隐藏旧窗格、清 ID、**落到重建**，
   并打 WARN（一眼能从日志认出「心跳停 → 重建」这条链）。
3. 旧的自愈机制 `markXxxPaneLoaded`（url 标记）只覆盖「从未加载成功」，
   心跳把「先成功后来死了」也覆盖了，两者共存。
4. **顺带的行为变更（有意）**：富化 / 设置 / 主面板的「面板 ID 失效（用户手动关过）」
   分支从「只清存储、本次不打开（要点两次）」改为与清理 / 高亮 / 条件格式一致的
   「清完立即重建」—— 一键直达。

**覆盖面板**：主面板 / 清理 / 富化 / 高亮 / 条件格式 / 设置。新增单测 10 例
（`tests/pane-alive.test.ts`：判活 / 判死 / 脏值 / 宿主缺失 / 心跳幂等）。

### 控制台两条启动红字已消除（CSP 放行 + 关闭 wpsjs 热更新注入）（2026-10-21）

**问题**：调试启动后控制台稳定刷三类红字，其中两条是真配置问题：

| 日志                                                                     | 定性                                      |
| ------------------------------------------------------------------------ | ----------------------------------------- |
| `Refused to connect to 'http://127.0.0.1:58890/version' ... connect-src` | **真问题**（CSP 漏配，本次修）            |
| `Refused to connect to 'ws://127.0.0.1:58892/version' ... connect-src`   | **真问题**（同上，ws 协议另需放行）       |
| `Main resource content verification failed: .../ui/*.html`               | 无害但刺眼（wpsjs 改写 HTML，本次加开关） |

**① CSP 放行 WPS 客户端本地服务端口**（7 个页面统一）

`wpsjsrpcsdk.js` 初始化会向 WPS 客户端本地服务探测 `/version`，三个端口在 rpcsdk 源码里硬编码：
HTTP `58890` / HTTPS `58891` / WS `58892`。原 `connect-src 'self' ...` **既不匹配这三个端口，也不匹配
`ws://` scheme**（`'self'` 要求 scheme + host + port 全同，http 页面下 ws 不算 self），于是每页必刷一条。

已在 7 个页面的 CSP meta 里补 `http://127.0.0.1:58890 https://127.0.0.1:58891 ws://127.0.0.1:58892`
（只放行本机）。新增 `check:csp` 门禁：新页面漏配会红（已反向验证）。

> 注意：本项目 `getApp()` 读的是宿主注入的 `window.Application`，**并不依赖 rpcsdk**，
> 所以这条报错不会让功能直接挂；放行的目的是消灭噪音，并避免 rpcsdk 重试后走到
> `InitWpsCloudSvr()` → 唤醒云服务 → `status:2 "请允许浏览器打开WPS Office"` 这条会影响初始化时序的分支。

**② wpsjs 热更新注入加开关，默认关闭**

`Main resource content verification failed` 的根因不是响应头（上次的 charset/Content-Length patch 已生效），
而是 wpsjs 对每个 `.html` 请求都在 `<body>` 前插一段 `<script src="./hot-update-inject.js">`，
**改写了 HTML 内容**，触发宿主的「主资源内容校验」。已扩 `patches/wpsjs+2.2.3.patch`：
默认不再注入；需要热更新时以 `WPSJS_HOT_UPDATE=1 npm run debug` 启动即恢复。

**验证**：重启 dev server 后，控制台应只剩业务 INFO（`[getColumnMap]`、`最后数据行` 等）。

### 规则管理器可拖出为 **WPS 原生独立窗口**（native 模式）（2026-10-21）

任务窗格内的浮动窗口是 `position: fixed`，相对的是窗格 WebView 的视口 ——
**最大宽度就是任务窗格宽度**，做不到「浮在 WPS 表格上面」。故给通用组件加
`mode="native"`：条件格式的「既有规则」区块走宿主原生对话框，真浮到 WPS 上。

- **新模块 `ts/tools/wps-web-dialog.ts`**：封装 `Application.CreateWebDialog`
  （首选：返回句柄，可 `Visible` / `IsModal` / `Resize` / `Delete`，可凭 `ID` 用
  `GetWebDialog` 查存活）与 `Application.ShowDialog`（老版本降级通路）。
  两条都不存在时返回 null，组件**自动回落**到窗格内浮动窗口 —— 功能不丢，
  不会变成「点了没反应」。宽高按 `devicePixelRatio` 换算物理像素。
- **新页面 `ui/conditional-format-manager.html`**：原生对话框是**另一个 WebView**，
  本页 DOM 搬不过去，故窗口加载独立页面。但**逻辑不复制** —— 该页 id 与任务窗格
  页完全一致，复用同一份 `conditional-format-page.ts`（那份代码取元素全是
  `?.` / `if (!x) return`，缺哪个区块就跳过哪个）。
- **放得回去**：① 占位块上的「收回」按钮 → `Delete()`；② 再点「🔍 规则管理器」
  → 收回；③ **在 WPS 里直接点系统关闭按钮** → 任务窗格轮询 `isAlive()` 发现
  窗口没了 → 自动收回占位块（否则占位块会永久卡在「已拖出」）。
- **非模态**（`IsModal = false`）：用户能边看规则边回表格框选区，
  「显示其格式规则 = 当前选择」才用得起来。
- **工条绑定从拖出逻辑里拆出**（`bindExistingToolbar`）：工具条在任务窗格
  和独立窗口两个宿主里都要能用，跟着拖出逻辑绑的话，独立窗口里下拉和按钮是死的。
- **门禁 `check:detachable` 扩到 native**：`mode=native` 必须给出
  `data-detachable-url` 且文件真实存在（url 写错的表现就是点了没反应）、
  不允许带 `-toolbar`（DOM 跨不了 WebView，写了等于永远不显示）。
- 单测：会话行为 24 例（含降级链路）+ 组件 native 分支 9 例（含「用户关窗后
  自动收回」「收回后停止轮询」）。

### 新组件：任意区块可「拖出」为浮动窗口（detachable panel）（2026-10-21）

用户诉求：弹窗化是**可选项**——默认就在页面上，想放大看时再拖出去；
且要能应用到所有页面，而不是只给条件格式页做一套。

- **声明式接入**：页面上 `<section id="sec-x" data-detachable>` 一行即可，
  可选 `data-detachable-title / -trigger / -toolbar / -width / -height`。
  六个页面 **37 个区块**已全部接入（模块清单由既有 `check:nav-order` 兜底）。
- **新模块 `ts/ui/components/detachable-panel.ts`**（替代条件格式页专用的
  `conditional-format-floating.ts`）：拖动 / 缩放 / 最大化 / 收起 / Esc 关闭 /
  多窗口层叠，几何计算是纯函数（`clampPosition` / `clampSize` / `defaultPanelRect`），
  Node 直跑单测 13 例。
- **搬家而非复制**：拖出时把 section 这个 DOM 节点整体搬进窗口，收回时搬回原父节点
  的**原下一个兄弟**位置。因此页面代码照旧 `getElementById` 读写同一份 DOM，
  「原页面在变化」不是同步两份视图，是本来就只有一份；事件监听随节点走，
  搜索词 / 选中集合 / 计数不会出现两份漂移。
- **正文留占位块**：拖出后原位置插入虚线占位（含「收回」按钮），避免正文突然塌陷
  一大块让人以为内容丢了。
- **层级下调到 900**：早先「每开一个窗口 +1」会一路涨过各页 modal-mask 的 1000，
  确认对话框被压在浮动窗口下面。改为统一 900（低于模态、高于正文），
  多窗口靠 DOM 顺序叠放，「点谁谁置顶」= 把节点重新 append 到 body 末尾。
- **条件格式页改为复用组件**：删掉手写的 `#conditionalFormatFloat` 整段 DOM 与
  对应 CSS，改用 `data-detachable-toolbar` 挂本页专属工具条
  （显示其格式规则 / ↑↓ / 删除），触发器沿用原有的「🔍 规则管理器」按钮。
- **新门禁 `check:detachable`**：`data-detachable-trigger / -toolbar` 指向不存在的 id
  时**静默失效**（按钮点了没反应 / 工具条消失），尺寸写错也静默退回默认值。
  与项目其它「平行清单」同形态，故同样由门禁兜住，并已在
  `verify-guards-reverse.mjs` 补反向用例（注入错误 id 必须变红）。

### 修复

- **「显示其格式规则」下拉被注册了两次 `change` 监听**（真 bug）：同一段代码在
  `setupFloatingManager()` 里重复粘贴了一遍，切一次下拉会重渲染两次。
  重写为 `setupExistingDetachable()` 时只有一处。
- **`parseRangeRect` 的正则被 ReDoS 扫描判为不安全**：`^([A-Z]{1,3})?(\d+)?$`
  是「可选组里嵌量词」。改为逐字符扫描（`codePointAt`），
  顺带避开了 `[...letters]` 展开字符串的误报。
- **`rangesIntersect` 改名 `hasRangeOverlap`**、表头参数 `allSelected` 改名
  `isAllSelected`：布尔命名必须 `is/are/has` 前缀（项目 lint 规则，本次由门禁补上）。

### 条件格式管理器升级：既有规则从「只读列表」变成「可管理表格」（2026-10-21）

对标 WPS 原生规则管理器并超出：WPS 的「格式规则」窗格只支持新建 / 编辑 / 删除 / 上下移，
且规则量大时整表一次性渲染会明显掉帧。本次把「既有规则」区重做成表格。

- **表格列**：# / 类型 / 格式预览 / 应用于 / 公式 / 如果为真则停止 / 操作。
  格式预览同时显示填充色与字体色（WPS 只显示填充）；读不到颜色时给斜纹占位，
  而不是空白——用户分得出「没读到」和「就是没颜色」。
- **行内管理**：导入规则库 / 上移 / 下移 / 删除 / 「如果为真则停止」勾选。
  删除与排序走 `fc.Delete()` / `SetFirstPriority()` / `SetLastPriority()`，
  全部可选调用 + try 包裹，宿主不支持时**明确报错**而不是假装成功
  （用户会以为设置生效了）。
- **性能**：每页 50 条分页，容器上**事件委托**代替逐行绑监听器
  （逐行绑就是 347×N 个监听器 + 347 次 querySelectorAll，翻页还要手动解绑）。
- **搜索既有规则**（WPS 只有「当前选择 / 整表」下拉）：命中类型 / 范围 / 公式 /
  **颜色**——用户找规则时常记得「那条黄色的」而不记得公式。
- **新模块 `ts/panel/conditional-format-table.ts`**（纯函数）：行模型 / 筛选 / 分页 /
  行 HTML 生成，零 WPS / DOM 依赖，Node 直跑单测 26 例（含 XSS 转义边界：
  公式与范围来自 Excel 内容，是注入入口）。
- **`ForeignRuleSnapshot` 增加 `stopIfTrue`**；`WpsFormatConditions.Item` 的返回类型
  补上 `| undefined`——越界下标下部分 WPS 版本返回 undefined 而非抛错，
  原来的类型签名不诚实，`getForeignCondition()` 的判空因此被 lint 判为「恒真」。

### 修复

- **`escapeHtml` 不是纯函数**（真 bug）：实现用 `document.createElement('div')` +
  `textContent` → `innerHTML`，却放在 `string-utilities-pure.ts` 里。
  后果：所有 import 它的模块（本次的 `conditional-format-table.ts`）在 Node /
  单测环境直接抛 `document is not defined`，且每次调用都建一次元素。
  改为纯字符串替换（`& < > " '` 五字符），转义语义与 DOM 方案完全一致。

### 工具链

- **给 `wpsjs@2.2.3` 打 patch 并固化**（`patch-package` + `prepare` 钩子）：
  `wpsjs debug` 的静态服务对 `.html` 请求手写 `Content-Type: text/html`
  （**缺 charset**、chunked 无 `Content-Length`），WPS 客户端据此判
  「主资源内容校验失败」并弹提示。补上 `text/html; charset=utf-8` 与
  `Content-Length`，`patches/wpsjs+2.2.3.patch` 随仓库分发，`npm install` 后自动生效。
  （wpsjs 上游最新版仍是 2.2.3，无修复版；官方论坛已确认该提示无功能影响。）

### 新增：命名规范化进入 lint 门禁（2026-10-20）

前几轮 `cf → conditionalFormat`、`ws/col/sid → worksheet/column/subjectId` 都是**人工排查**出来的 ——
`unicorn/name-replacements` 只认字母形态、不认语义缩写，且它的 110 条替换表里没有
`ws / col / sid / hl / cf`，lint 全程绿。**「lint 不报」不等于「命名合规」**。

- **新增 `@typescript-eslint/naming-convention` 配置**（`eslint.config.mjs`）：
  - 缩写黑名单 = `unicorn/name-replacements` 词表（剔除单字母项）+ 本项目增量
    （`ws` / `col` / `sid` / `hl` / `cf` / `img` / `win` / `cls` / `opt` / `del` …），约 130 条。
  - 词段判定两个分支互补：开头或 `_` 之后（覆盖 UPPER_CASE 的 `LEN` / `COL`）、
    camelCase 边界（覆盖 `setWin` 的 `Win`）。词尾锚定「结尾 / 非字母 / 下一个大写+小写」，
    因此 `colorIndex` / `protocol` / `DEFAULT_BRANCH` / `MAX_ADDRESS_LENGTH` **不误判**，
    而 `maxCol` / `setWin` / `MAX_COMMENT_LEN` 判中。
  - 字母形态：变量/函数/参数 `camelCase`、类型 `PascalCase`、常量 `UPPER_CASE`；
    未使用参数（`_` / `_worksheet`）豁免格式但**不豁免缩写检查**（否则 `_ws` 会永久躲过门禁）。
  - 报错可读性：`failureMessage` 在 typescript-eslint 8.72 **只在 schema 里、规则体未实现**
    （已实测），报错文本由 `custom.regex` 决定。故改用「`filter` 挑出含缩写的名字 +
    永不匹配的 `(?!)` 提示正则」，报错从 5KB 正则变成一行可读提示。
- **全量清理既有缩写**（约 2050 处 / 100+ 文件）：
  `xxxCol → xxxColumn`、`xxxWs → xxxWorksheet`、`xxxSid → xxxSubjectId` 三大族，
  常量 `*_COL → *_COLUMN` / `TXT_* → TEXT_*` / `MAX_COMMENT_LEN → MAX_COMMENT_LENGTH`，
  以及 `img → image`、`win → windowGlobals`、`cls → cssClass`、`opt → option`、
  `delRow → rowToDelete`、`impl → implementation`、`_def → _definition` 等。
- **新增 [`文档/NAMING.md`](文档/NAMING.md)**：规范正文（形态规则、缩写对照表、判定算法正反例、
  豁免清单、迁移注意事项）。README 文档索引已加指针。
- **新增 `scripts/probe-naming.mjs`**：不加载主配置（无类型感知，几秒出结果）的独立扫描器，
  按「命中名 → 次数 → 文件:行」汇总，调黑名单或评估下一批改名量时用。

已知取舍（详见 NAMING.md §4）：

- **`init` 同样按缩写处理**：`init` 是 `initialize` 的截断词，虽然 `unicorn` 的 110 条表里
  没有它，但「大家都这么写」不构成豁免理由 —— 23 个 `initXxx` 导出统一改为 `initializeXxx`
  （`initPanel → initializePanel`、`safeInitPanel → safeInitializePanel`），调用点、
  `tests/entry-smoke.test.ts`、`文档/ARCHITECTURE.md` 一并同步（474 处 / 59 文件）。
  判定不误伤 `initialX` / `initializeX`（`init` 后接小写，不构成词尾）。

- **属性位（`objectLiteralProperty` / `typeProperty`）整体豁免**：线上 dump 字段、WPS COM
  （`Interior` / `Color`）、DOM（`className`）的名字所有权不在本项目。
- **线上键 `sid` 保持原样**，靠解析边界 `WireRemoteEntry` + `toRemoteEntry()` 归一成 `subjectId`。
- **公认缩略词不算缩写**：`id` / `url` / `api` / `json` / `xml` / `http` / `ui` / `bgm` / `wps`
  等首字母缩略词视为独立单词（`subjectId` / `bangumiUrl` 合法）。

> 一度把 `init` 也列进豁免（理由是 `unicorn` 词表里没有它），随后收紧 —— 详见上一条。

### 依赖与工具链升级（2026-10-20）

`npm outdated` 逐项核对后升级；全量门禁 `npm run gate` 通过（142 文件 / 4645 用例）。

- **主版本跃迁**：vite 6 → 8（构建内核换 rolldown，`npm run build` 实测产出 253 个文件）、
  vitest 4 → 5（全量耗时 160s → 68~81s）、jsdom 29 → 30、lint-staged 16 → 17、concurrently 9 → 10。
- **同主版本**：eslint 10.13、typescript-eslint 8.72、@napi-rs/canvas 1.0.11、prettier 3.9.10、
  globals 17.13、zod 4.6.7、dompurify 3.4.17（`libs/purify.js` **同步覆盖**为同版本 vendored 副本，
  `check:dompurify-version` 把关——运行时加载的是它，只升 npm 侧等于没升）。
- **刻意停在旧版（有明确阻塞，别盲升）**：
  - `typescript` 6.0.3：`typescript-eslint@8.72` 的 peer 是 `>=4.8.4 <6.1.0`；TS 7 是 Go 原生
    实现（`tsgo`），类型感知规则链不兼容，升上去 `npm install` 直接 ERESOLVE（实测）。
  - `eslint-plugin-unicorn` 74：v78 把一批规则拆成 json / markdown / css 专用版，本项目
    「unicorn 整组展开为 error」的配置在**解析阶段**就抛 `rules do not support the language "js/js"`；
    按语言域过滤后仍冒出 **856 条**新错误（`no-manually-wrapped-comments` 占大头），且
    `prefer-continue` / `prefer-early-return` 与项目既定的 `no-continue` 直接互斥。迁移需单独一轮。
- **新增 `.npmrc`（`legacy-peer-deps=true`）**：`eslint-config-airbnb-extended@3.x` 的 peer 仍写
  `eslint: ^9.0.0`（实际在 v10 下工作正常），不放宽则任何 `npm install` / `npm ci` 都 ERESOLVE，
  新克隆的仓库装不上依赖。
- **移除 `@types/dompurify`**：dompurify 3.x 自带 `dist/purify.cjs.d.ts` + `exports.types`，该 @types 包从 3.0 起就是废弃 stub——留着只会引入类型版本漂移，且从未真正生效。
- **`vite.config.js` → `vite.config.mjs`**：vite 8 的 `configLoader: 'native'` 会警告
  「ESM 语法被按 CJS 加载」，未来该 loader 成为默认后会直接失败。

### 修复

- **`batchWriteNewRows` 缺空列早退**（真 bug）：表头完全认不出（`colMap` 为空）时
  `writeCols` 为空却不早退，`minCol` / `maxCol` 退化成 1，会把一整列 `null` 写进 A 列
  **覆盖用户数据**，也不触发逐行回退。补回守卫 + WARN——修好后
  `tests/github-sync.test.ts` 的空列用例才真正通过（此前一直靠注释「上方已守卫」掩盖）。
- 三处 `void x` 被 typescript-eslint 8.72 新增的 `no-meaningless-void-operator` 判为无效，
  改为 `_` 前缀参数（`_signal` / `_address` / `_function_`），语义不变。
- `vitest` 的 `hookTimeout` 10s → 30s：全量并发起 142 个 jsdom 环境时钩子偶发超时
  （同一文件单跑 3.6s，全量跑 >10s）。

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

### 重构（命名规范化第二批：ws / col / param / sid 全拼化）

继 cf / hl / cfg 之后的内部缩写清理，分 4 个提交（便于单独 review 与回滚）：

| 缩写                        | 改为                                 | 数量级 | 提交       |
| --------------------------- | ------------------------------------ | ------ | ---------- |
| `ws`                        | `worksheet`                          | 1541   | `511fda7a` |
| `col` / `cols` / `colMap` … | `column` / `columns` / `columnMap` … | 1700   | `c795dcf9` |
| `param` / `params`          | `parameter` / `parameters`           | 543    | `7458e354` |
| `sid`                       | `subjectId`（**线上键保持 sid**）    | 1341   | `6835887e` |

**`sid` 是唯一有线上契约的一个**，单独说明：它是 dump / shard manifest / Excel 三处的列名，
`FIELD_NAME_MAP` 早已声明规范名 `subjectId`。本轮把模型内部统一成 `subjectId`，线上格式一字不改，
为此新增一对边界函数：

- `isWireRemoteEntry(value)`：按**线上形状**校验（键名 `sid`），取代 `isGithubRemoteEntry`
- `toRemoteEntry(wire)`：`sid` → `subjectId` 归一；两个解析边界（`parseJsonl` 的 buildEntry、
  shard-fetch）用完守卫必须过这道——漏一步不报错，只会静默丢数据

**踩到的三个坑（都已修，写进记忆）**：

1. `eslint --fix` 会删掉「预留测试选项」的 `eslint-disable` 注释（fix 模式下 UNSAFE 组 unicorn
   规则缺席，注释变成无用指令）——lint-staged 只对 `ts/**` 跑 eslint、对 `tests/**` 只跑
   prettier，所以**永远不要对 tests/ 手动跑 eslint --fix**。
2. 重命名正则误伤 `eslint-disable` 注释里的规则名：`no-param-reassign` 被改成不存在的
   `no-parameter-reassign`（param 那轮）。
3. `sid` 的字符串字面量必须整体排除：zod schema 键、`IMPORTANT_COLS` / `FIELD_NAME_MAP` 键、
   `EXPORT_FIELDS` 第一列、测试 fixture 的表头数组、shard-fetch 的 WARN 文案——漏一处就是
   静默数据错误（导出 JSONL 第一列变空），编译期发现不了。

**刻意不改**（不是遗漏）：`vi.fn()` 的 `fn`（库 API）、Bangumi API 的 `msg` 字段、
CSS 类名里的 `num` / `env` / `err` / `idx`（如 `.row-num` / `bgm-dp-env-card` / `match-all-idx`，
属于样式命名空间，改了对可读性没有增量）。

### 重构（命名规范化：cf / hl / cfg → 全拼）

项目既定方针是「缩写标识符 → 全拼」（见 `eslint.config.mjs` 里 `unicorn/name-replacements` 的
说明：项目内 234 种缩写 / 799 处已全清）。`cf` / `hl` / `cfg` 只是没进 unicorn 的内置替换表，
**不代表合规**——lint 不报不等于命名对。

- **`cf` → `conditionalFormat`**：文件（`conditional-format-rules/ -apply/ -page/ -bootstrap`、
  `ui/conditional-format.html`、`css/conditional-format.css`、`images/conditionalFormatPage.svg`）、
  类型（`ConditionalFormatRule` / `ConditionalFormatApplyPlan` / …）、函数、DOM id、CSS 类、
  日志 tag（`[conditionalFormat]` / `[BGM ConditionalFormat]`）、ribbon 按钮 id、页面键
  （`conditional-format`，与 `ui/<page>.html` 同名）全量重命名。
- **`hl` → `highlight`**（高亮页 DOM id / CSS 类）、**`cfg-` → `config-`**（同步弹窗配置摘要）。
- **存储键一次性迁移**：`cf.rules.v1` / `cf.strategy.v1` / `cf.sheet.v1` / `cf_pane_id` /
  `cf_pane_url` → `conditionalFormat.*`。读一次旧键、写新键、清旧键——**用户已保存的规则库不丢**；
  面板 ID 同样迁移，避免旧任务窗格变成孤儿窗。
- `scripts/check-nav-order.mjs` 的注册表解析改为同时接受带连字符的字符串键；并补记
  「整段正则必须用 String.raw，拼进模板字面量会把 `\s` 当转笔画掉」这个坑。

**未纳入本轮**（内部局部变量缩写，量级大一个数量级，需单独一批 review）：`ws`(659) /
`col`(839) / `sid`(319) / `param`(526) / `msg`(16) / `err`(18) / `env`(35) 等。

### 修复（真机反馈 · 第三轮：高亮列不可加选 / 看不到既有条件格式）

- **高亮列只能取消、不能新增**：`rebuildColumns` 只把**缓存里已有**的列渲染成勾选框，
  首次使用就是「源列 + 名称」两项，之后没有任何入口把别的列加进来。改为列出
  `colMap` 的**全部可选列**（序列号列仍排除——它的绿色是「已上传」判定色），
  勾选状态由「缓存 ∪ 源列」决定；日期源列置顶且 `disabled`（必选）。
  `HighlightColumn` 增加 `selected`，应用/日志/提示都只数勾选的列；
  `persistColumns` 改为直接读状态，不再回读 DOM。
- **看不到工作表已有的条件格式**：新增「👀 既有规则」卡片（只读，按优先级列出
  范围 / 类型 / 公式 / 填充色），切换目标表或点「重新读取」即刷新。
  类型用宿主的 `XlFormatConditionType` 原始编号翻中文（单元格值/公式/色阶/数据条/
  Top10/图标集），非公式类标注「插件无法重建」。
- **「读不到」不再伪装成「没有」**：新增 `checkFormatConditionsReadable` 探测
  `FormatConditions.Item` 是否可用；不可用时卡片直接显示原因，而不是显示一条
  误导性的「这张表当前没有条件格式规则」。导入按钮的提示也区分这两种情况。
- `ForeignRuleSnapshot` 增加可选 `type`（宿主原始类型号），不影响既有用例。

### 修复（真机探针：Range 地址串 524287 字符 / 并集 8188 个区域）

用户跑了两次真机探针：`[探测] Range 地址串上限约 524287 字符`、
`[探测] 并集区域个数上限约 8188（≈ Excel 的 8192）`。此前按 VBA 经典限额 255 做的保守取值，
把 COM 调用次数白放大了三个数量级：

- **默认装车字符数 200 → 8000**（`DEFAULT_MAX_ADDRESS_CHARS`，约 1000 个单格区域）。
  1000 个地址从「50 次跨进程 `Range()` 往返」压到 **1 次**。仍不贴着 524287 用：
  探针只测了**字符数**，**区域个数（Area 数）上限没测过**，两者不是一回事。
- **新增 `splitRangeAddresses`**：按组返回地址数组（而非拼好的字符串），
  便于失败时按**区域**对半切——字符串再拆回区域既易错又丢结构。
- **新增 `runRangeGroupsWithSplit`**：某组被宿主拒绝时对半拆分重试，直到单区域；
  单区域仍失败才记 WARN。**不再赌任何一个魔法数字**：最坏退化成逐区域调用，
  也不会像宏那样整批静默不上色。应用与清除共用同一条路径（`paintSheet`）。
- **不额外加 Area 数上限**：单格地址最短 `A1` + 逗号 = 3 字符/区域，8000 / 3 ≈ 2666，
  比实测的 8188 低 3 倍——字符预算严格更紧，Area 上限天然撞不到。这条不变量写成了
  单测（改大 `DEFAULT_MAX_ADDRESS_CHARS` 时它会先红），避免以后有人「顺手调到 30000」。
- 5 个新单测覆盖拆分路径（整组被拒 → 拆到 4 个单区域全成功、计数、失败回调、静默兜底）。

### 修复（真机反馈 · 第二轮）

- **cf / highlight / clean 三页按钮灰 5 秒**：三页 `initXxxPage()` 都漏了派发
  `bgm:modulesReady`，门禁只能等 5s 超时强开，控制台留一条
  `[BGM ConditionalFormat] 5000ms 内未收到 bgm:modulesReady 事件，强制启用按钮（兜底）`。
  事件名与日志 tag 收进 `action-buttons-gate.ts`：新增 `notifyModulesReady()`（tag 由
  `installActionButtonsGate` 登记一次，页面侧不再各拼一份——重复手写正是漏派发的成因），
  三页 init 末尾统一调用。新增 `tests/action-buttons-gate.test.ts` 锁住
  「安装即禁用 / 派发即启用 / 5s 兜底 / 事件先到不重复告警」。
- **DevTools 反复报 `Could not parse content for …/libs/purify.min.js.map`**：vendored 的 UMD
  副本末尾带 `//# sourceMappingURL=purify.min.js.map`，但 .map 不随包发布，DevTools 每次启动
  都去请求、拿到 404 的 HTML 后报解析失败。已删掉该行，并在 `check:dompurify-version` 里加断言
  ——下次重新 vendor 时脚本会直接拦下，不靠人记。
- **`latest` 依赖不可复现**：`et-jsapi-declare` / `wpsjs` 由 `latest` 钉成 `^2.5.0` / `^2.2.3`
  （当前实装版本），否则新机器 / CI 装到的版本随发布时间漂移。
- **`typescript` 声明与锁文件自相矛盾**：HEAD 声明 `^7.0.1` 却锁着 6.0.3；统一为 `^6.0.3`
  ——typescript-eslint@8.72 的 peer 上限是 `<6.1.0`，TS 7（Go 原生实现）不在范围内，
  声明成 ^7 只会让 `npm install` 直接 ERESOLVE。等上游放开上限再升。

### 新增（功能 · 条件格式管理器：引擎 + COM 层 + 独立页，完整落地）

「条件格式管理」独立页（ribbon「条件格式」组）完整交付。解决 Excel 原生条件格式
「删除行后规则乱」的问题——**规则存 PluginStorage 为唯一真相，工作表只是投影**：

- **双策略（用户裁定两种都要）**：应用前读工作表既有规则快照——
  - `clear-all`：清空后按 Store 重建，手工规则进确认框逐条列出（范围+公式）再丢；
  - `append-after`：公式类手工规则**原样重建在前**（保原优先序），插件规则置后追加；
    快照含数据条/图标集/单元格值等不可重建类型时**降级清空并在警告里说明**（不静默丢数据）。
- **应用 = 清空 + 重建**：幂等（重复应用不产生重复规则），删除行把范围搞乱后重应用即自愈；
  优先级用反序 SetFirstPriority 显式定（entries[0] 最高），不依赖 Add 默认优先序。
- **默认规则集**（`buildDefaultRules`）：当前季名称填绿（**自维护 TODAY 公式**，跨季度无需
  改规则）+ 日期格式错误标红（Excel 经典浅红底深红字）+ 四季分色（1/4/7/10 月季各一色）。
- **WPS 类型声明**：`WpsFormatConditions` / `WpsFormatCondition`（Add 对象形式入参 +
  With + SetFirstPriority + ModifyAppliesToRange）；`isFormatConditionsSupported` 探测，
  老版本 WPS 隐藏该功能并提示，不影响其它页。
- **读写按条 try + 计数**：单条失败不中断整批（与同步写入「批次失败可见」一致）；
  Count 提循环外（com-in-loop 铁律）。
- 引擎 `conditional-format-rules.ts` 纯函数，25 个单测覆盖：双策略计划、降级路径、隐藏规则不进计划、
  Store 坏行跳过、公式行号平移不误伤字符串字面量（"26年10月"/TEXT "00"）。
  修掉一个真 bug：ConditionalFormatApplyEntry 联合类型两分支字段名不同（rule.appliesTo vs range），
  收敛出 `entryRange()` 辅助函数。

### 新增（功能 · 条件格式管理器页面：搜索/分组/隐藏/排序/复制粘贴/导入手工规则）

- **页面能力**（`conditional-format-page.ts` + `ui/conditional-format.html`）：目标工作表下拉（已打开工作簿全部可选，
  选择持久化）；规则列表按分组渲染 + 搜索框（名称/公式/范围/分组）；勾选框 = 隐藏
  （留库不应用）；↑↓ 改优先级（数组序）；复制 → 粘贴时**可选目标范围，公式锚点行自动
  平移**（`firstRowOfRange` + `shiftFormulaRows`，单测覆盖）；行内编辑器（名称/分组/
  范围/公式/填充色/字体色/加粗）；「导入手工规则」把工作表上的公式类规则读进规则库。
- **双策略确认模态框**（页面自有，preview 页同款先例）：应用前读到手工规则即弹出，
  逐条列出范围 + 公式，三选——「清掉后应用」/「保留手工规则」/ 取消；上次选择记在
  按钮标签上。无手工规则时直接应用，不打扰。
- **默认规则集一键生成**：探测目标表「开播季度」「名称」列与首行，生成 6 条规则
  （当前季/错误/四季），公式锚定自动对准。
- 登记六件套：ribbon.xml/ribbon.ts/nav-order/index.ts/util barrel + 图标；
  nav-order 6 页 36 模块、ribbon 14 按钮、com-in-loop 0、lint/tsc/prettier 干净。
- 测试：引擎 27 个单测（双策略计划、降级、隐藏规则、坏行、锚点平移、首行解析）；
  ribbon/nav-order 登记表测试同步更新。全量套件 4643 → 本次改动三文件 69 测试定向
  验证通过（全量 run 被环境安全规则瞬时拦截，未重试）。

### 新增（功能 · 番剧高亮独立页：按季度起点高亮最新番剧）

把 WPS 宏「高亮最新日期」移植成插件独立页（ribbon「番剧高亮」→ 高亮面板），并修正宏的两处问题：

- **季度映射修正**：宏按「|当前月-季度起点| 取最小」定位当前季，**12 月会错算成 10 月季且无跨年**。
  改用数据页公式同款 LOOKUP 表：air 月 → 所属季 `{1,2→1月季; 3,4,5→4月季; 6,7,8→7月季;
9,10,11→10月季; 12→次年1月季}`。与用户口径一致：10 月高亮 9/10/11 月，7 月高亮 6/7/8 月。
- **逐行拼地址会踩上限且失败无声**：宏逐行拼 `H123,H124,…`，错误出口是 `提示()`（= `Console.log`），
  用户看不到。改为**连续行合并 + 分块**（`H100:H105` 式区域装车），按日期排序的数据一季通常
  只剩一两个区域。纯函数 + 单测覆盖。
  （当时按 VBA 经典的 255 字符保守取值；2026-10-20 真机探针实测实际约 **524287** 字符，
  默认上限已随之上调，见下条。）
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
