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
import { LOG_LEVELS } from '../core/constants.js';
import { bgmLog, findHeaderRow, getColumnMap, getDataSheet } from '../tools/util/index.js';
import { isWireRemoteEntry, toRemoteEntry } from './github-sync-diff.js';
import { isManifestPath, joinShardRows, neededFieldsForColumns, parseShardManifest, parseShardText, resolveSiblingPath, selectShards, } from './shard-manifest.js';
/** 取错误的可读文本 */
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * 按配置路径加载远程条目（清单 → 选片 → 拼接）
 *
 * @param options 入参
 * @returns 加载结果
 * @throws 路径不是清单、清单格式非法、任一分片取不到或拼接失败时抛出 Error
 */
export async function loadEntriesFromPath(options) {
    const { path, fetchText, neededFields, manualShards, signal, logTag } = options;
    if (!isManifestPath(path)) {
        throw new Error(`数据文件路径必须是分片清单（.json），当前为「${path}」。` +
            `默认应为 data/anime.manifest.json；旧单片 data/bangumi.jsonlines.gz 已不再支持`);
    }
    let manifestText;
    try {
        manifestText = await fetchText(path, signal);
    }
    catch (error) {
        throw new Error(`分片清单读取失败（${path}）：${describeError(error)}`, { cause: error });
    }
    const manifest = parseShardManifest(manifestText);
    if (!manifest) {
        throw new Error(`分片清单格式非法：${path}（应为数据仓库的 anime.manifest.json，含 formatVersion/shards/recordCount）`);
    }
    const picked = selectShards(manifest, neededFields, manualShards);
    bgmLog(LOG_LEVELS.INFO, `[${logTag}] 清单 ${path}（期次 ${manifest.updatedAt}）：共 ${String(manifest.shards.length)} 片，` +
        `本次下载 ${String(picked.length)} 片 [${picked.map((shard) => shard.name).join(', ')}]`);
    const datas = [];
    for (const shard of picked) {
        const shardPath = resolveSiblingPath(path, shard.file);
        let text;
        try {
            text = await fetchText(shardPath, signal);
        }
        catch (error) {
            throw new Error(`分片读取失败（${shardPath}）：${describeError(error)}`, { cause: error });
        }
        const data = parseShardText(shard.name, text);
        if (!data) {
            throw new Error(`分片表头非法：${shardPath}（首行应为字段名数组）`);
        }
        datas.push(data);
    }
    const joined = joinShardRows(datas);
    if ('errors' in joined) {
        throw new Error(`分片拼接失败：${joined.errors.join('；')}`);
    }
    const records = joined.entries;
    const entries = [];
    let invalid = 0;
    for (const record of records) {
        if (isWireRemoteEntry(record)) {
            entries.push(toRemoteEntry(record));
        }
        else {
            invalid += 1;
        }
    }
    if (entries.length === 0 && records.length > 0) {
        throw new Error(`分片拼接后没有可用记录：${String(records.length)} 条全部缺少合法 sid`);
    }
    if (invalid > 0) {
        bgmLog(LOG_LEVELS.WARN, `[${logTag}] 分片拼接完成：${String(entries.length)} 条合法，${String(invalid)} 条缺少合法 sid（已跳过）`);
    }
    else {
        bgmLog(LOG_LEVELS.INFO, `[${logTag}] 分片下载成功：${String(entries.length)} 条记录`);
    }
    return {
        entries,
        shards: picked.map((shard) => shard.name),
        updatedAt: manifest.updatedAt,
        skippedInvalidRecords: invalid,
    };
}
/**
 * 读取当前工作表表头并推导本次同步需要的 JSONL 字段
 *
 * **只读**，不补表头、不改工作表 —— 下载阶段动表会带来可见的闪烁，且失败时
 * 会留下副作用。空表读不到列时返回 `undefined`，调用方按「全量下载」处理
 * （空表本来就要写全部标准列，全量下载正是正确行为）。
 *
 * @returns 需要的字段集合；读不到工作表或读不到任何列时为 undefined
 */
export function collectNeededFieldsFromSheet() {
    const worksheet = getDataSheet();
    if (!worksheet)
        return undefined;
    const headerRow = findHeaderRow(worksheet) || 1;
    const columnMap = getColumnMap(worksheet, headerRow);
    const columns = [...columnMap.keys()];
    if (columns.length === 0)
        return undefined;
    return neededFieldsForColumns(columns);
}
