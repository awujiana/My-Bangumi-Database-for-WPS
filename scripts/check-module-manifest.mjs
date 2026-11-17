#!/usr/bin/env node
/**
 * @fileoverview 校验 main.js 的 MODULES 清单与 dist-ts 实际产物一致
 *
 * 背景（2026-10-21 实际踩到的 bug）：
 *   `main.js` 里写死了一份要加载的模块路径清单。源码两次改名后清单漏改两处：
 *     - `dist-ts/tools/utility.js` —— commit 958c5b00 删了兼容壳 tools/utility.ts，
 *       双轨 barrel 合一到 tools/util/index.js；
 *     - `dist-ts/core/crypto.js` —— 改名成 core/token-payload.ts。
 *   两条都是 critical，第一个就失败，`loadAllModules()` 直接 return，
 *   后面全部模块（含 ribbon-entry）都不加载 —— 表现为 Ribbon 三个 Get*Pressed
 *   未定义、条件格式按钮无反应、「Ribbon 模块未在 15 秒内就绪」。
 *
 *   之所以一直没暴露：wpsjs debug 的 404 分支手写 `Content-Type: text/html`
 *   （缺 charset），浏览器把 HTML 错误页当模块脚本加载时「碰巧」没抛；
 *   给补丁补上 charset + Content-Length 后立即显形。
 *   属于「同一信息多处维护、漏改一处就静默/偶发失效」，故用门禁兜住。
 *
 * 校验内容：
 *   1. 清单里每个 src 都在 dist-ts/ 下有对应文件（404 = critical 链路断）；
 *   2. 清单非空 —— 否则说明本脚本解析失效，必须报错而不是「0 问题」空转；
 *   3. 反向：dist-ts/ 下**被 import 图reach 到**的入口模块都应登记
 *      （不强制全量：大量模块是被别的模块 import 的，不需要单独 script 标签）。
 *      这里只查一个高价值子集——`ts/ribbon.ts` 的产物必须在清单里：
 *      它的导出（OnAction / Get*Pressed / GetBangumiImage）是 WPS ribbon 的回调，
 *       漏加载 = 功能区按钮全废，而报错只在真机出现。
 *
 * 用法：node scripts/check-module-manifest.mjs（需先 npm run build:ts）
 * 退出码：0 一致；1 不一致（并打印修复指引）。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainJsPath = join(projectRoot, 'main.js')

const problems = []

const mainSource = readFileSync(mainJsPath, 'utf8')
const sources = [...mainSource.matchAll(/src:\s*'([^']+)'/gu)].map((m) => m[1])

if (sources.length === 0) {
  console.error('✖ main.js 里没解析到任何 src 条目 —— 正则失效，请检查本脚本')
  process.exit(1)
}

// 1. 正向：清单里的每个路径都要有真实文件
for (const src of sources) {
  const absolute = join(projectRoot, src)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    problems.push(
      `main.js 登记了 ${src}，但 dist-ts/ 下没有这个文件。\n` +
        `   若是源码改名/删除导致：改 main.js 的 src 指向新产物路径。\n` +
        `   若只是还没编译：先跑 npm run build:ts。`,
    )
  }
}

// 2. 高价值反向项：ribbon 产物必须登记（ribbon 回调挂在 window 上，漏加载真机才报）
const ribbonArtifact = 'dist-ts/ribbon.js'
const ribbonRegistered = sources.some(
  (src) => src === ribbonArtifact || src === 'dist-ts/entry/ribbon-entry.js',
)
if (existsSync(join(projectRoot, ribbonArtifact)) && !ribbonRegistered) {
  problems.push(
    `dist-ts/ribbon.js 存在但 main.js 没登记它（也没登记 entry/ribbon-entry.js）。\n` +
      `   ribbon.ts 的导出（OnAction / Get*Pressed / GetBangumiImage）是 WPS 功能区回调，\n` +
      `   漏加载 = 按钮全部无反应，且报错只在真机出现。`,
  )
}

if (problems.length > 0) {
  console.error(`✖ main.js 模块清单与 dist-ts 产物不一致（${problems.length} 处）：\n`)
  for (const problem of problems) console.error(` · ${problem}\n`)
  process.exit(1)
}

console.log(`✔ main.js 模块清单与 dist-ts 产物一致（${sources.length} 个模块全部存在）`)
