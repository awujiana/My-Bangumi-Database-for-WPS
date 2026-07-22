import { z } from 'zod';
/** Bangumi 收藏条目 Schema（subject 信息） */
export declare const BgmCollectionSubjectSchema: z.ZodObject<{
    id: z.ZodNumber;
    name: z.ZodString;
    name_cn: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    url: z.ZodOptional<z.ZodString>;
    images: z.ZodOptional<z.ZodObject<{
        large: z.ZodOptional<z.ZodString>;
        common: z.ZodOptional<z.ZodString>;
        medium: z.ZodOptional<z.ZodString>;
        small: z.ZodOptional<z.ZodString>;
        grid: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Bangumi 收藏 Schema */
export declare const BgmCollectionSchema: z.ZodObject<{
    date: z.ZodOptional<z.ZodString>;
    type: z.ZodNumber;
    rate: z.ZodOptional<z.ZodNumber>;
    subject: z.ZodObject<{
        id: z.ZodNumber;
        name: z.ZodString;
        name_cn: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        url: z.ZodOptional<z.ZodString>;
        images: z.ZodOptional<z.ZodObject<{
            large: z.ZodOptional<z.ZodString>;
            common: z.ZodOptional<z.ZodString>;
            medium: z.ZodOptional<z.ZodString>;
            small: z.ZodOptional<z.ZodString>;
            grid: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    subject_id: z.ZodNumber;
    private: z.ZodOptional<z.ZodBoolean>;
    tags: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    comment: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    ep_status: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type BgmCollection = z.infer<typeof BgmCollectionSchema>;
export type BgmCollectionSubject = z.infer<typeof BgmCollectionSubjectSchema>;
//# sourceMappingURL=bgmCollection.d.ts.map