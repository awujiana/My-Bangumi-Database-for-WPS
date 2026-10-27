/**
 * @fileoverview enrich-page 的状态与预览配置子模块（从 enrich-page.ts 抽取）
 *
 * 抽取缘由（P1-G 最低风险首片）：`EnrichPreviewConfig` 缓存、`COLUMN_MAPPING_FIELDS`
 * 等是被 P1-G 拆分时必须移动的「纯数据 / 懒加载配置」单元。单独成模块后既可被
 * `enrich-page.ts` 内部复用，也能脱离 3787 行的 DOM 耦合单独单测（仅依赖 tools/config）。
 *
 * 依赖：
 *   - `EnrichColumnMapping`（类型，来自 sync/enrich-engine，无运行时副作用）
 *   - `getConfig` / `CONFIG_KEYS`（来自 tools/config）
 */
import type { EnrichColumnMapping } from '../sync/enrich-layout.js';
/** 标量（number）映射键：排除 platformExtraCols（number[]）这类聚合字段 */
export type ScalarMappingKey = Exclude<keyof EnrichColumnMapping, 'platformExtraCols'>;
export declare const COLUMN_MAPPING_FIELDS: {
    key: ScalarMappingKey;
    label: string;
    required: boolean;
}[];
/** 内存中缓存富化预览配置（启动时从 settings 读取） */
export interface EnrichPreviewConfig {
    /** 集数「单集」阈值 */
    epSingle: number;
    /** 集数「完结」阈值（>= 该值用绿色） */
    epFull: number;
    /** TAGS 标签彩色化（每个标签一种颜色，相同标签同色，不显示 / 分隔符） */
    tagsColor: boolean;
    /** 首播日期按日期着色（相同日期同色） */
    premiereColor: boolean;
    /** 播放平台按平台名着色（相同平台同色） */
    platformColor: boolean;
    /** 富化完成后自动执行合并去重清洗 */
    autoCleanDuplicates: boolean;
}
export declare const DEFAULT_ENRICH_PREVIEW_CONFIG: EnrichPreviewConfig;
/**
 * 读取富化预览配置（懒加载 + 失败兜底默认）。
 * 配置键：bgm_enrich_ep_single / bgm_enrich_ep_full / bgm_enrich_tags_color /
 *         bgm_enrich_premiere_color / bgm_enrich_platform_color / bgm_enrich_auto_clean。
 * 噪声关键词过滤由引擎层 shouldFilterNoise 负责（预览与富化写入共用）。
 */
export declare function getEnrichPreviewConfig(): EnrichPreviewConfig;
/**
 * 清除缓存，使下次 `getEnrichPreviewConfig()` 重新从配置读取。
 *
 * 调用时机：富化页的两个预览渲染入口（`renderSourcePreview` /
 * `renderMatchResultsToTable`）在渲染前各调一次 —— 缓存的意义是避免逐单元格读
 * PluginStorage，而渲染入口每轮预览只跑一次，重读开销可忽略，却能让设置页的改动
 * 在本页立即生效（无需重开富化页）。
 *
 * 注：设置页与富化页是**不同任务窗格（不同 realm）**，设置页调本函数只会清自己
 * 那份从未填充的缓存，因此不要从设置页跨页调用 —— 靠富化页自己重读才是正确做法。
 */
export declare function resetEnrichPreviewConfig(): void;
//# sourceMappingURL=enrich-page-state.d.ts.map