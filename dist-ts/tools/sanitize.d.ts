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
export declare function sanitizeHtml(dirty: string): string;
//# sourceMappingURL=sanitize.d.ts.map