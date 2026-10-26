#!/usr/bin/env node
/**
 * @fileoverview 循环条件里的 COM 属性读取检测（性能回归门禁）
 *
 * 背景（2026-09-15 第十八轮「性能回归基线」）：
 *   WPS 的 `Application` / `Workbook` / `Worksheet` / `Range` 对象是**跨进程 COM 代理**，
 *   每一次属性读取都是一次跨进程往返（毫秒级）。把这类读取写在 `for` 的**条件表达式**里，
 *   会让它每轮都重新求值一次 —— 一次 N 行的扫描就从 1 次往返放大成 N+1 次：
 *
 *     // ✗ 每轮多一次 COM 往返
 *     for (let index = 1; index <= sheets.Count; index += 1) { … }
 *
 *     // ✓ 单次读取（本仓库的既定写法）
 *     const sheetCount = sheets.Count
 *     for (let index = 1; index <= sheetCount; index += 1) { … }
 *
 *   最典型的一处是 `sync/exceltobangumi/index.ts` 的按**可见行**扫描：
 *   `for (let r = 1; r <= rows.Count; r += 1)` —— 筛选后可见行常有几千行，
 *   条件里的 `rows.Count` 会放大成几千次跨进程往返。
 *
 *   注意 `visibleCells.Areas.Count` 这种**两跳属性链**更贵：读一次就是 2 次往返，
 *   写在条件里是 2N 次。
 *
 * 判定为错误（退出码 1）：
 *   `for` / `while` / `do…while` 的**条件表达式**里出现 COM 宿主成员访问（见 COM_MEMBERS）。
 *
 * 豁免：
 *   集合**在循环体内会被增删**（必须每轮重新读取才能正确终止）时，可在该 `for` 所在行
 *   加注释 `// com-loop-ok: <理由>`。理由必填 —— 本脚本会把豁免原样打印出来供复核。
 *
 * 为什么用 AST 而不是正则：
 *   `for (const x of list)` / `for (let i = 0; i < arr.length; i++)` 都是合法的
 *   （前者没有条件表达式，后者的 `length` 是 JS 数组属性、不是 COM 往返）。
 *   正则无法可靠区分这些形态，会把它们全判成违规。
 *
 * 用法：
 *   node scripts/check-com-in-loop.mjs
 */

import { readFileSync, globSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, sep } from 'node:path'

import ts from 'typescript'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 判定为「COM 往返」的成员名。
 * 只收宿主对象（Application / Workbook(s) / Worksheet(s) / Range / Filter / Areas…）
 * 上的属性 —— JS 内置的 `.length`（小写）不在其中，因此普通数组循环不受影响。
 */
const COM_MEMBERS = new Set([
  'Count',
  'Item',
  'UsedRange',
  'Areas',
  'Value2',
  'Rows',
  'Columns',
  'Cells',
  'Sheets',
  'Worksheets',
  'Workbooks',
  'Windows',
])

/** 豁免注释标记（必须带理由） */
const OPT_OUT = 'com-loop-ok'

/** 收集 ts/ 下所有 .ts 文件（相对项目根、统一用 / 分隔） */
function collectSourceFiles() {
  return globSync('ts/**/*.ts', { cwd: projectRoot })
    .filter((file) => statSync(join(projectRoot, file)).isFile())
    .map((file) => file.split(sep).join('/'))
}

/** 收集条件表达式里出现的 COM 成员名（去重） */
function collectComMembers(node) {
  const found = new Set()
  const visit = (current) => {
    if (ts.isPropertyAccessExpression(current) && COM_MEMBERS.has(current.name.text)) {
      found.add(current.name.text)
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return [...found].sort()
}

/** 检查单个文件，返回违规列表 */
function checkFile(relativePath) {
  const text = readFileSync(join(projectRoot, relativePath), 'utf8')
  const source = ts.createSourceFile(
    relativePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const lines = text.split(/\r?\n/)
  const violations = []
  const optOuts = []

  const walk = (node) => {
    const isLoopWithCondition =
      ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)
    const condition = isLoopWithCondition ? node.condition : undefined

    if (condition) {
      const members = collectComMembers(condition)
      if (members.length > 0) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        const raw = lines[line - 1] ?? ''
        if (raw.includes(OPT_OUT)) optOuts.push({ line, raw: raw.trim() })
        else violations.push({ line, members, raw: raw.trim() })
      }
    }

    ts.forEachChild(node, walk)
  }

  walk(source)
  return { violations, optOuts }
}

function main() {
  const files = collectSourceFiles()
  const allViolations = []
  const allOptOuts = []

  for (const file of files) {
    const { violations, optOuts } = checkFile(file)
    for (const item of violations) allViolations.push({ file, ...item })
    for (const item of optOuts) allOptOuts.push({ file, ...item })
  }

  console.log(`扫描 ${files.length} 个 ts/ 模块：循环条件里的 COM 属性读取 ${allViolations.length} 处`)

  if (allViolations.length > 0) {
    console.log('\n✖ 循环条件里直接读 COM 属性（每轮多一次跨进程往返）：')
    for (const { file, line, members, raw } of allViolations) {
      console.log(`  ${file}:${line}  [${members.join(', ')}]`)
      console.log(`      ${raw}`)
    }
    console.log(
      '\n  修法：把该属性提到循环外单次读取，条件里用局部变量；' +
        '两跳属性链（如 visibleCells.Areas.Count）连集合本身也一起提出来。',
    )
    console.log(
      `  若集合在循环体内会被增删（必须每轮重读才能正确终止），在该行加 ` +
        `\`// ${OPT_OUT}: <理由>\` 豁免。`,
    )
    process.exit(1)
  }

  console.log('✔ 无「循环条件里读 COM 属性」—— 集合/属性一律提到循环外单次读取')

  if (allOptOuts.length > 0) {
    console.log(`\n· 已豁免 ${allOptOuts.length} 处（请人工复核理由是否成立）：`)
    for (const { file, line, raw } of allOptOuts) console.log(`  ${file}:${line}  ${raw}`)
  }
}

main()
