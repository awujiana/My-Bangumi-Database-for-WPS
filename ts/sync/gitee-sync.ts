/**
 * @fileoverview Gitee 仓库增量同步模块
 * @module sync/giteeSync
 * @description Gitee 同步源实现，URL 模板：
 *              https://gitee.com/{owner}/{repo}/raw/{branch}/{path}
 *
 *              注意：Gitee Raw URL 使用 `/raw/` 段（与 GitHub 一致），
 *              不同于 GitLab 的 `/-/raw/`。例如：
 *                GitHub: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
 *                Gitee:  https://gitee.com/{owner}/{repo}/raw/{branch}/{path}
 *                GitLab: https://gitlab.com/{owner}/{repo}/-/raw/{branch}/{path}
 *
 *              复用 githubConfig 的 owner/repo/branch/path 字段（与 GitHub 共享配置 UI），
 *              复用 githubSyncDiff.ts 的 parseJsonl 解析逻辑，不重复解析实现。
 *
 * 数据格式（远程 JSONL 文件，采用「表头 + 值数组」两段式）与 GitHub 一致：
 *   第 1 个非空行   ["sid","name","updatedAt","date","meta_tags","nsfw","话数", ...]
 *   其后每行        ["12345","...","2026-07-21","2024-01-01",["标签1","标签2"],false,"12", ...]
 *   值数组按表头顺序排列，字段名只在表头出现一次（省去每行重复的键名）。
 *
 * URL 字段从 sid 构造：https://bgm.tv/subject/{sid}
 * type 字段默认为 2（动漫），用于同步记录显示。
 * updatedAt 为 YYYY-MM-DD 格式（仅日期，不含时间，节省空间）。
 */

import { getGithubConfig, getManualShards, isGithubConfigComplete } from './github-config.js'
import type { GithubRemoteEntry } from './github-sync-diff.js'
import { createRawTextFetcher } from './jsonl-response.js'
import { loadEntriesFromPath } from './shard-fetch.js'
import type { FetchLoadStats } from './shard-fetch.js'
import type { FetchRemoteEntriesOptions } from './sync-source.js'
import { BaseSyncSource } from './sync-source-base.js'
// 复用 githubSyncDiff.ts 的纯解析函数与类型（零依赖纯模块，可在 Node 测试环境直接运行）

/** 默认分支名（与 githubConfig 默认值一致） */
const DEFAULT_BRANCH = 'main'

/**
 * 构造 Gitee Raw 文件下载 URL
 *
 * 格式：https://gitee.com/{owner}/{repo}/raw/{branch}/{path}
 *
 * 关键差异：Gitee 使用 `/raw/` 段（与 GitHub 一致），不同于 GitLab 的 `/-/raw/`。
 *
 * @param relativePath 可选的仓库内相对路径覆盖（下载分片时用）
 * @returns URL 字符串
 * @throws 配置不完整时抛出 Error
 */
export function buildGiteeRawUrl(relativePath?: string): string {
  if (!isGithubConfigComplete()) {
    throw new Error('Gitee 仓库配置不完整，请在面板中设置 owner/repo/path')
  }
  // config 声明移到 early throw 之后（满足 unicorn/no-declarations-before-early-exit）
  const config = getGithubConfig()
  const branch = config.branch || DEFAULT_BRANCH
  const target = relativePath ?? config.path
  return `https://gitee.com/${config.owner}/${config.repo}/raw/${branch}/${target}`
}

/**
 * 按仓库内相对路径取原始文本（gzip 由 `readXhrJsonlText` 按魔数解压）
 *
 * XHR 骨架与 GitHub / GitLab 完全同构，统一走 `createRawTextFetcher` 工厂
 * （见 `jsonl-response.ts`）：本处只提供 Gitee 的构 URL 逻辑与错误措辞。
 *
 * @param relativePath 仓库内相对路径（清单或任一分片文件）
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns 解码后的文本（JSONL / JSON 明文）
 * @throws 配置错误、网络错误、HTTP 非 200 时抛出 Error
 */
export const fetchGiteeText = createRawTextFetcher({
  logTag: 'giteeSync',
  buildUrl: (relativePath) => buildGiteeRawUrl(relativePath),
  messages: {
    notFound: (url) =>
      `文件不存在（404）：${url}，请检查 owner/repo/branch/path 配置` +
      `（分片数据路径应为 data/anime.manifest.json）`,
    forbidden: (url) => `访问被拒（403）：${url}，可能是私有仓库或触发 Gitee 限流`,
  },
})

/**
 * 从 Gitee Raw 下载并解析远程条目
 *
 * 委托给 `shardFetch.loadEntriesFromPath`：清单模式下按 `neededFields` 选片下载后
 * 按行拼接，旧单片路径仍可直接解析，清单取不到时自动回退单片。
 *
 * @param signal 可选 AbortSignal，用于取消请求
 * @param neededFields 本次同步会用到的字段；undefined 表示全量下载
 * @param stats 可选出参：回填缺合法 sid 被跳过的条数（供同步结果弹窗展示）
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export async function fetchGiteeJson(
  signal?: AbortSignal,
  neededFields?: ReadonlySet<string>,
  stats?: FetchLoadStats,
): Promise<GithubRemoteEntry[]> {
  const result = await loadEntriesFromPath({
    path: getGithubConfig().path,
    fetchText: fetchGiteeText,
    neededFields,
    manualShards: getManualShards(),
    signal,
    logTag: 'giteeSync',
  })
  if (stats) {
    // eslint-disable-next-line no-param-reassign -- stats 是有意的出参（调用方传字面量接收统计），不是「修改入参」
    stats.skippedInvalidLines = result.skippedInvalidRecords
  }
  return result.entries
}

// ========== SyncSource 接口实现 ==========

/**
 * Gitee 同步源实现
 *
 * 包装 fetchGiteeJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 * 与 GithubSyncSource / GitlabSyncSource 行为一致：
 * 1. validateConfig() 在下载前校验配置完整性（复用 githubConfig）
 * 2. fetchRemoteEntries() 委托给 fetchGiteeJson，仅 URL 构造不同
 */
export class GiteeSyncSource extends BaseSyncSource {
  constructor() {
    super(
      'gitee',
      'Gitee',
      isGithubConfigComplete,
      'Gitee 仓库配置不完整，请填写 owner/repo/branch/path',
    )
  }

  /**
   * 获取远程条目（委托给 fetchGiteeJson）
   * @param signal 可选的 AbortSignal
   * @param options 取数选项（分片模式下按表头选片）
   */
  async fetchRemoteEntries(
    signal?: AbortSignal,
    options?: FetchRemoteEntriesOptions,
  ): Promise<GithubRemoteEntry[]> {
    return fetchGiteeJson(signal, options?.neededFields, this.loadStats)
  }
}
