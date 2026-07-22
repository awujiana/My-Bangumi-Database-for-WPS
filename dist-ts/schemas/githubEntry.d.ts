import { z } from 'zod';
/** GitHub 同步条目 Schema */
export declare const GithubEntrySchema: z.ZodObject<{
    sid: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodNumber>;
    score: z.ZodOptional<z.ZodNumber>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    comment: z.ZodOptional<z.ZodString>;
    episode: z.ZodOptional<z.ZodNumber>;
    updatedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type GithubEntry = z.infer<typeof GithubEntrySchema>;
//# sourceMappingURL=githubEntry.d.ts.map