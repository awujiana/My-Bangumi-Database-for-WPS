#!/usr/bin/env node
/**
 * @fileoverview 「数据分片」多选区的**布局回归门禁**（真浏览器量计算样式）
 *
 * 背景（2026-10-09 实际踩到的 bug）：
 *   panel 页的「数据分片」6 个复选框被挤成 96px 宽的窄条，中文标签竖排成一字一行，
 *   整块网格错位。根因**不是**某一条规则写错，而是**两个样式表互相盖**：
 *
 *     ① `panel-theme.css` 在 `styles.css` **之后**加载，其中 `.form-row label`
 *        { flex: 0 0 96px } 与 `styles.css` 的 `.shard-select-list label`
 *        { flex: 0 0 auto } **特异性相同**（都是 0,1,1）→ 后加载者胜 → 标签被钉成 96px；
 *     ② `panel-theme.css` 的 `.form-row input { width: 100%; padding: 9px 12px }`
 *        也命中了分片复选框 → 复选框被撑到 140px 宽，文字只剩 ~35px 窄条。
 *        （原覆盖规则只重置了 flex / margin / accent-color，**盖不住 width**。）
 *
 *   这类 bug 对单元测试**完全隐形** —— jsdom 不做布局计算，CSS 也没有类型系统。
 *   唯一的判据是「真浏览器里的计算样式」，所以本脚本用 headless Chrome 量。
 *
 * 怎么保证脚本本身不空转（本项目被「永远为真」的断言坑过）：
 *   · fixture 不是手抄的：**样式表 `<link>` 与分片 form-row 片段都从 `ui/panel.html` 抽取**，
 *     分片清单从 `ts/ui/handlers/github-settings.ts` 读 —— 加载顺序或文案变了，脚本自动跟上；
 *   · 渲染结构另有**契约自检**：若 `github-settings.ts` 不再用
 *     `label.append(input, document.createTextNode(option.label))` 这个结构，直接报错退出；
 *   · **样式生效自检**：页面回填的 `listDisplay` 必须是 `flex`、标签 `borderTopWidth` 不能是 0
 *     —— 否则说明样式表压根没加载，测出来的数字毫无意义（本脚本第一版就栽在这：
 *     探针页写在 `%TEMP%`，`../css/...` 指向不存在的位置，全页无样式，量出「标签 470px 宽」
 *     这种幽灵结果，还把锅甩给了 CSS）；
 *   · 抽取结果为空、找不到浏览器、样式未生效 —— 一律**大声失败**，不静默跳过。
 *
 * 断言（在 320 / 400 / 500 三种布局宽度下都要成立）：
 *   1. 每个分片标签的文字**只占 1 行**（换行 = 被挤窄，就是本 bug 的指纹）；
 *   2. 标签高度 ≤ 40px（单行 + padding）；
 *   3. 分片复选框宽高 ≤ 20px（被 `width: 100%` 撑开会到上百 px）；
 *   4. 解析出的标签数量 > 0（否则是 fixture 失效，不是布局合格）。
 *
 * 用法：
 *   node scripts/check-shard-layout.mjs
 *   node scripts/check-shard-layout.mjs --keep-probe        # 保留探针页面供人工核对
 *   CHROME_PATH=<chrome.exe> node scripts/check-shard-layout.mjs
 *
 * 退出码：0 布局合格；1 布局不合格；2 无法运行（缺浏览器 / fixture 失效 / 样式未生效）。
 *
 * ⚠️ 依赖本机装有 Chrome / Edge，因此**不进 `npm run gate`**；
 *    它是「改了 `css/**` 或 panel 页结构之后手工跑一次」的检查。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 要验证的**布局宽度**。
 * 注意 Chrome 有最小窗口宽度（约 500px），`--window-size` 传更小的值不会生效 ——
 * 所以窄宽度靠注入 `html { width: Npx }` 模拟，而不是靠缩窗口。
 */
const LAYOUT_WIDTHS = [320, 400, 500]

/** 渲染时用的真实视口宽度（≥ Chrome 最小窗口宽度，避免被夹断） */
const VIEWPORT_WIDTH = 500

/** 单行标签的高度上限（12px 字 + 4px 上下 padding + 余量） */
const MAX_LABEL_HEIGHT = 40

/** 复选框的尺寸上限（原生 checkbox 约 13px；被 width:100% 撑开会到上百 px） */
const MAX_CHECKBOX_SIZE = 20

/** 常见浏览器安装位置（Windows）；可用 CHROME_PATH 覆盖 */
const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter((item) => item !== undefined && item !== '')

function findBrowser() {
  return BROWSER_CANDIDATES.find((candidate) => existsSync(candidate))
}

/**
 * 从 `ui/panel.html` 抽取样式表加载顺序与分片区块
 * @returns {{ links: string[], formRow: string }}
 */
function readFixtureFromPanel() {
  const panelHtml = readFileSync(join(projectRoot, 'ui/panel.html'), 'utf8')

  const links = [...panelHtml.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/gu)].map(
    (matched) => matched[1] ?? '',
  )
  if (links.length === 0)
    throw new Error('ui/panel.html 未解析出任何样式表 <link>（fixture 抽取失效）')

  // 分片区块：包含 id="shardSelectList" 的那个 .form-row
  const formRow =
    /<div class="form-row">\s*<label for="shardSelectList">[\s\S]*?<\/div>\s*<\/div>/u.exec(
      panelHtml,
    )?.[0]
  if (formRow === undefined) {
    throw new Error('ui/panel.html 未解析出含 shardSelectList 的 .form-row（fixture 抽取失效）')
  }
  if (!formRow.includes('id="shardSelectList"')) {
    throw new Error('抽取到的片段不含 shardSelectList（抽取规则已失效）')
  }

  // 祖先容器：布局宽度与内边距由它们决定，缺了会让测量失真
  for (const marker of ['<div class="global">', '<main class="main main-grid">']) {
    if (!panelHtml.includes(marker)) {
      throw new Error(`ui/panel.html 中找不到 ${marker}（页面结构已变，请更新本脚本的 fixture）`)
    }
  }
  // sec-remote：开头标签**允许带属性**（历史上写成整串字面量，加上 `data-detachable`
  // 之后就匹配不上、整条门禁恒红），这里只锚 id 与标签名。
  if (!/<section\b[^>]*\bid="sec-remote"/u.test(panelHtml)) {
    throw new Error(
      'ui/panel.html 中找不到 id="sec-remote" 的 section（页面结构已变，请更新本脚本的 fixture）',
    )
  }

  return { links, formRow }
}

/**
 * 从 `ts/ui/handlers/github-settings.ts` 读取分片清单与渲染结构契约
 * @returns {{ shards: { name: string, label: string }[], required: string[] }}
 */
function readShardOptions() {
  const source = readFileSync(join(projectRoot, 'ts/ui/handlers/github-settings.ts'), 'utf8')

  // 结构契约：渲染方式变了，本脚本的 fixture 就不再代表真实 DOM —— 必须报错而非静默通过
  const CONTRACT = 'label.append(input, document.createTextNode(option.label))'
  if (!source.includes(CONTRACT)) {
    throw new Error(
      `github-settings.ts 中已找不到渲染结构契约「${CONTRACT}」——\n` +
        '  分片标签的 DOM 结构可能已变，本脚本的 fixture 不再代表真实渲染结果。\n' +
        '  请先更新本脚本，再依赖它的结论。',
    )
  }

  const optionsBlock = /export const SHARD_OPTIONS[\s\S]*?=\s*\[([\s\S]*?)\]\s*as const/u.exec(
    source,
  )?.[1]
  if (optionsBlock === undefined) throw new Error('github-settings.ts 未解析出 SHARD_OPTIONS')

  // 只锚 `name` + `label` 两段，**不要求紧接着 `}`** —— 加上 `detail`（分片字段说明）
  // 之后对象不再是「name/label 两项即闭合」，旧规则的 `\s*\}` 直接匹配不上，
  // 整条门禁恒红。
  const shards = [
    ...optionsBlock.matchAll(/\{\s*name:\s*'([^']+)',\s*label:\s*'([^']+)'/gu),
  ].map((matched) => ({ name: matched[1] ?? '', label: matched[2] ?? '' }))
  if (shards.length === 0) throw new Error('SHARD_OPTIONS 解析结果为空（解析规则可能已失效）')

  const required = [
    ...(/const REQUIRED_SHARDS[\s\S]*?=\s*\[([^\]]*)\]/u.exec(source)?.[1] ?? '').matchAll(
      /'([^']+)'/gu,
    ),
  ].map((matched) => matched[1] ?? '')
  if (required.length === 0) throw new Error('REQUIRED_SHARDS 解析结果为空（解析规则可能已失效）')

  return { shards, required }
}

/**
 * 生成探针页面：真实样式表（绝对 file:// 路径）+ 真实片段 + 真实分片清单。
 *
 * ⚠ 样式表 href 必须解析成**绝对** URL：探针页写在系统临时目录，
 *   原样的 `../css/...` 会指向不存在的路径 → 整页无样式 → 量出来的全是假象。
 */
function buildProbePage(links, formRow, shards, required, layoutWidth) {
  const labels = shards
    .map((shard) => {
      const isRequired = required.includes(shard.name)
      const attrs = isRequired ? ' class="is-required"' : ''
      const inputAttrs = isRequired ? ' checked disabled' : ''
      return (
        `<label${attrs}><input type="checkbox" data-shard="${shard.name}"${inputAttrs} />` +
        `${shard.label}</label>`
      )
    })
    .join('\n              ')

  // 把分片清单塞进真实片段里那个空的 #shardSelectList
  const filled = formRow.replace(
    /(<div id="shardSelectList"[^>]*>)[\s\S]*?(<\/div>)/u,
    (_matched, head, tail) => `${head}\n              ${labels}\n            ${tail}`,
  )
  if (filled === formRow) throw new Error('未能把分片清单注入 fixture 片段（注入规则失效）')

  const cssLinks = links
    .map((href) => {
      const absolute = pathToFileURL(resolve(projectRoot, 'ui', href)).href
      return `    <link rel="stylesheet" href="${absolute}" />`
    })
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; }
      /* Chrome 最小窗口宽度约 500px，窄布局靠这里模拟（比真实更苛刻：主区更窄） */
      html { width: ${String(layoutWidth)}px; }
    </style>
${cssLinks}
  </head>
  <body data-page="panel">
    <div class="global">
      <main class="main main-grid">
        <section class="section" id="sec-remote">
${filled}
        </section>
      </main>
    </div>
    <pre id="probe"></pre>
    <script>
      const list = document.getElementById('shardSelectList')
      const first = list.querySelector('label')
      const rows = []
      for (const label of list.querySelectorAll(':scope > label')) {
        const range = document.createRange()
        range.selectNodeContents(label.childNodes[1])
        const input = label.querySelector('input')
        const labelRect = label.getBoundingClientRect()
        const inputRect = input.getBoundingClientRect()
        rows.push({
          text: label.textContent,
          lineCount: range.getClientRects().length,
          labelWidth: Math.round(labelRect.width),
          labelHeight: Math.round(labelRect.height),
          inputWidth: Math.round(inputRect.width),
          inputHeight: Math.round(inputRect.height),
          flex: getComputedStyle(label).flex,
        })
      }
      document.getElementById('probe').textContent = JSON.stringify({
        // 样式生效自检：没有这两项就没必要看后面的数字
        listDisplay: getComputedStyle(list).display,
        labelBorderWidth: getComputedStyle(first).borderTopWidth,
        listWidth: Math.round(list.getBoundingClientRect().width),
        rows,
      })
    </script>
  </body>
</html>
`
}

/** 用 headless 浏览器渲染并取回测量结果 */
function measure(browser, pagePath) {
  const out = execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${String(VIEWPORT_WIDTH)},900`,
      '--virtual-time-budget=3000',
      '--dump-dom',
      pathToFileURL(pagePath).href,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 },
  )

  const json = /<pre id="probe">([\s\S]*?)<\/pre>/u.exec(out)?.[1]
  if (json === undefined || json.trim() === '') {
    throw new Error('探针页面未回填测量结果（页面脚本未执行？）')
  }
  return JSON.parse(json)
}

function main() {
  const browser = findBrowser()
  if (browser === undefined) {
    console.error('✖ 未找到 Chrome / Edge —— 本检查需要真浏览器做布局计算。')
    console.error('  用 CHROME_PATH=<浏览器 exe 路径> 指定，或在本机安装 Chrome。')
    console.error('  （不静默跳过：跳过会让这道门禁在缺浏览器的机器上「看起来是绿的」。）')
    return 2
  }

  let links
  let formRow
  let shards
  let required
  try {
    ;({ links, formRow } = readFixtureFromPanel())
    ;({ shards, required } = readShardOptions())
  } catch (error) {
    console.error(`✖ fixture 失效：${error.message}`)
    return 2
  }

  console.log(`浏览器：${browser}`)
  console.log(
    `fixture：${String(links.length)} 个样式表（顺序取自 panel.html）+ ${String(shards.length)} 个分片\n`,
  )

  const probeDir = mkdtempSync(join(tmpdir(), 'bgm-shard-layout-'))
  const keepProbe = process.argv.includes('--keep-probe')
  if (keepProbe) console.log(`探针页面将保留在：${probeDir}\n`)

  const problems = []
  try {
    for (const layoutWidth of LAYOUT_WIDTHS) {
      const pagePath = join(probeDir, `probe-${String(layoutWidth)}.html`)
      writeFileSync(pagePath, buildProbePage(links, formRow, shards, required, layoutWidth), 'utf8')

      let result
      try {
        result = measure(browser, pagePath)
      } catch (error) {
        problems.push(`[${String(layoutWidth)}px] 渲染失败：${error.message}`)
        continue
      }

      // 样式生效自检 —— 没过就没有必要看后面的数字
      if (result.listDisplay !== 'flex' || result.labelBorderWidth === '0px') {
        problems.push(
          `[${String(layoutWidth)}px] 样式未生效（list display=${String(result.listDisplay)}，` +
            `label border=${String(result.labelBorderWidth)}）—— 样式表没加载，本次测量无意义`,
        )
        continue
      }

      const { rows } = result
      if (rows.length === 0) {
        problems.push(
          `[${String(layoutWidth)}px] 未测量到任何分片标签 —— fixture 失效，本次结论无效`,
        )
        continue
      }

      console.log(
        `· 布局宽 ${String(layoutWidth)}px（列表 ${String(result.listWidth)}px，${String(rows.length)} 个标签）`,
      )
      console.log(
        `  标签宽高：${rows.map((row) => `${String(row.labelWidth)}×${String(row.labelHeight)}`).join(' ')}`,
      )
      console.log(`  复选框：${rows[0].inputWidth}×${rows[0].inputHeight}px`)
      console.log(`  文字行数：${rows.map((row) => row.lineCount).join('/')}`)

      for (const row of rows) {
        if (row.lineCount !== 1) {
          problems.push(
            `[${String(layoutWidth)}px] 「${row.text}」文字占 ${String(row.lineCount)} 行（应为 1 行）—— 标签被挤窄了`,
          )
        }
        if (row.labelHeight > MAX_LABEL_HEIGHT) {
          problems.push(
            `[${String(layoutWidth)}px] 「${row.text}」标签高 ${String(row.labelHeight)}px > ${String(MAX_LABEL_HEIGHT)}px`,
          )
        }
        if (row.inputWidth > MAX_CHECKBOX_SIZE || row.inputHeight > MAX_CHECKBOX_SIZE) {
          problems.push(
            `[${String(layoutWidth)}px] 「${row.text}」复选框 ${String(row.inputWidth)}×${String(row.inputHeight)}px ` +
              `（应 ≤ ${String(MAX_CHECKBOX_SIZE)}px，被 .form-row input { width: 100% } 撑开了？）`,
          )
        }
      }
    }
  } finally {
    if (!keepProbe) rmSync(probeDir, { recursive: true, force: true })
  }

  console.log()
  if (problems.length > 0) {
    console.error(`✖ 数据分片布局不合格（${String(problems.length)} 项）：`)
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error(
      '\n排查方向：`.form-row label` / `.form-row input` 这类**通用**规则会命中分片控件。\n' +
        '  它们分别写在 styles.css 与 panel-theme.css 里，特异性相同 → 由加载顺序决定胜负。\n' +
        '  分片控件自身的规则必须把特异性提到 (0,2,1) 以上，并**显式重置 width / flex**。',
    )
    return 1
  }

  console.log('✔ 数据分片布局合格：文字单行、复选框尺寸正常（三种布局宽度下均成立）')
  return 0
}

process.exit(main())
