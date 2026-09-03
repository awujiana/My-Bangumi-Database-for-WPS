/**
 * @fileoverview 配置导入导出服务
 * @module services/configService
 * @description 聚合 PluginStorage 中的配置为 JSON 字符串以便备份迁移，
 *              导入时使用 zod 进行严格结构校验，校验失败返回 Result.fail。
 */

// 直接从子模块导入，避开 index.ts 的副作用链（index → handlers → document.readyState）
import { BgmError, Result } from '../core/result.js'
import { FullConfigSchema, SyncStrategySchema } from '../schemas/pluginStorage.js'
import {
  getGithubConfig,
  setGithubConfig,
  getSyncStrategy,
  setSyncStrategy,
} from '../sync/githubConfig.js'
import type { SyncStrategy } from '../sync/githubSyncDiff.js'
import { loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId } from '../tools/utility.js'

/** 导出配置的当前版本号，与 FullConfigSchema.version 保持一致 */
const CONFIG_VERSION = 1 as const

/**
 * 导出所有配置为 JSON 字符串
 *
 * 收集以下配置项：
 * - Bangumi Access Token（明文，来自 bgm_token）
 * - Bangumi 用户 ID（来自 bgm_user_id）
 * - GitHub 仓库配置（owner/repo/branch/path，来自 github_sync_*）
 * - 同步策略（来自 github_sync_strategy）
 *
 * @returns 格式化的 JSON 字符串（2 空格缩进）
 *
 * @example
 * ```typescript
 * const json = exportConfig();
 * // { "version": 1, "exportedAt": "2026-07-21T...", "token": "...", ... }
 * ```
 */
export function exportConfig(): string {
  const token = loadBgToken()
  const userId = _getBgmUserId()
  const githubConfig = getGithubConfig()
  const strategy = getSyncStrategy()

  const config: Record<string, unknown> = {
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    githubConfig: {
      owner: githubConfig.owner,
      repo: githubConfig.repo,
      branch: githubConfig.branch,
      path: githubConfig.path,
      strategy,
    },
  }

  // 仅在已设置时包含 token / userId，避免导出 null 值
  if (token !== null) {
    config.token = token
  }
  if (userId !== null) {
    config.userId = userId
  }

  return JSON.stringify(config, null, 2)
}

/**
 * 导入配置（带 zod 严格校验）
 *
 * 解析并校验 JSON 字符串，校验通过后将各配置项写回对应的 PluginStorage key。
 * 校验失败时返回 Result.fail，不会修改任何已存储的配置。
 *
 * @param json - JSON 格式的配置字符串
 * @returns `Result<void>` — 成功返回 ok，失败返回包含 BgmError 的 fail
 *
 * @example
 * ```typescript
 * const result = importConfig(jsonString);
 * if (result.isOk()) {
 *     showToast('配置导入成功', 'success');
 * } else {
 *     showToast(`导入失败: ${result.error?.message}`, 'error');
 * }
 * ```
 */
export function importConfig(json: string): Result<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return Result.failVoid(new BgmError(`JSON 解析失败: ${message}`, 'CONFIG_PARSE_ERROR'))
  }

  const result = FullConfigSchema.safeParse(parsed)
  if (!result.success) {
    const errors = result.error.issues
      .map((index) => `${(index.path ?? []).join('.')}: ${index.message}`)
      .join('; ')
    return Result.failVoid(new BgmError(`配置校验失败: ${errors}`, 'CONFIG_INVALID'))
  }

  const config = result.data

  // 恢复 Token（仅在配置中存在时）
  if (config.token) {
    storeBgToken(config.token)
  }

  // 恢复用户 ID（仅在配置中存在时；_setBgmUserId 内部会忽略空值）
  if (config.userId) {
    _setBgmUserId(config.userId)
  }

  // 恢复 GitHub 仓库配置与同步策略
  if (config.githubConfig) {
    const gc = config.githubConfig
    setGithubConfig({
      owner: gc.owner,
      repo: gc.repo,
      branch: gc.branch,
      path: gc.path,
    })
    if (gc.strategy) {
      // 配置里的 default 已经保证 value ∈ SyncStrategy；这里用一次 schema 缩窄
      const sResult = SyncStrategySchema.safeParse(gc.strategy)
      if (sResult.success) {
        setSyncStrategy(sResult.data as unknown as SyncStrategy)
      } else {
        setSyncStrategy('add-update')
      }
    }
  }

  return Result.okVoid()
}
