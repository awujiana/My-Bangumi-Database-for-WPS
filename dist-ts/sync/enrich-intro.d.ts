/**
 * @fileoverview 富化引擎 · 新番「简介工作表」识别与关联富化
 * @module sync/enrichIntro
 * @description 从 enrich-engine.ts（2194 行）拆出的「简介组」，是那次拆分里最大的
 *              一组：简介工作表的识别（表头关键字扫描、工作簿内查找）、按名称关联
 *              的行索引、以及导演/编剧/人设/OP·ED·PV 等字段的写入。
 *
 *              依赖方向（**无反向环**）：
 *              ```
 *              enrich-layout.js  （叶子：列映射 / 布局探测）
 *                    ↑
 *              enrich-intro.js   ← 本模块
 *                    ↑
 *              enrich-engine.js  （编排；re-export 本模块以保持对外 API 不变）
 *              ```
 *              本模块因此**不能** import enrich-engine.js——需要它的东西请上移到
 *              enrich-layout / enrich-cells，或反过来由 enrich-engine 传入。
 *
 * @author BGM Development Team
 */
import type { SheetCellCache } from '../tools/util/sheet.js';
import type { WpsWorksheet, WpsWorkbook } from '../tools/wps.js';
import type { EnrichColumnMapping } from './enrich-layout.js';
import type { ConflictInfo, EnrichedField } from './enrich-types.js';
/**
 * 简介字段 → Bangumi追踪表列名映射
 * 键：新番表中的字段名；值：Bangumi追踪表中的列名
 */
export declare const INTRO_FIELD_TO_BANGUMI: Record<string, string>;
/**
 * 富化简介数据
 * 精准映射：导演→导演、编剧→脚本、人设→人物设定 等列
 * 字段名差异时追加标注：如 樋口七海(编剧)
 * 无匹配列的字段回退到特点/印象
 * 冲突（两边都有值）时记录到 conflicts 数组，由用户确认
 */
export declare function enrichIntroData(sheet: WpsWorksheet, row: number, incomingData: Record<string, string>, columnMap: Map<string, number>, enriched: EnrichedField[], conflicts: ConflictInfo[], animeRow: number, matchedAnimeName: string, cache?: SheetCellCache): void;
/**
 * 富化 OP/ED/PV 信息
 * 追加到特点/印象列
 */
export declare function enrichOpEdPv(sheet: WpsWorksheet, row: number, incomingData: Record<string, string>, columnMap: Map<string, number>, enriched: EnrichedField[], cache?: SheetCellCache): void;
/**
 * 读取简介工作表一行数据
 * 支持简介专有字段：编剧/人设/CG导演/系列构成/分镜/原作/语言/制片国家 等
 */
export declare function readIntroSheetRow(sheet: WpsWorksheet, row: number, mapping: EnrichColumnMapping, rowCells?: readonly string[]): Record<string, string>;
/**
 * 判断是否为简介工作表
 * 基于列名特征判断
 */
export declare function isIntroSheet(mapping: EnrichColumnMapping): boolean;
/**
 * 简介工作表上下文：表头行、列映射与按名称的行索引。
 * 简介表与主新番表行号不对应，必须按名称关联。
 */
export interface IntroSheetContext {
    sheet: WpsWorksheet;
    headerRow: number;
    dataStartRow: number;
    mapping: EnrichColumnMapping;
    /** normalizeName(名称) → 简介表行号 */
    nameIndex: Map<string, number>;
}
/**
 * 在工作簿中查找「新番简介」工作表：
 * 某行命中 ≥2 个简介表头关键字、且不是主新番表布局（无周更时间/播放平台等横向字段）。
 * @param excludeSheetName 排除的工作表名（当前主源表）
 *
 * **不做跨调用缓存**（§5.6 A2 的取舍记录）：其结果取决于整个工作簿的表集合，
 * 而「增删工作表」没有可挂失效的事件——工作簿级键一旦写入，用户新增一张简介表后
 * 缓存不会失效，静默漏富化字段。单表级 `detectAnimeSourceLayout` 已有缓存
 * （同族键 + `clearSheetCache` 失效），简介行的逐格读也按 §5.6 B1 收敛为矩形读，
 * 全簿重扫的剩余成本已降至「每张候选表至多 1 次矩形读」，不值得为之引入
 * 无失效协议的缓存。
 */
export declare function findIntroSheetInWorkbook(wb: WpsWorkbook, excludeSheetName?: string): WpsWorksheet | null;
/** 构建简介工作表上下文（表头识别 + 名称行索引）；非简介表返回 null */
export declare function buildIntroSheetContext(sheet: WpsWorksheet): IntroSheetContext | null;
/**
 * 用简介表上下文富化单行：按名称关联简介行，写入导演/编剧/人设等字段。
 * 简介表无该名称时静默跳过。
 */
export declare function enrichIntroFromContext(bangumiSheet: WpsWorksheet, bangumiRow: number, intro: IntroSheetContext, matchedAnimeName: string, bangumiColumnMap: Map<string, number>, enriched: EnrichedField[], conflicts: ConflictInfo[], cache?: SheetCellCache): void;
//# sourceMappingURL=enrich-intro.d.ts.map