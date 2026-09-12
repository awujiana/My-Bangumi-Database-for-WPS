/**
 * 覆盖率补测待办清单生成器
 *
 * 用法（先产出 summary，再跑本脚本）：
 *   npx vitest run --coverage --config vitest.cov.config.ts --coverage.reporter=json-summary
 *   node scripts/calc-coverage-backlog.mjs
 *
 * 产出：按「未覆盖行数」降序的清单，含「该文件全补完能拉升全项目几个百分点」，
 * 供 文档/COVERAGE_BACKLOG.md 更新数据时使用。
 *
 * 注意：只看未覆盖行数会误判优先级 —— 2000+ 行、覆盖率 <6% 的大文件收益最高但
 * 直接补测成本极高（要 mock 全部依赖，一个写错整文件加载失败）。难度列按目录粗判，
 * 动手前仍需扫一眼文件内实际依赖。
 */
import { readFileSync } from 'node:fs'

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'))
const grand = summary.total.lines
const PER_POINT = grand.total / 100

/** 按目录粗判补测难度（决定性价比权重） */
function tier(file) {
  if (/ts\/(tools|core)\//.test(file)) return '易-纯逻辑'
  if (/ts\/(sync|services)\//.test(file)) return '难-COM/网络'
  if (/ts\/(panel|ui)\//.test(file)) return '中-DOM/UI'
  return '其他'
}

const rows = []
for (const [file, data] of Object.entries(summary)) {
  if (file === 'total') continue
  const { lines } = data
  const uncovered = lines.total - lines.covered
  if (uncovered <= 0) continue
  const relative = file.replace(/\\/g, '/').replace(/^.*\/ts\//, 'ts/')
  rows.push({
    file: relative,
    uncovered,
    pct: lines.pct,
    gain: uncovered / PER_POINT,
    tier: tier(file.replace(/\\/g, '/')),
  })
}

rows.sort((a, b) => b.uncovered - a.uncovered)

const out = []
out.push(`全项目可执行行 ${grand.total}，已覆盖 ${grand.covered}，未覆盖 ${grand.total - grand.covered}`)
out.push(`每提升 1 个百分点 ≈ ${Math.round(PER_POINT)} 行`)
out.push('')
out.push('未覆盖 | 全补完提升 | 当前行覆盖 | 难度 | 文件')
out.push('-'.repeat(96))
for (const r of rows.slice(0, 30)) {
  const gain = `+${r.gain.toFixed(2)}%`
  out.push(
    `${String(r.uncovered).padStart(5)} 行 | ${gain.padStart(7)} | ${String(r.pct).padStart(6)}% | ${r.tier} | ${r.file}`,
  )
}
console.log(out.join('\n'))
