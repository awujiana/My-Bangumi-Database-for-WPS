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
import type { GithubRemoteEntry } from './githubSyncDiff.js';
/** 缓存数据结构 */
export interface GithubDataCache {
    entries: GithubRemoteEntry[];
    /** 原始 JSONL 文本哈希（基于 DJB2 算法） */
    hash: string;
    /** 数据源 URL */
    url: string;
    /** 下载时间戳（ms） */
    fetchedAt: number;
    /** 原始文本长度 */
    textLength: number;
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
export declare function computeTextHash(str: string): string;
/**
 * 从 localStorage 读取缓存
 * @param url 数据源 URL，用于校验缓存是否匹配当前仓库配置
 * @returns 缓存数据或 null
 */
export declare function loadCache(url: string): GithubDataCache | null;
/**
 * 保存缓存到 localStorage
 * @param data 要缓存的数据
 */
export declare function saveCache(data: GithubDataCache): void;
/**
 * 清除所有缓存
 */
export declare function clearCache(): void;
/**
 * 检查缓存是否在有效期内
 * @param cache 缓存数据
 * @returns true 表示有效
 */
export declare function isCacheValid(cache: GithubDataCache): boolean;
/**
 * 构建缓存数据对象
 * @param entries 解析后的条目数组
 * @param rawText 原始 JSONL 文本
 * @param url 数据源 URL
 */
export declare function buildCache(entries: GithubRemoteEntry[], rawText: string, url: string): GithubDataCache;
/**
 * 计算缓存年龄的可读字符串
 * @param cache 缓存数据
 */
export declare function getCacheAge(cache: GithubDataCache): string;
//# sourceMappingURL=githubCache.d.ts.map