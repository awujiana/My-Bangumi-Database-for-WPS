/**
 * @fileoverview ESLint 影子模式配置（eslint-strict-rollout 坑 3 的零依赖方案）
 *
 * 用途：**试探被主配置排除的规则**（deprecated / jsx-* / 语言不支持 /
 * UNSAFE_FIX_RULES / ES2022_INCOMPATIBLE / 各定向 off）一旦启用，
 * 真实债务规模有多大——为「以后要不要调严 / 某条豁免能不能收回」提供数据，
 * 不影响门禁（本配置只被 `npm run lint:shadow` 显式使用）。
 *
 * Windows 下 `LINT_SHADOW=1 eslint .` 的 POSIX 环境变量语法不成立
 * （cmd 不认），故用「影子配置文件先设环境变量再 require 主配置」绕开：
 * 主配置读 ESLINT_FIX 决定 --fix 行为，这里强制为 1，让 UNSAFE 组
 * **以 fixer 身份缺席**（不重写代码），同时把 exclude 掉的规则全部
 * 强制 error——只有影子模式会看到它们的命中数。
 *
 * 用法：
 *   npm run lint:shadow          # 全量 error 报告（退出码非 0 = 有存量债）
 *   npm run lint:shadow -- -f json -o .lint-shadow.json   # 机器可读
 */

process.env.ESLINT_FIX = '1'

const baseConfig = await import('./eslint.config.mjs')

/**
 * 把配置里所有 exclude 机制排除掉的规则重新强制为 error。
 *
 * 三个来源：ES2022_INCOMPATIBLE_RULES（语言目标不兼容）、
 * 被显式 off 的规则（误报/冲突类豁免）、UNSAFE_FIX_RULES（fixer 危险类）。
 * deprecated / jsx-* / languages 不支持的不试探——它们要么已废弃、
 * 要么在本仓库语言范围永不命中，试探无收益。
 */
const SHADOW_PROBE_RULES = [
  // 语言目标不兼容（启用了也会被 tsc 拦，数字仅作存档）
  'unicorn/prefer-set-methods',
  // 定向 off（见 eslint.config.mjs 各条注释的「替代保障」）
  // 注意：unicorn/prefer-explicit-viewport-units 不列入——它声明了不支持
  // js/js 的语言，ESLint 10 在配置校验阶段就全局拒绝（主配置同款坑，
  // 见 eslint.config.mjs 的 isLanguageUnsupported），列了影子配置直接加载失败。
  '@stylistic/multiline-comment-style',
  '@stylistic/exp-list-style',
  'unicorn/no-asterisk-prefix-in-documentation-comments',
  'unicorn/single-line-block-comment-style',
  'unicorn/prefer-error-is-error',
  'unicorn/no-unsafe-dom-html',
  'unicorn/throw-new-error',
  'unicorn/consistent-arrow-return-style',
]

const shadowProbe = {
  files: ['**/*.ts', '**/*.mts', '**/*.cts'],
  // 关闭 unused-disable 报告：本配置强制 ESLINT_FIX=1，UNSAFE_FIX_RULES 整组
  // 缺席——那些规则相关的行内 disable 在影子模式下「压住的是空气」，会被误报
  // 成 unused（实测 5 处全部误报，主配置里它们是有效压制）。影子模式只看
  // 「探针规则的真实债务」，unused 报告在主配置（lint:check）里才可信。
  linterOptions: { reportUnusedDisableDirectives: false },
  rules: Object.fromEntries(SHADOW_PROBE_RULES.map((rule) => [rule, 'error'])),
}

export default [...baseConfig.default, shadowProbe]
