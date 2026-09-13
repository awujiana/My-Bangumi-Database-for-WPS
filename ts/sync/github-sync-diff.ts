/**
 * @fileoverview GitHub 同步差异计算（纯函数模块）
 * @module sync/githubSyncDiff
 * @description 提供 GitHub 远程条目与本地 Excel 行的差异计算逻辑。
 *
 * 本模块为零依赖纯函数模块，不导入任何项目模块（避免触发 index.ts → handlers.ts
 * 的 document 副作用链），可在 Node 测试环境中直接运行。
 *
 * type 字段约定（与 Bangumi 一致）：
 *   1=想看  2=在看  3=看过  4=搁置  5=抛弃
 *
 * 远程数据文件格式（数据仓库 data/bangumi.jsonlines.gz 与各镜像源一致）：
 *   第 1 个非空行是表头（纯字符串数组），其后每行是与表头等长的值数组。
 *   解析细节见 {@link parseJsonl}。
 */

/** 远程 JSON 单条记录结构 */
export interface GithubRemoteEntry {
  /** Bangumi subject ID（主键） */
  sid: string
  /** 条目名称 */
  name?: string
  /** 远程更新时间戳 */
  updatedAt?: string
  // ── 扩展字段（dump 顶层 + infobox 解析，对应 Excel 完整表头）──
  /** 开播日期（dump.date） */
  date?: string
  /** 标签/分级（dump.meta_tags，写入「标签/分级」列） */
  meta_tags?: string[]
  /** 布尔（dump.nsfw） */
  nsfw?: boolean
  /** 完播日（infobox.播放结束） */
  播放结束?: string
  /** 制作公司（infobox.动画制作公司） */
  动画制作公司?: string
  /** 集数（infobox.话数，写入「集数」列） */
  话数?: string
  /** 时长/分钟（infobox.片长） */
  片长?: string
  /** 制片国家（infobox.制片国家） */
  制片国家?: string
  /** 语言（infobox.语言） */
  语言?: string
  /** 类型（infobox.类型） */
  类型?: string
  /** 导演（infobox.导演） */
  导演?: string
  /** 音乐（infobox.音乐） */
  音乐?: string
  /** 人物设定（infobox.人物设定） */
  人物设定?: string
  /** 机械设定（infobox.机械设定） */
  机械设定?: string
  /** 原作（infobox.原作） */
  原作?: string
  /** 脚本（infobox.脚本） */
  脚本?: string
  /** 分镜（infobox.分镜） */
  分镜?: string
  /** 演出（infobox.演出） */
  演出?: string
  /** 原案（infobox.原案） */
  原案?: string
  /** 系列构成（infobox.系列构成） */
  系列构成?: string
  /** 在线播放平台（infobox.在线播放平台） */
  在线播放平台?: string
  /** 关联的动漫ID（subject-relations） */
  关联的动漫ID?: string
  // ── 全量保真字段（随 dump 全量下发；插件暂不映射到 Excel 列）──
  /** 原始名（dump.name，与 name 并存，避免原始名丢失） */
  name_original?: string
  /** 条目类型（dump.type，2=动画） */
  type?: number
  /** 平台（dump.platform） */
  platform?: number
  /** 是否系列作（dump.series） */
  series?: boolean
  /** 评分（dump.score） */
  score?: number
  /** 排名（dump.rank） */
  rank?: number
  /** 评分分布（dump.score_details，固定序 [1分..10分] 各自人数） */
  score_details?: number[]
  /** 收藏统计（dump.favorite，固定序 [想看,看过,在看,搁置,抛弃]） */
  favorite?: number[]
  /** 用户标签（已压缩为 "名称:计数|名称:计数"） */
  tags?: string
  /** 简介（dump.summary） */
  summary?: string
  /** infobox 原文（dump.infobox，未裁剪） */
  infobox?: string
  /** 别名（infobox 别名，多值以 " | " 分隔） */
  别名?: string
}

/**
 * 用户对单条冲突的解决决策
 *
 * chosenValue 为 'local' 时表示保留本地值（从 diff.changedFields 中移除该字段）；
 * 为 'remote' 时表示采用远程值（保留该字段在 changedFields 中）。
 */
export interface ConflictResolution {
  /** Bangumi subject ID（主键） */
  sid: string
  /** 冲突字段名（与 Conflict.field 对应） */
  field: string
  /** 用户选择的值来源 */
  chosenValue: 'local' | 'remote'
}

/**
 * 扩展字段映射表：JSONL 字段名 → Excel 标准字段名（colMap key）
 *
 * 用于 computeDiff 比对和 writeRemoteEntryToRow 写入扩展字段。
 *
 * 特殊处理（不在此表中）：
 * - '话数' 写入「集数」列（有独立处理逻辑）
 * - 'meta_tags' 写入「标签/分级」列（有独立处理逻辑）
 * - 'nsfw' 无明确 Excel 列映射，暂不处理
 */
export const EXTENDED_FIELD_MAP: readonly (readonly [string, string])[] = [
  ['date', '开播日期'],
  ['播放结束', '完播日'],
  ['动画制作公司', '制作公司'],
  ['片长', '时长'],
  ['制片国家', '制片国家'],
  ['语言', '语言'],
  ['类型', '类型'],
  ['导演', '导演'],
  ['音乐', '音乐'],
  ['人物设定', '人物设定'],
  ['机械设定', '机械设定'],
  ['原作', '原作'],
  ['脚本', '脚本'],
  ['分镜', '分镜'],
  ['演出', '演出'],
  ['原案', '原案'],
  ['系列构成', '系列构成'],
  ['在线播放平台', '在线播放平台'],
  ['关联的动漫ID', '关联的动漫ID'],
] as const

/**
 * JSONL 字段 → Excel 列名别名映射
 *
 * 用于处理一个 JSONL 字段可能对应多个 Excel 列名的情况。
 * 目前仅用于「动画制作公司」：本地可能使用「制作公司」或「动画制作公司」作为列名，
 * 远程仓库统一使用「动画制作公司」字段。
 *
 * - 比对时：本地任一列名存在且与远程值不同均视为差异
 * - 写入时：同时写入所有存在的列（避免丢失本地另一列的数据）
 */
const JSONL_FIELD_EXCEL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  动画制作公司: ['制作公司', '动画制作公司'],
}

/**
 * 获取指定 JSONL 字段对应的所有 Excel 列名（含主映射和别名）
 *
 * @param jsonlField JSONL 字段名
 * @returns Excel 列名数组（至少包含 1 个元素）
 */
export function getExcelAliases(jsonlField: string): readonly string[] {
  const mapped = EXTENDED_FIELD_MAP.find(([jf]) => jf === jsonlField)
  const primary = mapped ? [mapped[1]] : []
  const aliases = JSONL_FIELD_EXCEL_ALIASES[jsonlField] ?? []
  // 合并去重：主映射在前，别名在后
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of [...primary, ...aliases]) {
    const isNewName = !seen.has(name)
    if (isNewName) {
      seen.add(name)
      result.push(name)
    }
  }
  return result
}

/**
 * 将远程扩展字段值转为字符串用于比对
 * @param value 远程字段值（string | number | undefined）
 * @returns 字符串表示；undefined/null/空字符串 → ''
 */
function toExtensionStringValue(value: string | number | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'number') return String(value)
  return value
}

/**
 * 同步策略枚举
 * - add-update: 新增+更新，不删除（默认，保守）
 * - add-only: 仅新增本地不存在的 SID，不更新已有行
 * - update-only: 仅更新本地已存在的 SID，不新增行
 * - mirror: 镜像同步（新增+更新+删除本地多余行）
 * - force-overwrite: 强制覆盖（无视字段比对，远程值全部覆盖本地，含空值）
 */
export type SyncStrategy = 'add-update' | 'add-only' | 'update-only' | 'mirror' | 'force-overwrite'

/** 策略中文标签映射（供 UI 下拉框使用） */
export const SYNC_STRATEGY_LABELS: Readonly<Record<SyncStrategy, string>> = Object.freeze({
  'add-update': '新增+更新（不删除）',
  'add-only': '仅新增',
  'update-only': '仅更新',
  mirror: '镜像同步（含删除）',
  'force-overwrite': '强制覆盖',
})

/** 单条差异记录 */
export interface GithubSyncDiff {
  /** 差异类型 */
  kind: 'add' | 'update' | 'delete'
  /** 主键 SID */
  sid: string
  /** 远程条目数据（delete 时为 undefined） */
  remote?: GithubRemoteEntry
  /** 本地行号（update/delete 时有值，add 时为 undefined） */
  localRow?: number
  /** 变更字段列表（add/force-overwrite 时为 ['*']） */
  changedFields: string[]
}

/** 同步结果单条明细（用于详情表格展示） */
export interface GithubSyncDetailItem {
  /** 操作类型 */
  kind: 'add' | 'update' | 'delete' | 'fail'
  /** 主键 SID */
  sid: string
  /** 条目名称 */
  name?: string | undefined
  /** 本地行号（add 成功后可回填） */
  row?: number | undefined
  /** 变更字段列表（add/force-overwrite 时为 ['全部字段']） */
  fields?: string[] | undefined
  /** 失败原因或删除备注 */
  message?: string | undefined
}

/** 本地行数据（仅包含 diff 所需字段） */
export interface LocalRowEntry {
  /** 行号 */
  row: number
  /** SID（主键） */
  sid: string
  /** 各字段值 */
  fields: Record<string, string>
}

/**
 * 将远程 tags 数组转为本地「标签/分级」文本（用 | 分隔）
 */
export function tagsToString(tags: string[] | undefined): string {
  if (!Array.isArray(tags) || tags.length === 0) return ''
  return tags.join('|')
}

/**
 * 类型守卫：判断未知值是否为 GithubRemoteEntry
 */
export function isGithubRemoteEntry(value: unknown): value is GithubRemoteEntry {
  return (
    typeof value === 'object' && value !== null && 'sid' in value && typeof value.sid === 'string'
  )
}

/**
 * 解析错误：1-based 行号 + 原因
 */
export interface JsonlParseError {
  /** 1-based 行号 */
  line: number
  /** 失败原因 */
  reason: string
}

/**
 * 类型守卫：判断未知值是否为纯字符串数组（即合法的表头行）
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * 解析单行 JSON；失败时把原因写入 errors 并返回 undefined
 *
 * JSON.parse 对合法输入不会返回 undefined（最坏是 null），因此可用 undefined 作失败哨兵。
 */
function parseLine(trimmed: string, lineNumber: number, errors: JsonlParseError[]): unknown {
  try {
    return JSON.parse(trimmed) as unknown
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    errors.push({ line: lineNumber, reason })
    return undefined
  }
}

/**
 * 把一行值数组按表头映射成记录对象
 *
 * @param header 表头字段名（顺序即列序）
 * @param row 该行的值数组
 * @returns 成功为 { entry }；失败为 { reason }
 */
function buildEntry(
  header: string[],
  row: unknown,
): { entry: GithubRemoteEntry } | { reason: string } {
  if (!Array.isArray(row)) {
    return { reason: '该行不是数组（新格式要求首行为表头，其后每行为值数组）' }
  }
  if (row.length !== header.length) {
    return {
      reason: `字段数不匹配：表头 ${String(header.length)} 个，该行 ${String(row.length)} 个`,
    }
  }
  const object: Record<string, unknown> = Object.fromEntries(
    header.map((field, column): [string, unknown] => [field, row.at(column)]),
  )
  if (!isGithubRemoteEntry(object)) {
    return { reason: '对象缺少 sid 字段或 sid 不是字符串' }
  }
  return { entry: object }
}

/**
 * 解析 JSONL 文本为 GithubRemoteEntry 数组
 *
 * 文件采用「表头 + 值数组」两段式（仍是 JSON Lines，每行一个合法 JSON）：
 *
 * ```
 * ["sid","name","updatedAt", ...]          <- 第 1 个非空行：表头（纯字符串数组）
 * ["8","Code Geass 反叛的鲁路修R2", ...]    <- 其后每行：与表头等长的值数组
 * ```
 *
 * 字段名只在表头出现一次，不再随每条记录重复。
 * 空行与首尾空白会被忽略；非法行的行号会被收集到 errors 中但不中断整体解析。
 *
 * @param text JSONL 原始文本
 * @returns 解析结果：{ entries: 合法条目; errors: 非法行信息（1-based 行号+原因） }
 */
export function parseJsonl(text: string): {
  entries: GithubRemoteEntry[]
  errors: JsonlParseError[]
} {
  const entries: GithubRemoteEntry[] = []
  const errors: JsonlParseError[] = []

  if (!text || typeof text !== 'string') {
    return { entries, errors }
  }

  // 先收集非空行（保留 1-based 行号，便于错误定位）
  const content: { lineNumber: number; trimmed: string }[] = []
  for (const [index, raw] of text.split(/\r\n|\r|\n/).entries()) {
    const trimmed = raw.trim()
    if (trimmed) {
      content.push({ lineNumber: index + 1, trimmed })
    }
  }

  // 第 1 个非空行必须是表头
  const headerLine = content.at(0)
  if (!headerLine) {
    return { entries, errors }
  }
  const rawHeader = parseLine(headerLine.trimmed, headerLine.lineNumber, errors)
  if (rawHeader === undefined) {
    return { entries, errors }
  }
  if (!isStringArray(rawHeader)) {
    errors.push({
      line: headerLine.lineNumber,
      reason: '首行必须是表头（纯字符串数组），其后每行必须是等长的值数组',
    })
    return { entries, errors }
  }

  // 其余非空行按表头映射成记录
  for (const { lineNumber, trimmed } of content.slice(1)) {
    const parsed = parseLine(trimmed, lineNumber, errors)
    if (parsed !== undefined) {
      const result = buildEntry(rawHeader, parsed)
      if ('entry' in result) {
        entries.push(result.entry)
      } else {
        errors.push({ line: lineNumber, reason: result.reason })
      }
    }
  }

  return { entries, errors }
}

// ========== 同步时间筛选 ==========

/**
 * 同步时间筛选配置
 *
 * 支持五种筛选模式：
 * - 'all': 不过滤（全部同步）
 * - 'year': 按年份筛选（如 2026 年所有动漫）
 * - 'quarter': 按季度筛选（如 2026 年 4 月新番）
 * - 'month': 按月份筛选（如 2025 年 1 月）
 * - 'future': 预告/未来动漫（无开播日期的条目）
 */
export interface SyncTimeFilter {
  /** 是否启用时间筛选 */
  enabled: boolean
  /** 目标年份 */
  year: number
  /** 筛选范围 */
  range: 'all' | 'year' | 'quarter' | 'month' | 'future'
  /** 季度值（仅 range='quarter' 时有效）：1 | 4 | 7 | 10 */
  quarter?: 1 | 4 | 7 | 10
  /** 月份值（仅 range='month' 时有效）：1-12 */
  month?: number
}

/**
 * 季度范围定义（按日本动漫季度划分）
 *
 * - 1月新番：上年12月 — 本年2月
 * - 4月新番：3月 — 5月
 * - 7月新番：6月 — 8月
 * - 10月新番：9月 — 11月
 */
const QUARTER_MONTH_RANGES: Readonly<Record<number, readonly [number, number, number]>> = {
  // 1月新番：上年12月、本年1月、本年2月
  1: [12, 1, 2],
  // 4月新番：3月、4月、5月
  4: [3, 4, 5],
  // 7月新番：6月、7月、8月
  7: [6, 7, 8],
  // 10月新番：9月、10月、11月
  10: [9, 10, 11],
} as const

/**
 * 按时间筛选远程条目
 *
 * 根据 {@link SyncTimeFilter} 配置，基于远程条目的 `date` 字段（开播日期）
 * 进行年份/季度/月份筛选，或筛选预告/未来动漫（无开播日期）。
 * 日期格式支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 等。
 *
 * 特殊模式：
 * - future: 筛选无开播日期的条目（预告/未来动漫）
 *
 * 季度规则：
 * - 1月新番（Q1）：上年12月 + 本年1月 + 本年2月
 * - 4月新番（Q2）：3月 + 4月 + 5月
 * - 7月新番（Q3）：6月 + 7月 + 8月
 * - 10月新番（Q4）：9月 + 10月 + 11月
 *
 * @param entries 远程条目数组
 * @param filter 时间筛选配置
 * @returns 筛选后的条目数组
 */
export function filterByTime(
  entries: GithubRemoteEntry[],
  filter: SyncTimeFilter,
): GithubRemoteEntry[] {
  if (!filter.enabled || filter.range === 'all') return entries

  // 预告/未来动漫筛选：无开播日期的条目
  if (filter.range === 'future') {
    return entries.filter((entry) => !entry.date || entry.date.trim() === '')
  }

  return entries.filter((entry) => {
    if (!entry.date || entry.date.trim() === '') return false

    // 解析日期：支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 等格式
    const match = /^(\d{4})[-/.](\d{1,2})/.exec(entry.date)
    if (!match) return false

    const yearString = match[1]
    const monthString = match[2]
    if (!yearString || !monthString) return false
    const year = Number(yearString)
    const month = Number(monthString)
    if (Number.isNaN(year) || Number.isNaN(month)) return false

    switch (filter.range) {
      case 'year': {
        // 按年份筛选：匹配给定年份的任意月份
        return year === filter.year
      }

      case 'quarter': {
        // 按季度筛选
        const qMonths = QUARTER_MONTH_RANGES[filter.quarter ?? 1]
        if (!qMonths) return false
        if (!qMonths.includes(month)) return false
        // 处理季度跨年：1月新番的12月属于上年
        if (month === 12) return year === filter.year - 1
        return year === filter.year
      }

      case 'month': {
        // 按月份筛选
        return year === filter.year && month === (filter.month ?? 1)
      }

      default: {
        return false
      }
    }
  })
}

/**
 * 检查日期字符串是否匹配时间筛选条件
 *
 * 用于 mirror 策略下判断本地条目是否在筛选范围内，
 * 避免因远程数据被时间筛选过滤而导致本地条目被误删。
 *
 * 对于 'future' 模式，所有本地条目都被视为在筛选范围内（保留不删除），
 * 因为预告/未来筛选仅影响远程数据下载，不影响本地已有数据。
 *
 * @param dateString 日期字符串（本地格式如"2015年12月15日"或远程格式"2015-12-15"）
 * @param filter 时间筛选配置
 * @returns true 表示在筛选范围内
 */
function isWithinTimeFilter(dateString: string, filter: SyncTimeFilter): boolean {
  // 预告/未来模式：所有本地条目都保留
  if (filter.range === 'future') return true

  // 支持本地"YYYY年MM月DD日"格式和远程"YYYY-MM-DD"格式
  const match = /(\d{4})[-/.年](\d{1,2})/.exec(dateString)
  if (!match) return false

  const yearString = match[1]
  const monthString = match[2]
  if (!yearString || !monthString) return false
  const year = Number(yearString)
  const month = Number(monthString)
  if (Number.isNaN(year) || Number.isNaN(month)) return false

  switch (filter.range) {
    case 'year': {
      return year === filter.year
    }
    case 'quarter': {
      const qMonths = QUARTER_MONTH_RANGES[filter.quarter ?? 1]
      if (!qMonths) return false
      if (!qMonths.includes(month)) return false
      if (month === 12) return year === filter.year - 1
      return year === filter.year
    }
    case 'month': {
      return year === filter.year && month === (filter.month ?? 1)
    }
    default: {
      return true
    }
  }
}

/**
 * 计算远程条目与本地条目的差异（按指定策略）
 *
 * 比对规则（基础）：
 * - 远程有、本地无 → add（changedFields = ['*']）
 * - 远程与本地 SID 相同 → 逐字段比对，任一字段不同则 update
 * - 远程字段为 undefined/空 → 不视为差异（保留本地值）
 * - 远程 meta_tags 数组用 | 拼接后比对
 * - 远程「话数」转为字符串后比对
 *
 * 策略修饰：
 * - add-update: 基础规则（add + update，无 delete）
 * - add-only: 仅返回 add，已存在的 SID 全部跳过
 * - update-only: 仅返回 update，本地不存在的 SID 全部跳过
 * - mirror: 基础规则 + 本地存在但远程不存在的 SID 标记为 delete
 * - force-overwrite: 已存在的 SID 强制标记为 update（changedFields = ['*']），
 *                    远程空值也会覆盖本地（applyDiffToSheet 中处理）
 *
 * @param remoteEntries 远程条目数组
 * @param localEntries 本地条目映射（SID → 行）
 * @param strategy 同步策略，默认 'add-update'
 * @returns 差异列表（按策略包含 add/update/delete，不含 unchanged）
 */
export function computeDiff(
  remoteEntries: GithubRemoteEntry[],
  localEntries: Map<string, LocalRowEntry>,
  strategy: SyncStrategy = 'add-update',
  timeFilter?: SyncTimeFilter,
): GithubSyncDiff[] {
  const diffs: GithubSyncDiff[] = []
  const remoteSids = new Set<string>()

  for (const remote of remoteEntries) {
    const hasRemoteSid = Boolean(remote.sid)
    if (hasRemoteSid) {
      remoteSids.add(remote.sid)
      const local = localEntries.get(remote.sid)

      // 新增：本地无对应 SID
      if (!local) {
        // update-only 策略：跳过新增
        if (strategy !== 'update-only') {
          diffs.push({
            kind: 'add',
            sid: remote.sid,
            remote,
            changedFields: ['*'],
          })
        }
      } else if (strategy !== 'add-only') {
        if (strategy === 'force-overwrite') {
          diffs.push({
            kind: 'update',
            sid: remote.sid,
            remote,
            localRow: local.row,
            changedFields: ['*'],
          })
        } else {
          const changedFields: string[] = []

          // 比对 Bangumi_URL（从 sid 构造的派生字段，确保 URL 列总是被正确更新）
          // 仅当本地存在 Bangumi_URL 字段时才比对（列映射中包含该列）
          const expectedUrl = `https://bgm.tv/subject/${remote.sid}`
          if ('Bangumi_URL' in local.fields) {
            const localUrl = local.fields.Bangumi_URL
            if (localUrl !== expectedUrl) {
              changedFields.push('Bangumi_URL')
            }
          }

          // 比对名称
          if (remote.name && remote.name !== local.fields['名称']) {
            changedFields.push('名称')
          }

          // 比对标签（使用 meta_tags）
          const remoteTags = tagsToString(remote.meta_tags)
          if (remoteTags && remoteTags !== local.fields['标签/分级']) {
            changedFields.push('标签/分级')
          }

          // 比对集数（使用 infobox 的「话数」）
          const remoteEpisodeValue = remote['话数'] ?? ''
          if (remoteEpisodeValue && remoteEpisodeValue !== local.fields['集数']) {
            changedFields.push('集数')
          }

          // 比对扩展字段（EXTENDED_FIELD_MAP 中定义的 19 个字段）
          // 对于有多个 Excel 列名的字段（如「动画制作公司」→「制作公司」/「动画制作公司」），
          // 任一列存在且与远程值不同都视为差异。
          const comparedFields = new Set<string>()
          for (const [jsonlField] of EXTENDED_FIELD_MAP) {
            const remoteValue = remote[jsonlField as keyof GithubRemoteEntry]
            if (remoteValue !== undefined) {
              const remoteString = toExtensionStringValue(remoteValue as string | number)
              const excelAliases = getExcelAliases(jsonlField)
              for (const excelField of excelAliases) {
                // 提取条件变量使循环体含多条语句，消除 no-continue 与 unicorn/prefer-continue 的规则冲突
                const isChangedField = Boolean(
                  remoteString &&
                  !comparedFields.has(excelField) &&
                  remoteString !== (local.fields[excelField] ?? ''),
                )
                if (isChangedField) {
                  changedFields.push(excelField)
                  comparedFields.add(excelField)
                }
              }
            }
          }

          if (changedFields.length > 0) {
            diffs.push({
              kind: 'update',
              sid: remote.sid,
              remote,
              localRow: local.row,
              changedFields,
            })
          }
        }
      }
    }
  }

  // mirror 策略：本地存在但远程不存在的 SID 标记为 delete
  if (strategy === 'mirror') {
    for (const [sid, local] of localEntries) {
      const isMissingRemote = !remoteSids.has(sid)
      if (isMissingRemote) {
        // 时间筛选启用时：本地条目的开播日期不在筛选范围内的，跳过 delete
        // 避免因时间筛选过滤了远程数据，导致本地其他时间段的数据被误删
        let isInTimeRange = true
        if (timeFilter?.enabled && timeFilter.range !== 'all') {
          const localDate = local.fields['开播日期']
          isInTimeRange =
            localDate !== undefined && localDate !== '' && isWithinTimeFilter(localDate, timeFilter)
        }
        if (isInTimeRange) {
          diffs.push({
            kind: 'delete',
            sid,
            localRow: local.row,
            changedFields: ['*'],
          })
        }
      }
    }
  }

  return diffs
}
