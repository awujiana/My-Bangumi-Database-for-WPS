# BGM 命名规范

> 适用范围：`ts/**` 与 `tests/**` 的 TypeScript 源码。
> enforced by：`eslint.config.mjs` 的 `@typescript-eslint/naming-convention`
> ＋ `unicorn/name-replacements`（双轨，见下）。
> 门禁：`npm run lint:check`（`npm run gate` 的一环），0 error 才放行。

---

## 1. 总则

1. **标识符一律全拼，不允许缩写。**
2. **lint 不报 ≠ 命名合规。** 这是本项目踩过的最大的坑：
   `unicorn/name-replacements` 只认「字母形态」（`ws` 是合法 camelCase），
   且它自带的 110 条替换表里**没有** `ws / col / sid / hl / cf`。
   前几轮 `cf → conditionalFormat`、`ws/col/sid → worksheet/column/subjectId`
   全靠人工排查才发现，lint 全程绿。
   本规范新增的 `@typescript-eslint/naming-convention` 配置就是补这一层：
   **把缩写拦截变成门禁**，新写的缩写在 lint 阶段就被拦下。

### 双轨规则分账

| 规则                                   | 管什么                                                       | 覆盖位置                                                                  |
| -------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `unicorn/name-replacements`            | 单词级替换（含自动修复建议）                                 | 变量 / 参数 / 函数                                                        |
| `@typescript-eslint/naming-convention` | 缩写黑名单 + 字母形态（camelCase / PascalCase / UPPER_CASE） | 变量 / 参数 / 函数 / 类型 / 方法 / 访问器 / 枚举成员 / 类属性 / import 名 |

两者口径**刻意对齐**：`naming-convention` 的缩写黑名单直接以
`unicorn/name-replacements` 的词表为基线，再叠加本项目增量。

---

## 2. 形态规则

| 位置                                   | 形态                            | 示例                                           |
| -------------------------------------- | ------------------------------- | ---------------------------------------------- |
| 变量 / 参数 / 函数 / 方法              | `camelCase`                     | `worksheet`、`columnMap`、`applyHighlight()`   |
| 类 / 接口 / 类型别名 / 枚举 / 类型参数 | `PascalCase`                    | `EnrichColumnMapping`、`WireRemoteEntry`       |
| 模块级常量                             | `UPPER_CASE`                    | `SYNC_RECORD_COLUMN`、`MAX_COMMENT_LENGTH`     |
| 未使用参数                             | `_` 或 `_` + camelCase          | `_`、`_worksheet`、`_columnMap`                |
| 模块级内部句柄                         | `_` + camelCase（项目既有约定） | `_ribbonMessageHandler`、`_configPollingTimer` |
| 双下划线（测试专用重置钩子）           | `__` + camelCase                | `__resetSyncRecordCache`                       |

`_` 前缀同时被 `@typescript-eslint/no-unused-vars` 的 `argsIgnorePattern`
与 `no-underscore-dangle`（已关闭）认可，是项目既有约定。

---

## 3. 缩写黑名单

### 3.1 词表来源

- **① 基线**（`UNICORN_ABBREVIATIONS`）：与 `unicorn/name-replacements` 同源，
  剔除单字母项（否则 `theme` 里的 `e` 会被误判）。
- **② 项目增量**（`PROJECT_ABBREVIATIONS`）：unicorn 表不管、但本项目实际踩过
  或极易再犯的缩写。

两份都在 `eslint.config.mjs` 顶部，**新增缩写只改 `PROJECT_ABBREVIATIONS`**。
全量清单见该文件（约 130 条），高频对照如下。

### 3.2 高频对照表

| 缩写                   | 全拼                                              | 缩写               | 全拼                   |
| ---------------------- | ------------------------------------------------- | ------------------ | ---------------------- |
| `ws`                   | worksheet                                         | `param` / `params` | parameter / parameters |
| `col` / `cols`         | column / columns                                  | `msg`              | message                |
| `sid` / `sids`         | subjectId / subjectIds（**线上键除外**，见 §4.1） | `err`              | error                  |
| `hl`                   | highlight                                         | `num`              | number                 |
| `cf`                   | conditionalFormat                                 | `tmp`              | temporary              |
| `cfg`                  | config                                            | `idx`              | index                  |
| `ctx`                  | context                                           | `fn`               | function               |
| `env`                  | environment                                       | `opt`              | option                 |
| `val` / `vals`         | value / values                                    | `len`              | length                 |
| `util` / `utils`       | utility / utilities                               | `img`              | image                  |
| `win`                  | window（**避免直接叫 `window`，会遮蔽全局**）     | `cls`              | cssClass               |
| `del`                  | delete                                            | `orig`             | original               |
| `impl`                 | implementation                                    | `doc`              | document               |
| `src` / `dest` / `dst` | source / destination / destination                | `res` / `req`      | response / request     |
| `buf`                  | buffer                                            | `btn`              | button                 |
| `el` / `elem`          | element / elements                                | `prev` / `cur`     | previous / current     |
| `attr` / `attrs`       | attribute / attributes                            | `prop` / `props`   | property / properties  |
| `arr` / `obj` / `str`  | array / object / string                           | `var` / `vars`     | variable / variables   |
| `sep`                  | separator                                         | `ver`              | version                |
| `dir` / `dirs`         | directory / directories                           | `pkg`              | package                |
| `hdr` / `lbl` / `txt`  | header / label / text                             | `dbg`              | debug                  |

### 3.3 判定算法（为什么不会误伤）

缩写必须是标识符里的一个**完整词段**才判违规。词段起点两个分支互补：

| 分支                                               | 形态                          | 例子 |
| -------------------------------------------------- | ----------------------------- | ---- |
| a) 开头或 `_` 之后，大小写任意                     | `colIndex`、`MAX_COMMENT_LEN` | 命中 |
| b) camelCase 边界（前一小写字母 + 本段首字母大写） | `setWin`、`nameCol`           | 命中 |

词尾锚定必须是「结尾 / 非字母 / 下一个 camel 词段的起点（大写+小写）」。

正反例：

| 名字                 | 判定    | 原因                                                    |
| -------------------- | ------- | ------------------------------------------------------- |
| `maxCol`             | ❌ 违规 | `Col` 后接结尾                                          |
| `maxColumn`          | ✅ 通过 | `Col` 后接 `u`，不成词尾                                |
| `colorIndex`         | ✅ 通过 | 同上（`Color` 不是 `Col` 词段）                         |
| `protocol`           | ✅ 通过 | `col` 前接小写 `t` 且本段首字母非大写，两个分支都不成立 |
| `setWin`             | ❌ 违规 | 分支 b 命中                                             |
| `window`             | ✅ 通过 | `win` 后接 `d`，不成词尾                                |
| `DEFAULT_BRANCH`     | ✅ 通过 | `DEF` 后接 `A`+`U`，不是新词起点                        |
| `MAX_COMMENT_LEN`    | ❌ 违规 | `LEN` 后接结尾                                          |
| `MAX_ADDRESS_LENGTH` | ✅ 通过 | `LEN` 后接 `G`+`T`                                      |
| `_ws`                | ❌ 违规 | 未使用参数**不豁免缩写检查**（见 §5）                   |

---

## 4. 豁免清单（每条都有理由）

### 4.1 线上契约键：`sid`

远程 dump / Excel 列名 / Gist 载荷里的键就是 `sid`，**改了就是数据事故**。
处理方式：**解析边界归一**，代码内部一律用 `subjectId`。

```ts
// ts/sync/github-sync-diff.ts
export type WireRemoteEntry = Record<string, unknown> & { sid: string } // 线上形状，不可改名
export function isWireRemoteEntry(value: unknown): value is WireRemoteEntry // 边界守卫
export function toRemoteEntry(wire: WireRemoteEntry): GithubRemoteEntry {
  const { sid: subjectId, ...fields } = wire // 解构处直接归一
  return { ...fields, subjectId }
}
```

同样的线上键还有 `EXPORT_FIELDS` 首列、`IMPORTANT_COLS` / `FIELD_NAME_MAP` 的键。
它们出现在**字符串字面量或属性位**，本规则本来就不覆盖（见 §4.3）。

### 4.2 公认缩略词

`id`、`url`、`api`、`json`、`xml`、`http`、`ui`、`bgm`、`wps`、`xlsx` 等首字母缩略词
视为独立单词，**不在黑名单内**（`subjectId`、`bangumiUrl` 合法）。

### 4.3 属性位整体豁免

`objectLiteralProperty` / `typeProperty` **不在** `NAMING_SELECTORS` 里。
理由：属性名大量来自外部契约 —— 线上 dump 字段、WPS COM 对象
（`Interior` / `Color` / `Font`）、DOM 标准属性（`className` / `innerHTML`）。
这些名字的所有权不在本项目，改名即 `TS2339` 或数据格式不兼容。

> 代价是属性位不受字母形态约束。**新增自有属性仍应按 §2 命名**，靠 review 把关。

### 4.4 `init*` 前缀

`init`（initialize）**不在**黑名单，与 `unicorn/name-replacements` 口径一致
（其 110 条表里没有 `init`）。项目保留 `initPanel` / `initRibbon` / `initTheme` 等
十余个既有导出名。

> 若日后要收紧，把 `init` 加进 `PROJECT_ABBREVIATIONS` 即可，
> 代价是十余个导出函数 + 所有调用点 + `tests/entry-smoke.test.ts` 同步改名。

### 4.5 CSS 类名 / DOM 属性字符串

kebab-case，不受本规则约束（`ts/**` 里的 `class="bgm-dp-env-value-warn"` 等）。
规范见 `文档/ui-and-interaction.md`。注意 `<th scope="col">` 的 `col` 是 HTML 语义值，
**不是** column 的缩写，不得改名。

---

## 5. 迁移注意事项（血泪）

1. **落盘键改名必须做一次性迁移**：读旧键 → 写新键 → 清旧键。
   参考 `ts/panel/conditional-format-rules.ts` 的
   `cf.rules.v1 → conditionalFormat.rules.v1` 迁移
   （`readMigratedConfig()`）。直接改名会让老用户的配置静默失效。
2. **不要对 `tests/` 跑 `eslint --fix`**：fix 模式会删掉「预留测试选项」的
   `eslint-disable` 注释（实测删过 4 处）。tests 只能手工改。
3. **字符串里的同名标识符要人工处理**：codemod 按整词替换会误伤
   `'img'`（DOMPurify 标签白名单）、`'win.xlsx'`（测试路径）等。
   批量改名后必须 `git diff` 过一遍引号内的改动。
4. **改名后先跑 `tsc`，再跑测试**：`tsc` 能抓出「改名后与既有同名变量撞车」
   （实测 `sync-result-dialog.ts` 里 `dateCol` 与 `dateColumn` 改名后冲突）。
5. 工作副本是 CRLF（`core.autocrlf=true`），提交后若 `git status` 仍有残留 `M`，
   用 `git checkout -- <file>` 归一化，不要直接提交。

---

## 6. 自检

- **门禁**：`npm run lint:check`（`npm run gate` 的一环）。
- **独立扫描器**：`node scripts/probe-naming.mjs`
  不加载主配置（无需类型感知，几秒出结果，比 eslint 的 2.5 分钟快两个数量级），只挂
  `naming-convention` 一条规则，按「命中名 → 次数 → 文件:行」汇总，命中即退出码 1。
  调黑名单、评估新一批改名工作量时用它。
  ⚠️ 改动本规则后，扫描器的 `SELECTORS` 必须与 `eslint.config.mjs` 的 `NAMING_SELECTORS`
  **逐项一致**——不一致会出现「扫描器全绿、eslint 仍报错」（实测漏掉 `classProperty`
  就漏了 60 个名字）。
- **反向验证**：`npm run check:guards-reverse` 的 `naming-convention` 用例会往
  `ts/tools/log-buffer.ts` 注入 `__probeReverseVerifyWs`，门禁必须变红 ——
  证明这条规则不是「永远为真」的空断言。

---

## 7. 变更记录

- **2026-10-20**：新增 `@typescript-eslint/naming-convention` 配置（缩写黑名单
  ＋ 字母形态），并据此全量清理既有缩写（约 2100 处 / 104 文件，含
  `xxxCol→xxxColumn` / `xxxWs→xxxWorksheet` / `xxxSid→xxxSubjectId` 三大族、常量
  `*_COL→*_COLUMN`、`img→image`、`win→windowGlobals`、`cls→cssClass` 等）。
  本文件同批建立。
