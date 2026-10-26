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

// ========== 「一键套用」：把快照写进各页自己的目标表键 ==========

/**
 * 各页的「套用」实现：把快照落到本页的目标表选择上，返回是否成功。
 *
 * 为什么用注册表而不是在 tools 层直接写各页的键：
 *   - tools 层反向 import panel/* 会成环（check:cycles 会红）；
 *   - 各页键格式不同（panel/enrich 是 locked-sheet 的 index 锁，
 *     条件格式/高亮是 `工作簿::工作表` 配置串），落到页内最自然；
 *   - 套用往往还要顺带刷新预览（读表），那更是页内的事。
 */
type TargetSheetApplier = (snapshot: DataContextSnapshot) => boolean

/** 页面标识 → 套用实现（`mountDataContextNotice` 要读它决定显不显示按钮） */
const targetSheetAppliers = new Map<string, TargetSheetApplier>()

/** 注册本页的「套用」实现（init 时调用；同一页重复注册以最后一次为准） */
// eslint-disable-next-line unicorn/consistent-boolean-name -- applier 是回调函数（返回 boolean），不是布尔变量；规则误报了返回类型
export function registerTargetSheetApplier(page: string, applier: TargetSheetApplier): void {
  targetSheetAppliers.set(page, applier)
}

/** 本页是否支持「一键套用」（通知条据此决定显不显示按钮） */
export function hasTargetSheetApplier(page: string): boolean {
  return targetSheetAppliers.has(page)
}

/**
 * 执行「套用到本页」。没有 applier 或执行抛错都返回 false（调用方只改按钮文案，
 * 不往上抛 —— 套用是便利功能，不该把页面搞崩）。
 */
// eslint-disable-next-line unicorn/consistent-boolean-name -- 与 registerTargetSheetApplier 同一理由：这是返回 boolean 的动作函数，不是布尔变量
export function applyDataContextToPage(page: string): boolean {
  const registered = targetSheetAppliers.get(page)
  if (!registered) return false
  const snapshot = readDataContext()
  if (!snapshot) return false
  try {
    return registered(snapshot)
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[dataContext] 套用到 ${page} 失败: ${String(error)}`)
    return false
  }
}

/** 仅供测试：清空注册表（避免跨文件残留影响其它用例） */
export function resetTargetSheetAppliers(): void {
  targetSheetAppliers.clear()
}

/**
 * 页面进入时重放：把其它页面获取的数据上下文显示为通知条（本页自己写的不重复展示）。
 *
 * 挂到 `<main class="main">` 顶部，一次性读存储，不做任何轮询；
 * 用户点 ✕ 即消失（本次进入期间不再出现）。
 *
 * 通知条带「套用到本页」按钮（仅当该页注册过 applier 时显示）：
 * 用户在高亮页选了表 → 跑到主面板 → 看到「高亮页已获取 X/Y」→ 点一下就
 * 把主面板也切到 X/Y，不用再把两级下拉重新点一遍。
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

  const actions = document.createElement('span')
  actions.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:6px;'

  // 「套用到本页」：只有本页注册了 applier 才给按钮（清理页是多选语义、
  // 设置页没有目标表，给了也做不到，不如不给）。
  if (targetSheetAppliers.has(page)) {
    const applyButton = document.createElement('button')
    applyButton.type = 'button'
    applyButton.className = 'bgm-btn small'
    applyButton.textContent = '↧ 套用到本页'
    applyButton.setAttribute('aria-label', `把${from}页选中的工作簿与工作表套用到本页`)
    applyButton.addEventListener('click', () => {
      const isApplied = applyDataContextToPage(page)
      applyButton.textContent = isApplied ? '✓ 已套用' : '✗ 套用失败'
      applyButton.disabled = true
      applyButton.style.opacity = isApplied ? '0.75' : '1'
      if (!isApplied) {
        text.textContent = `📋 套用失败：${snap.workbook || '—'} / ${snap.sheet || '—'} 当前不可用（工作簿或工作表可能已关闭）`
      }
    })
    actions.append(applyButton)
  }

  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '✕'
  close.setAttribute('aria-label', '关闭数据同步提示')
  close.style.cssText =
    'border:none;background:transparent;color:inherit;cursor:pointer;font-size:12px;'
  close.addEventListener('click', () => {
    bar.remove()
  })
  actions.append(close)
  bar.append(text, actions)
  main.prepend(bar)
}

/**
 * 从工作表提取快照（列名走 getColumnMap 的表头读，行数走 getLastRow）。
 * 供各页在「用户点击获取数据」的路径上统一取数，避免每页自己拼。
 *
 * 工作簿名走 `worksheet.Parent.Name`（取不到时退 `ActiveWorkbook.Name`）——
 * 曾经两处都填 `worksheet.Name`，通知条于是显示成「动画 / 动画」，
 * 「一键套用」也无从知道该切到哪个工作簿。
 */
export function snapshotFromWorksheet(
  worksheet: WpsWorksheet,
  headerRow: number,
  fromPage: string,
): Omit<DataContextSnapshot, 'savedAt'> {
  const name = readSheetName(worksheet)
  const workbook = readWorkbookName(worksheet)
  let columns: string[] = []
  let rowCount = 0
  try {
    columns = [...getColumnMap(worksheet, headerRow).keys()]
    const lastRow = getLastRow(worksheet)
    rowCount = lastRow > headerRow ? lastRow - headerRow : 0
  } catch {
    // 列/行读失败不阻断主流程：快照缺列行信息好过获取动作本身失败
  }
  return { workbook, sheet: name, columns, rowCount, fromPage }
}

/** 读工作表名（COM 属性访问整体包 try：拿不到不影响主流程） */
function readSheetName(worksheet: WpsWorksheet): string {
  try {
    return worksheet.Name
  } catch {
    return ''
  }
}

/** 读工作表所属工作簿名（Parent 优先，退化到活动工作簿） */
function readWorkbookName(worksheet: WpsWorksheet): string {
  try {
    const parent = (worksheet as { Parent?: { Name?: string } }).Parent
    const byParent = parent?.Name
    if (byParent) return byParent
  } catch {
    // Parent 不可达时走下面的活动工作簿兜底
  }
  try {
    return getApp()?.ActiveWorkbook?.Name ?? ''
  } catch {
    return ''
  }
}
