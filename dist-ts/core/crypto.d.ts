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
export declare function calcChecksum(input: string): number;
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
export declare function buildPayload(token: string): string;
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
export declare function extractToken(encrypted: string): string | null;
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
export declare function encryptToken(token: string): string;
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
export declare function decryptToken(encrypted: string): string | null;
/**
 * 使用AES-GCM异步加密Token（更安全的加密方式）
 *
 * @async
 * @function encryptTokenAsync
 * @param {string} token - 原始Token字符串
 * @returns {Promise<string>} Base64编码的加密字符串
 *
 * @description
 * AES-GCM是AEAD加密模式，同时提供加密和完整性验证。
 * 比XOR加密更安全，推荐在支持Web Crypto API的环境使用。
 *
 * @example
 * const encrypted = await encryptTokenAsync('my-secret-token');
 * console.log(encrypted); // '2.abc123.xyz789'
 */
export declare function encryptTokenAsync(token: string): Promise<string>;
/**
 * 异步解密AES-GCM加密的Token
 *
 * @async
 * @function decryptTokenAsync
 * @param {string} encrypted - encryptTokenAsync生成的加密字符串
 * @returns {Promise<string | null>} 解密后的Token，失败返回null
 *
 * @example
 * const encrypted = await encryptTokenAsync('my-secret-token');
 * const decrypted = await decryptTokenAsync(encrypted);
 * console.log(decrypted); // 'my-secret-token'
 */
export declare function decryptTokenAsync(encrypted: string): Promise<string | null>;
//# sourceMappingURL=crypto.d.ts.map