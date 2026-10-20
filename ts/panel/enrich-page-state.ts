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

import type { EnrichColumnMapping } from '../sync/enrich-layout.js'

import { getConfig, CONFIG_KEYS } from '../tools/config.js'

/** 标量（number）映射键：排除 platformExtraCols（number[]）这类聚合字段 */
export type ScalarMappingKey = Exclude<keyof EnrichColumnMapping, 'platformExtraCols'>

export const COLUMN_MAPPING_FIELDS: {
  key: ScalarMappingKey
  label: string
  required: boolean
}[] = [
  { key: 'nameColumn', label: '名称', required: true },
  { key: 'tagsColumn', label: 'TAGS/标签', required: false },
  { key: 'premiereCol', label: '首播', required: false },
  { key: 'episodesColumn', label: '集数', required: false },
  { key: 'weekdayCol', label: '周更时间', required: false },
  { key: 'platformCol', label: '播放平台', required: false },
  { key: 'exclusiveCol', label: '独播', required: false },
  { key: 'specialCol', label: '特殊/备注', required: false },
]

/** 内存中缓存富化预览配置（启动时从 settings 读取） */
export interface EnrichPreviewConfig {
  /** 集数「单集」阈值 */
  epSingle: number
  /** 集数「完结」阈值（>= 该值用绿色） */
  epFull: number
  /** TAGS 标签彩色化（每个标签一种颜色，相同标签同色，不显示 / 分隔符） */
  tagsColor: boolean
  /** 首播日期按日期着色（相同日期同色） */
  premiereColor: boolean
  /** 播放平台按平台名着色（相同平台同色） */
  platformColor: boolean
  /** 富化完成后自动执行合并去重清洗 */
  autoCleanDuplicates: boolean
}

export const DEFAULT_ENRICH_PREVIEW_CONFIG: EnrichPreviewConfig = {
  epSingle: 1,
  epFull: 12,
  tagsColor: true,
  premiereColor: true,
  platformColor: true,
  autoCleanDuplicates: true,
}

let _enrichPreviewConfig: EnrichPreviewConfig | null = null

/** 布尔配置读取：仅显式 'false' 视为关闭，其余（空/异常）走默认开启 */
function isToggleEnabled(key: string): boolean {
  try {
    return getConfig(key, 'true', true) !== 'false'
  } catch {
    return true
  }
}

/**
 * 读取富化预览配置（懒加载 + 失败兜底默认）。
 * 配置键：bgm_enrich_ep_single / bgm_enrich_ep_full / bgm_enrich_tags_color /
 *         bgm_enrich_premiere_color / bgm_enrich_platform_color / bgm_enrich_auto_clean。
 * 噪声关键词过滤由引擎层 shouldFilterNoise 负责（预览与富化写入共用）。
 */
export function getEnrichPreviewConfig(): EnrichPreviewConfig {
  if (_enrichPreviewConfig) return _enrichPreviewConfig
  const next: EnrichPreviewConfig = { ...DEFAULT_ENRICH_PREVIEW_CONFIG }
  try {
    const singleRaw = Number(
      getConfig(CONFIG_KEYS.ENRICH_EP_SINGLE, String(DEFAULT_ENRICH_PREVIEW_CONFIG.epSingle), true),
    )
    const fullRaw = Number(
      getConfig(CONFIG_KEYS.ENRICH_EP_FULL, String(DEFAULT_ENRICH_PREVIEW_CONFIG.epFull), true),
    )
    if (Number.isFinite(singleRaw) && singleRaw > 0) next.epSingle = Math.trunc(singleRaw)
    if (Number.isFinite(fullRaw) && fullRaw > 0) next.epFull = Math.trunc(fullRaw)
  } catch {
    // 兜底默认
  }
  next.tagsColor = isToggleEnabled(CONFIG_KEYS.ENRICH_TAGS_COLOR)
  next.premiereColor = isToggleEnabled(CONFIG_KEYS.ENRICH_PREMIERE_COLOR)
  next.platformColor = isToggleEnabled(CONFIG_KEYS.ENRICH_PLATFORM_COLOR)
  next.autoCleanDuplicates = isToggleEnabled(CONFIG_KEYS.ENRICH_AUTO_CLEAN)
  _enrichPreviewConfig = next
  return next
}

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
export function resetEnrichPreviewConfig(): void {
  _enrichPreviewConfig = null
}
