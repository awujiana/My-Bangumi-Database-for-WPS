import { z } from '../tools/zod-compat.js'
import type { infer as zInfer, ZodSchema } from '../tools/zod-compat.js'

/** 同步策略 Schema */
export const SyncStrategySchema = z.enum([
  'add-update',
  'add-only',
  'update-only',
  'mirror',
  'force-overwrite',
])
export type SyncStrategy = zInfer<typeof SyncStrategySchema>

/** GitHub 同步配置 Schema */
export const GithubConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1),
  path: z.string().min(1),
  strategy: SyncStrategySchema.optional().default('add-update') as ZodSchema<SyncStrategy>,
  sourceType: z
    .enum(['github', 'gitlab', 'gitee', 'local', 'gist'])
    .optional()
    .default('github') as ZodSchema<'github' | 'gitlab' | 'gitee' | 'local' | 'gist'>,
})

export type GithubConfig = zInfer<typeof GithubConfigSchema>

/** 完整配置 Schema（用于导入导出） */
export const FullConfigSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  token: z.string().optional(),
  userId: z.string().optional(),
  githubConfig: GithubConfigSchema.optional(),
})
export type FullConfig = zInfer<typeof FullConfigSchema>
