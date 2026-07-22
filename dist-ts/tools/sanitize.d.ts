/**
 * @fileoverview HTML 清洗工具模块
 * @module tools/sanitize
 * @description 基于 DOMPurify 封装的 HTML 清洗函数。
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
 *
 * 白名单设计原则：
 *   - 包含项目内已使用的结构性 HTML 标签（div、span、p、a、br、b、i、em、strong、table、tr、td、button 等）
 *   - 包含项目内已使用的安全属性（class、id、style、href、data- 与 aria- 系列属性、role 等）
 *   - 不包含 `script`、`img`、`svg`、`iframe`、`object`、`embed`、`form` 等高危标签
 *   - 即使包含 `<a>`，DOMPurify 仍会剥离 `javascript:` 协议的 href
 *
 * 使用示例：
 *   ```ts
 *   body.textContent = '';
 *   body.insertAdjacentHTML('beforeend', sanitizeHtml(statsHtml + cardsHtml));
 *   ```
 */
/**
 * 清洗脏 HTML 字符串，仅保留白名单内的标签和属性
 *
 * @param dirty - 待清洗的 HTML 字符串，可能含动态/不可信内容
 * @returns 清洗后的安全 HTML 字符串；输入为空字符串时返回空字符串
 */
export declare function sanitizeHtml(dirty: string): string;
//# sourceMappingURL=sanitize.d.ts.map