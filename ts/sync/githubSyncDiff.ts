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
 */

/** 远程 JSON 单条记录结构 */
export interface GithubRemoteEntry {
  /** Bangumi subject ID（主键） */
  sid: string
  /** Bangumi 条目 URL */
  url?: string
  /** 条目名称 */
  name?: string
  /** 条目类别（1=书籍, 2=动漫, 3=音乐, 4=游戏, 6=三次元） */
  type?: number
  /** 评分（0-10） */
  score?: number
  /** 标签数组 */
  tags?: string[]
  /** 看到集数 */
  episode?: number
  /** 远程更新时间戳 */
  updatedAt?: string
  // ── 扩展字段（dump 顶层 + infobox 解析，对应 Excel 完整表头）──
  /** 开播日期（dump.date） */
  date?: string
  /** 类别（dump.platform） */
  platform?: number
  /** 标签/分级（dump.meta_tags，优先于 tags 写入「标签/分级」列） */
  meta_tags?: string[]
  /** 布尔（dump.nsfw） */
  nsfw?: boolean
  /** 完播日（infobox.播放结束） */
  播放结束?: string
  /** 制作公司（infobox.动画制作公司） */
  动画制作公司?: string
  /** 集数（infobox.话数，优先于 episode 写入「集数」列） */
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
}

/**
 * 扩展字段映射表：JSONL 字段名 → Excel 标准字段名（colMap key）
 *
 * 用于 computeDiff 比对和 writeRemoteEntryToRow 写入扩展字段。
 * 基础字段（url, name, score, tags, comment, episode）有独立的处理逻辑，不在此表中。
 *
 * 特殊处理（不在此表中）：
 * - '话数' 通过 episode 逻辑处理（优先于 episode 写入「集数」列）
 * - 'meta_tags' 通过 tags 逻辑处理（优先于 tags 写入「标签/分级」列）
 * - 'nsfw' 无明确 Excel 列映射，暂不处理
 */
export const EXTENDED_FIELD_MAP: ReadonlyArray<readonly [string, string]> = [
  ['date', '开播日期'],
  ['播放结束', '完播日'],
  ['platform', '类别'],
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
 * 将远程扩展字段值转为字符串用于比对
 * @param value 远程字段值（string | number | undefined）
 * @returns 字符串表示；undefined/null/空字符串 → ''
 */
function toExtStringValue(value: string | number | undefined): string {
  if (value === undefined || value === null) return ''
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
    typeof value === 'object' &&
    value !== null &&
    'sid' in value &&
    typeof (value as { sid: unknown }).sid === 'string'
  )
}

/**
 * 解析 JSONL 文本为 GithubRemoteEntry 数组
 *
 * JSONL（JSON Lines）格式：每行一个独立的 JSON 对象，无外层数组括号，无逗号分隔。
 * 空行与首尾空白会被忽略；非法行的行号会被收集到 errors 中但不中断整体解析。
 *
 * @param text JSONL 原始文本
 * @returns 解析结果：{ entries: 合法条目; errors: 非法行信息（1-based 行号+原因） }
 */
export function parseJsonl(text: string): {
  entries: GithubRemoteEntry[]
  errors: Array<{ line: number; reason: string }>
} {
  const entries: GithubRemoteEntry[] = []
  const errors: Array<{ line: number; reason: string }> = []

  if (!text || typeof text !== 'string') {
    return { entries, errors }
  }

  const lines = text.split(/\r\n|\r|\n/)
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const raw = lines[i]
    if (raw === undefined) continue
    const trimmed = raw.trim()
    if (!trimmed) continue // 空行跳过

    try {
      const obj: unknown = JSON.parse(trimmed)
      if (isGithubRemoteEntry(obj)) {
        entries.push(obj)
      } else {
        errors.push({ line: lineNum, reason: '对象缺少 sid 字段或 sid 不是字符串' })
      }
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e)
      errors.push({ line: lineNum, reason })
    }
  }

  return { entries, errors }
}

/**
 * 计算远程条目与本地条目的差异（按指定策略）
 *
 * 比对规则（基础）：
 * - 远程有、本地无 → add（changedFields = ['*']）
 * - 远程与本地 SID 相同 → 逐字段比对，任一字段不同则 update
 * - 远程字段为 undefined/空 → 不视为差异（保留本地值）
 * - 远程 type 为条目类别，不参与「是否看完」比对
 * - 远程 score/episode 转为字符串后比对
 * - 远程 tags 数组用 | 拼接后比对
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
): GithubSyncDiff[] {
  const diffs: GithubSyncDiff[] = []
  const remoteSids = new Set<string>()

  for (const remote of remoteEntries) {
    if (!remote.sid) continue
    remoteSids.add(remote.sid)
    const local = localEntries.get(remote.sid)

    // 新增：本地无对应 SID
    if (!local) {
      // update-only 策略：跳过新增
      if (strategy === 'update-only') continue
      diffs.push({
        kind: 'add',
        sid: remote.sid,
        remote,
        changedFields: ['*'],
      })
      continue
    }

    // add-only 策略：已存在的 SID 全部跳过
    if (strategy === 'add-only') continue

    // force-overwrite 策略：无视字段比对，全部标记为 update
    if (strategy === 'force-overwrite') {
      diffs.push({
        kind: 'update',
        sid: remote.sid,
        remote,
        localRow: local.row,
        changedFields: ['*'],
      })
      continue
    }

    // 比对字段差异（add-update / mirror 策略走此分支）
    const changedFields: string[] = []

    // 比对名称
    if (remote.name && remote.name !== local.fields['名称']) {
      changedFields.push('名称')
    }

    // 比对打分（score=0 视为"未打分"，不触发更新，避免覆盖本地实际打分）
    if (remote.score !== undefined && remote.score !== 0) {
      const remoteScore = String(remote.score)
      if (remoteScore !== local.fields['打分']) {
        changedFields.push('打分')
      }
    }

    // 比对标签（优先使用 meta_tags，回退到 tags）
    const remoteTags = tagsToString(remote.meta_tags ?? remote.tags)
    if (remoteTags && remoteTags !== local.fields['标签/分级']) {
      changedFields.push('标签/分级')
    }

    // 比对集数（优先使用 infobox 的「话数」，回退到 episode；
    //   episode=0 视为"未看"，不触发更新，避免覆盖本地实际集数）
    const remoteEpisodeValue =
      remote['话数'] ??
      (remote.episode !== undefined && remote.episode !== 0 ? String(remote.episode) : '')
    if (remoteEpisodeValue && remoteEpisodeValue !== local.fields['集数']) {
      changedFields.push('集数')
    }

    // 比对扩展字段（EXTENDED_FIELD_MAP 中定义的 20 个字段）
    for (const [jsonlField, excelField] of EXTENDED_FIELD_MAP) {
      const remoteValue = remote[jsonlField as keyof GithubRemoteEntry]
      if (remoteValue === undefined || remoteValue === null) continue
      // 扩展字段类型为 string | number，统一转为字符串比对
      const remoteStr = toExtStringValue(remoteValue as string | number)
      if (remoteStr && remoteStr !== (local.fields[excelField] ?? '')) {
        changedFields.push(excelField)
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

  // mirror 策略：本地存在但远程不存在的 SID 标记为 delete
  if (strategy === 'mirror') {
    for (const [sid, local] of localEntries) {
      if (!remoteSids.has(sid)) {
        diffs.push({
          kind: 'delete',
          sid,
          localRow: local.row,
          changedFields: ['*'],
        })
      }
    }
  }

  return diffs
}
