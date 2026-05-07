/**
 * 异步验证 Token 有效性
 * @param {string} token
 * @returns {Promise<{ valid: boolean, userId: string, username: string, message: string }>}
 */
export function verifyToken(token: string): Promise<{
    valid: boolean;
    userId: string;
    username: string;
    message: string;
}>;
/**
 * 异步获取用户所有类型收藏（主函数）
 * @param {string} token - Access Token
 * @param {string} [userId] - 用户 ID，若未提供则从 Token 自动获取
 * @returns {Promise<Array>} 收藏条目数组
 */
export function fetchAllUserCollections(token: string, userId?: string): Promise<any[]>;
//# sourceMappingURL=scraping.d.ts.map