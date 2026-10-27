import type { infer as zInfer, ZodSchema } from '../tools/zod-compat.js';
/** Bangumi 用户信息 Schema */
export declare const BgmUserSchema: {
    [k: string]: any;
    readonly __isZodLite: true;
    readonly _shape: Record<string, ZodSchema<any>>;
    readonly _passthrough: boolean;
    passthrough(): /*elided*/ any;
    strict(): /*elided*/ any;
    optional(): ZodSchema<{
        id: number;
        username: string;
        nickname: string;
        avatar: {
            large: string | undefined;
            medium: string | undefined;
            small: string | undefined;
        } | undefined;
    } | undefined>;
    default(d: any): any;
    safeParse(input: unknown): {
        success: false;
        error: {
            issues: import("../tools/zod-compat.js")._ZodIssue[];
        };
    } | {
        success: true;
        data: {
            id: number;
            username: string;
            nickname: string;
            avatar: {
                large: string | undefined;
                medium: string | undefined;
                small: string | undefined;
            } | undefined;
        };
    };
    parse(input: unknown): {
        id: number;
        username: string;
        nickname: string;
        avatar: {
            large: string | undefined;
            medium: string | undefined;
            small: string | undefined;
        } | undefined;
    };
};
export type BgmUser = zInfer<typeof BgmUserSchema>;
//# sourceMappingURL=bgm-user.d.ts.map