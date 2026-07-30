import { z } from 'zod';
/**
 * GitHub 同步条目 Schema（与 GithubRemoteEntry 接口保持一致）
 *
 * 基础字段（7个）严格校验类型；扩展字段（23个）通过 passthrough() 允许通过，
 * 由运行时类型守卫与 computeDiff/writeRemoteEntryToRow 中的字段访问逻辑保障安全。
 * 扩展字段不在 schema 中显式定义，避免与 githubSyncDiff.ts 的 EXTENDED_FIELD_MAP
 * 产生重复维护与漂移风险。
 *
 * type 字段允许 1-6：Bangumi subject 类型约定为 1=书籍/2=动漫/3=音乐/4=游戏/6=三次元
 * （没有 5），允许 5 仅为兼容历史数据，不主动拒绝。
 */
export const GithubEntrySchema = z.object({
    sid: z.string().min(1),
    url: z.string().optional(),
    name: z.string().optional(),
    type: z.number().int().min(1).max(6).optional(),
    tags: z.array(z.string()).optional(),
    episode: z.number().int().optional(),
    updatedAt: z.string().optional(),
}).passthrough();
