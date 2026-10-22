#!/usr/bin/env node
/**
 * @fileoverview 校验 wpsjs 的 hot-update 注入 patch 真的生效（本地 + 运行中）
 *
 * 背景：wpsjs 的 express server 对每个 `.html` 请求都会在 `<body` 前插一段
 *   `<script src="./hot-update-inject.js"></script>`
 * 这有两层后果：
 *   1. HTML 被改写 → 宿主报 `Main resource content verification failed: .../ui/*.html`；
 *   2. **更严重**：注入脚本里 `new EventSource('/hot-update/<rand>')` 收到
 *      `{update:true}` 就执行 `window.location.reload()`。wpsjs 的 `rcWatch`
 *      监听项目根目录，`tsc --watch` 每次重写 dist-ts/ 都会推送一次 →
 *      **页面陷入刷新循环**。模块链最长的页面（主面板 / 设置，142 个模块）
 *      永远加载不完，表现为「打不开」；模块短的页面在刷新间隙能被看到。
 *
 * 本项目用 `patches/wpsjs+2.2.3.patch`（`prepare: patch-package` 自动应用）
 * 把注入改成默认关闭，需要时 `WPSJS_HOT_UPDATE=1 npm run debug` 开回。
 *
 * 本脚本守三条，前两条 FAIL，第三条 WARN：
 *   A. 本地 node_modules/wpsjs 存在，且 debug_publish.js / debug_xmlplugin.js
 *      都带 BGM patch 标记（patch 丢了 / node_modules 被重装都能被发现）；
 *   B. **运行中的** dev server（3889）返回的 panel.html 不含注入脚本 ——
 *      这一条直接对应用户症状「Main resource content verification failed +
 *      页面打不开」，能在 gate 里当场抓住；
 *   C. 全局安装的 wpsjs 若存在且未 patch，说明 `wpsjs debug` 有被解析到
 *      全局的风险（npm script 内 PATH 优先本地，但手工敲命令不会）。
 *
 * 退出码：0 无 FAIL；1 有 FAIL（并打印修复指引）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEBUG_PORT = 3889

/** patch 打入源码的标记串（两个文件都必须含） */
const PATCH_MARK = 'BGM patch: 默认不再注入 hot-update-inject.js'
/** 宿主校验失败时的那段注入脚本 */
const INJECT_MARK = 'hot-update-inject.js'

const problems = []
const warnings = []

/** 读文件内容，不存在返回 null */
function readOrNull(filePath) {
  if (!existsSync(filePath)) return null
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

// ---------- A. 本地 wpsjs 是否带 patch ----------

const localWpsjs = join(projectRoot, 'node_modules', 'wpsjs')
const patchTargets = ['src/lib/debug_publish.js', 'src/lib/debug_xmlplugin.js']

if (!existsSync(localWpsjs)) {
  problems.push(
    `本地 node_modules/wpsjs 不存在（devDependencies 声明了 wpsjs）。\n` +
      `  修复：npm install（会触发 prepare → patch-package 重新打 patch）`,
  )
} else {
  const unpatched = patchTargets.filter((rel) => {
    const text = readOrNull(join(localWpsjs, rel))
    return text === null || !text.includes(PATCH_MARK)
  })
  if (unpatched.length > 0) {
    problems.push(
      `本地 wpsjs 缺 patch：${unpatched.join(', ')}\n` +
        `  后果：每个 .html 都会被注入 hot-update-inject.js → 宿主红字 + 页面刷新循环。\n` +
        `  修复：npm run prepare（等价 npm install 的 patch-package 步骤）`,
    )
  }
}

// ---------- B. 运行中的 dev server 是否还在注入 ----------

/**
 * 探测 3889 上的 panel.html。
 * server 没开时静默跳过（本地开发不总是开着 dev server，不能因此挂掉 gate）。
 */
async function probeRunningServer() {
  let response
  try {
    response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/ui/panel.html`, {
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    return // 没在跑：跳过
  }
  if (!response.ok) {
    warnings.push(
      `dev server(3889) 有响应但 /ui/panel.html 返回 ${response.status} —— 与 patch 无关，仍需留意`,
    )
    return
  }
  const html = await response.text()
  if (html.includes(INJECT_MARK)) {
    problems.push(
      `运行中的 dev server(3889) 仍在往 HTML 注入 ${INJECT_MARK}！\n` +
        `  这就是「Main resource content verification failed + 主面板/设置打不开」的直接原因。\n` +
        `  注入脚本带 EventSource('/hot-update/')，收到 update 就 reload()，\n` +
        `  tsc --watch 重写 dist-ts/ 会让页面陷入刷新循环。\n` +
        `  修复：结束当前 wpsjs 进程，改用 npm run debug 重启（npm script 内 PATH 优先本地已 patch 的 wpsjs）`,
    )
  }
}

// ---------- C. 全局 wpsjs 的 PATH 歧义风险 ----------

function probeGlobalWpsjs() {
  const roots = new Set()

  // npm root -g：随 shell 的 PATH 走（managed node 与系统 node 结果不同，
  // 单靠它会在某些环境下漏判 —— 本次事故正是跑在系统 node 的全局副本上）。
  try {
    const root = execSync('npm root -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (root) roots.add(root)
  } catch {
    // npm 不可用时靠下面的固定候选路径
  }

  // Windows 上系统 node（C:\Program Files\nodejs\node.exe）的默认全局根
  const home = process.env.APPDATA
  if (home) roots.add(join(home, 'npm', 'node_modules'))
  roots.add(join('C:', 'Program Files', 'nodejs', 'node_modules'))

  let found = false
  for (const root of roots) {
    const globalWpsjs = join(root, 'wpsjs')
    if (!existsSync(globalWpsjs)) continue
    found = true

    const unpatched = patchTargets.filter((rel) => {
      const text = readOrNull(join(globalWpsjs, rel))
      return text === null || !text.includes(PATCH_MARK)
    })
    if (unpatched.length > 0) {
      warnings.push(
        `全局 wpsjs（${globalWpsjs}）未打 patch。\n` +
          `  npm script 内 PATH 优先本地，但手工执行 wpsjs debug 会解析到全局、绕过 patch\n` +
          `  （本次「Main resource content verification failed + 页面打不开」就是跑在全局副本上）。\n` +
          `  建议：始终用 npm run debug 启动；或把 patches/wpsjs+2.2.3.patch 的改动同步到全局副本`,
      )
    }
  }
  return found
}

// ---------- 汇总 ----------

probeGlobalWpsjs()
await probeRunningServer()

if (problems.length > 0) {
  console.error('✗ wpsjs hot-update patch 校验失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  if (warnings.length > 0) {
    console.error('\n⚠ 附带警告：')
    for (const warning of warnings) console.error(`  - ${warning}`)
  }
  process.exit(1)
}

if (warnings.length > 0) {
  console.warn('⚠ wpsjs hot-update patch 校验通过，但有警告：')
  for (const warning of warnings) console.warn(`  - ${warning}`)
}

console.log('✓ wpsjs hot-update patch 校验通过（本地已 patch，运行中的 server 无注入）')
