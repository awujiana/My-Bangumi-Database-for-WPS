/**
 * @fileoverview Token 校验与完整性验证模块
 * @module core/crypto
 * @description 提供 Token 校验和计算、Payload 构建与提取功能，用于验证 Token 完整性。
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
//# sourceMappingURL=crypto.d.ts.map