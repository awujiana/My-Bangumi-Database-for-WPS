# BGM Excel 加载项（WPS 追番标记助手）

> 一个运行在 **WPS Office / Excel** 中的加载项，用于在本地 Excel 表格与 Bangumi 番组计划（[bgm.tv](https://bgm.tv/)）之间同步动画收藏数据：把 Excel 中的观看状态 / 评分 / 标签上传到 Bangumi，或从远程仓库拉取 Bangumi 资料数据填充 Excel。

---

## 📌 功能特性

| 能力                | 说明                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 📤 **上传同步**     | 将 Excel 中的观看状态、评分、标签批量同步到 Bangumi API（指数退避重试 + 请求竞态防护）。                                             |
| 📥 **数据同步**     | 从远程仓库（GitHub / GitLab / Gitee / Gist / 本地文件）下载 Bangumi 资料 JSONL 并增量写入 Excel，内置 24h 本地缓存与 DJB2 哈希比对。 |
| ↩️ **收藏下载**     | 从 Bangumi 拉取收藏列表标记到 Excel；工作表为空时可自动填充为 Bangumi 账号收藏条目，再标记到 Excel。                                 |
| 🔄 **5 种同步策略** | `add-update` / `add-only` / `update-only` / `mirror` / `force-overwrite`。                                                           |
| ✅ **同步偏好**     | 增量同步、冲突跳过、同步记录开关、默认收藏列表类型、默认时间筛选范围、自动刷新间隔；基于同步记录的「撤销同步」。                     |
| 🎨 **外观主题**     | 深色 / 浅色 / 跟随系统三种主题模式，`data-theme` 变量切换，跟随系统实时响应。                                                        |
| 🪄 **新番表富化**   | 自动补全新番表的名称 / 别名差异，映射 infobox 字段，减少手工录入。                                                                   |
| 🔑 **Token 管理**   | 设置、测试、复制、清除 Bangumi API Token。                                                                                           |
| ⚙️ **双面板 UI**    | 主面板 + 设置面板动态停靠协调；设置面板侧边功能导航（支持仅图标 + 悬停提示）；基于 `data-action` 的统一事件分发（30+ action）。      |

---

## 🧰 技术栈

- **语言**：TypeScript（strict 模式，ES2022 目标）
- **构建**：Vite 6（打包 `dist/`）+ `tsc`（编译 `dist-ts/`）
- **运行环境**：WPS Office JSAPI（ET 加载项），通过 `wpsjs` CLI 调试
- **代码质量**：ESLint 8（含 `@typescript-eslint/strict-type-checked` 类型检查档，全量 0 error）+ Prettier 3 + Husky + lint-staged
- **测试**：Vitest 4（含 `@vitest/coverage-v8`）
- **运行时依赖**：`zod`（数据校验）、`dompurify`（HTML 净化）
- **构建期依赖**：`@napi-rs/canvas` / `@resvg/resvg-js`（图像导出）

---

## 📂 目录结构

```
BGM/
├── index.html                  # 加载项入口（WPS 启动时加载）
├── main.js                     # 动态模块加载器（Ribbon 早期占位 + 模块就绪后替换真实实现）
├── manifest.xml                # 加载项清单（ApiVersion / Name）
├── ribbon.xml                  # 功能区按钮配置（"Bangumi同步" Tab）
├── vite.config.js              # Vite 构建配置
├── tsconfig.json               # TS 编译配置（strict）
├── package.json                # 脚本与依赖
├── ts/                         # TypeScript 源码
│   ├── core/                   # 常量、容器、类型、加密、服务
│   ├── entry/                  # ribbon / panel / settings 入口
│   ├── sync/                   # 同步引擎（githubSync / gitlabSync / giteeSync / gistSync / localFileSync / exceltobangumi）
│   ├── ui/                     # 面板 UI 与事件处理（handlers/）
│   ├── panel/                  # 主面板 / 设置面板页面逻辑
│   ├── services/               # 配置 / Ribbon 服务
│   ├── schemas/                # zod 校验 schema
│   └── tools/                  # 工具函数（http / wps / logger / sanitize ...）
├── ui/                         # 面板 HTML（panel.html / settings.html）
├── css/                        # 面板样式
├── images/                     # 功能区与面板 SVG 图标
├── config/
│   └── field_mappings.json     # Excel 列 ↔ 数据字段映射
├── data/
│   └── bangumi.jsonl           # 数据源本地副本（用于本地文件同步 / 开发测试）
├── differences/                # 数据差异摘要
├── 文档/                        # 项目文档（架构知识、用户操作手册、历史审计/评审、UI/交互、数据下发、数据源仓库说明、覆盖率报告，见「文档索引」）
├── tests/                      # Vitest 单元测试
├── scripts/                    # 构建 / 工具脚本（convert-icons.mjs 等）
├── wps-addon-build/            # 遗留发布构建产物（含打包用的 test.exe，旧 taskpane 命名，非日常开发所需）
└── dist/ , dist-ts/            # 构建产物（dist 由 Vite 生成，dist-ts 由 tsc 生成；二者均不入库，源码在 ts/）
```

> `dist/`、`dist-ts/`、`node_modules/`、`wps-addon-build/` 由构建或发布生成；`*.xlsx` 被 `.gitignore` 排除。`data/`、`differences/` 及其数据文件按 `.gitignore` 约定入库。

---

## 🔧 环境要求

| 依赖       | 版本                    | 说明                                       |
| ---------- | ----------------------- | ------------------------------------------ |
| WPS Office | 2019+（Windows）        | 需支持 JSAPI / 加载项调试（`wpsjs debug`） |
| Node.js    | 18+（推荐 LTS 20 / 22） | 构建与调试工具链                           |
| npm        | 随 Node 安装            | 包管理                                     |
| Git        | 较新版本                | 版本控制                                   |

---

## 📥 安装步骤

```bash
# 1. 克隆仓库
git clone <本仓库地址>
cd BGM

# 2. 安装依赖
npm install
```

> `wpsjs`、`vite` 等 CLI 已作为 devDependencies 随 `npm install` 安装，无需全局安装。

---

## 🐞 开发调试

加载项通过 WPS 的 `wpsjs debug` 启动调试会话（会编译 TS 并拉起 WPS 加载项）：

```bash
# 推荐：一键调试（先 tsc 编译，再 watch + 启动 WPS 调试）
npm run debug
```

`npm run debug` 等价于：

```bash
npm run build:ts                 # tsc --project tsconfig.build.json → dist-ts/
# 并行：tsc --watch 监听改动 + wpsjs debug 拉起 WPS
```

- **调试入口**：WPS 启动时加载 `index.html`，`main.js` 完成 Ribbon 早期占位；TypeScript 模块就绪后由 `ts/ribbon.ts` 通过 `window._bgmRibbonReady` 替换真实实现并 `Invalidate` 刷新图标。
- 若仅需 Vite 开发服务器（`npm run dev`，端口 `5173`）：**生产构建与 WPS 加载仍使用 `npm run debug` / `npm run build`**，Vite dev server 仅用于前端资源调试，不代表最终加载行为。`dev` 端口已与 wpsjs 调试端口（`3889`）错开，避免冲突。

---

## 📦 构建与打包

```bash
# 完整构建：tsc → dist-ts/ ，再 Vite 打包 → dist/
npm run build

# 仅编译 TypeScript（不打包）
npm run build:ts
```

**构建产物**：

- `dist-ts/`：`tsc` 编译后的 JS（被 `main.js` / `panel.html` 运行时依赖）。
- `dist/`：`vite build` 输出，含 `manifest.xml`、`ribbon.xml`、`images/`、`ui/`、`main.js`、`dist-ts/**`、`css/` 与经哈希的 `assets/`。将此目录作为加载项发布包部署到 WPS。

---

## 📖 使用示例

### 1. 设置 Bangumi Token

1. 在 Bangumi 个人设置中获取 **API Token**。
2. 点击功能区 **设置Token**（或主面板 Token 区「设置」），粘贴 Token。
3. 点击 **测试Token** 验证有效性，再点 **保存**。

### 2. 上传同步（Excel → Bangumi）

1. 在 Excel 中准备好追踪表（含「名称 / 是否看完 / 打分 / 标签分级」等列）。
2. 打开 **同步面板**，在「数据选择区」选择目标工作簿与工作表（支持自动 / 手动选择模式）。
3. 点击 **上传同步**（整表）或 **选中行同步**（仅选中范围）。
4. 实时进度条显示成功 / 失败 / 跳过计数；完成后写入同步记录并 Toast 总结。

### 3. 数据同步（远程仓库 → Excel）

1. 打开 **设置面板** →「远程仓库配置」，填写：

   | 配置项 | 值                            |
   | ------ | ----------------------------- |
   | 同步源 | GitHub                        |
   | owner  | `awujiana`                    |
   | repo   | `Bangumi-Archive-Anime-Excel` |
   | branch | `main`                        |
   | path   | `data/bangumi.jsonl`          |

2. 选择同步策略（`add-update` 默认，保守）。
3. 点击 **立即同步**（或功能区 **数据同步**）。插件下载 JSONL → 哈希比对缓存 → 按 SID 增量写入 Excel。
4. 可用 **撤销同步** 回滚上一次操作；**清缓存** 强制重新下载。

> 数据源格式、缓存机制与 5 种策略详见 [`文档/github-data-distribution.md`](文档/github-data-distribution.md)。

### 4. 新番表富化

点击功能区 **新番表富化**，对「新番表」执行字段自动补全（名称 / 别名差异补全、infobox 字段映射），减少手工录入。

---

## 🧪 测试

```bash
npm test                 # 运行全部单元测试（Vitest）
npm run test:watch       # 监视模式
npm run test:coverage    # 生成覆盖率报告
```

---

## 🤝 代码规范与贡献指南

### 分支与提交流程

1. 从 `main` 切出特性分支：`git checkout -b feat/xxx` 或 `fix/xxx`。
2. 开发，并确保通过 lint / format / test。
3. 使用 **Conventional Commits** 规范提交：

   ```
   <type>(<scope>): <subject>
   ```

   - `type`：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `style` / `perf`
   - 示例：`feat(sync): 实现别名富化 - 新番表名称差异自动补全`、`fix: 修复状态泄漏 + 统一 Button 命名空间`

4. 提交至 `main`（或发起 PR，视团队流程）。

### 代码质量

- **ESLint**：`npm run lint:check`（检查）/ `npm run lint`（自动修复），规则见 `.eslintrc.cjs`。
- **Prettier**：`npm run format:check` / `npm run format`，配置见 `.prettierrc`。
- **Husky + lint-staged**：`prepare` 安装 Git hook，提交时自动对暂存文件执行 lint / format（配置见 `lint-staged.config.js`、`.husky/`）。
- **TypeScript**：`tsconfig.json` 开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 等严格检查；新增代码需通过 `npm run build:ts` 类型检查。

### 架构约定

- **模块解耦 / 循环依赖治理**：避免 `ts/` 模块间的循环依赖（参见提交「循环依赖治理与模块解耦完成」）。
- **面板命名**：统一 `taskpane` → `panel` 命名，页面逻辑文件使用 `Page` 后缀（`ts/panel/`）。
- **事件分发**：UI 通过 `data-action` 属性 + 统一 `handleActionClick(action, event)` 路由（见 `ts/ui/handlers/` 与 [`文档/ui-and-interaction.md`](文档/ui-and-interaction.md)）。
- **持久化**：配置经 `PluginStorage` 存储（`bgm_token` / `github_config` / `bgm_incremental_sync` / `bgm_theme` / `bgm_list_type` / `bgm_time_filter` / `bgm_refresh_interval` / `bgm_nav_icons_only` 等键）。
- **数据校验**：外部数据经 `ts/schemas/` 下的 zod schema 校验，再写入 Excel。

### 扩展：新增同步源 / 字段映射

- **新增同步源**：在 `ts/sync/` 下实现 `SyncSource` 接口并注册到 `syncSourceRegistry.ts`。
- **字段映射**：编辑 `config/field_mappings.json`，并在 `ts/schemas/` 补充对应 zod 校验。

---

## 📚 文档索引

| 文档                                                                   | 说明                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`CHANGELOG.md`](CHANGELOG.md)                                         | 跨文档变更总览（按内部功能版本记录）                            |
| [`文档/ARCHITECTURE.md`](文档/ARCHITECTURE.md)                         | 架构与项目知识：分层模型、模块详解、配置体系、数据流、构建发布  |
| [`文档/USER_OPERATIONS.md`](文档/USER_OPERATIONS.md)                   | 用户操作手册：每个按钮 / 面板 / 模态框的操作流程与边界          |
| [`文档/ui-and-interaction.md`](文档/ui-and-interaction.md)             | UI 架构、面板交互、事件机制、Processor 清单                     |
| [`文档/图标规范.md`](文档/图标规范.md)                                 | 图标规范：SVG / emoji 双体系、语义→图标映射表、VS16 规则        |
| [`文档/github-data-distribution.md`](文档/github-data-distribution.md) | 远程数据下发机制、JSONL 格式、同步策略                          |
| [`文档/README.data-distribution.md`](文档/README.data-distribution.md) | 数据源仓库（Bangumi-Archive-Anime-Excel）说明（参考）           |
| [`文档/项目文档.md`](文档/项目文档.md)                                 | 数据源仓库项目文档：仓库级架构、转换脚本、CI 流程（参考）       |
| [`文档/项目操作指南.md`](文档/项目操作指南.md)                         | 数据源仓库维护操作指南：初始化、发布、验证、回滚（参考）        |
| [`文档/coverage-report.md`](文档/coverage-report.md)                   | 测试覆盖率报告（历史快照，以本地 `npm run test:coverage` 为准） |

> 全部项目文档已统一置于 `文档/` 下（架构/操作类核心文档与数据源仓库参考文档合并管理）。

---

## 🗂️ 数据来源

插件默认从公开仓库 [`awujiana/Bangumi-Archive-Anime-Excel`](https://github.com/awujiana/Bangumi-Archive-Anime-Excel) 读取 `data/bangumi.jsonl`（Bangumi 官方 Archive 每周 dump 处理后的动画条目数据）。本仓库 `data/` 下保留一份本地副本，用于「本地文件同步」与开发测试。

---

## 📜 许可证

本项目采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)（署名 – 非商业性使用 – 相同方式共享）。数据来源于 [Bangumi Archive](https://github.com/bangumi/Archive)。
