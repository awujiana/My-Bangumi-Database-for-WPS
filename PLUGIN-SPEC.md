# MBD 插件开发规范（PLUGIN-SPEC）

> 适用宿主：**MBD（My Bangumi Database for WPS）** v2.5.0 起。
> 本文件是插件作者的唯一契约来源：`plugin.json` 的字段、目录结构、生命周期、
> 可用 API 与权限判定，全部以这里为准。
> 宿主侧的实现方案见 [`文档/插件市场.md`](文档/插件市场.md)。

---

## 1. 插件是什么

插件是**一份跑在 MBD 页面容器里的 ES Module**，通过宿主注入的 `context.host` 访问
表格数据、网络与界面能力。它不是独立的 WPS 加载项：

| | MBD 插件 | 独立 WPS 加载项 |
| --- | --- | --- |
| 注册方式 | 在 MBD 插件市场里安装 | 写 `publish.xml` + 注册 `jsplugin` |
| 运行上下文 | 与 MBD 同一个 WebView | 自己的 WebView |
| 能拿到的能力 | 宿主 API（表格 / 存储 / 网络 / 界面） | 只有 WPS 原生 JSAPI |
| 更新 | 宿主后台静默替换文件 | 用户手动覆盖安装 |

代价要说清楚：**插件与宿主同上下文，不是沙箱**。插件能碰到 `window`、`document`，
也能绕过宿主直接调 WPS COM。权限声明是**契约与告知**，不是内核级隔离 —— 详见第 7 节。

---

## 2. 目录结构

一个插件仓库的最小形态：

```
<你的仓库>/
├── plugin.json          # 清单（宿主只读这个判断版本与权限）
├── plugin.js            # 入口，ES Module，单文件
├── README.md            # 给人看：功能、截图、数据来源
├── CHANGELOG.md         # 建议有：每次更新改了什么
└── data/                # 可选：插件自带的数据（JSON / JSONLines）
```

约束：

- `plugin.js` **必须是单文件 ESM**，可以 `import './data/xxx.js'`（同目录相对路径），
  **不能** `import` npm 包 —— 宿主不做打包，也没有 `node_modules` 解析。
- 需要第三方库时，把它的 ESM 产物一起放进仓库，用相对路径引入。
- 文件编码 **UTF-8 无 BOM**；文件名只用 `[a-z0-9._-]`。
- 单个插件解压后建议 **≤ 2 MB**（宿主走 raw CDN 单文件下载，太大体验差）。

---

## 3. `plugin.json`

宿主按这个文件决定「装不装、能不能跑、给多少权限」。

```json
{
  "schemaVersion": 1,
  "id": "hmoe-new-anime",
  "name": "H萌新番表",
  "version": "1.2.0",
  "apiVersion": "1.0.0",
  "minHostVersion": "2.5.0",
  "description": "一键把 H萌字幕组的新番表下载成本地 Excel，并按标准字段整理进你的番组数据库。",
  "author": "awujiana",
  "homepage": "https://github.com/awujiana/MBD-plugin-hmacg",
  "license": "AGPL-3.0",
  "entry": "plugin.js",
  "permissions": ["data.read", "data.write", "net.fetch", "storage", "ui.toast"],
  "network": ["raw.githubusercontent.com", "api.github.com"],
  "features": [
    { "key": "download", "name": "下载新番表", "description": "拉取最新一期新番数据并另存为 Excel" },
    { "key": "merge", "name": "整理进数据库", "description": "按 id 去重合并到当前工作簿" }
  ],
  "updatePolicy": "auto",
  "checksum": {
    "plugin.js": { "sha256": "…64 位小写十六进制…", "size": 20480 }
  },
  "signature": {
    "algorithm": "ecdsa-p256-sha256",
    "keyId": "awujiana-2026",
    "value": "…base64 的签名值…"
  }
}
```

### 字段表

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schemaVersion` | ✅ | 清单格式版本，当前固定 `1`。宿主遇到更高版本会拒绝安装并提示升级宿主。 |
| `id` | ✅ | 全局唯一，`[a-z0-9-]`，**装完不可改**（改 id 等于另一个插件，会并存）。建议 `<来源>-<用途>`。 |
| `name` | ✅ | 展示名，≤ 24 字符。 |
| `version` | ✅ | 语义化版本 `MAJOR.MINOR.PATCH`。**无感更新只认这个字段**，改了代码必须改它。 |
| `apiVersion` | ✅ | 插件所依赖的宿主 API 版本。宿主按 `MAJOR` 判兼容（见第 8 节）。 |
| `minHostVersion` | ✅ | 低于此版本宿主拒绝加载，市场页显示「需要 MBD ≥ x.y.z」。 |
| `description` | ✅ | 一句话功能描述，≤ 120 字，市场页直接展示。**写清「做什么」而不是「怎么实现」**。 |
| `author` | ✅ | 作者名或 GitHub 账号。 |
| `homepage` | 建议 | 仓库地址，市场页给「查看源码」用。 |
| `license` | 建议 | SPDX 标识。 |
| `entry` | ✅ | 入口文件，固定 `plugin.js`（保留字段，方便将来多入口）。 |
| `permissions` | ✅ | 权限数组，见第 7 节。**空数组也要写**。 |
| `network` | 条件 | 只有声明了 `net.fetch` 时才需要：允许访问的域名白名单（精确匹配，支持 `*.example.com`）。 |
| `features` | 建议 | 功能清单，市场页与设置页用它列「这个插件能干什么」。每项 `key` / `name` / `description`。 |
| `updatePolicy` | 可选 | `auto`（默认，后台静默更新）/ `manual`（只在用户点「更新」时）。 |
| `checksum` | ✅ | 每个文件的 `sha256` + `size`。宿主下载后逐一比对，不一致直接拒装。 |
| `signature` | 强烈建议 | 作者签名，见第 7 节。**没有它用户会看到「未签名」并需要二次确认**；有它且验签通过才显示「作者已验证」。 |

### 版本号规则

- `version` **单调递增**。宿主只做「新版本 > 旧版本」判断，降级需要用户手动「重装」。
- 改 `plugin.js` 必须同时改 `version` 并重算 `checksum` —— 否则用户永远收不到更新
  （宿主认为版本没变）。
- `apiVersion` 与 `version` 无关：改插件功能升 `version`；只有用上新宿主 API 才升 `apiVersion`。

---

## 4. 生命周期

```js
// plugin.js
export async function activate(context) {
  const { host, storage, log } = context
  log.info('hmoe 插件已激活', { hostVersion: host.version })

  const lastSync = await storage.get('lastSyncAt')
  if (lastSync) log.debug('上次同步', { lastSync })

  host.ui.registerCommand({
    id: 'download',
    title: '下载新番表',
    run: () => downloadNewAnime(context),
  })
}

export async function deactivate(context) {
  // 可选：释放定时器、取消未完成的请求
}
```

| 钩子 | 何时调用 | 约束 |
| --- | --- | --- |
| `activate(context)` | 插件被启用、页面加载完成 | **≤ 200 ms** 内返回或 `await` 可取消的操作。长任务放到 `registerCommand` 的回调里。 |
| `deactivate(context)` | 用户禁用/卸载插件、页面卸载 | 必须同步完成，不要再发网络请求。 |
| `onConfigChange(patch)` | 可选：插件自己的配置变化 | 参数是变更后的完整配置。 |

`context` 结构：

```ts
interface PluginContext {
  host: HostApi          // 第 5 节
  storage: PluginStorage // 插件私有命名空间，键自动加 `plugin:<id>:` 前缀
  log: PluginLogger      // 输出到 MBD 的日志面板，带插件 id 前缀
  config: unknown        // 用户在插件设置里填的配置（原样透传）
  manifest: PluginManifest
  dispose(): void        // 注册清理回调：dispose(() => clearInterval(timer))
}
```

**不要**在 `activate` 里弹窗、改表、发请求 —— 页面刚加载完就动表格会让用户以为出了 bug。
所有副作用都应该由用户点命令触发。

---

## 5. 宿主 API

插件通过 `context.host` 访问，**不要**直接读 `window.BGM`（那是给调试用的镜像，
插件卸载时会被清掉）。

### 5.1 元信息

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `host.version` | `string` | MBD 版本，如 `2.5.0` |
| `host.apiVersion` | `string` | 宿主 API 版本，如 `1.0.0` |
| `host.plugin` | `{ id, version }` | 当前插件自己的身份 |
| `host.locale` | `'zh-CN' \| 'zh-TW' \| 'en'` | 当前界面语言 |

### 5.2 表格（`sheet.*`，需 `sheet.read` / `sheet.write`）

| 方法 | 说明 |
| --- | --- |
| `host.sheet.list()` | 返回工作表名数组 |
| `host.sheet.active()` | 当前活动工作表名 |
| `host.sheet.read(name)` | 读整表，返回 `Cell[][]`（值 + 类型），**上限 5 万行** |
| `host.sheet.readRange(name, row, column, rowCount, columnCount)` | 读矩形区域 |
| `host.sheet.writeRange(name, row, column, rows)` | 写矩形区域，`rows` 为二维数组 |
| `host.sheet.add(name)` / `host.sheet.remove(name)` | 增删工作表（`sheet.write`） |

### 5.3 标准数据（`data.*`，需 `data.read` / `data.write`）

这一层是「番组记录」而不是「单元格」，插件不需要关心列号：

| 方法 | 说明 |
| --- | --- |
| `host.data.headers()` | 标准表头数组（当前 73 列，与 MBD 主存档一致） |
| `host.data.read(options?)` | 读当前表为标准记录：`{ id, name, 中文名, … }`，未知列原样保留 |
| `host.data.write(records, options?)` | 写入记录；`options.mode` = `append` / `merge` / `replace`，`options.key` 默认 `id` |
| `host.data.exportXlsx(records, fileName)` | 把记录导出为 xlsx（宿主负责落盘与命名） |

`merge` 语义：按 `key` 匹配，已存在的记录只更新**非空字段**，不删除原有列。

### 5.4 网络（`net.fetch`，需 `net.fetch` + `network` 白名单）

| 方法 | 说明 |
| --- | --- |
| `host.net.fetch(url, init?)` | 只允许白名单域名；返回 `{ status, headers, body: string }` |
| `host.net.fetchJson(url)` | 同上，自动 `JSON.parse` |
| `host.net.fetchBytes(url)` | 返回 `Uint8Array`，用于 zip / gzip |

宿主统一加 `User-Agent: MBD/<version> (<plugin id>)`，并做 30 秒超时与 2 次重试。

### 5.5 存储（`storage.*`，需 `storage`）

`get(key)` / `set(key, value)` / `remove(key)` / `keys()` / `clear()`。
键自动加前缀，插件之间互不可见；值必须是 JSON 可序列化，单键 ≤ 256 KB。

### 5.6 界面（`ui.*`）

| 方法 | 权限 | 说明 |
| --- | --- | --- |
| `host.ui.toast(message, level?)` | `ui.toast` | `level` = `info` / `warn` / `error`，2.5 秒自动消失 |
| `host.ui.confirm(message, options?)` | `ui.toast` | 返回 `Promise<boolean>`，用于写表前的二次确认 |
| `host.ui.progress(options)` | `ui.toast` | 返回 `{ update, done }`，用于长任务 |
| `host.ui.registerCommand({ id, title, run })` | 无 | 在市场页与该插件详情里生成一个按钮 |
| `host.ui.openPane(pageId)` | `ui.pane` | 打开宿主已有页面（`clean` / `enrich` / `settings` …） |

### 5.7 事件与国际化

| 成员 | 说明 |
| --- | --- |
| `host.events.on(name, handler)` / `off` | 可用事件：`sheet.changed`、`locale.changed`、`workbook.opened` |
| `host.i18n.t(key, fallback, parameters?)` | 与宿主同签名；插件自己的 key 用 `<id>.<key>` 前缀，宿主包不覆盖 |

### 5.8 插件自带 Ribbon 按钮（**v1 不做**）

**现状：插件不会被注册成独立加载项**，`ribbon.xml` 是宿主的一部分，插件改不了它。
插件能挂的入口只有两个：

1. `host.ui.registerCommand({ id, title, run })` —— 在市场页与该插件的详情里生成按钮；
2. 插件自己 `import()` 后直接操作 DOM（不推荐：宿主一改版就可能失效）。

**将来要做「插件自带新 Ribbon 按钮」时的机制**（写在这里，避免重复设计）：

- 清单新增 `ribbon: [{ id, label, icon, command }]`，`id` 必须以 `<插件id>_` 开头，
  宿主在启动时把各插件的条目**合并进内存中的 ribbon 定义**，不改磁盘上的 `ribbon.xml`；
- 因为 WPS 的 Ribbon 在加载项加载时就固定了，插件按钮**只在下一次启动 WPS 后出现**，
  与「更新要重开页面生效」同一个取舍；
- 图标必须由插件自带（`icons/<name>.svg`，同样过 `checksum`），宿主不接受远程图标 URL；
- 卸载时同步移除该插件的条目，且**不需要**重写 `ribbon.xml`；
- 权限上需要新增 `ribbon` 一项 —— 它属于「改变宿主界面」，必须单独告知用户。

这条路线**不进 v1**：它需要改宿主的 Ribbon 装配流程（`ts/ribbon.ts` 目前是静态表），
且一旦合并逻辑出错，坏的是整个功能区的加载。等插件生态真出现「需要常驻入口」的插件
再做，届时按上面五条落地。

---

## 6. 权限清单

| 权限 | 授予的能力 | 用户看到的风险提示 |
| --- | --- | --- |
| `sheet.read` | 读任意工作表 | 「可以读取你工作簿里的任何内容」 |
| `sheet.write` | 写任意工作表 | 「可以修改或删除你工作簿里的内容」 |
| `data.read` | 读标准番组记录 | 「可以读取你的番组数据」 |
| `data.write` | 写标准番组记录 | 「可以修改你的番组数据」 |
| `net.fetch` | 访问白名单域名 | 「会联网访问：<域名列表>」 |
| `storage` | 插件私有存储 | 「会在本机保存插件数据」 |
| `ui.toast` | 弹提示、确认框、进度条 | 无 |
| `ui.pane` | 打开宿主页面 | 「可以打开 MBD 的其他页面」 |
| `log` | 写日志面板 | 无（默认授予） |

判定规则：

1. 安装时把 `permissions` 原样展示给用户，**用户确认后才落盘**。
2. 运行时按权限包 API：没声明 `sheet.write`，`host.sheet.writeRange` 就是 `undefined`
   —— 不是抛错，而是**不存在**，插件应该在 `activate` 里检查并降级。
3. 插件升级**新增**权限时，宿主不静默授予：暂停更新，市场页标「需要重新授权」。
4. 声明了 `net.fetch` 但 `network` 为空 → 拒绝安装（防止「万能代理」插件）。

---

## 7. 安全模型（请读完再发布）

**插件不是沙箱。** 宿主与插件在同一个 WebView、同一个 JS 堆里，插件可以直接
`window.wps`、可以 `document.querySelector`、可以读任何宿主内存里的东西。
权限声明的作用是：

- **告知**：让用户在装之前知道这个插件会碰什么；
- **约束**：让插件只能通过 API 做事，代码可审查、行为可审计；
- **减面**：不声明就不给，降低「手滑写出越权代码」的概率。

宿主已做的防护：

- 插件包必须过 `checksum` 校验（sha256 + size），防止传输中被替换；
- 清单签名可被验证（第 7.1 节）：验签通过 → 市场页显示「作者已验证」，
  可直接安装；未签名 / 验签失败 → 必须点「无视风险安装」再确认一次；
- 只从用户填写的仓库拉取，不内置任何第三方源；
- 插件文件落盘后**不允许再发起 `import()` 以外的执行路径**（禁 `eval`、禁 `new Function`）；
- 插件的所有网络请求走 `host.net.fetch`，宿主记录 URL 与状态码到日志面板。

宿主**不做**的（请自行判断）：

- 不审查插件源码逻辑；
- 不限制插件直接调用 WPS COM（这是宿主自身的实现基础，无法收口）；
- 不提供进程级隔离。

因此：**装插件 = 信任作者**。市场页会显示作者、仓库地址、权限清单、checksum
与签名结论，请用户据此判断。

### 7.1 清单签名

**签什么。** 签名覆盖「决定插件能做什么」的字段，拼成一个确定性的字符串：

```
mbd-plugin
id:<id>
version:<version>
apiVersion:<apiVersion>
minHostVersion:<minHostVersion>
entry:<entry>
permissions:<权限，按 UTF-16 码位升序，逗号分隔>
network:<域名白名单，同上排序，逗号分隔>
checksum:<文件>:<sha256>:<size>（文件按码位升序，逗号分隔）
```

- 分隔符是 `\n`（LF），**末尾不带换行**；排序一律按码位，不用 `localeCompare`
  —— 否则同一个清单在不同语言的机器上会算出不同签名。
- `name` / `description` / `features` **不参与签名**：改文案不该导致重签，而它们
  被篡改最多让界面显示错乱，不会改变插件的行为边界。
- 因为 `checksum` 在签名范围内，而 `checksum` 锁住了 `plugin.js` 的 sha256，
  所以**签清单等价于签代码**，不需要单独给代码签名。

**怎么签。** 算法固定 `ecdsa-p256-sha256`（ECDSA P-256 + SHA-256，签名值用
IEEE P1363 的 raw `r||s`，64 字节，base64 编码）。选它而不是 Ed25519：WPS 内嵌的
CEF 版本不保证有 Ed25519，而 P-256 是 WebCrypto 的必备算法。

```bash
# 宿主仓库提供签名工具（私钥从环境变量或文件读，绝不进仓库）
node scripts/plugin-sign.mjs --manifest plugin.json --key ~/.mbd-plugin-signing-key.pem
```

**怎么验。** 宿主内置一张 `keyId → 公钥（SPKI DER，base64）` 表
（`ts/plugins/plugin-signature.ts` 的 `TRUSTED_PLUGIN_KEYS`）。五种结论：

| 结论 | 含义 | 安装行为 |
| --- | --- | --- |
| `verified` | 签名有效且公钥可信 | 可直接安装 |
| `unsigned` | 清单里没有 `signature` | 需点「无视风险安装」 |
| `untrusted-key` | 有签名，但 `keyId` 不在内置表里 | 同上 |
| `invalid` | 验签失败（清单被改过 / 不是这把私钥签的） | 同上 |
| `unsupported` | 环境没有 WebCrypto，无法验证 | 同上（**不冒充已验证**） |

**更新时的信任规则。** 自动更新只允许「信任不变差」：

- 新版本 `verified` → 正常更新；
- 新版本与已安装版本签名结论相同（例如一直是 `unsigned`）→ 正常更新；
- 原本 `verified`、新版本变成其他结论 → **暂停更新**，市场页显示「签名状态变化」，
  用户点「检查更新」后会被问一次，确认后才强制更新。

**加新作者。** 在 `TRUSTED_PLUGIN_KEYS` 里加一行 `keyId → 公钥` 并发版。
宿主不提供「用户自选公钥」—— 那等于把信任决策转嫁给看不懂公钥的用户。

---

## 8. 版本与兼容

- 宿主按 `apiVersion` 的 **MAJOR** 判兼容：插件声明 `1.x`，宿主 `apiVersion` 为 `1.y` → 加载；
  宿主升到 `2.0.0` → 拒绝加载并在市场页提示「插件需更新」。
- 插件应自己兜底：用到 `host.data.write` 前先 `typeof` 检查，避免旧宿主上直接崩。
- `minHostVersion` 用于「插件依赖新 API」的场景，与 `apiVersion` 二选一即可，
  建议两个都写：`apiVersion` 管接口形状，`minHostVersion` 管具体行为修复。

---

## 9. 发布与更新

### 9.1 仓库布局（宿主按此约定拉取）

首批两个插件的仓库（均为 Public）：

| 插件 | 仓库 | 说明 |
| --- | --- | --- |
| H萌新番表 | `awujiana/MBD-plugin-hmacg` | 下载 H萌新番 Excel → 整理进番组数据库 |
| 长门有C 番组数据 | `awujiana/MBD-plugin-yucwiki` | 从 GitHub 数据源取长门有C 数据 → 一键下载 → 整理进数据库 |

```
main 分支：
  plugin.json            # 必须
  plugin.js              # 必须
  data/manifest.json     # 插件自带数据时（数据源仓库的清单）
  data/*.jsonlines.gz    # 插件自带数据时
  scripts/               # 数据抓取与发布脚本（不参与运行）
  .github/workflows/     # 数据同步（频率待定）
```

宿主拉取地址：

```
https://raw.githubusercontent.com/<owner>/<repo>/main/plugin.json
https://raw.githubusercontent.com/<owner>/<repo>/main/plugin.js
```

> 用 raw 而不是 Release 资产：raw 支持 `cache: no-store` 直读、无需解压，
> 也不会遇到 `objects.githubusercontent.com` 的 CORS 问题。

### 9.2 发布步骤

1. 改代码 → 改 `plugin.json` 的 `version`；
2. 跑发布脚本重算 `checksum`（宿主仓库提供 `npm run plugin:manifest <目录>`，见第 10 节）；
3. **签名**：`node scripts/plugin-sign.mjs --manifest plugin.json --key <私钥>`，
   把输出的 `signature` 块写回清单。**必须在算完 checksum 之后签** —— 签名覆盖 checksum；
4. 提交并推 `main`；
5. 打 tag（可选，便于回溯）：`git tag v1.2.0 && git push origin v1.2.0`。

用户端**不需要**做任何事：宿主每 6 小时读一次 `plugin.json`，版本更高就后台下载替换。

### 9.3 更新是「静默」的，但必须可解释

- 替换成功后，市场页显示「已更新到 v1.2.0，重开页面生效」；
- 失败（网络/校验）不弹窗，只在市场页显示「上次检查：失败原因」；
- 用户可对单个插件关掉自动更新（`updatePolicy: manual` 的插件本来就不自动更）。

---

## 10. 调试

1. 宿主设置 → 开发者选项 → 打开「插件调试模式」；
2. 把插件目录放到 `<加载项目录>/plugins/<id>/`，市场页会出现「本地开发」标记；
3. 打开插件详情 → 「查看日志」，`context.log` 的输出实时显示；
4. 改代码后点「重新加载插件」（不需要重开 WPS）。

`npm run plugin:manifest` 是宿主仓库提供的辅助脚本（v2.5.0 起），做两件事：
重算 `checksum`、校验 `plugin.json` 是否符合本规范（字段缺失、权限枚举拼错、
`network` 未声明等）。

---

## 11. 最小示例

```js
// plugin.js
export async function activate(context) {
  const { host, log } = context

  if (typeof host.data?.write !== 'function') {
    log.warn('当前宿主不支持 data.write，插件降级为只读')
  }

  host.ui.registerCommand({
    id: 'hello',
    title: '打个招呼',
    run: async () => {
      const headers = host.data.headers()
      host.ui.toast(`标准表头 ${headers.length} 列`)
    },
  })
}
```

```json
{
  "schemaVersion": 1,
  "id": "hello-world",
  "name": "Hello World",
  "version": "0.1.0",
  "apiVersion": "1.0.0",
  "minHostVersion": "2.5.0",
  "description": "最小示例：打印标准表头列数。",
  "author": "you",
  "entry": "plugin.js",
  "permissions": ["data.read", "ui.toast"],
  "features": [{ "key": "hello", "name": "打个招呼", "description": "读标准表头并提示列数" }],
  "checksum": { "plugin.js": { "sha256": "…", "size": 512 } }
}
```

---

## 12. 提交前检查清单

- [ ] `plugin.json` 的 `version` 比上一版大；
- [ ] `checksum` 与实际文件一致（跑过 `plugin:manifest`）；
- [ ] `signature` 是在 `checksum` **之后**签的（顺序错了必然验签失败）；
- [ ] `permissions` 与实际调用一致 —— **没用到的不声明**，用到的必须声明；
- [ ] 声明了 `net.fetch` 时 `network` 列出了全部域名；
- [ ] `activate` 里没有长任务、没有弹窗、没有写表；
- [ ] 所有写表操作前有 `host.ui.confirm` 二次确认；
- [ ] 卸载/禁用时定时器、监听器都已清理（`context.dispose`）；
- [ ] `README.md` 写了数据来源、更新频率与已知限制；
- [ ] 没有 `eval` / `new Function` / 动态拼 `import()`。

---

## 附：本规范的版本

| 规范版本 | 日期 | 变更 |
| --- | --- | --- |
| 1.1 | 2026-11-04 | 加清单签名（§7.1）、首批两插件仓库（§9.1）、插件自带 Ribbon 按钮的将来机制（§5.8） |
| 1.0 | 2026-11-04 | 首版，对应宿主 MBD v2.5.0 / `apiVersion` 1.0.0 |
