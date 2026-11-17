/**
 * @fileoverview 喜好推荐纯函数（基于已看条目的标签权重）
 * @module services/dataCenterRecommend
 * @description 从候选库里挑出与用户喜好最接近、且不在排除集里的条目，附推荐理由。
 *              纯数据逻辑，不碰 COM / DOM / i18n；理由Text 由 UI 层用 tOr 组装。
 */
import { buildPreferenceProfile, normalizeWatchStatus } from './data-center-stats.js';
/** 标签分隔符，与 stats 模块一致 */
const TAG_SEPARATORS = /[,，、/|]+/u;
/** 取一条记录的标签集合（小写归一） */
function tagsOf(record) {
    const tags = new Set();
    for (const rawTag of record.tags.split(TAG_SEPARATORS)) {
        const tag = rawTag.trim().toLowerCase();
        if (tag !== '')
            tags.add(tag);
    }
    return tags;
}
/**
 * 生成推荐：
 *  1. 用「看过」条目建喜好画像（标签 → 权重）；
 *  2. 排除已看过的 SID 与外部指定 SID；
 *  3. 对候选按命中标签权重求和打分，取分数 > 0 的前 limit 条。
 *
 * 没有画像（一条看过记录都没有或都没标签）时返回空数组，UI 层提示先积累数据。
 */
export function recommendByPreference(sourceRecords, candidates, options = {}) {
    const profile = buildPreferenceProfile(sourceRecords);
    if (profile.topTags.length === 0)
        return [];
    const weightByTag = new Map(profile.topTags.map(({ tag, weight }) => [tag, weight]));
    const excluded = new Set();
    if (options.excludeSids !== undefined) {
        for (const subjectId of options.excludeSids)
            excluded.add(subjectId);
    }
    for (const record of sourceRecords) {
        if (normalizeWatchStatus(record.watchStatus) === 2)
            excluded.add(record.sid);
    }
    const limit = options.limit ?? 8;
    const eligible = candidates.filter((candidate) => !excluded.has(candidate.sid));
    const scored = [];
    for (const candidate of eligible) {
        const candidateTags = tagsOf(candidate);
        let score = 0;
        const matched = [];
        for (const tag of candidateTags) {
            const weight = weightByTag.get(tag);
            if (weight !== undefined) {
                score += weight;
                matched.push(tag);
            }
        }
        if (score > 0) {
            scored.push({ sid: candidate.sid, name: candidate.name, matchedTags: matched, score });
        }
    }
    scored.sort((left, right) => {
        if (left.score !== right.score)
            return right.score - left.score;
        if (left.name < right.name)
            return -1;
        if (left.name > right.name)
            return 1;
        return 0;
    });
    return scored.slice(0, limit);
}
