/**
 * @fileoverview Token Payload 打包与完整性校验模块
 * @module core/token-payload
 *
 * @description
 * 提供 Token 校验和计算、Payload 构建与提取功能。
 *
 * ⚠️ **本模块不提供任何加密/保密能力，不要把它当作安全边界。**
 *
 * 实际行为：`buildPayload()` 把 Token 以**近似明文**形式拼成
 * `{版本}:{校验和}:{Token}`（例如 `1:123:mytoken123`），Token 本身原样可见；
 * `calcChecksum()` 是 8 位（0-255）循环校验和，**可被轻易伪造**，只用于发现
 * 手写/截断导致的意外损坏，不防篡改、不防伪造。
 *
 * 历史命名：本文件原名为 `core/crypto.ts`，且注释中出现过「加密前数据」「解密后」
 * 「XOR_KEY」等措辞，均已随 2026-09 审查一并更正 —— 那些措辞描述的是一个
 * 从未存在过的加密层，会误导后续维护者对凭据安全等级的判断。
 *
 * 若将来确实需要保护 Token 落盘安全，应使用 WebCrypto（`crypto.subtle`）做
 * AES-GCM，并单独设计每机密钥的存放与轮换策略，而不是在本模块上加壳。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
import { bgmLog } from '../tools/util/index.js';
import { LOG_LEVELS, TOKEN_CONFIG } from './constants.js';
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
    for (let index = 0; index < input.length; index += 1) {
        sum = ((sum << 5) - sum + (input.codePointAt(index) ?? 0)) & 0xff;
    }
    return Math.abs(sum) % 256;
}
/**
 * 构建Token Payload
 * 在 Token 前后添加版本前缀和校验和（**不是加密**，Token 仍为明文可见）
 *
 * @function buildPayload
 * @param {string} token - 原始Token字符串
 * @returns {string} 格式化的Payload字符串
 *
 * @description
 * Payload 格式：{版本}:{校验和}:{Token}（Token 原样明文）
 * 例如：1:123:mytoken123
 *
 * @example
 * const payload = buildPayload('mytoken123');
 * console.log(payload); // '1:123:mytoken123'
 */
export function buildPayload(token) {
    const checksum = calcChecksum(token);
    return `${TOKEN_CONFIG.VERSION}:${String(checksum)}:${token}`;
}
/**
 * 从 Payload 字符串中提取 Token
 * 同时验证版本号和校验和（仅能发现意外损坏，不能防伪造）
 *
 * @function extractToken
 * @param {string} payload - `版本:校验和:Token` 形式的字符串
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
export function extractToken(payload) {
    try {
        const parts = payload.split(':');
        if (parts.length < 3) {
            bgmLog(LOG_LEVELS.WARN, '[token-payload] Payload格式无效');
            return null;
        }
        const [version, checksumString, ...tokenParts] = parts;
        if (version !== TOKEN_CONFIG.VERSION) {
            bgmLog(LOG_LEVELS.WARN, `[token-payload] Token版本不匹配: ${version ?? ''}`);
            return null;
        }
        const token = tokenParts.join(':');
        const checksum = checksumString ? Number(checksumString) : NaN;
        const expectedChecksum = calcChecksum(token);
        if (checksum !== expectedChecksum) {
            bgmLog(LOG_LEVELS.WARN, '[token-payload] Token校验和不匹配，可能已被篡改');
            return null;
        }
        return token;
    }
    catch (error) {
        bgmLog(LOG_LEVELS.ERROR, `[token-payload] extractToken 异常: ${error.message}`);
        return null;
    }
}
