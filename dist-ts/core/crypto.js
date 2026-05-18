/**
 * @fileoverview Token加密解密模块
 * @module core/crypto
 * @description 提供Bangumi API Token的安全加密存储功能。
 *              支持XOR加密（同步）和AES-GCM加密（异步）两种模式，
 *              以及Token完整性校验。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
import { TOKEN_CONFIG, } from './constants.js';
import { BGM, bgmLog, LOG_LEVELS } from '../index.js';
/**
 * 将字符串转换为UTF-8字节数组
 *
 * @function strToBytes
 * @param {string} str - 输入字符串
 * @returns {Uint8Array} UTF-8编码的字节数组
 *
 * @example
 * const bytes = strToBytes('hello');
 * console.log(bytes); // Uint8Array([104, 101, 108, 108, 111])
 */
function strToBytes(str) {
    // .slice() 确保返回的 Uint8Array 的 buffer 是 ArrayBuffer，而不是 SharedArrayBuffer
    return new TextEncoder().encode(str).slice();
}
/**
 * 将UTF-8字节数组转换回字符串
 *
 * @function bytesToStr
 * @param {Uint8Array} bytes - UTF-8编码的字节数组
 * @returns {string} 解码后的字符串
 *
 * @example
 * const bytes = new Uint8Array([104, 101, 108, 108, 111]);
 * const str = bytesToStr(bytes);
 * console.log(str); // 'hello'
 */
function bytesToStr(bytes) {
    return new TextDecoder().decode(bytes);
}
/**
 * 计算字符串的校验和
 * 用于验证Token数据的完整性
 *
 * @function calcChecksum
 * @param {string} input - 输入字符串
 * @returns {number} 0-255之间的校验和值
 *
 * @example
 * const checksum = calcChecksum('mytoken123');
 * console.log(checksum); // 某个0-255的数字
 */
export function calcChecksum(input) {
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
        sum = ((sum << 5) - sum + input.charCodeAt(i)) & 0xFF;
    }
    return Math.abs(sum) % 256;
}
/**
 * 构建Token Payload
 * 在Token前后添加版本前缀和校验和，生成完整的加密前数据
 *
 * @function buildPayload
 * @param {string} token - 原始Token字符串
 * @returns {string} 格式化的Payload字符串
 *
 * @description
 * Payload格式：{版本}:{校验和}:{Token}
 * 例如：1:123:mytoken123
 *
 * @example
 * const payload = buildPayload('mytoken123');
 * console.log(payload); // '1:123:mytoken123'
 */
export function buildPayload(token) {
    const checksum = calcChecksum(token);
    return `${TOKEN_CONFIG.VERSION}:${checksum}:${token}`;
}
/**
 * 从解密后的字符串中提取Token
 * 同时验证版本号和校验和的完整性
 *
 * @function extractToken
 * @param {string} encrypted - 解密后的字符串
 * @returns {string | null} 提取的Token，如果验证失败则返回null
 *
 * @example
 * const token = extractToken('1:123:mytoken123');
 * if (token) {
 *     console.log('Token有效:', token);
 * } else {
 *     console.log('Token无效');
 * }
 */
export function extractToken(encrypted) {
    try {
        const parts = encrypted.split(':');
        if (parts.length < 3) {
            bgmLog(LOG_LEVELS.WARN, '[crypto] Payload格式无效');
            return null;
        }
        const [version, checksumStr, ...tokenParts] = parts;
        const token = tokenParts.join(':');
        const checksum = parseInt(checksumStr, 10);
        if (version !== TOKEN_CONFIG.VERSION) {
            bgmLog(LOG_LEVELS.WARN, `[crypto] Token版本不匹配: ${version}`);
            return null;
        }
        const expectedChecksum = calcChecksum(token);
        if (checksum !== expectedChecksum) {
            bgmLog(LOG_LEVELS.WARN, '[crypto] Token校验和不匹配，可能已被篡改');
            return null;
        }
        return token;
    }
    catch (e) {
        BGM.handleError(e, { context: 'extractToken', showAlert: false });
        return null;
    }
}
/**
 * XOR加密Token
 * 使用简单的XOR运算对Token进行混淆
 *
 * @function encryptToken
 * @param {string} token - 原始Token字符串
 * @returns {string} Base64编码的加密字符串
 *
 * @description
 * 加密格式：{版本}.{IV}.{加密数据}
 * - 版本：1（表示使用XOR加密）
 * - IV：初始向量（Base64编码）
 * - 加密数据：XOR加密后的数据（Base64编码）
 *
 * @example
 * const encrypted = encryptToken('my-secret-token');
 * console.log(encrypted); // '1.abc123.xyz789'
 */
export function encryptToken(token) {
    const payload = buildPayload(token);
    const payloadBytes = strToBytes(payload);
    const keyBytes = strToBytes(TOKEN_CONFIG.XOR_KEY);
    // 生成随机IV
    const iv = new Uint8Array(16);
    crypto.getRandomValues(iv);
    // XOR加密
    const encrypted = new Uint8Array(payloadBytes.length);
    for (let i = 0; i < payloadBytes.length; i++) {
        encrypted[i] = payloadBytes[i] ^ keyBytes[i % keyBytes.length] ^ iv[i % iv.length];
    }
    // 返回格式：版本.IV.Base64(加密数据)
    const ivBase64 = btoa(String.fromCharCode(...iv));
    const encryptedBase64 = btoa(String.fromCharCode(...encrypted));
    return `${TOKEN_CONFIG.VERSION}.${ivBase64}.${encryptedBase64}`;
}
/**
 * 解密XOR加密的Token
 *
 * @function decryptToken
 * @param {string} encrypted - encryptToken生成的加密字符串
 * @returns {string | null} 解密后的Token，失败返回null
 *
 * @example
 * const encrypted = encryptToken('my-secret-token');
 * const decrypted = decryptToken(encrypted);
 * console.log(decrypted); // 'my-secret-token'
 */
export function decryptToken(encrypted) {
    try {
        const parts = encrypted.split('.');
        if (parts.length < 3) {
            bgmLog(LOG_LEVELS.WARN, '[crypto] 加密字符串格式无效');
            return null;
        }
        const [version, ivBase64, encryptedBase64] = parts;
        if (version !== TOKEN_CONFIG.VERSION) {
            bgmLog(LOG_LEVELS.WARN, `[crypto] 加密版本不匹配: ${version}`);
            return null;
        }
        // 解码Base64
        const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
        const encryptedData = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
        // XOR解密
        const keyBytes = strToBytes(TOKEN_CONFIG.XOR_KEY);
        const decrypted = new Uint8Array(encryptedData.length);
        for (let i = 0; i < encryptedData.length; i++) {
            decrypted[i] = encryptedData[i] ^ keyBytes[i % keyBytes.length] ^ iv[i % iv.length];
        }
        const payload = bytesToStr(decrypted);
        return extractToken(payload);
    }
    catch (e) {
        BGM.handleError(e, { context: 'decryptToken', showAlert: false });
        return null;
    }
}
