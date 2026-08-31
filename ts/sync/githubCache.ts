/**
 * @fileoverview GitHub 远程数据缓存模块
 * @module sync/githubCache
 * @description 将从 GitHub 下载的 JSONL 数据缓存到 localStorage，
 *              通过内容哈希比对避免重复下载和解析，支持网络失败时降级使用缓存数据。
 *
 * 缓存策略：
 * 1. 首次下载：完整下载 JSONL 文本，解析为条目数组，计算哈希，连同下载时间存入缓存
 * 2. 后续同步：下载完整 JSONL 文本，计算哈希与缓存比对
 *    - 哈希一致 → 跳过解析，直接使用缓存条目（节省解析时间）
 *    - 哈希不同 → 重新解析并更新缓存
 * 3. 网络失败 → 若存在缓存则降级使用（标注为"过期数据"）
 *
 * 缓存格式（localStorage key: bgm_github_data_cache）：
 * {
 *   entries: GithubRemoteEntry[],   // 解析后的条目数组
 *   hash: string,                    // 原始 JSONL 文本哈希
 *   url: string,                     // 数据源 URL（用于验证）
 *   fetchedAt: number,               // 下载时间戳（ms）
 *   textLength: number               // 原始文本长度（辅助校验）
 * }
 */

import { LOG_LEVELS } from '../core/constants.js'
import { bgmLog } from '../tools/util.js'

import type { GithubRemoteEntry } from './githubSyncDiff.js'

/** 缓存 key */
const CACHE_KEY = 'bgm_github_data_cache'

/** 缓存有效期（毫秒）：24 小时 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** 缓存数据结构 */
export interface GithubDataCache {
  entries: GithubRemoteEntry[]
  /** 原始 JSONL 文本哈希（基于 DJB2 算法） */
  hash: string
  /** 数据源 URL */
  url: string
  /** 下载时间戳（ms） */
  fetchedAt: number
  /** 原始文本长度 */
  textLength: number
}

/**
 * 简单字符串哈希（DJB2 算法）
 * 将任意长度字符串映射为 32 位整数的十六进制字符串
 *
 * 性能：比 MD5/SHA 快 10-20 倍，足够用于内容一致性判断
 * 冲突率：对 JSONL 文本（每行不同 SID）而言可忽略
 *
 * @param str 要哈希的字符串
 * @returns 8 位十六进制哈希值
 */
export function computeTextHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + charCode
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  // 转为无符号 32 位十六进制
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 从 localStorage 读取缓存
 * @param url 数据源 URL，用于校验缓存是否匹配当前仓库配置
 * @returns 缓存数据或 null
 */
export function loadCache(url: string): GithubDataCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) {
      bgmLog(LOG_LEVELS.INFO, '[githubCache] 无缓存数据')
      return null
    }
    const data = JSON.parse(raw) as GithubDataCache
    // 校验结构完整性
    if (
      !Array.isArray(data.entries) ||
      typeof data.hash !== 'string' ||
      typeof data.fetchedAt !== 'number'
    ) {
      bgmLog(LOG_LEVELS.WARN, '[githubCache] 缓存结构不完整，已清除')
      clearCache()
      return null
    }
    // 校验 URL 匹配（避免切换仓库配置后使用旧缓存）
    if (data.url !== url) {
      bgmLog(LOG_LEVELS.INFO, `[githubCache] URL 不匹配：缓存=${data.url}，当前=${url}`)
      return null
    }
    return data
  } catch {
    bgmLog(LOG_LEVELS.WARN, '[githubCache] 缓存解析失败')
    return null
  }
}

/**
 * 保存缓存到 localStorage
 * @param data 要缓存的数据
 */
export function saveCache(data: GithubDataCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
    bgmLog(
      LOG_LEVELS.INFO,
      `[githubCache] 缓存已保存：${String(data.entries.length)} 条，哈希=${data.hash}，大小=${String(data.textLength)}B`,
    )
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e)
    bgmLog(LOG_LEVELS.WARN, `[githubCache] 缓存保存失败：${errMsg}`)
  }
}

/**
 * 清除所有缓存
 */
export function clearCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
    bgmLog(LOG_LEVELS.INFO, '[githubCache] 缓存已清除')
  } catch {
    // 忽略
  }
}

/**
 * 检查缓存是否在有效期内
 * @param cache 缓存数据
 * @returns true 表示有效
 */
export function isCacheValid(cache: GithubDataCache): boolean {
  return Date.now() - cache.fetchedAt < CACHE_TTL_MS
}

/**
 * 构建缓存数据对象
 * @param entries 解析后的条目数组
 * @param rawText 原始 JSONL 文本
 * @param url 数据源 URL
 */
export function buildCache(
  entries: GithubRemoteEntry[],
  rawText: string,
  url: string,
): GithubDataCache {
  return {
    entries,
    hash: computeTextHash(rawText),
    url,
    fetchedAt: Date.now(),
    textLength: rawText.length,
  }
}

/**
 * 计算缓存年龄的可读字符串
 * @param cache 缓存数据
 */
export function getCacheAge(cache: GithubDataCache): string {
  const diff = Date.now() - cache.fetchedAt
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${String(Math.floor(diff / 60_000))} 分钟前`
  if (diff < 86_400_000) return `${String(Math.floor(diff / 3_600_000))} 小时前`
  return `${String(Math.floor(diff / 86_400_000))} 天前`
}
