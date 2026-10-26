/**
 * @fileoverview 配置导入导出服务
 * @module services/configService
 * @description 聚合 PluginStorage 中的配置为 JSON 字符串以便备份迁移，
 *              导入时使用 zod 进行严格结构校验，校验失败返回 Result.fail。
 *
 *              导出内容分两部分：
 *              - 核心字段（token / userId / githubConfig）：结构化、经 zod 校验；
 *              - preferences：全部长期偏好键的扁平映射（主题、导航模式、模块排序、
 *                同步偏好、默认路径、日志级别、富化预览设置、番剧高亮、条件格式、
 *                数据清理的规则开关）。
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
import { loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId } from '../tools/util/index.js'
// 清理规则清单只用于枚举「哪些 bgm_clean_on_ 键该被导出」——clean-rules.ts 自身零
// import（纯数据），不会把 panel 层的依赖拉进 services 层（check:cycles 守这条）。
import { CLEAN_RULES } from '../panel/clean-rules.js'

/** 导出配置的当前版本号，与 FullConfigSchema.version 保持一致 */
const CONFIG_VERSION = 1 as const

/**
 * 参与导入导出的偏好键白名单。
 * token / userId 由核心字段单独承载；锁定状态（bgm_locked_*）属会话态，不入档。
 *
 * 分三组，按「谁拥有的」排：
 *   1. 全局偏好（主题 / 导航 / 同步 / 路径 / 日志）—— 设置页直接管；
 *   2. 高亮页（highlight.*）—— 8 个键，含 2026-10-22 新增的 sheetLock；
 *   3. 条件格式页（conditionalFormat.*）—— 4 个键，含 sheetLock；
 *   4. 清理页（bgm_clean_on_* / bgm_clean_sheets:*）—— 前缀键，见下方说明。
 *
 * 清理页的两个前缀为什么要单独处理：`bgm_clean_on_<规则id>` 一条规则一个键、
 * `bgm_clean_sheets:<工作簿全路径>` 一个工作簿一个键，**键的数量随用户的规则数 /
 * 工作簿数增长**，写不进静态白名单。故 `collectPreferences` / `applyPreferences`
 * 对这两个前缀做「枚举匹配」而非白名单命中（见两个函数里的 isCleanPrefixKey）。
 */
const EXPORTABLE_PREFERENCE_KEYS: readonly string[] = [
  // ---- 全局偏好（设置页）----
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
  // ---- 番剧高亮页 ----
  'highlight.source',
  'highlight.columns',
  'highlight.mode',
  'highlight.manual',
  'highlight.autoWatch',
  'highlight.lastApplied',
  'highlight.sheet',
  'highlight.sheetLock',
  // ---- 条件格式管理页 ----
  'conditionalFormat.rules.v1',
  'conditionalFormat.strategy.v1',
  'conditionalFormat.sheet.v1',
  'conditionalFormat.sheetLock',
]

/**
 * 清理页配置键的两个前缀。
 *
 * `bgm_clean_on_<规则id>`：一条规则一个键，**规则 id 是有限集合**（见
 * `CLEAN_RULES`），可以枚举后逐个读，故能导出。
 *
 * `bgm_clean_sheets:<工作簿全路径>`：一个工作簿一个键，**键的后半段是用户机器上
 * 的文件路径** —— PluginStorage 没有枚举接口（只有 get/set/remove），拿不到全部
 * 路径；且路径换一台机器就对不上，导出过去也没有意义。**这一族不导出**，
 * 用户到新机器重新勾选即可（导入侧仍接受，防止老文件导入报错）。
 */
const CLEAN_KEY_PREFIXES: readonly string[] = ['bgm_clean_on_']

/**
 * 参与导入导出的键判定：白名单命中，或是清理页可导出的前缀键。
 *
 * 抽成函数是因为读（collectPreferences 要逐个试）与写（applyPreferences 要校验
 * 导入文件里的键）两侧都要用同一口径 —— 两处各写一遍的条件，迟早会漂移。
 */
function isExportableKey(key: string): boolean {
  return (
    EXPORTABLE_PREFERENCE_KEYS.includes(key) ||
    CLEAN_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  )
}

/** 允许导入的偏好键集合（导出白名单 + 清理页不可导出的那一族，保证老文件能进） */
function isImportableKey(key: string): boolean {
  return isExportableKey(key) || key.startsWith('bgm_clean_sheets:')
}

/**
 * 收集当前所有偏好键的取值（仅包含已设置过的项，空值不入档）。
 *
 * 三类来源：
 *   1. 白名单里的固定键逐个读；
 *   2. 清理页的 `bgm_clean_on_<规则id>` —— 规则 id 有限，按 `CLEAN_RULES` 枚举；
 *   3. `bgm_clean_sheets:<路径>` 一族**不收集**（理由见 CLEAN_KEY_PREFIXES 注释）。
 */
function collectPreferences(): Record<string, string> {
  const preferences: Record<string, string> = {}
  for (const key of EXPORTABLE_PREFERENCE_KEYS) {
    const value = getConfig(key, '', true)
    if (value !== '') preferences[key] = value
  }
  for (const rule of CLEAN_RULES) {
    const key = `bgm_clean_on_${rule.id}`
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
    if (typeof value === 'string' && isImportableKey(key) && setConfig(key, value)) {
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
