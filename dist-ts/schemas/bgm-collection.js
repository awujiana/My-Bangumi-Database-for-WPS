import { z } from '../tools/zod-compat.js';
/**
 * 降级版 zodCompat 的 ZodSchema 带 `[k: string]: any` 索引签名，
 * url/default 等 fluent 方法在类型上会退化为 any；这里在“any 边界”处用
 * 精确的 ZodSchema 类型收窄返回结果。运行时仍走相同的 fluent 调用，行为不变。
 */
/** 可选字符串 schema（默认值 v） */
function stringWithDefault(v) {
    return z.string().optional().default(v);
}
/** 可选 URL 字符串 schema */
function stringUrl() {
    const urlSchema = z.string();
    return urlSchema.url().optional();
}
/** 可选字符串数组 schema（默认空数组） */
function stringArrayDefault() {
    return z.array(z.string()).optional().default([]);
}
/** Bangumi 收藏条目 Schema（subject 信息） */
export const BgmCollectionSubjectSchema = z.object({
    id: z.number().int().positive(),
    name: z.string(),
    name_cn: stringWithDefault(''),
    url: stringUrl(),
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
    tags: stringArrayDefault(),
    comment: stringWithDefault(''),
    ep_status: z.number().int().optional(),
});
