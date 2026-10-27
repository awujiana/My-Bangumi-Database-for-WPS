/**
 * Bangumi `GET /v0/me`（当前登录用户资料）的唯一 XHR 实现。
 *
 * @module tools/util/bgm-me
 * @description
 * §5.6 C2 收敛：原先 `GET /v0/me` 有两份 XHR 实现——本文件的 `fetchBgmMe`
 * （读「已存 token」）与 `sync/scraping.ts` 的 `verifyToken`（验证「调用方显式
 * 传入的 token」，可能是尚未保存的测试 Token）。签名语义不同，但管道逐字重复。
 *
 * 分层：
 * - `requestBgmMeRaw`：**管道核心**（开请求 / 收响应 / 失败分类），不打日志、
 *   超时可配（`fetchBgmMe` 15s；`verifyToken` 沿用其 `requestPromise` 的 30s）；
 * - `fetchBgmMeWithToken` / `fetchBgmMe`：`BgmMeResult` 判别联合映射 +
 *   `[fetchBgmMe]` 日志；
 * - `verifyToken` 直接用 `requestBgmMeRaw` 并显式传 token，自行映射为
 *   `TokenVerifyResult`（错误文案与其旧 `requestPromise` 的 Error.message 逐字一致）。
 *
 * 循环依赖：`bgmLog` / `loadBgToken` 经 `./index.js`（barrel）导入，**仅在函数体
 * 内使用**，运行时安全（先例：同目录 `sheet.ts` 的同类注释）。
 */
import type { BGMUserInfo } from '../../core/types.js';
/**
 * `fetchBgmMe` 的判别联合结果。
 *
 * 刻意**带 HTTP 状态码**、并把 `timeout` 单列，而不是压成
 * `'network' | 'http' | 'parse' | 'aborted'` 这种粗分类：调用方的分档需求不同 ——
 * `testTokenForRibbon` 要按 401 与其它状态码给不同文案、且超时与网络错误的文案不同，
 * `_fetchBgmUserInfo` 只要粗分类。压平会让前者丢信息（这也是两处一直没能合并的原因）。
 */
export type BgmMeResult = {
    kind: 'ok';
    user: BGMUserInfo;
    status: number;
} | {
    kind: 'http';
    status: number;
} | {
    kind: 'network';
} | {
    kind: 'timeout';
} | {
    kind: 'parse';
} | {
    kind: 'aborted';
} | {
    kind: 'no-token';
};
/**
 * 管道核心的结果（无映射、无日志）。
 *
 * 失败分类与 `sync/scraping.ts` 的 `requestPromise` 逐字对齐——
 * `verifyToken` 的错误文案（请求被取消 / 网络错误 / 请求超时）由该分类一一映射。
 * **不含 parse**：JSON 解析交给各映射层（`parseBgmMePayload` 会做字段校验，
 * 归入 `fetchBgmMe` 的 `parse` 分支；`verifyToken` 在自己的映射里 try/catch）。
 */
export type BgmMeRawResult = {
    kind: 'ok';
    status: 200;
    responseText: string;
} | {
    kind: 'http';
    status: number;
} | {
    kind: 'network';
} | {
    kind: 'timeout';
} | {
    kind: 'aborted';
};
/** `requestBgmMeRaw` 选项 */
export interface BgmMeRawOptions {
    /** 超时毫秒数（`fetchBgmMe` 15s；`verifyToken` 30s，与原 requestPromise 默认一致） */
    timeout: number;
    /** 可选 AbortSignal；已 aborted 时立即返回 `{ kind: 'aborted' }`，不发请求 */
    signal?: AbortSignal | undefined;
}
/**
 * `GET /v0/me` 管道核心：显式 token + 可配超时，返回原始结果（调用方各自映射）。
 * **不打日志**——两个调用方的日志文案与级别不同，由映射层各自产出。
 *
 * AbortSignal 监听器在请求结束（load / error / timeout）时移除——只 add 不 remove
 * 会在同一 signal 被反复取消 / 重试时持续累积（修法同 `sync/scraping.ts` 的
 * `requestPromise`）。
 */
export declare function requestBgmMeRaw(token: string, options: BgmMeRawOptions): Promise<BgmMeRawResult>;
/**
 * 用**调用方显式传入的 token** 请求 `GET /v0/me`，映射为 {@link BgmMeResult}。
 * 日志文案与旧 `fetchBgmMe` 逐字一致（`[fetchBgmMe]` 前缀）。
 */
export declare function fetchBgmMeWithToken(token: string, signal?: AbortSignal): Promise<BgmMeResult>;
/**
 * 请求 Bangumi 当前登录用户资料（`GET /v0/me`）。
 *
 * **纯请求 + 解析，无副作用** —— 不落库、不缓存头像、不弹窗、不写 PluginStorage；
 * 这些由调用方按需处理（`_fetchBgmUserInfo` 落库 + 缓存头像 + 持久化，
 * `testTokenForRibbon` 只落库 + 通知 Token 更新）。
 *
 * @param signal 可选 AbortSignal；已 aborted 时立即 resolve `{ kind: 'aborted' }`
 * @returns 带 HTTP 状态码的判别联合（见 {@link BgmMeResult}）
 */
export declare function fetchBgmMe(signal?: AbortSignal): Promise<BgmMeResult>;
//# sourceMappingURL=bgm-me.d.ts.map