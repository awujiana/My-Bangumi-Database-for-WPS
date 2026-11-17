/**
 * @fileoverview 测试环境保真：默认注入真实 DOMPurify
 *
 * @description
 * 背景（2026-09 审查发现的生产缺陷，见 文档/TS_AUDIT_2026_09_10.md 的 P0-1 / P0-2）：
 *
 *   所有任务窗格页面（`ui/*.html`、`index.html`）都会先加载 `libs/purify.js`
 *   （DOMPurify UMD，挂到 `globalThis.DOMPurify`），因此**生产环境**里
 *   `sanitizeHtml()` 永远走 DOMPurify 严格白名单路径。
 *
 *   但 jsdom 测试环境默认**没有** DOMPurify，`sanitizeHtml()` 会走
 *   `createLightweightFallback()` 降级路径。两条路径对属性/标签的处理并不等价
 *   （降级路径保留所有 `data-*`，严格白名单只保留 `ALLOWED_ATTR` 里登记的项），
 *   于是出现过「1835 条测试全绿，但进度组件、清理页勾选、富化页批量删除在真机全部
 *   静默失效」这种系统性隐身缺陷。
 *
 * 本文件通过 vitest 的 `setupFiles` 在**每个测试文件**开始时注入真实 DOMPurify
 * （复用 `node_modules/dompurify`，与 `libs/purify.js` 保持同版本，由
 * `npm run check:dompurify-version` 校验一致性），使单测默认走与生产一致的真实路径。
 *
 * ⚠️ 需要验证**降级路径**的用例，必须显式声明（反转默认，把特殊路径变成显式意图）：
 *
 * ```ts
 * import { resetSanitizerCache } from '../ts/tools/sanitize.js'
 *
 * beforeEach(() => {
 *   delete (globalThis as { DOMPurify?: unknown }).DOMPurify
 *   // ⚠️ 必须重置缓存：sanitize.ts 会缓存已探测到的 DOMPurify 工厂，
 *   //    只删全局变量不足以切回降级路径
 *   resetSanitizerCache()
 * })
 * ```
 *
 * 非 jsdom 环境（`environment: 'node'`）下没有 `document`，DOMPurify 无法工作，
 * 此时不注入，保持原有的正则粗过滤兜底行为。
 */

import DOMPurify from 'dompurify'

/** DOMPurify 挂到 globalThis 后的形状（与 ts/tools/sanitize.ts 的检测口径一致） */
interface PurifyGlobal {
  DOMPurify?: typeof DOMPurify
}

// 仅在具备 DOM 的测试环境注入（DOMPurify 依赖真实 DOM 才能工作）
if (typeof document !== 'undefined') {
  const host = globalThis as PurifyGlobal
  host.DOMPurify = DOMPurify
}
