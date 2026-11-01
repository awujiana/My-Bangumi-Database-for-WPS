#!/usr/bin/env node
/**
 * @fileoverview 校验语言包与源码的一致性（i18n 门禁）
 *
 * ## 为什么需要它
 *
 * i18n 的 bug 不会让任何东西变红：key 拼错 → 界面上出现一串 `settings.appearance.xxx`；
 * 译文漏了占位符 → `已关闭 {count} 个页面` 原样露出来；`ribbon.xml` 改了 label 但
 * 语言包没跟 → 静态兜底文案和切换后的文案对不上。这些都不会报错，只会「看起来怪」。
 * 所以用门禁把三件事钉住。
 *
 * ## 校验内容
 *
 * 1. 每个 `locales/<code>/locale.js` 都能解析、`schemaVersion` 一致、`code` 与目录名一致；
 * 2. 各语言的 key 集合 ⊆ `zh-CN`（多出来的 key 是脏数据，说明改名时漏删）；
 * 3. 同一 key 的 `{占位符}` 集合必须完全相等（否则译文会吞掉变量）；
 * 4. `ribbon.xml` 每个带 `label` 的控件都有 `ribbon.<控件id>`，且值等于静态 label
 *    （静态 label 是语言包没加载完时的兜底，两者不一致会先闪一下再变）；
 * 5. `<tab>` 必须挂 `getLabel`（运行时切语言的唯一入口），group / button / checkBox
 *    必须**不挂**（实测从不被调用，挂了是死代码）；
 * 6. `ui/*.html` 里所有 `data-i18n*` 引用的 key 都真的存在；
 * 7. `ui/settings.html` 的语言按钮 `data-locale` 与 `ts/i18n/translate.ts` 的
 *    `LOCALE_CODES` 一一对应（顺序也要一致——界面上的排列就是这里的顺序）；
 * 8. `data-i18n` 不能挂在带子元素的节点上（`textContent` 会把图标 / `<br>` 抹掉）；
 * 9. `data-i18n-html` 里不能有 `id` / `data-action` / 表单控件（`innerHTML` 重建会
 *    让一次性绑定的事件失效、input 勾选状态丢失）。
 *
 * ## 退出码
 *
 * 0 一致；1 不一致（打印修复指引）。
 *
 * ## 自检
 *
 * `node scripts/check-i18n-consistency.mjs --self-test`
 * 对每个检查项各造一个「坏输入」，断言它**确实被抓到**。不跑这一步的话，
 * 正则写错会让门禁永远通过——那比没有门禁更危险。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_LOCALE = 'zh-CN'

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
 * 解析语言包模块源码（`export default {…};`）→ 对象
 *
 * 语言包是 ESM 而不是 JSON：安装态页面跑在 `file://` 下，`fetch` 读本地文件会被
 * CEF 直接拦掉（2026-11-01 真机实测 `Failed to fetch`），只有 `import()` 能读。
 * 内容仍是纯数据，所以这里剥掉外壳后按 JSON 解析——解析不了就是脏包，必须报出来。
 */
function parseLocaleModule(text, relativePath) {
  const stripped = text.replace(/^[\s\S]*?export\s+default\s+/u, '').replace(/;\s*$/u, '')
  try {
    return JSON.parse(stripped)
  } catch {
    throw new Error(`${relativePath} 不是合法的语言包（export default 后面必须是 JSON 对象）`)
  }
}

/** 取出文案里所有 `{name}` 占位符（去重升序） */
function extractPlaceholders(template) {
  const names = new Set()
  for (const matched of template.matchAll(/\{(\w+)\}/gu)) {
    if (matched[1] !== undefined) names.add(matched[1])
  }
  return [...names].sort((left, right) => left.localeCompare(right))
}

/**
 * 解析 ribbon.xml 里带 label 的控件
 *
 * 必须先取**整个标签**再逐个解析属性：`getLabel` 可能写在 `label` 之前或之后，
 * 用「匹配到 label 就停」的正则会让写在后面的 getLabel 看不见（实测踩过：
 * 门禁把已经挂了 getLabel 的 tab 判成没挂，而自检用例「删掉 getLabel」照样通过
 * ——因为它本来就恒判为没挂，测了个寂寞）。
 */
function readRibbonControls(xml) {
  const controls = []
  for (const matched of xml.matchAll(/<(tab|group|button|checkBox)\b([^>]*)>/gu)) {
    const tag = matched[1] ?? ''
    const attributes = matched[2] ?? ''
    const id = /\bid="([^"]+)"/u.exec(attributes)?.[1] ?? ''
    const label = /\blabel="([^"]+)"/u.exec(attributes)?.[1] ?? ''
    if (id === '' || label === '') continue
    controls.push({ tag, id, label, hasGetLabel: /\bgetLabel="/u.test(attributes) })
  }
  return controls
}

/** 从 ts/i18n/translate.ts 里读出 LOCALE_CODES（顺序即界面顺序） */
function readLocaleCodes(source) {
  const block = /export const LOCALE_CODES = \[([^\]]+)\] as const/u.exec(source)
  if (block === null || block[1] === undefined) {
    throw new Error('ts/i18n/translate.ts 中未找到 LOCALE_CODES 的定义（解析规则可能已失效）')
  }
  return [...block[1].matchAll(/'([^']+)'/gu)].map((matched) => matched[1] ?? '')
}

/** 从 HTML 里收集所有 data-i18n* 引用的 key */
function readHtmlKeys(html) {
  const keys = new Set()
  for (const matched of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/gu)) {
    if (matched[1] !== undefined) keys.add(matched[1])
  }
  return keys
}

/** 自闭合/空元素：它们不会「包住」东西 */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/** 带状态的元素：`data-i18n-html` 重建它们会丢事件与取值 */
const STATEFUL_TAGS = new Set(['input', 'select', 'textarea', 'button'])

/**
 * 极简 DOM 扫描：只为回答「这个元素里面有没有子元素」和「子元素里有没有 id / data-action」
 *
 * 不引入解析库：这里只需要标签层级，`ui/*.html` 也没有会干扰的 `<script>` 内联内容。
 */
function scanHtmlElements(html) {
  const source = html.replace(/<!--[\s\S]*?-->/gu, '')
  const elements = []
  const stack = []
  for (const matched of source.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/gu)) {
    const tag = (matched[2] ?? '').toLowerCase()
    const attributes = matched[3] ?? ''
    if (matched[1] === '/') {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tag === tag) {
          stack.length = index
          break
        }
      }
      continue
    }
    const node = { tag, attributes, children: [] }
    if (stack.length > 0) stack[stack.length - 1].children.push(node)
    elements.push(node)
    if (!VOID_TAGS.has(tag) && !attributes.trimEnd().endsWith('/')) stack.push(node)
  }
  return elements
}

/** 递归找后代里「重建就出事」的标记 */
function findStatefulDescendant(node) {
  for (const child of node.children) {
    if (STATEFUL_TAGS.has(child.tag)) return `<${child.tag}>`
    if (/\bid="/u.test(child.attributes)) {
      return `<${child.tag} id="${/\bid="([^"]*)"/u.exec(child.attributes)?.[1] ?? ''}">`
    }
    if (/\bdata-action="/u.test(child.attributes)) {
      return `<${child.tag} data-action="${/\bdata-action="([^"]*)"/u.exec(child.attributes)?.[1] ?? ''}">`
    }
    const deeper = findStatefulDescendant(child)
    if (deeper !== '') return deeper
  }
  return ''
}

/**
 * 检查两种「挂错位置」的标记——它们不会报错，只会让界面悄悄坏掉
 *
 * ① `data-i18n` 走 `textContent` 整段替换：元素里有子元素（图标、`<br>`、`<code>`）
 *    就会被抹掉。要么把文案包进内层 span，要么改用 `data-i18n-html`。
 * ② `data-i18n-html` 走 `innerHTML` 重建：里面的 `id`、`data-action`、表单控件会被
 *    重新创建——`setupButtonListeners()` 是**一次性**绑定到元素上的，重建后事件就断了，
 *    而 `<input>` 的勾选状态也会丢。
 */
function readHtmlI18nStructure(html) {
  const issues = []
  for (const node of scanHtmlElements(html)) {
    const textKey = /\bdata-i18n="([^"]+)"/u.exec(node.attributes)?.[1]
    const htmlKey = /\bdata-i18n-html="([^"]+)"/u.exec(node.attributes)?.[1]
    if (textKey !== undefined && node.children.length > 0) {
      const first = node.children[0]
      issues.push(
        `「${textKey}」用了 data-i18n，但里面还有 <${first.tag}>——textContent 整段替换会把它抹掉` +
          '（把文案包进内层 span，或改用 data-i18n-html）',
      )
    }
    if (htmlKey !== undefined) {
      const risky = findStatefulDescendant(node)
      if (risky !== '') {
        issues.push(
          `「${htmlKey}」用了 data-i18n-html，但里面含 ${risky}——innerHTML 重建会让 ` +
            'data-action 事件失效 / input 状态丢失（改成内层 span 分段翻译）',
        )
      }
    }
  }
  return issues
}

/**
 * 跑全部检查
 *
 * @param {object} input
 * @param {Record<string, {schemaVersion: number, code: string, messages: Record<string, string>}>} input.locales
 * @param {string[]} input.localeCodes
 * @param {string} input.ribbonXml
 * @param {Record<string, string>} input.htmlByFile
 * @returns {string[]} 问题列表（空数组 = 通过）
 */
function collectProblems(input) {
  const problems = []
  const source = input.locales[SOURCE_LOCALE]

  // 解析自检：任何一项为空都说明脚本自己坏了，必须报错而不是「0 问题」空转
  if (source === undefined) return [`语言包 locales/${SOURCE_LOCALE}/locale.js 不存在`]
  if (Object.keys(source.messages).length === 0) {
    problems.push(`locales/${SOURCE_LOCALE}/locale.js 的 messages 为空`)
  }
  if (input.localeCodes.length === 0) problems.push('LOCALE_CODES 解析为空')
  if (Object.keys(input.htmlByFile).length === 0) problems.push('ui/ 下没有解析到任何 HTML')

  // ① 结构
  for (const code of input.localeCodes) {
    const bundle = input.locales[code]
    if (bundle === undefined) {
      problems.push(`locales/${code}/locale.js 不存在（LOCALE_CODES 里声明了这个语言）`)
      continue
    }
    if (bundle.schemaVersion !== source.schemaVersion) {
      problems.push(
        `${code} 的 schemaVersion=${String(bundle.schemaVersion)}，与简体 ${String(source.schemaVersion)} 不一致`,
      )
    }
    if (bundle.code !== code) {
      problems.push(`${code} 的 code 字段是「${String(bundle.code)}」，与目录名不一致`)
    }
  }

  // ② key 集合 ⊆ 简体
  const sourceKeys = new Set(Object.keys(source.messages))
  for (const code of input.localeCodes) {
    const bundle = input.locales[code]
    if (bundle === undefined || code === SOURCE_LOCALE) continue
    for (const key of Object.keys(bundle.messages)) {
      if (!sourceKeys.has(key)) {
        problems.push(`${code} 有简体里不存在的 key「${key}」（多半是改名时漏删）`)
      }
    }
  }

  // ③ 占位符集合相等
  for (const code of input.localeCodes) {
    const bundle = input.locales[code]
    if (bundle === undefined || code === SOURCE_LOCALE) continue
    for (const [key, text] of Object.entries(bundle.messages)) {
      const expected = source.messages[key]
      if (expected === undefined) continue
      const actualNames = extractPlaceholders(text)
      const expectedNames = extractPlaceholders(expected)
      if (actualNames.join(',') !== expectedNames.join(',')) {
        problems.push(
          `${code} 的「${key}」占位符不一致：期望 {${expectedNames.join('} {')}}，实际 {${actualNames.join('} {')}}`,
        )
      }
    }
  }

  // ④⑤ ribbon.xml
  const controls = readRibbonControls(input.ribbonXml)
  if (controls.length === 0)
    problems.push('ribbon.xml 未解析出任何带 label 的控件（解析规则可能已失效）')
  for (const control of controls) {
    const key = `ribbon.${control.id}`
    if (source.messages[key] === undefined) {
      problems.push(`ribbon.xml 的 ${control.tag} ${control.id} 缺少语言包 key「${key}」`)
    } else if (source.messages[key] !== control.label) {
      problems.push(
        `「${key}」与 ribbon.xml 的静态 label 不一致：语言包「${source.messages[key]}」≠ XML「${control.label}」`,
      )
    }
    if (control.tag === 'tab' && !control.hasGetLabel) {
      problems.push(`<tab id="${control.id}"> 没有 getLabel —— 运行时切语言不会生效`)
    }
    if (control.tag !== 'tab' && control.hasGetLabel) {
      problems.push(
        `<${control.tag} id="${control.id}"> 挂了 getLabel，但 WPS 实测从不调用它（死代码，删掉）`,
      )
    }
  }

  // ⑥ HTML 里的 key 必须存在，且标记要挂在「换文案不会破坏结构」的位置
  for (const [file, html] of Object.entries(input.htmlByFile)) {
    for (const key of readHtmlKeys(html)) {
      if (source.messages[key] === undefined) {
        problems.push(`${file} 引用了语言包里没有的 key「${key}」`)
      }
    }
    for (const issue of readHtmlI18nStructure(html)) {
      problems.push(`${file} ${issue}`)
    }
  }

  // ⑦ 设置页的语言按钮与 LOCALE_CODES 一致（顺序也要一致）
  const settingsHtml = input.htmlByFile['ui/settings.html']
  if (settingsHtml !== undefined) {
    const buttons = [...settingsHtml.matchAll(/data-locale="([^"]+)"/gu)].map(
      (matched) => matched[1] ?? '',
    )
    if (buttons.join(',') !== input.localeCodes.join(',')) {
      problems.push(
        `ui/settings.html 的语言按钮 [${buttons.join(', ')}] 与 LOCALE_CODES [${input.localeCodes.join(', ')}] 不一致（顺序也要求一致）`,
      )
    }
  } else {
    problems.push('ui/settings.html 不存在，无法校验语言按钮')
  }

  return problems
}

/** 读真实输入 */
function loadInput() {
  const localeCodes = readLocaleCodes(readText('ts/i18n/translate.ts'))
  const locales = {}
  for (const code of localeCodes) {
    const relativePath = join('locales', code, 'locale.js')
    locales[code] = parseLocaleModule(readText(relativePath), relativePath)
  }
  const htmlByFile = {}
  for (const file of readdirSync(join(projectRoot, 'ui'))) {
    if (!file.endsWith('.html')) continue
    htmlByFile[`ui/${file}`] = readText(join('ui', file))
  }
  return { locales, localeCodes, ribbonXml: readText('ribbon.xml'), htmlByFile }
}

/**
 * 自检：每个检查项各造一个坏输入，断言确实被抓到
 *
 * 只跑「应该失败」的方向——门禁的价值在于**能失败**，通过是默认状态。
 */
function selfTest() {
  const input = loadInput()
  const clone = () => JSON.parse(JSON.stringify(input))
  const cases = []

  /** 注册一个变异用例 */
  const addCase = (name, mutate, expectedFragment) => {
    const broken = clone()
    mutate(broken)
    const problems = collectProblems(broken)
    cases.push({
      name,
      ok: problems.some((problem) => problem.includes(expectedFragment)),
      problems,
      expectedFragment,
    })
  }

  addCase(
    '删掉一个 key',
    (broken) => {
      delete broken.locales[SOURCE_LOCALE].messages['ribbon.wpsAddinTab']
    },
    '缺少语言包 key「ribbon.wpsAddinTab」',
  )

  addCase(
    'XML 静态 label 与语言包不一致',
    (broken) => {
      broken.locales[SOURCE_LOCALE].messages['ribbon.buttonOpenSyncPanel'] = '被改过的文案'
    },
    '与 ribbon.xml 的静态 label 不一致',
  )

  addCase(
    '译文吞掉占位符',
    (broken) => {
      const other = broken.localeCodes.find((code) => code !== SOURCE_LOCALE)
      if (other !== undefined) {
        broken.locales[other].messages['settings.appearance.languageCoverage'] = '已翻译 0%'
      }
    },
    '占位符不一致',
  )

  addCase(
    '译文多出简体没有的 key',
    (broken) => {
      const other = broken.localeCodes.find((code) => code !== SOURCE_LOCALE)
      if (other !== undefined) broken.locales[other].messages['ribbon.ghost'] = '鬼'
    },
    '有简体里不存在的 key「ribbon.ghost」',
  )

  addCase(
    'tab 丢了 getLabel',
    (broken) => {
      broken.ribbonXml = broken.ribbonXml.replace(' getLabel="GetRibbonLabel"', '')
    },
    '没有 getLabel',
  )

  addCase(
    'button 挂了 getLabel（死代码）',
    (broken) => {
      broken.ribbonXml = broken.ribbonXml.replace(
        'id="buttonOpenSyncPanel"',
        'id="buttonOpenSyncPanel" getLabel="GetRibbonLabel"',
      )
    },
    '挂了 getLabel',
  )

  addCase(
    'HTML 引用了不存在的 key',
    (broken) => {
      broken.htmlByFile['ui/settings.html'] += '<span data-i18n="settings.ghost.key"></span>'
    },
    '引用了语言包里没有的 key「settings.ghost.key」',
  )

  addCase(
    'data-i18n 挂在带子元素的节点上',
    (broken) => {
      broken.htmlByFile['ui/settings.html'] +=
        '<span data-i18n="settings.app.title"><b>图标</b></span>'
    },
    'textContent 整段替换会把它抹掉',
  )

  addCase(
    'data-i18n-html 里含 data-action',
    (broken) => {
      broken.htmlByFile['ui/settings.html'] +=
        '<p data-i18n-html="settings.about.description"><a data-action="openTokenPage">x</a></p>'
    },
    'data-action 事件失效',
  )

  addCase(
    '语言按钮与 LOCALE_CODES 不一致',
    (broken) => {
      broken.htmlByFile['ui/settings.html'] = broken.htmlByFile['ui/settings.html'].replace(
        /data-locale="[^"]+"/u,
        'data-locale="ja"',
      )
    },
    '与 LOCALE_CODES',
  )

  addCase(
    '语言包文件缺失',
    (broken) => {
      const other = broken.localeCodes.find((code) => code !== SOURCE_LOCALE)
      if (other !== undefined) delete broken.locales[other]
    },
    'locale.js 不存在',
  )

  const failed = cases.filter((item) => !item.ok)
  if (failed.length > 0) {
    console.error('✖ i18n 门禁自检失败（说明检查项失效，门禁会永远通过）：')
    for (const item of failed) {
      console.error(`  - ${item.name}：期望命中「${item.expectedFragment}」，实际问题：`)
      for (const problem of item.problems) console.error(`      ${problem}`)
      if (item.problems.length === 0) console.error('      （一条问题都没报）')
    }
    process.exit(1)
  }
  console.log(`✔ i18n 门禁自检通过：${String(cases.length)} 个变异用例全部被捕获`)
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest()
    return
  }

  const input = loadInput()
  const problems = collectProblems(input)

  if (problems.length > 0) {
    console.error('✖ i18n 一致性校验失败：')
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error(
      '\n修复方式：\n' +
        '  1) 新增/改名 key 时，三份 locales/<code>/locale.js 一起改（简体是基准，其余是子集）；\n' +
        '  2) 带占位符的文案，译文里必须保留同名 {变量}；\n' +
        '  3) 改 ribbon.xml 的 label 时，同步改 locales/*/locale.js 的 ribbon.<控件id>；\n' +
        '  4) ui/*.html 里加 data-i18n 前，先把 key 写进简体语言包。\n' +
        '原因：这些不一致都不会报错，只会让界面露出 key、露出 {变量}，或者中英混排。',
    )
    process.exit(1)
  }

  const keyCount = Object.keys(input.locales[SOURCE_LOCALE].messages).length
  console.log(
    `✔ i18n 一致：${String(input.localeCodes.length)} 个语言 / 简体 ${String(keyCount)} 个 key / ` +
      `ribbon ${String(readRibbonControls(input.ribbonXml).length)} 个控件 / ` +
      `${String(Object.keys(input.htmlByFile).length)} 个 HTML 页面的 data-i18n 全部对得上`,
  )
}

main()
