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
/**
 * Sanitize a potentially-dirty HTML string; keep only allow-listed tags and
 * attributes.
 *
 * Primary path: use window.DOMPurify.sanitize with a strict allowlist (secure).
 * Fallback (used ONLY when DOMPurify is unavailable): run a lightweight XSS
 * filter that removes dangerous tags (script/iframe/...), all on* event
 * attributes, and JavaScript:/VBScript: URIs, but PRESERVES the structural
 * tags that this codebase generates for UI (table/tr/td/button/div/span/...).
 * This prevents the 2026-08 "data preview looks like <table ...> raw text" bug,
 * caused by the old fallback doing both:
 *   1) textContent assignment escaping ALL angle brackets to entities, and
 *   2) caching the fallback permanently so a later DOMPurify could never take over.
 *
 * @param dirty - HTML string to clean; may contain dynamic/untrusted content.
 * @returns cleaned, safe HTML string; empty string if input is empty.
 */
export declare function sanitizeHtml(dirty: string): string;
/**
 * 重置「DOMPurify 工厂 / 降级实现」的探测缓存。
 *
 * 生产环境无需调用：`getPurify()` 每次调用都会重新探测 `globalThis.DOMPurify`
 * 是否就绪，迟加载的 DOMPurify 会自动接管。
 *
 * 存在的意义是**测试**：单测需要在「有 DOMPurify（生产路径）」与
 * 「无 DOMPurify（降级路径）」之间切换，而工厂一旦缓存，仅删除全局变量
 * 不会切回降级实现（`_cachedDomPurifyFactory` 仍然命中）。
 *
 * @see tests/setup/dompurify.ts 测试环境的默认注入与降级路径写法
 */
export declare function resetSanitizerCache(): void;
/**
 * 清洗「表格行片段」（如 `<tr>...</tr>`）并保留 tr/td/th 结构。
 *
 * 背景（2026-09 匹配结果/新番表预览「样式不是表格」bug）：
 *   DOMPurify 主路径用 DOMParser 以完整文档上下文解析，顶层裸 `<tr>`/`<td>`/`<th>`
 *   会被 HTML 解析器按规范剥离标签只保留内容；fallback 路径用 `div.innerHTML`
 *   同样剥离。`tbody.innerHTML = sanitizeHtml(rowsHtml)` 场景下表格结构全部丢失。
 *
 * 处理方式：把行片段包进 `<table><tbody>…</tbody></table>` 完整表格上下文清洗
 * （tr/td/th 正常保留，动态内容仍全程消毒），再从清洗结果中提取 tbody 内部 HTML。
 * 安全性与 sanitizeHtml 等价：输出取自消毒后 DOM 的序列化片段。
 */
export declare function sanitizeTableRows(dirty: string): string;
//# sourceMappingURL=sanitize.d.ts.map