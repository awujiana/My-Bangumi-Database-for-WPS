import type { infer as zInfer } from '../tools/zod-compat.js';
/**
 * GitHub 同步条目 Schema（与 GithubRemoteEntry 接口保持一致）
 *
 * 基础字段（subjectId, name, updatedAt）严格校验类型；扩展字段通过 passthrough() 允许通过，
 * 由运行时类型守卫与 computeDiff/writeRemoteEntryToRow 中的字段访问逻辑保障安全。
 * 扩展字段不在 schema 中显式定义，避免与 githubSyncDiff.ts 的 EXTENDED_FIELD_MAP
 * 产生重复维护与漂移风险。
 *
 * 未映射到 Excel 列的字段（随 dump 全量下发，但插件不写入表格）：
 * - URL：从 subjectId 构造（https://bgm.tv/subject/{subjectId}）
 * - episode：恒为 0，使用 infobox.话数 替代
 * - tags：与 meta_tags 冗余，仅使用 meta_tags 写入「标签/分级」列
 * - 全量保真字段（2026-09 起随 dump 下发）：name_original / type / platform /
 *   series / score / rank / score_details / favorite / summary / infobox / 别名
 */
export declare const GithubEntrySchema: {
    [k: string]: any;
    readonly __isZodLite: true;
    readonly _shape: Record<string, import("../tools/zod-compat.js").ZodSchema<any>>;
    readonly _passthrough: boolean;
    passthrough(): /*elided*/ any;
    strict(): /*elided*/ any;
    optional(): import("../tools/zod-compat.js").ZodSchema<{
        sid: string;
        name: string | undefined;
        updatedAt: string | undefined;
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
            sid: string;
            name: string | undefined;
            updatedAt: string | undefined;
        };
    };
    parse(input: unknown): {
        sid: string;
        name: string | undefined;
        updatedAt: string | undefined;
    };
};
export type GithubEntry = zInfer<typeof GithubEntrySchema>;
//# sourceMappingURL=github-entry.d.ts.map