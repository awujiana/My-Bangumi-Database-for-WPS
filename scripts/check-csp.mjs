#!/usr/bin/env node
/**
 * @fileoverview 校验各页 CSP 放行了 WPS 客户端本地服务端口
 *
 * 背景：`wpsjsrpcsdk.js`（wpsjs 脚手架产物，7 个页面都以 `<script src="../wpsjsrpcsdk.js">`
 * 引入）初始化时会向 **WPS 客户端本地服务**探测 `/version`：
 *   - HTTP  `http://127.0.0.1:58890`
 *   - HTTPS `https://127.0.0.1:58891`
 *   - WS    `ws://127.0.0.1:58892`
 * 三个端口在 rpcsdk 源码里是硬编码的（见 wpsjsrpcsdk.js:66/81/91-92）。
 *
 * 我们的 CSP 里 `connect-src 'self' ...` **既不匹配 58890/58891/58892 这三个端口，
 * 也不匹配 ws:// 这个 scheme**（'self' 要求 scheme + host + port 全同，http 页面下
 * ws:// 不算 self）。于是宿主控制台稳定刷两条：
 *   Refused to connect to 'http://127.0.0.1:58890/version' because it violates the
 *   following Content Security Policy directive: "connect-src 'self' ..."
 *
 * 为什么必须管（而不只是噪音）：
 *   1. 失败后 rpcsdk 会走重试→`InitWpsCloudSvr()`→唤醒云服务的分支，
 *      最终 callback 抛 `status:2 "请允许浏览器打开WPS Office"`，是**能干扰加载项
 *      初始化时序**的；
 *   2. 新增页面时漏配 CSP 是**静默失效** —— 没有任何编译期或运行期报错，
 *      只在控制台多两行红字，很容易一直带着。
 *
 * 本脚本同时守住另一条（同源，都是关于 rpcsdk 的）：
 *   **页面不得直接 `<script src="../wpsjsrpcsdk.js">`** —— 加载项环境必须走
 *   `libs/wps-sdk-loader.js` 条件加载。直接引用会让 rpcsdk 在加载项里也去连
 *   58890/58892，失败重试耗尽后调 `InitWpsCloudSvr()` 另开一个 WebView，
 *   表现为「多一块黑窗格 + 零日志」（日志在它自己的上下文里，调试器看不到）。
 *
 * 注意：本项目的 `getApp()` 读的是宿主注入的 `window.Application`，**并不依赖 rpcsdk**
 * （所以功能不会因为这条报错直接挂）。放行的目的是消灭噪音 + 让 rpcsdk 这条通道
 * 在需要它的场景（浏览器唤起 WPS）真正可用。
 *
 * 退出码：0 一致；1 不一致（并打印修复指引）。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const uiDirectory = join(projectRoot, 'ui')

/** 必须在 connect-src 里出现的源（WPS 官方固定端口，rpcsdk 硬编码） */
const REQUIRED_SOURCES = [
  'http://127.0.0.1:58890',
  'https://127.0.0.1:58891',
  'ws://127.0.0.1:58892',
]

/** 收集到的所有问题 */
const problems = []

/** 统计：确保解析器真的读到了东西（空转必须报错） */
let checkedPages = 0

const pages = readdirSync(uiDirectory)
  .filter((name) => name.endsWith('.html'))
  .sort()

for (const page of pages) {
  const html = readFileSync(join(uiDirectory, page), 'utf8')
  // CSP meta 跨多行，必须跨行匹配（按行 grep 会漏）
  const meta = /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/gu.exec(html)
  if (!meta) {
    problems.push(`ui/${page} 没有 CSP meta（要么漏了，要么格式变了导致本脚本解析不到）`)
    continue
  }

  const directive = /\bconnect-src\s+([^;"]+)/u.exec(meta[0])
  if (!directive) {
    problems.push(`ui/${page} 的 CSP 没有 connect-src 指令（会连 bgm.tv API 都发不出去）`)
    continue
  }

  const sources = directive[1].trim().split(/\s+/u)
  for (const required of REQUIRED_SOURCES) {
    if (!sources.includes(required)) {
      problems.push(
        `ui/${page} 的 connect-src 缺少 ${required} —— ` +
          `wpsjsrpcsdk.js 探测 /version 会被拦，控制台刷 ` +
          `"Refused to connect ... violates ... connect-src"`,
      )
    }
  }

  // rpcsdk 必须走条件加载器，直接在页面里引用会让加载项环境也去连本地服务
  if (html.includes('../wpsjsrpcsdk.js')) {
    problems.push(
      `ui/${page} 直接引用了 ../wpsjsrpcsdk.js —— 加载项环境必须走 ` +
        `libs/wps-sdk-loader.js 条件加载（宿主已注入 Application，rpcsdk 用不上；` +
        `加载它会在连不上 58890/58892 后开出一块黑 WebView）`,
    )
  }
  checkedPages += 1
}

if (checkedPages === 0) {
  problems.push('一个页面都没解析到 —— 本脚本的解析逻辑失效了，必须修而不是「0 问题」空转')
}

if (problems.length > 0) {
  console.error('✗ CSP 放行校验失败：\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error(
    '\n修复：在各页 CSP meta 的 connect-src 里补上 ' + REQUIRED_SOURCES.join(' ') + '\n' +
      '（这三个是 WPS 客户端本地服务端口，见 wpsjsrpcsdk.js 硬编码；只放行 127.0.0.1 本机）',
  )
  process.exit(1)
}

console.log(`✓ CSP 放行校验通过（${String(checkedPages)} 个页面均已放行 WPS 本地服务端口）`)
