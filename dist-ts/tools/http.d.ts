/**
 * BGM HTTP 请求模块
 * @module http
 * @description 支持异步请求、进度回调、自动重试、限流处理
 */
import { Result } from '../core/result.js';
import type { ZodSchema } from './zod-compat.js';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type SyncProgressCallback = (current: number, total: number, message: string) => void;
/**
 * httpRequest 选项
 * @template T - 期望的响应数据类型；仅在提供 zodSchema 时真正被校验
 */
export interface HttpRequestOptions<T> {
    method?: HttpMethod;
    body?: string | null;
    token?: string;
    timeout?: number;
    retries?: number;
    onProgress?: (current: number, total: number) => void;
    /**
     * 可选 Zod schema，用于在边界处运行时校验响应数据。
     * 若提供，则会以 schema.parse(data) 的结果作为 data 返回；
     * 若不提供，data 为 unknown，调用方需自行通过类型守卫或 schema 处理。
     */
    /**
     * 运行时校验器；只要求 parse（httpRequest 仅调用它）。
     *
     * 不直接用 ZodSchema<T>：那是本地降级实现的形状（带 `[k: string]: any` 索引
     * 签名），真实 zod 的 ZodObject 是类实例、没有索引签名，会被它拒之门外。
     * 按最小契约收参可同时接纳真实 zod 与本地降级实现。
     */
    zodSchema?: Pick<ZodSchema<T>, 'parse'>;
    /**
     * 可选 AbortSignal，用于取消请求。
     * 若已 aborted，则立即失败；否则监听 abort 事件触发 xhr.abort()。
     */
    signal?: AbortSignal;
}
/**
 * 异步发送 HTTP 请求（支持自动重试和进度回调）
 *
 * 类型说明：
 * - 默认 T = unknown，函数不会"伪装"知道响应结构。
 * - 若调用方需要类型化的响应，必须通过 options.zodSchema 提供运行时校验，
 *   否则 data 字段为 unknown，调用方需自行做类型守卫。
 *
 * @returns Promise<Result<{ status: number, data: T | null }>>
 */
export declare function httpRequest<T = unknown>(endpoint: string, options?: HttpRequestOptions<T>): Promise<Result<{
    status: number;
    data: T | null;
}>>;
//# sourceMappingURL=http.d.ts.map