#!/usr/bin/env node
/**
 * @fileoverview `tests/` 类型门禁（带基线，防止回归）
 *
 * 背景（见 文档/TS_AUDIT_2026_09_10.md 的 P1-2）：
 *   `tests/tsconfig.json` 存在已久，但**没有任何脚本运行它**——`tsc` 主门禁只覆盖
 *   `ts/`，于是 `tests/` 里的 254 个类型错误长期无人知晓。而这些错误本身就是证据：
 *   mock 的形状与真实接口脱节、断言参数类型与签名不符，个别还指向生产代码的类型缺口。
 *
 * 为什么不直接要求 0 错误（而是基线）：
 *   ① 一次性修完 254 个会让门禁与重构绑死，风险集中；
 *   ② 更重要的是「**不再增长**」——先把闸门关上，再逐批清账，每清一批 `--update`
 *      下调基线，进度是单调的、可度量的。
 *
 * 判定为失败（退出码 1）：
 *   - 某个文件的错误数**超过**基线；
 *   - 基线里没有的文件出现错误（新增文件必须一开始就是干净的）。
 * 允许：错误数下降（提示可 `--update` 下调基线）。
 *
 * 用法：
 *   node scripts/check-tests-types.mjs            # 校验（门禁用）
 *   node scripts/check-tests-types.mjs --update   # 把当前错误数写成新基线
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, sep } from 'node:path'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(projectRoot, 'scripts', 'tests-types-baseline.json')
const tsconfigPath = 'tests/tsconfig.json'

/** 运行 tsc 并解析 `文件(行,列): error TSxxxx: 消息` 形式的输出 */
function collectErrors() {
  // 直接用本机 node 跑 node_modules 里的 tsc：不依赖 npx / shell，
  // 也就不会有 Windows 下 .cmd 解析失败、找不到命令却静默「0 错误」的问题。
  const tscBin = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  let output
  try {
    output = execFileSync(process.execPath, [tscBin, '--noEmit', '-p', tsconfigPath], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    // tsc 有错误时退出码非 0，输出在 stdout
    if (error.stdout === undefined) throw error
    output = `${error.stdout}${error.stderr ?? ''}`
  }

  const byFile = new Map()
  for (const line of output.split('\n')) {
    const match = /^(?<file>[^(]+)\((?<line>\d+),(?<column>\d+)\): error TS(?<code>\d+):/.exec(
      line.trim(),
    )
    if (match?.groups === undefined) continue
    const file = match.groups.file.split(sep).join('/')
    byFile.set(file, (byFile.get(file) ?? 0) + 1)
  }
  return byFile
}

/** 读取基线（缺失时视为空基线） */
function readBaseline() {
  if (!existsSync(baselinePath)) return { total: 0, byFile: {} }
  return JSON.parse(readFileSync(baselinePath, 'utf8'))
}

function main() {
  const byFile = collectErrors()
  const total = [...byFile.values()].reduce((sum, n) => sum + n, 0)
  const baseline = readBaseline()

  if (process.argv.includes('--update')) {
    const sorted = Object.fromEntries([...byFile.entries()].sort(([a], [b]) => a.localeCompare(b)))
    writeFileSync(
      baselinePath,
      `${JSON.stringify(
        {
          _comment:
            'tests/ 类型错误基线（P1-2）。只允许下降：修完后跑 `node scripts/check-tests-types.mjs --update` 下调。',
          total,
          byFile: sorted,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    console.log(`已写入基线：${total} 个类型错误，覆盖 ${byFile.size} 个文件`)
    return
  }

  const regressions = []
  for (const [file, count] of byFile) {
    const allowed = baseline.byFile[file] ?? 0
    if (count > allowed) regressions.push({ file, count, allowed })
  }

  const fixed = Object.entries(baseline.byFile)
    .map(([file, allowed]) => ({ file, allowed, count: byFile.get(file) ?? 0 }))
    .filter(({ count, allowed }) => count < allowed)

  console.log(
    `tests/ 类型检查：当前 ${total} 个错误 / 基线 ${baseline.total} 个` +
      `（覆盖 ${byFile.size} 个文件，基线 ${Object.keys(baseline.byFile).length} 个）`,
  )

  if (regressions.length > 0) {
    console.log(`\n✖ 类型错误相对基线增加（${regressions.length} 个文件）：`)
    for (const { file, count, allowed } of regressions) {
      console.log(`  ${file}  ${allowed} → ${count}（+${count - allowed}）`)
    }
    console.log('\n修法：这些通常暴露 mock 形状与真实接口脱节，或断言参数与签名不符。')
    console.log('      默认不新增错误；确有必要修复后跑 `--update` 下调基线。')
    process.exit(1)
  }

  if (fixed.length > 0) {
    console.log(`\n✔ 无回归；另有 ${fixed.length} 个文件错误数下降，可跑 --update 下调基线：`)
    for (const { file, count, allowed } of fixed) {
      console.log(`  ${file}  ${allowed} → ${count}`)
    }
  } else {
    console.log('\n✔ 无回归（无文件错误数增加）')
  }
}

main()
