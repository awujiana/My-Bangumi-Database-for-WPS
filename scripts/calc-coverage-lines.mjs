/**
 * 覆盖率定位工具：从 `coverage/coverage-final.json` 列出指定文件的**未覆盖行号**，
 * 并附带零计数的 statement / function / branch，用于「行已 100% 但还想清干净」时找残留。
 *
 * 用法：
 *   node scripts/calc-coverage-lines.mjs                       # 全项目
 *   node scripts/calc-coverage-lines.mjs panel/clean-engine.ts # 按路径子串过滤（可多个）
 *
 * 为什么需要它（重要）：
 *   `coverage-summary.json` 的 `lines` 指标**不能**由 `coverage-final.json` 的 `statementMap`
 *   行区间求和推导 —— 实测 `ts/panel/clean-engine.ts` 求和得 531 行，而台账口径是 316 行。
 *   istanbul 的 `getLineCoverage()` 是「同一行取该行所有 statement 计数的**最大值**」
 *   （见 `istanbul-lib-coverage/lib/file-coverage.js`）。所以形如
 *   `if (cond) return X` 的单行守卫：IfStatement 每次都会求值（计数 > 0），
 *   同一行上的 `return X` 即使从未走到，该行也判为已覆盖 —— 这类残留只会出现在
 *   下面的 `uncovered stmts` 里，不会进 `uncovered lines`。
 *   本脚本直接用 `istanbul-lib-coverage` 复刻台账口径，
 *   保证输出与 `COVERAGE_BACKLOG.md` / `待办任务清单.md` 里记的未覆盖行数**逐行吻合**。
 *
 * 前置（两个 reporter 都要给）：
 *   CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=1000000 \
 *   npx vitest run --coverage --config vitest.cov.config.ts \
 *     --coverage.reporter=json-summary --coverage.reporter=json
 *   - 不带 `--config vitest.cov.config.ts` 时收尾 `V8CoverageProvider.cleanAfterRun`
 *     会撞 safe-delete 守卫、进程 exit 1；
 *   - 只给 `--coverage.reporter=json` 时 `coverage-summary.json` **不会重写**，
 *     脚本里 `summary lines` 那一行会读到上一次的陈旧值（`uncovered lines` 仍准确）。
 */
import { readFileSync } from 'node:fs'
import libCoverage from 'istanbul-lib-coverage'

const FINAL_PATH = 'coverage/coverage-final.json'
const SUMMARY_PATH = 'coverage/coverage-summary.json'

const filters = process.argv.slice(2)
const normalize = (path) => path.replaceAll('\\', '/')

const finalData = JSON.parse(readFileSync(FINAL_PATH, 'utf8'))
const summaryData = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'))

let matched = 0

for (const [file, entry] of Object.entries(finalData)) {
  const normalized = normalize(file)
  if (filters.length > 0 && !filters.some((filter) => normalized.includes(filter))) continue
  matched += 1

  const fileCoverage = libCoverage.createFileCoverage(entry)
  const lineMap = fileCoverage.getLineCoverage()
  const uncoveredLines = Object.entries(lineMap)
    .filter(([, hits]) => hits === 0)
    .map(([line]) => Number(line))
    .sort((a, b) => a - b)

  const summaryKey = Object.keys(summaryData).find(
    (key) => key !== 'total' && normalize(key).endsWith(normalized),
  )
  const summary = summaryKey ? summaryData[summaryKey] : null

  console.log(`\n### ${normalized}`)
  if (summary) {
    const { covered, total, pct } = summary.lines
    console.log(`summary lines: ${String(covered)}/${String(total)} = ${String(pct)}%`)
  }
  console.log(`uncovered lines (${String(uncoveredLines.length)}): ${uncoveredLines.join(',')}`)

  const uncoveredFunctions = Object.entries(entry.f)
    .filter(([, count]) => count === 0)
    .map(([id]) => `${entry.fnMap[id].name}@${String(entry.fnMap[id].decl.start.line)}`)
  if (uncoveredFunctions.length > 0) {
    console.log(`uncovered fns: ${uncoveredFunctions.join(', ')}`)
  }

  const uncoveredStatements = Object.entries(entry.s)
    .filter(([, count]) => count === 0)
    .map(([id]) => String(entry.statementMap[id].start.line))
    .sort((a, b) => Number(a) - Number(b))
  if (uncoveredStatements.length > 0) {
    console.log(`uncovered stmts: ${uncoveredStatements.join(',')}`)
  }
}

if (matched === 0) {
  console.log(`\n没有匹配的文件（过滤词：${filters.join(' / ') || '（无）'}）。`)
  console.log('先确认已跑过覆盖率、且过滤词是路径子串（如 panel/clean-engine.ts）。')
}
