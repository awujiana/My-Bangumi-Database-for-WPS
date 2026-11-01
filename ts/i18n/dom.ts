/**
 * @fileoverview 静态 HTML 的文案替换（`data-i18n*` 扫描）
 * @module i18n/dom
 * @description 页面加载后跑一次，切语言时再跑一次。**只改文案，不动结构**：
 *   `data-i18n` 用 `textContent` 整段替换，所以带子元素（图标 + 文字）的节点
 *   要挂在内层纯文本节点上，不能挂在容器上——否则图标会被抹掉。
 *
 * ## 为什么必须先判断「源语言就绪」
 *
 * 语言包加载失败时 `t()` 会原样返回 key。如果这时照常跑 `applyI18n`，整个界面
 * 会变成一片 `ribbon.buttonOpenSyncPanel` 这种字样——**比不翻译更糟**。所以源语言没
 * 加载成功时，本模块一个字都不改，HTML 里写的简体原文就是兜底。
 */

import { hasLocale, t } from './locale-store.js'
import { SOURCE_LOCALE } from './translate.js'

/**
 * 属性绑定表：`data-i18n-*` → 真正要写的属性
 *
 * `value` 单独列出来是因为它只对 `input[type=button|submit]` 有意义，其余元素
 * 设了也无害——不值得为它加一层 `instanceof` 判断。
 *
 * 这里**同时存选择器**而不是拼字符串：`querySelectorAll(\`[${attr}]\`)` 会被
 * `unicorn/require-css-escape` 判为「选择器里插值」，写死常量既过 lint 也更快。
 */
const ATTRIBUTE_BINDINGS: readonly {
  selector: string
  dataAttribute: string
  targetAttribute: string
}[] = [
  {
    selector: '[data-i18n-placeholder]',
    dataAttribute: 'data-i18n-placeholder',
    targetAttribute: 'placeholder',
  },
  { selector: '[data-i18n-title]', dataAttribute: 'data-i18n-title', targetAttribute: 'title' },
  {
    selector: '[data-i18n-aria-label]',
    dataAttribute: 'data-i18n-aria-label',
    targetAttribute: 'aria-label',
  },
  { selector: '[data-i18n-value]', dataAttribute: 'data-i18n-value', targetAttribute: 'value' },
  { selector: '[data-i18n-alt]', dataAttribute: 'data-i18n-alt', targetAttribute: 'alt' },
]

/** 当前是否具备替换条件（源语言已加载） */
export function canApplyI18n(): boolean {
  return hasLocale(SOURCE_LOCALE)
}

/** 属性文案里「取所在区块标题」的占位符 */
const TITLE_PLACEHOLDER = '{title}'

/**
 * 标题开头那些「不是字」的字符：emoji 图标 + 变体选择符 + 空格
 *
 * 40 个折叠按钮的可访问名都是「折叠 / 展开「区块名」」，区块名逐字等于它所在
 * `<h3>` 的文本 —— 但标题文本带 emoji 图标（`🎯 选择清理的表格`），屏幕阅读器
 * 会把图标也念出来。所以取标题时剥掉开头这些非文字字符。
 *
 * 只认 Han / Latin / 数字：`ℹ`（U+2139）在 JS 的 `\p{L}` 里算字母，用 `\p{L}`
 * 剥不掉它（实测），必须按文字系统判。
 */
const TITLE_PREFIX_PATTERN = /^[^\p{Script=Han}\p{Script=Latin}\p{N}]+/u

/**
 * 取「最近一层标题」的可见文本，供 `{title}` 占位符使用。
 *
 * 为什么从 DOM 取、而不是给 40 个按钮各写一个 key：按钮的可访问名就是它控制的
 * 那个区块名，各写一份必然漂移 —— 已经漂过一处（`sec-remote` 的标题是
 * 「数据同步（远程仓库 → 本地）」，而 aria 写的是「远程数据同步」）。
 */
function headingTitleOf(node: HTMLElement): string {
  const heading = node.closest('h2, h3')
  if (heading === null) return ''
  const clone = heading.cloneNode(true) as HTMLElement
  // 折叠按钮自己的 ▾ 会污染标题文本，先摘掉所有按钮
  for (const button of clone.querySelectorAll('button')) button.remove()
  const raw = clone.textContent.replace(/\s+/gu, ' ').trim()
  const stripped = raw.replace(TITLE_PREFIX_PATTERN, '')
  return stripped === '' ? raw : stripped
}

/**
 * 把 `root` 子树里的 `data-i18n*` 全部按当前语言重写
 *
 * @param root - 扫描起点；默认 `document`
 */
export function applyI18n(root?: ParentNode): void {
  if (!canApplyI18n()) return
  const scope = root ?? (typeof document === 'undefined' ? undefined : document)
  if (scope === undefined) return

  for (const node of scope.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n
    if (key !== undefined && key !== '') node.textContent = t(key)
  }

  // 整段 HTML 替换：给「一句话里内嵌 <code>/<strong>/<br>」的长段落用。
  // 这类文案不能拆成多个 data-i18n 片段——译文的语序和原文不同，拆开就拼不回去了。
  // 语言包是随插件分发的本地 ESM，不含用户输入，所以这里不需要过 DOMPurify。
  for (const node of scope.querySelectorAll<HTMLElement>('[data-i18n-html]')) {
    const key = node.dataset.i18nHtml
    if (key !== undefined && key !== '') node.innerHTML = t(key)
  }

  for (const binding of ATTRIBUTE_BINDINGS) {
    for (const node of scope.querySelectorAll<HTMLElement>(binding.selector)) {
      const key = node.getAttribute(binding.dataAttribute)
      if (key !== null && key !== '') {
        const text = t(key)
        // `t()` 找不到的占位符原样保留，所以这里能凭 `{title}` 是否还在判断要不要填。
        // 标题文本在上一轮 `[data-i18n]` 循环里已经翻过，取到的是当前语言。
        // 替换值用函数返回：字符串替换值里的 `$&` / `$1` 会被当替换模式
        // （区块名里出现 `$` 的概率不高，但没理由留这个坑）
        node.setAttribute(
          binding.targetAttribute,
          text.includes(TITLE_PLACEHOLDER)
            ? text.replaceAll(TITLE_PLACEHOLDER, () => headingTitleOf(node))
            : text,
        )
      }
    }
  }
}
