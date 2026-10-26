/**
 * @fileoverview 富化引擎 · 新番表 ↔ Bangumi 追踪表条目匹配
 * @module sync/enrichMatching
 * @description 从 enrich-engine.ts 拆出的「匹配组」：读新番表一行、构建 Bangumi
 *              追踪表的名称/别名索引、按「精确名称 → 别名」双重策略匹配条目。
 *
 *              依赖（单向，无反向环）：enrich-layout.js（列映射 / findAliasColumn）。
 *
 * @author BGM Development Team
 */
import { LOG_LEVELS } from '../core/constants.js';
import { BGM, bgmLog, findHeaderRow, getCellValue, getLastRow, readRangeValues, } from '../tools/util/index.js';
import { findAliasColumn, getBangumiColumnMap, readPlatformValues } from './enrich-layout.js';
import { normalizeName, splitAliases, TAG_SEPARATOR } from './enrich-normalize.js';
// ========== 类型定义 ==========
/**
 * 读取新番表一行数据
 */
export function readNewAnimeRow(sheet, row, mapping, rowCells) {
    const cell = (column) => rowCells?.[column - 1] ?? getCellValue(sheet, row, column);
    const data = { 名称: cell(mapping.nameColumn) || '' };
    if (mapping.tagsColumn)
        data.TAGS = cell(mapping.tagsColumn) || '';
    if (mapping.premiereCol)
        data['首播'] = cell(mapping.premiereCol) || '';
    if (mapping.episodesColumn)
        data['集数'] = cell(mapping.episodesColumn) || '';
    if (mapping.weekdayCol)
        data['周更时间'] = cell(mapping.weekdayCol) || '';
    // 播放平台聚合：platformCol + platformExtraCols + exclusiveCol 去空去重（富化与预览共用口径）
    data['播放平台'] = readPlatformValues(sheet, row, mapping, rowCells).join(TAG_SEPARATOR);
    if (mapping.exclusiveCol)
        data['独播'] = cell(mapping.exclusiveCol) || '';
    if (mapping.specialCol)
        data['特殊'] = cell(mapping.specialCol) || '';
    return data;
}
/**
 * 构建 Bangumi 追踪表的索引
 * 返回 [名称索引, 别名索引]
 */
function buildBangumiIndexes(bangumiSheet, columnMap) {
    const nameIndex = new Map();
    const aliasIndex = new Map();
    const rowNames = new Map();
    // 反向索引：行号 → 该行的全部别名。有它「按行取别名」才是 O(1)；
    // 否则 matchEntriesInner 每命中一条都要遍历整个 aliasIndex 做 rows.includes(row) —— O(n²)。
    const aliasByRow = new Map();
    const nameColumn = columnMap.get('名称') ?? 0;
    if (nameColumn === 0) {
        bgmLog(LOG_LEVELS.WARN, '[buildBangumiIndexes] Bangumi表中未找到名称列');
        return [nameIndex, aliasIndex, rowNames, aliasByRow];
    }
    const aliasColumn = findAliasColumn(bangumiSheet);
    const lastRow = getLastRow(bangumiSheet);
    // 性能（P1-C）：一次矩形读取覆盖名称列与别名列，替代逐行 1~2 次 getCellValue
    const allData = lastRow >= 2
        ? readRangeValues(bangumiSheet, 2, lastRow, 1, Math.max(nameColumn, aliasColumn))
        : [];
    for (const [index, rowData] of allData.entries()) {
        const row = index + 2;
        const name = (rowData[nameColumn - 1] ?? '').trim();
        if (name) {
            const normalizedName = normalizeName(name);
            nameIndex.set(normalizedName, row);
            rowNames.set(row, name);
            if (aliasColumn > 0) {
                const aliasString = (rowData[aliasColumn - 1] ?? '').trim();
                if (aliasString) {
                    const aliases = splitAliases(aliasString);
                    for (const alias of aliases) {
                        const normalizedAlias = normalizeName(alias);
                        if (!aliasIndex.has(normalizedAlias)) {
                            aliasIndex.set(normalizedAlias, []);
                        }
                        const rows = aliasIndex.get(normalizedAlias);
                        if (rows && !rows.includes(row)) {
                            rows.push(row);
                            const rowAliases = aliasByRow.get(row);
                            if (rowAliases) {
                                rowAliases.push(alias);
                            }
                            else {
                                aliasByRow.set(row, [alias]);
                            }
                        }
                    }
                }
            }
        }
    }
    bgmLog(LOG_LEVELS.INFO, `[buildBangumiIndexes] 名称索引: ${String(nameIndex.size)} 条, 别名索引: ${String(aliasIndex.size)} 条`);
    return [nameIndex, aliasIndex, rowNames, aliasByRow];
}
/**
 * 判断 Bangumi 目标表是否为空（有表头但无数据行）
 * 空表时富化流程会将新番表条目作为新行追加写入
 * @returns true 表示目标表只有表头、没有任何数据行
 */
export function isBangumiSheetEmpty(bangumiSheet) {
    const headerRow = findHeaderRow(bangumiSheet);
    if (headerRow <= 0)
        return false;
    const lastRow = getLastRow(bangumiSheet, true, headerRow);
    return lastRow <= headerRow;
}
/**
 * 匹配新番表与 Bangumi 追踪表条目
 */
export function matchEntries(animeSheet, bangumiSheet, config) {
    const results = [];
    try {
        matchEntriesInner(animeSheet, bangumiSheet, config, results);
    }
    catch (error) {
        BGM.handleError(error, { context: 'matchEntries', showAlert: false });
    }
    return results;
}
/**
 * matchEntries 主体（自 try 块抽离，降低 unicorn/try-complexity 计数）
 */
function matchEntriesInner(animeSheet, bangumiSheet, config, results) {
    const bangumiColumnMap = getBangumiColumnMap(bangumiSheet);
    const [nameIndex, aliasIndex, rowNames, aliasByRow] = buildBangumiIndexes(bangumiSheet, bangumiColumnMap);
    const lastRow = getLastRow(animeSheet);
    const { dataStartRow } = config;
    const { nameColumn } = config.columnMapping;
    if (nameColumn === 0) {
        bgmLog(LOG_LEVELS.ERROR, '[matchEntries] 新番表未找到名称列，无法匹配');
        return;
    }
    for (let row = dataStartRow; row <= lastRow; row += 1) {
        const rawName = getCellValue(animeSheet, row, nameColumn).trim();
        if (rawName) {
            const normalizedName = normalizeName(rawName);
            let matchResult = {
                animeRow: row,
                matchedAnimeName: rawName,
                matchType: 'unmatched',
            };
            try {
                // 精确匹配
                if (nameIndex.has(normalizedName)) {
                    const bangumiRow = nameIndex.get(normalizedName);
                    if (bangumiRow !== undefined) {
                        const matchedName = rowNames.get(bangumiRow);
                        matchResult = {
                            animeRow: row,
                            matchedAnimeName: rawName,
                            matchType: 'exact',
                            bangumiRow,
                            ...(matchedName !== undefined && { bangumiName: matchedName }),
                        };
                    }
                }
                // 别名匹配
                if (matchResult.matchType === 'unmatched') {
                    const aliasRows = aliasIndex.get(normalizedName);
                    if (aliasRows && aliasRows.length > 0) {
                        const bangumiRow = aliasRows[0];
                        if (bangumiRow !== undefined) {
                            // 反向索引 O(1) 取该行别名（原先遍历整个 aliasIndex 做 includes，是 O(n²)）
                            const aliases = aliasByRow.get(bangumiRow) ?? [];
                            const matchedName = rowNames.get(bangumiRow);
                            matchResult = {
                                animeRow: row,
                                matchedAnimeName: rawName,
                                matchType: 'alias',
                                bangumiRow,
                                ...(matchedName !== undefined && { bangumiName: matchedName }),
                                aliases,
                            };
                        }
                    }
                }
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                matchResult = {
                    animeRow: row,
                    matchedAnimeName: rawName,
                    matchType: 'error',
                    errorMessage,
                };
                bgmLog(LOG_LEVELS.ERROR, `[matchEntries] 匹配 "${rawName}" 时出错: ${errorMessage}`);
            }
            results.push(matchResult);
        }
    }
    const unmatchedCount = results.filter((r) => r.matchType === 'unmatched').length;
    const errorCount = results.filter((r) => r.matchType === 'error').length;
    bgmLog(LOG_LEVELS.INFO, `[matchEntries] 匹配完成：精确 ${String(results.filter((r) => r.matchType === 'exact').length)} 条, ` +
        `别名 ${String(results.filter((r) => r.matchType === 'alias').length)} 条, ` +
        `未匹配 ${String(unmatchedCount)} 条, 错误 ${String(errorCount)} 条, 共 ${String(results.length)} 条`);
}
