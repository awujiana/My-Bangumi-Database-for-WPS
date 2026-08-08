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
// 懒加载 DOMPurify：优先取 window.DOMPurify（wpsjs debug 模式），
// 若不存在则降级为纯文本清洗（剥离所有标签），保证模块加载永不阻塞。
let _purify = null;
function getPurify() {
    if (_purify)
        return _purify;
    const w = globalThis;
    if (w.DOMPurify && typeof w.DOMPurify.sanitize === 'function') {
        const factory = w.DOMPurify;
        _purify = (dirty) => factory.sanitize(dirty, {
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
        });
        return _purify;
    }
    // 兜底：纯文本模式，剥离所有 HTML 标签（宁可保守也不注入）
    _purify = (dirty) => {
        if (typeof dirty !== 'string' || !dirty)
            return '';
        // 用 DOMParser 在安全上下文中剥标签（比正则更可靠）
        try {
            if (typeof document !== 'undefined') {
                const tmp = document.createElement('div');
                tmp.textContent = dirty;
                return tmp.innerHTML;
            }
        }
        catch {
            /* ignore */
        }
        return dirty.replace(/<[^>]*>/g, '');
    };
    return _purify;
}
/**
 * 清洗脏 HTML 字符串，仅保留白名单内的标签和属性。
 * 若 DOMPurify 未加载（如 <script src="./libs/purify.js"> 缺失），则安全降级为纯文本（剥离所有标签）。
 *
 * @param dirty - 待清洗的 HTML 字符串，可能含动态/不可信内容
 * @returns 清洗后的安全 HTML 字符串；输入为空字符串时返回空字符串
 */
export function sanitizeHtml(dirty) {
    if (!dirty)
        return '';
    const purify = getPurify();
    return purify(dirty);
}
