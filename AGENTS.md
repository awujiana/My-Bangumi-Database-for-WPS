# AGENTS.md

> 本文件供 **AI 编码 / 写作 agent**（WorkBuddy、Copilot、Claude 等）阅读，用于了解本仓库的结构、约定与禁忌，从而在自动改动时保持风格一致。
> 人类贡献者请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)（含完整命名规范）。

## 项目概述

- **名称**：我的 Bangumi 数据库 (WPS版)
- **GitHub 仓库名（英文名）**：My-Bangumi-Database-for-WPS
- **类型**：代码仓库（AGPL-3.0）—— WPS Office 表格加载项
- **维护者**：awujiana
- **一句话**：在 WPS 表格里管理 Bangumi 番组数据——上传同步、数据同步、收藏下载、新番表富化与数据清洗。

## 仓库结构

| 路径                                                               | 用途                                                                                                       | 是否发布                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------- |
| `ts/`                                                              | TypeScript 源码（`core` / `entry` / `panel` / `schemas` / `services` / `sync` / `tools` / `ui`）           | ✅                        |
| `ui/`                                                              | 7 个页面 HTML（`panel` / `settings` / `clean` / `enrich` / `highlight` / `conditional-format` / `donate`） | ✅                        |
| `css/`                                                             | 样式（`tokens` 为唯一色彩来源，`panel-theme` 为面板基线，其余按页面）                                      | ✅                        |
| `dist-ts/`                                                         | `tsc` 编译产物（`npm run build:ts`）。**新增模块必须三件产物齐全并 `git add -f`**（该目录被 `.gitignore`） | ✅                        |
| `dist/`                                                            | Vite 打包产物（`npm run build`），发布包内容                                                               | ✅                        |
| `index.html` / `main.js` / `manifest.xml` / `ribbon.xml` / `libs/` | 加载项清单与宿主入口                                                                                       | ✅                        |
| `images/`                                                          | README 截图、品牌图标、赞赏码                                                                              | ✅                        |
| `download/`                                                        | 各版本发布 zip 与 `version.json`（更新链路数据源）                                                         | ✅                        |
| `wps-addon-build/`                                                 | `wpsjs build --exe` 产物（exe）                                                                            | ❌ 由发布流程上传 Release |
| `tests/`                                                           | Vitest 单元测试                                                                                            | ✅                        |
| `scripts/`                                                         | 校验与构建脚本（`check-*.mjs` / `audit-layout.mjs` / `replace-icon.mjs`）                                  | ✅                        |
| `文档/`                                                            | 架构、用户操作手册、审计与覆盖率文档                                                                       | ✅                        |
| `node_modules/`、`release/`、`.workbuddy-ai/`                      | 依赖、发布暂存、内部工作数据                                                                               | ❌                        |

> 上级目录 `Excel加载项/BGM/` 还放着 `publish.mjs`、`release-notes-v*.md`、`发布流程.md`，**不属于本仓库**。

## 必须遵守的约定

1. **命名规范（不缩写）**：项目 `kebab-case`、文件 / 函数 / 组件一律全拼无缩写、名称不重复、组件名 = 文件名。详见 `CONTRIBUTING.md` 的「命名规范（不缩写）」。
2. **项目核心不变量**：
   - **`css/tokens.css` 是唯一色彩来源**。组件里不写死色值，深浅两套主题靠 token 覆盖；同一个色值不允许在 `[data-theme='light']` 之外再硬编码一份。
   - **填充色与文字色分开**：`--danger` / `--success` / `--accent-blue` / `--red-strong` 是填充色；当文字用必须走 `--text-danger` / `--text-success` / `--text-link`。混用会在浅色主题跌破 4.5:1（实测 `#2f7fe0` 在 `#eef0f3` 上 3.51:1）。
   - **UI 事件统一走 `data-action`**：在 HTML 上标注 `data-action`，由 `ts/ui/handlers/` 统一分发；不要在页面脚本里散落 `onclick`。
   - **持久化统一走 `PluginStorage`**：键名集中管理，同一状态不得存两份（如锁定工作表统一用 `BGM.sheet` + `bgm_locked_sheet`）。
   - **动态 HTML 必须清洗**：一律经 `sanitizeHtml`；表格行片段用 `sanitizeTableRows`（DOMPurify 会剥离顶层 `<tr>/<td>`）。
   - **版本号两处同步**：`package.json` 的 `version` 与 `ts/tools/update-check.ts` 的 `CURRENT_VERSION` 必须一致，否则「检查更新」自相矛盾。
   - **发布包完整性**：`download/version.json` 的 `sha256` / `size` 由 `publish.mjs` 按 zip 实际字节写入；不一致时客户端 `verifyAssetIntegrity()` 直接拒装。**不要手改这两个字段**。
   - **每个面板产物只有一个产出者**：`download/*.zip` 由 `publish.mjs` 复制现成 zip 并重算 `version.json`，它**不重打包**——改文档或图标后重发，zip 哈希不会变。
3. **技术禁令**：
   - **禁止循环依赖**：新增模块前先确认依赖方向；跨层共享逻辑下沉到 `ts/tools/` 或 `ts/core/`。门禁 `check:cycles` 会拦。
   - **禁止新增 `any`**：外部输入先用 `unknown` 收窄，再用 zod 校验。
   - **禁止在启动阶段与循环里直接调 COM**：必须过 `com-ready` / `check:com-in-loop` 闸门，否则宿主互锁。
   - **禁止绕过 CSP**：`check:csp` 校验 `ui/*.html` 的 `Content-Security-Policy` 与 `index.html` 一致；新增外链域名要同时改这两处。
   - **禁止删除 `scripts/check-*.mjs` 的断言**：它们锁的是源码文本，删掉等于放开门禁。改断言必须配变异用例（`npm run check:guards-reverse` 会验证「注入违规后必须变红」）。
   - **不要改 `LICENSE`**。
4. **README 风格**：顶部 shields.io 徽章 → `[!WARNING]` AI 声明 → 目录 → 正文 → 致谢 → 赞赏 → 底部三节（关联仓库 / 作者联系方式 / 开源协议）。**赞赏不得插进底部三节之间**。
5. **双名标题**：README 顶部**中文名 `<h1>` 在上、GitHub 仓库名 `<h2>` 在下**（`My-Bangumi-Database-for-WPS`，带连字符），两者都要有。
6. **协议**：AGPL-3.0。
7. **文档索引**：「文档」节只列**操作文档**；测试文件不进索引，最多一句话提示。
8. **提交信息**：`type(scope): 做了什么` + 正文写「为什么」。常用 type：`feat` / `fix` / `refactor` / `docs` / `style` / `test` / `chore`。
9. **提交身份**：`git config user.name` = `awujian`，`user.email` = `bingshanlengtie@qq.com`。旧邮箱一旦进了提交元数据，「改文件」和 `force push` 都清不掉——普通仓库要靠删库重建，fork 仓库只能请 GitHub Support 做 GC。
10. **维护**：每次改动同步 `CHANGELOG.md`（Keep a Changelog，语义化版本，小节用纯中文 `### 新增 / 改进 / 修复 / 破坏性变更`）；发版另写 `Excel加载项/BGM/release-notes-v<版本>.md`。

## 改动前检查

- **改 TS**：`npm run build:ts`（或 `npx tsc --noEmit`）→ `npm test` → 全量 `npm run gate`（基线 **178 文件 / 5369 测试**）。
- **改 CSS / HTML**：`npm run gate` 只跑 jsdom，**看不见布局**。布局 / 对比度 / 点击目标必须用真浏览器：
  ```bash
  npm run check:shard-layout      # 分片布局探针（需本机 Chrome）
  npm run audit:layout            # 布局审计
  ```
  探针四坑：`--window-size` 最小约 500px（窄视口用 iframe）、`file://` 拦 ES module、`href` 要 `pathToFileURL`、**必须移除跨行 CSP `<meta>`**；样式表引用必须写成绝对 `file://`，否则 404 会得到「幽灵无样式」的假结论。
- **改源码级断言**：`npm run check:guards-reverse`——注入违规必须变红且失败输出含预期片段，再逐字节还原。
- **改图标**：`npm run icon`（换 exe 图标）/ `npm run icon:merge`（多尺寸 ico 合并），换完必须校验「合法 PE + 除 `.rsrc` 外所有节逐字节相同」。
- **改 README / 文档**：对照 `CONTRIBUTING.md` 与 `.trae` 之外的现有风格；核对徽章、锚点、底部三节、双名标题；正文与代码不一致时**以代码为准**，并同步 `CHANGELOG.md`。
- **提交前**：`git status` 确认不含 `node_modules/`、`wps-addon-build/`、`.workbuddy-ai/`、临时探针文件。

## 不要做的事

- 不要手写 `⚠️ Warning` 代替 GitHub 警示块 `> [!WARNING]`。
- 不要在标题用 VS16 变体 emoji（`⚠️` / `🖼️`），会破坏自动锚点。
- 不要缩写命名、不要同名文件（含仅大小写不同）、不要用数字后缀解决冲突（`UserCard2` ❌）。
- 不要把赞赏码放进 Release Notes。
- 不要在 `css/` 组件里写死十六进制色值——一律加 token。
- 不要只改 `--accent-blue` 当文字色；浅色主题下会跌破 4.5:1。
- 不要为了「对齐现状」去改 `.trae/specs/**`、旧日期文档、`plans/`、历史 `differences/` 报告与带日期的变更块。
- 不要在沙箱里直接跑 `npm run gate` / `npm run build`：vitest 清理 `node_modules/.vitest-cache` 会触发删除拦截，`clean-dist-ts.mjs` 的 `rmSync` 同样被拦。用 `CODEBUDDY_SAFE_DELETE_ENABLED=0 NODE_OPTIONS= npm run gate`。
- 不要删 `AGENTS.md` / `CONTRIBUTING.md` / `CHANGELOG.md`；它们承载协作与 AI 约定。
