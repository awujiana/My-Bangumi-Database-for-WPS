/**
 * @fileoverview GitHub 仓库增量同步模块（源实现 + 取数 + 薄入口）
 * @module sync/githubSync
 * @description 从 GitHub 公开仓库下载 JSON 数据，按 SID 主键比对本地 Excel 行，
 *              增量更新（新增+更新，不删除本地多余行）。
 *
 *              2026-10-17 结构合并后的模块边界：
 *                · 本文件               GitHub 源（GithubSyncSource）与取数
 *                                       （fetchGithubText / fetchGithubJson），
 *                                       以及 syncFromGithub 薄壳；
 *                · remote-sync-core.ts  runRemoteSync 统一编排（两入口共用）；
 *                · remote-sync-apply.ts apply 阶段（本地读取 / 写差异 / undo /
 *                                       同步记录）。
 *              主流程与 apply 阶段已整体迁出（逐字迁移的 provenance 见两个新模块
 *              的文件头）；本文件保留其导出的兼容 re-export，消费方不变。
 *
 * 数据格式（远程 JSONL 文件，采用「表头 + 值数组」两段式）：
 *   第 1 个非空行   ["sid","name","updatedAt","date","meta_tags","nsfw","话数", ...]
 *   其后每行        ["12345","...","2026-07-21","2024-01-01",["标签1","标签2"],false,"12", ...]
 *   值数组按表头顺序排列，字段名只在表头出现一次（省去每行重复的键名）。
 *
 * URL 字段从 sid 构造：https://bgm.tv/subject/{sid}
 * type 字段默认为 2（动漫），用于同步记录显示。
 * updatedAt 为 YYYY-MM-DD 格式（仅日期，不含时间，节省空间）。
 */

// 直接从子模块导入，避开 index.ts 的副作用链（index → handlers → document.readyState）
import {
  buildRawUrl,
  getGithubConfig,
  getManualShards,
  isGithubConfigComplete,
} from './github-config.js'
import type {
  ConflictResolution,
  GithubRemoteEntry,
  SyncStrategy,
  SyncTimeFilter,
} from './github-sync-diff.js'
import { createRawTextFetcher } from './jsonl-response.js'
import { loadEntriesFromPath } from './shard-fetch.js'
import type { FetchLoadStats } from './shard-fetch.js'
import type { FetchRemoteEntriesOptions, SyncSource } from './sync-source.js'
import { BaseSyncSource } from './sync-source-base.js'
import { runRemoteSync } from './remote-sync-core.js'
import type { GithubSyncResult } from './remote-sync-apply.js'

// apply 阶段（readLocalEntriesForSync / applyDiffToSheet / applyConflictResolutions
// 与 GithubSyncResult）2026-10-17 起整体迁至 remote-sync-apply.ts；此处 re-export
// 保持既有消费方（ts/index.ts barrel、ui/sync-result-dialog.ts、按路径 mock 的测试）不变。
export {
  applyConflictResolutions,
  applyDiffToSheet,
  readLocalEntriesForSync,
} from './remote-sync-apply.js'
export type { GithubSyncResult } from './remote-sync-apply.js'

// 纯函数与类型从 githubSyncDiff.ts re-export，避免重复定义
// githubSyncDiff.ts 为零依赖纯模块，可在 Node 测试环境中直接运行
export {
  computeDiff,
  tagsToString,
  parseJsonl,
  isGithubRemoteEntry,
  filterByTime,
  SYNC_STRATEGY_LABELS,
  EXTENDED_FIELD_MAP,
  type GithubRemoteEntry,
  type GithubSyncDiff,
  type LocalRowEntry,
  type SyncStrategy,
  type SyncTimeFilter,
  type GithubSyncDetailItem,
} from './github-sync-diff.js'

/**
 * 按仓库内相对路径取原始文本（gzip 由 `readXhrJsonlText` 按魔数解压）
 *
 * 分片模式下每个分片各是一次独立请求，因此把「一次 GET + 解码」抽成可复用的
 * 回调，交给 `shardFetch.loadEntriesFromPath` 编排（清单 → 选片 → 拼接）。
 *
 * XHR 骨架与 Gitee / GitLab 完全同构，统一走 `createRawTextFetcher` 工厂
 * （见 `jsonl-response.ts`）：本处只提供 GitHub 的构 URL 逻辑与错误措辞。
 *
 * @param relativePath 仓库内相对路径（清单或任一分片文件）
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns 解码后的文本（JSONL / JSON 明文）
 * @throws 配置错误、网络错误、HTTP 非 200 时抛出 Error
 */
export const fetchGithubText = createRawTextFetcher({
  logTag: 'githubSync',
  buildUrl: (relativePath) => {
    if (!isGithubConfigComplete()) {
      throw new Error('GitHub 仓库配置不完整')
    }
    return buildRawUrl(relativePath)
  },
  messages: {
    notFound: (url) =>
      `文件不存在（404）：${url}，请检查 owner/repo/branch/path 配置` +
      `（数据文件路径应为 data/anime.manifest.json）`,
    forbidden: (url) =>
      `访问被拒（403）：${url}，可能是私有仓库或触发 GitHub 限流（未认证 60次/小时/IP）`,
  },
})

/**
 * 从 GitHub 下载并拼接远程条目
 *
 * 数据仓库自 2026-09-18 起改为「6 个字段分片 + 一份清单」，因此这里委托给
 * `shardFetch.loadEntriesFromPath`：配置指向清单（`data/anime.manifest.json`）→
 * 按 `neededFields` 选片下载后按行拼接。
 *
 * 只支持清单路径：旧单片 `data/bangumi.jsonlines.gz` 不再兼容，历史配置由
 * `github-config.ts` 的路径迁移表在读取时改写成清单路径。
 *
 * @param signal 可选 AbortSignal，用于取消请求
 * @param neededFields 本次同步会用到的字段（来自用户表格表头）；undefined 表示全量下载
 * @returns 拼接后的条目数组
 * @throws 网络错误、配置错误、清单/分片格式非法时抛出 Error
 */
export async function fetchGithubJson(
  signal?: AbortSignal,
  neededFields?: ReadonlySet<string>,
  stats?: FetchLoadStats,
): Promise<GithubRemoteEntry[]> {
  const result = await loadEntriesFromPath({
    path: getGithubConfig().path,
    fetchText: fetchGithubText,
    neededFields,
    manualShards: getManualShards(),
    signal,
    logTag: 'githubSync',
  })
  if (stats) {
    // eslint-disable-next-line no-param-reassign -- stats 是有意的出参（调用方传字面量接收统计），不是「修改入参」
    stats.skippedInvalidLines = result.skippedInvalidRecords
  }
  return result.entries
}

// ========== SyncSource 接口实现 ==========

/**
 * GitHub 同步源实现
 *
 * 包装 fetchGithubJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 * 通过 syncFromGithub 主流程统一调用：
 * 1. validateConfig() 在下载前校验配置完整性（骨架见 BaseSyncSource）
 * 2. fetchRemoteEntries() 复用既有 fetchGithubJson 实现，保持向后兼容
 */
export class GithubSyncSource extends BaseSyncSource {
  constructor() {
    super(
      'github',
      'GitHub',
      isGithubConfigComplete,
      'GitHub 仓库配置不完整，请填写 owner/repo/branch/path',
    )
  }

  /**
   * 获取远程条目（委托给 fetchGithubJson）
   * @param signal 可选的 AbortSignal
   * @param options 取数选项（分片模式下按表头选片）
   */
  async fetchRemoteEntries(
    signal?: AbortSignal,
    options?: FetchRemoteEntriesOptions,
  ): Promise<GithubRemoteEntry[]> {
    const entries = await fetchGithubJson(signal, options?.neededFields, this.loadStats)
    return entries
  }
}

/**
 * GitHub 同步入口（GitHub 源专用薄壳）
 *
 * 2026-10-17 结构合并：主流程已收敛到 remote-sync-core.ts 的 runRemoteSync，本函数
 * 只负责组装 GitHub 源与入口级参数（logTag / 校验失败兜底文案）。
 *
 * ⚠️ 参数顺序与 syncFromRemote **不同**（第 4、5 位互换：conflictResolution 在前），
 * 既有调用方（action-handlers / ribbon-service 链路）依赖该签名，勿「顺手统一」。
 *
 * 如需按 sourceType 动态选择数据源，请使用 syncSourceRegistry.ts 中的 syncFromRemote。
 *
 * @param onProgress 进度回调
 * @param strategy 同步策略，默认 'add-update'
 * @param signal 可选 AbortSignal，用于取消请求
 * @param conflictResolution 可选冲突解决决策列表；提供时将按用户选择过滤 update diff 的字段
 * @param shouldUseSelectedRowsOnly 仅同步选中行
 * @param timeFilter 时间筛选条件
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误时抛出
 */
export async function syncFromGithub(
  onProgress?: (current: number, total: number, message: string, eta?: string) => void,
  strategy: SyncStrategy = 'add-update',
  signal?: AbortSignal,
  conflictResolution?: ConflictResolution[],
  shouldUseSelectedRowsOnly?: boolean,
  timeFilter?: SyncTimeFilter,
): Promise<GithubSyncResult> {
  const source: SyncSource = new GithubSyncSource()
  return runRemoteSync({
    source,
    logTag: 'syncFromGithub',
    validationFailedMessage: 'GitHub 同步源配置校验失败',
    onProgress,
    strategy,
    signal,
    conflictResolution,
    shouldUseSelectedRowsOnly,
    timeFilter,
  })
}
