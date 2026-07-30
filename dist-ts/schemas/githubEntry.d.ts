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
export declare const GithubEntrySchema: z.ZodObject<{
    sid: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodNumber>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    episode: z.ZodOptional<z.ZodNumber>;
    updatedAt: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export type GithubEntry = z.infer<typeof GithubEntrySchema>;
//# sourceMappingURL=githubEntry.d.ts.map