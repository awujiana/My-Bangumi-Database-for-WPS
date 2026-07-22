import { z } from 'zod';
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
    sourceType: z.enum(['github', 'gitlab', 'gitee', 'local', 'gist']).optional().default('github'),
});
/** 完整配置 Schema（用于导入导出） */
export const FullConfigSchema = z.object({
    version: z.literal(1),
    exportedAt: z.string(),
    token: z.string().optional(),
    userId: z.string().optional(),
    githubConfig: GithubConfigSchema.optional(),
});
