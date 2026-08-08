import { type infer as zInfer } from '../tools/zodCompat.js';
/** Bangumi 用户信息 Schema */
export declare const BgmUserSchema: {
    [k: string]: any;
    readonly __isZodLite: true;
    readonly _shape: Record<string, import("../tools/zodCompat.js").ZodSchema<any>>;
    readonly _passthrough: boolean;
    passthrough(): /*elided*/ any;
    strict(): /*elided*/ any;
    optional(): import("../tools/zodCompat.js").ZodSchema<{
        id: unknown;
        username: string;
        nickname: unknown;
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
            issues: {
                message: string;
                path?: Array<string | number>;
            }[];
        };
    } | {
        success: true;
        data: {
            id: unknown;
            username: string;
            nickname: unknown;
            avatar: {
                large: string | undefined;
                medium: string | undefined;
                small: string | undefined;
            } | undefined;
        };
    };
    parse(input: unknown): {
        id: unknown;
        username: string;
        nickname: unknown;
        avatar: {
            large: string | undefined;
            medium: string | undefined;
            small: string | undefined;
        } | undefined;
    };
};
export type BgmUser = zInfer<typeof BgmUserSchema>;
//# sourceMappingURL=bgmUser.d.ts.map