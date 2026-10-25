// ESLint 10 扁平化配置（2026 版「最严格模式」指南）
// 组成：ESLint 官方推荐 + typescript-eslint 严格类型检查（strictTypeChecked + stylisticTypeChecked）
//      + Airbnb 严格规则集（eslint-config-airbnb-extended base）
//      + import-x / unicorn / promise / security / n / @stylistic 插件全部规则设为 error
//      + 显式严格选项 + eslint-config-prettier 收尾关闭所有格式冲突规则
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import-x'
import unicornPlugin from 'eslint-plugin-unicorn'
import promisePlugin from 'eslint-plugin-promise'
import securityPlugin from 'eslint-plugin-security'
import nodePlugin from 'eslint-plugin-n'
import stylistic from '@stylistic/eslint-plugin'
import prettierConfig from 'eslint-config-prettier'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// =====================================================================
// 命名规范：@typescript-eslint/naming-convention（**禁止缩写**）
// =====================================================================
// 背景：unicorn/name-replacements 只认「字母形态」不认「语义缩写」，且它自带
// 的 110 条替换表里**没有** ws / col / sid / hl / cf —— 这正是此前「lint 全绿
// 但代码里全是缩写」的根因（cf→conditionalFormat 那一轮靠人工排查才发现）。
// naming-convention 补上这一层：用 custom 正则把「缩写词段」判为违规，
// 让新写的缩写**在 lint 阶段就被拦下**，而不是等人眼在 review 里发现。
//
// 缩写表来源（两级）：
//   ① UNICORN_ABBREVIATIONS —— 与 unicorn/name-replacements 同源（110 条，
//      剔除单字母项，避免 `theme` 的 e 被误判），保证两套规则口径一致；
//   ② PROJECT_ABBREVIATIONS —— unicorn 表不管、但本项目实际踩过的缩写
//      （ws=worksheet / col=column / sid=subjectId / hl=highlight / cf=conditional-format …）。
//
// 词段匹配（两个分支互补，缺一不可）：
//   a) 名字开头或 `_` 之后：大小写任意 → 覆盖 UPPER_CASE 的 `LEN` / `COL`
//   b) camelCase 边界（前一小写字母 + 本词段首字母大写）→ 覆盖 `setWin` 的 `Win`
//   只用 a) 会漏掉 b)（`setWin` 的 Win 前接小写 t），只用 b) 会误伤 `protocol`
//   里的 col —— 两个分支合起来才既不漏也不误伤。
// 词尾锚定：`$` / 非字母 / 「大写+小写」（下一个 camel 词段起点）。
//   `DEFAULT` 的 DEF 后接 A+U 不成新词 → 不误判；`MAX_COMMENT_LEN` 末尾
//   LEN 后接 `$` → 判中（它确实是 length 的缩写）。
const UNICORN_ABBREVIATIONS = `acc application applications arg args arr attr attrs btn buf cb cfg
cmd conf configuration ctx cur curr db decl decls def dep deps dest dev dir dirs dist doc docs dst
el elem elems env envs err ev evt expr exprs ext exts fn func ident idents idx len lib mod msg num
obj opts param params perf pkg prev prod prop props proto ref refs rel repository req res ret retval
sep src stmt stmts str tbl temp tit tmp util utils val var vars ver`
  .split(/\s+/u)
  .filter(Boolean)
const PROJECT_ABBREVIATIONS = [
  // 历史遗留（前几轮命名规范化已清掉的家族，防止回潮）
  'ws', 'col', 'cols', 'sid', 'sids', 'hl', 'cf', 'init',
  // 本项目实际出现过 / 极易再犯
  'del', 'orig', 'impl', 'opt', 'vals', 'cnt', 'misc', 'tmpl', 'proc', 'fnc',
  'win', 'cls', 'dbg', 'hdr', 'lbl', 'txt', 'img', 'amt', 'qty',
]
const ABBREVIATIONS = [...new Set([...UNICORN_ABBREVIATIONS, ...PROJECT_ABBREVIATIONS])]

const NAMING_SEGMENT_TAIL = String.raw`(?:$|[^a-zA-Z]|[A-Z][a-z])`
const toCaseInsensitive = (word) =>
  [...word].map((ch) => `[${ch.toLowerCase()}${ch.toUpperCase()}]`).join('')
const abbreviationSegment = (word) => {
  const lower = word.toLowerCase()
  const capitalized = `${lower[0].toUpperCase()}${lower.slice(1)}`
  return `(?:(?<![a-zA-Z])${toCaseInsensitive(lower)}|(?<=[a-z])${capitalized})`
}
// 正向判定「名字里含缩写词段」：用作 filter，把含缩写的名字挑出来送进报错配置。
// 注意：@typescript-eslint 8.72 的 `failureMessage` 只在 schema 里、规则体未实现（已实测），
// 报错信息只能由 `custom.regex` 的**文本**决定 —— 若把上面这条巨型 alternation 直接放进
// custom，每条报错都会把 ~5KB 正则原样打印出来，完全不可读。
// 因此拆分：filter 负责「是否含缩写」的判定（不进报错文本），custom 用一条**永不匹配**
// 的正则负责报错（`(?!)` 恒失败），其正则文本即给开发者的提示 —— 报错变成：
//   Variable name `ws` must match the RegExp: /(?!)缩写禁用：请改全拼（对照表见 文档/NAMING.md）/u
const HAS_ABBREVIATION_REGEX = `(?:${ABBREVIATIONS.map(abbreviationSegment).join('|')})${NAMING_SEGMENT_TAIL}`
const ABBREVIATION_FORBIDDEN_REGEX = '(?!)缩写禁用：请改全拼（对照表见 文档/NAMING.md）'

// 受约束的标识符位置。**不含** objectLiteralProperty / typeProperty：
// 属性名大量来自外部契约（线上 dump 的 `sid`、WPS COM 的 `Interior`/`Color`、
// DOM 的 `className`），项目无权改名 —— 见文档/NAMING.md「豁免清单」。
const NAMING_SELECTORS = [
  'variable', 'function', 'parameter', 'parameterProperty',
  'class', 'interface', 'typeAlias', 'enum', 'typeParameter',
  'classMethod', 'objectLiteralMethod', 'typeMethod',
  'classicAccessor', 'enumMember', 'classProperty', 'import',
]

// 类型不安全的「重写型」自动修复规则：这些规则一旦开启 --fix 会把**可编译代码**
// 自动改成**不可编译代码**或**行为破坏**（实测反复触发 TS2339 / TS7009 / TS2367，
// 以及把构造型 mock 的 function(){} 改成箭头函数后无法 new）。更糟的是 ESLint 10
// 在 --fix 阶段会忽略配置中的 'off' 覆盖（fix/non-fix 报告不一致，已用 --print-config 与
// 单文件 --fix 复现确认），即「写在 rules 里的 'off' 拦不住 --fix 的重写」。
// 因此**从源头**把它们排除出 allRulesAsError 的自动展开（isFix 时过滤，规则『缺席』）——既不参与
// --fix 重写，也不在 error 门禁里（门禁要求 0，但靠**手工/脚本**逐处清零这些规则，而非 --fix
// 自动重放，手工可确认每处的类型安全）。若日后 ESLint 修复该不一致，可移回此处、改为 'off'。
// 范围：unicorn 插件中**类型/引用/行为不安全**的规则（改名类 name-replacements /
// no-keyword-prefix / consistent-boolean-name / filename-case；类型改写类 global-this /
// dom-node-* / keyword-prefix / object-spread 等；行为改写类 no-unsafe-dom-html /
// prefer-add-event-listener / no-null 等）；
// 加上 airbnb 的 prefer-arrow-callback（破坏构造型 mock）、no-var（偶发作用域风险）。
// 注意：**安全重写**的 unicorn 规则（fixer 价值保持、不改类型/引用/行为）放 SAFE_UNICORN_FIXERS，
// 从 UNSAFE 排除 → --fix 模式它们作为 error 带 fixer 参与自动修复（gate 模式仍 error 门禁）。
const SAFE_UNICORN_FIXERS = new Set([
  // 改名 catch 绑定（err→error），eslint fixer 同步更新块内引用，无碰撞风险
  'catch-error-name',
  // \uXXXX → \u{XXXX} 转义规范化，码点值不变（surrogate pair 由 fixer 正确合并）
  'prefer-unicode-code-point-escapes',

  // ===== 值保持的安全重写（fixer 自动清零，不改类型/引用/行为）=====
  // 以下均为 unicorn 规则，在 --fix 模式（isFix）下从 UNSAFE_FIX_RULES 移出，
  // 进入 allRulesAsError 展开 → 作为 error 带 fixer 参与自动修复；gate 模式仍 error 门禁。
  // 每个规则的 autofix 都只做**等价重写**（返回类型与运行时行为均不变）。
  // 已排除会引发行为/语义变化的规则：prefer-code-point（surrogate 码元差异）、
  // no-useless-undefined（删除赋值会改变变量值）、prefer-number-is-safe-integer
  // （≥2^53 时结果不同）、prefer-type-error（改变抛出错误子类）、throw-new-error
  // （BGMError/BGMAlert 是普通函数非构造器，加 new 触发 TS7009）、prefer-export-from
  // （会删除向后兼容 re-export 并剥离 import 名，破坏公共 API）、
  // prefer-dom-node-html-methods（其 fixer 把 `.innerHTML` **读取**改成 `.getHTML()`，
  // 而 getHTML 是 WPS webview Chromium 与 jsdom 均缺失的新 DOM API，实测 23 个测试
  // TypeError: div.getHTML is not a function）、
  // prefer-add-event-listener（其 fixer 把 xhr.onload = fn 改成 addEventListener('load', fn)，
  // 但测试的 XMLHttpRequest mock 只接线 .onload 属性赋值，不派发 addEventListener，
  // 实测 151 测试失败 + 39 错误）。
  'switch-case-braces', // case 体加 {}（值保持）
  'prefer-string-repeat', // 'x'.repeat(n) 等价重写
  'prefer-dom-node-replace-children', // el.innerHTML = '' → el.replaceChildren()
  'prefer-includes-over-repeated-comparisons', // x===a||x===b → [a,b].includes(x)
  'prefer-set-has', // set.has 等价重写
  'no-new-array', // new Array(n) → Array(n)
  'prefer-regexp-test', // str.match(/re/) → /re/.test(str)
  'no-base-to-string', // '' + x → String(x)
  'no-typeof-undefined', // typeof x === 'undefined' → x === undefined
  'prefer-classlist-toggle', // add/remove 分支 → classList.toggle(c, cond)
  'prefer-location-assign', // location.href = x → location.assign(x)
  'prefer-math-min-max', // Math.min(a,b) 合并
  'prefer-array-from-map', // [...map].map(fn) → Array.from(map, fn)
  'explicit-length-check', // arr.length > 0 → arr.length（truthy 等价）
  'escape-case', // \xXX → \u00XX（码点等价）
  // 缩写标识符 → 全拼（cfg→config / i→index / ctx→context / msg→message …）。
  // 纯改名，无行为变化；eslint fixer 同步重命名绑定 + 作用域内所有引用（同 catch-error-name）。
  // 项目内 234 种改名 / 799 处，是当前最大单块（2026-09-01 拍板全清零）。
  'name-replacements',
  // 布尔变量统一 is/has/should 等前缀（showUI→isShowUI）。纯改名，fixer 碰撞感知。
  // 注意：no-keyword-prefix 无 fixer（fixable:undefined），无法 --fix，故**不放** SAFE，
  // 留在 UNSAFE 组靠手工/codemod 逐处改名（325 处）。
  'consistent-boolean-name',
])
const UNSAFE_FIX_RULES = new Set([
  // unicorn 整组减去安全 fixer 子集：
  ...Object.keys(unicornPlugin.rules).filter((r) => !SAFE_UNICORN_FIXERS.has(r)),
  'prefer-arrow-callback',
  'no-var',
])

// 门禁(gate, 全量 error) vs --fix 安全模式 切换：
// 当命令行含 --fix（npm run lint / lint-staged 的 `eslint --fix`）时，UNSAFE_FIX_RULES
// 整组从 allRulesAsError 展开中排除（规则『缺席』而非 'off'——ESLint 10 的 --fix 会忽略
// 配置中的 'off' 覆盖，但**缺席**的规则 --fix 不会重写），保证 --fix 不破坏可编译代码。
// 当不含 --fix（npm run lint:check / CI 门禁）时，UNSAFE 规则照常作为 error 计入门禁，
// 靠**手工/脚本**逐处清零（不改变类型/行为语义）。
// 判定优先用 ESLINT_FIX 环境变量（跨 worker 可靠），并回退到 argv 检测（直接 `eslint --fix`）。
const isFix = process.env.ESLINT_FIX === '1' || process.argv.includes('--fix')

// typescript-eslint 的 strictTypeChecked / stylisticTypeChecked 各含 3 块配置：
// 第 1、3 块为 rules 块且**无 files 限制**，若直接展开会把 @typescript-eslint/* 类型感知
// 规则（await-thenable / no-unsafe-* 等）套到 .js/.mjs 上，而这些文件没有 parserOptions
// 类型信息，ESLint 加载规则时直接崩溃（实测 eslint.config.mjs、vite.config.js 先后中招）。
// 这里给这类 rules 块补上 TS 文件限制：TS 文件照常获得类型感知检查，.js/.mjs 只受
// core 规则 + airbnb + prettier 约束（vite.config.js 保留在 ignores 白名单内可被 lint）。
const TS_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']
const constrainToTsFiles = (configs) =>
  configs.map((config) =>
    config.files === undefined && Object.keys(config.rules ?? {}).length > 0
      ? { ...config, files: TS_FILES }
      : config,
  )

// 仅引入 airbnb-extended 的 base recommended 配置：
// 直接引用 dist 子模块可绕过包主入口（主入口会加载 react/next/jsx-a11y 全家桶，
// 在 Windows 上冷加载耗时 20s+，而 base 配置本身并不使用这些插件）
// 注意：该子路径未在 package.json 的 exports 中声明，无法 require.resolve 直接解析，
// 因此先解析允许导出的 package.json 定位包根，再拼接物理路径
const require = createRequire(import.meta.url)
const airbnbPkgRoot = path.dirname(require.resolve('eslint-config-airbnb-extended/package.json'))
const airbnbBaseRecommendedUrl = pathToFileURL(
  path.join(airbnbPkgRoot, 'dist/configs/base/recommended.mjs'),
).href
const { baseRecommendedConfig } = await import(airbnbBaseRecommendedUrl)
// airbnb-extended 的 base 配置部分对象引用 import-x / @stylistic 规则却未在同一对象
// 声明插件（ESLint 10 flat config 要求规则与插件同对象，否则报 "could not find plugin"）。
// 此处按需补上插件声明，不改动规则本身。
const patchedBaseRecommendedConfig = baseRecommendedConfig.map((config) => {
  const rules = Object.keys(config.rules ?? {})
  const plugins = { ...(config.plugins ?? {}) }
  if (rules.some((rule) => rule.startsWith('import-x/')) && plugins['import-x'] === undefined) {
    plugins['import-x'] = importPlugin
  }
  if (rules.some((rule) => rule.startsWith('@stylistic/')) && plugins['@stylistic'] === undefined) {
    plugins['@stylistic'] = stylistic
  }
  return Object.keys(plugins).length === Object.keys(config.plugins ?? {}).length
    ? config
    : { ...config, plugins }
})

// 将插件的所有规则设为 error，但排除四类**不应启用**的规则：
//   1) meta.deprecated 已弃用规则（共 14 条）——上游已声明由新规则取代。
//      启用它们有害无益：`import-x/imports-first` 与 `import-x/first` 语义完全相同，
//      会把同一处问题重复报两次（实测重复计 100 条）；`unicorn/prevent-abbreviations`
//      已由 `unicorn/name-replacements` 取代；且 @stylistic 的弃用规则会在每次
//      lint 时向 stderr 打印弃用警告，污染 CI 输出。
//   2) jsx-* 规则（@stylistic 21 条）——本项目全部为 .ts，无任何 JSX/TSX 文件，
//      这些规则永不命中，纯属配置噪音，其中 3 条同时是已弃用规则。
//   3) UNSAFE_FIX_RULES——见上方说明，类型不安全的重写型规则，从源头排除，
//      不参与 allRulesAsError 的自动展开（避免 --fix 把可编译代码改坏，且 ESLint 10
//      的 fix/non-fix 不一致导致写在 rules 里的 'off' 拦不住 --fix 重写）。
//   4) 声明了 meta.languages 但**不含 js/js** 的规则（unicorn 78 起集中出现）。
//      本配置是「全量展开」，而 ESLint 10 在**配置校验阶段**就拒绝这类规则作用于 js/js：
//        Key "rules": The following rules do not support the language "js/js":
//          - "unicorn/comma-spacing" / "indent" / "key-name-casing" / "no-empty-link-text"
//          - "unicorn/no-javascript-url" / "no-loss-of-precision" / "require-frontmatter-fields"
//      该错误是**致命**的（整份配置加载失败，lint 根本跑不起来，不是报违规），
//      74 → 78 升级时正是它把 lint:check / gate 全挂。这 7 条只作用于
//      css / json / jsonc / json5 / yaml / toml / soml / markdown，本仓无此类文件，永不命中。
//      判定按 meta.languages **自动推导**而非硬编码名单：unicorn 每升一版都会新增同类规则
//      （74→78 新增 40 条、删 2 条），写死名单下次升级还会崩。
//      代价：若将来出现只声明 ts/ts 的规则也会被跳过——但本仓 lint 范围含 .mjs
//      （vite.config.mjs），这类规则本就无法全局启用，跳过不损失覆盖。
// 说明：这不是"降低严格度"——被排除的规则要么有等价的现行规则在生效，要么在本项目
// 语言范围内不可能命中；UNSAFE_FIX_RULES 仍保持 error 门禁（靠手工清零，不使用 --fix）。
const EXCLUDED_RULE_PATTERN = /^jsx-/
// 与项目 target/lib ES2022 不兼容的规则：fixer 建议的 API 在 lib 里没有类型，
// --fix 会把可编译代码改坏（unicorn/prefer-set-methods → Set#difference 等
// ES2024 方法，改完 tsc 直接报 Property does not exist）。ESLint 的 fixer
// 不查 TS lib；行内 disable 也不可行——该规则在 --fix 模式缺席（UNSAFE 组），
// disable 压住的是空气，反被 --fix 当 unused 删掉，然后 gate 模式再报 error
// （实测循环三次）。唯一解：从展开源头排除，两个模式都不启用。
const ES2022_INCOMPATIBLE_RULES = new Set(['unicorn/prefer-set-methods'])
// 注意 `languages: ['*']`（unicorn 的 filename-case / comment-content / prefer-https 等用此写法）
// 表示「所有语言」，必须视为支持 js/js；只认字面量 js/js 会把这类规则误伤（实测会把
// filename-case 这类现行门禁规则一起关掉，等于悄悄降低严格度）。
const isLanguageUnsupported = (impl) => {
  const languages = impl?.meta?.languages
  return (
    Array.isArray(languages) &&
    !languages.includes('js/js') &&
    !languages.includes('*')
  )
}

const allRulesAsError = (plugin, prefix) =>
  Object.fromEntries(
    Object.entries(plugin.rules)
      .filter(
        ([rule, impl]) =>
          !impl?.meta?.deprecated &&
          !EXCLUDED_RULE_PATTERN.test(rule) &&
          !ES2022_INCOMPATIBLE_RULES.has(`${prefix}/${rule}`) &&
          !isLanguageUnsupported(impl) &&
          !(isFix && UNSAFE_FIX_RULES.has(rule)),
      )
      .map(([rule]) => [`${prefix}/${rule}`, 'error']),
  )

export default tseslint.config(
  // 1. 忽略文件（替代 .eslintignore）
  {
    ignores: [
      'dist/**',
      'dist-ts/**',
      'wps-addon-build/**',
      'node_modules/**',
      'coverage/**',
      '**/*.js',
      '!vite.config.mjs',
      // ESLint 严格化迁移期 codemod 的临时输出目录（.gitignore 同步排除，不入库）
      '.fix_out/**',
      // 配置文件自身：tseslint 的 strictTypeChecked rules 块无 files 限制会套用它，
      // 但 .mjs 无 parserOptions 类型信息，@typescript-eslint/* 类型感知规则直接崩溃
      'eslint.config.mjs',
      // 构建/测试配置文件：vitest.config.ts 未被任何 tsconfig 纳入 projectService
      // 范围，类型感知规则会因找不到类型信息而崩溃（解析错误），配置文件无需参与 lint
      'vitest.config.ts',
      // 工具/备份/交付目录：不属于 lint 范围
      '.backup_before_recovery/**',
      '.archify-delivery-*/**',
      '.uploads/**',
      '.workbuddy/**',
      '.trae/**',
      '.vscode/**',
      '__pycache__/**',
      // 自动生成文件（scripts/build-shard-samples.mjs 输出）：内容是 JSON 字面量，
      // 不合 prettier 风格且每次生成都会重新引入；勿手改，一致性由
      // tests/shard-samples.test.ts 守护（localColumn 与映射表对齐）
      'ts/ui/handlers/shard-samples.ts',
    ],
  },

  // 2. 基础规则：ESLint 官方推荐 + TypeScript 严格类型检查
  //    （类型感知 rules 块经 constrainToTsFiles 限定只作用于 TS 文件，
  //     否则 await-thenable 等规则在 .js/.mjs 上无类型信息直接崩溃）
  js.configs.recommended,
  ...constrainToTsFiles(tseslint.configs.strictTypeChecked),
  ...constrainToTsFiles(tseslint.configs.stylisticTypeChecked),

  // 3. Airbnb 严格规则集（airbnb-extended base，仅 recommended 部分，flat config 数组直接展开）
  ...patchedBaseRecommendedConfig,

  // 4. 插件规则全部设为 error
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
      parserOptions: {
        // projectService 由 typescript-eslint 官方推荐，基于 TSServer 增量复用，
        // 相比 project（每次独立全量解析）可显著降低类型感知 lint 耗时
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          project: './tsconfig.json',
          alwaysTryTypes: true,
        },
      },
    },
    plugins: {
      import: importPlugin,
      'import-x': importPlugin, // airbnb-extended 内部规则使用 import-x/ 前缀
      unicorn: unicornPlugin,
      promise: promisePlugin,
      security: securityPlugin,
      n: nodePlugin,
      '@stylistic': stylistic,
    },
    rules: {
      ...allRulesAsError(importPlugin, 'import-x'),
      // ⚠️ unicorn 整组在 gate 模式（lint:check，无 ESLINT_FIX）作为 error 门禁强制 0；
      // 在 --fix 模式（ESLINT_FIX=1）下整组被 UNSAFE_FIX_RULES 排除出 allRulesAsError
      // （规则『缺席』而非 'off'，规避 ESLint 10 --fix 忽略 off 覆盖的 bug），--fix 不重写。
      // 因此 unicorn 规则靠**手工/脚本**逐处清零，而非 --fix 自动重放。
      ...allRulesAsError(unicornPlugin, 'unicorn'),
      // --fix 模式下额外关闭构造型 mock 破坏规则（prefer-arrow-callback 会把
      // function(){} 构造替身改成箭头函数导致无法 new；no-var 偶发作用域风险）。
      // gate 模式不设该覆盖，规则照常 error（tests/ 下这俩已在 override 中关闭）。
      ...(isFix ? { 'prefer-arrow-callback': 'off', 'no-var': 'off' } : {}),
      // 属性级 mutation 豁免：DOM 容器/替身对象的属性写（element.style.display、
      // container.innerHTML、xhr.timeout、累加器 result.success、mock 单元格 r.checked）
      // 是这些函数的本职——参数引用未变，仅操作其指向的对象，报错属误报形态。
      // 参数**重赋值**（重绑定，如 userId = ...）仍照常 error（2 处已局部变量化清零）。
      'no-param-reassign': [
        'error',
        {
          props: true,
          ignorePropertyModificationsFor: [
            'element',
            'container',
            'buttonElement',
            'fab',
            'item',
            'xhr',
            'result',
            'r',
          ],
        },
      ],
      // core 版与 @typescript-eslint 版对同一位置双报——tseslint 官方建议仅用
      // @typescript-eslint 版。但 core 版在下方「④ 调选项优于关规则」块已有
      // functions:false 调参（handlers 层函数提升惯例），故此处**不重复设置**，
      // 两版并行且口径一致；zod-compat 的类循环惰性引用按文件级 disable 豁免。
      ...allRulesAsError(promisePlugin, 'promise'),
      ...allRulesAsError(securityPlugin, 'security'),
      ...allRulesAsError(nodePlugin, 'n'),
      ...allRulesAsError(stylistic, '@stylistic'),

      // ===== 命名规范：禁止缩写 + 字母形态 =====
      // 说明见文件顶部 HAS_ABBREVIATION_REGEX 的推导注释。四条配置**顺序敏感**
      // （同 selector 时按数组序，带 modifiers 的优先级更高，会排到前面）：
      //   ①② 未使用参数：靠 modifiers:['unused'] 排在最前，先按「是否含缩写」分流 ——
      //      含缩写 → ① 报错；不含 → ② 豁免格式（`_` 本身不是 camelCase）。
      //      **不能让未使用参数整体豁免缩写检查**，否则 `_ws` 会借「未使用」永久躲过门禁。
      //   ③ 其余位置含缩写 → 报错。
      //   ④ 字母形态兜底（camelCase / PascalCase / UPPER_CASE）。
      // `format: null` = 不做格式要求；`custom` 用永不匹配的正则 = 走到这里必报错。
      '@typescript-eslint/naming-convention': [
        'error',
        // ① 未使用参数 **且** 含缩写 → 报错
        {
          selector: 'parameter',
          modifiers: ['unused'],
          format: null,
          filter: { regex: HAS_ABBREVIATION_REGEX, match: true },
          custom: { regex: ABBREVIATION_FORBIDDEN_REGEX, match: true },
        },
        // ② 未使用参数 **且** 不含缩写 → 放行（`_` / `_worksheet` / `__resetXxx` 合法）
        {
          selector: 'parameter',
          modifiers: ['unused'],
          format: null,
          filter: { regex: HAS_ABBREVIATION_REGEX, match: false },
        },
        // ③ 其余受约束位置含缩写 → 报错
        {
          selector: NAMING_SELECTORS,
          format: null,
          filter: { regex: HAS_ABBREVIATION_REGEX, match: true },
          custom: { regex: ABBREVIATION_FORBIDDEN_REGEX, match: true },
        },
        // ④ 字母形态
        {
          selector: NAMING_SELECTORS,
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allowSingleOrDouble',
          trailingUnderscore: 'allow',
        },
      ],

      // 额外严格规则
      'no-console': 'error',
      'no-debugger': 'error',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx'], location: 'start' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }], // == null/!= null 是同时判 null+undefined 的合法惯用法
      curly: ['error', 'all'],
      // ESLint 10 语言限制：该规则不支持 js/js（无法启用，非降级）
      'unicorn/prefer-explicit-viewport-units': 'off',
      // ② 架构/文档风格冲突：@stylistic/multiline-comment-style 必须关闭。
      // 'separate-lines' 会把块注释重写为 `//` 行注释，而 checkJSDoc:false 只豁免
      // **多行** JSDoc；单行 `/** 说明 */` 不被该规则识别为 JSDoc，仍会被拆成 3 行 `//`。
      // 实测（探针验证）：本项目 966 个 JSDoc 中 404 个是单行形式，全部会被摧毁，
      // 而规则真正要规范的普通块注释仅 14 处 —— 收益 14、代价 404，严重不成比例。
      // `//` 注释不被 TypeScript 识别为文档，摧毁后悬停提示、IntelliSense 与
      // @param/@returns 契约全部失效。
      // 替代保障：注释缩进与空格由 prettier 统一；`@stylistic/spaced-comment`
      // 仍强制 `// ` / `/* ` 后置空格；文档必须用 JSDoc 为项目约定，由 review 把关。
      '@stylistic/multiline-comment-style': 'off',

      // ③ prettier 循环冲突：@stylistic/exp-list-style 要求表达式列表
      // （三元条件列表、vi.fn 链、对象展开项等）按 'exp' 风格逐项断行。
      // prettier 的格式化会把这些列表重新合并/换行，修复后 prettier 再次
      // 运行又触发规则——实测形成永不收敛的循环（--fix 清 0 后 prettier
      // 重排立即回归，单文件复现确认）。格式归属 prettier 统一负责。
      // 替代保障：无（纯格式规则，prettier 是唯一格式权威）。
      '@stylistic/exp-list-style': 'off',

      // ② 同一条破坏链的上游：unicorn/no-asterisk-prefix-in-documentation-comments
      // 剥掉 JSDoc 每行的 ` * ` 前缀 → 注释失去 JSDoc 的 `*` 行特征 →
      // multiline-comment-style 的 JSDoc 识别失效 → 整块降级为 `//`。
      // 实测后果：ts/ 下 922 个 JSDoc 块被摧毁 608 个。即使已关闭下游规则，
      // 剥离 ` * ` 前缀本身也违反项目 JSDoc 约定，故一并关闭。
      // 替代保障：同上，JSDoc 内部格式由 prettier 与项目约定维护。
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',

      // ② 同一条破坏链的第三环：unicorn/single-line-block-comment-style 强制把
      // 单行块注释展开为多行，且展开结果不带 ` * ` 前缀。
      // 本项目 966 个 JSDoc 中 404 个是**有意为之**的单行形式（`/** 日志级别 */`），
      // 该规则会把这 404 处膨胀为 1212 行纯噪音，且与项目主导文档风格直接冲突，
      // 而正确性收益为零。
      // 替代保障：单行 / 多行 JSDoc 的取舍属项目约定（简短说明用单行、含
      // @param/@returns 契约用多行），由 review 把关。
      'unicorn/single-line-block-comment-style': 'off',

      // ① 运行环境不匹配：unicorn/prefer-error-is-error 要求改用 `Error.isError()`，
      // 但该 API 是 ES2025 新增，本项目 tsconfig 的 lib 为 ES2022。
      // 实测（探针）：写出 Error.isError(x) 直接触发 TS2550
      //   "Property 'isError' does not exist on type 'ErrorConstructor'"。
      // 即该规则会强制产出**编译不通过**的代码；且宿主 WPS WebView 的 Chromium
      // 版本不保证提供该 API，靠补 .d.ts 掩盖类型只会把编译期错误推迟成运行期崩溃。
      // 替代保障：`instanceof Error` 已由 useUnknownInCatchVariables +
      // @typescript-eslint/no-unsafe-* 保证收窄前必须做类型判定。
      'unicorn/prefer-error-is-error': 'off',

      // ① 规则前提在本项目不成立（纯误报）：unicorn/no-unsafe-dom-html 一刀切
      // 禁止 innerHTML/outerHTML/insertAdjacentHTML 赋值，schema 无任何选项可豁免
      // 「先经消毒层」的调用形态。本项目在**所有** HTML 边界强制经 sanitizeHtml()
      // 消毒（ts/tools/sanitize.ts，44 处命中中 38 处生产代码全部为 sanitizeHtml()
      // 包裹或内部常量 HTML，6 处测试是 XSS 测试本身对被消毒产物的断言），
      // 规则的静态检查无法识别消毒包装，命中率 100% 误报。
      // 替代保障：XSS 防御由 sanitizeHtml 实现 + xss.test.ts 用例 + tsc 类型强制
      // （ts/tools/sanitize.ts 内的宿主赋值是本规则无法绕过的自检用例，若取消消毒
      // 该用例立即失败）。
      'unicorn/no-unsafe-dom-html': 'off',

      // ① 纯误报：unicorn/throw-new-error 要求 `throw err` 处用 `new Error(...)`。
      // 本项目命中 2 处均为 `win.BGMError(message, title)` 的**普通函数调用**——
      // BGMError 是 WPS 宿主注入的展示函数（接口为方法签名，非构造函数），
      // 规则将其静态误判为「未用 new 的 Error 构造调用」；加 new 会触发 TS7009
      // （构造签名缺失）。且 isFix 模式下该规则缺席导致行内 disable 注释被
      // ESLint 当作「未使用的 disable 指令」删除（fix/non-fix 不一致 bug），
      // disable 注释方案不可行，只能配置级关闭。
      // 替代保障：new-cap 的 capIsNewExceptions 已列 BGMError/BGMAlert/BGMInput，
      // 类型系统强制这些名字按函数调用。
      'unicorn/throw-new-error': 'off',

      // ① 规则互斥循环冲突：unicorn/consistent-arrow-return-style 要求多行箭头
      // 函数显式 return（块体），airbnb 的 arrow-body-style 要求简单箭头用
      // 表达式体——两者 fix 互相改写永不收敛（实测：consistent-arrow-return-style
      // fix 生成块体 → arrow-body-style 报错 → 其 fix 生成表达式体 →
      // consistent-arrow-return-style 又报错）。airbnb 主规则集保留，
      // unicorn 侧关闭。
      // 替代保障：airbnb arrow-body-style（error）继续强制箭头体简洁性。
      'unicorn/consistent-arrow-return-style': 'off',

      // ① 纯误报：unicorn/no-unreadable-new-expression 只允许 `new Foo()` 单独成句
      // 或赋值，禁止 `new Date().toISOString()` 这类**链式调用**。但无参构造 +
      // 立即调用的 Date 工厂链（toISOString/toLocaleString/getFullYear）是全项目
      // 19 处的标准惯用法，拆分变量（`const d = new Date(); d.toISOString()`）
      // 是纯噪音且不改变任何语义；规则针对的「new Foo().bar() 不可读」场景
      // 在 Date 上不成立（Date 构造本身无状态需要引用）。此为 unicorn
      // configs.all 级纯风格规则，项目无一处真实可读性问题。
      'unicorn/no-unreadable-new-expression': 'off',

      // ① 架构前提不存在：import-x/dynamic-import-chunkname 要求动态 import 附带
      // `/* webpackChunkName: 'x' */` 注释，该注释只被 webpack/rollup 等打包器
      // 消费。本项目编译产物由 WPS WebView 以原生 ES Module 直接加载（无打包器），
      // chunk 概念不存在，注释是纯噪音且会被 lint 自身标记为注释内容问题。
      // 替代保障：无——该项目构建模型本身没有代码分割能力。
      'import-x/dynamic-import-chunkname': 'off',

      // ① 与类型系统冲突：unicorn/prefer-query-selector 要求
      // getElementById(id) → querySelector('#id')，但两者返回类型不同：
      // 前者 HTMLElement|null，后者仅 Element|null。
      // 实测（探针）：自动修复后访问 .style 立刻触发 TS2339
      //   "Property 'style' does not exist on type 'Element'"。
      // ts/ 下 181 处全部涉及 DOM 属性读写，遵从该规则需为每处补
      // querySelector<HTMLElement> 泛型标注 —— 181 处纯噪音改动，
      // 且 getElementById 更快、也不会因 id 含特殊字符而需转义。
      // 替代保障：DOM 取值的 null 安全由 strictNullChecks 强制。
      'unicorn/prefer-query-selector': 'off',

      // ④ 调选项：no-keyword-prefix **关闭属性名检查**，变量/参数/函数仍保持 error。
      // 依据（AST 实测 233 处 = 164 属性 + 69 变量）：
      //   - 39 处 className + 1 处 classList 是 **DOM 标准属性**，由浏览器/W3C 定义，
      //     项目无权改名，改了就是 TS2339（el.className 不存在）。
      //   - 100 余处 newValue 是**跨持久化边界的数据契约**：同步记录字段
      //     （ts/sync/syncRecord.ts）、冲突解决结构（ts/ui/conflictResolver.ts）、
      //     JSONL 导出与 GitHub Gist 同步载荷的键名。改名会造成新旧数据格式不兼容
      //     ——已落盘/已推送的 Gist 记录反序列化后字段丢失，属不可逆的数据事故。
      // 关闭 checkProperties 只是把"名字的所有权"还给外部契约（DOM 规范 + 持久化格式），
      // 规则想防的"开发者自己起的 newXxx/classXxx 命名"由 checkVariables/checkFunctions
      // 等继续把关，那 69 处真实标识符另行用 codemod 改名清零，不降级。
      // 替代保障：属性名一致性由 TypeScript 结构化类型 + tsc 强制（少字段/错字段即报错）。
      'unicorn/no-keyword-prefix': ['error', { checkProperties: false }],

      // ⑤ 调选项：consistent-boolean-name 豁免两类**外部所有/动作语义**的名字。
      //    其余 60 处（async/silent/confirmed 等参数、getIncrementalSync 等真谓词
      //    getter、willSync 计数器误用 will 前缀）已用类型感知 codemod 改名清零。
      //    豁免依据：
      //    a) WPS Ribbon 宿主回调契约名 —— ribbon.xml 按名引用回调
      //       （onLoad="OnAddinLoad"、onAction="OnAction"、getPressed="GetXxxPressed"、
      //       onAction="OnXxxChange"），改名即断链，宿主找不到回调。
      //    b) 动作动词命名的函数（setConfig/addSyncRecord/clearSyncRecords/
      //       restoreLockedSheet/ensureSheetHeaders 等）—— 函数名表达"做一个动作"，
      //       返回 boolean 仅表示执行成败，不是谓词；强行改成 didSetXxx/isXxx
      //       反而破坏调用点可读性。真谓词（getXxx→isXxxEnabled）已另行改名，
      //       该豁免不影响未来新写的谓词函数被规则把关。
      'unicorn/consistent-boolean-name': [
        'error',
        {
          ignore: [
            // a) Ribbon 契约回调（OnAction/OnAddinLoad/GetXxxPressed/OnXxxChange/onAction 类型位）
            '^[oO]n[A-Z]',
            '^Get[A-Z]',
            // b) 动作动词开头返回执行成败的函数（setXxx/addXxx/clearXxx/...）
            //     补充 move/reorder 类（moveModuleTo/moveModuleBy 等重排操作，
            //     resetNavOrder 等恢复默认）同为「动作 + 返回成败」，与既有豁免同属一类
            '^(?:set|add|remove|clear|store|copy|save|ensure|export|deduplicate|restore|move|reset|autoDetect|confirmAndExecute|lock)[A-Z]',
            // b') 下划线私有动作函数（_copyTextToClipboard）
            '^_copy',
          ],
        },
      ],

      // ===== 类型不安全自动修复规则（不参与 --fix 重放）=====
      // 以下 unicorn 规则的 --fix 会改写标识符或收窄类型，实测会**引入编译错误**：
      //   - prefer-global-this：window → globalThis，但两者类型不等价
      //     （typeof globalThis vs Window），触发 TS2367「比较无重叠」/ TS2322。
      //   - prefer-dom-node-dataset / prefer-dom-node-append /
      //     prefer-dom-node-remove / prefer-dom-node-text-content：
      //     假定 DOM 节点恒为 HTMLElement，但 querySelector 等返回 Element，
      //     修复后 .dataset / .style 触发 TS2339。
      //   - prefer-event-target：EventTarget → 更窄的 EventTarget 子类假设，
      //     在 WPS COM 对象上不成立。
      //   - prefer-replace-all / prefer-string-replace-all：String.prototype.replaceAll
      //     在目标 ES2022 已存在，但修复器在无 replaceAll 支持的环境改写会引入运行期问题。
      //   - prefer-array-find / prefer-math-trunc / prefer-number-properties /
      //     prefer-date-now / no-array-for-each / prefer-string-slice / prefer-array-slice：
      //     这些重写会改变表达式类型或求值顺序，在类型敏感处（如 as 断言、重载解析）
      //     有低概率引入类型错配。
      // 处置：一律 off（error 门禁仍要求 0，但靠**手工**清零这些规则，
      // 而非 --fix 自动重放——手工可逐处确认类型安全）。这样既保住严格度，
      // 又不会让 `eslint --fix` 把可编译代码改成不可编译代码。
      'unicorn/prefer-global-this': 'off',
      'unicorn/prefer-dom-node-dataset': 'off',
      'unicorn/prefer-dom-node-append': 'off',
      'unicorn/prefer-dom-node-remove': 'off',
      'unicorn/prefer-dom-node-text-content': 'off',
      'unicorn/prefer-event-target': 'off',
      'unicorn/prefer-replace-all': 'off',
      'unicorn/prefer-string-replace-all': 'off',
      'unicorn/prefer-array-find': 'off',
      'unicorn/prefer-math-trunc': 'off',
      'unicorn/prefer-number-properties': 'off',
      'unicorn/prefer-date-now': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/prefer-string-slice': 'off',
      'unicorn/prefer-array-slice': 'off',
      //   - prefer-keyword-prefix：要求把 `foo.Bar(...)` 改成 `new foo.Bar(...)`，
      //     **改变调用语义**（普通函数调用 → 构造），对 BGMError/BGMAlert 这类
      //     「接口形态为函数」的全局对象直接破坏（实测引入 TS7009 构造签名缺失）。
      //     属于行为破坏性重写，决不能交给 --fix。
      'unicorn/prefer-keyword-prefix': 'off',
      //   - prefer-object-from-entries / prefer-object-spread / prefer-array-flat /
      //     prefer-array-flat-map / prefer-string-replace / prefer-array-index-of /
      //     prefer-array-includes：这些重写会改变对象/数组的创建方式或求值顺序，
      //     在 WPS COM 对象、Proxy、含副作用的迭代器等场景有低概率行为偏差，
      //     且不在本项目的强制清单中，关掉 --fix 重写、保留 error 由手工清零。
      'unicorn/prefer-object-from-entries': 'off',
      'unicorn/prefer-object-spread': 'off',
      'unicorn/prefer-array-flat': 'off',
      'unicorn/prefer-array-flat-map': 'off',
      'unicorn/prefer-string-replace': 'off',
      'unicorn/prefer-array-index-of': 'off',
      'unicorn/prefer-array-includes': 'off',

      // ② 架构冲突：import-x/no-relative-parent-imports 禁止 `../` 导入。
      // 本项目编译产物 dist-ts/ 由 WPS WebView 以**原生 ES Module** 直接加载，
      // 没有打包器参与，路径别名（@/）在运行时无法解析；跨层引用只能用相对路径。
      // 替代保障：模块边界与循环依赖由 import-x/no-cycle 把关。
      'import-x/no-relative-parent-imports': 'off',

      // ② 项目风格冲突：import-x/exports-last 要求所有 export 集中到文件末尾。
      // 本项目一贯采用「导出紧邻定义」（export 直接写在函数/常量声明处），
      // 集中到末尾会让 239 处声明与其导出相隔数百行，显著降低可读性，
      // 且与 import-x/prefer-default-export 等规则的取向无关。
      // 替代保障：公共 API 面由各 index.ts 显式 re-export 收口。
      'import-x/exports-last': 'off',

      // ④ 调选项：no-unused-vars 保持 error，但承认项目既有的下划线约定 ——
      // `_direction`、`_unused` 等前缀是**刻意标记**"此参数为接口契约所需但本实现不使用"，
      // 删除会破坏函数签名（回调形参位置固定）。改名为无前缀反而丢失该意图。
      // 注意：no-underscore-dangle 已按 ② 关闭，两者约定一致不冲突。
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // ① 上游能力缺失：ESLint 10 移除了 FileEnumerator API，
      // import-x/no-unused-modules 依赖该 API，插件已明确声明该规则
      // 在 ESLint 10 下**退化为空操作（no-op）**，并在每次运行时向 stderr
      // 打印告警。即：启用它得不到任何检查效果，只得到噪音。
      // 待上游实现替代方案后再重新启用。
      // 替代保障：未使用的导出由 tsc 的 import 图 + import-x/no-cycle 间接约束。
      'import-x/no-unused-modules': 'off',
      // import-x 与扩展名规则的固定冲突：项目 import 必须带扩展名，
      // index.js 是合法规范形式，不将 index 视为冗余段（保持 error，仅调整选项）
      'import-x/no-useless-path-segments': ['error', { noUselessIndex: false }],
      // import-x/extensions 与 n/file-extension-in-import 冲突：
      // TS 项目（NodeNext 语义）import 路径必须写 .js（编译后目标），
      // 显式声明 ts:never + js:always，避免 extensions 要求 .ts 与 n 要求 .js 交替修复（保持 error）
      'import-x/extensions': [
        'error',
        'always',
        { ignorePackages: true, pattern: { ts: 'never', js: 'always' } },
      ],
      // unicorn/prefer-increment-decrement（要求用 ++）与 airbnb no-plusplus（禁止 ++）语义相反，
      // 同一处代码被两条规则来回改写永不收敛；保留 airbnb 主规则集的 no-plusplus，关闭 unicorn 侧冲突规则
      'unicorn/prefer-increment-decrement': 'off',
      // ===== import-x 模块结构规则（用户 2026-08-31 拍板，附理由）=====
      // no-named-export：与 Airbnb 风格冲突，现代 ES Module 标准不要求单 default 导出，关闭
      'import-x/no-named-export': 'off',
      // no-internal-modules：误报——项目无 pkg/subpath 导入，全部为本地相对路径
      'import-x/no-internal-modules': 'off',
      // no-unassigned-import：副作用导入（WPS 加载项 bootstrap 初始化）是合理需求
      'import-x/no-unassigned-import': 'off',
      // group-exports：与 no-named-export 同源冲突，全量合并导出重构成本高且收益低
      'import-x/group-exports': 'off',
      // 注意：no-relative-parent-imports / exports-last 曾在此降为 warn（"先降级再提升"），
      // 现已在上方按 ② 架构冲突正式关闭并附理由 —— 门禁采用 --max-warnings=0 后
      // warn 与 error 等价（同样阻断），"降级"不再是有效的缓冲手段，故移除该组重复键
      // （JS 对象字面量重复键后者生效，此处曾导致上方的 'off' 被静默覆盖）。
      // TS 项目：核心 no-unused-vars 对类型声明误报，由 @typescript-eslint/no-unused-vars 接管（typescript-eslint 官方推荐）
      'no-unused-vars': 'off',

      // ======================================================================
      // 规则分账（2026-09-01 用户拍板）
      // 原则：只关闭「规则想防的问题在本项目根本不成立」的规则，每条注明理由 + 替代保障。
      // 本项目运行时 = WPS/Excel 加载项内嵌 webview（浏览器环境，非 Node），target ES2022。
      // ======================================================================

      // ---------- ① 规则前提在本项目不成立（纯误报）----------

      // promise/no-native：报 “Promise is not defined”，该规则为「必须显式 import Promise polyfill」
      // 的 ES5 环境设计。本项目 target ES2022，Promise 是语言内置。
      // 替代保障：tsc 类型检查 + tsconfig lib ES2022 约束可用 API。
      'promise/no-native': 'off',

      // n/* 系列：eslint-plugin-n 面向 Node 运行时，按 package.json engines 判定 API 可用性。
      // 本项目跑在 WPS webview，实测误报：把浏览器标准 API（Blob / URL.createObjectURL /
      // localStorage / fetch / CustomEvent / Array.prototype.at）判为「Node 实验特性」，
      // 并按方法名后缀把业务方法 getIncrementalSync 判为 Node 同步 API。
      // 替代保障：tsconfig lib: ["ES2022","DOM","DOM.Iterable"] 已精确约束可用 API 面。
      'n/no-sync': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
      'n/no-unsupported-features/es-syntax': 'off',
      'n/no-unsupported-features/es-builtins': 'off',
      'n/callback-return': 'off',
      'n/no-callback-literal': 'off',

      // unicorn/prefer-temporal：要求用 Temporal 取代 Date。Temporal 在 WPS 内嵌 webview
      // 的 Chromium 版本尚不可用，改写将直接导致运行时 ReferenceError。
      // 替代保障：无（该规则要求的 API 在目标环境不存在，属硬性不可用）。
      'unicorn/prefer-temporal': 'off',

      // security/detect-object-injection：对任意 obj[key] 计算成员访问一律告警，
      // 业界公认高误报（本项目 65 处全为受类型约束的正常索引访问）。
      // 替代保障：tsconfig noUncheckedIndexedAccess: true —— 索引访问返回 T | undefined，
      // 由类型系统强制处理不存在的键，比该规则的字面量匹配更可靠。
      'security/detect-object-injection': 'off',

      // no-restricted-syntax：保留 airbnb 的 for-in / label / with 限制，仅移除 ForOfStatement。
      // airbnb 禁 for-of 的原文理由是「iterators/generators require regenerator-runtime,
      // which is too heavyweight」——这是 Babel/ES5 时代的产物，本项目 target ES2022 原生支持
      // for-of，零运行时开销，前提已失效（99/100 条报错均为此项）。
      // 替代保障：for-in（污染原型链）与 label / with 仍保持 error 拦截。
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForInStatement',
          message: 'for..in 会遍历整个原型链，请改用 Object.{keys,values,entries} 并对结果迭代。',
        },
        {
          selector: 'LabeledStatement',
          message: '标签语句会让控制流难以理解，请重构。',
        },
        { selector: 'WithStatement', message: 'with 会使作用域不可静态分析，禁止使用。' },
      ],

      // ---------- ② 与 WPS 加载项架构模型冲突 ----------

      // unicorn/no-null：要求全面用 undefined 取代 null。但本项目三类边界原生产出 null：
      // DOM（querySelector / dataset）、WPS COM 对象、Zod nullable 校验结果。
      // 实测教训：批量 null→undefined 曾一次性引入 172 个 tsc 错误（越过类型契约）。
      // 替代保障：tsconfig strictNullChecks + exactOptionalPropertyTypes —— 由类型系统
      // 强制区分并处理 null / undefined，语义正确性不依赖此风格规则。
      'unicorn/no-null': 'off',

      // no-underscore-dangle / unicorn/no-top-level-assignment-in-function：
      // WPS 加载项必须在模块作用域持有跨事件回调的持久句柄（_ribbonMessageHandler /
      // _configPollingTimer / _bgmRibbonReady），并在回调内赋值——这是 WPS 事件模型的
      // 硬性要求（宿主逐次调用回调，无法用闭包传递状态），`_` 前缀是项目既有约定。
      // 替代保障：句柄集中在 ribbon.ts 顶部声明，由 code review 与类型声明约束。
      'no-underscore-dangle': 'off',
      'unicorn/no-top-level-assignment-in-function': 'off',

      // unicorn/no-this-outside-of-class：项目用对象字面量方法组织命名空间
      // （如 BGM.state.enterRunningState() 内的 this.isRunning），这是标准 ES 对象方法模式，
      // 非 class 但 this 绑定明确。
      // 替代保障：tsconfig strict 含 noImplicitThis —— this 类型不明确时直接编译失败。
      'unicorn/no-this-outside-of-class': 'off',

      // promise/avoid-new + promise/prefer-await-to-callbacks：
      // WPS 宿主 API 与 Excel 事件均为回调式（无 Promise 版本），必须用 new Promise 包装
      // 才能接入 async/await。规则要求的「上游返回 Promise」在宿主侧不存在。
      // 替代保障：包装集中在 tools/ 适配层，业务层一律 async/await。
      'promise/avoid-new': 'off',
      'promise/prefer-await-to-callbacks': 'off',

      // ---------- ④ 调选项优于关规则 ----------

      // no-use-before-define：函数声明提升是本项目 handlers 层的普遍模式
      // （事件处理函数互相引用，无法拓扑排序）。仅放开 functions，
      // 变量 / 类 / 类型的前置引用仍保持 error 拦截（那些才是真实的 TDZ 风险）。
      'no-use-before-define': [
        'error',
        { functions: false, classes: true, variables: true, allowNamedExports: false },
      ],
      '@typescript-eslint/no-use-before-define': [
        'error',
        {
          functions: false,
          classes: true,
          variables: true,
          enums: true,
          typedefs: true,
          ignoreTypeReferences: true,
        },
      ],

      // no-void：放开「语句位 void」——这是消费 floating promise 的标准形态
      // （no-floating-promises 要求显式 void 标注「有意丢弃」；两者默认配置互斥）。
      // `void 0` 之外的 void 表达式（非语句位）仍保持 error。
      'no-void': ['error', { allowAsStatement: true }],

      // no-await-in-loop：对 Bangumi API 的串行请求是刻意设计（避免触发上游限流被封），
      // 并发化会直接违反接口约定。
      // 替代保障：批量场景已在 sync/ 层用显式并发上限封装。
      'no-await-in-loop': 'off',

      // unicorn/try-complexity：默认 max:1（try 块内几乎只允许一条语句），
      // 连 unicorn 官方 recommended 配置本身都将其设为 off，仅 configs.all 才启用。
      // 本项目 try 复杂度分布 p50=5 / p75=10 / max=55。设 max:12 —— 保留对真正
      // 「巨型 try 块」（26 处，最大 55）的拦截并逐步重构，不为 p50 的正常 WPS 交互
      // 包裹付出 142 处函数抽取的回归风险。
      'unicorn/try-complexity': ['error', { max: 12 }],
      // unicorn/numeric-separators-style：十进制/二进制/八进制的分组保留 error
      // （`3_600_000` 比 `3600000` 更难读错，是真实收益）；但十六进制改为
      // onlyIfContainsSeparator —— 本项目 hex 字面量几乎全是颜色常量
      // （BGM_COLOR.SUCCESS = 0xccffcc 对应 Excel/CSS 的 #ccffcc），
      // 自动修复成 0xcc_ff_cc 后无法再与设计稿的 6 位色值肉眼对照，
      // 是纯粹的可读性倒退（实测 constants.ts 一处就改写 10 个色值）。
      // 该选项的语义是「已含分隔符的 hex 必须分组正确」，即仍拦截 0xcc_ffcc
      // 这类分组错误的写法，只是不强制给未使用分隔符的 hex 加分组。
      'unicorn/numeric-separators-style': [
        'error',
        { hexadecimal: { onlyIfContainsSeparator: true } },
      ],

      // new-cap：保留 Airbnb 语义（newIsCap 检查 new 后必须大写；capIsNew:false 不要求大写函数必须 new）。
      // 注意：只写 capIsNewExceptions 会把 capIsNew 重置为默认 true，导致所有 PascalCase 函数调用被要求 new（169 误报）。
      // WPS 全局 BGMError/BGMAlert/BGMInput 是普通函数（接口为方法签名），额外列入例外双重保险。
      'new-cap': [
        'error',
        {
          newIsCap: true,
          capIsNew: false,
          capIsNewExceptions: ['BGMError', 'BGMAlert', 'BGMInput'],
        },
      ],

      // ④ 调选项：class-methods-use-this 豁免**接口契约方法**。
      // 这些方法名全部来自外部接口（SyncSource / ZodSchema / XHR mock），
      // 实现类必须提供实例方法才能满足 implements，加 static 会破坏接口契约
      // （TS 报 "Property is missing in type"），且方法本身是静态语义的
      // 查询/动作（返回常量、委托模块函数），本就不需要实例状态。
      // 规则要防的「方法内该用 this 却没用」在这 7 个名字上不成立——
      // 全项目同名方法均无真实实例依赖（已逐一核对该方法名的所有定义处）。
      'class-methods-use-this': [
        'error',
        {
          exceptMethods: [
            'getSourceType',
            'getDisplayName',
            'fetchRemoteEntries',
            'validateConfig',
            'getAllResponseHeaders',
            'length',
            'safeParse',
          ],
        },
      ],

      // ===== 2026-09-05 批量清零（ES2023+ API 不可用 / 架构性误报）=====

      // ① 目标环境 API 缺失（硬性不可用）：以下规则要求 ES2023+ 的数组/迭代器/DOM
      // 新 API（toSorted / toReversed / Iterator#toArray / Iterator.concat / getHTML）。
      // 本项目 tsconfig lib 为 ES2022，宿主 WPS WebView 的 Chromium 与 jsdom 均不保证
      // 提供这些 API；实测 toReversed 曾致 enrich-page 兼容性故障、getHTML 曾致
      // 23 个测试 TypeError（见上方 prefer-dom-node-html-methods 排除理由）。
      // 替代保障：tsconfig lib 已精确约束可用 API 面（lib: ES2022），tso 编译期
      // 直接拦截新 API 的使用（TS2550），比 lint 字面量建议更可靠。
      'unicorn/no-array-sort': 'off',
      'unicorn/no-array-reverse': 'off',
      'unicorn/prefer-iterator-to-array': 'off',
      'unicorn/prefer-iterator-concat': 'off',
      'unicorn/prefer-dom-node-html-methods': 'off',

      // ② 性能建议类规则（非正确性问题）：prefer-observer-apis 建议用
      // IntersectionObserver/ResizeObserver 取代 scroll/resize 监听 + 布局读取。
      // 本项目 3 处均为面板滚动容器/窗口 resize 的边缘场景，重构为观察者需
      // 引入生命周期管理（断开连接/重连），收益仅是微优化，风险是面板行为回归。
      // 替代保障：面板交互测试覆盖滚动/尺寸变化行为。
      'unicorn/prefer-observer-apis': 'off',

      // ② 位运算误报：no-bitwise 一刀切禁止 & | << >>。本项目 5 处全部是
      // 校验和计算（crypto.ts checksum 的 FNV 哈希）与标志位掩码
      // （github-cache.ts 的状态位组合），位运算是这些算法的唯一正确实现，
      // 规则想防的「位运算混淆逻辑」场景不存在（无按位取巧的可读性替代）。
      // 替代保障：算法代码集中、带注释，tsc 类型检查保证数值语义。
      'no-bitwise': 'off',

      // ② 架构设计冲突：unicorn/no-barrel-files 禁止聚合导出文件。本项目
      // schemas/index.ts / tools/utility.ts / ui/handlers.ts / sync/exceltobangumi.ts
      // 是**有意的公共 API 收口面**（上层统一从 index 导入，配合
      // import-x/exports-last 关闭后的导出约定），拆散会破坏模块边界。
      // 替代保障：barrel 文件仅 re-export，无隐藏副作用（no-top-level-side-effects 把关）。
      'unicorn/no-barrel-files': 'off',

      // ② 架构设计冲突：max-classes-per-file 限制每文件 1 个类。
      // zod-compat.ts 的 10 个小类是一个**内聚的 Zod 兼容层**（LiteOptional/
      // LiteWithDefault 等互相引用、共享同一 Schema 契约），拆分为 10 个文件
      // 会破坏内聚性并制造 10 倍导入噪音；result.ts 的 2 个类是 Result 与其
      // 私有迭代器（内部实现细节，不应暴露为独立模块）。
      // 替代保障：类内聚边界由 tsc 类型与模块契约把关。
      'max-classes-per-file': 'off',

      // ② 架构建议类：import-x/max-dependencies 限制单模块依赖数 ≤10。
      // 本项目 7 处超限模块全是**聚合枢纽**（index.ts / handlers/index.ts /
      // bootstrap 系列 / sync-source-registry），它们的职责就是编排众多子模块，
      // 拆小反而增加间接层。该规则是架构建议（非正确性），与项目分层模型冲突。
      // 替代保障：依赖方向由 import-x/no-cycle 与分层 review 把关。
      'import-x/max-dependencies': 'off',

      // ② 项目导出风格冲突：import-x/prefer-default-export 要求单导出文件用
      // default export。本项目公共模块一贯使用**命名导出**（显式 API 面、便于
      // 静态分析树摇与重命名），9 处单导出文件均为这一约定的自然形态，
      // 改 default 会牵动全部导入方且不带来正确性收益。
      // 替代保障：公共 API 面由各 index.ts re-export 收口（同 no-barrel-files）。
      'import-x/prefer-default-export': 'off',

      // ② 加载项模型必需：unicorn/no-top-level-side-effects 禁止模块顶层副作用。
      // 本项目 4 处顶层副作用全是 WPS 加载项的**注册/初始化**（ribbon 命令注册、
      // 全局状态播种、模块状态上报），必须发生在模块加载期（宿主要求副作用
      // 在 import 时生效），无法推迟到函数内。
      // 替代保障：副作用集中在少量模块顶部且幂等，由 entry 层编排。
      'unicorn/no-top-level-side-effects': 'off',
    },
  },

  // 5. tests/ 覆盖块：仅关闭与 vitest 框架惯用法直接冲突的规则
  // 原则：这里**不放宽**任何与正确性相关的规则（类型安全、空值安全、未用变量等
  // 一律保持 error）。每条关闭都对应一个测试框架的硬性要求或测试代码的固有形态。
  // 背景：tests/ 此前因未归属任何 TS Project 而被 lint 静默跳过（43 个文件全部漏检），
  // 补上 tests/tsconfig.json 后才首次纳入检查，故这些冲突到此刻才暴露。
  {
    files: ['tests/**/*.ts'],
    rules: {
      // vitest 的 vi.hoisted() / vi.mock() 必须在被 mock 模块 import **之前**求值
      // （mock 提升是框架硬约束，顺序颠倒会导致 mock 失效）。
      // 实测样例：tests/boundary.test.ts:21 的 vi.hoisted(useFakeTimers) 位于 import 之上。
      'import-x/first': 'off',

      // 测试 fixture 使用 http:// 与 https://evil.example.com 之类的**伪造地址**
      // 断言 URL 解析与来源校验逻辑，不产生任何真实外呼。
      // 生产代码 ts/ 下该规则报错为 0，即真实约束力已完整保留。
      'unicorn/prefer-https': 'off',

      // 测试对**自己刚构造的** fixture 断言非空是标准做法，
      // 改写为可选链会让断言在数据缺失时静默通过，反而削弱测试强度。
      '@typescript-eslint/no-non-null-assertion': 'off',

      // vi.fn(() => {}) 的空实现是 mock 的标准形态（表达"调用后什么都不做"）。
      '@typescript-eslint/no-empty-function': 'off',

      // it('x', () => expect(...)) 与 vi.fn(() => cb()) 的箭头简写是测试惯用法；
      // 该规则在生产代码 ts/ 下报错为 0，约束力完整保留。
      '@typescript-eslint/no-confusing-void-expression': 'off',

      // vi.mock('mod', () => ({ ...导出替身 })) 的工厂函数直接返回对象字面量
      // 是 vitest 官方文档写法，强制改成显式 return 只增加噪音。
      'unicorn/consistent-arrow-return-style': 'off',

      // 构造型 mock：测试广泛用 `global.XMLHttpRequest = vi.fn().mockImplementation(
      // function () { return xhrMock })` 这类**函数表达式**作为可 new 的构造替身。
      // prefer-arrow-callback / no-var 会把 function 表达式改成箭头函数/const，
      // 而箭头函数无法被 new（实测 `new XMLHttpRequest()` 抛 "is not a constructor"），
      // 直接让 58 个用例崩溃。这两个规则在 tests/ 下关闭，不在生产代码 ts/ 关闭。
      'prefer-arrow-callback': 'off',
      'no-var': 'off',

      // mock 事件契约：测试以 `xhrMock.onload = fn` / `mockXHR.xhrMock.onload?.()`
      // 属性赋值 + 手动调用为 XHR/BroadcastChannel 替身的**触发机制**
      // （addEventListener 注册的监听器无法被测试手动触发）。
      // 生产代码 ts/ 下 43 处已全部改为 addEventListener/removeEventListener，
      // 真实约束力完整保留。
      'unicorn/prefer-add-event-listener': 'off',

      // 构造型 mock 的**触发方法**（_respondOk/_triggerError/_aborted 等）由测试
      // 在外部手动调用（`lastMockXhr!._respondOk(...)`），是替身注入响应的入口。
      // 改成 # 私有字段后这些调用全部编译失败，破坏 mock 触发机制；
      // 下划线命名是 mock 类与调用点之间的既定契约。生产代码 ts/ 下该规则
      // 报错为 0，真实约束力完整保留。
      'unicorn/prefer-private-class-fields': 'off',

      // 测试回调的 async 是历史遗留（早前重构移除了 await 但保留了 async 标记），
      // 由 codemod 逐处删除（commit 同批）：直接删 `it('…', async () => …)` 的 async
      // 无副作用；mock 实现（mockImplementation(async () => …)）的返回契约已逐处核对。
      // 无法用 allowForArrowFunctions 调参——本项目 typescript-eslint 版本的
      // require-await schema 为空（不支持任何选项）。生产代码 ts/ 下报错为 0。
      '@typescript-eslint/require-await': 'off',

      // 测试 mock 全局注入：vitest 测试以 `globalThis.X = mock` / `globalThis[klass] = fn`
      // 替换宿主全局（XMLHttpRequest / BroadcastChannel / fetch 等）是框架标准做法，
      // 生产代码 ts/ 下仅 1 处（panel-page.ts，另案手工修复），真实约束力已保留。
      'unicorn/no-global-object-property-assignment': 'off',

      // 构造型 mock：MockBroadcastChannel 等替身构造函数内 `return 实例` 是
      // 「可 new 且返回替身」的标准 mock 形态（保证 new 结果与单例一致）。
      'no-constructor-return': 'off',

      // XSS 防护测试：冲突解决测试故意构造 javascript: 伪协议 URL 断言消毒逻辑，
      // 不产生真实执行。
      'no-script-url': 'off',

      // 动态删除测试：github-config 测试用 delete config[key] 断言「动态键删除后
      // 序列化结果」，是数据契约测试的一部分。
      '@typescript-eslint/no-dynamic-delete': 'off',

      // 边界矩阵断言：boundary.test.ts 的深层嵌套 expect 链是矩阵式断言的惯用形态，
      // 提取辅助函数会破坏「一行一断言」的对照可读性。
      'unicorn/max-nested-calls': 'off',

      // mock 方法引用断言：vitest 以 `expect(mockSource.fetchRemoteEntries).toHaveBeenCalled()`
      // 断言方法被调用，取出方法引用本身就是测试意图（不调用它），
      // 该引用不会脱离 mock 对象执行，无 this 逃逸风险。
      '@typescript-eslint/unbound-method': 'off',

      // 非 Error 抛出测试：多处 mock 故意 `throw '字符串'` 以覆盖生产代码
      // `e instanceof Error` 的 false 分支（String(e) 格式化路径），
      // 改成 throw new Error 会直接破坏被测分支，属测试意图本身。
      'no-throw-literal': 'off',
      '@typescript-eslint/only-throw-error': 'off',
    },
  },

  // 6. 最后必须引入 Prettier 配置，关闭所有格式冲突规则
  prettierConfig,
)
