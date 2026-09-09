# 更新日志（CHANGELOG）

> 本文件按「内部功能版本」记录重大变更。注意：`package.json` 中的 `version` 字段（当前 `1.0.0`）为 npm 包发布版本，与本文档的 `v3.x` 内部功能版本相互独立，二者不要求一致。

本文档与 [`文档/USER_OPERATIONS.md`](文档/USER_OPERATIONS.md)（用户手册版本历史）、[`文档/ARCHITECTURE.md`](文档/ARCHITECTURE.md)（架构文档版本历史）互为补充：架构级变更以架构文档为准，操作级变更以用户手册为准，本文件提供跨文档的总览索引。

---

## [未发布]

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
