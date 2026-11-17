#!/usr/bin/env node
/**
 * @fileoverview ESLint 规则命中量化（eslint-strict-rollout 步骤 1）
 *
 * 用法（仓库根目录）：
 *   node scripts/lint-stats.mjs            # 跑全量 lint（JSON 输出）并聚合
 *   node scripts/lint-stats.mjs --no-lint  # 不跑 lint，只聚合上次的 .lint-raw.json
 *
 * 输出三张表（skill 步骤 1 要求的三个数）：
 *   ① 总问题数（按 severity 分 error / warning）
 *   ② 按规则聚合 Top N（附可自动修复数——零成本收益，优先清）
 *   ③ 按目录聚合（噪音往往集中在某一层，决定分区/豁免对象）
 *
 * 为什么留这个脚本：规则命中数是「哪些规则在误报 / 哪些层是 any 渗透面」
 * 的唯一量化依据——历次规则豁免（见 eslint.config.mjs 的豁免注释）都先有
 * 这里的数字，再拍板。没有数字的豁免是开后门。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RAW_PATH = path.join(REPO_ROOT, '.lint-raw.json')
const ESLINT_BIN = path.join(REPO_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js')

/** 跑全量 lint 拿 JSON（execFileSync 绕 shell，Windows 稳定） */
function runLint() {
  execFileSync(process.execPath, [ESLINT_BIN, 'ts', 'tests', '-f', 'json', '-o', RAW_PATH], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
}

/** 读 JSON 并按两个维度聚合 */
function aggregate() {
  const raw = JSON.parse(readFileSync(RAW_PATH, 'utf8'))
  const byRule = new Map()
  const byDir = new Map()
  let errors = 0
  let warnings = 0
  for (const file of raw) {
    const relative = path.relative(REPO_ROOT, file.filePath).replaceAll('\\', '/')
    // 目录取前两级（ts/panel、ts/tools…）——单层级太粗，文件级太细
    const dirKey = relative.split('/').slice(0, 2).join('/')
    for (const message of file.messages) {
      if (message.severity === 2) errors += 1
      else warnings += 1
      const rule = message.ruleId ?? '(unknown)'
      const entry = byRule.get(rule) ?? { count: 0, fixable: 0 }
      entry.count += 1
      if (message.fix !== undefined) entry.fixable += 1
      byRule.set(rule, entry)
      byDir.set(dirKey, (byDir.get(dirKey) ?? 0) + 1)
    }
  }
  return { total: errors + warnings, errors, warnings, byRule, byDir }
}

function printTable(title, rows) {
  console.log(`\n${title}`)
  const labelWidth = Math.max(...rows.map(([label]) => label.length), 10)
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(labelWidth)}  ${value}`)
  }
}

function main() {
  if (!process.argv.includes('--no-lint')) runLint()
  const stats = aggregate()
  printTable(`① 总量（error ${String(stats.errors)} / warning ${String(stats.warnings)}）`, [
    ['总问题数', String(stats.total)],
  ])
  const ruleRows = [...stats.byRule.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([rule, entry]) => [
      rule,
      `${String(entry.count)} 处${entry.fixable > 0 ? `（${String(entry.fixable)} 可 --fix）` : ''}`,
    ])
  printTable('② 按规则聚合 Top 15', ruleRows)
  const dirRows = [...stats.byDir.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([dir, count]) => [dir, `${String(count)} 处`])
  printTable('③ 按目录聚合 Top 12', dirRows)
  if (stats.total === 0) {
    console.log('\n✅ 0 问题——目标态（新规则试探请用影子模式：npm run lint:shadow）')
  }
}

main()
