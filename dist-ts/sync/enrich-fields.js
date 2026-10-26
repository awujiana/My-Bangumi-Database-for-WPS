/**
 * @fileoverview 富化引擎 · 逐字段写入（标签 / 平台 / 日期 / 集数 / 特点）
 * @module sync/enrichFields
 * @description 从 enrich-engine.ts 拆出的「字段富化组」：把匹配到的新番数据按列
 *              写入 Bangumi 追踪表，统一走「空值填充 + 有值合并（去重）」的口径。
 *
 *              依赖（单向，无反向环）：enrich-cells.js（单元格读写，含会话缓存
 *              写穿透）、enrich-normalize.js（标签/特点合并）、enrich-types.js。
 *
 * @author BGM Development Team
 */
import { isEmptyValue } from '../tools/util/index.js';
import { readTargetCell, writeTargetCell } from './enrich-cells.js';
import { appendFeatures, FEATURE_SEPARATOR, mergeTags } from './enrich-normalize.js';
/**
 * 富化标签
 * 追加模式（现有 + TAG_SEPARATOR + 新标签，去重），空值时填充
 */
export function enrichTags(sheet, row, incomingData, columnMap, enriched, cache) {
    const bangumiTagsColumn = columnMap.get('标签/分级') ?? columnMap.get('标签');
    if (!bangumiTagsColumn)
        return;
    const incomingTags = incomingData.TAGS ?? '';
    if (isEmptyValue(incomingTags))
        return;
    const oldTags = readTargetCell(sheet, cache, row, bangumiTagsColumn);
    if (isEmptyValue(oldTags)) {
        writeTargetCell(sheet, cache, row, bangumiTagsColumn, incomingTags);
        enriched.push({
            fieldName: '标签/分级',
            bangumiColumn: bangumiTagsColumn,
            oldValue: null,
            updatedValue: incomingTags,
            action: 'fill',
        });
    }
    else {
        const merged = mergeTags(oldTags, incomingTags);
        if (merged === oldTags) {
            enriched.push({
                fieldName: '标签/分级',
                bangumiColumn: bangumiTagsColumn,
                oldValue: oldTags,
                updatedValue: merged,
                action: 'skip',
            });
        }
        else {
            writeTargetCell(sheet, cache, row, bangumiTagsColumn, merged);
            enriched.push({
                fieldName: '标签/分级',
                bangumiColumn: bangumiTagsColumn,
                oldValue: oldTags,
                updatedValue: merged,
                action: 'append',
            });
        }
    }
}
/**
 * 富化播放平台
 * 写入 Bangumi 表「在线播放平台」列；目标单元格已有值时合并去重，不重复写入已有平台
 */
export function enrichPlatform(sheet, row, incomingData, columnMap, enriched, cache) {
    const targetColumn = columnMap.get('在线播放平台') ?? columnMap.get('播放平台');
    if (!targetColumn)
        return;
    const incomingPlatforms = incomingData['播放平台'] ?? '';
    if (isEmptyValue(incomingPlatforms))
        return;
    const oldPlatforms = readTargetCell(sheet, cache, row, targetColumn);
    if (isEmptyValue(oldPlatforms)) {
        writeTargetCell(sheet, cache, row, targetColumn, incomingPlatforms);
        enriched.push({
            fieldName: '在线播放平台',
            bangumiColumn: targetColumn,
            oldValue: null,
            updatedValue: incomingPlatforms,
            action: 'fill',
        });
    }
    else {
        const merged = mergeTags(oldPlatforms, incomingPlatforms);
        if (merged === oldPlatforms) {
            enriched.push({
                fieldName: '在线播放平台',
                bangumiColumn: targetColumn,
                oldValue: oldPlatforms,
                updatedValue: merged,
                action: 'skip',
            });
        }
        else {
            writeTargetCell(sheet, cache, row, targetColumn, merged);
            enriched.push({
                fieldName: '在线播放平台',
                bangumiColumn: targetColumn,
                oldValue: oldPlatforms,
                updatedValue: merged,
                action: 'append',
            });
        }
    }
}
/**
 * 富化首播日期
 * 仅在 Bangumi 列为空时填充
 */
export function enrichDate(sheet, row, incomingData, columnMap, enriched, cache) {
    const bangumiDateColumn = columnMap.get('开播日期');
    if (!bangumiDateColumn)
        return;
    const date = incomingData['首播'] ?? '';
    if (isEmptyValue(date))
        return;
    const oldDate = readTargetCell(sheet, cache, row, bangumiDateColumn);
    if (isEmptyValue(oldDate)) {
        writeTargetCell(sheet, cache, row, bangumiDateColumn, date);
        enriched.push({
            fieldName: '开播日期',
            bangumiColumn: bangumiDateColumn,
            oldValue: null,
            updatedValue: date,
            action: 'fill',
        });
    }
    else {
        enriched.push({
            fieldName: '开播日期',
            bangumiColumn: bangumiDateColumn,
            oldValue: oldDate,
            updatedValue: date,
            action: 'skip',
        });
    }
}
/**
 * 富化集数
 * 仅在 Bangumi 列为空时填充
 */
export function enrichEpisodes(sheet, row, incomingData, columnMap, enriched, cache) {
    const bangumiEpisodesColumn = columnMap.get('集数');
    if (!bangumiEpisodesColumn)
        return;
    const incomingEpisodes = incomingData['集数'] ?? '';
    if (isEmptyValue(incomingEpisodes))
        return;
    const oldEpisodes = readTargetCell(sheet, cache, row, bangumiEpisodesColumn);
    if (isEmptyValue(oldEpisodes)) {
        writeTargetCell(sheet, cache, row, bangumiEpisodesColumn, incomingEpisodes);
        enriched.push({
            fieldName: '集数',
            bangumiColumn: bangumiEpisodesColumn,
            oldValue: null,
            updatedValue: incomingEpisodes,
            action: 'fill',
        });
    }
    else {
        enriched.push({
            fieldName: '集数',
            bangumiColumn: bangumiEpisodesColumn,
            oldValue: oldEpisodes,
            updatedValue: incomingEpisodes,
            action: 'skip',
        });
    }
}
/**
 * 富化特点/印象
 * 追加模式（收集周更/平台/独播/特殊信息，以 FEATURE_SEPARATOR 分隔）
 */
export function enrichFeatures(sheet, row, incomingData, columnMap, enriched, cache) {
    const bangumiFeatureColumn = columnMap.get('特点/印象');
    if (!bangumiFeatureColumn)
        return;
    const featureParts = [];
    const weekday = incomingData['周更时间'] ?? '';
    if (!isEmptyValue(weekday)) {
        featureParts.push(`周更:${weekday}`);
    }
    const platform = incomingData['播放平台'] ?? '';
    if (!isEmptyValue(platform)) {
        featureParts.push(`平台:${platform}`);
    }
    const exclusive = incomingData['独播'] ?? '';
    if (!isEmptyValue(exclusive)) {
        featureParts.push(`独播:${exclusive}`);
    }
    const special = incomingData['特殊'] ?? '';
    if (!isEmptyValue(special)) {
        featureParts.push(`特殊:${special}`);
    }
    if (featureParts.length === 0)
        return;
    const features = featureParts.join(FEATURE_SEPARATOR);
    const oldFeature = readTargetCell(sheet, cache, row, bangumiFeatureColumn);
    if (isEmptyValue(oldFeature)) {
        writeTargetCell(sheet, cache, row, bangumiFeatureColumn, features);
        enriched.push({
            fieldName: '特点/印象',
            bangumiColumn: bangumiFeatureColumn,
            oldValue: null,
            updatedValue: features,
            action: 'fill',
        });
    }
    else {
        const merged = appendFeatures(oldFeature, features);
        if (merged === oldFeature) {
            enriched.push({
                fieldName: '特点/印象',
                bangumiColumn: bangumiFeatureColumn,
                oldValue: oldFeature,
                updatedValue: merged,
                action: 'skip',
            });
        }
        else {
            writeTargetCell(sheet, cache, row, bangumiFeatureColumn, merged);
            enriched.push({
                fieldName: '特点/印象',
                bangumiColumn: bangumiFeatureColumn,
                oldValue: oldFeature,
                updatedValue: merged,
                action: 'append',
            });
        }
    }
}
