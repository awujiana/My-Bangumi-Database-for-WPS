/**
 * BGM 项目加密模块
 * @module crypto
 * @description Token 加密解密功能，使用 Web Crypto API AES-GCM
 */

import { TOKEN_CONFIG } from './constants.js';

// ========== 内部工具函数 ==========

/**
 * 字符串转 Uint8Array
 */
function stringToUint8Array(str) {
    return new TextEncoder().encode(str);
}

/**
 * Uint8Array 转 Base64
 */
function uint8ArrayToBase64(arr) {
    return btoa(String.fromCharCode.apply(null, arr));
}

/**
 * Base64 转 Uint8Array
 */
function base64ToUint8Array(base64) {
    let binary = atob(base64);
    let arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        arr[i] = binary.charCodeAt(i);
    }
    return arr;
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
 * 导入 AES 密钥
 */
async function importAesKey(keyBytes) {
    const keyData = new Uint8Array(keyBytes);
    return await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * 备用 XOR 加密
 */
function fallbackXor(dataBytes, keys, iv) {
    let result = [];
    for (let i = 0; i < dataBytes.length; i++) {
        let keyByte = keys[i % keys.length];
        let ivByte = iv[i % iv.length];
        result.push(dataBytes[i] ^ keyByte ^ ivByte);
    }
    return result;
}

// ========== Token 加密（Web Crypto API AES-GCM）==========

/**
 * 异步加密 Token（使用 Web Crypto API）
 */
export async function encryptTokenAsync(token) {
    if (!token) return "";
    
    try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const version = TOKEN_CONFIG.VERSION;
        const checksum = calcChecksum(token);
        const data = version + checksum.toString().padStart(4, '0') + ":" + token;
        const dataBytes = stringToUint8Array(data);
        
        const key = await importAesKey(TOKEN_CONFIG.KEY_BYTES);
        const encrypted = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            dataBytes
        );
        
        const encryptedArr = new Uint8Array(encrypted);
        return uint8ArrayToBase64(iv) + "." + uint8ArrayToBase64(encryptedArr);
    } catch (e) {
        console.error("Token encryption failed:", e);
        return "";
    }
}

/**
 * 异步解密 Token（使用 Web Crypto API）
 */
export async function decryptTokenAsync(encoded) {
    if (!encoded) return null;
    
    try {
        const parts = encoded.split(".");
        if (parts.length !== 2) return null;
        
        const iv = base64ToUint8Array(parts[0]);
        const encryptedData = base64ToUint8Array(parts[1]);
        const version = TOKEN_CONFIG.VERSION;
        
        const key = await importAesKey(TOKEN_CONFIG.KEY_BYTES);
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encryptedData
        );
        
        const decryptedStr = new TextDecoder().decode(decrypted);
        
        if (!decryptedStr.startsWith(version)) {
            throw new Error("Invalid version");
        }
        
        const data = decryptedStr.substring(version.length);
        const colonIdx = data.indexOf(':');
        const storedChecksum = data.substring(0, colonIdx);
        const token = data.substring(colonIdx + 1);
        
        const calcSum = calcChecksum(token);
        if (storedChecksum !== calcSum.toString().padStart(4, '0')) {
            throw new Error("Checksum mismatch");
        }
        
        return token;
    } catch (e) {
        console.error("Token decryption failed:", e);
        return null;
    }
}

/**
 * 遗留 XOR 加密（兼容旧格式）
 */
export function encryptTokenLegacy(token) {
    if (!token) return "";
    
    try {
        const iv = Array.from(crypto.getRandomValues(new Uint8Array(8)));
        const version = TOKEN_CONFIG.VERSION;
        const data = version + calcChecksum(token).toString().padStart(4, '0') + ":" + token;
        const dataBytes = Array.from(stringToUint8Array(data));
        const encrypted = fallbackXor(dataBytes, TOKEN_CONFIG.FALLBACK_KEYS, iv);
        return "1:" + uint8ArrayToBase64(new Uint8Array(iv)) + "." + uint8ArrayToBase64(new Uint8Array(encrypted));
    } catch (e) {
        console.error("Legacy token encryption failed");
        return "";
    }
}

/**
 * 遗留解密（兼容旧格式）
 */
export function decryptTokenLegacy(encoded) {
    if (!encoded) return null;
    
    try {
        // 去掉版本前缀
        if (encoded.startsWith("1:") || encoded.startsWith("2:")) {
            encoded = encoded.substring(2);
        }
        
        const parts = encoded.split(".");
        if (parts.length !== 2) return null;
        
        const iv = Array.from(base64ToUint8Array(parts[0]));
        const encrypted = Array.from(base64ToUint8Array(parts[1]));
        const decrypted = fallbackXor(encrypted, TOKEN_CONFIG.FALLBACK_KEYS, iv);
        
        let str = "";
        for (let i = 0; i < decrypted.length; i++) {
            str += String.fromCharCode(decrypted[i]);
        }
        
        const version = TOKEN_CONFIG.VERSION;
        if (!str.startsWith(version)) {
            return null;
        }
        
        const data = str.substring(version.length);
        const colonIdx = data.indexOf(':');
        const storedChecksum = data.substring(0, colonIdx);
        const token = data.substring(colonIdx + 1);
        
        const calcSum = calcChecksum(token);
        if (storedChecksum !== calcSum.toString().padStart(4, '0')) {
            return null;
        }
        
        return token;
    } catch (e) {
        console.error("Legacy token decryption failed:", e);
        return null;
    }
}

// ========== 统一加密/解密接口（同步）==========

/**
 * 加密 Token
 * @param {string} token - 要加密的 Token
 * @returns {string} 加密后的字符串
 */
export function encryptToken(token) {
    if (!token) return "";
    
    // 优先使用 Web Crypto API
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        return encryptTokenLegacy(token);
    }
    
    // 回退到 XOR 加密
    return encryptTokenLegacy(token);
}

/**
 * 解密 Token
 * @param {string} encoded - 加密的字符串
 * @returns {string|null} 解密后的 Token 或 null
 */
export function decryptToken(encoded) {
    if (!encoded) return null;
    
    // 检查是否是新格式
    if (encoded.includes('.')) {
        return decryptTokenLegacy(encoded);
    }
    
    // 兼容旧格式
    return decryptTokenLegacy(encoded);
}
