import { type infer as zInfer } from '../tools/zodCompat.js';
/**
 * GitHub 同步条目 Schema（与 GithubRemoteEntry 接口保持一致）
 *
 * 基础字段（sid, name, updatedAt）严格校验类型；扩展字段通过 passthrough() 允许通过，
 * 由运行时类型守卫与 computeDiff/writeRemoteEntryToRow 中的字段访问逻辑保障安全。
 * 扩展字段不在 schema 中显式定义，避免与 githubSyncDiff.ts 的 EXTENDED_FIELD_MAP
 * 产生重复维护与漂移风险。
 *
 * 已移除的字段（不再从 JSONL 输出，BGM 插件内部处理）：
 * - url：从 sid 构造（https://bgm.tv/subject/{sid}）
 * - type：默认为 2（动漫）
 * - tags：与 meta_tags 冗余，仅使用 meta_tags
 * - episode：恒为 0，使用 infobox.话数 替代
 * - platform：已从 EXTENDED_FIELD_MAP 移除
 * - score：数据源平均分，非用户打分，不输出
 */
export declare const GithubEntrySchema: {
    [k: string]: any;
    readonly __isZodLite: true;
    readonly _shape: Record<string, import("../tools/zodCompat.js").ZodSchema<any>>;
    readonly _passthrough: boolean;
    passthrough(): /*elided*/ any;
    strict(): /*elided*/ any;
    optional(): import("../tools/zodCompat.js").ZodSchema<{
        sid: string;
        name: string | undefined;
        updatedAt: string | undefined;
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
//# sourceMappingURL=githubEntry.d.ts.map