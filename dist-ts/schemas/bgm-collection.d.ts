import type { infer as zInfer, ZodSchema } from '../tools/zod-compat.js';
/** Bangumi 收藏条目 Schema（subject 信息） */
export declare const BgmCollectionSubjectSchema: {
    [k: string]: any;
    readonly __isZodLite: true;
    readonly _shape: Record<string, ZodSchema<any>>;
    readonly _passthrough: boolean;
    passthrough(): /*elided*/ any;
    strict(): /*elided*/ any;
    optional(): ZodSchema<{
        id: number;
        name: string;
        name_cn: string;
        url: string | undefined;
        images: {
            large: string | undefined;
            common: string | undefined;
            medium: string | undefined;
            small: string | undefined;
            grid: string | undefined;
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
            name: string;
            name_cn: string;
            url: string | undefined;
            images: {
                large: string | undefined;
                common: string | undefined;
                medium: string | undefined;
                small: string | undefined;
                grid: string | undefined;
            } | undefined;
        };
    };
    parse(input: unknown): {
        id: number;
        name: string;
        name_cn: string;
        url: string | undefined;
        images: {
            large: string | undefined;
            common: string | undefined;
            medium: string | undefined;
            small: string | undefined;
            grid: string | undefined;
        } | undefined;
    };
};
/** Bangumi 收藏 Schema */
export declare const BgmCollectionSchema: {
    [k: string]: any;
    readonly __isZodLite: true;
    readonly _shape: Record<string, ZodSchema<any>>;
    readonly _passthrough: boolean;
    passthrough(): /*elided*/ any;
    strict(): /*elided*/ any;
    optional(): ZodSchema<{
        date: string | undefined;
        type: number;
        rate: number | undefined;
        subject: {
            id: number;
            name: string;
            name_cn: string;
            url: string | undefined;
            images: {
                large: string | undefined;
                common: string | undefined;
                medium: string | undefined;
                small: string | undefined;
                grid: string | undefined;
            } | undefined;
        };
        subject_id: number;
        private: boolean | undefined;
        tags: string[];
        comment: string;
        ep_status: number | undefined;
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
            date: string | undefined;
            type: number;
            rate: number | undefined;
            subject: {
                id: number;
                name: string;
                name_cn: string;
                url: string | undefined;
                images: {
                    large: string | undefined;
                    common: string | undefined;
                    medium: string | undefined;
                    small: string | undefined;
                    grid: string | undefined;
                } | undefined;
            };
            subject_id: number;
            private: boolean | undefined;
            tags: string[];
            comment: string;
            ep_status: number | undefined;
        };
    };
    parse(input: unknown): {
        date: string | undefined;
        type: number;
        rate: number | undefined;
        subject: {
            id: number;
            name: string;
            name_cn: string;
            url: string | undefined;
            images: {
                large: string | undefined;
                common: string | undefined;
                medium: string | undefined;
                small: string | undefined;
                grid: string | undefined;
            } | undefined;
        };
        subject_id: number;
        private: boolean | undefined;
        tags: string[];
        comment: string;
        ep_status: number | undefined;
    };
};
export type BgmCollection = zInfer<typeof BgmCollectionSchema>;
export type BgmCollectionSubject = zInfer<typeof BgmCollectionSubjectSchema>;
//# sourceMappingURL=bgm-collection.d.ts.map