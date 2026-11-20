# ESLint 规则治理审计报告（2026-10-25）

> 方法：eslint-strict-rollout（分区 → 分账 → 冻结 → 影子 → 收敛）。
> 本项目不是「从宽到严」迁移——`eslint.config.mjs` 早已是全量
> strictTypeChecked + 全部插件规则 error + 0 error 门禁。本次审计的目标是
> **规则债的量化与收敛**：行内 disable 的反模式、误报规则的选项化治理、
> 豁免合理性的数据证明、以及后续调严的决策基础设施。

---

## ① 量化现状（scripts/lint-stats.mjs）

```
npm run lint:stats        # 全量 lint JSON → 按规则 / 按目录聚合
```

**当前态（2026-10-25）**：

| 指标              | 数值                                 |
| ----------------- | ------------------------------------ |
| 总问题数          | **0**（error 0 / warning 0）——目标态 |
| 可 --fix 自动修复 | 0                                    |

噪音按目录分布同样为 0——门禁把债务压在「不许新增」上，存量早已清零。
本次治理前的问题是**行内 disable 的隐性债务**（118 处），见 ③。

---

## ② 影子模式：被排除规则的真实债务（npm run lint:shadow）

影子配置 `eslint.shadow.config.mjs`（skill 坑 3 的零依赖方案：先设
`ESLINT_FIX=1` 再 require 主配置）把 10 条被排除规则强制 error，
测得存量债务 **4902 处**（4764 可 fix）：

| 规则                                                   | 债务 | 性质                                                                                                            | 结论                                                             |
| ------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `unicorn/single-line-block-comment-style`              | 2076 | 404 个**有意为之**的单行 JSDoc 会被膨胀成 1212 行噪音，正确性收益 0                                             | **永久 off**（项目 JSDoc 约定：简短单行、契约多行）              |
| `unicorn/no-asterisk-prefix-in-documentation-comments` | 1374 | 剥掉 JSDoc `*` 前缀 → 608 个文档块失去 JSDoc 特征 → 悬停/IntelliSense 失效                                      | **永久 off**                                                     |
| `@stylistic/multiline-comment-style`                   | 698  | 把块注释拆成 `//`，TypeScript 不再识别为文档                                                                    | **永久 off**（替代保障：prettier 管缩进、spaced-comment 管空格） |
| `unicorn/consistent-arrow-return-style`                | 461  | 与 airbnb `arrow-body-style` **互斥**（一个要显式 return、一个要省略）                                          | **永久 off**（规则互斥，无解）                                   |
| `unicorn/no-unsafe-dom-html`                           | 131  | 全部 innerHTML 赋值都经 `sanitizeHtml()` 消毒（38 生产处 + 测试），规则静态检查不识别消毒包装，命中率 100% 误报 | **永久 off**（替代保障：sanitize.ts + xss.test.ts）              |
| `unicorn/prefer-error-is-error`                        | 92   | 建议改用 `Error.isError()`——ES2025 API，lib ES2022 编译不通过（TS2550）                                         | **永久 off**（替代保障：instanceof + no-unsafe-* 强制收窄）      |
| `@stylistic/exp-list-style`                            | 62   | 与 prettier 形成**修复循环**（--fix 改完 prettier 又改回）                                                      | **永久 off**（格式归属 prettier）                                |
| `unicorn/throw-new-error`                              | 2    | `win.BGMError()` 是宿主注入的**普通函数**（无构造签名），误判为未 new 的 Error                                  | **永久 off**（替代保障：new-cap 例外名单 + 类型系统）            |
| `unicorn/prefer-set-methods`                           | 1    | fixer 建议 `Set#difference`（ES2024），ES2022 无类型                                                            | **永久 off**（见 ③ 的坑）                                        |

**结论：10 条豁免全部有数据支撑，没有一条值得收回。** 这不是「关规则开后门」——
每条都在 `eslint.config.mjs` 的豁免注释里写明「理由 + 替代保障 + 实测数字」。
影子模式的价值：以后想调严时，先跑 `npm run lint:shadow` 看债务再拍板。

> ⚠️ **影子模式的 unused-disable 报告不可信**（实测坑）：影子强制
> `ESLINT_FIX=1` → UNSAFE_FIX_RULES 整组缺席 → 相关行内 disable「压住的是
> 空气」→ 被误报 unused（5 处全部误报，主配置里它们有效）。已在影子配置
> 关掉 `reportUnusedDisableDirectives`；unused 报告只在主配置
> （lint:check）可信。

---

## ③ 本次治理（118 → 75 处行内 disable）

### 3.1 `@typescript-eslint/prefer-nullish-coalescing`：38 处 → 0（选项化）

存量 38 处全部同一模式：**「空串 / 0 / NaN 也要回退」**（占位文案、哨兵值、
API 备用字段、单元格值域）——`??` 会保留空串直接变 bug，`||` 是刻意语义。
两侧全是 primitive，故启用规则自带的 `ignorePrimitives` 选项：

```js
'@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: true }],
```

primitive 上放行 `||`；**对象 / 数组引用上的 `||` 仍照常查**（那才是 nullish
bug 高发区）。38 处行内 disable（每处原带理由注释）随之删除。

### 3.2 `zod-compat.ts`：37 处 → 1 处文件级（黄区收敛）

Zod 降级兼容层（WPS debug 纯静态模式的 fluent shim）的类型签名天然 any
（链式 API 返回联合、shape 运行时形态）。37 处行内 disable 收敛为**文件头
一条**，与已有的 `no-use-before-define` 文件级豁免并列：

```ts
/* eslint-disable @typescript-eslint/no-use-before-define, no-use-before-define */
/* eslint-disable @typescript-eslint/no-explicit-any */
```

替代保障：`safeParse` 的运行时断言 + `schemas/*.ts` 类型契约由 tsc 把守。
**这就是 skill 的「黄区」**：第三方 any 渗透面（此处是 zod UMD 缺失时的
自研 shim）按文件整体豁免，而不是 37 处行内补丁。

### 3.3 `unicorn/prefer-set-methods`：1 处 → 0（源头排除）

`filter + has` 被 fixer 建议改成 `Set#difference`（ES2024，本项目 lib
ES2022 无类型）。**行内 disable 在此规则上不可行**——该规则在 `--fix`
模式缺席（UNSAFE_FIX_RULES 设计），disable 压住的是空气、反被 --fix 当
unused 删掉，然后 gate 模式再报 error，形成死循环（本批实测踩三次）。
正解：从 `allRulesAsError` 展开**源头排除**（新增
`ES2022_INCOMPATIBLE_RULES` 集合），两个模式都不启用。

### 3.4 保留的行内 disable（75 处）

`no-console`（18，日志/调试面板的有意输出）、`no-param-reassign`（3）、
`no-alert`（3，宿主对话框桥）、`no-base-to-string`（3）、
`consistent-boolean-name`（2，返回 boolean 的**动作函数**被规则按布尔
变量误报——每处带理由注释）等。共同点：**单点、有明确理由、有替代保障**，
与 3.1/3.2/3.3 的「系统性冲突」区分开——前者留行内，后者必须收敛。

---

## ④ 审计清单对照（skill 交付检查清单）

| 清单项                          | 状态                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| 现状量化（总数/Top N/目录分布） | ✅ `npm run lint:stats`（0 问题；影子模式 4902 存量债分类）     |
| 分区定义 + 豁免纪律             | ✅ 单绿区 + zod-compat 黄区；豁免均带「理由+替代保障+实测数字」 |
| BASELINE / UPGRADE 分账         | ✅ 已有 UNSAFE_FIX_RULES 双模式分账（gate error / fix 缺席）    |
| 影子模式                        | ✅ `npm run lint:shadow`（零依赖 shadow config）                |
| 存量冻结 suppressions           | ➖ 不需要（存量 0，无需冻结）                                   |
| lint 脚本带 suppressions 旗标   | ✅ shadow 脚本已带 `--pass-on-unpruned-suppressions`            |
| tsc 与单测全绿                  | ✅ gate 165 文件 / 5049 用例                                    |
| 抑制基线不增长门禁              | ✅ 行内 disable 总数纳入评审（本次 118→75）                     |
| 收敛路线图                      | ✅ 见下                                                         |

## ⑤ 后续收敛路线（可选）

1. `no-console` 18 处：全部在 logger/调试面板——可考虑「logger.ts 内部
   文件级豁免 + 其余改 bgmLog」收敛到 1 处文件级（收益：统一日志出口）。
2. 影子模式接入 CI 周跑：债务数字变化（如某条从 92 涨到 200）说明新代码
   在踩那条——比等豁免失效才发现更早。
3. unicorn 每升一版重跑影子：新规则的债务先看数再决定启用/豁免。
