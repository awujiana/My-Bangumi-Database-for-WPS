/**
 * @fileoverview 配置导入导出服务
 * @module services/configService
 * @description 聚合 PluginStorage 中的配置为 JSON 字符串以便备份迁移，
 *              导入时使用 zod 进行严格结构校验，校验失败返回 Result.fail。
 *
 *              导出内容分两部分：
 *              - 核心字段（token / userId / githubConfig）：结构化、经 zod 校验；
 *              - preferences：全部长期偏好键的扁平映射（主题、导航模式、模块排序、
 *                同步偏好、默认路径、日志级别、富化预览设置等）。
 *                新增偏好键无需改动本文件或 schema，导出会自动带上。
 */

// 直接从子模块导入，避开 index.ts 的副作用链（index → handlers → document.readyState）
import { BgmError, Result } from '../core/result.js'
import { FullConfigSchema, SyncStrategySchema } from '../schemas/plugin-storage.js'
import {
  getGithubConfig,
  setGithubConfig,
  getSyncStrategy,
  setSyncStrategy,
} from '../sync/github-config.js'
import type { SyncStrategy } from '../sync/github-sync-diff.js'
import { CONFIG_KEYS, getConfig, setConfig } from '../tools/config.js'
import { loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId } from '../tools/utility.js'

/** 导出配置的当前版本号，与 FullConfigSchema.version 保持一致 */
const CONFIG_VERSION = 1 as const

/**
 * 参与导入导出的偏好键白名单。
 * token / userId 由核心字段单独承载；锁定状态（bgm_locked_*）属会话态，不入档。
 */
const EXPORTABLE_PREFERENCE_KEYS: readonly string[] = [
  CONFIG_KEYS.THEME,
  CONFIG_KEYS.NAV_ICONS_ONLY,
  CONFIG_KEYS.NAV_ORDER,
  CONFIG_KEYS.LIST_TYPE,
  CONFIG_KEYS.TIME_FILTER,
  CONFIG_KEYS.REFRESH_INTERVAL,
  CONFIG_KEYS.INCREMENTAL_SYNC,
  CONFIG_KEYS.SKIP_CONFLICTS,
  CONFIG_KEYS.ENABLE_SYNC_RECORD,
  CONFIG_KEYS.EXPORT_PATH,
  CONFIG_KEYS.IMPORT_PATH,
  CONFIG_KEYS.LOG_LEVEL,
  CONFIG_KEYS.ENRICH_EP_SINGLE,
  CONFIG_KEYS.ENRICH_EP_FULL,
  CONFIG_KEYS.ENRICH_FILTER_KEYWORDS,
  CONFIG_KEYS.ENRICH_TAGS_COLOR,
  CONFIG_KEYS.ENRICH_PREMIERE_COLOR,
  CONFIG_KEYS.ENRICH_PLATFORM_COLOR,
  CONFIG_KEYS.ENRICH_AUTO_CLEAN,
]

/** 允许导入的偏好键集合（白名单的镜像，用于拒绝非本插件键） */
const IMPORTABLE_PREFERENCE_KEYS = new Set<string>(EXPORTABLE_PREFERENCE_KEYS)

/** 收集当前所有偏好键的取值（仅包含已设置过的项，空值不入档） */
function collectPreferences(): Record<string, string> {
  const preferences: Record<string, string> = {}
  for (const key of EXPORTABLE_PREFERENCE_KEYS) {
    const value = getConfig(key, '', true)
    if (value !== '') preferences[key] = value
  }
  return preferences
}

/**
 * 把导入文件中的 preferences 映射写回存储。
 * 只接受白名单内的键与字符串值，其余静默忽略（保证向前兼容）。
 * @returns 实际写入的键数量
 */
function applyPreferences(raw: unknown): number {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0
  let applied = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && IMPORTABLE_PREFERENCE_KEYS.has(key) && setConfig(key, value)) {
      applied += 1
    }
  }
  return applied
}

/**
 * 导出所有配置为 JSON 字符串
 *
 * 收集以下配置项：
 * - Bangumi Access Token（明文，来自 bgm_token）
 * - Bangumi 用户 ID（来自 bgm_user_id）
 * - GitHub 仓库配置（owner/repo/branch/path，来自 github_sync_*）
 * - 同步策略（来自 github_sync_strategy）
 * - preferences：全部长期偏好键（主题 / 导航 / 模块排序 / 同步偏好 / 默认路径 /
 *   日志级别 / 富化预览设置）
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
    preferences: collectPreferences(),
  }

  // 仅在已设置时包含 token / userId，避免导出 null 值
  // eslint-disable-next-line security/detect-possible-timing-attacks -- 与 null 做恒等比较，不涉及秘密值间的字符串比对，规则静态误报
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
 * `preferences` 字段为可选扩展：缺失（旧版导出文件）时仅恢复核心字段，
 * 存在时按白名单逐键写回，未知键与非字符串值静默忽略。
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
    return Result.failVoid(
      new BgmError(`JSON 解析失败: ${message}`, { code: 'CONFIG_PARSE_ERROR' }),
    )
  }

  const result = FullConfigSchema.safeParse(parsed)
  if (!result.success) {
    const errors = result.error.issues
      .map((index) => `${(index.path ?? []).join('.')}: ${index.message}`)
      .join('; ')
    return Result.failVoid(new BgmError(`配置校验失败: ${errors}`, { code: 'CONFIG_INVALID' }))
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

  // 恢复偏好配置（从原始 parsed 读取：zod 校验会剥离 schema 未声明的字段）
  if (parsed && typeof parsed === 'object') {
    applyPreferences((parsed as Record<string, unknown>).preferences)
  }

  return Result.okVoid()
}
