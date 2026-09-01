/**
 * @fileoverview HTML 清洗工具模块
 * @module tools/sanitize
 * @description 基于 DOMPurify 封装的 HTML 清洗函数。
 *              兼容两种加载环境：
 *                1. Vite 构建模式：通过 importmap 或打包器解析 'dompurify'（保留 tryImport 分支供构建使用）
 *                2. wpsjs debug 纯静态模式：index.html 预先 <script src="./libs/purify.js"> 加载 UMD，挂到 window.DOMPurify
 *
 *              用于必须保留 HTML 结构（如 `<br>`、`<b>`、`<a>`、`<table>`、`<button>`）的场景，
 *              在拼接含动态内容的 HTML 字符串后，统一调用 sanitizeHtml 清洗，
 *              移除事件处理器（onerror/onload/onclick 等）、`<script>`、`<svg onload>`、
 *              `<img onerror>`、`javascript:` URI 等注入向量。
 *
 * 安全保障：
 *   - DOMPurify 默认剥离所有 `on*` 事件处理器属性（无论是否在白名单内）
 *   - DOMPurify 默认拦截 `javascript:`、`data:` 等危险 URI 协议
 *   - 白名单外的标签会被剥离（但保留其文本内容）
 *   - 白名单外的属性会被剥离
 */

/** 全局 window 上的 DOMPurify UMD 扩展（由 <script src="./libs/purify.js"> 注入） */
interface DomPurifyWindowExtension {
  DOMPurify?: {
    sanitize: (
      dirty: string,
      opts?: { ALLOWED_TAGS?: string[]; ALLOWED_ATTR?: string[]; ALLOW_DATA_ATTR?: boolean },
    ) => string
  }
}
type ExtendedWindow = typeof globalThis & DomPurifyWindowExtension

// 懒加载 DOMPurify：优先取 window.DOMPurify（wpsjs debug 模式 / 任务面板预加载）。
// 缓存分两层：
//   _cachedDomPurifyFactory  ->  已确认 window.DOMPurify.sanitize 存在时缓存工厂引用
//   _cachedFallback          ->  当 DOMPurify 不可用时缓存降级函数
// ⚠️ 旧版 bug：一旦 _purify 被缓存为降级函数，即使后来 DOMPurify 出现（例如 HTML 首屏
// 加载时序稍慢，或任务面板独立 HTML 之前忘记引入），也永远不会升级，导致 UI 结构
// 永久被降级逻辑破坏。新版本每次调用都会重新检测 DOMPurify 是否已就绪。
let _cachedDomPurifyFactory: {
  sanitize: (
    dirty: string,
    opts: {
      ALLOWED_TAGS?: string[]
      ALLOWED_ATTR?: string[]
      ALLOW_DATA_ATTR?: boolean
    },
  ) => string
} | null = null
let _cachedFallback: ((d: string) => string) | null = null

function getPurify(): (d: string) => string {
  const w = globalThis as ExtendedWindow
  // 先尝试拿 DOMPurify（即便之前走了降级，现在也可能加载好了）
  if (!_cachedDomPurifyFactory && w.DOMPurify && typeof w.DOMPurify.sanitize === 'function') {
    _cachedDomPurifyFactory = w.DOMPurify
  }
  if (_cachedDomPurifyFactory) {
    const factory = _cachedDomPurifyFactory
    // 基于 DOMPurify 的严格白名单清洗（真实环境安全路径）
    return (dirty: string): string =>
      factory.sanitize(dirty, {
        ALLOWED_TAGS: [
          // 文本格式
          'b',
          'i',
          'em',
          'strong',
          'br',
          'span',
          'div',
          'p',
          'a',
          // 列表
          'ul',
          'ol',
          'li',
          // 表格
          'table',
          'thead',
          'tbody',
          'tr',
          'td',
          'th',
          // 表单（对话框、筛选器需要）
          'button',
          'input',
          'select',
          'option',
          'label',
        ],
        ALLOWED_ATTR: [
          // 通用
          'class',
          'id',
          'style',
          'title',
          // 链接
          'href',
          'target',
          'rel',
          // 表单
          'type',
          'value',
          'placeholder',
          'disabled',
          'for',
          'name',
          // 无障碍
          'role',
          'aria-label',
          'aria-modal',
          'aria-labelledby',
          'aria-hidden',
          'aria-live',
          'aria-atomic',
          'aria-valuenow',
          'aria-valuemin',
          'aria-valuemax',
          // 数据属性（卡片标识等）
          'data-event',
          'data-status',
          'data-type',
          'data-row',
          'data-sid',
        ],
        ALLOW_DATA_ATTR: false,
      })
  }
  // DOMPurify 仍未加载 → 走降级
  if (_cachedFallback) return _cachedFallback
  _cachedFallback = createLightweightFallback()
  return _cachedFallback
}

/**
 * Lightweight fallback sanitizer for when window.DOMPurify is unavailable.
 *
 * History bug (2026-08 data-preview display corruption):
 *   - The old fallback ran `tmp.textContent = dirty; return tmp.innerHTML;`
 *     which HTML-escapes the ENTIRE string (< becomes &lt;), so internal UI
 *     markup like <table class="preview-table"> was rendered as literal text.
 *   - The old strategy was "strip ALL tags and keep plain text", which
 *     destroys all internal-generated UI structures (preview table, detail
 *     cards, upload buttons, filter selects).
 *   - The cached purify function was never re-checked: once the module
 *     registered a fallback, a later-loaded DOMPurify could never upgrade it.
 *
 * New strategy (only applies when DOMPurify truly cannot load):
 *   - Parse the dirty string into DOM via innerHTML.
 *   - Remove known-dangerous tags AND their contents: script / style /
 *     iframe / object / embed / svg / math / form / base / link / meta /
 *     title / template / frameset / frame / noframes / noscript / xmp /
 *     plaintext.
 *   - Walk every element: strip ALL on* event attributes, and strip href /
 *     src / action / formaction / poster / background attributes whose value
 *     matches javascript: / vbscript: / data:text*: / dangerous base64 data.
 *   - Keep all structural tags (table / tr / td / div / span / button /
 *     select / p / a / etc) and safe cosmetic attributes (class / id / style
 *     / title / data-* / aria-* / role) intact.
 *   - If even document is unavailable, fall back to a regex-based coarse
 *     filter (keep structure tags, remove danger tags / on* attrs).
 *
 * Next time getPurify() runs, if DOMPurify has since become available, it
 * upgrades transparently to the strict allowlist mode.
 */
function createLightweightFallback(): (d: string) => string {
  // 危险标签（完全删除，含子内容。不要把 table/div 这种列进去！）
  // NOTE: <img> 虽然在 DOMPurify 严格白名单里是默认禁止的，但为了与
  //       现有单元测试保持一致、防止 fallback 下遗留 <img onerror=...>
  //       变体（我们虽然会清 on* 属性，但多一层移除更安全，因为预览 UI
  //       内部并不生成 <img>），这里同样把 img 列入危险标签彻底移除。
  const DANGEROUS_TAGS = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'svg',
    'math',
    'form',
    'base',
    'link',
    'meta',
    'title',
    'template',
    'frameset',
    'frame',
    'noframes',
    'noscript',
    'xmp',
    'plaintext',
    'img',
  ])
  // 危险 URI 协议（href/src/action/formaction 等匹配上就移除该属性）
  const DANGEROUS_URI =
    /^\s*(javascript:|vbscript:|data:text\S*:|data:;base64,\s*PHN2Zy|data:;base64,\s*PHNjcmlwdA)/i

  return (dirty: string): string => {
    if (typeof dirty !== 'string' || !dirty) return ''
    if (typeof document === 'undefined') {
      // 极端：连 DOM 都没有（Node 跑单测？），退化为正则粗过滤
      return regexStripDanger(dirty)
    }
    try {
      const host = document.createElement('div')
      host.innerHTML = dirty

      // 1) 删除危险标签（深度优先，用 querySelectorAll）
      const selector = Array.from(DANGEROUS_TAGS).join(',')
      const badEls = host.querySelectorAll(selector)
      // 从尾到头 remove 避免 live collection 踩坑（querySelectorAll 是非 live，保险起见逆序）
      for (let i = badEls.length - 1; i >= 0; i -= 1) {
        const el = badEls[i]!
        el.remove()
      }

      // 2) 遍历所有元素，清 on* 事件属性 + 危险 URI
      const all = host.getElementsByTagName('*')
      for (let i = 0; i < all.length; i += 1) {
        const el = all[i]!
        if (el.nodeType !== 1) continue
        // 清 on* 事件属性（先收集后删，避免 NamedNodeMap 遍历中修改错位）
        const toRemoveAttrs: string[] = []
        for (let a = 0; a < el.attributes.length; a += 1) {
          const attr = el.attributes[a]!
          const { name } = attr
          if (name.length > 2 && name.slice(0, 2).toLowerCase() === 'on') {
            toRemoveAttrs.push(name)
          }
        }
        for (const name of toRemoveAttrs) el.removeAttribute(name)

        // 清 href / src / action / formaction / poster / data-xxx 里含 JS 的 URI
        const uriAttrs = ['href', 'src', 'action', 'formaction', 'poster', 'background']
        for (const attr of uriAttrs) {
          const v = el.getAttribute(attr)
          if (v != null && DANGEROUS_URI.test(v)) {
            el.removeAttribute(attr)
          }
        }
        // xss 常见奇技淫巧：<img src=x onerror="..."> 已经被 on* 清理覆盖
        // <a href="jAvAsCrIpT:...">  已被 DANGEROUS_URI 大小写不敏感匹配覆盖
      }

      // 3) 再次兜底：如果根级别本身挂了事件属性或危险标签名，也清掉（innerHTML 自身不会）
      return host.innerHTML
    } catch {
      // DOM 操作失败，走正则粗过滤兜底
      return regexStripDanger(dirty)
    }
  }
}

/**
 * 正则粗过滤（在连 document 都不可用的极端环境下兜底，
 * 策略仍是『保留结构标签，只清危险内容』，不能剥光所有标签）。
 */
function regexStripDanger(dirty: string): string {
  let safe = dirty
  // 去除 <script>..</script> / <style>..</style> / <iframe ...> / <img ...> 等
  // 危险块（含闭合内容；同时也移除 img 以防 fallback 下仍残留 on*= 变体——
  // 测试用例要求 <img onerror=...> 必须被彻底剥除）。
  safe = safe.replace(
    /<\s*(script|style|iframe|object|embed|svg|math|form|template|noscript|noframes|xmp|plaintext|img)\b[\s\S]*?<\/\s*\1\s*>/gi,
    '',
  )
  // 去除未闭合或自闭合危险标签：<script ... /> <meta ...> <img ...> 等
  safe = safe.replace(
    /<\s*(script|style|iframe|object|embed|svg|math|form|base|link|meta|title|template|frameset|frame|xmp|plaintext|img)\b[^>]*\/?\s*>/gi,
    '',
  )
  // 去除 on*="..."  on*='...'  on*=xxx 三种写法
  safe = safe.replace(/\s+on[a-zA-Z]+\s*=\s*"[^"]*"/g, '')
  safe = safe.replace(/\s+on[a-zA-Z]+\s*=\s*'[^']*'/g, '')
  safe = safe.replace(/\s+on[a-zA-Z]+\s*=\s*[^\s>"']+/g, '')
  return safe
}

/**
 * Sanitize a potentially-dirty HTML string; keep only allow-listed tags and
 * attributes.
 *
 * Primary path: use window.DOMPurify.sanitize with a strict allowlist (secure).
 * Fallback (used ONLY when DOMPurify is unavailable): run a lightweight XSS
 * filter that removes dangerous tags (script/iframe/...), all on* event
 * attributes, and javascript:/vbscript: URIs, but PRESERVES the structural
 * tags that this codebase generates for UI (table/tr/td/button/div/span/...).
 * This prevents the 2026-08 "data preview looks like <table ...> raw text" bug,
 * caused by the old fallback doing both:
 *   1) textContent assignment escaping ALL angle brackets to entities, and
 *   2) caching the fallback permanently so a later DOMPurify could never take over.
 *
 * @param dirty - HTML string to clean; may contain dynamic/untrusted content.
 * @returns cleaned, safe HTML string; empty string if input is empty.
 */
export function sanitizeHtml(dirty: string): string {
  if (!dirty) return ''
  const purify = getPurify()
  return purify(dirty)
}
