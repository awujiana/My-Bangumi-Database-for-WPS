/**
 * @fileoverview GitHub 仓库增量同步模块
 * @module sync/githubSync
 * @description 从 GitHub 公开仓库下载 JSON 数据，按 SID 主键比对本地 Excel 行，
 *              增量更新（新增+更新，不删除本地多余行）。
 *
 * 数据格式（远程 JSONL 文件，每行一个 JSON 对象）：
 *   { "sid": "12345", "name": "...", "updatedAt": "2026-07-21",
 *     "date": "2024-01-01", "meta_tags": ["标签1","标签2"], "nsfw": false,
 *     "话数": "12", "播放结束": "...", "动画制作公司": "...", ... }
 *
 * url 字段从 sid 构造：https://bgm.tv/subject/{sid}
 * type 字段默认为 2（动漫），用于同步记录显示。
 * updatedAt 为 YYYY-MM-DD 格式（仅日期，不含时间，节省空间）。
 */

// 直接从子模块导入，避开 index.ts 的副作用链（index → handlers → document.readyState）
// 注意：bgmLog 定义在 tools/util.ts（不在 core/constants.ts），与 BGM/getDataSheet 等同源导入
import { LOG_LEVELS, BGM_SUBJECT_TYPES } from '../core/constants.js'
import { Result, BgmError } from '../core/result.js'
import {
  bgmLog,
  getDataSheet,
  findHeaderRow,
  getLastRow,
  getColumnMap,
  getCellValue,
  setCellValue,
  trim,
} from '../tools/util.js'
import type { WpsWorksheet } from '../tools/wps.js'

import { buildRawUrl, isGithubConfigComplete } from './githubConfig.js'
import {
  computeDiff,
  tagsToString,
  parseJsonl,
  EXTENDED_FIELD_MAP,
  type ConflictResolution,
  type GithubRemoteEntry,
  type GithubSyncDiff,
  type LocalRowEntry,
  type SyncStrategy,
} from './githubSyncDiff.js'
import { extractSubjectId } from './pureUtils.js'
import { addSyncRecords, addSyncRecordSummary } from './syncRecord.js'
import type { UpdateRecordParams } from './syncRecord.js'
import type { SyncSource } from './SyncSource.js'
import {
  beginUndoSession,
  endUndoSession,
  recordRowDeleteEntry,
  recordUndoEntry,
} from './undoStack.js'

// 类型导入：避免运行时循环依赖（githubSync → ribbonService → index → githubSync）

// 纯函数与类型从 githubSyncDiff.ts re-export，避免重复定义
// githubSyncDiff.ts 为零依赖纯模块，可在 Node 测试环境中直接运行
export {
  computeDiff,
  tagsToString,
  parseJsonl,
  isGithubRemoteEntry,
  SYNC_STRATEGY_LABELS,
  EXTENDED_FIELD_MAP,
  type GithubRemoteEntry,
  type GithubSyncDiff,
  type LocalRowEntry,
  type SyncStrategy,
} from './githubSyncDiff.js'

/** 同步结果统计 */
export interface GithubSyncResult {
  /** 远程总条目数 */
  remoteTotal: number
  /** 新增条目数 */
  added: number
  /** 更新条目数 */
  updated: number
  /** 删除条目数（mirror 策略） */
  deleted: number
  /** 无变更条目数 */
  unchanged: number
  /** 跳过条目数（无 SID 或无效） */
  skipped: number
  /** 失败条目数 */
  failed: number
}

/** HTTP 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 30000

/**
 * 从 GitHub Raw 下载 JSONL 文件
 *
 * JSONL（JSON Lines）格式：每行一个独立的 JSON 对象。
 * 解析时按行分割，逐行 JSON.parse，跳过空行，非法行不中断整体解析。
 *
 * @param signal 可选 AbortSignal，用于取消请求
 * @returns 解析后的条目数组
 * @throws 网络错误、配置错误、解析失败时抛出 Error
 */
export function fetchGithubJson(signal?: AbortSignal): Promise<GithubRemoteEntry[]> {
  return new Promise<GithubRemoteEntry[]>((resolve, reject) => {
    let url: string
    try {
      if (!isGithubConfigComplete()) {
        throw new Error('GitHub 仓库配置不完整')
      }
      url = buildRawUrl()
    } catch (e: unknown) {
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }

    // 如果 signal 已 aborted，立即 reject
    if (signal?.aborted) {
      reject(new Error('请求被取消'))
      return
    }

    bgmLog(LOG_LEVELS.INFO, `[githubSync] 开始下载: ${url}`)
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url, true)
    xhr.timeout = REQUEST_TIMEOUT_MS
    xhr.setRequestHeader('Accept', 'application/json')

    // AbortSignal 支持：监听 abort 事件触发 xhr.abort()，并在请求完成后移除监听器
    let abortHandler: (() => void) | null = null
    const removeAbortHandler = (): void => {
      if (abortHandler && signal) {
        signal.removeEventListener('abort', abortHandler)
        abortHandler = null
      }
    }
    if (signal) {
      abortHandler = () => {
        xhr.abort()
      }
      signal.addEventListener('abort', abortHandler)
    }

    xhr.onload = (): void => {
      removeAbortHandler()
      if (xhr.status === 200) {
        try {
          const { entries, errors } = parseJsonl(xhr.responseText)
          if (entries.length === 0 && errors.length > 0) {
            reject(
              new Error(
                `JSONL 解析失败：${errors.length} 行全部非法。` +
                  `首行错误（第 ${errors[0]?.line} 行）：${errors[0]?.reason}`,
              ),
            )
            return
          }
          if (errors.length > 0) {
            bgmLog(
              LOG_LEVELS.WARN,
              `[githubSync] JSONL 解析完成：${entries.length} 条合法，${errors.length} 行非法（已跳过）。` +
                `首行错误（第 ${errors[0]?.line} 行）：${errors[0]?.reason}`,
            )
          } else {
            bgmLog(LOG_LEVELS.INFO, `[githubSync] 下载成功：${entries.length} 条记录`)
          }
          resolve(entries)
        } catch (e: unknown) {
          reject(new Error(`JSONL 解析失败: ${e instanceof Error ? e.message : String(e)}`))
        }
      } else if (xhr.status === 404) {
        reject(new Error(`文件不存在（404）：${url}，请检查 owner/repo/branch/path 配置`))
      } else if (xhr.status === 403) {
        reject(
          new Error(`访问被拒（403）：可能是私有仓库或触发 GitHub 限流（未认证 60次/小时/IP）`),
        )
      } else {
        reject(new Error(`HTTP 错误 ${xhr.status}: ${xhr.statusText}`))
      }
    }

    xhr.onerror = (): void => {
      removeAbortHandler()
      // 如果是 abort 导致的 onerror，归类为取消
      if (signal?.aborted) {
        reject(new Error('请求被取消'))
        return
      }
      reject(new Error(`网络请求失败：${url}（可能是 CORS 或网络不通）`))
    }

    xhr.ontimeout = (): void => {
      removeAbortHandler()
      reject(new Error(`请求超时（${REQUEST_TIMEOUT_MS}ms）：${url}`))
    }

    xhr.send()
  })
}

// ========== SyncSource 接口实现 ==========

/**
 * GitHub 同步源实现
 *
 * 包装 fetchGithubJson 为 SyncSource 接口实现，供 syncSourceRegistry 注册与调度。
 * 通过 syncFromGithub 主流程统一调用：
 * 1. validateConfig() 在下载前校验配置完整性
 * 2. fetchRemoteEntries() 复用既有 fetchGithubJson 实现，保持向后兼容
 */
export class GithubSyncSource implements SyncSource {
  /** 数据源类型标识 */
  getSourceType(): string {
    return 'github'
  }

  /** 数据源显示名称（用于日志与进度提示） */
  getDisplayName(): string {
    return 'GitHub'
  }

  /**
   * 获取远程条目（委托给 fetchGithubJson）
   * @param signal 可选的 AbortSignal
   */
  async fetchRemoteEntries(signal?: AbortSignal): Promise<GithubRemoteEntry[]> {
    return fetchGithubJson(signal)
  }

  /**
   * 校验配置是否完整可用
   * @returns 完整返回 Result.ok(undefined)，不完整返回 Result.fail(BgmError)
   */
  validateConfig(): Result<void> {
    if (!isGithubConfigComplete()) {
      return Result.failVoid(
        new BgmError('GitHub 仓库配置不完整，请填写 owner/repo/branch/path', 'CONFIG_INCOMPLETE'),
      )
    }
    return Result.okVoid()
  }
}

// ========== 本地数据读取 ==========

/**
 * 读取本地 Excel 工作表的所有条目（按 SID 索引）
 * @param ws 工作表
 * @param colMap 列映射
 * @param headerRow 表头行
 * @param lastRow 最后数据行
 * @returns SID → 本地行条目 的映射
 */
function readLocalEntries(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  headerRow: number,
  lastRow: number,
): Map<string, LocalRowEntry> {
  const result = new Map<string, LocalRowEntry>()
  const startRow = headerRow + 1

  /** 读取单元格值并 trim */
  const getField = (row: number, key: string): string => {
    const col = colMap.get(key)
    if (!col) return ''
    return trim(getCellValue(ws, row, col))
  }

  for (let row = startRow; row <= lastRow; row++) {
    const url = getField(row, 'Bangumi_URL')
    if (!url) continue
    const sid = extractSubjectId(url)
    if (!sid) continue

    // 读取扩展字段（EXTENDED_FIELD_MAP 中定义的 20 个 Excel 字段）
    const extFields: Record<string, string> = {}
    for (const [, excelField] of EXTENDED_FIELD_MAP) {
      extFields[excelField] = getField(row, excelField)
    }

    result.set(sid, {
      row,
      sid,
      fields: {
        Bangumi_URL: url,
        名称: getField(row, '名称'),
        是否看完: getField(row, '是否看完') || getField(row, '状态') || getField(row, '观看状态'),
        '标签/分级': getField(row, '标签/分级'),
        集数: getField(row, '集数'),
        集号: getField(row, '集号'),
        ...extFields,
      },
    })
  }

  bgmLog(LOG_LEVELS.INFO, `[githubSync] 本地读取完成：${result.size} 条有效记录`)
  return result
}

/**
 * 内部读取本地条目（供外部调用，封装为纯函数入口）
 */
export function readLocalEntriesForSync(): {
  entries: Map<string, LocalRowEntry>
  lastRow: number
} | null {
  const ws = getDataSheet()
  if (!ws) return null
  const headerRow = findHeaderRow(ws) || 1
  const lastRow = getLastRow(ws)
  const colMap = getColumnMap(ws, headerRow)
  if (!colMap.has('Bangumi_URL')) {
    bgmLog(LOG_LEVELS.ERROR, '[githubSync] 未找到 Bangumi_URL 列')
    return null
  }
  const entries = readLocalEntries(ws, colMap, headerRow, lastRow)
  return { entries, lastRow }
}

// ========== 应用差异到工作表 ==========

/**
 * 将单条远程条目数据写入指定行的指定字段
 * @param ws 工作表
 * @param colMap 列映射
 * @param row 行号
 * @param remote 远程条目
 * @param fieldsToWrite 要写入的字段列表（含 '*' 表示写入所有字段）
 * @param forceOverwrite 是否强制覆盖（true 时远程空值也清空本地；false 时远程空值跳过）
 */
function writeRemoteEntryToRow(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  row: number,
  remote: GithubRemoteEntry,
  fieldsToWrite: string[],
  forceOverwrite: boolean,
): void {
  /** 安全写入：列存在时写入值（forceOverwrite=true 时空值也写入清空本地） */
  const safeSet = (key: string, value: string): void => {
    const col = colMap.get(key)
    if (!col) return
    if (!forceOverwrite && !value) return
    // 记录 undo 条目（旧值 → 新值），便于撤销时恢复
    const oldValue = getCellValue(ws, row, col)
    // 值无变化时跳过写入，避免空字符串重复写入并污染 undo 栈
    if (oldValue === value) return
    recordUndoEntry({ row, col, oldValue, newValue: value })
    setCellValue(ws, row, col, value)
  }

  const writeAll = fieldsToWrite.includes('*')

  // URL（从 sid 构造）
  if (writeAll || fieldsToWrite.includes('Bangumi_URL')) {
    safeSet('Bangumi_URL', `https://bgm.tv/subject/${remote.sid}`)
  }
  // 名称
  if (writeAll || fieldsToWrite.includes('名称')) {
    safeSet('名称', remote.name ?? '')
  }
  // 标签（使用 meta_tags）
  if (writeAll || fieldsToWrite.includes('标签/分级')) {
    safeSet('标签/分级', tagsToString(remote.meta_tags))
  }
  // 集数（使用 infobox 的「话数」）
  if (writeAll || fieldsToWrite.includes('集数')) {
    safeSet('集数', remote['话数'] ?? '')
  }
  // 扩展字段（EXTENDED_FIELD_MAP 中定义的 19 个字段）
  for (const [jsonlField, excelField] of EXTENDED_FIELD_MAP) {
    if (writeAll || fieldsToWrite.includes(excelField)) {
      const value = remote[jsonlField as keyof GithubRemoteEntry]
      if (typeof value === 'string') {
        safeSet(excelField, value)
      } else if (typeof value === 'number') {
        safeSet(excelField, String(value))
      }
      // 忽略 undefined / null / boolean / string[]（EXTENDED_FIELD_MAP 不含这些类型）
    }
  }
}

/**
 * 应用 diff 到 Excel 工作表
 * @param diffs 差异列表
 * @param strategy 同步策略（决定 force-overwrite 与 delete 行为）
 * @param onProgress 进度回调（current, total, message）
 * @param source 同步来源显示名称（如 GitHub/GitLab/Gitee），用于写入同步记录
 * @returns 同步结果统计
 */
export function applyDiffToSheet(
  diffs: GithubSyncDiff[],
  strategy: SyncStrategy,
  onProgress?: (current: number, total: number, message: string) => void,
  source?: string,
): GithubSyncResult {
  const result: GithubSyncResult = {
    remoteTotal: 0,
    added: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
  }

  const ws = getDataSheet()
  if (!ws) {
    bgmLog(LOG_LEVELS.ERROR, '[githubSync] applyDiffToSheet: 未找到数据工作表')
    result.failed = diffs.length
    return result
  }

  const headerRow = findHeaderRow(ws) || 1
  const lastRow = getLastRow(ws)
  const colMap = getColumnMap(ws, headerRow)
  let nextAppendRow = lastRow + 1
  const forceOverwrite = strategy === 'force-overwrite'

  // 开启 undo 会话：记录本次同步的所有单元格变更，便于用户撤销
  beginUndoSession(`${source ?? 'GitHub'} 同步 - 策略: ${strategy}`)

  // delete 操作需倒序执行（从大行号到小行号），避免行号错位
  const sortedDiffs = [...diffs].sort((a, b) => {
    const aRow = a.localRow ?? Number.MAX_SAFE_INTEGER
    const bRow = b.localRow ?? Number.MAX_SAFE_INTEGER
    return bRow - aRow
  })

  // 收集本次同步记录（最后批量写入，减少 COM 调用）
  const syncRecords: UpdateRecordParams[] = []

  const total = diffs.length
  sortedDiffs.forEach((diff, idx) => {
    try {
      if (diff.kind === 'add' && diff.remote) {
        // 新增：追加到末尾
        writeRemoteEntryToRow(ws, colMap, nextAppendRow, diff.remote, ['*'], forceOverwrite)
        nextAppendRow++
        result.added++
        syncRecords.push({
          sid: diff.sid,
          name: diff.remote.name ?? '',
          url: `https://bgm.tv/subject/${diff.sid}`,
          type: BGM_SUBJECT_TYPES[2] ?? '',
          source,
          content: '仓库同步-新增',
          status: '成功',
          count: 1,
        })
        onProgress?.(idx + 1, total, `新增 ${diff.remote.name ?? diff.sid}`)
      } else if (diff.kind === 'update' && diff.localRow !== undefined && diff.remote) {
        // 更新：仅写入变更字段
        writeRemoteEntryToRow(
          ws,
          colMap,
          diff.localRow,
          diff.remote,
          diff.changedFields,
          forceOverwrite,
        )
        result.updated++
        syncRecords.push({
          sid: diff.sid,
          name: diff.remote.name ?? '',
          url: `https://bgm.tv/subject/${diff.sid}`,
          type: BGM_SUBJECT_TYPES[2] ?? '',
          source,
          content: '仓库同步-更新',
          status: '成功',
          message: diff.changedFields.join(', '),
          count: 1,
        })
        onProgress?.(idx + 1, total, `更新 ${diff.remote.name ?? diff.sid}`)
      } else if (diff.kind === 'delete' && diff.localRow !== undefined) {
        // 删除：删除整行（mirror 策略）
        // 先记录整行快照，便于 undo 时恢复整行
        const rowValues: Record<number, string> = {}
        for (const col of colMap.values()) {
          rowValues[col] = getCellValue(ws, diff.localRow, col)
        }
        recordRowDeleteEntry({ row: diff.localRow, values: rowValues })
        try {
          const rowRange = ws.Rows.Item(diff.localRow)
          // WPS Row 没有 Delete 方法，通过 Range 删除整行
          ws.Range(`${diff.localRow}:${diff.localRow}`).Delete()
          void rowRange // 仅用于类型存在性引用
          result.deleted++
          syncRecords.push({
            sid: diff.sid,
            source,
            content: '仓库同步-删除',
            status: '成功',
            message: `删除行 ${diff.localRow}`,
            count: 1,
          })
          onProgress?.(idx + 1, total, `删除 行${diff.localRow} sid=${diff.sid}`)
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e)
          bgmLog(LOG_LEVELS.WARN, `[githubSync] 删除行 ${diff.localRow} 失败: ${errMsg}`)
          result.failed++
          syncRecords.push({
            sid: diff.sid,
            source,
            content: '仓库同步-删除失败',
            status: '失败',
            message: errMsg,
            count: 1,
          })
        }
      } else {
        result.skipped++
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e)
      result.failed++
      bgmLog(LOG_LEVELS.ERROR, `[githubSync] 应用差异失败 sid=${diff.sid}: ${errMsg}`)
      syncRecords.push({
        sid: diff.sid,
        source,
        content: '仓库同步-失败',
        status: '失败',
        message: errMsg,
        count: 1,
      })
    }
  })

  // 结束 undo 会话（空会话不入栈）
  endUndoSession()

  // 批量写入同步记录与汇总行
  if (syncRecords.length > 0) {
    addSyncRecords(syncRecords)
    addSyncRecordSummary({
      source,
      content: '仓库同步汇总',
      status: result.failed > 0 ? '失败' : '成功',
      message: `远程 ${result.remoteTotal}，新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}，失败 ${result.failed}，策略: ${strategy}`,
      count: 1,
    })
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[githubSync] 应用完成: 新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}，失败 ${result.failed}`,
  )
  return result
}

/**
 * 根据用户冲突解决决策调整 diff 列表
 *
 * 处理规则：
 * - 仅作用于 kind === 'update' 且 changedFields 不为 ['*'] 的 diff（字段级更新）
 * - 对每个 resolution，找到 sid 与 field 匹配的 update diff：
 *   - chosenValue === 'local'：从 changedFields 中移除该 field（保留本地值）
 *   - chosenValue === 'remote'：保留该 field 在 changedFields 中（采用远程值）
 * - 若 update diff 的 changedFields 被清空，则从 diffs 中移除该 diff（无字段需更新）
 * - add/delete 与 force-overwrite（changedFields 为 ['*']）不受影响
 *
 * 本函数直接修改传入的 diffs 数组（in-place），同时返回该数组便于链式调用。
 *
 * @param diffs 差异列表（会被原地修改）
 * @param resolutions 用户冲突解决决策列表
 * @returns 调整后的差异列表（与输入为同一引用）
 */
export function applyConflictResolutions(
  diffs: GithubSyncDiff[],
  resolutions: ConflictResolution[],
): GithubSyncDiff[] {
  if (!resolutions || resolutions.length === 0) {
    return diffs
  }

  // 按 sid 索引 resolutions，便于 O(1) 查找
  const resolutionByKey = new Map<string, ConflictResolution>()
  for (const r of resolutions) {
    resolutionByKey.set(`${r.sid}\u0000${r.field}`, r)
  }

  // 倒序遍历，便于安全移除元素
  for (let i = diffs.length - 1; i >= 0; i--) {
    const diff = diffs[i]
    if (!diff) continue
    // 仅处理字段级 update（changedFields 不为 ['*']）
    if (diff.kind !== 'update') continue
    if (diff.changedFields.length === 1 && diff.changedFields[0] === '*') continue

    // 过滤掉用户选择「本地」的字段
    diff.changedFields = diff.changedFields.filter((field) => {
      const key = `${diff.sid}\u0000${field}`
      const r = resolutionByKey.get(key)
      // 若存在 resolution 且选择 local，则移除该字段；否则保留
      return !(r && r.chosenValue === 'local')
    })

    // 若所有字段都被移除，则该 diff 无需执行
    if (diff.changedFields.length === 0) {
      diffs.splice(i, 1)
    }
  }

  return diffs
}

/**
 * GitHub 同步入口（GitHub 源专用）
 *
 * 直接使用本模块的 GithubSyncSource 完成同步，不再依赖 syncSourceRegistry，
 * 从而打破 githubSync.ts ↔ syncSourceRegistry.ts 的循环依赖。
 *
 * 如需按 sourceType 动态选择数据源，请使用 syncSourceRegistry.ts 中的 syncFromRemote。
 *
 * @param onProgress 进度回调
 * @param strategy 同步策略，默认 'add-update'
 * @param signal 可选 AbortSignal，用于取消请求
 * @param conflictResolution 可选冲突解决决策列表；提供时将按用户选择过滤 update diff 的字段
 * @returns 同步结果统计
 * @throws 配置错误、网络错误、解析错误时抛出
 */
export async function syncFromGithub(
  onProgress?: (current: number, total: number, message: string) => void,
  strategy: SyncStrategy = 'add-update',
  signal?: AbortSignal,
  conflictResolution?: ConflictResolution[],
): Promise<GithubSyncResult> {
  const source: SyncSource = new GithubSyncSource()

  const validationResult = source.validateConfig()
  if (validationResult.isFail()) {
    const errMsg = validationResult.error?.message ?? 'GitHub 同步源配置校验失败'
    throw new Error(errMsg)
  }

  onProgress?.(0, 0, `开始下载远程数据（${source.getDisplayName()} - 策略：${strategy}）...`)
  const remoteEntries = await source.fetchRemoteEntries(signal)
  onProgress?.(1, 3, `下载完成：${remoteEntries.length} 条`)

  const local = readLocalEntriesForSync()
  if (!local) {
    throw new Error('无法读取本地工作表数据')
  }

  onProgress?.(2, 3, '比对差异中...')
  const diffs = computeDiff(remoteEntries, local.entries, strategy)

  // 应用用户冲突解决决策：过滤掉用户选择「本地」的字段
  if (conflictResolution && conflictResolution.length > 0) {
    applyConflictResolutions(diffs, conflictResolution)
    bgmLog(LOG_LEVELS.INFO, `[githubSync] 已应用 ${conflictResolution.length} 条冲突解决决策`)
  }

  const addCount = diffs.filter((d) => d.kind === 'add').length
  const updateCount = diffs.filter((d) => d.kind === 'update').length
  const deleteCount = diffs.filter((d) => d.kind === 'delete').length
  bgmLog(
    LOG_LEVELS.INFO,
    `[githubSync] diff 完成（${strategy}）：新增 ${addCount}，更新 ${updateCount}，删除 ${deleteCount}`,
  )

  const result = applyDiffToSheet(diffs, strategy, onProgress, source.getDisplayName())
  result.remoteTotal = remoteEntries.length
  // unchanged = 远程总数 - (新增+更新)（delete 不计入 unchanged）
  result.unchanged = Math.max(0, remoteEntries.length - addCount - updateCount)

  onProgress?.(3, 3, `完成：新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}`)
  return result
}
