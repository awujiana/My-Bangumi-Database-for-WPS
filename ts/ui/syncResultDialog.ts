/**
 * @fileoverview 同步结果增强对话框
 * @module ui/syncResultDialog
 * @description 在同步完成后显示增强的统计结果弹窗，包含：
 * - 数据统计概览（总条数、新增、更新、删除、无变更、失败）
 * - 开播日期统计（最早/最晚开播日、最新开播季度）
 * - 导出为 JSONL 文件
 * - 查看同步详情
 * - 逐条查看与对比
 */

import { LOG_LEVELS } from '../core/constants.js'
import { exportSheetToJsonlFile } from '../sync/exportJsonl.js'
import type { GithubSyncResult } from '../sync/githubSync.js'
import { extractSubjectId } from '../sync/pureUtils.js'
import {
  getDataSheet,
  findHeaderRow,
  getColumnMap,
  getLastRow,
  getCellValue,
  trim,
} from '../tools/util/index.js'
import { bgmLog } from '../tools/util.js'

// ========== 日期统计类型 ==========

export interface DateStats {
  /** 最早开播日期（YYYY-MM-DD） */
  earliestDate: string | null
  /** 最晚开播日期（YYYY-MM-DD） */
  latestDate: string | null
  /** 最新开播季度（如 "2024年7月新番"） */
  latestSeason: string | null
  /** 有开播日期的条目数 */
  datedCount: number
  /** 总条目数 */
  totalCount: number
}

// ========== 对话框选项 ==========

export interface SyncResultDialogOptions {
  /** 同步结果统计 */
  result: GithubSyncResult
  /** 总耗时（毫秒） */
  elapsedMs: number
  /** 平均速度（行/秒） */
  avgSpeed: number
  /** 同步策略显示名称 */
  strategyLabel: string
  /** 是否被用户停止 */
  stopped: boolean
}

// ========== 日期统计计算 ==========

/**
 * 从日期字符串推断季度
 * 1-3月 → 冬，4-6月 → 春，7-9月 → 夏，10-12月 → 秋
 */
function getSeasonFromDate(dateStr: string): string | null {
  const match = dateStr.match(/^(\d{4})[-/.](\d{1,2})/)
  if (!match) return null
  const year = match[1]!
  const month = parseInt(match[2]!, 10)
  const seasonMap: Record<number, string> = {
    1: '冬',
    2: '冬',
    3: '冬',
    4: '春',
    5: '春',
    6: '春',
    7: '夏',
    8: '夏',
    9: '夏',
    10: '秋',
    11: '秋',
    12: '秋',
  }
  const season = seasonMap[month]
  if (!season) return null
  return `${year}年${month}月新番`
}

/**
 * 从 Excel 工作表中计算开播日期统计
 *
 * 遍历数据行，读取「开播日期」列，计算最早/最晚日期和最新季度。
 * 支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 格式。
 *
 * @returns 日期统计信息
 */
export function computeDateStatsFromSheet(): DateStats {
  const stats: DateStats = {
    earliestDate: null,
    latestDate: null,
    latestSeason: null,
    datedCount: 0,
    totalCount: 0,
  }

  const ws = getDataSheet()
  if (!ws) return stats

  const headerRow = findHeaderRow(ws) || 1
  const lastRow = getLastRow(ws)
  const colMap = getColumnMap(ws, headerRow)

  if (!colMap.has('Bangumi_URL') || !colMap.has('开播日期')) {
    return stats
  }

  const dateCol = colMap.get('开播日期')!
  const startRow = headerRow + 1

  let earliest: string | null = null
  let latest: string | null = null
  let datedCount = 0
  let totalCount = 0

  for (let row = startRow; row <= lastRow; row++) {
    const url = trim(getCellValue(ws, row, colMap.get('Bangumi_URL')!))
    if (!url) continue
    const sid = extractSubjectId(url)
    if (!sid) continue
    totalCount++

    const dateStr = trim(getCellValue(ws, row, dateCol))
    if (!dateStr) continue
    datedCount++

    // 标准化日期：移除分隔符，用于比较
    const normalized = dateStr.replace(/[/.]/g, '-')
    const dateMatch = normalized.match(/^\d{4}-\d{1,2}-\d{1,2}$/)
    if (!dateMatch) continue

    if (earliest === null || normalized < earliest) earliest = normalized
    if (latest === null || normalized > latest) latest = normalized
  }

  stats.earliestDate = earliest
  stats.latestDate = latest
  stats.datedCount = datedCount
  stats.totalCount = totalCount

  if (latest) {
    stats.latestSeason = getSeasonFromDate(latest)
  }

  return stats
}

// ========== 增强结果弹窗 ==========

let _resultDialog: HTMLElement | null = null
let _resultDialogEscHandler: ((e: KeyboardEvent) => void) | null = null

/** 清理 ESC 监听器 */
function _clearEscHandler(): void {
  if (_resultDialogEscHandler) {
    document.removeEventListener('keydown', _resultDialogEscHandler)
    _resultDialogEscHandler = null
  }
}

/**
 * 计算格式化耗时字符串
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}分${secs}秒`
}

/**
 * 显示同步完成增强结果弹窗
 *
 * @param options 同步结果选项
 */
export function showSyncResultDialog(options: SyncResultDialogOptions): void {
  const { result, elapsedMs, avgSpeed, strategyLabel, stopped } = options

  // 移除旧对话框
  if (_resultDialog) {
    _clearEscHandler()
    _resultDialog.remove()
    _resultDialog = null
  }

  // 计算日期统计
  const dateStats = computeDateStatsFromSheet()

  // 创建弹窗
  const modal = document.createElement('div')
  modal.className = 'bgm-modal'
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-labelledby', 'bgmResultTitle')

  // ── 构造弹窗内容 ──
  const icon = stopped ? '⏹️' : '✅'
  const title = stopped ? '同步已停止' : '同步完成'

  const elapsedStr = formatDuration(elapsedMs)
  const speedStr = avgSpeed > 0 ? `${avgSpeed} 行/秒` : '--'

  // 统计卡片
  const statCards = `
    <div class="bgm-result-stat-grid">
      <div class="bgm-result-stat-card">
        <div class="bgm-result-stat-value">${result.remoteTotal}</div>
        <div class="bgm-result-stat-label">远程条目</div>
      </div>
      <div class="bgm-result-stat-card bgm-result-stat-add">
        <div class="bgm-result-stat-value">${result.added}</div>
        <div class="bgm-result-stat-label">✅ 新增</div>
      </div>
      <div class="bgm-result-stat-card bgm-result-stat-update">
        <div class="bgm-result-stat-value">${result.updated}</div>
        <div class="bgm-result-stat-label">🔄 更新</div>
      </div>
      <div class="bgm-result-stat-card bgm-result-stat-delete">
        <div class="bgm-result-stat-value">${result.deleted}</div>
        <div class="bgm-result-stat-label">❌ 删除</div>
      </div>
      <div class="bgm-result-stat-card">
        <div class="bgm-result-stat-value">${result.unchanged}</div>
        <div class="bgm-result-stat-label">⏭️ 无变更</div>
      </div>
      <div class="bgm-result-stat-card ${result.failed > 0 ? 'bgm-result-stat-fail' : ''}">
        <div class="bgm-result-stat-value">${result.failed}</div>
        <div class="bgm-result-stat-label">⚠️ 失败</div>
      </div>
    </div>`

  // 日期统计
  let dateHtml = ''
  if (dateStats.datedCount > 0) {
    dateHtml = `
      <div class="bgm-result-section">
        <div class="bgm-result-section-title">📅 开播日期统计</div>
        <div class="bgm-result-date-grid">
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">最早开播</span>
            <span class="bgm-result-date-value">${dateStats.earliestDate ?? '--'}</span>
          </div>
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">最晚开播</span>
            <span class="bgm-result-date-value">${dateStats.latestDate ?? '--'}</span>
          </div>
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">最新季度</span>
            <span class="bgm-result-date-value">${dateStats.latestSeason ?? '--'}</span>
          </div>
          <div class="bgm-result-date-item">
            <span class="bgm-result-date-label">有日期条目</span>
            <span class="bgm-result-date-value">${dateStats.datedCount}/${dateStats.totalCount}</span>
          </div>
        </div>
      </div>`
  }

  const content = `
    <div class="bgm-modal-content" style="max-width: 560px; max-height: 80vh; display: flex; flex-direction: column;">
      <div class="bgm-dialog-header">
        <span class="bgm-dialog-icon bgm-icon-success">${icon}</span>
        <span class="bgm-dialog-title" id="bgmResultTitle">${title}</span>
      </div>
      <div class="bgm-dialog-body" style="flex: 1; overflow-y: auto; margin-bottom: 12px;">
        <div class="bgm-result-section">
          <div class="bgm-result-section-title">📊 数据统计</div>
          <div class="bgm-result-meta">
            <span>策略：${strategyLabel}</span>
            <span>⏱ ${elapsedStr}</span>
            <span>⚡ ${speedStr}</span>
          </div>
          ${statCards}
        </div>
        ${dateHtml}
        <div class="bgm-result-section">
          <div class="bgm-result-section-title">📋 操作</div>
          <div class="bgm-result-actions">
            <button id="bgmResultExportBtn" type="button" class="bgm-btn bgm-btn-primary" style="flex: 1;">📥 导出 JSONL</button>
            <button id="bgmResultViewDetailsBtn" type="button" class="bgm-btn bgm-btn-default" style="flex: 1;">📄 查看详情</button>
          </div>
        </div>
      </div>
      <div class="bgm-dialog-footer">
        <button id="bgmResultCloseBtn" type="button" class="bgm-btn bgm-btn-success" style="min-width: 120px;">确定</button>
      </div>
    </div>`

  modal.innerHTML = content
  document.body.appendChild(modal)
  _resultDialog = modal

  // ── 绑定事件 ──
  // 关闭按钮
  const closeBtn = modal.querySelector('#bgmResultCloseBtn') as HTMLButtonElement | null
  closeBtn?.addEventListener('click', () => {
    hideSyncResultDialog()
  })

  // 导出 JSONL
  const exportBtn = modal.querySelector('#bgmResultExportBtn') as HTMLButtonElement | null
  exportBtn?.addEventListener('click', () => {
    const originalText = exportBtn.textContent
    const success = exportSheetToJsonlFile()
    if (success) {
      // 短暂反馈
      exportBtn.textContent = '✅ 已导出'
      setTimeout(() => {
        if (exportBtn) exportBtn.textContent = originalText
      }, 2000)
    } else {
      exportBtn.textContent = '❌ 导出失败'
      setTimeout(() => {
        if (exportBtn) exportBtn.textContent = originalText
      }, 2000)
    }
  })

  // 查看详情（打开同步记录表）
  const viewDetailsBtn = modal.querySelector('#bgmResultViewDetailsBtn') as HTMLButtonElement | null
  viewDetailsBtn?.addEventListener('click', () => {
    // 动态导入避免循环依赖
    import('../sync/syncRecord.js')
      .then(({ openSyncRecordSheet }) => {
        openSyncRecordSheet()
      })
      .catch(() => {
        bgmLog(LOG_LEVELS.WARN, '[syncResultDialog] 无法打开同步记录表')
      })
  })

  // ESC 关闭
  _resultDialogEscHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      hideSyncResultDialog()
    }
  }
  document.addEventListener('keydown', _resultDialogEscHandler)

  // 焦点管理
  closeBtn?.focus()

  // 显示弹窗
  modal.style.display = 'flex'
}

/** 隐藏同步结果弹窗 */
export function hideSyncResultDialog(): void {
  if (_resultDialog) {
    _resultDialog.style.display = 'none'
    _resultDialog.remove()
    _resultDialog = null
  }
  _clearEscHandler()
}
