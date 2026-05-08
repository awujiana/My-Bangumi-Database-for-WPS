/**
 * BGM HTTP 请求模块
 * @module http
 * @description 支持异步请求、进度回调、自动重试、限流处理
 */
import { Result } from '../index.js';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type SyncProgressCallback = (current: number, total: number, message: string) => void;
/**
 * 异步发送 HTTP 请求（支持自动重试和进度回调）
 * @returns Promise<Result<{ status: number, data: T | null }>>
 */
export declare function httpRequest<T = unknown>(endpoint: string, options?: {
    method?: HttpMethod;
    body?: string | null;
    token?: string;
    timeout?: number;
    retries?: number;
    onProgress?: (current: number, total: number) => void;
}): Promise<Result<{
    status: number;
    data: T | null;
}>>;
/**
 * GET 请求
 * @example httpGet<UserInfo>('/v0/me', token)
 */
export declare const httpGet: <T = unknown>(endpoint: string, token?: string) => Promise<Result<{
    status: number;
    data: T | null;
}>>;
/**
 * POST 请求
 * @example httpPost('/v0/users/123/collections', jsonBody, token)
 */
export declare const httpPost: <T = unknown>(endpoint: string, body: string, token?: string) => Promise<Result<{
    status: number;
    data: T | null;
}>>;
/**
 * PUT 请求
 */
export declare const httpPut: <T = unknown>(endpoint: string, body: string, token?: string) => Promise<Result<{
    status: number;
    data: T | null;
}>>;
/**
 * DELETE 请求
 */
export declare const httpDelete: <T = unknown>(endpoint: string, token?: string) => Promise<Result<{
    status: number;
    data: T | null;
}>>;
//# sourceMappingURL=http.d.ts.map