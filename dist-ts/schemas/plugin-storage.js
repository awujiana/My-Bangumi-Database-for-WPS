import { z } from '../tools/zod-compat.js';
/** 同步策略 Schema */
export const SyncStrategySchema = z.enum([
    'add-update',
    'add-only',
    'update-only',
    'mirror',
    'force-overwrite',
]);
/** GitHub 同步配置 Schema */
export const GithubConfigSchema = z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    branch: z.string().min(1),
    path: z.string().min(1),
    strategy: SyncStrategySchema.optional().default('add-update'),
    sourceType: z
        .enum(['github', 'gitlab', 'gitee', 'local', 'gist'])
        .optional()
        .default('github'),
    // Gist 源的 Gist ID：只有 sourceType === 'gist' 时有值，与 owner/repo 互斥。
    // 2026-10-27 补进导入导出 —— 之前它不在 schema 里，导入时会被 setGithubConfig
    // 按默认 'github' 覆盖掉，Gist 用户迁机器后同步源直接失效。
    gistId: z.string().optional(),
});
/** 完整配置 Schema（用于导入导出） */
export const FullConfigSchema = z.object({
    version: z.literal(1),
    exportedAt: z.string(),
    token: z.string().optional(),
    userId: z.string().optional(),
    githubConfig: GithubConfigSchema.optional(),
});
