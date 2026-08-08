import { type infer as zInfer } from '../tools/zodCompat.js';
/** 同步策略 Schema */
export declare const SyncStrategySchema: {
    [k: string]: any;
    readonly __isZodLite: true;
    readonly _vals: readonly string[];
    optional(): import("../tools/zodCompat.js").ZodSchema<string | undefined>;
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
        data: string;
    };
    parse(input: unknown): string;
};
export type SyncStrategy = zInfer<typeof SyncStrategySchema>;
/** GitHub 同步配置 Schema */
export declare const GithubConfigSchema: {
    [k: string]: any;
    readonly __isZodLite: true;
    readonly _shape: Record<string, import("../tools/zodCompat.js").ZodSchema<any>>;
    readonly _passthrough: boolean;
    passthrough(): /*elided*/ any;
    strict(): /*elided*/ any;
    optional(): import("../tools/zodCompat.js").ZodSchema<{
        owner: string;
        repo: string;
        branch: string;
        path: string;
        strategy: unknown;
        sourceType: unknown;
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
            owner: string;
            repo: string;
            branch: string;
            path: string;
            strategy: unknown;
            sourceType: unknown;
        };
    };
    parse(input: unknown): {
        owner: string;
        repo: string;
        branch: string;
        path: string;
        strategy: unknown;
        sourceType: unknown;
    };
};
export type GithubConfig = zInfer<typeof GithubConfigSchema>;
/** 完整配置 Schema（用于导入导出） */
export declare const FullConfigSchema: {
    [k: string]: any;
    readonly __isZodLite: true;
    readonly _shape: Record<string, import("../tools/zodCompat.js").ZodSchema<any>>;
    readonly _passthrough: boolean;
    passthrough(): /*elided*/ any;
    strict(): /*elided*/ any;
    optional(): import("../tools/zodCompat.js").ZodSchema<{
        version: 1;
        exportedAt: string;
        token: string | undefined;
        userId: string | undefined;
        githubConfig: {
            owner: string;
            repo: string;
            branch: string;
            path: string;
            strategy: unknown;
            sourceType: unknown;
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
            version: 1;
            exportedAt: string;
            token: string | undefined;
            userId: string | undefined;
            githubConfig: {
                owner: string;
                repo: string;
                branch: string;
                path: string;
                strategy: unknown;
                sourceType: unknown;
            } | undefined;
        };
    };
    parse(input: unknown): {
        version: 1;
        exportedAt: string;
        token: string | undefined;
        userId: string | undefined;
        githubConfig: {
            owner: string;
            repo: string;
            branch: string;
            path: string;
            strategy: unknown;
            sourceType: unknown;
        } | undefined;
    };
};
export type FullConfig = zInfer<typeof FullConfigSchema>;
//# sourceMappingURL=pluginStorage.d.ts.map