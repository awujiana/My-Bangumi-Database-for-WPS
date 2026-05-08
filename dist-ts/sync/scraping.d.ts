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
export declare function verifyToken(token: string): Promise<{
    valid: boolean;
    userId: string;
    username: string;
    message: string;
}>;
export declare function fetchAllUserCollections(token: string, userId?: string): Promise<unknown[]>;
//# sourceMappingURL=scraping.d.ts.map