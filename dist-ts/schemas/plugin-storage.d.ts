import type { infer as zInfer, ZodSchema } from '../tools/zod-compat.js';
/** 同步策略 Schema */
export declare const SyncStrategySchema: {
    [k: string]: any;
    readonly __isZodLite: true;
    readonly _values: readonly string[];
    optional(): ZodSchema<string | undefined>;
    default(d: any): any;
    safeParse(input: unknown): {
        success: false;
        error: {
            issues: import("../tools/zod-compat.js")._ZodIssue[];
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
    readonly _shape: Record<string, ZodSchema<any>>;
    readonly _passthrough: boolean;
    passthrough(): /*elided*/ any;
    strict(): /*elided*/ any;
    optional(): ZodSchema<{
        owner: string;
        repo: string;
        branch: string;
        path: string;
        strategy: string;
        sourceType: "local" | "github" | "gitlab" | "gitee" | "gist";
        gistId: string | undefined;
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
            owner: string;
            repo: string;
            branch: string;
            path: string;
            strategy: string;
            sourceType: "local" | "github" | "gitlab" | "gitee" | "gist";
            gistId: string | undefined;
        };
    };
    parse(input: unknown): {
        owner: string;
        repo: string;
        branch: string;
        path: string;
        strategy: string;
        sourceType: "local" | "github" | "gitlab" | "gitee" | "gist";
        gistId: string | undefined;
    };
};
export type GithubConfig = zInfer<typeof GithubConfigSchema>;
/** 完整配置 Schema（用于导入导出） */
export declare const FullConfigSchema: {
    [k: string]: any;
    readonly __isZodLite: true;
    readonly _shape: Record<string, ZodSchema<any>>;
    readonly _passthrough: boolean;
    passthrough(): /*elided*/ any;
    strict(): /*elided*/ any;
    optional(): ZodSchema<{
        version: 1;
        exportedAt: string;
        token: string | undefined;
        userId: string | undefined;
        githubConfig: {
            owner: string;
            repo: string;
            branch: string;
            path: string;
            strategy: string;
            sourceType: "local" | "github" | "gitlab" | "gitee" | "gist";
            gistId: string | undefined;
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
            version: 1;
            exportedAt: string;
            token: string | undefined;
            userId: string | undefined;
            githubConfig: {
                owner: string;
                repo: string;
                branch: string;
                path: string;
                strategy: string;
                sourceType: "local" | "github" | "gitlab" | "gitee" | "gist";
                gistId: string | undefined;
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
            strategy: string;
            sourceType: "local" | "github" | "gitlab" | "gitee" | "gist";
            gistId: string | undefined;
        } | undefined;
    };
};
export type FullConfig = zInfer<typeof FullConfigSchema>;
//# sourceMappingURL=plugin-storage.d.ts.map