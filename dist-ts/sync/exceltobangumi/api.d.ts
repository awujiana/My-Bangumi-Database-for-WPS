/**
 * Bangumi API 响应数据结构（消息字段可能出现在不同属性中）
 */
export interface BgmApiResponse {
    msg?: string;
    message?: string;
    error?: string;
    description?: string;
}
/**
 * 提取HTTP请求结果消息
 */
export declare function extractResponseMessage(data: unknown): string;
/**
 * 处理请求错误响应
 */
export declare function parseErrorResponse(xhr: XMLHttpRequest): string;
/**
 * 打开Bangumi Token申请页面
 *
 * @function openBangumiTokenPage
 */
export declare function openBangumiTokenPage(): void;
/**
 * 测试Token有效性（Ribbon版本）
 *
 * @function testTokenValidityForRibbon
 * @param {string} [token] - 要测试的Token，不提供则自动加载
 * @param {AbortSignal} [signal] - 可选 AbortSignal，用于取消请求
 */
export declare function testTokenValidityForRibbon(token?: string, signal?: AbortSignal): void;
/**
 * 通知面板用户信息已更新
 */
export declare function notifyUserInfoUpdated(username: string, userId: string): void;
/**
 * 发送Bangumi同步请求
 *
 * @function bgmRequestSync
 * @param {string} method - HTTP方法（POST/PUT/DELETE）
 * @param {string} endpoint - API端点
 * @param {string} jsonBody - JSON请求体
 * @param {string} token - API Token
 * @param {AbortSignal} [signal] - 可选 AbortSignal，用于取消请求
 * @returns {{ code: number; message: string }} 请求结果
 */
export declare function bgmRequestSync(method: string, endpoint: string, jsonBody: string, token: string, signal?: AbortSignal): Promise<{
    code: number;
    message: string;
}>;
/**
 * 设置Bangumi Token
 *
 * @function setBangumiToken
 * @param {string} token - Token字符串
 * @returns {boolean} 是否保存成功
 */
export declare function setBangumiToken(token: string): boolean;
//# sourceMappingURL=api.d.ts.map