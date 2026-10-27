/**
 * @fileoverview 富化引擎 · 新番表列映射与布局探测（叶子模块）
 * @module sync/enrichLayout
 * @description 从 enrich-engine.ts（2194 行）拆出的「布局探测组」，是富化引擎的
 *              最底层：只依赖 `tools/util` 与 `enrich-normalize`，**不反向依赖**
 *              enrich-engine，因此简介组（enrich-intro.js）可以直接依赖它而
 *              不产生环。
 *
 *              承载内容：
 *              - 表头关键字表与列映射类型（KNOWN_COLUMN_MAP / EnrichColumnMapping）
 *              - 列映射识别（detectColumns / findKeywordField / mappingMaxColumn）
 *              - 平台值聚合（readPlatformValues）
 *              - Hazx 新番表布局识别（detectAnimeSourceLayout，带缓存）
 *              - Bangumi 追踪表辅助（findAliasColumn / getBangumiColumnMap）
 *              - 矩形读扫描块（readScanBlock，别名列与简介表共用）
 *
 * @author BGM Development Team
 */
import type { WpsWorksheet } from '../tools/wps.js';
/**
 * 富化列映射
 * 记录新番表中各字段对应的列号
 */
export interface EnrichColumnMapping {
    nameColumn: number;
    tagsColumn?: number;
    premiereCol?: number;
    episodesColumn?: number;
    weekdayCol?: number;
    platformCol?: number;
    /**
     * 额外播放平台列：Hazx 新番表的「播放平台」横向占多列（如 F/G/H/I），
     * 第一列进 platformCol，其余列（含表头为空或重复「播放平台」的列）进这里。
     */
    platformExtraCols?: number[];
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
 * 检测新番表的列映射
 * 读取表头行，用 KNOWN_COLUMN_MAP 匹配列名
 */
export declare function detectColumns(sheet: WpsWorksheet, headerRow: number): EnrichColumnMapping;
/**
 * 计算列映射中用到的最大列号（含 `platformExtraCols`）
 *
 * 用于「一次矩形读覆盖所有需要的列」——矩形读的范围恒为 1..maxColumn，
 * 因此必须取到映射里出现过的最大列号，否则靠后的列会读不到而静默取空。
 */
export declare function mappingMaxColumn(mapping: EnrichColumnMapping): number;
/**
 * 聚合一行全部播放平台值：platformCol + platformExtraCols + exclusiveCol，去空去重保序。
 * 署名/标注示例等噪声同时过滤（预览与富化写入共用口径）。
 */
export declare function readPlatformValues(sheet: WpsWorksheet, row: number, mapping: EnrichColumnMapping, rowCells?: readonly string[]): string[];
export interface AnimeSourceLayout {
    headerRow: number;
    dataStartRow: number;
    columnMapping: EnrichColumnMapping;
}
/**
 * 识别 Hazx 新番表这类「标题/分组行 + 横向字段行 + 数据」布局（**带跨调用缓存**）。
 *
 * 缓存（§5.6 A2）：布局探测是单表最重的扫描（矩形读 10 行 × 50 列 + `detectColumns`），
 * 而反复切换源工作表 / 重扫工作簿列表时会重复探测同一张表。缓存键与
 * `findHeaderRow` / `getLastRow` 同族（表名前缀），**失效复用同一入口**
 * `clearSheetCache(worksheet)`（`refreshData` 等刷新点即清，见 `panel-lifecycle.ts`）——
 * 与既有缓存同等的失效窗口，不引入新的失效协议。负结果（null）同样缓存，
 * 与 `findHeaderRow` 缓存 0 一致。
 *
 * ⚠️ 与 `findHeaderRow` 同等暴露：表头在「不清缓存的事件」里被改时会读到旧布局
 * （§5.4 取舍③ 明确的既有约定）。表名读取异常（坏代理）时退化为不缓存，
 * 绝不让缓存逻辑把异常吞掉。
 */
export declare function detectAnimeSourceLayout(sheet: WpsWorksheet): AnimeSourceLayout | null;
/**
 * 查找 Bangumi 追踪表的别名列
 *
 * §5.6 B2：表头行一次矩形读覆盖 1..50 列（原 50 次逐格读，每次调用都付一遍）；
 * 形状不符（宿主 / 桩不支持区域读）时逐格读回退，行为与改造前逐字一致。
 */
export declare function findAliasColumn(sheet: WpsWorksheet): number;
/**
 * 获取 Bangumi 追踪表的列映射
 * 基于 COLUMN_RULES 的 getColumnMap 封装
 */
export declare function getBangumiColumnMap(sheet: WpsWorksheet): Map<string, number>;
/**
 * 扫描块一次矩形读（§5.6 B1/B2）：替代「逐格循环读」——`行数 × 列数` 次跨进程
 * 往返压成 1 次。
 *
 * 「矩形读 + 逐格读回退」统一改法（§5 引言）：读回行数 / 列宽与请求不一致
 * （宿主或桩不支持区域读）时返回 null，调用方逐格读回退，行为与改造前逐字一致。
 */
export declare function readScanBlock(sheet: WpsWorksheet, startRow: number, endRow: number, columnCount: number): readonly string[][] | null;
//# sourceMappingURL=enrich-layout.d.ts.map