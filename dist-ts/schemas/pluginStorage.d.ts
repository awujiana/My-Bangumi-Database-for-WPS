import { z } from 'zod';
/** 同步策略 Schema */
export declare const SyncStrategySchema: z.ZodEnum<{
    "add-update": "add-update";
    "add-only": "add-only";
    "update-only": "update-only";
    mirror: "mirror";
    "force-overwrite": "force-overwrite";
}>;
export type SyncStrategy = z.infer<typeof SyncStrategySchema>;
/** GitHub 同步配置 Schema */
export declare const GithubConfigSchema: z.ZodObject<{
    owner: z.ZodString;
    repo: z.ZodString;
    branch: z.ZodString;
    path: z.ZodString;
    strategy: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        "add-update": "add-update";
        "add-only": "add-only";
        "update-only": "update-only";
        mirror: "mirror";
        "force-overwrite": "force-overwrite";
    }>>>;
    sourceType: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        github: "github";
        gitlab: "gitlab";
        gitee: "gitee";
        local: "local";
        gist: "gist";
    }>>>;
}, z.core.$strip>;
export type GithubConfig = z.infer<typeof GithubConfigSchema>;
/** 完整配置 Schema（用于导入导出） */
export declare const FullConfigSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    exportedAt: z.ZodString;
    token: z.ZodOptional<z.ZodString>;
    userId: z.ZodOptional<z.ZodString>;
    githubConfig: z.ZodOptional<z.ZodObject<{
        owner: z.ZodString;
        repo: z.ZodString;
        branch: z.ZodString;
        path: z.ZodString;
        strategy: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
            "add-update": "add-update";
            "add-only": "add-only";
            "update-only": "update-only";
            mirror: "mirror";
            "force-overwrite": "force-overwrite";
        }>>>;
        sourceType: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
            github: "github";
            gitlab: "gitlab";
            gitee: "gitee";
            local: "local";
            gist: "gist";
        }>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type FullConfig = z.infer<typeof FullConfigSchema>;
//# sourceMappingURL=pluginStorage.d.ts.map