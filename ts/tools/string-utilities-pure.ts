/**
 * @fileoverview 字符串工具纯函数模块（零依赖）
 * @module tools/string-utilities-pure
 * @description 提供 Excel 列号转换、字符串修剪、HTML 转义等纯函数。
 *
 * 本模块刻意保持零项目依赖（不引入 core/crypto、tools/util、ui/handlers 等模块），
 * 以便单元测试可以直接 import 而不触发 handlers.ts 中的 setTimeout / addEventListener
 * 等副作用（副作用链：string-utilities → crypto → index → handlers）。
 *
 * 注意：escapeHtml 依赖浏览器 DOM API（document.createElement），需要在 jsdom 环境
 * 下运行；在纯 Node 环境下调用会抛 ReferenceError。colNumberToLetter 与 trim 无环境依赖。
 *
 * 历史背景：原 string-utilities.ts 同时导出 colNumberToLetter / escapeHtml / trim / calcFingerprint，
 * 其中 calcFingerprint 依赖 core/crypto.calcChecksum，而 crypto.ts 又 import 自 index.ts，
 * 触发整条副作用链。为支持纯函数单元测试，将无依赖的三个函数抽取到本模块。
 */

/**
 * 列号转字母 (A, B, ..., Z, AA, AB, ...)
 *
 * @param col - 列号（1-based）
 * @returns 对应的字母表示；col <= 0 时返回空字符串
 */
export function colNumberToLetter(col: number): string {
  let letter = ''
  while (col > 0) {
    const module_ = (col - 1) % 26
    letter = String.fromCharCode(65 + module_) + letter
    col = Math.floor((col - module_) / 26)
  }
  return letter
}

/**
 * HTML 转义（防止 XSS）
 *
 * 安全模式：创建临时 div，设 textContent（浏览器自动转义 `<`, `>`, `&`），
 * 读 innerHTML 获取已转义字符串。再手动补齐双引号 `"` 和单引号 `'` 转义，
 * 以便安全地插入到 HTML 属性值（如 `value="..."`、`href="..."`）中。
 *
 * 转义字符表：`< > " ' &` 共 5 个字符。
 *
 * @param text - 待转义的字符串，可为 null/undefined
 * @returns 转义后的 HTML 安全字符串；输入为空值时返回空字符串
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return ''
  const div = document.createElement('div')
  div.textContent = text
  // textContent → innerHTML 已转义 & < >；补齐引号转义以安全用于属性值上下文
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * 字符串去除首尾空格
 *
 * @param string_ - 待修剪的字符串，可为 null/undefined
 * @returns 修剪后的字符串；输入为空值时返回空字符串
 */
export function trim(string_: string | null | undefined): string {
  if (!string_) return ''
  return string_.replace(/^\s+|\s+$/g, '')
}
