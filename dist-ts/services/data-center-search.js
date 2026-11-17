/**
 * @fileoverview 双源搜索纯逻辑（本地库 + Bangumi 在线结果归一化 / 过滤）
 * @module services/dataCenterSearch
 * @description 搜索表单字段全部选填，但至少填一项才执行（由 UI 层拦截空表单）。
 *              在线 HTTP 请求通过注入的 fetcher 完成，本模块只做查询串构造与结果归一化。
 */
/** 判断表单是否至少填了一项有效条件 */
export function hasAnyCriterion(query) {
    return ((query.keyword?.trim() ?? '') !== '' ||
        (query.kind !== undefined && query.kind !== 'all') ||
        query.year !== undefined ||
        query.minRating !== undefined ||
        query.status !== undefined);
}
/** 构造 Bangumi 搜索 URL（api.bgm.tv，CSP 已允许；关键词需编码） */
export function buildBangumiSearchUrl(keyword, kind) {
    const encoded = encodeURIComponent(keyword.trim());
    // Bangumi v0 搜索接口：type=2 动漫、type=4 电视剧、type=6 电影；all 不传 type
    const typeByKind = {
        all: '',
        anime: '&type=2',
        tv: '&type=4',
        movie: '&type=6',
    };
    const typeParameter = typeByKind[kind];
    // 用 large 才会返回 rating.score 与 summary；small 只有名字/图片
    return `https://api.bgm.tv/search/subject/${encoded}?responseGroup=large${typeParameter}`;
}
/** Bangumi platform 字段 → 统一类型 */
export function kindFromPlatform(platform) {
    if (platform === undefined)
        return 'anime';
    const text = platform.toLowerCase();
    if (text.includes('电影') || text.includes('movie'))
        return 'movie';
    if (text.includes('电视剧') || text.includes('tv') || text.includes('剧集'))
        return 'tv';
    return 'anime';
}
/** Bangumi type 码 → 统一类型（2 动漫 / 4 电视剧 / 6 电影，其余按动漫） */
export function kindFromBangumiType(bangumiType) {
    if (bangumiType === 4)
        return 'tv';
    if (bangumiType === 6)
        return 'movie';
    return 'anime';
}
/** 把在线原始条目归一化为统一结果 */
export function normalizeOnlineEntry(entry) {
    const kind = entry.bangumiType === undefined ? kindFromPlatform(entry.platform) : kindFromBangumiType(entry.bangumiType);
    return {
        sid: String(entry.id),
        name: entry.name,
        kind,
        year: (entry.airDate ?? '').slice(0, 4),
        rating: entry.rating === undefined ? '' : String(entry.rating),
        source: 'online',
        ...(entry.summary !== undefined && { summary: entry.summary }),
    };
}
/** 本地记录 → 统一搜索结果 */
export function localRecordToResult(record) {
    return {
        sid: record.sid,
        name: record.name,
        kind: 'anime',
        year: record.date.slice(0, 4),
        rating: '',
        source: 'local',
    };
}
/** 按表单条件过滤一组统一结果 */
export function filterResults(results, query) {
    const keyword = (query.keyword ?? '').trim().toLowerCase();
    return results.filter((result) => {
        if (keyword !== '' && !result.name.toLowerCase().includes(keyword))
            return false;
        if (query.kind !== undefined && query.kind !== 'all' && result.kind !== query.kind)
            return false;
        if (query.year !== undefined && result.year !== '' && Number(result.year) !== query.year)
            return false;
        if (query.minRating !== undefined &&
            result.rating !== '' &&
            Number(result.rating) < query.minRating) {
            return false;
        }
        return true;
    });
}
/** 合并本地与在线结果并按名称去重（本地优先） */
export function mergeResults(local, online) {
    const seen = new Set();
    const merged = [];
    for (const result of [...local, ...online]) {
        const key = result.name.trim().toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(result);
        }
    }
    return merged;
}
