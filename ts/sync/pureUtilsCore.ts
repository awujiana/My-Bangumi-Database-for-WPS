/**
 * @fileoverview Bangumi 同步纯函数核心模块（无副作用依赖）
 * @module sync/pureUtilsCore
 * @description 提供 URL 识别、Subject ID 提取、观看状态映射等纯函数。
 *
 * 本模块仅依赖纯模块（core/constants 与 tools/stringUtilsPure），不引入
 * tools/util 或 ui/handlers 等含副作用的模块，以便单元测试可以直接 import
 * 而不触发 handlers.ts 中的 setTimeout / addEventListener 等副作用。
 *
 * 日志注入：mapWatchStatus 在状态无法识别时需要记录警告日志。为保持本模块
 * 零副作用依赖，采用依赖注入模式：调用方通过 setLogger 注入实际日志函数；
 * 默认使用 no-op。生产环境由 pureUtils.ts 在加载时注入 bgmLog；
 * 测试环境由测试代码注入 vi.fn()。
 *
 * 历史背景：原 pureUtils.ts 同时导入 core/constants（纯）、tools/util.bgmLog
 * （含副作用）和 tools/stringUtils.trim（含副作用链）。为支持纯函数单元测试，
 * 将 isBangumiUrl / extractSubjectId / mapWatchStatus 三个无状态函数抽取到本模块。
 */

import { URL_PATTERNS, WATCH_STATUS_MAP, LOG_LEVELS } from '../core/constants.js'
import { trim } from '../tools/stringUtilsPure.js'

/**
 * 日志函数类型
 * 与 tools/util.ts 中 bgmLog 的签名保持一致：(level, message) => void
 */
export type LoggerFn = (level: number, message: string) => void

/** 当前注入的日志函数，默认 no-op */
let loggerFunction: LoggerFn = () => {}

/**
 * 注入日志函数（依赖注入入口）
 *
 * 生产环境由 pureUtils.ts 调用 setLogger(bgmLog) 注入实际日志函数；
 * 测试环境调用 setLogger(vi.fn()) 注入 mock 以便断言日志调用。
 *
 * @param fn - 日志函数，签名为 (level: number, message: string) => void
 */
export function setLogger(fn: LoggerFn): void {
  loggerFunction = fn
}

/**
 * 判断字符串是否为 Bangumi 条目 URL（支持 bgm.tv / bangumi.tv / chii.in）
 * @param url 待检测的字符串
 * @returns 如果是 BGM 域名链接返回 true；纯数字 ID 也返回 true；否则返回 false
 */
export function isBangumiUrl(url: string): boolean {
  if (!url) return false
  const s = trim(url)
  if (!s) return false
  // 纯数字视为合法的 Subject ID
  if (/^\d+$/.test(s)) return true
  // 检查是否匹配任一 BGM URL 模式
  return URL_PATTERNS.some((pattern) => pattern.test(s))
}

/**
 * 从URL或文本中提取Bangumi Subject ID
 *
 * @function extractSubjectId
 * @param {string} input - URL或包含ID的文本
 * @returns {string | null} 提取的Subject ID；提取失败或未通过校验返回 null
 *
 * @description
 * 支持的URL格式：
 * - https://bgm.tv/subject/123456
 * - https://bangumi.tv/subject/123456
 * - https://chii.in/subject/123456
 * - 直接输入数字ID
 *
 * 提取后强制校验 ID 为 1-8 位数字（Bangumi Subject ID 上限为 8 位），
 * 不匹配则返回 null，防止脏数据（如目录遍历字符、超长数字）流入后续流程。
 *
 * @example
 * extractSubjectId('https://bgm.tv/subject/123456'); // 返回 '123456'
 * extractSubjectId('123456'); // 返回 '123456'
 * extractSubjectId('https://bgm.tv/subject/123456789'); // 返回 null（超过 8 位）
 * extractSubjectId('abc'); // 返回 null
 */
export function extractSubjectId(input: string): string | null {
  if (!input) return null

  const trimmed = trim(input)
  if (!trimmed) return null

  let id: string | null = null

  // 如果是纯数字，直接作为候选
  if (/^\d+$/.test(trimmed)) {
    id = trimmed
  }

  // 尝试匹配URL模式
  if (id === null) {
    for (const pattern of URL_PATTERNS) {
      const match = trimmed.match(pattern)
      if (match?.[1]) {
        id = match[1]
        break
      }
    }
  }

  // 尝试从文本中提取数字
  if (id === null) {
    const numberMatch = /\d+/.exec(trimmed)
    if (numberMatch && numberMatch[0]) {
      id = numberMatch[0]
    }
  }

  if (!id) return null
  // 强制校验为 1-8 位数字（防止脏数据：超长数字、目录遍历字符等）
  if (!/^\d{1,8}$/.test(id)) return null
  return id
}

/**
 * @function mapWatchStatus
 * @param {string} status - 观看状态文本
 * @returns {number} API数值：1=想看, 2=在看, 3=看过, 4=搁置, 5=抛弃
 *
 * @description
 * 支持的状态文本映射：
 * - 想看/想看动画/否/wish → 1
 * - 在看/在看动画/在追/追/watching → 2
 * - 看过/看完/已看/完/completed → 3
 * - 搁置/暂停/on_hold → 4
 * - 抛弃/弃/弃番/drop/dropped → 5
 *
 * @example
 * mapWatchStatus('看完'); // 返回 3
 * mapWatchStatus('在看'); // 返回 2
 */
export function mapWatchStatus(status: string): number {
  if (!status) return 1

  const normalized = trim(status).toLowerCase()

  // 直接查找
  if (WATCH_STATUS_MAP[normalized] !== undefined) {
    return WATCH_STATUS_MAP[normalized]
  }

  // 模糊匹配
  for (const [key, value] of Object.entries(WATCH_STATUS_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value
    }
  }

  // 布尔值转换
  if (normalized === 'true') return 3
  if (normalized === 'false') return 0

  // 数字字符串转换
  const number_ = parseInt(normalized, 10)
  if (!isNaN(number_) && number_ >= 0 && number_ <= 5) {
    return number_
  }

  // 无法识别的状态，记录警告日志（通过注入的 loggerFn 调用）
  loggerFunction(LOG_LEVELS.WARN, `[mapWatchStatus] 无法识别的状态值: "${status}"，返回 0（无效）`)
  return 0
}
