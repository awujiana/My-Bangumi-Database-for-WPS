/**
 * @fileoverview Bangumi数据拉取模块
 * @module sync/scraping
 * @description 从Bangumi API获取用户收藏数据并同步到Excel的工作逻辑。
 *              支持Token验证、收藏列表获取等功能。
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
/**
 * Token验证结果接口
 *
 * @interface TokenVerifyResult
 */
export interface TokenVerifyResult {
    /** 验证是否通过 */
    valid: boolean;
    /** 验证消息 */
    message: string;
    /** 用户ID（如果验证成功） */
    userId?: string;
    /** 用户名（如果验证成功） */
    username?: string;
}
/**
 * Bangumi用户数据接口
 *
 * @interface BangumiUserData
 */
export interface BangumiUserData {
    /** 用户ID */
    id: number;
    /** 用户名 */
    username: string;
    /** 昵称 */
    nickname?: string;
    /** 头像URL */
    avatar?: {
        /** 大头像 */
        large: string;
        /** 中头像 */
        medium: string;
        /** 小头像 */
        small: string;
    };
}
/**
 * API响应结构接口
 *
 * @interface ApiResponse
 */
export interface ApiResponse<T = any> {
    /** 响应数据 */
    data: T | null;
    /** HTTP状态码 */
    status: number;
    /** 响应消息 */
    message: string;
}
/**
 * 验证Bangumi API Token的有效性
 *
 * @async
 * @function verifyToken
 * @param {string} token - 待验证的API Token
 * @returns {Promise<TokenVerifyResult>} 验证结果
 *
 * @description
 * 通过调用 /v0/me 接口验证Token是否有效。
 * 如果Token有效，会自动更新缓存中的用户信息。
 *
 * @example
 * const result = await verifyToken('your-token-here');
 * if (result.valid) {
 *     console.log(`欢迎，${result.username}！`);
 * }
 */
export declare function verifyToken(token: string): Promise<TokenVerifyResult>;
/**
 * 获取用户的收藏列表
 *
 * @async
 * @function fetchAllUserCollections
 * @param {string} token - API Token
 * @param {string} [userId] - 用户ID（可选，不提供则从Token自动获取）
 * @param {Object} [options] - 可选参数
 * @param {number} [options.limit=30] - 每页数量
 * @param {number} [options.maxTotal=1000] - 最大获取数量
 * @param {Function} [options.onProgress] - 进度回调
 * @returns {Promise<any[]>} 收藏列表
 *
 * @description
 * 从Bangumi API获取用户的收藏列表，支持自动分页。
 * 默认最多获取1000条记录，每页30条。
 *
 * @example
 * const collections = await fetchAllUserCollections(token, '123456', {
 *     onProgress: (page, total) => console.log(`获取第${page}页，共${total}页`)
 * });
 * console.log(`共获取 ${collections.length} 条收藏`);
 */
export declare function fetchAllUserCollections(token: string, userId?: string, options?: {
    limit?: number;
    maxTotal?: number;
    onProgress?: (page: number, total: number) => void;
}): Promise<any[]>;
/**
 * 获取单个条目的收藏状态
 *
 * @async
 * @function fetchSubjectCollection
 * @param {string} token - API Token
 * @param {string} subjectId - 条目ID
 * @returns {Promise<ApiResponse>} API响应
 *
 * @description
 * 获取当前用户对特定条目的收藏状态
 *
 * @example
 * const result = await fetchSubjectCollection(token, '123456');
 * if (result.data) {
 *     console.log(`当前状态: ${result.data.type}`);
 * }
 */
export declare function fetchSubjectCollection(token: string, subjectId: string): Promise<ApiResponse>;
//# sourceMappingURL=scraping.d.ts.map