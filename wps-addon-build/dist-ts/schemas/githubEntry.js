import { z } from 'zod';
/** GitHub 同步条目 Schema */
export const GithubEntrySchema = z.object({
    sid: z.string().min(1),
    url: z.string().optional(),
    name: z.string().optional(),
    type: z.number().int().min(1).max(5).optional(),
    score: z.number().int().min(0).max(10).optional(),
    tags: z.array(z.string()).optional(),
    comment: z.string().optional(),
    episode: z.number().int().optional(),
    updatedAt: z.string().optional(),
});
