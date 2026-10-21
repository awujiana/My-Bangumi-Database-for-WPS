/**
 * 跨页数据上下文共享
 * @module tools/dataContext
 * @description 页面获取到的工作簿 / 工作表 / 列 / 行信息写入 PluginStorage（键
 *   `bgm_data_context`），其它页面**进入时**读一次并重放成通知条。
 *
 * 为什么是「进入时读一次」而不是实时推送 / 轮询：周期性同步 COM 是 2026-10-21
 * 定位的卡顿根因（宿主初始化窗口内 / 频繁跨进程读取都会卡），这里只在两个
 * 天然便宜的时机各碰一次存储 —— 写入方在用户点击的按需路径上，读取方在页面
 * 初始化已读 PluginStorage 的同一阶段。
 */

import { getApp, bgmLog, getColumnMap, getLastRow } from './util/index.js'
import { LOG_LEVELS } from '../core/constants.js'
import type { WpsWorksheet } from './wps.js'

/** 存储键（单一最新快照，后写覆盖先写 —— 用户只关心「最近拿到的是什么」） */
const DATA_CONTEXT_KEY = 'bgm_data_context'

/** 页面标识 → 展示名 */
const PAGE_LABELS: Record<string, string> = {
  panel: '主面板',
  enrich: '富化',
  highlight: '高亮',
  clean: '清理',
  settings: '设置',
}

export interface DataContextSnapshot {
  workbook: string
  sheet: string
  /** 表头列名（按列序） */
  columns: string[]
  /** 数据行数（不含表头；拿不到时 0） */
  rowCount: number
  /** 获取数据的页面标识（panel / enrich / …） */
  fromPage: string
  /** 写入时间（Date.now()） */
  savedAt: number
}

/** 写入最新数据上下文（用户点击获取数据的按需路径上调用，勿在自动轮询里调） */
export function saveDataContext(snap: Omit<DataContextSnapshot, 'savedAt'>): void {
  try {
    const app = getApp()
    if (!app?.PluginStorage) return
    app.PluginStorage.setItem(
      DATA_CONTEXT_KEY,
      JSON.stringify({ ...snap, savedAt: Date.now() } satisfies DataContextSnapshot),
    )
  } catch (error: unknown) {
    // 快照写入是旁路能力：宿主/桩任何异常都不允许打断获取数据的主流程
    bgmLog(LOG_LEVELS.WARN, `[dataContext] 写入失败: ${String(error)}`)
  }
}

/** 读取最新数据上下文；没有或解析失败返回 null */
export function readDataContext(): DataContextSnapshot | null {
  try {
    const app = getApp()
    const raw = app?.PluginStorage ? app.PluginStorage.getItem(DATA_CONTEXT_KEY) : undefined
    if (!raw) return null
    const snap = JSON.parse(raw) as Partial<DataContextSnapshot>
    if (!snap.workbook && !snap.sheet) return null
    return {
      workbook: snap.workbook ?? '',
      sheet: snap.sheet ?? '',
      columns: Array.isArray(snap.columns) ? snap.columns : [],
      rowCount: snap.rowCount ?? 0,
      fromPage: snap.fromPage ?? '',
      savedAt: snap.savedAt ?? 0,
    }
  } catch {
    return null
  }
}

/**
 * 页面进入时重放：把其它页面获取的数据上下文显示为通知条（本页自己写的不重复展示）。
 *
 * 挂到 `<main class="main">` 顶部，一次性读存储，不做任何轮询；
 * 用户点 ✕ 即消失（本次进入期间不再出现）。
 */
export function mountDataContextNotice(page: string): void {
  const snap = readDataContext()
  if (!snap || snap.fromPage === page) return
  const main = document.querySelector('main.main')
  if (!main || document.getElementById('bgmDataContextNotice')) return

  const from = PAGE_LABELS[snap.fromPage] ?? snap.fromPage
  const time = new Date(snap.savedAt)
  const at = Number.isNaN(time.getTime())
    ? ''
    : ` · ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  const columnPart = snap.columns.length > 0 ? ` · ${String(snap.columns.length)} 列` : ''
  const rowPart = snap.rowCount > 0 ? ` · ${String(snap.rowCount)} 行` : ''

  const bar = document.createElement('div')
  bar.id = 'bgmDataContextNotice'
  // grid-column 兼容 panel 的 main-grid 布局（块布局下该属性无效果）
  bar.style.cssText =
    'display:flex;align-items:center;gap:8px;grid-column:1/-1;margin:0 0 8px;padding:6px 10px;' +
    'font-size:12px;color:var(--text-2,#bac2de);background:var(--bg-surface-2,#313244);' +
    'border-radius:6px;'
  const text = document.createElement('span')
  text.textContent = `📋 ${from}页已获取：${snap.workbook || '—'} / ${snap.sheet || '—'}${columnPart}${rowPart}${at}`
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '✕'
  close.setAttribute('aria-label', '关闭数据同步提示')
  close.style.cssText =
    'margin-left:auto;border:none;background:transparent;color:inherit;cursor:pointer;font-size:12px;'
  close.addEventListener('click', () => {
    bar.remove()
  })
  bar.append(text, close)
  main.prepend(bar)
}

/**
 * 从工作表提取快照（列名走 getColumnMap 的表头读，行数走 getLastRow）。
 * 供各页在「用户点击获取数据」的路径上统一取数，避免每页自己拼。
 */
export function snapshotFromWorksheet(
  worksheet: WpsWorksheet,
  headerRow: number,
  fromPage: string,
): Omit<DataContextSnapshot, 'savedAt'> {
  let name: string
  try {
    name = worksheet.Name
  } catch {
    name = ''
  }
  let columns: string[] = []
  let rowCount = 0
  try {
    columns = [...getColumnMap(worksheet, headerRow).keys()]
    const lastRow = getLastRow(worksheet)
    rowCount = lastRow > headerRow ? lastRow - headerRow : 0
  } catch {
    // 列/行读失败不阻断主流程：快照缺列行信息好过获取动作本身失败
  }
  return { workbook: name, sheet: name, columns, rowCount, fromPage }
}
