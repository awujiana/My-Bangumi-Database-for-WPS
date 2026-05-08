/**
 * BGM Token 加密模块（优化版）
 * @module crypto
 * @description Token 加密解密功能，使用 XOR 混淆 + 校验和
 *              注意：这是简单的混淆，不是真正的加密，仅用于防止明文存储
 */
import { TOKEN_CONFIG } from '../core/constants.js';
// ========== 内部工具 ==========
function stringToBytes(str) {
    return new TextEncoder().encode(str);
}
function bytesToBase64(bytes) {
    return btoa(String.fromCharCode(...bytes));
}
function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
/**
 * 计算校验和
 */
export function calcChecksum(str) {
    let sum = 0;
    for (let i = 0; i < str.length; i++) {
        sum = ((sum << 5) - sum + str.charCodeAt(i)) & 0xFFFFFFFF;
    }
    return Math.abs(sum) % 10000;
}
/**
 * 从解密字符串中提取 Token（版本校验 + 校验和检查）
 * @param decryptedStr - 解密后的原始字符串
 * @returns 提取的 token，校验失败返回 null
 */
export function extractToken(decryptedStr) {
    const version = TOKEN_CONFIG.VERSION;
    if (!decryptedStr.startsWith(version)) {
        return null;
    }
    const data = decryptedStr.substring(version.length);
    const colonIdx = data.indexOf(':');
    if (colonIdx === -1)
        return null;
    const storedChecksum = data.substring(0, colonIdx);
    const token = data.substring(colonIdx + 1);
    const calculated = calcChecksum(token).toString().padStart(4, '0');
    return storedChecksum === calculated ? token : null;
}
/**
 * 构建要加密的数据串（版本 + 校验和 + token）
 */
export function buildPayload(token) {
    const version = TOKEN_CONFIG.VERSION;
    const checksum = calcChecksum(token).toString().padStart(4, '0');
    return version + checksum + ':' + token;
}
function xorEncrypt(dataBytes) {
    const keys = TOKEN_CONFIG.FALLBACK_KEYS;
    const iv = new Uint8Array(8);
    crypto.getRandomValues(iv);
    const encrypted = [];
    for (let i = 0; i < dataBytes.length; i++) {
        encrypted.push(dataBytes[i] ^ keys[i % keys.length] ^ iv[i % iv.length]);
    }
    return { iv, encrypted: new Uint8Array(encrypted) };
}
function xorDecrypt(encryptedBytes, ivBytes) {
    const keys = TOKEN_CONFIG.FALLBACK_KEYS;
    const decrypted = [];
    for (let i = 0; i < encryptedBytes.length; i++) {
        decrypted.push(encryptedBytes[i] ^ keys[i % keys.length] ^ ivBytes[i % ivBytes.length]);
    }
    return new TextDecoder().decode(new Uint8Array(decrypted));
}
// ========== 公开 API：同步加密/解密（XOR，始终可用） ==========
/**
 * 同步加密 Token
 * @param token
 * @returns 加密字符串（格式：1:iv.base64.encrypted.base64）
 */
export function encryptToken(token) {
    if (!token)
        return '';
    try {
        const payload = buildPayload(token);
        const payloadBytes = stringToBytes(payload);
        const { iv, encrypted } = xorEncrypt(payloadBytes);
        return '1:' + bytesToBase64(iv) + '.' + bytesToBase64(encrypted);
    }
    catch (e) {
        console.error('Token encryption failed:', e);
        return '';
    }
}
/**
 * 同步解密 Token
 * @param encoded
 * @returns
 */
export function decryptToken(encoded) {
    if (!encoded)
        return null;
    try {
        // 移除版本前缀（'1:' 或 '2:' 等）
        const prefixEnd = encoded.indexOf(':');
        if (prefixEnd === -1)
            return null;
        const dataPart = encoded.substring(prefixEnd + 1);
        const parts = dataPart.split('.');
        if (parts.length !== 2)
            return null;
        const iv = base64ToBytes(parts[0]);
        const encrypted = base64ToBytes(parts[1]);
        const decrypted = xorDecrypt(encrypted, iv);
        return extractToken(decrypted);
    }
    catch (e) {
        console.error('Token decryption failed:', e);
        return null;
    }
}
// ========== 异步 Web Crypto 加密/解密（可选，提供更强保护） ==========
async function importAesKey() {
    const keyData = new Uint8Array(TOKEN_CONFIG.KEY_BYTES);
    return await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
/**
 * 异步加密 Token（使用 AES-GCM）
 */
export async function encryptTokenAsync(token) {
    if (!token)
        return '';
    try {
        const payload = buildPayload(token);
        const payloadBytes = stringToBytes(payload);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await importAesKey();
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.slice().buffer }, key, payloadBytes.slice().buffer);
        return bytesToBase64(new Uint8Array(iv)) + '.' + bytesToBase64(new Uint8Array(encrypted));
    }
    catch (e) {
        console.error('Async token encryption failed:', e);
        return '';
    }
}
/**
 * 异步解密 Token（AES-GCM）
 */
export async function decryptTokenAsync(encoded) {
    if (!encoded)
        return null;
    try {
        const parts = encoded.split('.');
        if (parts.length !== 2)
            return null;
        const iv = base64ToBytes(parts[0]);
        const encrypted = base64ToBytes(parts[1]);
        const key = await importAesKey();
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv.slice().buffer }, key, encrypted.slice().buffer);
        const decryptedStr = new TextDecoder().decode(decrypted);
        return extractToken(decryptedStr);
    }
    catch (e) {
        console.error('Async token decryption failed:', e);
        return null;
    }
}
