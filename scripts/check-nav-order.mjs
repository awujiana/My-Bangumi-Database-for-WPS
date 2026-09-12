#!/usr/bin/env node
/**
 * @fileoverview 校验「模块排序注册表」与四个页面 HTML 结构一致，且每页都接入了跨页同步
 *
 * 背景（2026-09-12 实际踩到的两个 bug）：
 *   ① `PAGE_MODULES` 是模块排序的唯一真相，页面 HTML 里的 `<section id>` 是另一份平行清单。
 *      两侧不同步时表现为**静默失效**：设置页拖了顺序，该页主区纹丝不动 ——
 *      因为 `applyNavOrder` 找不到对应 id 就跳过，不报错。
 *   ② 「跨页同步」的接入（`startNavOrderSync` / `startNavModeSync`）在各页 bootstrap 里
 *      **手写**，共 5 处且彼此不一致 —— 清理页漏了 `startNavModeSync()`，
 *      于是设置页勾「导航仅显示图标」时清理页不跟随，同样毫无报错。
 *   这两类是同一形态：「同一信息多处维护，漏改一处就静默失效」，故用门禁兜住。
 *
 * 校验内容：
 *   1. `PAGE_MODULES` 每个页面的模块 id 与 `ui/<page>.html` 的 `<section id>` 双向一致
 *      （注册表有而 HTML 无 → 拖了没反应；HTML 有而注册表无 → 永远排在最后且无法排序）；
 *   2. 每个注册表 id 都能在对应页面侧栏找到 `href="#<id>"` 锚点 —— 否则滚动高亮与
 *      锚点跳转会错位；
 *   3. `ORDERABLE_PAGES` 与 `PAGE_MODULES` / `PAGE_LABELS` 的键集合完全一致
 *      （设置页按 ORDERABLE_PAGES 渲染编辑器，漏一个页面就少一组却没人发现）；
 *   4. 四个页面的启动入口都调用了 `startNavOrderSync('<page>')` 与 `startNavModeSync()`
 *      —— 少任何一个都会让该页静默地不参与跨页同步；
 *      另需 `startModuleStateSync('<page>')` —— 漏了就没有折叠按钮、隐藏也不生效；
 *   5. 解析结果非空 —— 否则说明本脚本的解析失效，必须报错而不是「0 问题」空转。
 *
 * 退出码：0 一致；1 不一致（并打印修复指引）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/**
 * 解析 `ts/tools/nav-order.ts` 里的 `PAGE_MODULES`，得到「页面键 → 模块 id 列表」
 * @returns {Map<string, string[]>}
 */
function readPageModules(source) {
  // 形如：export const PAGE_MODULES: Readonly<Record<string, readonly NavModule[]>> = { ... }
  // 必须用 String.raw：普通模板字面量会把 \b / \s 当转义序列吃掉。
  // 按「第一个 {」切分而非按「=」切分 —— 类型标注里可能含 `=>`。
  //
  // 锚点必须带 `export const` 前缀：文件头部的 JSDoc 里也提到了 `PAGE_MODULES`，
  // 只匹配裸标识符会锚到注释上，`[^{]*` 随后跨越 import 段落到错误的 `{`。
  // 结尾用 `\n\}`（顶层对象以零缩进的 `}` 收束）并取**最后一个**匹配 ——
  // 惰性匹配会在第一个 `\n}`（如某个页面块之后的行）就停下。
  const declaration = new RegExp(
    String.raw`export const PAGE_MODULES\b[^{]*\{([\s\S]*)\n\}`,
    'u',
  ).exec(source)
  if (declaration === null || declaration[1] === undefined) {
    throw new Error('无法从 ts/tools/nav-order.ts 解析 PAGE_MODULES（脚本解析可能已失效）')
  }

  const result = new Map()
  // 逐页面块解析：`panel: [ { id: '...' }, ... ],`
  for (const pageMatch of declaration[1].matchAll(/(\w+)\s*:\s*\[([\s\S]*?)\]/gu)) {
    const page = pageMatch[1]
    const ids = [...pageMatch[2].matchAll(/id:\s*'([^']+)'/gu)].map((m) => m[1])
    result.set(page, ids)
  }
  if (result.size === 0) {
    throw new Error('PAGE_MODULES 解析结果为空（脚本解析可能已失效）')
  }
  return result
}

/**
 * 解析 `ts/tools/nav-order.ts` 里的 `PAGE_LABELS`，得到页面键集合
 * @returns {string[]}
 */
function readPageLabels(source) {
  // 同 readPageModules：锚点必须带 `export const` 前缀，否则会锚到文件头部 JSDoc
  // 里提到 `PAGE_LABELS` 的那一行，`[^{]*` 随即跨越正文抓到错误的 `{`。
  // 值都是无嵌套的字符串字面量，故 `[^}]*` 到第一个 `}` 即可。
  const body = new RegExp(String.raw`export const PAGE_LABELS\b[^{]*\{([^}]*)\}`, 'u').exec(source)
  if (body === null || body[1] === undefined) {
    throw new Error('无法从 ts/tools/nav-order.ts 解析 PAGE_LABELS（脚本解析可能已失效）')
  }
  const pages = [...body[1].matchAll(/(\w+)\s*:\s*'/gu)].map((m) => m[1])
  if (pages.length === 0) {
    throw new Error('PAGE_LABELS 解析结果为空（脚本解析可能已失效）')
  }
  return pages
}

/**
 * 解析 `ORDERABLE_PAGES` 数组
 * @returns {string[]}
 */
function readOrderablePages(source) {
  // 按 `=` 之后切分：类型标注形如 `readonly string[]` 自带方括号，
  // 用 `[^\[]*` 找第一个 `[` 会在类型标注处停下，导致解析为空。
  // 同样带 `export const` 前缀，避开文件头 JSDoc 里的同名提及。
  const body = new RegExp(String.raw`export const ORDERABLE_PAGES\b[^=]*=\s*\[([^\]]*)\]`, 'u').exec(source)
  if (body === null || body[1] === undefined) {
    throw new Error('无法从 ts/tools/nav-order.ts 解析 ORDERABLE_PAGES（脚本解析可能已失效）')
  }
  const pages = [...body[1].matchAll(/'([^']+)'/gu)].map((m) => m[1])
  if (pages.length === 0) {
    throw new Error('ORDERABLE_PAGES 解析结果为空（脚本解析可能已失效）')
  }
  return pages
}

/**
 * 从页面 HTML 提取「可排序模块容器」的 id 列表（按文档顺序）。
 *
 * 匹配 `main` 下带 `id="sec-*"` 的直接子元素 —— **不限定标签名**：
 * panel / clean / settings 用 `<section>`，enrich 用 `<div class="section">`，
 * `applyNavOrder` 是按 id 找 `main` 的直接子元素，与标签名无关。
 * 用「标签名 + id 前缀」而非只认 `<section>`，否则 enrich 会被误判成结构缺失。
 * @param {string} html - 页面 HTML
 * @returns {string[]}
 */
function readSectionIds(html) {
  // 只取 <main ...> ... </main> 区间，避免正文里其他带 sec- 前缀的 id 混入
  const mainBlock = /<main\b[^>]*>([\s\S]*?)<\/main>/u.exec(html)
  const scope = mainBlock?.[1] ?? html
  const ids = []
  for (const matched of scope.matchAll(/<(section|div|article)\b[^>]*\bid="(sec-[^"]+)"/gu)) {
    ids.push(matched[2])
  }
  return ids
}

/** 从页面 HTML 提取侧栏 `<a href="#...">` 的锚点 id 列表 */
function readNavAnchors(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref="#([^"]+)"/gu)].map((m) => m[1])
}

/**
 * 各页面的启动入口文件与其中应出现的跨页同步调用。
 * 页面键 → 需要检查的入口文件（相对仓库根）。
 * 一个页面可能有多个入口（panel 的排序在 bootstrap、导航模式在 entry），全部列出。
 */
const PAGE_ENTRIES = {
  panel: ['ts/panel/panel-bootstrap.ts', 'ts/entry/panel-entry.ts'],
  enrich: ['ts/panel/enrich-bootstrap.ts'],
  clean: ['ts/panel/clean-bootstrap.ts'],
  settings: ['ts/panel/settings-bootstrap.ts', 'ts/entry/settings-entry.ts'],
}

/** 检查某页所有入口文件中是否出现指定调用（跨文件合计命中即可） */
function hasCallAcross(entries, call) {
  return entries.some((file) => readText(file).includes(call))
}

function main() {
  const navOrderSource = readText('ts/tools/nav-order.ts')
  const pageModules = readPageModules(navOrderSource)
  const pageLabels = readPageLabels(navOrderSource)
  const orderablePages = readOrderablePages(navOrderSource)

  const problems = []

  // ===== 1) 注册表 vs 页面 HTML =====
  for (const [page, ids] of pageModules) {
    const htmlPath = `ui/${page}.html`
    if (!existsSync(join(projectRoot, htmlPath))) {
      problems.push(`注册表声明了页面 "${page}"，但 ${htmlPath} 不存在`)
      continue
    }
    const html = readText(htmlPath)
    const sectionIds = readSectionIds(html)
    const anchors = readNavAnchors(html)

    if (sectionIds.length === 0) {
      problems.push(`${htmlPath} 未解析到任何 <section id>（解析可能失效）`)
    }

    for (const id of ids) {
      if (!sectionIds.includes(id)) {
        problems.push(`${page}: 注册表声明模块 "${id}"，但 ${htmlPath} 无对应 <section id>（拖了不会重排）`)
      }
      if (!anchors.includes(id)) {
        problems.push(`${page}: 注册表声明模块 "${id}"，但 ${htmlPath} 侧栏无 href="#${id}" 锚点（高亮会错位）`)
      }
    }
    for (const id of sectionIds) {
      if (!ids.includes(id)) {
        problems.push(`${page}: ${htmlPath} 的 <section id="${id}"> 未登记进 PAGE_MODULES（无法排序，永远排最后）`)
      }
    }
  }

  // ===== 2) 三份清单的页面键集合必须一致 =====
  const modulePages = [...pageModules.keys()].sort((a, b) => a.localeCompare(b))
  const labelPages = [...pageLabels].sort((a, b) => a.localeCompare(b))
  const orderPages = [...orderablePages].sort((a, b) => a.localeCompare(b))
  const sameSet = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

  if (!sameSet(modulePages, labelPages)) {
    problems.push(
      `PAGE_MODULES 与 PAGE_LABELS 的页面键不一致：` +
        `PAGE_MODULES=[${modulePages.join(', ')}] PAGE_LABELS=[${labelPages.join(', ')}]`,
    )
  }
  if (!sameSet(modulePages, orderPages)) {
    problems.push(
      `PAGE_MODULES 与 ORDERABLE_PAGES 的页面键不一致：` +
        `PAGE_MODULES=[${modulePages.join(', ')}] ORDERABLE_PAGES=[${orderPages.join(', ')}]`,
    )
  }
  if (orderablePages.length === 0) {
    problems.push('ORDERABLE_PAGES 为空（设置页会没有任何可排序分组）')
  }

  // ===== 3) 每页入口都必须接入两个跨页同步 =====
  for (const [page, entries] of Object.entries(PAGE_ENTRIES)) {
    for (const file of entries) {
      if (!existsSync(join(projectRoot, file))) {
        problems.push(`页面 "${page}" 的入口文件 ${file} 不存在（PAGE_ENTRIES 配置已过期）`)
      }
    }
    const existing = entries.filter((file) => existsSync(join(projectRoot, file)))
    if (existing.length === 0) continue

    if (!hasCallAcross(existing, `startNavOrderSync('${page}')`)) {
      problems.push(
        `页面 "${page}" 的入口未调用 startNavOrderSync('${page}') —— ` +
          `该页不会参与模块排序跨页同步（检查：${existing.join(' / ')}）`,
      )
    }
    if (!hasCallAcross(existing, 'startNavModeSync()')) {
      problems.push(
        `页面 "${page}" 的入口未调用 startNavModeSync() —— ` +
          `设置页切「导航仅显示图标」时该页不跟随（检查：${existing.join(' / ')}）`,
      )
    }
    if (!hasCallAcross(existing, `startModuleStateSync('${page}')`)) {
      problems.push(
        `页面 "${page}" 的入口未调用 startModuleStateSync('${page}') —— ` +
          `该页模块没有右上角折叠按钮，设置页的「隐藏」也不生效（检查：${existing.join(' / ')}）`,
      )
    }
  }

  if (problems.length > 0) {
    console.log(`✖ 模块排序注册表与页面结构不一致（${problems.length} 项）：\n`)
    for (const problem of problems) console.log(`  · ${problem}`)
    console.log('\n修法：PAGE_MODULES 是排序的唯一真相，页面 HTML 的 <section id> 与侧栏锚点')
    console.log('      必须与它严格一致；新增页面时同步更新 PAGE_LABELS / ORDERABLE_PAGES /')
    console.log('      PAGE_ENTRIES，并在该页入口加上 startNavOrderSync + startNavModeSync。')
    process.exit(1)
  }

  const totalModules = [...pageModules.values()].reduce((sum, ids) => sum + ids.length, 0)
  console.log(
    `✔ 模块排序一致：${pageModules.size} 个页面 / ${totalModules} 个模块 == HTML 的 <section id> 与侧栏锚点；` +
      `各页入口均已接入 startNavOrderSync + startNavModeSync + startModuleStateSync`,
  )
}

main()
