/**
 * @fileoverview 双源搜索纯逻辑（本地库 + Bangumi 在线结果归一化 / 过滤）
 * @module services/dataCenterSearch
 * @description 搜索表单字段全部选填，但至少填一项才执行（由 UI 层拦截空表单）。
 *              在线 HTTP 请求通过注入的 fetcher 完成，本模块只做查询串构造与结果归一化。
 */
import type { StatisticsRecord } from './data-center-stats.js';
/** 搜索类型（覆盖动漫 / 电视剧 / 电影，以及不限） */
export type SearchKind = 'all' | 'anime' | 'tv' | 'movie';
/** 搜索范围 */
export type SearchScope = 'local' | 'online' | 'both';
/** 搜索表单值（全部选填，至少填一项） */
export interface SearchQuery {
    keyword?: string;
    kind?: SearchKind;
    year?: number;
    /** 最低评分 0~10 */
    minRating?: number;
    /** 观看状态 1~5 */
    status?: number;
    scope?: SearchScope;
}
/** 统一的搜索结果条目（本地与在线同形状，UI 只认这一种） */
export interface SearchResult {
    sid: string;
    name: string;
    kind: SearchKind;
    year: string;
    rating: string;
    source: 'local' | 'online';
    /** 详情描述 / 简介（可选） */
    summary?: string;
}
/** 归一化后的在线原始条目（由 HTTP 层从 Bangumi JSON 提取） */
export interface OnlineEntry {
    id: string | number;
    name: string;
    /** Bangumi 的 type 码：2 动漫 / 4 电视剧 / 6 电影 */
    bangumiType?: number;
    platform?: string;
    airDate?: string;
    rating?: string | number;
    summary?: string;
}
/** 判断表单是否至少填了一项有效条件 */
export declare function hasAnyCriterion(query: SearchQuery): boolean;
/** 构造 Bangumi 搜索 URL（api.bgm.tv，CSP 已允许；关键词需编码） */
export declare function buildBangumiSearchUrl(keyword: string, kind: SearchKind): string;
/** Bangumi platform 字段 → 统一类型 */
export declare function kindFromPlatform(platform: string | undefined): SearchKind;
/** Bangumi type 码 → 统一类型（2 动漫 / 4 电视剧 / 6 电影，其余按动漫） */
export declare function kindFromBangumiType(bangumiType: number | undefined): SearchKind;
/** 把在线原始条目归一化为统一结果 */
export declare function normalizeOnlineEntry(entry: OnlineEntry): SearchResult;
/** 本地记录 → 统一搜索结果 */
export declare function localRecordToResult(record: StatisticsRecord): SearchResult;
/** 按表单条件过滤一组统一结果 */
export declare function filterResults(results: readonly SearchResult[], query: SearchQuery): SearchResult[];
/** 合并本地与在线结果并按名称去重（本地优先） */
export declare function mergeResults(local: readonly SearchResult[], online: readonly SearchResult[]): SearchResult[];
//# sourceMappingURL=data-center-search.d.ts.map