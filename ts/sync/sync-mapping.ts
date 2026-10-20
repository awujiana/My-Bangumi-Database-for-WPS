/**
 * @fileoverview 同步前列映射确认：本地列 ↔ 远程字段的对应关系
 * @module sync/syncMapping
 * @description 2026-10-17 新增。同步开始前，用户先在确认框里看到「远程字段 → 本地列」
 *              的对应关系，并可：① 取消勾选（该字段本次不同步）；② 拖拽排序（仅影响
 *              清单展示顺序，写入按列名寻址、与顺序无关）；③ 改目标列（换到本地另一列）；
 *              ④ 一键补齐缺失列（把缺的列名写进表头行末尾）。
 *
 *              本模块只放**纯逻辑**（无 DOM / 无 COM）：行构建、状态判定、选择解析、
 *              列名改写应用。DOM 与写表头在 `ui/sync-mapping-dialog.ts`。
 *
 *              字段行由 `github-sync-diff.ts` 的 EXTENDED_FIELD_MAP 与
 *              CORE_FIELD_COLUMNS **派生**，不复制第二份字段表（规避平行清单）。
 *              另有若干远程字段（简介原文 / infobox / 用户标签等）**无 Excel 列映射**，
 *              见 {@link UNMAPPED_REMOTE_FIELDS}，它们随分片下载但不写入任何列，
 *              因此不进交互清单，只在确认框里以脚注告知。
 */

import { CORE_FIELD_COLUMNS, EXTENDED_FIELD_MAP, getExcelAliases } from './github-sync-diff.js'
import type { LocalRowEntry } from './github-sync-diff.js'

/** 清单分组（仅影响展示顺序与分组标题） */
export type SyncMappingGroup = 'basic' | 'meta' | 'stats' | 'relations' | 'alias'

/** 分组中文标签（确认框分组标题用） */
export const SYNC_MAPPING_GROUP_LABELS: Readonly<Record<SyncMappingGroup, string>> = {
  basic: '标识与基础',
  meta: '资料字段（话数 / 导演等）',
  stats: '评分与排名',
  relations: '关联条目',
  alias: '别名',
}

/**
 * 无 Excel 列映射的远程字段（随分片下载但不落盘）
 *
 * 列在确认框脚注里，避免用户误以为勾了分片这些字段就会进表。
 * `field` 为远程字段键，`note` 为给用户的一句话说明。
 */
export const UNMAPPED_REMOTE_FIELDS: readonly (readonly [string, string])[] = [
  ['summary', '简介原文'],
  ['infobox', 'infobox 原文'],
  ['tags', '用户标签（名称:计数）'],
  ['score_details', '评分分布'],
  ['favorite', '收藏统计'],
  ['platform', '平台'],
  ['series', '是否系列作'],
  ['nsfw', 'NSFW 标记'],
  ['name_original', '原始名称（与「名称」语义重叠，刻意不映射）'],
  ['updatedAt', '远端更新时间（仅作数据新鲜度判据）'],
] as const

/** 单行映射（一行 = 一个可同步的远程字段） */
export interface SyncMappingRow {
  /** 行 id = 默认 Excel 列名（派生字段用字段名，如 Bangumi_URL） */
  id: string
  /** 远程字段键（jsonl 字段名；Bangumi_URL 为由 sid 构造的派生字段） */
  remoteField: string
  /** 展示分组 */
  group: SyncMappingGroup
  /** 默认目标列（本地列名） */
  defaultColumn: string
  /** 同写的别名列（如「动画制作公司」会同时写「制作公司」与「动画制作公司」） */
  aliasColumns: readonly string[]
  /** 本地是否已有默认列（false = 需补列或改映射，否则本次跳过） */
  hasLocalColumn: boolean
  /** 是否勾选同步（默认：有列 true / 缺列 false） */
  selected: boolean
  /** 用户指定的目标列（默认 = defaultColumn；改映射时换成本地已有列） */
  targetColumn: string
}

/** 用户在确认框里的最终选择（回传给同步主流程） */
export interface SyncMappingConfig {
  /** 取消同步的列（行 id） */
  excludedColumns: readonly string[]
  /** 列名改写：默认列名 → 用户选定的目标列名 */
  columnOverrides: Readonly<Record<string, string>>
}

/** 分组 → 该组的固定展示顺序（拖拽排序只在组内调整） */
const GROUP_ORDER: readonly SyncMappingGroup[] = ['basic', 'meta', 'stats', 'relations', 'alias']

/** 派生字段行（不走 EXTENDED_FIELD_MAP / CORE_FIELD_COLUMNS 的独立逻辑字段） */
const DERIVED_ROWS: readonly (readonly [string, string, SyncMappingGroup])[] = [
  ['Bangumi_URL', 'sid（构造 https://bgm.tv/subject/{sid}）', 'basic'],
  ['标签/分级', 'meta_tags', 'basic'],
  ['集数', '话数', 'meta'],
] as const

/** 资料字段里需要归入 meta 组的 EXTENDED 条目（其余按组顺序自然落入） */
const EXTENDED_GROUP_BY_COLUMN: Readonly<Record<string, SyncMappingGroup>> = {
  开播日期: 'basic',
  评分: 'stats',
  排名: 'stats',
  关联条目ID: 'relations',
  关联的动漫ID: 'relations',
  别名: 'alias',
}

/**
 * 构建列映射行（同步前确认框的数据源）
 *
 * @param localColumns 本地表头列名集合（columnMap 的键）
 * @returns 按分组固定顺序排列的映射行；UI 状态取默认值（有列选中 / 缺列不选）
 */
export function buildSyncMappingRows(localColumns: readonly string[]): SyncMappingRow[] {
  const local = new Set(localColumns)
  const hasColumn = (name: string): boolean => local.has(name)

  const rows: SyncMappingRow[] = []

  // 1) CORE_FIELD_COLUMNS（name / meta_tags / 话数）与派生字段（Bangumi_URL）。
  //    去重：CORE 已含 meta_tags / 话数，DERIVED_ROWS 只补 Bangumi_URL。
  for (const [remoteField, column] of CORE_FIELD_COLUMNS) {
    rows.push(makeRow(column, remoteField, column, [], hasColumn(column), 'basic'))
  }
  for (const [column, remoteField, group] of DERIVED_ROWS) {
    const isDuplicate = rows.some((row) => row.id === column)
    if (!isDuplicate) {
      rows.push(makeRow(column, remoteField, column, [], hasColumn(column), group))
    }
  }

  // 2) EXTENDED_FIELD_MAP：一行一个远程字段，主映射为默认目标列
  for (const [remoteField, column] of EXTENDED_FIELD_MAP) {
    const isDuplicate = rows.some((row) => row.id === column)
    if (!isDuplicate) {
      const aliases = getExcelAliases(remoteField).filter((name) => name !== column)
      const group = EXTENDED_GROUP_BY_COLUMN[column] ?? 'meta'
      rows.push(makeRow(column, remoteField, column, aliases, hasColumn(column), group))
    }
  }

  return rows.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
}

/**
 * 解析用户在确认框里的最终选择
 *
 * 规则：
 * - 未勾选的行 → excludedColumns
 * - targetColumn ≠ defaultColumn（且非空）→ columnOverrides（含「改映射到已有列」）
 * - 勾选但本地缺列的行**不产生配置**——补列由对话框在确认前落盘，届时列已存在
 *
 * @param rows 确认框维护的行状态
 */
export function resolveSyncMappingConfig(rows: readonly SyncMappingRow[]): SyncMappingConfig {
  const excludedColumns: string[] = []
  const columnOverrides: Record<string, string> = {}

  for (const row of rows) {
    if (row.selected) {
      const target = row.targetColumn.trim()
      if (target !== '' && target !== row.defaultColumn) {
        columnOverrides[row.id] = target
      }
    } else {
      excludedColumns.push(row.id)
    }
  }

  return { excludedColumns, columnOverrides }
}

/**
 * 校验目标列冲突：同一目标列不能同时接收两个字段
 *
 * 冲突来源：① 两个字段的 override 指向同一列；② override 指向另一个字段的默认列；
 * ③ 字段的默认列恰是另一字段的 override 目标。返回有冲突的行 id 列表（空数组 = 无冲突）。
 */
export function findOverrideConflicts(rows: readonly SyncMappingRow[]): string[] {
  const usedBy = new Map<string, string>()

  const canClaim = (column: string, rowId: string): boolean => {
    const existing = usedBy.get(column)
    if (existing !== undefined && existing !== rowId) return false
    usedBy.set(column, rowId)
    return true
  }

  const conflicts = new Set<string>()
  const selectedRows = rows.filter((row) => row.selected)
  // 先占位所有默认列（含别名列，避免 override 抢占别名列）。
  // 选中行预先过滤（不在循环头 filter：避免中间数组与变量遮蔽两条 lint）。
  for (const row of selectedRows) {
    const isDefaultClaimed = canClaim(row.defaultColumn, row.id)
    if (!isDefaultClaimed) conflicts.add(row.id)
    for (const alias of row.aliasColumns) {
      const isAliasClaimed = canClaim(alias, row.id)
      if (!isAliasClaimed) conflicts.add(row.id)
    }
  }
  // 再占位 override 目标
  for (const row of selectedRows) {
    const target = row.targetColumn.trim()
    const isOverride = target !== '' && target !== row.defaultColumn
    if (isOverride && !canClaim(target, row.id)) conflicts.add(row.id)
  }

  return [...conflicts]
}

/**
 * 把列名改写应用到本地条目：为每个 override 生成「默认列名」键
 *
 * 原理：computeDiff / writeRemoteEntryToRow / collectMissingColumns 全链路按
 * **默认列名**寻址。把 override 列的值复制一份到默认列名键下，这三个消费方
 * 就无需任何改动（core 侧另把 columnMap 的默认列名指向 override 列的列号）。
 *
 * @param entries 本地条目映射（SID → 行），**原地修改**
 * @param overrides 默认列名 → 目标列名
 */
export function applyColumnOverrides(
  entries: Map<string, LocalRowEntry>,
  overrides: Readonly<Record<string, string>>,
): void {
  const pairs = Object.entries(overrides).filter(([from, to]) => from !== to && to !== '')
  if (pairs.length === 0) return

  for (const entry of entries.values()) {
    for (const [from, to] of pairs) {
      entry.fields[from] = entry.fields[to] ?? ''
    }
  }
}

/**
 * 排除列的别名闭包：排除主列时，其别名列一并排除
 *
 * 「动画制作公司」字段双列写入（制作公司 + 动画制作公司）：只排除主列会让
 * 别名列照常写入，排除不彻底。这里按 EXTENDED_FIELD_MAP 反查展开。
 */
export function excludedColumnClosure(excludedColumns: readonly string[]): Set<string> {
  const columnToAliases = new Map<string, string[]>()
  for (const [remoteField, column] of EXTENDED_FIELD_MAP) {
    columnToAliases.set(column, [...getExcelAliases(remoteField)])
  }

  const closure = new Set(excludedColumns)
  for (const column of excludedColumns) {
    const aliases = columnToAliases.get(column)
    if (aliases !== undefined) {
      for (const alias of aliases) {
        closure.add(alias)
      }
    }
  }
  return closure
}

/**
 * 剔除列：返回不含排除列的新 Map（原 Map 不动）
 *
 * 排除的落地方式就是「从 columnMap 摘列」——下游所有写入点（批量写 / 逐字段写 /
 * 回退）都经 columnMap 寻址，列不在映射里即自然跳过，无需逐函数加参。
 */
export function withoutColumns(
  columnMap: Map<string, number>,
  excluded: ReadonlySet<string>,
): Map<string, number> {
  const kept = new Map<string, number>()
  for (const [name, index] of columnMap) {
    if (!excluded.has(name)) kept.set(name, index)
  }
  return kept
}

/**
 * 列名改写：把 columnMap 里默认列的列号替换为目标列的列号
 *
 * 与 {@link applyColumnOverrides} 成对使用：一个改本地数据侧（字段键），
 * 一个改写入侧（列号），computeDiff / 写入口都按默认列名寻址即可命中用户选的列。
 */
export function remapColumnIndices(
  columnMap: Map<string, number>,
  remap: ReadonlyMap<string, number>,
): Map<string, number> {
  const remapped = new Map(columnMap)
  for (const [from, to] of remap) {
    remapped.set(from, to)
  }
  return remapped
}

/**
 * 取消同步的列 → 需要从「下载字段集」里剔除的远程字段键
 *
 * neededFields 驱动选片：剔除后整片无所需字段时该分片不再下载
 * （用户手动勾选的分片除外——那种情况下仍会下载，只是不写入）。
 * Bangumi_URL 由 sid 派生（sid 恒随 base 片下载），不产生剔除项。
 */
export function excludedJsonlFields(excludedColumns: readonly string[]): Set<string> {
  const inverse = new Map<string, string>()
  for (const [remoteField, column] of CORE_FIELD_COLUMNS) {
    inverse.set(column, remoteField)
  }
  for (const [remoteField, column] of EXTENDED_FIELD_MAP) {
    if (!inverse.has(column)) inverse.set(column, remoteField)
  }

  const excluded = new Set<string>()
  for (const column of excludedColumns) {
    const remoteField = inverse.get(column)
    if (remoteField !== undefined) excluded.add(remoteField)
  }
  return excluded
}

/** 构造单行（默认 UI 状态：有列选中、缺列不选、目标列 = 默认列） */
function makeRow(
  id: string,
  remoteField: string,
  defaultColumn: string,
  aliasColumns: readonly string[],
  hasLocalColumn: boolean,
  group: SyncMappingGroup,
): SyncMappingRow {
  return {
    id,
    remoteField,
    group,
    defaultColumn,
    aliasColumns,
    hasLocalColumn,
    selected: hasLocalColumn,
    targetColumn: defaultColumn,
  }
}
