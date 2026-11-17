/**
 * @fileoverview 数据中心页面逻辑（统计 / 推荐 / 搜索 / 更新检查 / 导出）
 * @module panel/dataCenterPage
 * @description 顶层只绑定 DOM 与 i18n；所有碰 COM 的读取都在按钮回调里执行。
 *              数据计算交给 services 层纯函数，图表交给 ui/data-center-charts.ts。
 */

import { tOr } from '../i18n/locale-store.js'
import { LOG_LEVELS } from '../core/constants.js'
import { bgmLog, getApp } from '../tools/util/index.js'
import { readRangeValues, getLastRow } from '../tools/util/sheet.js'
import { httpRequest } from '../tools/http.js'
import { downloadTextFile, toCsv } from '../tools/file-export.js'
import { showToast } from '../ui/dialog.js'
import { escapeHtml } from '../tools/string-utilities.js'
import {
  buildPreferenceProfile,
  compareLastTwoMonths,
  countByStatus,
  countCompletedByMonth
  
} from '../services/data-center-stats.js'
import type {StatisticsRecord} from '../services/data-center-stats.js';
import { recommendByPreference } from '../services/data-center-recommend.js'
import {
  buildBangumiSearchUrl,
  filterResults,
  hasAnyCriterion,
  localRecordToResult,
  mergeResults,
  normalizeOnlineEntry
  
  
  
  
  
} from '../services/data-center-search.js'
import type {OnlineEntry, SearchKind, SearchQuery, SearchResult, SearchScope} from '../services/data-center-search.js';
import { renderComparison, renderMonthlyBars, renderStatusPie } from '../ui/data-center-charts.js'
import { loadRecordsWith } from './data-center-loader.js'
import { searchResultsToRows } from '../services/data-center-export.js'
import { writeRowsToResultSheet } from './data-center-sheet-writer.js'

/** 读取成功后缓存的记录，供统计 / 推荐 / 搜索 / 导出共用 */
let cachedRecords: StatisticsRecord[] = []
/** 最近一次搜索的结果，供「写入 Excel」使用 */
let cachedResults: SearchResult[] = []

function byId(id: string): HTMLElement | null {
  return document.getElementById(id)
}

function appendLog(message: string): void {
  const log = byId('dcLog')
  if (log === null) return
  log.textContent = `${log.textContent}${message}\n`
}

function setMessage(message: string): void {
  const node = byId('dcSearchMessage')
  if (node !== null) node.textContent = message
}

/** 读取当前活动工作表为统计记录；失败时返回空数组并写日志 */
function readRecords(): StatisticsRecord[] {
  const app = getApp() as {
    ActiveWorkbook?: { ActiveSheet?: Parameters<typeof readRangeValues>[0] }
  } | null
  const worksheet = app?.ActiveWorkbook?.ActiveSheet ?? null
  if (worksheet === null) {
    appendLog(tOr('dc.log.noSheet', '未找到活动工作表'))
    return []
  }
  const lastRow = getLastRow(worksheet)
  const records = loadRecordsWith(
    (startRow, endRow, startColumn, endColumn) =>
      readRangeValues(worksheet, startRow, endRow, startColumn, endColumn),
    lastRow,
  )
  cachedRecords = records
  appendLog(tOr('dc.log.loaded', '已读取 {count} 条记录', { count: String(records.length) }))
  return records
}

/** 渲染状态分布 + 月度完成 + 环比 */
function renderStatistics(records: StatisticsRecord[]): void {
  const pieHost = byId('dcStatusPie')
  if (pieHost !== null) {
    const labels = [
      tOr('dc.status.wish', '想看'),
      tOr('dc.status.collect', '看过'),
      tOr('dc.status.do', '在看'),
      tOr('dc.status.onHold', '搁置'),
      tOr('dc.status.dropped', '抛弃'),
    ]
    pieHost.innerHTML = renderStatusPie(countByStatus(records), labels)
  }

  const months = countCompletedByMonth(records)
  const barsHost = byId('dcMonthlyBars')
  if (barsHost !== null) {
    barsHost.innerHTML = renderMonthlyBars(months, tOr('dc.stats.noData', '暂无完成记录'))
  }

  const compareHost = byId('dcComparison')
  if (compareHost !== null) {
    compareHost.innerHTML = renderComparison(compareLastTwoMonths(months), {
      up: tOr('dc.compare.up', '较上月'),
      down: tOr('dc.compare.down', '较上月'),
      flat: tOr('dc.compare.flat', '与上月持平'),
    })
  }
}

/** 渲染喜好推荐 */
function renderRecommendations(records: StatisticsRecord[]): void {
  const listHost = byId('dcRecommendList')
  if (listHost === null) return
  const profile = buildPreferenceProfile(records)
  const countHost = byId('dcRecommendCount')
  if (countHost !== null) countHost.textContent = String(profile.topTags.length)

  const recommendations = recommendByPreference(records, records)
  if (recommendations.length === 0) {
    listHost.innerHTML = `<p class="dc-empty">${escapeHtml(
      tOr('dc.recommend.empty', '先标记一些「看过」并填写标签，才能生成推荐'),
    )}</p>`
    return
  }
  listHost.innerHTML = recommendations
    .map((item) => {
      const reason = tOr('dc.recommend.reason', '因为你喜欢：{tags}', {
        tags: item.matchedTags.map((tag) => escapeHtml(tag)).join(' / '),
      })
      return `<div class="dc-recommend-item"><span>${escapeHtml(item.name)}</span><span class="dc-recommend-reason">${reason}</span></div>`
    })
    .join('')
}

/** 导出当前统计为 CSV（含 BOM，Excel 打开中文不乱码） */
function exportStatistics(records: StatisticsRecord[]): void {
  if (records.length === 0) {
    showToast(tOr('dc.export.empty', '没有可导出的数据，请先刷新统计'), 'warn')
    return
  }
  const header = [
    tOr('dc.export.colName', '名称'),
    tOr('dc.export.colStatus', '观看状态'),
    tOr('dc.export.colDate', '完成日期'),
    tOr('dc.export.colTags', '标签'),
  ]
  const rows = records.map((record) => [
    record.name,
    String(record.watchStatus),
    record.date,
    record.tags,
  ])
  const csv = toCsv(header, rows)
  downloadTextFile(`data-center-${String(Date.now())}.csv`, csv, 'text/csv;charset=utf-8')
  showToast(tOr('dc.export.done', '已导出 CSV'), 'success')
}

/** 检查数据更新（复用本地记录数量与线上 manifest 对比的简化版） */
async function checkDataUpdate(): Promise<void> {
  const statusHost = byId('dcUpdateStatus')
  const diffHost = byId('dcUpdateDiff')
  if (statusHost === null || diffHost === null) return
  statusHost.textContent = tOr('dc.update.checking', '正在检查线上数据源…')

  const result = await httpRequest<{ recordCount?: number; updatedAt?: string }>(
    'https://raw.githubusercontent.com/awujiana/Bangumi-Archive-Anime-Excel/main/data/anime.manifest.json',
  )
  const payload = result.isOk() ? result.data?.data : null
  if (payload === null || payload === undefined) {
    statusHost.textContent = tOr('dc.update.failed', '检查失败，请稍后重试')
    appendLog(tOr('dc.update.failed', '检查失败，请稍后重试'))
    return
  }
  const remoteCount = payload.recordCount
  if (remoteCount === undefined) {
    statusHost.textContent = tOr('dc.update.noManifest', '线上清单缺少记录数')
    return
  }
  const localCount = cachedRecords.length
  const delta = remoteCount - localCount
  statusHost.textContent = tOr('dc.update.result', '线上 {remote} 条 / 本地 {local} 条', {
    remote: String(remoteCount),
    local: String(localCount),
  })
  if (delta > 0) {
    diffHost.textContent = tOr('dc.update.newer', '线上多出 {count} 条，建议同步', {
      count: String(delta),
    })
  } else if (delta < 0) {
    diffHost.textContent = tOr('dc.update.localAhead', '本地多出 {count} 条', {
      count: String(-delta),
    })
  } else {
    diffHost.textContent = tOr('dc.update.same', '与线上一致')
  }
  showToast(tOr('dc.update.done', '更新检查完成'), 'success')
}

/** 从表单读取搜索条件 */
function readSearchQuery(): SearchQuery {
  const keyword = (byId('dcSearchKeyword') as HTMLInputElement | null)?.value ?? ''
  const kindValue = (byId('dcSearchKind') as HTMLSelectElement | null)?.value ?? 'all'
  const scopeValue = (byId('dcSearchScope') as HTMLSelectElement | null)?.value ?? 'both'
  const yearValue = (byId('dcSearchYear') as HTMLInputElement | null)?.value ?? ''
  const ratingValue = (byId('dcSearchRating') as HTMLInputElement | null)?.value ?? ''
  const query: SearchQuery = {
    keyword,
    kind: kindValue as SearchKind,
    scope: scopeValue as SearchScope,
  }
  if (yearValue !== '') query.year = Number(yearValue)
  if (ratingValue !== '') query.minRating = Number(ratingValue)
  return query
}

/** 把一条 Bangumi 原始结果收窄为在线条目；非法项返回 null */
function toOnlineEntry(raw: unknown): OnlineEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>
  if (typeof item.id !== 'number' && typeof item.id !== 'string') return null
  if (typeof item.name !== 'string') return null
  const chineseName = typeof item.name_cn === 'string' && item.name_cn.trim() !== ''
    ? item.name_cn
    : item.name
  const entry: OnlineEntry = { id: item.id, name: chineseName }
  if (typeof item.type === 'number') entry.bangumiType = item.type
  if (typeof item.air_date === 'string') entry.airDate = item.air_date
  if (typeof item.rating === 'object' && item.rating !== null) {
    const {score} = (item.rating as Record<string, unknown>)
    if (typeof score === 'number') entry.rating = score
  }
  if (typeof item.rating === 'number') entry.rating = item.rating
  if (typeof item.summary === 'string') entry.summary = item.summary
  return entry
}

/** 在线搜索 Bangumi（仅当关键词存在；类型映射由 buildBangumiSearchUrl 处理） */
async function searchOnline(query: SearchQuery): Promise<SearchResult[]> {
  const keyword = query.keyword?.trim() ?? ''
  if (keyword === '') return []
  const url = buildBangumiSearchUrl(keyword, query.kind ?? 'all')
  const result = await httpRequest(url)
  if (result.isFail() || result.data === null) return []
  const payload = result.data as { list?: unknown }
  const rawList = Array.isArray(payload.list) ? payload.list : []
  const entries = rawList
    .map((raw) => toOnlineEntry(raw))
    .filter((entry): entry is OnlineEntry => entry !== null)
  return entries.map((entry) => normalizeOnlineEntry(entry))
}

/** 执行搜索并渲染结果 */
async function performSearch(): Promise<void> {
  const query = readSearchQuery()
  if (!hasAnyCriterion(query)) {
    setMessage(tOr('dc.search.needCriterion', '请至少填写一项搜索条件'))
    return
  }
  setMessage('')

  const scope = query.scope ?? 'both'
  const localResults = cachedRecords.map((record) => localRecordToResult(record))
  let onlineResults: SearchResult[] = []
  if (scope === 'online' || scope === 'both') {
    try {
      onlineResults = await searchOnline(query)
    } catch (error: unknown) {
      appendLog(`[search] ${String(error)}`)
    }
  }

  let source: SearchResult[]
  if (scope === 'local') {
    source = localResults
  } else if (scope === 'online') {
    source = onlineResults
  } else {
    source = mergeResults(localResults, onlineResults)
  }
  const filtered = filterResults(source, query)
  renderSearchResults(filtered)
}

/** 渲染搜索结果（点击可展开详情） */
function renderSearchResults(results: SearchResult[]): void {
  const host = byId('dcSearchResults')
  if (host === null) return
  cachedResults = results
  if (results.length === 0) {
    host.innerHTML = `<p class="dc-empty">${escapeHtml(tOr('dc.search.noResult', '没有找到匹配结果'))}</p>`
    return
  }
  host.innerHTML = results
    .map((result) => {
      const meta = `${result.year} · ${result.kind} · ${result.source}`
      const detail = result.summary === undefined ? '' : `<div class="dc-result-detail">${escapeHtml(result.summary)}</div>`
      return `<details class="dc-result-item"><summary>${escapeHtml(result.name)} <span class="dc-result-meta">${escapeHtml(meta)}</span></summary>${detail}</details>`
    })
    .join('')
}

/** 把最近一次搜索结果写入当前工作簿的「搜索结果」表（覆盖同名表数据区） */
function writeSearchResultsToSheet(): void {
  if (cachedResults.length === 0) {
    showToast(tOr('dc.write.empty', '请先搜索出结果，再写入 Excel'), 'warn')
    return
  }
  const rows = searchResultsToRows(cachedResults)
  const outcome = writeRowsToResultSheet(rows)
  if (outcome.ok) {
    showToast(tOr('dc.write.done', '已写入「搜索结果」工作表：{count} 条', {
      count: String(outcome.written),
    }), 'success')
    appendLog(tOr('dc.write.logDone', '写入搜索结果 {count} 条到工作表', {
      count: String(outcome.written),
    }))
  } else {
    showToast(tOr('dc.write.failed', '写入失败：{reason}', { reason: outcome.error }), 'error')
    appendLog(`[write] ${outcome.error}`)
  }
}

/** 读取当前表并刷新统计与推荐（首屏自动跑一次，按钮也可手动触发） */
function refreshAll(): void {
  const records = readRecords()
  renderStatistics(records)
  renderRecommendations(records)
}

/** 绑定所有按钮；重复调用安全（页面只初始化一次） */
export function initializeDataCenterPage(): void {
  const refresh = byId('dcRefreshButton')
  refresh?.addEventListener('click', () => {
    refreshAll()
  })
  const checkUpdate = byId('dcCheckUpdateButton')
  checkUpdate?.addEventListener('click', () => {
    void checkDataUpdate()
  })
  const exportButton = byId('dcExportButton')
  exportButton?.addEventListener('click', () => {
    exportStatistics(cachedRecords)
  })
  const searchButton = byId('dcSearchButton')
  searchButton?.addEventListener('click', () => {
    void performSearch()
  })
  const writeSheetButton = byId('dcWriteSheetButton')
  writeSheetButton?.addEventListener('click', () => {
    writeSearchResultsToSheet()
  })
  const clearLog = byId('dcLogClearButton')
  clearLog?.addEventListener('click', () => {
    const log = byId('dcLog')
    if (log !== null) log.textContent = ''
  })

  appendLog(tOr('dc.log.ready', '数据中心已就绪'))
  bgmLog(LOG_LEVELS.INFO, '[DataCenter] 页面初始化完成')
  refreshAll()
}
