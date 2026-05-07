/**
 * BGM Token 加密模块（优化版）
 * @module crypto
 * @description Token 加密解密功能，使用 XOR 混淆 + 校验和
 *              注意：这是简单的混淆，不是真正的加密，仅用于防止明文存储
 */
/**
 * 计算校验和
 */
export declare function calcChecksum(str: string): number;
/**
 * 从解密字符串中提取 Token（版本校验 + 校验和检查）
 * @param decryptedStr - 解密后的原始字符串
 * @returns 提取的 token，校验失败返回 null
 */
export declare function extractToken(decryptedStr: string): string | null;
/**
 * 构建要加密的数据串（版本 + 校验和 + token）
 */
export declare function buildPayload(token: string): string;
/**
 * 同步加密 Token
 * @param token
 * @returns 加密字符串（格式：1:iv.base64.encrypted.base64）
 */
export declare function encryptToken(token: string): string;
/**
 * 同步解密 Token
 * @param encoded
 * @returns
 */
export declare function decryptToken(encoded: string): string | null;
/**
 * 异步加密 Token（使用 AES-GCM）
 */
export declare function encryptTokenAsync(token: string): Promise<string>;
/**
 * 异步解密 Token（AES-GCM）
 */
export declare function decryptTokenAsync(encoded: string): Promise<string | null>;
//# sourceMappingURL=crypto.d.ts.map