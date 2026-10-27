/**
 * 分片清单浮窗的示例数据（**自动生成，勿手改**）
 *
 * 由 scripts/build-shard-samples.mjs 从本地分片数据生成：
 * 挑一条 2026-10-20 数据里 2026 年播出、字段最全的记录
 * （sid=243430 机动战士高达 闪光的哈萨维 喀耳刻的魔女），按 manifest 字段清单输出
 * 每片的「字段 → 类型 → 示例值 → 本地列」。
 *
 * 重新生成：node scripts/build-shard-samples.mjs
 * 一致性守护：tests/shard-samples.test.ts（localColumn 与
 * github-sync-diff 的映射表对齐，防漂移）。
 */
/** 单个字段的示例行 */
export interface ShardSampleField {
    /** 远程字段名（JSONL 键） */
    name: string;
    /** 值类型（string / number / boolean / array / object / 空值） */
    type: string;
    /** 示例值（长文本截断到 150 字符） */
    sample: string;
    /** 对应的本地 Excel 列名；null = 随分片下载但不写任何列 */
    localColumn: string | null;
    /** 无本地列时的一句说明 */
    note?: string;
}
/** 单个分片的示例 */
export interface ShardSample {
    name: string;
    fields: ShardSampleField[];
}
/** 示例数据总包（数据日期 + 样本条目 + 各片明细） */
export interface ShardSampleBundle {
    dataUpdatedAt: string;
    sampleSid: string;
    sampleName: string;
    shards: ShardSample[];
}
export declare const SHARD_SAMPLES: ShardSampleBundle;
//# sourceMappingURL=shard-samples.d.ts.map