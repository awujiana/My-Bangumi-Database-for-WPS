import { Result, toSyncResult, type SyncResult } from '../types/index.js';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type SyncProgressCallback = (current: number, total: number, message: string) => void;
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
export declare const httpGet: <T = unknown>(endpoint: string, token?: string) => Promise<Result<{
    status: number;
    data: T | null;
}>>;
export declare const httpPost: <T = unknown>(endpoint: string, body: string, token?: string) => Promise<Result<{
    status: number;
    data: T | null;
}>>;
export declare const httpPut: <T = unknown>(endpoint: string, body: string, token?: string) => Promise<Result<{
    status: number;
    data: T | null;
}>>;
export declare const httpDelete: <T = unknown>(endpoint: string, token?: string) => Promise<Result<{
    status: number;
    data: T | null;
}>>;
export declare function httpRequestSync(method: string, endpoint: string, body: string | null, token: string, options?: {
    retries?: number;
}): SyncResult;
export { toSyncResult };
//# sourceMappingURL=http.d.ts.map