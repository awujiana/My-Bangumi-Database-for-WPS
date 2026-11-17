/**
 * @fileoverview 数据中心统计纯函数（状态分布 / 月度完成数 / 环比 / 喜好画像）
 * @module services/dataCenterStats
 * @description 只吃「行对象数组」，不碰 COM / DOM / i18n，便于单测与复用。
 *
 * 观看状态口径与 `core/constants.ts` 的 WATCH_STATUS_MAP 一致：
 *   1 想看 / 2 看过 / 3 在看 / 4 搁置 / 5 抛弃。
 * 「已完成」按用户需求复用观看状态：`type=2` 视为已完成，不新增打卡时间戳字段。
 */

/** 一条可用于统计的番剧记录（字段都在 STANDARD_HEADERS 内，不新增列） */
export interface StatisticsRecord {
  /** 唯一标识（SID / 条目 ID），用于推荐时排除已看条目 */
  sid: string
  /** 名称，用于推荐列表展示 */
  name: string
  /** 观看状态数值 1~5；非合法值视为未分类 */
  watchStatus: number
  /** 完成/更新日期（可解析的日期字符串，如 2026-11-04）；缺失则不进时间统计 */
  date: string
  /** 标签/题材（以分隔符切分前的原始文本） */
  tags: string
}

/** 单一状态的计数 */
export interface StatusCount {
  status: number
  count: number
}

/** 单月的完成数 */
export interface MonthlyCount {
  /** 形如 2026-11 */
  month: string
  count: number
}

/** 环比结果 */
export interface PeriodComparison {
  current: number
  previous: number
  /** 百分比；上期为 0 时，当前 >0 记 100，当前=0 记 0 */
  changePercent: number
}

/** 喜好画像：标签 → 权重（出现次数） */
export interface PreferenceProfile {
  /** 按权重降序的标签 */
  topTags: { tag: string; weight: number }[]
  /** 参与画像计算的「看过」条目数 */
  sampleSize: number
}

/** 完成状态常量：BGM API v0 的 collect */
export const COMPLETED_STATUS = 2

/** 统计用的 5 个状态，顺序固定，缺计数补 0 */
export const STAT_STATUSES: readonly number[] = [1, 2, 3, 4, 5]

/**
 * 把任意文本状态归一到 1~5；无法识别返回 0（未分类）。
 * 与 `WATCH_STATUS_MAP` 的语义对齐，但这里刻意不 import 常量表，保持本模块纯数据依赖。
 */
export function normalizeWatchStatus(value: string | number): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 5) {
    return value
  }
  const text = String(value).trim().toLowerCase()
  if (['看过', '看完', '已看', '完', 'completed', 'collect', '2', '是', 'true'].includes(text)) {
    return 2
  }
  if (['想看', 'wish', '1', '否', 'false'].includes(text)) {
    return 1
  }
  if (['在看', '在追', '追', 'watching', 'do', '3'].includes(text)) {
    return 3
  }
  if (['搁置', '暂停', '停', 'on_hold', '4'].includes(text)) {
    return 4
  }
  if (['抛弃', '弃番', 'dropped', '5'].includes(text)) {
    return 5
  }
  return 0
}

/** 统计各状态数量（含 0 计数的状态，顺序按 STAT_STATUSES） */
export function countByStatus(records: readonly StatisticsRecord[]): StatusCount[] {
  const counts = new Map<number, number>()
  for (const status of STAT_STATUSES) counts.set(status, 0)
  for (const record of records) {
    const normalized = normalizeWatchStatus(record.watchStatus)
    if (normalized !== 0) {
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }
  }
  return STAT_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }))
}

/** 把日期字符串归一到 `YYYY-MM`；无法解析返回 null */
function toYearMonth(value: string): string | null {
  const matched = /^(\d{4})[-/年](\d{1,2})/u.exec(value.trim())
  if (matched === null) return null
  const year = matched[1]
  const month = matched[2]
  if (year === undefined || month === undefined) return null
  const monthNumber = Number(month)
  if (monthNumber < 1 || monthNumber > 12) return null
  return `${year}-${String(monthNumber).padStart(2, '0')}`
}

/** 统计「已完成」（type=2）条目的月度完成数，按月份升序 */
export function countCompletedByMonth(records: readonly StatisticsRecord[]): MonthlyCount[] {
  const counts = new Map<string, number>()
  const completed = records.filter(
    (record) => normalizeWatchStatus(record.watchStatus) === COMPLETED_STATUS,
  )
  for (const record of completed) {
    const month = toYearMonth(record.date)
    if (month !== null) {
      counts.set(month, (counts.get(month) ?? 0) + 1)
    }
  }
  const entries = [...counts]
  entries.sort(([left], [right]) => {
    if (left < right) return -1
    if (left > right) return 1
    return 0
  })
  return entries.map(([month, count]) => ({ month, count }))
}

/** 环比：当前月 vs 上一个月。months 需按升序，取最后两项 */
export function compareLastTwoMonths(months: readonly MonthlyCount[]): PeriodComparison {
  if (months.length === 0) return { current: 0, previous: 0, changePercent: 0 }
  const current = months.at(-1)?.count ?? 0
  const previous = months.length >= 2 ? (months.at(-2)?.count ?? 0) : 0
  let changePercent: number
  if (previous === 0) {
    changePercent = current > 0 ? 100 : 0
  } else {
    changePercent = Math.round(((current - previous) / previous) * 100)
  }
  return { current, previous, changePercent }
}

/** 标签分隔符：中英文逗号、顿号、斜杠、竖线 */
const TAG_SEPARATORS = /[,，、/|]+/u

/**
 * 从「看过」条目构建喜好画像：标签出现次数即权重，取前 limit 个。
 * 只统计非空标签，大小写/首尾空白归一。
 */
export function buildPreferenceProfile(
  records: readonly StatisticsRecord[],
  limit = 8,
): PreferenceProfile {
  const weights = new Map<string, number>()
  const watchedWithTags = records.filter(
    (record) => normalizeWatchStatus(record.watchStatus) === COMPLETED_STATUS && record.tags.trim() !== '',
  )
  const sampleSize = watchedWithTags.length
  for (const record of watchedWithTags) {
    const tags = record.tags
      .split(TAG_SEPARATORS)
      .map((rawTag) => rawTag.trim().toLowerCase())
      .filter((tag) => tag !== '')
    for (const tag of tags) {
      weights.set(tag, (weights.get(tag) ?? 0) + 1)
    }
  }
  const entries = [...weights]
  entries.sort(([leftTag, leftWeight], [rightTag, rightWeight]) => {
    if (leftWeight !== rightWeight) return rightWeight - leftWeight
    if (leftTag < rightTag) return -1
    if (leftTag > rightTag) return 1
    return 0
  })
  const topTags = entries.slice(0, limit).map(([tag, weight]) => ({ tag, weight }))
  return { topTags, sampleSize }
}
