import { z } from 'zod';
/** Bangumi 用户信息 Schema */
export declare const BgmUserSchema: z.ZodObject<{
    id: z.ZodNumber;
    username: z.ZodString;
    nickname: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    avatar: z.ZodOptional<z.ZodObject<{
        large: z.ZodOptional<z.ZodString>;
        medium: z.ZodOptional<z.ZodString>;
        small: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type BgmUser = z.infer<typeof BgmUserSchema>;
//# sourceMappingURL=bgmUser.d.ts.map