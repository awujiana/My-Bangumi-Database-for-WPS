/**
 * @fileoverview 字符串工具函数模块
 * @module tools/stringUtils
 * @description 提供 Excel 列号转换、字符串修剪、HTML 转义、指纹计算等纯函数。
 *              这些函数不依赖 WPS API，可独立测试。
 *              注意：calcFingerprint 依赖 core/crypto 中的 calcChecksum（纯算术函数），
 *              会随 util.ts 一同进入已有的循环依赖链（util → crypto → index → util），
 *              由于均为 hoisted 的 function 声明，运行时安全。
 */
import { calcChecksum } from '../core/crypto.js';
/**
 * 列号转字母 (A, B, ..., Z, AA, AB, ...)
 *
 * @param col - 列号（1-based）
 * @returns 对应的字母表示
 */
export function colNumToLetter(col) {
    let letter = "";
    while (col > 0) {
        const mod = (col - 1) % 26;
        letter = String.fromCharCode(65 + mod) + letter;
        col = Math.floor((col - mod) / 26);
    }
    return letter;
}
/**
 * HTML 转义（防止 XSS）
 *
 * @param text - 待转义的字符串，可为 null/undefined
 * @returns 转义后的 HTML 安全字符串
 */
export function escapeHtml(text) {
    if (!text)
        return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
/**
 * 字符串去除首尾空格
 *
 * @param str - 待修剪的字符串，可为 null/undefined
 * @returns 修剪后的字符串；输入为空值时返回空字符串
 */
export function trim(str) {
    if (!str)
        return "";
    return String(str).replace(/^\s+|\s+$/g, "");
}
/**
 * 计算 Excel 行数据的指纹（用于增量同步比较）
 *
 * @param fields - 关键字段值数组，如 [name, type, rate, tags, comment]
 * @returns 指纹字符串（16 进制校验和，左侧补零至 4 位）
 */
export function calcFingerprint(fields) {
    const raw = fields.join('|');
    // 复用已有的 calcChecksum 生成简短校验和，或直接返回原始字符串前 50 字符
    return calcChecksum(raw).toString(16).padStart(4, '0');
}
