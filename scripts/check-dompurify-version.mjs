#!/usr/bin/env node
/**
 * @fileoverview 校验 vendored DOMPurify 与 npm 依赖版本一致
 *
 * 背景（见 文档/TS_AUDIT_2026_09_10.md 的 P0-2 / P2-3）：
 *   本项目同时存在**两份** DOMPurify：
 *     1. `libs/purify.js` —— wpsjs debug / 任务窗格实际加载的 vendored UMD 副本
 *        （`ui/*.html`、`index.html` 都 `<script src=".../libs/purify.js">`）；
 *     2. `node_modules/dompurify` —— 由 vitest 测试与构建器解析的依赖副本。
 *
 *   运行时真正生效的是第 1 份，但 `npm audit` / `npm update` 只作用于第 2 份 ——
 *   两份漂移时会出现「依赖已升级、真机仍是旧版」的假象：安全通告看起来修复了，
 *   实际生效的代码没换。历史教训即为此类双份副本的静默失效。
 *
 * 校验内容：
 *   - `libs/purify.js` 内嵌版本号 === `node_modules/dompurify` 实际安装版本
 *   - `package.json` 声明的 semver 范围与实际安装版本相容
 *
 * 退出码：0 一致；1 不一致（并打印修复指引）。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 读取文件内容（缺失/不可读时抛出带路径的可读错误） */
function readText(relativePath) {
  const absolutePath = join(projectRoot, relativePath)
  try {
    return readFileSync(absolutePath, 'utf8')
  } catch {
    throw new Error(`无法读取 ${relativePath}（预期路径：${absolutePath}）`)
  }
}

/** 读取 JSON 文件 */
function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${relativePath} 不是合法 JSON：${error.message}`)
    }
    throw error
  }
}

/** 从 `libs/purify.js` 的 banner 中提取内嵌版本号 */
function readVendoredVersion() {
  const source = readText('libs/purify.js')
  // 形如："DOMPurify 3.4.12 | (c) Cure53 ..." 或 "DOMPurify 3.4.12"
  const matched = /DOMPurify\s+(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(source)
  if (matched === null) {
    throw new Error('libs/purify.js 中未找到 "DOMPurify x.y.z" 版本标识，请人工确认该文件完整性')
  }
  return matched[1]
}

/** 从 semver 范围中判定是否与给定版本相容（支持 ^x.y.z 与精确版本两类写法） */
function isRangeSatisfied(range, version) {
  if (range === version) return true
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range)
  if (caret === null) return false
  // ^x.y.z 允许 >= x.y.z 且 < (x+1).0.0
  const [major] = version.split('.').map(Number)
  return major === Number(caret[1])
}

function main() {
  const pkg = readJson('package.json')
  const declaredRange = pkg.devDependencies?.dompurify ?? pkg.dependencies?.dompurify
  if (declaredRange === undefined) {
    throw new Error('package.json 未声明 dompurify 依赖')
  }

  const installedVersion = readJson('node_modules/dompurify/package.json').version
  const vendoredVersion = readVendoredVersion()

  const problems = []
  if (vendoredVersion !== installedVersion) {
    problems.push(
      `vendored 副本与安装版本不一致：libs/purify.js = ${vendoredVersion}，` +
        `node_modules/dompurify = ${installedVersion}`,
    )
  }
  if (!isRangeSatisfied(declaredRange, installedVersion)) {
    problems.push(`package.json 声明范围 ${declaredRange} 不覆盖已安装版本 ${installedVersion}`)
  }

  if (problems.length > 0) {
    console.error('✖ DOMPurify 版本一致性校验失败：')
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error(
      '\n修复方式：升级时**必须同时**替换两份副本 ——\n' +
        '  1) npm install dompurify@<版本>\n' +
        '  2) 用同版本的 dist/purify.min.js 覆盖 libs/purify.js（保留文件头部 banner 中的版本号）\n' +
        '原因：运行时实际加载的是 libs/purify.js，npm audit 不会检查它。',
    )
    process.exit(1)
  }

  console.log(
    `✔ DOMPurify 版本一致：vendored ${vendoredVersion} == 安装 ${installedVersion}（声明 ${declaredRange}）`,
  )
}

main()
