/**
 * @fileoverview 富化引擎核心模块
 * @module sync/enrichEngine
 * @description 实现新番表数据富化的核心逻辑：
 *              1. 列名自动识别（表头关键字匹配）
 *              2. 双重匹配算法（精确名称 + 别名）
 *              3. 数据合并规则（空值填充 + 标签追加）
 *
 * @author BGM Development Team
 * @version 1.0.0
 */
import type { WpsWorksheet } from '../tools/wps.js';
/**
 * 富化列映射
 * 记录新番表中各字段对应的列号
 */
export interface EnrichColumnMapping {
    nameCol: number;
    tagsCol?: number;
    premiereCol?: number;
    episodesCol?: number;
    weekdayCol?: number;
    platformCol?: number;
    exclusiveCol?: number;
    specialCol?: number;
    introCol?: number;
    studioCol?: number;
    directorCol?: number;
    musicCol?: number;
    voiceCol?: number;
    opCol?: number;
    edCol?: number;
    pvCol?: number;
    screenplayCol?: number;
    characterDesignCol?: number;
    cgDirectorCol?: number;
    seriesCompositionCol?: number;
    storyboardCol?: number;
    originalWorkCol?: number;
    languageCol?: number;
    productionCountryCol?: number;
    typeCol?: number;
}
/**
 * 富化配置
 */
export interface EnrichConfig {
    filePath: string;
    sheetName: string;
    headerRow: number;
    dataStartRow: number;
    columnMapping: EnrichColumnMapping;
    targetSheetName?: string;
}
/**
 * 匹配结果
 */
export interface MatchResult {
    newAnimeRow: number;
    newAnimeName: string;
    matchType: 'exact' | 'alias' | 'unmatched' | 'error';
    bangumiRow?: number;
    bangumiName?: string;
    aliases?: string[];
    errorMessage?: string;
}
/**
 * 富化字段变更记录
 */
export interface EnrichedField {
    fieldName: string;
    bangumiColumn: number;
    oldValue: string | null;
    newValue: string;
    action: 'fill' | 'append' | 'skip';
}
/**
 * 字段冲突信息（需用户确认）
 */
export interface ConflictInfo {
    fieldName: string;
    bangumiColumn: number;
    bangumiRow: number;
    oldValue: string;
    newValue: string;
    newAnimeRow: number;
    newAnimeName: string;
    resolution: 'append' | 'keep' | 'overwrite';
    note?: string;
}
/**
 * 富化结果条目
 */
export interface EnrichResultItem {
    kind: 'matched' | 'unmatched' | 'error';
    newAnimeRow: number;
    name: string;
    matchType?: 'exact' | 'alias' | 'unmatched' | 'error';
    enrichedFields: EnrichedField[];
    conflicts?: ConflictInfo[] | undefined;
    errorMessage?: string;
}
/**
 * 富化进度
 */
export interface EnrichProgress {
    current: number;
    total: number;
    currentName: string;
    stats: {
        matched: number;
        enriched: number;
        skipped: number;
        failed: number;
    };
    etaMs: number;
}
/**
 * 进度回调函数类型
 */
export type ProgressCallback = (progress: EnrichProgress) => void;
/**
 * 规范化名称
 * 去空格、转小写、全角转半角
 */
export declare function normalizeName(name: string): string;
/**
 * 分割别名字符串
 * 按 |、/、;、， 等分隔符分割
 */
export declare function splitAliases(aliasesStr: string): string[];
/**
 * 分割标签字符串
 * 按 TAG_SEPARATOR 或常见分隔符分割
 */
export declare function splitTags(tags: string): string[];
/**
 * 合并标签去重
 * 现有标签 + 新标签，去重后以 TAG_SEPARATOR 连接
 */
export declare function mergeTags(oldTags: string, newTags: string): string;
/**
 * 追加特点信息去重
 * 将新特点追加到旧特点后，以 FEATURE_SEPARATOR 分隔
 */
export declare function appendFeatures(oldFeature: string, newFeatures: string): string;
/**
 * 检测新番表的列映射
 * 读取表头行，用 KNOWN_COLUMN_MAP 匹配列名
 */
export declare function detectColumns(sheet: WpsWorksheet, headerRow: number): EnrichColumnMapping;
/**
 * 查找 Bangumi 追踪表的别名列
 */
export declare function findAliasColumn(sheet: WpsWorksheet): number;
/**
 * 获取 Bangumi 追踪表的列映射
 * 基于 COLUMN_RULES 的 getColumnMap 封装
 */
export declare function getBangumiColumnMap(sheet: WpsWorksheet): Map<string, number>;
/**
 * 读取新番表一行数据
 */
export declare function readNewAnimeRow(sheet: WpsWorksheet, row: number, mapping: EnrichColumnMapping): Record<string, string>;
/**
 * 匹配新番表与 Bangumi 追踪表条目
 */
export declare function matchEntries(newAnimeSheet: WpsWorksheet, bangumiSheet: WpsWorksheet, config: EnrichConfig): MatchResult[];
/**
 * 富化标签
 * 追加模式（现有 + TAG_SEPARATOR + 新标签，去重），空值时填充
 */
export declare function enrichTags(sheet: WpsWorksheet, row: number, newData: Record<string, string>, colMap: Map<string, number>, enriched: EnrichedField[]): void;
/**
 * 富化首播日期
 * 仅在 Bangumi 列为空时填充
 */
export declare function enrichDate(sheet: WpsWorksheet, row: number, newData: Record<string, string>, colMap: Map<string, number>, enriched: EnrichedField[]): void;
/**
 * 富化集数
 * 仅在 Bangumi 列为空时填充
 */
export declare function enrichEpisodes(sheet: WpsWorksheet, row: number, newData: Record<string, string>, colMap: Map<string, number>, enriched: EnrichedField[]): void;
/**
 * 富化特点/印象
 * 追加模式（收集周更/平台/独播/特殊信息，以 FEATURE_SEPARATOR 分隔）
 */
export declare function enrichFeatures(sheet: WpsWorksheet, row: number, newData: Record<string, string>, colMap: Map<string, number>, enriched: EnrichedField[]): void;
/**
 * 执行富化操作
 * 对每个匹配结果执行富化，写入富化记录，调用进度回调
 */
export declare function enrichEntries(newAnimeSheet: WpsWorksheet, bangumiSheet: WpsWorksheet, matches: MatchResult[], config: EnrichConfig, progressCallback?: ProgressCallback): EnrichResultItem[];
export type { EnrichRecord } from './enrichRecord.js';
/**
 * 解析字段冲突：根据用户选择的 resolution 执行相应操作
 * append: 增量更新（old | new）
 * keep: 保留原名
 * overwrite: 使用新番表字段的名字
 */
export declare function resolveConflictField(sheet: WpsWorksheet, conflict: ConflictInfo, enriched: EnrichedField[]): void;
/**
 * 检查并添加缺失的列到 Bangumi 追踪表
 * 返回更新后的列映射
 */
export declare function ensureBangumiColumns(sheet: WpsWorksheet, colMap: Map<string, number>, requiredFields: Record<string, string>, headerRow: number): Map<string, number>;
/**
 * 富化简介数据
 * 精准映射：导演→导演、编剧→脚本、人设→人物设定 等列
 * 字段名差异时追加标注：如 樋口七海(编剧)
 * 无匹配列的字段回退到特点/印象
 * 冲突（两边都有值）时记录到 conflicts 数组，由用户确认
 */
export declare function enrichIntroData(sheet: WpsWorksheet, row: number, newData: Record<string, string>, colMap: Map<string, number>, enriched: EnrichedField[], conflicts: ConflictInfo[], newAnimeRow: number, newAnimeName: string): void;
/**
 * 富化 OP/ED/PV 信息
 * 追加到特点/印象列
 */
export declare function enrichOpEdPv(sheet: WpsWorksheet, row: number, newData: Record<string, string>, colMap: Map<string, number>, enriched: EnrichedField[]): void;
/**
 * 读取简介工作表一行数据
 * 支持简介专有字段：编剧/人设/CG导演/系列构成/分镜/原作/语言/制片国家 等
 */
export declare function readIntroSheetRow(sheet: WpsWorksheet, row: number, mapping: EnrichColumnMapping): Record<string, string>;
/**
 * 判断是否为简介工作表
 * 基于列名特征判断
 */
export declare function isIntroSheet(mapping: EnrichColumnMapping): boolean;
/**
 * 富化别名
 * 当新番表名称与 Bangumi 追踪表名称/别名不一致时，
 * 将新番表名称补充到 Bangumi 追踪表的别名列
 */
export declare function enrichAlias(sheet: WpsWorksheet, row: number, newAnimeName: string, bangumiName: string | undefined, colMap: Map<string, number>, enriched: EnrichedField[]): void;
/**
 * 搜索结果条目
 */
export interface SearchResult {
    row: number;
    name: string;
    fieldMatches: Array<{
        column: string;
        value: string;
    }>;
}
/**
 * 在工作表中搜索关键词
 * 支持多字段匹配，返回所有匹配行
 */
export declare function searchSheet(sheet: WpsWorksheet, keyword: string, colMap: Map<string, number>, dataStartRow: number): SearchResult[];
/**
 * 远程仓库配置
 */
export interface RemoteRepoConfig {
    url: string;
    branch: string;
    filePath: string;
    localPath: string;
}
/**
 * 从远程仓库获取文件内容（以 base64 方式）
 * 绕过中间列影响，直接下载原始数据
 */
export declare function fetchRemoteFile(config: RemoteRepoConfig): Promise<string | null>;
/**
 * 解析远程文件内容为 Excel 可导入格式
 * 支持 CSV/TSV 纯文本格式，不受中间列干扰
 */
export declare function parseRemoteContent(content: string): Array<Record<string, string>>;
/**
 * 将远程获取的数据写入工作表
 * 支持指定列映射，避免中间列影响
 */
export declare function writeRemoteDataToSheet(sheet: WpsWorksheet, data: Array<Record<string, string>>, colMap: Map<string, number>, startRow: number): number;
//# sourceMappingURL=enrichEngine.d.ts.map