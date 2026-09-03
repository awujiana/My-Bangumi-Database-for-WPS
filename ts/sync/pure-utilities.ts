/**
 * @fileoverview Bangumi 同步纯函数模块
 * @module sync/pure-utilities
 * @description 提供 URL 识别、Subject ID 提取、观看状态映射、标签解析等函数。
 *
 * 模块拆分说明：
 *   - isBangumiUrl / extractSubjectId / mapWatchStatus 是无副作用依赖的纯函数，
 *     已抽取到 ./pure-utilities-core.js（仅依赖 core/constants 与 tools/string-utilities-pure）。
 *     本模块 re-export 以保持向后兼容。
 *   - mapWatchStatus 在状态无法识别时调用 bgmLog 记录警告。pure-utilities-core.ts 通过
 *     setLogger 接受注入的日志函数；本模块在加载时注入实际的 bgmLog。
 *   - getSeqColIndex / addTagsFromString / buildTagsArray 不依赖副作用模块，保留在本模块。
 *
 * 测试策略：单元测试应直接 import 自 pure-utilities-core.js，并通过 setLogger(vi.fn())
 * 注入 mock 日志函数，以避免触发 tools/util → ui/handlers 的副作用链。
 */

import { bgmLog } from '../tools/utility.js'

import { setLogger } from './pure-utilities-core.js'

// 在模块加载时注入实际日志函数（生产环境用）
// 注意：pure-utilities-core.ts 默认 loggerFn 是 no-op，此处确保 mapWatchStatus
// 在生产环境能正确调用 bgmLog 记录警告。
setLogger(bgmLog)

// Re-export 纯函数，保持向后兼容（直接 re-export，无需在本地引用）
export { isBangumiUrl, extractSubjectId, mapWatchStatus } from './pure-utilities-core.js'

/** 序列号列默认索引 */
const DEFAULT_SEQ_COL = 4

/**
 * 获取序列号列索引（支持 colMap 或默认列号）
 */
export function getSeqColIndex(colMap: Map<string, number> | undefined): number {
  return colMap?.get('序列号') || DEFAULT_SEQ_COL
}

/**
 * 从字符串解析标签数组
 *
 * @function addTagsFromString
 * @param {Set<string>} tagSet - 标签集合（输出参数）
 * @param {string} tagsRaw - 原始标签字符串
 *
 * @description
 * 标签分隔符支持：英文逗号、中文逗号、空格、分号、顿号、换行
 * 标签会被trim后加入集合，空白标签会被忽略
 *
 * @example
 * const tags = new Set<string>();
 * addTagsFromString(tags, '治愈,日常,萌系');
 * // tags = {'治愈', '日常', '萌系'}
 */
export function addTagsFromString(tagSet: Set<string>, raw: string) {
  if (!raw) return
  // 按 | 或 , 或 ; 分割，并过滤掉纯符号和空白
  const parts = raw.split(/[|,;，；]/)
  parts.forEach((part) => {
    const tag = part.trim()
    if (tag && !['|', ',', ';', '，', '；'].includes(tag)) {
      tagSet.add(tag)
    }
  })
}

/**
 * 构建标签数组
 *
 * @function buildTagsArray
 * @param {string} tagsRaw - 原始标签字符串
 * @returns {string[]} 标签数组
 *
 * @example
 * buildTagsArray('治愈,日常 萌系'); // 返回 ['治愈', '日常', '萌系']
 */
export function buildTagsArray(tagsRaw: string): string[] {
  const tagSet = new Set<string>()
  addTagsFromString(tagSet, tagsRaw)
  return Array.from(tagSet)
}
