/**
 * @fileoverview Bangumi数据拉取模块
 * @module sync/scraping
 * @description 从Bangumi API获取用户收藏数据并同步到Excel的工作逻辑。
 *              支持Token验证、收藏列表获取等功能。
 *
 * @author BGM Development Team
 * @version 1.1.0 (优化版)
 */
/**
 * Token验证结果接口
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
 */
export interface BangumiUserData {
    id: number;
    username: string;
    nickname?: string;
    avatar?: {
        large: string;
        medium: string;
        small: string;
    };
}
/**
 * API响应结构接口
 */
export interface ApiResponse<T = any> {
    data: T | null;
    status: number;
    message: string;
}
/**
 * 收藏项接口
 */
export interface CollectionItem {
    subject_id: number;
    type: number;
    rate?: number;
    tags?: string[];
    comment?: string;
    ep_status?: number;
    vol_status?: number;
    updated_at?: string;
    subject_type?: number;
    subject?: {
        id: number;
        name: string;
        name_cn?: string;
        type?: number;
    };
}
/**
 * 收藏列表响应接口
 */
export interface CollectionListResponse {
    total?: number;
    data?: CollectionItem[];
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
 * @returns {Promise<CollectionItem[]>} 收藏列表
 */
export declare function fetchAllUserCollections(token: string, userId?: string, options?: {
    limit?: number;
    maxTotal?: number;
    onProgress?: (page: number, total: number) => void;
}): Promise<CollectionItem[]>;
/**
 * 获取单个条目的收藏状态
 *
 * @async
 * @function fetchSubjectCollection
 * @param {string} token - API Token
 * @param {string} subjectId - 条目ID
 * @returns {Promise<ApiResponse>} API响应
 */
export declare function fetchSubjectCollection(token: string, subjectId: string): Promise<ApiResponse>;
//# sourceMappingURL=scraping.d.ts.map