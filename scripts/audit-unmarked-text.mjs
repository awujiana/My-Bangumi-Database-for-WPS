#!/usr/bin/env node
/**
 * @fileoverview 扫出 `ui/*.html` 里**没有 `data-i18n` 标记**的中文文案
 *
 * 为什么单独做一个审计，而不是加进 `npm run gate`：
 * `check-i18n-consistency.mjs` 保证的是「三份语言包的 key 齐全且一致」，规则 ⑩⑪
 * 保证的是「绑定写法正确」。但一个中文段落**压根没打 `data-i18n`** 时，三份包
 * 都是 100%，界面在英文下照样露中文——这类漏标记没有任何门禁能发现。
 *
 * 判据是「页面静态源码里出现汉字，且不在 `[data-i18n]` / `[data-i18n-html]`
 * 节点内」。命中分两类：
 *   - `[动态]`：元素的 id 在 `ts/**` 里出现过 → 大概率由 JS 在运行时写入，
 *     初始文案只是占位。**仍要确认那个 JS 真的会被调用**（首屏不跑就等于没覆盖）。
 *   - `[静态]`：ts 里没有这个 id → 要么是真漏译，要么是刻意保留的字面量
 *     （`<code>` 里的字段名、语言自称「简体中文」等）。
 *
 * 刻意排除（不报）：
 *   - `code` / `pre` / `script` / `style` / `kbd` / `samp` 内的文本
 *   - HTML 注释
 *   - 带 `data-i18n-*` 的属性（placeholder / title / aria-label 等）
 *
 * 用法：
 *   node scripts/audit-unmarked-text.mjs            # 全部页面
 *   node scripts/audit-unmarked-text.mjs settings.html
 *   node scripts/audit-unmarked-text.mjs --json
 *
 * 退出码：0 始终（需人工判断）；2 未找到页面。
 *
 * ⚠️ 本脚本**不进 gate**：命中项里必然有动态占位和刻意保留，判不了「对错」，
 *    只能给人一份清单。加进 gate 就只能靠一份越堆越长的白名单维持绿灯。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { JSDOM } from 'jsdom'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 汉字（含扩展 A 区，够覆盖文案用字） */
const HAN_PATTERN = /\p{Script=Han}/u

/** 内容本身就是字面量的标签：里面的中文不是「待翻译文案」 */
const LITERAL_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'KBD', 'SAMP'])

/** 需要带 `data-i18n-*` 的属性 */
const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt', 'value']

/** 递归收集目录下所有 .ts 文件 */
function listTypeScriptFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath))
    } else if (entry.name.endsWith('.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

/**
 * 收集 ts 源码里出现过的 id 字面量
 *
 * 只为给命中项加「动态 / 静态」的提示，不要求精确：漏一个 id 只会让某个动态节点
 * 被标成静态（多看一眼），不会漏报。
 */
function collectKnownIds() {
  const ids = new Set()
  for (const file of listTypeScriptFiles(join(projectRoot, 'ts'))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/['"`]([A-Za-z][\w-]{2,60})['"`]/gu)) {
      ids.add(match[1])
    }
  }
  return ids
}

/** 从元素向上找，判断它是否已被 i18n 覆盖（或有子元素等特殊情况） */
function hasI18nAncestor(element) {
  for (let node = element; node !== null; node = node.parentElement) {
    if (LITERAL_TAGS.has(node.tagName)) return true
    if (node.hasAttribute('data-i18n') || node.hasAttribute('data-i18n-html')) return true
  }
  return false
}

/** 元素的可读标识：`tag#id.class`（便于在源码里搜） */
function describeElement(element) {
  const id = element.id === '' ? '' : `#${element.id}`
  const firstClass = (element.className || '').trim().split(/\s+/u)[0] ?? ''
  const className = firstClass === '' ? '' : `.${firstClass}`
  return `${element.tagName.toLowerCase()}${id}${className}`
}

/** 扫一个页面 */
function auditPage(fileName, knownIds) {
  const html = readFileSync(join(projectRoot, 'ui', fileName), 'utf8')
  const { document } = new JSDOM(html).window
  const textHits = []
  const attributeHits = []

  const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/gu, ' ').trim()
    if (text === '' || !HAN_PATTERN.test(text)) continue
    const element = node.parentElement
    if (element === null || hasI18nAncestor(element)) continue
    const isDynamic = element.id !== '' && knownIds.has(element.id)
    textHits.push({
      kind: isDynamic ? '动态' : '静态',
      where: describeElement(element),
      text: text.slice(0, 60),
    })
  }

  for (const element of document.querySelectorAll(
    TRANSLATABLE_ATTRIBUTES.map((a) => `[${a}]`).join(','),
  )) {
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      const value = element.getAttribute(attribute) ?? ''
      if (!HAN_PATTERN.test(value)) continue
      if (element.hasAttribute(`data-i18n-${attribute}`)) continue
      const isDynamic = element.id !== '' && knownIds.has(element.id)
      attributeHits.push({
        kind: isDynamic ? '动态' : '静态',
        where: `${describeElement(element)} ${attribute}`,
        text: value.slice(0, 60),
      })
    }
  }

  return { textHits, attributeHits }
}

function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')
  const requested = args.filter((argument) => argument.endsWith('.html'))
  const pages =
    requested.length > 0
      ? requested
      : readdirSync(join(projectRoot, 'ui')).filter((f) => f.endsWith('.html'))
  if (pages.length === 0) {
    console.error('✖ 未找到任何页面（ui/*.html）')
    return 2
  }

  const knownIds = collectKnownIds()
  const report = {}
  let total = 0
  for (const page of pages) {
    if (!statSync(join(projectRoot, 'ui', page), { throwIfNoEntry: false })) {
      console.error(`✖ 找不到 ui/${page}`)
      return 2
    }
    const { textHits, attributeHits } = auditPage(page, knownIds)
    report[page] = { textHits, attributeHits }
    total += textHits.length + attributeHits.length
  }

  if (jsonMode) {
    console.log(JSON.stringify(report, undefined, 2))
    return 0
  }

  for (const page of pages) {
    const { textHits, attributeHits } = report[page]
    if (textHits.length === 0 && attributeHits.length === 0) {
      console.log(`${page}  ✔ 无未标记中文`)
      continue
    }
    console.log(`\n${page}  ${String(textHits.length + attributeHits.length)} 处`)
    for (const hit of textHits) console.log(`  [${hit.kind}] ${hit.where}  「${hit.text}」`)
    for (const hit of attributeHits) console.log(`  [${hit.kind}] ${hit.where}="${hit.text}"`)
  }

  console.log(`\n合计 ${String(total)} 处，逐条确认：`)
  console.log('  [动态] 有 JS 写入点 —— 但要确认它在**首屏**就会跑；只在点击时写的等于没覆盖。')
  console.log('  [静态] ts 里没有这个 id —— 要么补 data-i18n，要么确认它是刻意保留的字面量。')
  return 0
}

process.exit(main())
