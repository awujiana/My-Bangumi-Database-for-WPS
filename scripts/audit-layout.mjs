#!/usr/bin/env node
/**
 * @fileoverview 全页面**布局审计**（真浏览器量计算样式，找「样式错位」类问题）
 *
 * 背景：BGM 的面板类页面把 `panel-theme.css` 放在**最后**加载（panel / settings），
 * 它里面的**通用**规则（`.form-row label { flex: 0 0 96px }`、`.form-row input { width: 100% }`）
 * 会命中各种内部控件；而 `styles.css` 里针对同类控件的覆盖规则**特异性相同**（都是 0,1,1）
 * → 由加载顺序决定胜负 → 覆盖失效、控件被挤窄或撑大。2026-10-09 一次就抓到 3 处：
 *
 *   ① `.shard-select-list` 的 6 个分片标签被钉成 96px，中文竖排（已有专项门禁）；
 *   ② `#checkboxSyncSelectedOnly` 的 label 被钉成 96px + 复选框被 `width: 100%` 撑到 96px；
 *   ③ `.time-filter-box` 的 `display: block` 被 `.form-row { display: flex }` 盖掉
 *      → label 与 `p.hint` 挤在一行争宽，label 只剩 111px、文字竖排 4 行。
 *
 * 这类 bug 对单元测试**完全隐形**：jsdom 不做布局计算，CSS 也没有类型系统
 * （属性名打错、被同特异性规则盖掉，都只是静默失效）。唯一判据是**真浏览器里的计算样式**。
 *
 * 三条判据（都尽量做到「客观不该发生」，不依赖基准快照）：
 *   1. `checkbox-stretched`：原生 checkbox/radio 渲染尺寸 > 20px
 *      —— 一定是被 `width: 100%` 这类通用规则命中（原生控件约 13px）；
 *   2. `text-wrapped`：**短文本**（≤ 24 字）却占了 > 1 个**视觉行**
 *      —— 一定是容器被挤窄。已排除三类噪声：
 *        · `display: inline` 的元素（rect 是所有行框的并集，跨行属正常）；
 *        · flex 纵排容器（`flex-direction: column`，如 `.radio-label` 的标题 + 描述是设计）；
 *        · table / tr / td / th / code（表格自适应换行、行内代码换行都正常）。
 *      行数用「元素内所有文本节点 rect 的 top 聚类（相邻差 ≤ 6px 算同一行）」，
 *      **不是**各文本节点行数之和 —— 后者会把 `文本A<span>B</span>文本C` 算成 3 行。
 *   3. `overflow-x`：内容横向溢出且父级未设 overflow（`scrollWidth > clientWidth + 2`）。
 *
 * 用法：
 *   node scripts/audit-layout.mjs                 # 审计 ui/*.html 全部页面
 *   node scripts/audit-layout.mjs sync-panel.html      # 只审计指定页面
 *   node scripts/audit-layout.mjs --json          # 输出 JSON
 *   node scripts/audit-layout.mjs --widths 400,500
 *   node scripts/audit-layout.mjs --locale en      # 先套上语言包再量（英文比中文长）
 *   CHROME_PATH=<chrome.exe> node scripts/audit-layout.mjs
 *
 * `--locale` 会在量之前把该语言包套到页面上：英文比中文长 30–50%，同样的容器
 * 在中文下正常、在英文下可能折行或溢出，只量静态中文是量不出这个的。
 *
 * 退出码：0 无异常；1 发现异常；2 无法运行（缺浏览器 / 未找到页面）。
 *
 * ⚠️ 依赖本机装有 Chrome / Edge，因此**不进 `npm run gate`**；它是「改过 `css/**`
 *    或页面结构之后手工跑一次」的审计工具。⚠️ 判据 2 是启发式，命中项需**人工确认**
 *    是否真的是错位（设计性的多行、长文本换行都可能误报）。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 布局宽度：Chrome 最小窗口宽约 500px，窄档靠注入 `html { width: Npx }` 模拟 */
const LAYOUT_WIDTHS = [500, 400]

/** 原生 checkbox / radio 的尺寸上限（约 13px；被 width:100% 撑开会到上百 px） */
const MAX_CONTROL_SIZE = 20

/** 判定「短文本」的字符数上限 —— 超过就当长段落，本来就该换行 */
const MAX_SHORT_TEXT = 24

/** 常见浏览器安装位置（Windows）；可用 CHROME_PATH 覆盖 */
const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter((item) => item !== undefined && item !== '')

/**
 * 在页面里执行的审计脚本（以字符串注入，因此**不能出现反引号**）
 */
const AUDIT = String.raw`
(function () {
  function cssPath(el) {
    const parts = []
    let cur = el
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let s = cur.tagName.toLowerCase()
      if (cur.id) { s += '#' + cur.id; parts.unshift(s); break }
      if (cur.classList.length) s += '.' + [...cur.classList].join('.')
      const parent = cur.parentElement
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === cur.tagName)
        if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')'
      }
      parts.unshift(s)
      cur = cur.parentElement
    }
    return parts.join(' > ')
  }

  const SKIP_TAGS = new Set(['SCRIPT','STYLE','LINK','META','TITLE','HEAD','HTML','OPTION','OPTGROUP','BR','HR','IFRAME','PRE','CODE','TABLE','THEAD','TBODY','TR','TD','TH'])
  const problems = []

  for (const el of document.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
    const r = el.getBoundingClientRect()
    if (r.width > ${String(MAX_CONTROL_SIZE)} || r.height > ${String(MAX_CONTROL_SIZE)}) {
      problems.push({ kind: 'checkbox-stretched', path: cssPath(el), detail: Math.round(r.width) + 'x' + Math.round(r.height) + 'px' })
    }
  }

  for (const el of document.querySelectorAll('*')) {
    if (SKIP_TAGS.has(el.tagName)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    // inline 元素的 rect 是所有行框的并集，跨行属正常
    if (style.display === 'inline') continue
    // flex 纵排容器里的多行是设计意图（如 .radio-label 的 标题 + 描述）
    if (style.display === 'flex' && style.flexDirection === 'column') continue

    let hasBlockChild = false
    for (const node of el.childNodes) {
      if (node.nodeType !== 1) continue
      if (SKIP_TAGS.has(node.tagName)) continue
      const d = getComputedStyle(node).display
      if (d === 'block' || d === 'flex' || d === 'grid' || d === 'list-item' || d === 'table') hasBlockChild = true
    }
    if (hasBlockChild) continue

    const text = el.textContent.replace(/\s+/gu, ' ').trim()
    if (text.length === 0 || text.length > ${String(MAX_SHORT_TEXT)}) continue

    const tops = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let tn
    while ((tn = walker.nextNode())) {
      if (tn.textContent.trim() === '') continue
      const range = document.createRange()
      range.selectNodeContents(tn)
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) tops.push(rect.top)
      }
    }
    tops.sort((a, b) => a - b)
    let lines = 0
    let lastTop = -Infinity
    for (const t of tops) {
      if (t - lastTop > 6) { lines += 1; lastTop = t }
    }
    if (lines > 1) {
      problems.push({
        kind: 'text-wrapped',
        path: cssPath(el),
        detail: lines + ' 行 / 「' + text + '」',
        box: Math.round(r.width) + 'x' + Math.round(r.height),
        flex: style.flex,
        width: style.width,
      })
    }
  }

  for (const el of document.querySelectorAll('*')) {
    if (SKIP_TAGS.has(el.tagName)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const style = getComputedStyle(el)
    if (style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowX === 'auto' || style.overflowX === 'scroll') continue
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
      problems.push({ kind: 'overflow-x', path: cssPath(el), detail: 'scrollW ' + el.scrollWidth + ' > clientW ' + el.clientWidth })
    }
  }

  const pre = document.createElement('pre')
  pre.id = 'audit'
  pre.textContent = JSON.stringify({ title: document.title, problems })
  document.body.append(pre)
})()
`

function findBrowser() {
  return BROWSER_CANDIDATES.find((candidate) => existsSync(candidate))
}

function listPages(filter) {
  const dir = join(projectRoot, 'ui')
  const all = readdirSync(dir)
    .filter((name) => name.endsWith('.html'))
    .sort()
  return filter.length === 0 ? all : all.filter((name) => filter.includes(name))
}

/**
 * 生成探针副本。
 * ⚠ 两处改写是必须的（都踩过）：
 *   ① 4 个页面有 `<meta http-equiv="Content-Security-Policy" ... script-src 'self' ...>`，
 *      会拦掉探针的内联脚本（报 violates script-src 'self'）→ 副本里移除；
 *      注意该标签跨多行，正则必须跨行匹配（bash grep 按行匹配会漏）。
 *   ② 样式表 href 要解析成**绝对** file:// URL —— 探针副本在 temp 目录，`../css/...` 会失效
 *      → 整页无样式 → 量出幽灵数据。
 */
/** 读一个语言包的 messages（语言包是 `export default {…}` 后跟纯 JSON） */
function readLocaleMessages(code) {
  const text = readFileSync(join(projectRoot, 'locales', code, 'locale.js'), 'utf8')
  const stripped = text.replace(/^[\s\S]*?export\s+default\s+/u, '').replace(/;\s*$/u, '')
  return JSON.parse(stripped).messages
}

/**
 * 生成「先套语言包再量布局」的探针脚本
 *
 * 为什么把语言包**内联**成 JSON，而不是在探针里 `import()`：Chrome 把 `file://` 当
 * opaque origin，动态 `import()` 本地模块会**永远挂住**（既不 resolve 也不 reject）。
 * 实测 `--allow-file-access-from-files` 无效；`--disable-web-security` 配独立 profile
 * 在空白页能过，但在带多个样式表的真实页面上同样卡死。语言包本来就是纯数据，
 * 内联没有信息损失。
 *
 * 替换逻辑与 `ts/i18n/dom.ts` 的 `applyI18n()` 逐条对应（同样两个循环 + 5 个属性绑定），
 * **改那边的选择器时这里要跟着改**。末尾断言「至少替换到一个节点」——静默空转会量出
 * 一份没套语言包的页面，然后报告「无异常」，那比不量更危险。
 */
function buildLocaleProbe(locale) {
  const messages = readLocaleMessages(locale)
  const fallback = readLocaleMessages('zh-CN')
  return `<script>(() => {
  const MESSAGES = ${JSON.stringify(messages)}
  const FALLBACK = ${JSON.stringify(fallback)}
  const t = (key) => MESSAGES[key] ?? FALLBACK[key] ?? key
  let touched = 0
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.dataset.i18n
    if (key !== undefined && key !== '') { node.textContent = t(key); touched += 1 }
  }
  for (const node of document.querySelectorAll('[data-i18n-html]')) {
    const key = node.dataset.i18nHtml
    if (key !== undefined && key !== '') { node.innerHTML = t(key); touched += 1 }
  }
  for (const [selector, dataAttribute, targetAttribute] of [
    ['[data-i18n-placeholder]', 'data-i18n-placeholder', 'placeholder'],
    ['[data-i18n-title]', 'data-i18n-title', 'title'],
    ['[data-i18n-aria-label]', 'data-i18n-aria-label', 'aria-label'],
    ['[data-i18n-value]', 'data-i18n-value', 'value'],
    ['[data-i18n-alt]', 'data-i18n-alt', 'alt'],
  ]) {
    for (const node of document.querySelectorAll(selector)) {
      const key = node.getAttribute(dataAttribute)
      if (key !== null && key !== '') { node.setAttribute(targetAttribute, t(key)); touched += 1 }
    }
  }
  if (touched === 0) {
    const pre = document.createElement('pre')
    pre.id = 'audit'
    pre.textContent = JSON.stringify({
      title: document.title,
      problems: [{ kind: 'locale-noop', path: ${JSON.stringify(locale)}, detail: '一个 data-i18n 都没替换到' }],
    })
    document.body.append(pre)
    return
  }
${AUDIT}
})()</script>`
}

function buildProbe(htmlPath, layoutWidth, locale) {
  let html = readFileSync(htmlPath, 'utf8')
  html = html.replace(
    /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/gu,
    '<!-- CSP removed for probe -->',
  )
  html = html.replace(/(<link[^>]+href=")(\.\.\/[^"]+)(")/gu, (_m, head, href, tail) => {
    return `${head}${pathToFileURL(resolve(projectRoot, 'ui', href)).href}${tail}`
  })
  const style = `<style>html { width: ${String(layoutWidth)}px; }</style>`
  let script = `<script>${AUDIT}</script>`
  if (locale !== undefined) {
    if (/data-i18n(-[a-z-]+)?="/u.test(html)) {
      script = buildLocaleProbe(locale)
    } else {
      // 还没打标记的页面（P5 待迁移）按原文量，不算异常——否则 --locale 会对
      // 半个仓库报「一个都没替换到」，把真正的问题淹掉
      console.warn(`  ⚠ ${basename(htmlPath)} 还没有 data-i18n 标记（P5 待迁移），按原文量`)
    }
  }
  return html.replace(/<\/body>/u, `${style}${script}</body>`)
}

function run(browser, pagePath) {
  const out = execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=500,900',
      '--virtual-time-budget=4000',
      '--dump-dom',
      pathToFileURL(pagePath).href,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  )
  const json = /<pre id="audit">([\s\S]*?)<\/pre>/u.exec(out)?.[1]
  if (json === undefined || json.trim() === '') {
    // 空结果一律大声失败：脚本没执行（CSP / 路径）或页面结构变了，都不是「没有异常」
    throw new Error('探针未回填结果 —— 内联脚本未执行（CSP 未移除？）或页面无 </body>')
  }
  const decoded = json
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&')
  return JSON.parse(decoded)
}

function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')
  const widthArg = args.indexOf('--widths')
  const widths =
    widthArg === -1
      ? LAYOUT_WIDTHS
      : (args[widthArg + 1] ?? '')
          .split(',')
          .map((v) => Number.parseInt(v.trim(), 10))
          .filter((v) => Number.isFinite(v))
  const pages = listPages(args.filter((a) => a.endsWith('.html')))
  const localeArg = args.indexOf('--locale')
  const locale = localeArg === -1 ? undefined : (args[localeArg + 1] ?? '')
  if (locale === '') {
    console.error('✖ --locale 后面要跟语言代码，例如 `--locale en`')
    return 2
  }
  if (locale !== undefined && !existsSync(join(projectRoot, 'locales', locale, 'locale.js'))) {
    console.error(`✖ 找不到 locales/${locale}/locale.js`)
    return 2
  }

  const browser = findBrowser()
  if (browser === undefined) {
    console.error('✖ 未找到 Chrome / Edge —— 本审计需要真浏览器做布局计算。')
    console.error('  用 CHROME_PATH=<浏览器 exe 路径> 指定，或在本机安装 Chrome。')
    return 2
  }
  if (pages.length === 0) {
    console.error('✖ 未找到任何页面（ui/*.html）')
    return 2
  }

  const dir = mkdtempSync(join(tmpdir(), 'bgm-layout-audit-'))
  const report = {}
  let total = 0
  try {
    for (const page of pages) {
      report[page] = {}
      for (const width of widths) {
        const file = join(dir, `${page}.${String(width)}.html`)
        writeFileSync(file, buildProbe(join(projectRoot, 'ui', page), width, locale), 'utf8')
        try {
          const result = run(browser, file)
          report[page][width] = result.problems
          total += result.problems.length
        } catch (error) {
          // 探针跑不起来同样是「这次没验成」，必须计入失败——否则「全部页面抛错」
          // 会打印成「✔ 未发现布局异常」并退出 0（踩过）
          report[page][width] = { error: error.message }
          total += 1
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2))
    return total === 0 ? 0 : 1
  }

  console.log(`浏览器：${browser}`)
  console.log(`页面：${String(pages.length)} 个 × 布局宽 ${widths.join('/')}px`)
  console.log(`语言：${locale ?? '页面静态文案（未套语言包）'}\n`)
  for (const page of pages) {
    for (const width of widths) {
      const items = report[page][width]
      if (items.error !== undefined) {
        console.log(`### ${page} @ ${String(width)}px —— ✖ ${items.error}\n`)
        continue
      }
      if (items.length === 0) {
        console.log(`### ${page} @ ${String(width)}px —— ✔ 无异常\n`)
        continue
      }
      console.log(`### ${page} @ ${String(width)}px —— ${String(items.length)} 项`)
      const byKind = {}
      for (const item of items) (byKind[item.kind] ??= []).push(item)
      for (const [kind, list] of Object.entries(byKind)) {
        console.log(`  [${kind}] ${String(list.length)} 项`)
        for (const item of list) {
          const extra =
            item.box === undefined ? '' : `  box=${item.box} flex=${item.flex} width=${item.width}`
          console.log(`    · ${item.path}  ${item.detail}${extra}`)
        }
      }
      console.log()
    }
  }

  if (total === 0) {
    console.log('✔ 未发现布局异常（checkbox 尺寸 / 短文本折行 / 横向溢出）')
    return 0
  }
  console.error(`✖ 发现 ${String(total)} 项，需人工确认：`)
  console.error(
    '  · checkbox-stretched —— 几乎一定是被 `.form-row input { width: 100% }` 命中，直接修；',
  )
  console.error(
    '  · text-wrapped —— 可能是容器被挤窄（真 bug），也可能是设计性换行 / 长文本，需看截图；',
  )
  console.error('  · overflow-x —— 看是否撑破父容器。')
  console.error('  修法：把被命中的控件规则**特异性提到 (0,2,1) 以上**（多写一层类），')
  console.error(
    '  而不是加 !important —— 通用规则写在 panel-theme.css（最后加载），同特异性下它必赢。',
  )
  return 1
}

process.exit(main())
