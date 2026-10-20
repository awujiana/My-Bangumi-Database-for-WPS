// 临时探针：统计 @typescript-eslint/naming-convention 的缩写拦截命中量
// 不加载项目主配置（无需类型感知），只挂 naming-convention 一条规则，用于评估黑名单可行性。
// 用法：node scripts/probe-naming.mjs
import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'

// ① 基线：unicorn name-replacements 的缩写表（110 条，取纯小写单词项，避免与多词键重复）
const UNICORN_BASE = `acc application applications arg args arr attr attrs btn buf cb cfg cmd conf
configuration ctx cur curr db decl decls def dep deps dest dev dir dirs dist doc docs dst el elem
elems env envs err ev evt expr exprs ext exts fn func ident idents idx len lib mod msg num obj opts
param params perf pkg prev prod prop props proto ref refs rel repository req res ret retval sep src
stmt stmts str tbl temp tit tmp util utils val var vars ver`
  .split(/\s+/u)
  .filter(Boolean)

// ② 本项目增量：unicorn 表不管、但本项目实际出现过 / 极易再犯的缩写
const PROJECT_EXTRA = [
  'ws', 'col', 'cols', 'sid', 'sids', 'hl', 'cf', // 历史遗留：worksheet / column / subjectId / highlight / conditional-format
  'del', 'orig', 'impl', 'opt', 'vals', 'cnt', 'misc', 'tmpl', 'proc', 'fnc',
  'win', 'cls', 'dbg', 'hdr', 'lbl', 'txt', 'img', 'amt', 'qty',
]

const CANDIDATES = [...new Set([...UNICORN_BASE, ...PROJECT_EXTRA])]

// 词段匹配（两种起点）：
//   a) 名字开头或 `_` 之后 —— 前后大小写任意（覆盖 UPPER_CASE 的 `LEN` / `COL`）
//   b) camelCase 边界（前一个小写字母 + 本词段首字母大写）—— 覆盖 `setWin` 的 `Win`
// 只认「首字母小写 + 前接小写」的写法会漏掉 b)，只认「前接非字母」会漏掉 b) 且误伤
// `protocol` 里的 col —— 两个分支互补才能既不漏也不误伤。
// 词尾锚定：`$` / 非字母 / `_` / 「大写+小写」（下一个 camel 词段的起点）。
const SEGMENT_TAIL = String.raw`(?:$|[^a-zA-Z]|[A-Z][a-z])`
const toCaseInsensitive = (word) =>
  [...word].map((ch) => `[${ch.toLowerCase()}${ch.toUpperCase()}]`).join('')
const segment = (word) => {
  const lower = word.toLowerCase()
  const cap = `${lower[0].toUpperCase()}${lower.slice(1)}`
  return `(?:(?<![a-zA-Z])${toCaseInsensitive(lower)}|(?<=[a-z])${cap})`
}
const noAbbrev = String.raw`(?:${CANDIDATES.map(segment).join('|')})${SEGMENT_TAIL}`
// 与 eslint.config.mjs 保持同一口径：filter 选中含缩写的名字，custom 永不匹配即报错
const FORBIDDEN = '(?!)缩写禁用：请改全拼（对照表见 文档/NAMING.md）'

const SELECTORS = [
  'variable', 'function', 'parameter', 'parameterProperty', 'class', 'interface', 'typeAlias',
  'enum', 'typeParameter', 'classMethod', 'objectLiteralMethod', 'typeMethod',
  'classicAccessor', 'enumMember', 'classProperty', 'import',
]

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.ts'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      },
      plugins: { '@typescript-eslint': tseslint.plugin },
      rules: {
        '@typescript-eslint/naming-convention': [
          'error',
          // ① 未使用参数 + 含缩写 → 报错
          {
            selector: 'parameter',
            modifiers: ['unused'],
            format: null,
            filter: { regex: noAbbrev, match: true },
            custom: { regex: FORBIDDEN, match: true },
          },
          // ② 未使用参数 + 不含缩写 → 放行
          {
            selector: 'parameter',
            modifiers: ['unused'],
            format: null,
            filter: { regex: noAbbrev, match: false },
          },
          // ③ 其余位置含缩写 → 报错
          {
            selector: SELECTORS,
            format: null,
            filter: { regex: noAbbrev, match: true },
            custom: { regex: FORBIDDEN, match: true },
          },
          // ④ 字母形态
          {
            selector: SELECTORS,
            format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
            leadingUnderscore: 'allowSingleOrDouble',
            trailingUnderscore: 'allow',
          },
        ],
      },
    },
  ],
})

const results = await eslint.lintFiles(['ts', 'tests'])
const counter = new Map()
const where = new Map()
let total = 0
for (const result of results) {
  for (const m of result.messages) {
    if (m.ruleId !== '@typescript-eslint/naming-convention') continue
    total += 1
    const hit = /`([^`]+)`/.exec(m.message)?.[1] ?? '?'
    counter.set(hit, (counter.get(hit) ?? 0) + 1)
    const list = where.get(hit) ?? []
    if (list.length < 3) list.push(`${result.filePath}:${m.line}`)
    where.set(hit, list)
  }
}
console.log('TOTAL', total)
for (const [name, count] of [...counter].sort((a, b) => b[1] - a[1]).slice(0, 120)) {
  console.log(String(count).padStart(6), name.padEnd(28), (where.get(name) ?? []).join(' '))
}
// 命中即非零退出：本脚本同时被 scripts/verify-guards-reverse.mjs 当作门禁的
// 反向验证对象（注入缩写后必须变红），只打印不设退出码会被判成「空断言」。
if (total > 0) process.exitCode = 1
