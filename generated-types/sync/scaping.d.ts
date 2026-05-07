/**
 * 同步收藏模块（TypeScript 版）
 * @module sync/scraping
 * @description 从 Bangumi API 获取收藏列表、Token 验证
 */
import { TokenVerifyResult } from '../tools/index.js';
export declare function verifyToken(token: string): Promise<TokenVerifyResult>;
export declare function fetchAllUserCollections(token: string, userId?: string): Promise<unknown[]>;
//# sourceMappingURL=scaping.d.ts.map