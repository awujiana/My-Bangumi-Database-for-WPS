/**
 * @fileoverview 分片数据源的下载编排（清单 → 选片 → 逐片取文本 → 按行拼接）
 * @module sync/shardFetch
 * @description 数据仓库的数据文件是「6 个分片 + 一份清单 `data/anime.manifest.json`」。
 *              各同步源（GitHub / GitLab / Gitee / 本地文件）的取数机制各不相同，但
 *              「拿到文本之后怎么拼」完全一致，因此收敛到本模块：调用方只需
 *              提供一个 `fetchText(仓库内相对路径)` 回调。
 *
 * 流程：
 *   1. 取清单文本并解析；
 *   2. 依据**用户表格表头**推导需要的字段 → {@link selectShards} 选片
 *      （用户手动多选/取消时以手动结果为准，但必选片始终保留）；
 *   3. 逐片取文本 → {@link parseShardText} → {@link joinShardRows} 按行拼接；
 *   4. 校验 `sid` 后转成 `GithubRemoteEntry[]`。
 *
 * 只支持分片清单，**不兼容**旧单片 `data/bangumi.jsonlines.gz`：存量配置里的旧
 * 默认路径由 `githubConfig` 的路径迁移表一次性改写为清单路径。
 */
import type { GithubRemoteEntry } from './github-sync-diff.js';
/**
 * 取某个「仓库内相对路径」的文本内容
 *
 * 实现方负责把 gzip 解压好（各源统一走 `readXhrJsonlText`，按魔数判断），
 * 因此本模块拿到的永远是 JSONL / JSON 明文。
 */
export type RelativePathFetcher = (relativePath: string, signal?: AbortSignal) => Promise<string>;
/** 一次加载的入参 */
export interface LoadEntriesOptions {
    /** 配置里写的路径（应指向分片清单，如 data/anime.manifest.json） */
    path: string;
    /** 取文本回调 */
    fetchText: RelativePathFetcher;
    /**
     * 本次同步会用到的字段（来自用户表格表头）
     *
     * 传 `undefined` 表示**无法判断** → 全量下载（保守）；
     * 传空集合表示「确实一个都不需要」→ 只下载必选片。
     */
    neededFields?: ReadonlySet<string> | undefined;
    /** 用户手动指定的分片名；空数组或 undefined 表示按表头自动选 */
    manualShards?: readonly string[] | undefined;
    /** 取消信号 */
    signal?: AbortSignal | undefined;
    /** 日志前缀（如 'githubSync'），用于区分数据源 */
    logTag: string;
}
/** 一次加载的结果 */
export interface LoadEntriesResult {
    /** 拼接后的远程条目 */
    entries: GithubRemoteEntry[];
    /** 实际下载的分片名 */
    shards: string[];
    /** 数据期次（清单的 updatedAt） */
    updatedAt: string;
    /**
     * 拼接后因**缺少合法 sid**（线上键，见 FIELD_NAME_MAP）被跳过的记录条数
     *
     * 与 `parseJsonl` 的「非法行不中断整体解析」同一口径：分片表头合法、
     * 单条记录却不合法（如 sid 为空/非字符串）时静默跳过。此前只进 WARN
     * 日志，用户看不到「明明下载了 100 条、只同步进来 90 条」。
     */
    skippedInvalidRecords: number;
}
/**
 * 下载统计出参（调用方传字面量对象，取数函数回填字段）
 *
 * 供 `fetchXxxJson` 系函数把「链路内部才看得到的丢弃统计」带出给
 * `syncFromGithub` / `syncFromRemote`，最终进入同步结果弹窗——
 * 不改这些函数的返回类型（`GithubRemoteEntry[]` 是既定契约）。
 */
export interface FetchLoadStats {
    /** 拼接后因缺少合法 sid（线上键）被跳过的条数 */
    skippedInvalidLines: number;
}
/**
 * 按配置路径加载远程条目（清单 → 选片 → 拼接）
 *
 * @param options 入参
 * @returns 加载结果
 * @throws 路径不是清单、清单格式非法、任一分片取不到或拼接失败时抛出 Error
 */
export declare function loadEntriesFromPath(options: LoadEntriesOptions): Promise<LoadEntriesResult>;
/**
 * 读取当前工作表表头并推导本次同步需要的 JSONL 字段
 *
 * **只读**，不补表头、不改工作表 —— 下载阶段动表会带来可见的闪烁，且失败时
 * 会留下副作用。空表读不到列时返回 `undefined`，调用方按「全量下载」处理
 * （空表本来就要写全部标准列，全量下载正是正确行为）。
 *
 * @returns 需要的字段集合；读不到工作表或读不到任何列时为 undefined
 */
export declare function collectNeededFieldsFromSheet(): Set<string> | undefined;
//# sourceMappingURL=shard-fetch.d.ts.map