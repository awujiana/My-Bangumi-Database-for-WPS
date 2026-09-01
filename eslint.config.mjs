// ESLint 10 扁平化配置（2026 版「最严格模式」指南）
// 组成：ESLint 官方推荐 + typescript-eslint 严格类型检查（strictTypeChecked + stylisticTypeChecked）
//      + Airbnb 严格规则集（eslint-config-airbnb-extended base）
//      + import-x / unicorn / promise / security / n / @stylistic 插件全部规则设为 error
//      + 显式严格选项 + eslint-config-prettier 收尾关闭所有格式冲突规则
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import-x';
import unicornPlugin from 'eslint-plugin-unicorn';
import promisePlugin from 'eslint-plugin-promise';
import securityPlugin from 'eslint-plugin-security';
import nodePlugin from 'eslint-plugin-n';
import stylistic from '@stylistic/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 仅引入 airbnb-extended 的 base recommended 配置：
// 直接引用 dist 子模块可绕过包主入口（主入口会加载 react/next/jsx-a11y 全家桶，
// 在 Windows 上冷加载耗时 20s+，而 base 配置本身并不使用这些插件）
// 注意：该子路径未在 package.json 的 exports 中声明，无法 require.resolve 直接解析，
// 因此先解析允许导出的 package.json 定位包根，再拼接物理路径
const require = createRequire(import.meta.url);
const airbnbPkgRoot = path.dirname(require.resolve('eslint-config-airbnb-extended/package.json'));
const airbnbBaseRecommendedUrl = pathToFileURL(
    path.join(airbnbPkgRoot, 'dist/configs/base/recommended.mjs'),
).href;
const { baseRecommendedConfig } = await import(airbnbBaseRecommendedUrl);

// 将插件的所有规则设为 error，但排除两类**不应启用**的规则：
//   1) meta.deprecated 已弃用规则（共 14 条）——上游已声明由新规则取代。
//      启用它们有害无益：`import-x/imports-first` 与 `import-x/first` 语义完全相同，
//      会把同一处问题重复报两次（实测重复计 100 条）；`unicorn/prevent-abbreviations`
//      已由 `unicorn/name-replacements` 取代；且 @stylistic 的弃用规则会在每次
//      lint 时向 stderr 打印弃用警告，污染 CI 输出。
//   2) jsx-* 规则（@stylistic 21 条）——本项目全部为 .ts，无任何 JSX/TSX 文件，
//      这些规则永不命中，纯属配置噪音，其中 3 条同时是已弃用规则。
// 说明：这不是"降低严格度"——被排除的规则要么有等价的现行规则在生效，要么在本项目
// 语言范围内不可能命中。
const EXCLUDED_RULE_PATTERN = /^jsx-/;
const allRulesAsError = (plugin, prefix) =>
    Object.fromEntries(
        Object.entries(plugin.rules)
            .filter(
                ([rule, impl]) =>
                    !impl?.meta?.deprecated && !EXCLUDED_RULE_PATTERN.test(rule),
            )
            .map(([rule]) => [`${prefix}/${rule}`, 'error']),
    );

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
            '!vite.config.js',
        ],
    },

    // 2. 基础规则：ESLint 官方推荐 + TypeScript 严格类型检查
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

    // 3. Airbnb 严格规则集（airbnb-extended base，仅 recommended 部分，flat config 数组直接展开）
    ...baseRecommendedConfig,

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
            ...allRulesAsError(unicornPlugin, 'unicorn'),
            ...allRulesAsError(promisePlugin, 'promise'),
            ...allRulesAsError(securityPlugin, 'security'),
            ...allRulesAsError(nodePlugin, 'n'),
            ...allRulesAsError(stylistic, '@stylistic'),

            // 额外严格规则
            'no-console': 'error',
            'no-debugger': 'error',
            'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx'], location: 'start' }],
            eqeqeq: ['error', 'always'],
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
            'import-x/extensions': ['error', 'always', { ignorePackages: true, pattern: { ts: 'never', js: 'always' } }],
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
                    message:
                        'for..in 会遍历整个原型链，请改用 Object.{keys,values,entries} 并对结果迭代。',
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
        },
    },

    // 6. 最后必须引入 Prettier 配置，关闭所有格式冲突规则
    prettierConfig,
);
