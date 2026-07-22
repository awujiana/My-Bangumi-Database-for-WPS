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
import { Result, BgmError } from '../core/result.js';
import { bgmLog, getDataSheet, findHeaderRow, getLastRow, getColumnMap, getCellValue, setCellValue, trim, } from '../tools/util.js';
import { buildRawUrl, isGithubConfigComplete, getSyncSourceType } from './githubConfig.js';
import { computeDiff, mapTypeToWatchStatus, tagsToString, parseJsonl, } from './githubSyncDiff.js';
import { extractSubjectId } from './pureUtils.js';
import { getSyncSource } from './syncSourceRegistry.js';
import { beginUndoSession, endUndoSession, recordUndoEntry } from './undoStack.js';
// 类型导入：避免运行时循环依赖（githubSync → ribbonService → index → githubSync）
// 纯函数与类型从 githubSyncDiff.ts re-export，避免重复定义
// githubSyncDiff.ts 为零依赖纯模块，可在 Node 测试环境中直接运行
export { computeDiff, mapTypeToWatchStatus, tagsToString, parseJsonl, isGithubRemoteEntry, SYNC_STRATEGY_LABELS, } from './githubSyncDiff.js';
/** HTTP 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 30000;
/**
 * 从 GitHub Raw 下载 JSONL 文件
 *
 * JSONL（JSON Lines）格式：每行一个独立的 JSON 对象。
 * 解析时按行分割，逐行 JSON.parse，跳过空行，非法行不中断整体解析。
 *
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export function fetchGithubJson(signal) {
    return new Promise((resolve, reject) => {
        let url;
        try {
            if (!isGithubConfigComplete()) {
                throw new Error('GitHub 仓库配置不完整');
            }
            url = buildRawUrl();
        }
        catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
            return;
        }
        // 如果 signal 已 aborted，立即 reject
        if (signal?.aborted) {
            reject(new Error('请求被取消'));
            return;
        }
        bgmLog(LOG_LEVELS.INFO, `[githubSync] 开始下载: ${url}`);
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = REQUEST_TIMEOUT_MS;
        xhr.setRequestHeader('Accept', 'application/json');
        // AbortSignal 支持：监听 abort 事件触发 xhr.abort()
        if (signal) {
            signal.addEventListener('abort', () => {
                xhr.abort();
            });
        }
        xhr.onload = () => {
            if (xhr.status === 200) {
                try {
                    const { entries, errors } = parseJsonl(xhr.responseText);
                    if (entries.length === 0 && errors.length > 0) {
                        reject(new Error(`JSONL 解析失败：${errors.length} 行全部非法。` +
                            `首行错误（第 ${errors[0]?.line} 行）：${errors[0]?.reason}`));
                        return;
                    }
                    if (errors.length > 0) {
                        bgmLog(LOG_LEVELS.WARN, `[githubSync] JSONL 解析完成：${entries.length} 条合法，${errors.length} 行非法（已跳过）。` +
                            `首行错误（第 ${errors[0]?.line} 行）：${errors[0]?.reason}`);
                    }
                    else {
                        bgmLog(LOG_LEVELS.INFO, `[githubSync] 下载成功：${entries.length} 条记录`);
                    }
                    resolve(entries);
                }
                catch (e) {
                    reject(new Error(`JSONL 解析失败: ${e instanceof Error ? e.message : String(e)}`));
                }
            }
            else if (xhr.status === 404) {
                reject(new Error(`文件不存在（404）：${url}，请检查 owner/repo/branch/path 配置`));
            }
            else if (xhr.status === 403) {
                reject(new Error(`访问被拒（403）：可能是私有仓库或触发 GitHub 限流（未认证 60次/小时/IP）`));
            }
            else {
                reject(new Error(`HTTP 错误 ${xhr.status}: ${xhr.statusText}`));
            }
        };
        xhr.onerror = () => {
            // 如果是 abort 导致的 onerror，归类为取消
            if (signal?.aborted) {
                reject(new Error('请求被取消'));
                return;
            }
            reject(new Error(`网络请求失败：${url}（可能是 CORS 或网络不通）`));
        };
        xhr.ontimeout = () => {
            reject(new Error(`请求超时（${REQUEST_TIMEOUT_MS}ms）：${url}`));
        };
        xhr.send();
    });
}
// ========== SyncSource 接口实现 ==========
/**
 * GitHub 同步源实现
 *
 * 包装 fetchGithubJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 * 通过 syncFromGithub 主流程统一调用：
 * 1. validateConfig() 在下载前校验配置完整性
 * 2. fetchRemoteEntries() 复用既有 fetchGithubJson 实现，保持向后兼容
 */
export class GithubSyncSource {
    /** 数据源类型标识 */
    getSourceType() {
        return 'github';
    }
    /** 数据源显示名称（用于日志与进度提示） */
    getDisplayName() {
        return 'GitHub';
    }
    /**
     * 获取远程条目（委托给 fetchGithubJson）
     * @param signal 可选的 AbortSignal
     */
    async fetchRemoteEntries(signal) {
        return fetchGithubJson(signal);
    }
    /**
     * 校验配置是否完整可用
     * @returns 完整返回 Result.ok(undefined)，不完整返回 Result.fail(BgmError)
     */
    validateConfig() {
        if (!isGithubConfigComplete()) {
            return Result.failVoid(new BgmError('GitHub 仓库配置不完整，请填写 owner/repo/branch/path', 'CONFIG_INCOMPLETE'));
        }
        return Result.okVoid();
    }
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
function readLocalEntries(ws, colMap, headerRow, lastRow) {
    const result = new Map();
    const startRow = headerRow + 1;
    /** 读取单元格值并 trim */
    const getField = (row, key) => {
        const col = colMap.get(key);
        if (!col)
            return '';
        return trim(getCellValue(ws, row, col));
    };
    for (let row = startRow; row <= lastRow; row++) {
        const url = getField(row, 'Bangumi_URL');
        if (!url)
            continue;
        const sid = extractSubjectId(url);
        if (!sid)
            continue;
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
export function readLocalEntriesForSync() {
    const ws = getDataSheet();
    if (!ws)
        return null;
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
function writeRemoteEntryToRow(ws, colMap, row, remote, fieldsToWrite, forceOverwrite) {
    /** 安全写入：列存在时写入值（forceOverwrite=true 时空值也写入清空本地） */
    const safeSet = (key, value) => {
        const col = colMap.get(key);
        if (!col)
            return;
        if (!forceOverwrite && !value)
            return;
        // 记录 undo 条目（旧值 → 新值），便于撤销时恢复
        const oldValue = getCellValue(ws, row, col);
        recordUndoEntry({ row, col, oldValue, newValue: value });
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
export function applyDiffToSheet(diffs, strategy, onProgress) {
    const result = {
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
    // 开启 undo 会话：记录本次同步的所有单元格变更，便于用户撤销
    beginUndoSession(`GitHub 同步 - 策略: ${strategy}`);
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
            }
            else if (diff.kind === 'update' && diff.localRow !== undefined && diff.remote) {
                // 更新：仅写入变更字段
                writeRemoteEntryToRow(ws, colMap, diff.localRow, diff.remote, diff.changedFields, forceOverwrite);
                result.updated++;
                onProgress?.(idx + 1, total, `更新 ${diff.remote.name ?? diff.sid}`);
            }
            else if (diff.kind === 'delete' && diff.localRow !== undefined) {
                // 删除：删除整行（mirror 策略）
                // 先记录该行所有列的旧值，便于 undo 时按单元格恢复
                for (const col of colMap.values()) {
                    const oldValue = getCellValue(ws, diff.localRow, col);
                    recordUndoEntry({ row: diff.localRow, col, oldValue, newValue: '' });
                }
                try {
                    const rowRange = ws.Rows.Item(diff.localRow);
                    // WPS Row 没有 Delete 方法，通过 Range 删除整行
                    ws.Range(`${diff.localRow}:${diff.localRow}`).Delete();
                    void rowRange; // 仅用于类型存在性引用
                    result.deleted++;
                    onProgress?.(idx + 1, total, `删除 行${diff.localRow} sid=${diff.sid}`);
                }
                catch (e) {
                    bgmLog(LOG_LEVELS.WARN, `[githubSync] 删除行 ${diff.localRow} 失败: ${e instanceof Error ? e.message : String(e)}`);
                    result.failed++;
                }
            }
            else {
                result.skipped++;
            }
        }
        catch (e) {
            result.failed++;
            bgmLog(LOG_LEVELS.ERROR, `[githubSync] 应用差异失败 sid=${diff.sid}: ${e instanceof Error ? e.message : String(e)}`);
        }
    });
    // 结束 undo 会话（空会话不入栈）
    endUndoSession();
    bgmLog(LOG_LEVELS.INFO, `[githubSync] 应用完成: 新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}，失败 ${result.failed}`);
    return result;
}
/**
 * 根据用户冲突解决决策调整 diff 列表
 *
 * 处理规则：
 * - 仅作用于 kind === 'update' 且 changedFields 不为 ['*'] 的 diff（字段级更新）
 * - 对每个 resolution，找到 sid 与 field 匹配的 update diff：
 *   - chosenValue === 'local'：从 changedFields 中移除该 field（保留本地值）
 *   - chosenValue === 'remote'：保留该 field 在 changedFields 中（采用远程值）
 * - 若 update diff 的 changedFields 被清空，则从 diffs 中移除该 diff（无字段需更新）
 * - add/delete 与 force-overwrite（changedFields 为 ['*']）不受影响
 *
 * 本函数直接修改传入的 diffs 数组（in-place），同时返回该数组便于链式调用。
 *
 * @param diffs 差异列表（会被原地修改）
 * @param resolutions 用户冲突解决决策列表
 * @returns 调整后的差异列表（与输入为同一引用）
 */
export function applyConflictResolutions(diffs, resolutions) {
    if (!resolutions || resolutions.length === 0) {
        return diffs;
    }
    // 按 sid 索引 resolutions，便于 O(1) 查找
    const resolutionByKey = new Map();
    for (const r of resolutions) {
        resolutionByKey.set(`${r.sid}\u0000${r.field}`, r);
    }
    // 倒序遍历，便于安全移除元素
    for (let i = diffs.length - 1; i >= 0; i--) {
        const diff = diffs[i];
        if (!diff)
            continue;
        // 仅处理字段级 update（changedFields 不为 ['*']）
        if (diff.kind !== 'update')
            continue;
        if (diff.changedFields.length === 1 && diff.changedFields[0] === '*')
            continue;
        // 过滤掉用户选择「本地」的字段
        diff.changedFields = diff.changedFields.filter((field) => {
            const key = `${diff.sid}\u0000${field}`;
            const r = resolutionByKey.get(key);
            // 若存在 resolution 且选择 local，则移除该字段；否则保留
            return !(r && r.chosenValue === 'local');
        });
        // 若所有字段都被移除，则该 diff 无需执行
        if (diff.changedFields.length === 0) {
            diffs.splice(i, 1);
        }
    }
    return diffs;
}
/**
 * GitHub 同步主入口（供 ribbonService 调用）
 *
 * 通过 syncSourceRegistry 按 sourceType 动态选择 SyncSource 实现。
 * 默认 sourceType 为 'github'，由 syncSourceRegistry 注册的 GithubSyncSource 处理；
 * 未来 Task 22-25 注册的 GitLab/Gitee/本地文件/Gist 实现可无缝替换。
 *
 * @param onProgress 进度回调
 * @param strategy 同步策略，默认 'add-update'
 * @param signal 可选 AbortSignal，用于取消请求
 * @param conflictResolution 可选冲突解决决策列表；提供时将按用户选择过滤 update diff 的字段
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误、未知 sourceType 时抛出
 */
export async function syncFromGithub(onProgress, strategy = 'add-update', signal, conflictResolution) {
    // 1. 按 sourceType 从注册表获取 SyncSource 实例
    const sourceType = getSyncSourceType();
    const source = getSyncSource(sourceType);
    if (!source) {
        throw new Error(`未知的同步源类型: ${sourceType}`);
    }
    // 2. 调用 source.validateConfig() 校验配置完整性
    const validationResult = source.validateConfig();
    if (validationResult.isFail()) {
        const errMsg = validationResult.error?.message ?? `同步源 ${sourceType} 配置校验失败`;
        throw new Error(errMsg);
    }
    // 3. 调用 source.fetchRemoteEntries() 下载远程数据
    onProgress?.(0, 0, `开始下载远程数据（${source.getDisplayName()} - 策略：${strategy}）...`);
    const remoteEntries = await source.fetchRemoteEntries(signal);
    onProgress?.(1, 3, `下载完成：${remoteEntries.length} 条`);
    const local = readLocalEntriesForSync();
    if (!local) {
        throw new Error('无法读取本地工作表数据');
    }
    onProgress?.(2, 3, '比对差异中...');
    const diffs = computeDiff(remoteEntries, local.entries, strategy);
    // 应用用户冲突解决决策：过滤掉用户选择「本地」的字段
    if (conflictResolution && conflictResolution.length > 0) {
        applyConflictResolutions(diffs, conflictResolution);
        bgmLog(LOG_LEVELS.INFO, `[githubSync] 已应用 ${conflictResolution.length} 条冲突解决决策`);
    }
    const addCount = diffs.filter((d) => d.kind === 'add').length;
    const updateCount = diffs.filter((d) => d.kind === 'update').length;
    const deleteCount = diffs.filter((d) => d.kind === 'delete').length;
    bgmLog(LOG_LEVELS.INFO, `[githubSync] diff 完成（${strategy}）：新增 ${addCount}，更新 ${updateCount}，删除 ${deleteCount}`);
    const result = applyDiffToSheet(diffs, strategy, onProgress);
    result.remoteTotal = remoteEntries.length;
    // unchanged = 远程总数 - (新增+更新)（delete 不计入 unchanged）
    result.unchanged = Math.max(0, remoteEntries.length - addCount - updateCount);
    onProgress?.(3, 3, `完成：新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}`);
    return result;
}
