/**
 * @fileoverview 搜索结果写入工作表的纯逻辑（行数据构造 + 表头定义）
 * @module services/dataCenterExport
 * @description 只做「结果 → 二维数组」的纯转换，不碰 COM / DOM / i18n，便于单测。
 *              实际写表由 panel 层的薄封装负责，用一次 Range.Value2 矩形写减少 COM 往返。
 */
/** 搜索结果表的固定列名（简体兜底；写入 Excel 用源语言，避免语言漂移） */
export const SEARCH_RESULT_HEADERS = [
    '名称',
    'ID',
    '类型',
    '年份',
    '评分',
    '来源',
    '简介',
];
/** 搜索结果工作表名（覆盖语义：同名则清空重写） */
export const SEARCH_RESULT_SHEET_NAME = '搜索结果';
/** 类型代码 → 中文显示名 */
const KIND_LABEL = {
    all: '全部',
    anime: '动漫',
    tv: '电视剧',
    movie: '电影',
};
/** 来源代码 → 中文显示名 */
const SOURCE_LABEL = {
    local: '本地库',
    online: 'Bangumi',
};
/**
 * 把搜索结果转成写入工作表的二维数组（第 0 行是表头）。
 * 简介可能很长，Excel 单元格上限 32767 字符，这里截断避免写入失败。
 */
export function searchResultsToRows(results) {
    const rows = [[...SEARCH_RESULT_HEADERS]];
    for (const result of results) {
        const summary = result.summary === undefined ? '' : result.summary.slice(0, 32_000);
        rows.push([
            result.name,
            result.sid,
            KIND_LABEL[result.kind] ?? result.kind,
            result.year,
            result.rating,
            SOURCE_LABEL[result.source] ?? result.source,
            summary,
        ]);
    }
    return rows;
}
/** 计算矩形写入范围所需的列字母个数（表头列数） */
export function resultColumnCount() {
    return SEARCH_RESULT_HEADERS.length;
}
