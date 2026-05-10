/**
 * 同步收藏模块（TypeScript 版）
 * @module sync/scraping
 */
export interface TokenVerifyResult {
    valid: boolean;
    userId: string;
    username: string;
    message: string;
}
export interface ApiResponse {
    status: number;
    data: any;
}
export interface BangumiUserData {
    id?: string | number;
    nickname?: string;
    username?: string;
}
/**
 * 异步验证 Token 有效性（增强版：检测过期）
 * @param {string} token - Access Token
 * @returns {Promise<TokenVerifyResult>}
 */
export declare function verifyToken(token: string): Promise<TokenVerifyResult>;
export declare function fetchAllUserCollections(token: string, userId?: string): Promise<unknown[]>;
//# sourceMappingURL=scraping.d.ts.map