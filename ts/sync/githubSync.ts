/**
 * @fileoverview GitHub 仓库增量同步模块
 * @module sync/githubSync
 * @description 从 GitHub 公开仓库下载 JSON 数据，按 SID 主键比对本地 Excel 行，
 *              增量更新（新增+更新，不删除本地多余行）。
 *
 * 数据格式（远程 JSON 文件）：
 * [
 *   { "sid": "12345", "url": "https://bgm.tv/subject/12345", "name": "...",
 *     "type": 2, "score": 8, "tags": ["标签1","标签2"], "comment": "...",
 *     "episode": 12, "updatedAt": "2026-07-05T10:00:00Z" },
 *   ...
 * ]
 *
 * type 字段约定（与 Bangumi 一致）：
 *   1=想看  2=在看  3=看过  4=搁置  5=抛弃
 */

// 直接从子模块导入，避开 index.ts 的副作用链（index → handlers → document.readyState）
// 注意：bgmLog 定义在 tools/util.ts（不在 core/constants.ts），与 BGM/getDataSheet 等同源导入
import { LOG_LEVELS } from '../core/constants.js';
import {
    BGM,
    bgmLog,
    getDataSheet, findHeaderRow, getLastRow, getColumnMap,
    getCellValue, setCellValue, trim,
} from '../tools/util.js';
import { extractSubjectId } from './pureUtils.js';
import type { WpsWorksheet } from '../tools/wps.js';
import { buildRawUrl, isGithubConfigComplete } from './githubConfig.js';

// 纯函数与类型从 githubSyncDiff.ts re-export，避免重复定义
// githubSyncDiff.ts 为零依赖纯模块，可在 Node 测试环境中直接运行
export {
    computeDiff,
    mapTypeToWatchStatus,
    tagsToString,
    parseJsonl,
    isGithubRemoteEntry,
    SYNC_STRATEGY_LABELS,
    type GithubRemoteEntry,
    type GithubSyncDiff,
    type LocalRowEntry,
    type SyncStrategy,
} from './githubSyncDiff.js';

// 从 githubSyncDiff.ts 导入供本模块内部使用
import {
    computeDiff,
    mapTypeToWatchStatus,
    tagsToString,
    parseJsonl,
    type GithubRemoteEntry,
    type GithubSyncDiff,
    type LocalRowEntry,
    type SyncStrategy,
} from './githubSyncDiff.js';

/** 同步结果统计 */
export interface GithubSyncResult {
    /** 远程总条目数 */
    remoteTotal: number;
    /** 新增条目数 */
    added: number;
    /** 更新条目数 */
    updated: number;
    /** 删除条目数（mirror 策略） */
    deleted: number;
    /** 无变更条目数 */
    unchanged: number;
    /** 跳过条目数（无 SID 或无效） */
    skipped: number;
    /** 失败条目数 */
    failed: number;
}

/** HTTP 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * 从 GitHub Raw 下载 JSONL 文件
 *
 * JSONL（JSON Lines）格式：每行一个独立的 JSON 对象。
 * 解析时按行分割，逐行 JSON.parse，跳过空行，非法行不中断整体解析。
 *
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export function fetchGithubJson(): Promise<GithubRemoteEntry[]> {
    return new Promise<GithubRemoteEntry[]>((resolve, reject) => {
        let url: string;
        try {
            if (!isGithubConfigComplete()) {
                throw new Error('GitHub 仓库配置不完整');
            }
            url = buildRawUrl();
        } catch (e: unknown) {
            reject(e instanceof Error ? e : new Error(String(e)));
            return;
        }

        bgmLog(LOG_LEVELS.INFO, `[githubSync] 开始下载: ${url}`);
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = REQUEST_TIMEOUT_MS;
        xhr.setRequestHeader('Accept', 'application/json');

        xhr.onload = (): void => {
            if (xhr.status === 200) {
                try {
                    const { entries, errors } = parseJsonl(xhr.responseText);
                    if (entries.length === 0 && errors.length > 0) {
                        reject(new Error(
                            `JSONL 解析失败：${errors.length} 行全部非法。` +
                            `首行错误（第 ${errors[0]?.line} 行）：${errors[0]?.reason}`
                        ));
                        return;
                    }
                    if (errors.length > 0) {
                        bgmLog(LOG_LEVELS.WARN,
                            `[githubSync] JSONL 解析完成：${entries.length} 条合法，${errors.length} 行非法（已跳过）。` +
                            `首行错误（第 ${errors[0]?.line} 行）：${errors[0]?.reason}`
                        );
                    } else {
                        bgmLog(LOG_LEVELS.INFO, `[githubSync] 下载成功：${entries.length} 条记录`);
                    }
                    resolve(entries);
                } catch (e: unknown) {
                    reject(new Error(`JSONL 解析失败: ${e instanceof Error ? e.message : String(e)}`));
                }
            } else if (xhr.status === 404) {
                reject(new Error(`文件不存在（404）：${url}，请检查 owner/repo/branch/path 配置`));
            } else if (xhr.status === 403) {
                reject(new Error(`访问被拒（403）：可能是私有仓库或触发 GitHub 限流（未认证 60次/小时/IP）`));
            } else {
                reject(new Error(`HTTP 错误 ${xhr.status}: ${xhr.statusText}`));
            }
        };

        xhr.onerror = (): void => {
            reject(new Error(`网络请求失败：${url}（可能是 CORS 或网络不通）`));
        };

        xhr.ontimeout = (): void => {
            reject(new Error(`请求超时（${REQUEST_TIMEOUT_MS}ms）：${url}`));
        };

        xhr.send();
    });
}

// ========== 本地数据读取 ==========

/**
 * 读取本地 Excel 工作表的所有条目（按 SID 索引）
 * @param ws 工作表
 * @param colMap 列映射
 * @param headerRow 表头行
 * @param lastRow 最后数据行
 * @returns SID → 本地行条目 的映射
 */
function readLocalEntries(
    ws: WpsWorksheet,
    colMap: Map<string, number>,
    headerRow: number,
    lastRow: number
): Map<string, LocalRowEntry> {
    const result = new Map<string, LocalRowEntry>();
    const startRow = headerRow + 1;

    /** 读取单元格值并 trim */
    const getField = (row: number, key: string): string => {
        const col = colMap.get(key);
        if (!col) return '';
        return trim(getCellValue(ws, row, col));
    };

    for (let row = startRow; row <= lastRow; row++) {
        const url = getField(row, 'Bangumi_URL');
        if (!url) continue;
        const sid = extractSubjectId(url);
        if (!sid) continue;

        result.set(sid, {
            row,
            sid,
            fields: {
                Bangumi_URL: url,
                名称: getField(row, '名称'),
                是否看完: getField(row, '是否看完') || getField(row, '状态') || getField(row, '观看状态'),
                打分: getField(row, '打分'),
                '标签/分级': getField(row, '标签/分级'),
                '剧透/感言': getField(row, '剧透/感言') || getField(row, '感想') || getField(row, '评价'),
                集数: getField(row, '集数'),
                集号: getField(row, '集号'),
            },
        });
    }

    bgmLog(LOG_LEVELS.INFO, `[githubSync] 本地读取完成：${result.size} 条有效记录`);
    return result;
}

/**
 * 内部读取本地条目（供外部调用，封装为纯函数入口）
 */
export function readLocalEntriesForSync(): { entries: Map<string, LocalRowEntry>; lastRow: number } | null {
    const ws = getDataSheet();
    if (!ws) return null;
    const headerRow = findHeaderRow(ws) || 1;
    const lastRow = getLastRow(ws);
    const colMap = getColumnMap(ws, headerRow);
    if (!colMap.has('Bangumi_URL')) {
        bgmLog(LOG_LEVELS.ERROR, '[githubSync] 未找到 Bangumi_URL 列');
        return null;
    }
    const entries = readLocalEntries(ws, colMap, headerRow, lastRow);
    return { entries, lastRow };
}

// ========== 应用差异到工作表 ==========

/**
 * 将单条远程条目数据写入指定行的指定字段
 * @param ws 工作表
 * @param colMap 列映射
 * @param row 行号
 * @param remote 远程条目
 * @param fieldsToWrite 要写入的字段列表（含 '*' 表示写入所有字段）
 * @param forceOverwrite 是否强制覆盖（true 时远程空值也清空本地；false 时远程空值跳过）
 */
function writeRemoteEntryToRow(
    ws: WpsWorksheet,
    colMap: Map<string, number>,
    row: number,
    remote: GithubRemoteEntry,
    fieldsToWrite: string[],
    forceOverwrite: boolean
): void {
    /** 安全写入：列存在时写入值（forceOverwrite=true 时空值也写入清空本地） */
    const safeSet = (key: string, value: string): void => {
        const col = colMap.get(key);
        if (!col) return;
        if (!forceOverwrite && !value) return;
        setCellValue(ws, row, col, value);
    };

    const writeAll = fieldsToWrite.includes('*');

    // URL
    if (writeAll || fieldsToWrite.includes('Bangumi_URL')) {
        safeSet('Bangumi_URL', remote.url ?? '');
    }
    // 名称
    if (writeAll || fieldsToWrite.includes('名称')) {
        safeSet('名称', remote.name ?? '');
    }
    // 观看状态
    if (writeAll || fieldsToWrite.includes('是否看完')) {
        const status = remote.type !== undefined ? mapTypeToWatchStatus(remote.type) : '';
        safeSet('是否看完', status);
    }
    // 打分
    if (writeAll || fieldsToWrite.includes('打分')) {
        safeSet('打分', remote.score !== undefined ? String(remote.score) : '');
    }
    // 标签
    if (writeAll || fieldsToWrite.includes('标签/分级')) {
        safeSet('标签/分级', tagsToString(remote.tags));
    }
    // 评论
    if (writeAll || fieldsToWrite.includes('剧透/感言')) {
        safeSet('剧透/感言', remote.comment ?? '');
    }
    // 集数
    if (writeAll || fieldsToWrite.includes('集数')) {
        safeSet('集数', remote.episode !== undefined ? String(remote.episode) : '');
    }
}

/**
 * 应用 diff 到 Excel 工作表
 * @param diffs 差异列表
 * @param strategy 同步策略（决定 force-overwrite 与 delete 行为）
 * @param onProgress 进度回调（current, total, message）
 * @returns 同步结果统计
 */
export function applyDiffToSheet(
    diffs: GithubSyncDiff[],
    strategy: SyncStrategy,
    onProgress?: (current: number, total: number, message: string) => void
): GithubSyncResult {
    const result: GithubSyncResult = {
        remoteTotal: 0,
        added: 0,
        updated: 0,
        deleted: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
    };

    const ws = getDataSheet();
    if (!ws) {
        bgmLog(LOG_LEVELS.ERROR, '[githubSync] applyDiffToSheet: 未找到数据工作表');
        result.failed = diffs.length;
        return result;
    }

    const headerRow = findHeaderRow(ws) || 1;
    const lastRow = getLastRow(ws);
    const colMap = getColumnMap(ws, headerRow);
    let nextAppendRow = lastRow + 1;
    const forceOverwrite = strategy === 'force-overwrite';

    // delete 操作需倒序执行（从大行号到小行号），避免行号错位
    const sortedDiffs = [...diffs].sort((a, b) => {
        const aRow = a.localRow ?? Number.MAX_SAFE_INTEGER;
        const bRow = b.localRow ?? Number.MAX_SAFE_INTEGER;
        return bRow - aRow;
    });

    const total = diffs.length;
    sortedDiffs.forEach((diff, idx) => {
        try {
            if (diff.kind === 'add' && diff.remote) {
                // 新增：追加到末尾
                writeRemoteEntryToRow(ws, colMap, nextAppendRow, diff.remote, ['*'], forceOverwrite);
                nextAppendRow++;
                result.added++;
                onProgress?.(idx + 1, total, `新增 ${diff.remote.name ?? diff.sid}`);
            } else if (diff.kind === 'update' && diff.localRow !== undefined && diff.remote) {
                // 更新：仅写入变更字段
                writeRemoteEntryToRow(ws, colMap, diff.localRow, diff.remote, diff.changedFields, forceOverwrite);
                result.updated++;
                onProgress?.(idx + 1, total, `更新 ${diff.remote.name ?? diff.sid}`);
            } else if (diff.kind === 'delete' && diff.localRow !== undefined) {
                // 删除：删除整行（mirror 策略）
                try {
                    const rowRange = ws.Rows.Item(diff.localRow);
                    // WPS Row 没有 Delete 方法，通过 Range 删除整行
                    ws.Range(`${diff.localRow}:${diff.localRow}`).Delete();
                    void rowRange; // 仅用于类型存在性引用
                    result.deleted++;
                    onProgress?.(idx + 1, total, `删除 行${diff.localRow} sid=${diff.sid}`);
                } catch (e: unknown) {
                    bgmLog(LOG_LEVELS.WARN, `[githubSync] 删除行 ${diff.localRow} 失败: ${e instanceof Error ? e.message : String(e)}`);
                    result.failed++;
                }
            } else {
                result.skipped++;
            }
        } catch (e: unknown) {
            result.failed++;
            bgmLog(LOG_LEVELS.ERROR, `[githubSync] 应用差异失败 sid=${diff.sid}: ${e instanceof Error ? e.message : String(e)}`);
        }
    });

    bgmLog(LOG_LEVELS.INFO, `[githubSync] 应用完成: 新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}，失败 ${result.failed}`);
    return result;
}

/**
 * GitHub 同步主入口（供 ribbonService 调用）
 * @param onProgress 进度回调
 * @param strategy 同步策略，默认 'add-update'
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误时抛出
 */
export async function syncFromGithub(
    onProgress?: (current: number, total: number, message: string) => void,
    strategy: SyncStrategy = 'add-update'
): Promise<GithubSyncResult> {
    onProgress?.(0, 0, `开始下载远程数据（策略：${strategy}）...`);

    const remoteEntries = await fetchGithubJson();
    onProgress?.(1, 3, `下载完成：${remoteEntries.length} 条`);

    const local = readLocalEntriesForSync();
    if (!local) {
        throw new Error('无法读取本地工作表数据');
    }

    onProgress?.(2, 3, '比对差异中...');
    const diffs = computeDiff(remoteEntries, local.entries, strategy);
    const addCount = diffs.filter(d => d.kind === 'add').length;
    const updateCount = diffs.filter(d => d.kind === 'update').length;
    const deleteCount = diffs.filter(d => d.kind === 'delete').length;
    bgmLog(LOG_LEVELS.INFO, `[githubSync] diff 完成（${strategy}）：新增 ${addCount}，更新 ${updateCount}，删除 ${deleteCount}`);

    const result = applyDiffToSheet(diffs, strategy, onProgress);
    result.remoteTotal = remoteEntries.length;
    // unchanged = 远程总数 - (新增+更新)（delete 不计入 unchanged）
    result.unchanged = Math.max(0, remoteEntries.length - addCount - updateCount);

    onProgress?.(3, 3, `完成：新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}`);
    return result;
}
