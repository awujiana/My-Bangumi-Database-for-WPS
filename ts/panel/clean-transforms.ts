/**
 * @fileoverview 通用清理功能 · 单元格值变换（纯函数，不依赖 WPS / DOM）
 * @module panel/cleanTransforms
 * @description
 * 对单个单元格文本做无损 / 有损变换，供 `cellTransform` 类清理项复用。
 * 全部为纯函数，便于单测与在预览阶段复用（预览与执行走同一份逻辑，
 * 保证「预览显示的条数」与「实际执行的条数」严格一致）。
 *
 * 规则常量（噪声词表、归一化规则）来自 clean-rules.ts，本文件只做算法。
 */

import {
  CATEGORY_NUMBER_PREFIX_RE,
  NOISE_TAGS,
  NOISE_TAG_PATTERNS,
  ORIGINAL_TAG_RULES,
} from './clean-rules.js'
import type { CellTransformId } from './clean-rules.js'

/** 变换所需的同行上下文 */
export interface TransformContext {
  /** 同行「名称」列的值（别名去重等需要参照列的变换使用） */
  name: string
}

/** 变换结果 */
export interface TransformOutcome {
  /** 变换后的值（未变更时等于入参） */
  value: string
  /** 是否发生变更 */
  changed: boolean
  /** 被移除 / 归并的条目数（用于日志与统计） */
  removed: number
}

/** 变换产出的空结果 */
function unchanged(value: string): TransformOutcome {
  return { value, changed: false, removed: 0 }
}

/**
 * 按 `|`（允许两侧空格，兼容全角 `｜`）拆分标签文本为去空后的标签数组。
 */
export function splitTagValue(raw: string): string[] {
  return raw
    .split(/[|｜]/u)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/** 标签数组的统一输出格式 */
function joinTags(tags: readonly string[]): string {
  return tags.join(' | ')
}

/** 保序去重 */
function dedupe<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

/**
 * 估算字符串的 UTF-8 字节数。
 * 不依赖 TextEncoder（WPS 内嵌浏览器版本差异），按 Unicode 码点区间自行计算。
 */
export function estimateUtf8Bytes(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.codePointAt(index) ?? 0
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code <= 0xffff) {
      bytes += 3
    } else {
      bytes += 4
      // 代理对：跳过低位
      index += 1
    }
  }
  return bytes
}

/** 判断单个标签是否为噪声标签（全等匹配或整项命中噪声正则） */
export function isNoiseTag(tag: string): boolean {
  if (NOISE_TAGS.includes(tag)) return true
  return NOISE_TAG_PATTERNS.some((pattern) => pattern.test(tag))
}

// ========== 具体变换 ==========

/** 移除噪声标签：命中 NOISE_TAGS / NOISE_TAG_PATTERNS 的整项删除 */
function stripNoiseTags(raw: string): TransformOutcome {
  const parts = splitTagValue(raw)
  if (parts.length === 0) return unchanged(raw)
  const kept = parts.filter((part) => !isNoiseTag(part))
  const removed = parts.length - kept.length
  if (removed === 0) return unchanged(raw)
  // 全部被移除时清空单元格（保留空串，避免出现 " | " 残骸）
  return { value: joinTags(kept), changed: true, removed }
}

/** 统一分隔符为 " | " 并去除重复标签 */
function normalizeTagSeparator(raw: string): TransformOutcome {
  const parts = splitTagValue(raw)
  if (parts.length === 0) return unchanged(raw)
  const deduped = dedupe(parts)
  const value = joinTags(deduped)
  if (value === raw) return unchanged(raw)
  return { value, changed: true, removed: parts.length - deduped.length }
}

/** 去除类别列的 "数字|" 前缀 */
function stripCategoryNumberPrefix(raw: string): TransformOutcome {
  if (!CATEGORY_NUMBER_PREFIX_RE.test(raw)) return unchanged(raw)
  return { value: raw.replace(CATEGORY_NUMBER_PREFIX_RE, '').trim(), changed: true, removed: 1 }
}

/** 移除与「名称」重复的别名条目，并去除重复别名 */
function dedupAliasAgainstName(raw: string, context: TransformContext): TransformOutcome {
  const parts = splitTagValue(raw)
  if (parts.length === 0) return unchanged(raw)
  const name = context.name.trim()
  const filtered = name ? parts.filter((part) => part !== name) : parts
  const deduped = dedupe(filtered)
  const value = joinTags(deduped)
  if (value === raw) return unchanged(raw)
  return { value, changed: true, removed: parts.length - deduped.length }
}

/**
 * 原作标签归一化（移植 `clean/cleaner.py::normalize_original_tags` 的核心步骤）。
 *
 * 处理顺序：变体映射 → 保序去重 → 特例规则 → 优先级去重 → 自定义改类型优先
 * → 国家 + 改类型合并。
 *
 * 边界策略（与 Python 版不同，偏保守，避免丢数据）：
 * - 组内**没有任何 `*改` 标签**时直接返回原值不变更（不把国家标签清空下沉，
 *   因为本变换只能改写单列，无法同步写入「制片国家」列）；
 * - 命中国家中仅 1 个且改类型仅 1 个时合并为「国家+改」（如 日本 + 漫画改 → 日本漫画改）。
 */
function normalizeOriginalTag(raw: string): TransformOutcome {
  const parts = splitTagValue(raw)
  if (parts.length === 0) return unchanged(raw)

  const { countries, typeMappings, baseGaiTypes, priorityRules, specialCases } = ORIGINAL_TAG_RULES

  // 1. 变体映射 + 保序去重
  const mapped = dedupe(parts.map((part) => typeMappings[part] ?? part))

  // 2. 分类（先判定是否有「改」标签，用于保守早退）
  const adaptTags = mapped.filter((tag) => tag.endsWith('改') && !countries.includes(tag))

  // 3. 无「改」标签 → 保守不变更（避免丢失国家 / 原创信息）
  if (adaptTags.length === 0) return unchanged(raw)

  const hasOriginal = mapped.includes('原创')
  const countryTags = mapped.filter((tag) => countries.includes(tag))
  const otherTags = mapped.filter(
    (tag) => !countries.includes(tag) && !tag.endsWith('改') && tag !== '原创',
  )

  // 4. 特例规则：国家 + 全部类型命中且无额外改类型
  for (const rule of specialCases) {
    const hasCountry = countryTags.includes(rule.country)
    const hasAllTypes = rule.types.every((type) => mapped.includes(type))
    const hasExtraAdapt = adaptTags.some((tag) => !rule.types.includes(tag))
    if (hasCountry && hasAllTypes && !hasExtraAdapt) {
      const value = rule.output
      return { value, changed: value !== raw, removed: mapped.length - 1 }
    }
  }

  // 5. 优先级去重：higher 与 lower 共存时移除 lower
  let kept = adaptTags
  for (const rule of priorityRules) {
    if (kept.includes(rule.higher) && kept.includes(rule.lower)) {
      kept = kept.filter((tag) => tag !== rule.lower)
    }
  }

  // 6. 自定义改类型优先：存在自定义（非标准）改类型时，丢弃标准改类型
  const customAdapt = kept.filter((tag) => !baseGaiTypes.includes(tag))
  if (customAdapt.length > 0) {
    kept = customAdapt
  }

  // 7. 组装：1 国家 + 1 改 → 合并；否则国家在前、改类型在后
  const head =
    countryTags.length === 1 && kept.length === 1
      ? [`${countryTags[0] ?? ''}${kept[0] ?? ''}`]
      : [...countryTags, ...kept]
  const value = joinTags([...head, ...otherTags, ...(hasOriginal ? ['原创'] : [])])
  const removed = mapped.length - splitTagValue(value).length
  return value === raw
    ? unchanged(raw)
    : { value, changed: true, removed: Math.max(0, removed) }
}

/** 变换 ID → 变换函数 */
const TRANSFORMS: Record<CellTransformId, (raw: string, context: TransformContext) => TransformOutcome> =
  {
    stripNoiseTags: (raw) => stripNoiseTags(raw),
    normalizeTagSeparator: (raw) => normalizeTagSeparator(raw),
    stripCategoryNumberPrefix: (raw) => stripCategoryNumberPrefix(raw),
    dedupAliasAgainstName: (raw, context) => dedupAliasAgainstName(raw, context),
    normalizeOriginalTag: (raw) => normalizeOriginalTag(raw),
  }

/**
 * 按 ID 执行单元格变换。未知 ID 或空值均返回「未变更」，绝不抛错。
 */
export function transformCellValue(
  id: CellTransformId,
  raw: string,
  context: TransformContext,
): TransformOutcome {
  if (raw.trim() === '') return unchanged(raw)
  try {
    // 运行时若传入未知 ID 会取到 undefined 并在此抛 TypeError，由 catch 统一兜底为「未变更」
    return TRANSFORMS[id](raw, context)
  } catch {
    // 变换失败时保持原值，由调用方在日志中记录
    return unchanged(raw)
  }
}
