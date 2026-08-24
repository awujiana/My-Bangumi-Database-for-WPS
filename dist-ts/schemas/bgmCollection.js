import { z } from '../tools/zodCompat.js';
/** Bangumi 收藏条目 Schema（subject 信息） */
export const BgmCollectionSubjectSchema = z.object({
    id: z.number().int().positive(),
    name: z.string(),
    name_cn: z.string().optional().default(''),
    url: z.string().url().optional(),
    images: z
        .object({
        large: z.string().optional(),
        common: z.string().optional(),
        medium: z.string().optional(),
        small: z.string().optional(),
        grid: z.string().optional(),
    })
        .optional(),
});
/** Bangumi 收藏 Schema */
export const BgmCollectionSchema = z.object({
    date: z.string().optional(),
    type: z.number().int().min(1).max(5),
    rate: z.number().int().min(0).max(10).optional(),
    subject: BgmCollectionSubjectSchema,
    subject_id: z.number().int().positive(),
    private: z.boolean().optional(),
    tags: z.array(z.string()).optional().default([]),
    comment: z.string().optional().default(''),
    ep_status: z.number().int().optional(),
});
//# sourceMappingURL=bgmCollection.js.map