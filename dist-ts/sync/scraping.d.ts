/**
 * 同步收藏模块（TypeScript 版）
 * @module sync/scraping
 */
export declare function verifyToken(token: string): Promise<{
    valid: boolean;
    userId: string;
    username: string;
    message: string;
}>;
export declare function fetchAllUserCollections(token: string, userId?: string): Promise<unknown[]>;
//# sourceMappingURL=scraping.d.ts.map