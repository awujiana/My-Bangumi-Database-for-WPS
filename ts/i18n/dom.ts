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
      if (key !== null && key !== '') node.setAttribute(binding.targetAttribute, t(key))
    }
  }
}
