/**
 * 加密模块类型定义
 */

/**
 * 计算字符串校验和
 */
export function calcChecksum(str: string): number;

/**
 * 异步加密 Token（使用 Web Crypto API）
 */
export function encryptTokenAsync(token: string): Promise<string>;

/**
 * 异步解密 Token（使用 Web Crypto API）
 */
export function decryptTokenAsync(encoded: string): Promise<string | null>;

/**
 * 遗留 XOR 加密（兼容旧格式）
 */
export function encryptTokenLegacy(token: string): string;

/**
 * 遗留解密（兼容旧格式）
 */
export function decryptTokenLegacy(encoded: string): string | null;

/**
 * 加密 Token
 */
export function encryptToken(token: string): string;

/**
 * 解密 Token
 */
export function decryptToken(encoded: string): string | null;
