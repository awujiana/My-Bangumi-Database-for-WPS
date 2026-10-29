# 贡献指南（CONTRIBUTING）

感谢你愿意参与 **My Bangumi Database for WPS**！  
本项目是一个运行在 WPS 表格（ET）中的加载项，使用 TypeScript + Vite + Vitest 开发。无论是提 Issue、修 Bug、补测试、改文档，还是适配新的同步源，都欢迎。

> [!IMPORTANT]
> 本仓库有两个长期分支，内容不同，**克隆前先确认你要哪一份**：
>
> | 分支           | 内容                                                                                                                                                                                                      | 能做什么                                                |
> | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
> | `main`（默认） | 完整源码工作区：`ts/` 源码、`ui/` `css/`、`tests/`、`scripts/`、`package.json` 与全部构建配置，外加 `dist-ts/` 等发布产物                                                                                 | `npm install` 后可直接 `npm run gate` / `npm run build` |
> | `publish`      | 仅发布文件：`index.html` / `main.js` / `manifest.xml` / `ribbon.xml` / `assets/` / `css/` / `dist-ts/` / `images/` / `libs/` / `ui/` / `ts/` / `download/`，**不含** `tests/`、`scripts/`、`package.json` | 只用于分发与「检查更新」拉取，跑不了构建与测试          |
>
> 本文档的「快速开始 / 开发流程 / 质量门禁 / 测试要求 / 发布流程」都按 `main` 编写。

---

## 目录

- [行为准则](#行为准则)
- [快速开始](#快速开始)
- [源码结构](#源码结构)
- [开发流程](#开发流程)
- [提交规范](#提交规范)
- [质量门禁](#质量门禁)
- [代码约定](#代码约定)
- [测试要求](#测试要求)
- [文档与截图](#文档与截图)
- [发布流程](#发布流程)
- [报告问题](#报告问题)
- [开源协议](#开源协议)

---

<a id="行为准则"></a>

## 行为准则

- 保持友善、就事论事，不进行人身攻击或与问题无关的争论。
- 讨论技术方案时以**可复现证据**为准：日志、截图、版本号、复现步骤，比“我觉得”更有说服力。
- 不要在 Issue / PR 中粘贴 **Bangumi Token、账号密码、私人表格内容** 等敏感信息。

---

<a id="快速开始"></a>

## 快速开始

### 环境要求

| 依赖       | 版本                                           |
| ---------- | ---------------------------------------------- |
| Node.js    | `>= 22.22.2`（见 `package.json` 的 `engines`） |
| npm        | 随 Node 安装                                   |
| WPS Office | 2019+（Windows），需支持 JSAPI / 加载项调试    |
| Git        | 较新版本                                       |

### 本地安装与运行（维护者源码工作区）

```bash
# 本仓库不含源码与 package.json：以下步骤请在维护者的完整源码工作区执行
git clone <维护者的完整源码仓库>
cd My-Bangumi-Database-for-WPS

npm install          # 安装依赖，并执行 husky + patch-package
npm run build:ts     # 编译 TypeScript → dist-ts/
npm run debug        # 编译 + watch + 拉起 WPS 调试
```

常用脚本：

| 命令                   | 作用                                                 |
| ---------------------- | ---------------------------------------------------- |
| `npm run debug`        | 开发调试：`tsc --watch` + `wpsjs debug`              |
| `npm run build`        | 完整构建：`tsc` → `dist-ts/`，Vite → `dist/`         |
| `npm run dev`          | 仅启动 Vite 开发服务器（端口 5173），不代替 WPS 调试 |
| `npm test`             | 运行全部 Vitest 单元测试                             |
| `npm run lint:check`   | ESLint 检查（不修复）                                |
| `npm run format:check` | Prettier 检查                                        |
| `npm run gate`         | 完整质量门禁（提交前必跑，详见下文）                 |

---

<a id="源码结构"></a>

## 源码结构

开发时关注的是源码目录；发布包结构见 [README 的「目录结构」](README.md#sec-4)。

```
ts/
├── core/        # 常量、类型、结果、错误处理、UI 桥接
├── entry/       # ribbon / panel / settings 入口
├── panel/       # 各面板页面逻辑（panel / settings / clean / enrich / highlight / conditional-format / donate）
├── schemas/     # zod 校验 schema
├── services/    # 配置、Ribbon 服务
├── sync/        # 同步引擎（github / gitlab / gitee / gist / local-file / Archive）
├── tools/       # 工具函数（http / wps / logger / sanitize / clipboard / theme ...）
└── ui/          # DOM 组件、对话框、handlers（data-action 分发）
ui/              # 各页面 HTML
css/             # 样式（tokens / panel-theme / 各页面）
tests/           # Vitest 单元测试
scripts/         # 校验与构建脚本（check-*.mjs）
文档/             # 架构、用户手册、审计与覆盖率文档
```

---

<a id="开发流程"></a>

## 开发流程

1. **先开 Issue（推荐）**：描述问题、期望行为与复现步骤，避免与已有工作重复。
2. **从 `main` 切出分支**，分支名使用 `feat/xxx`、`fix/xxx`、`docs/xxx`、`refactor/xxx`。
3. **小步提交**：一次提交只做一件事，便于 review 与回滚。
4. **补充测试**：修复 Bug 时优先补一个能复现问题的回归测试。
5. **提交 PR**：说明改动动机、影响范围与验证方式；PR 描述中附上 `npm run gate` 的结果。

> 如果你的改动涉及真实宿主行为（WPS API、真实网络、跨 WebView、超大表格），请在 PR 中说明手工验收步骤，必要时附截图。

---

<a id="提交规范"></a>

## 提交规范

使用 **Conventional Commits**：

```
<type>(<scope>): <subject>
```

- `type`：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `style` / `perf`
- `scope` 可选，常用：`sync`、`panel`、`enrich`、`clean`、`ribbon`、`ui`、`update`
- `subject` 使用中文或英文均可，保持简洁、聚焦“为什么”

示例：

```
feat(enrich): 自动识别已打开的新番表工作簿
fix(panel): 赞赏页缺少 pane id 导致一键关闭失效
docs: 补充 bgm.tv 网络访问说明
```

提交时 Husky + lint-staged 会对暂存文件执行 ESLint / Prettier。若提交被拦截：

1. 先看输出中的具体规则与文件；
2. 在本地修复后重新 `git add`；
3. **不要使用 `--no-verify` 绕过检查**。

> 注意：lint-staged 失败后可能恢复暂存备份，提交前请确认 `git status`，避免未暂存改动被还原。

---

<a id="质量门禁"></a>

## 质量门禁

提交前必须通过完整门禁：

```bash
npm run gate
```

`gate` 依次执行：

1. `lint:check` — ESLint 0 error / 0 warning
2. `check:dompurify-version` — DOMPurify 版本与许可证一致性
3. `check:module-manifest` — 模块清单完整性
4. `check:cycles` — 禁止循环依赖
5. `check:ribbon-buttons` — Ribbon 按钮与 action 映射
6. `check:nav-order` — 设置面板导航顺序
7. `check:com-in-loop` — 禁止在循环中同步调用 COM
8. `check:detachable` — 可拆卸面板约束
9. `check:csp` — 页面 CSP 白名单
10. `check:wpsjs-patch` — wpsjs 补丁校验
11. `check:boot-com` — 启动阶段 COM 闸门
12. `typecheck:tests` — 测试文件类型检查
13. `test` — Vitest 全量测试

另有按需手工执行的检查：

```bash
npm run check:guards-reverse   # 验证源码级断言门禁本身有效
npm run check:shard-layout     # 真实浏览器布局检查（需本机 Chrome / Edge）
npm run audit:layout           # 全部页面布局审计（需本机 Chrome / Edge）
```

> 修改 `scripts/check-*.mjs` 后必须跑 `check:guards-reverse`；新增源码级断言时，需同步在脚本的变异用例列表里补一条“已知违规”，否则该断言无法证明自己有效。

---

<a id="代码约定"></a>

## 代码约定

### TypeScript

- 保持 `strict`（含 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）。
- **不要新增 `any`**；外部输入先用 `unknown` 收窄，再用 zod 校验。
- 优先使用明确的联合类型 / 判别联合，避免用字符串魔法值散落各处。
- 公共导出使用 `export { ... } from` 形式；`import type` 放在导入区顶部。

### 命名规范（不缩写）

> 本节为**硬性规范**，所有改动都必须遵守。完整对照表与反例见技能 `awujiana-readme-style` 的 `references/naming-conventions.md`。

**总则**

- **一律全拼，禁止缩写**：`usr`→`user`、`cfg`→`config`、`btn`→`button`、`img`→`image`、`msg`→`message`、`err`→`error`、`idx`→`index`。`ts/` 与 `tests/` 由 ESLint 的 `naming-convention` 与 `unicorn/name-replacements` 兜底，`npm run lint:check` 会拦。
- **名称不重复**：项目名全局唯一；同目录文件名唯一（大小写不敏感）；同模块导出名唯一；组件名全局唯一。
- **名称即语义**：禁止 `utils`、`common`、`misc`、`temp`、`data1`、`file2` 这类泛化名。`ts/tools/` 已按能力分文件（`http` / `wps` / `logger` / `sanitize` / `clipboard` / `theme`），新增能力继续分文件，不要往 `utils.ts` 里堆。
- **文件名即符号名**：`ts/tools/sanitize.ts` 导出 `sanitizeHtml` / `sanitizeTableRows`；`ts/sync/github-sync.ts` 只导出 GitHub 同步相关符号。

**文件命名**

| 类型        | 规则                                                           | 本仓库示例                                          |
| ----------- | -------------------------------------------------------------- | --------------------------------------------------- |
| 页面逻辑    | `kebab-case.ts`，加 `-page` 后缀                               | `ts/panel/conditional-format-page.ts`               |
| 模块 / 服务 | `kebab-case.ts`，名词                                          | `ts/services/ribbon-service.ts`                     |
| 工具函数    | `kebab-case.ts`，导出 `camelCase`                              | `ts/tools/sanitize.ts` → `sanitizeHtml`             |
| 校验脚本    | `check-<对象>.mjs`                                             | `scripts/check-csp.mjs`                             |
| 测试        | `<被测模块>.test.ts`                                           | `tests/conditional-format-page.test.ts`             |
| 样式        | 按页面或能力命名                                               | `css/panel-theme.css`、`css/conditional-format.css` |
| 页面 HTML   | 与面板名一致                                                   | `ui/conditional-format.html`                        |
| 文档        | `kebab-case.md`，或 `文档/` 内既有的大写形式（**同目录统一**） | `文档/USER_OPERATIONS.md`                           |

- **同一目录内不得出现同名文件**，包括仅大小写不同（`RuleList.ts` 与 `rulelist.ts` 视为冲突）。
- 不要用 `index.ts` 做唯一出口造成同名歧义；需要桶文件时显式命名（如 `sync-sources.ts`）。

**函数与类型命名**

- **函数**：`camelCase`，**动词开头 + 名词**，全拼：`renderRuleList`、`anchorExistingGroup`、`serializeRules`。
- **类型 / 接口**：`PascalCase` 名词：`PluginRecord`、`GithubRemoteEntry`。
- **常量**：`UPPER_SNAKE_CASE`：`STANDARD_HEADERS`、`LOG_LEVEL_MIN`、`REQUIRED_SHARD_ANCHORS`。
- **布尔变量**：`is` 前缀（`isLocked`、`isInGroup`）。
- **面板页面逻辑**：文件名用 `-page.ts` 后缀，入口函数 `init<Name>Page`。
- 同一模块内不得出现同名导出；不同模块同名须加限定词（`fetchUserProfile` / `fetchTeamProfile`）。

**冲突处理**

加**语义限定词**，不要数字后缀。`renderRuleList` 与 `renderRuleList2` ❌；应为 `renderRuleList` 与 `renderForeignRuleGroupsHtml` ✅。

**结构与嵌套**

- 双层循环里的 `break` / `continue` 抽成辅助函数并早返回，降低嵌套。
- 不要为一次性逻辑造抽象；三行重复代码通常比过早抽象更好维护。

### 架构约束

- **禁止循环依赖**：新增模块前先确认依赖方向；跨层共享逻辑下沉到 `tools/` 或 `core/`。
- **UI 事件统一走 `data-action`**：在 HTML 上标注 `data-action`，由 `ts/ui/handlers/` 统一分发，不要在页面脚本里散落大量 `onclick`。
- **持久化统一走 `PluginStorage`**：键名集中管理，避免同一状态存两份（例如锁定工作表统一使用 `BGM.sheet` + `bgm_locked_sheet`）。
- **HTML 拼接必须清洗**：动态 HTML 一律经 `sanitizeHtml`；表格行片段使用 `sanitizeTableRows`（DOMPurify 会剥离顶层 `<tr>/<td>`）。
- **COM 调用约束**：启动阶段与循环中遵循现有闸门（`com-ready`、`check:com-in-loop`），避免宿主互锁。

### 样式

- 颜色、间距、字号优先使用 `css/tokens.css` 变量，保证深浅主题自动适配。
- 新增页面需确认窄任务窗格（320px）下的单列布局。
- 修改 `css/**` 或分片区块后，建议跑 `check:shard-layout` / `audit:layout`。

---

<a id="测试要求"></a>

## 测试要求

- 测试框架：Vitest（`tests/`，按模块命名，如 `enrich-engine.test.ts`）。
- 新增/修改逻辑必须补测试；**修 Bug 时优先写回归测试**。
- 只测试可观察行为，避免断言内部实现细节。
- 涉及 DOM 的测试在文件头添加 `@vitest-environment jsdom`。
- 本地运行单个文件：

```bash
npx vitest run tests/your-test.test.ts
```

- 覆盖率报告：

```bash
npm run test:coverage
```

---

<a id="文档与截图"></a>

## 文档与截图

- 行为/交互变更需同步更新：
  - `README.md`（用户可见能力、安装与网络说明）—— **随仓库分发**
  - `AGENTS.md`（AI 协作约定与核心不变量）—— **随仓库分发**
  - `CHANGELOG.md`（每处修复的成因与实测数据）—— **随仓库分发**
  - `文档/USER_OPERATIONS.md`、`文档/ARCHITECTURE.md` —— 只在**维护者本地工作区**，
    不随仓库分发（README 因此不链它们）；改这两个文件不必进发布分支。
- README 截图存放于 `images/`，使用 `screenshot-*.png` 命名；新增截图请同时更新「界面预览」小节。
- 文档中的相对链接必须能在 GitHub 上直接打开。

---

<a id="发布流程"></a>

## 发布流程

1. 更新 `package.json` 的 `version`。
2. 确认 `npm run gate` 全绿。
3. 构建发布包：

   ```bash
   npm run build
   VERSION=$(node -p "require('./package.json').version")
   zip -r "My-Bangumi-Database-for-WPS-v${VERSION}.zip" dist
   ```

4. 在 GitHub 创建 `vX.Y.Z` Release，上传 zip，并填写更新说明。
5. 插件「检查更新」读取 `releases/latest`，资产名需与 `My-Bangumi-Database-for-WPS-vX.Y.Z.zip` 约定一致。

> GitHub API 对未认证请求按 IP 限流（60 次/小时）。插件已内置 `raw.githubusercontent.com` 的版本兜底，但发布时仍建议确保 Release 资产命名规范。

---

<a id="报告问题"></a>

## 报告问题

提交 Issue 时请附上：

- 插件版本（Release 标签或 `package.json` 的 `version`）
- WPS 版本与操作系统
- 复现步骤（尽量最小化）
- 期望行为 vs 实际行为
- 日志 / 截图（可在插件日志面板导出）
- 是否使用了代理（`bgm.tv` 在中国大陆需代理）

安全问题请通过邮件私下联系作者，不要在公开 Issue 中披露。

---

<a id="开源协议"></a>

## 开源协议

本项目采用 [GNU AGPL v3.0](LICENSE)。  
提交 PR 即表示你同意以同一协议授权你的贡献。若引入第三方代码/资源，请注明来源与许可证，并确保与 AGPL-3.0 兼容。
