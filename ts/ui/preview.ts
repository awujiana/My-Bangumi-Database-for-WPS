/**
 * 详细预览页面（模块化版）
 * @module ui/detail-preview
 * @description 数据预览、同步记录预览、详情模态框、单条上传
 */

import {
  getApp,
  bgmLog,
  BGM,
  getCellValue,
  trim,
  _getUserApiPath,
  wpsMessageBox,
  getCell,
  readRangeValues,
  escapeHtml,
  showAlert,
  showToast,
  findHeaderRow,
  getColumnMap,
  detectConflicts,
  extractSubjectId,
  mapWatchStatus,
  buildJsonPayload,
  bgmRequestSync,
  addSyncRecord,
  addTagsFromString,
  SyncToBangumiAsync,
  showSyncProgressDialog,
  buildSyncConfig,
  updateSyncProgressDialog,
  completeSyncProgressDialog,
  hideSyncProgressDialog,
} from '../index.js'
import type {
  WpsWorksheet,
  WpsRange,
  SyncRecord,
  SyncConfigSummary,
  UpdateRecordParameters,
} from '../index.js'
// 这三个常量在模块**顶层**被读取（VALID_STATUSES 的构造），若经 barrel 导入会形成
// 「顶层读取 + 环」的组合 —— 初始化期可能拿到 undefined。故直接从定义处导入。
import { BGM_COLOR, LOG_LEVELS, WATCH_STATUS_MAP } from '../core/constants.js'
import { registerSyncRunner } from '../core/ui-bridge.js'
import {
  createNoopSyncHandlers,
  createSyncControlHandlers,
} from '../core/sync-progress-handlers.js'
import { getAllSyncRecords } from '../sync/sync-record.js'
import { sanitizeHtml } from '../tools/sanitize.js'
import { loadBgToken } from '../tools/util/index.js'

// ========== 类型定义 ==========
export interface DetailItem {
  row: number
  name: string
  bgmUrl: string
  subjectId: string
  status: string
  rate: string
  tagsRaw: string
  finishedDate: string
  typeNum: number
  isUploaded: boolean
}

export interface PreviewItem {
  html: string
  type: number
}

export interface DetailPreviewData {
  //  所有条目（包含无效和已上传）
  allItems: PreviewItem[]
  currentFilter: string
  totalWithType: number
  totalValid: number
  totalUploaded: number
  typeCount: Record<number, number>
  uploadedCount: Record<number, number>
}

type ColumnMap = Map<string, number>

// ========== 辅助函数 ==========

function safeAlert(message: string, title?: string): void {
  if (document.getElementById('bgmDialogContainer')) {
    showAlert(message, title)
  } else {
    void wpsMessageBox(message, 0, 64)
  }
}

function isUploadedByColor(seqCell: WpsRange | null): boolean {
  // Interior 只读一次：WPS 的 Range 是跨进程 COM 代理，每次属性读取都是一次
  // 进程间往返。旧写法 `seqCell?.Interior` 判空后 `seqCell.Interior.Color` 又把
  // Interior 读了一遍 —— 预览对每条数据行都要走这个函数，3000 行的表每行多付
  // 1 次往返。提成局部量后每行固定 2 次属性读（Interior + Color）。
  const interior = seqCell?.Interior
  if (!interior) return false
  return [BGM_COLOR.SUCCESS, BGM_COLOR.LIGHT_GREEN, BGM_COLOR.DARK_GREEN].includes(interior.Color)
}

/** 预览取数涉及的映射键（批量矩形读时据此确定列包围盒） */
const PREVIEW_VALUE_KEYS = [
  'Bangumi_URL',
  '名称',
  '是否看完',
  '打分',
  '标签/分级',
  '原作标签',
  '完播日',
] as const

/** 行跨度超过该阈值就不做整块矩形读（避免把稀疏选区放大成超大 COM 传输） */
const MAX_BATCH_ROW_SPAN = 20_000

/**
 * 一次矩形读覆盖「所有行 × 所有取数列」，返回 行号 → (列号 → 文本)
 *
 * 原先每行要 7 次逐格读（500 行 ≈ 3500 次 IPC，是「预览同步」卡顿的主因）。
 * 读回行数不足或行跨度过大时返回 undefined —— 调用方回退逐格读。
 */
function buildRowCellsCache(
  worksheet: WpsWorksheet | null | undefined,
  rows: number[],
  columnMap: ColumnMap,
  seqColumn: number,
): Map<number, ReadonlyMap<number, string>> | undefined {
  if (!worksheet || rows.length === 0) return undefined

  let minRow = rows[0] ?? 0
  let maxRow = minRow
  for (const row of rows) {
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
  }
  if (maxRow - minRow + 1 > MAX_BATCH_ROW_SPAN) return undefined

  const columns = new Set<number>([columnMap.get('序列号') ?? seqColumn])
  for (const key of PREVIEW_VALUE_KEYS) {
    const column = columnMap.get(key)
    if (column !== undefined) columns.add(column)
  }
  let minColumn = Infinity
  let maxColumn = 0
  for (const column of columns) {
    if (column < minColumn) minColumn = column
    if (column > maxColumn) maxColumn = column
  }

  const block = readRangeValues(worksheet, minRow, maxRow, minColumn, maxColumn)
  if (block.length !== maxRow - minRow + 1) return undefined

  const cache = new Map<number, ReadonlyMap<number, string>>()
  for (const [index, cells] of block.entries()) {
    const byColumn = new Map<number, string>()
    for (const column of columns) byColumn.set(column, cells[column - minColumn] ?? '')
    cache.set(minRow + index, byColumn)
  }
  return cache
}

function getRowData(
  worksheet: WpsWorksheet | null | undefined,
  rowNumber: number,
  columnMap: ColumnMap,
  headerRow: number,
  seqColumn = 9,
  rowCells?: ReadonlyMap<number, string>,
): DetailItem {
  const data: DetailItem = {
    row: rowNumber,
    name: '',
    bgmUrl: '',
    subjectId: '',
    status: '',
    rate: '',
    tagsRaw: '',
    finishedDate: '',
    typeNum: 0,
    isUploaded: false,
  }

  const readColumn = (mapKey: string): string => {
    const column = columnMap.get(mapKey)
    if (column !== undefined) {
      // 命中批量读缓存就用缓存，否则逐格读（兼容未走批量路径的调用点）
      const raw = rowCells?.get(column) ?? getCellValue(worksheet, rowNumber, column)
      return trim(raw)
    }
    return ''
  }

  data.bgmUrl = readColumn('Bangumi_URL')
  data.name = readColumn('名称')
  data.status = readColumn('是否看完')
  data.rate = readColumn('打分')
  // 合并 "标签/分级" 与 "原作标签" 两列，与 buildJsonPayload 保持一致
  const tagsGradeRaw = readColumn('标签/分级')
  const originalTagRaw = readColumn('原作标签')
  data.tagsRaw = [tagsGradeRaw, originalTagRaw].filter(Boolean).join('|')
  data.finishedDate = readColumn('完播日')

  if (data.bgmUrl) {
    data.subjectId = extractSubjectId(data.bgmUrl) ?? ''
  }
  if (data.subjectId) {
    data.typeNum = mapWatchStatus(data.status)
  }

  // 从列映射中读取序列号列，如果没有则使用默认值
  const actualSeqColumn = columnMap.get('序列号') ?? seqColumn
  const seqCell = getCell(worksheet, rowNumber, actualSeqColumn)
  data.isUploaded = isUploadedByColor(seqCell)
  return data
}

/**
 * 渲染详情项的HTML内容
 * @param rowData - 详情项数据对象，包含名称、类型、标签等信息
 * @param columnMap - 列映射关系（预留，用于扩展）
 * @param worksheet - 工作表对象（预留，用于扩展）
 * @returns 返回渲染后的详情项HTML字符串
 */
function renderDetailItemHtml(
  rowData: DetailItem,
  _columnMap: ColumnMap,
  _worksheet: WpsWorksheet | null | undefined,
): string {
  // 定义观看状态类型映射
  const typeNames: Record<number, string> = {
    0: '',
    1: '想看',
    2: '看过',
    3: '在看',
    4: '搁置',
    5: '抛弃',
  }
  const typeName = typeNames[rowData.typeNum] ?? '未知'

  // 解析标签数据
  const tagSet = new Set<string>()
  addTagsFromString(tagSet, rowData.tagsRaw)
  const tags = [...tagSet]
  // 生成标签HTML
  const tagsHtml =
    tags.length > 0
      ? `<div class="detail-value tags">${tags.map((t) => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')}</div>`
      : '<div class="detail-value">-</div>'

  // 返回完整的HTML模板字符串
  return `
    <div class="detail-item ${rowData.isUploaded ? 'uploaded' : 'pending'}" data-type="${String(rowData.typeNum)}" data-row="${String(rowData.row)}" data-subjectId="${rowData.subjectId}" data-status="${escapeHtml(rowData.status)}">
      <div class="detail-item-header">
        <div class="detail-item-title">
          <span class="detail-item-row">行 ${String(rowData.row)}</span>
          <span class="detail-item-name">${escapeHtml(rowData.name) || '(无名称)'}</span>
        </div>
        <button class="upload-single-btn ${rowData.isUploaded ? 'reupload' : ''}" data-row="${String(rowData.row)}">
          ${rowData.isUploaded ? '重新上传' : '上传'}
        </button>
        ${rowData.isUploaded ? '<span class="uploaded-badge">✓ 已上传</span>' : ''}
      </div>
      <div class="detail-item-body">
        <div class="detail-row">
          <span class="detail-label">Subject ID</span>
          <span class="detail-value subjectId ${rowData.subjectId ? 'valid' : ''}">${rowData.subjectId || '✘ 无法提取'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">观看状态</span>
          <span class="detail-value">${typeName} (type=${String(rowData.typeNum)})</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">完播日</span>
          <span class="detail-value">${!rowData.finishedDate || rowData.finishedDate === 'null' ? '(空白)' : escapeHtml(rowData.finishedDate)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">评分</span>
          <span class="detail-value" style="color:#f39c12;font-weight:600;">${rowData.rate && rowData.rate !== 'true' && rowData.rate !== 'True' ? `⭐ ${rowData.rate}` : '(空)'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">标签</span>
          ${tagsHtml}
        </div>
      </div>
    </div>
  `
}

// ========== 状态存储 ==========
let detailPreviewData: DetailPreviewData = {
  allItems: [],
  currentFilter: 'all',
  totalWithType: 0,
  totalValid: 0,
  totalUploaded: 0,
  typeCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  uploadedCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
}

function handlePreviewBodyClick(event: Event): void {
  const target = event.target as HTMLElement
  const button = target.closest('.upload-single-btn')
  if (!(button instanceof HTMLElement)) return
  const rowNumber = Number(button.dataset.row)
  if (Number.isNaN(rowNumber)) return
  void uploadSingleRow(rowNumber, button as HTMLButtonElement)
}

/** 判断字符串是否全部由 CJK 统一表意文字（U+4E00–U+9FA5）组成（等价于 /^[\u{4E00}-\u{9FA5}]+$/u） */
function isPureChinese(text: string): boolean {
  if (!text) return false
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code === undefined || code < 0x4e00 || code > 0x9fa5) return false
  }
  return true
}

// 从映射表中提取标准中文状态列表（过滤数字和英文）
const VALID_STATUSES = new Set(
  Object.keys(WATCH_STATUS_MAP)
    // 只保留纯中文
    .filter((key) => isPureChinese(key))
    .filter((key, index, array) => array.indexOf(key) === index),
  // 去重
)

/**
 * 将非标准状态文本标准化（如 "是" → "看过"）
 */
function normalizeStatus(rawStatus: string): string {
  const trimmed = rawStatus.trim()
  if (!trimmed) return ''
  // 如果在映射表中找到（包括中文和英文），则转换为对应的状态码，
  // 然后再映射回中文名称。也可以直接基于文本映射。
  const code = WATCH_STATUS_MAP[trimmed.toLowerCase()]
  if (code !== undefined) {
    // 根据状态码返回标准中文名称
    const reverseMap: Record<number, string> = {
      1: '想看',
      2: '看过',
      3: '在看',
      4: '搁置',
      5: '抛弃',
      0: '忽略',
    }
    return reverseMap[code] ?? trimmed
  }
  // 未识别的保持原样
  return trimmed
}
// ========== 公有函数 ==========

export async function previewSyncContent(): Promise<void> {
  bgmLog(LOG_LEVELS.INFO, '[preview] 开始执行 previewSyncContent')

  // 入口预检：防重入
  if (BGM.sync.isRunning) {
    showToast('同步正在进行中，请稍后', 'warn')
    return
  }

  const dp = BGM.dataPreview
  if (!dp?.worksheet) {
    showToast('请先在预览面板中加载数据', 'warn')
    return
  }

  const { worksheet, visibleRows, headerRow, dataStartRow } = dp
  // 防御性排序 + 去重：确保行号严格升序且无重复（修复"190-201后跳到3"问题）
  const dataRows = [
    ...new Set(visibleRows.filter((r) => r !== headerRow && r >= dataStartRow)),
  ].sort((a, b) => a - b)
  bgmLog(LOG_LEVELS.INFO, `[preview] 过滤后得到 ${String(dataRows.length)} 条数据行`)
  if (dataRows.length > 0) {
    bgmLog(
      LOG_LEVELS.INFO,
      `[preview] 数据行范围: ${String(dataRows[0] ?? '')} ~ ${String(dataRows.at(-1) ?? '')}`,
    )
  }

  if (dataRows.length === 0) {
    showToast('没有可预览的数据行', 'info')
    return
  }

  const columnMap = getColumnMap(worksheet, headerRow)
  if (columnMap.size === 0) {
    showToast('无法读取列映射', 'error')
    return
  }

  // 重置统计
  detailPreviewData = {
    allItems: [],
    currentFilter: 'all',
    totalWithType: 0,
    totalValid: 0,
    totalUploaded: 0,
    typeCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    uploadedCount: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  }

  // 显示同步进度弹窗（不隐藏"同步到 Bangumi"按钮）
  const previewConfig: SyncConfigSummary = buildSyncConfig({
    source: '当前工作表',
    strategy: '预览同步',
    direction: 'Excel → Bangumi',
    extra: [{ label: '总行数', value: String(dataRows.length) }],
  })
  showSyncProgressDialog('正在同步 - 预览同步', createSyncControlHandlers(BGM.sync), previewConfig)

  // 进入运行状态（防重入，统一入口）
  if (!BGM.sync.enterRunningState()) return
  const urlColumnForLocate = columnMap.get('Bangumi_URL') ?? 1
  BGM.sync.updatePosition(worksheet, 0, urlColumnForLocate)

  let cardsHtml = '<div class="detail-list">'
  let actualCardCount = 0
  const totalRows = dataRows.length
  let skippedCount = 0
  let errorCount = 0

  // 循环外一次矩形读全部取数列（缓存未建成时 getRowData 自动回退逐格读）
  const rowCellsCache = buildRowCellsCache(worksheet, dataRows, columnMap, 9)

  const renderPreviewCards = async (): Promise<void> => {
    for (const [index, rowNumber] of dataRows.entries()) {
      // 停止检查
      if (BGM.sync.checkShouldStop()) {
        bgmLog(
          LOG_LEVELS.INFO,
          `[preview] 检测到停止请求，提前终止预览生成（已完成 ${String(index)}/${String(totalRows)}）`,
        )
        break
      }
      // 暂停检查
      if (BGM.sync.checkPaused()) {
        bgmLog(
          LOG_LEVELS.INFO,
          `[preview] 已暂停，进度 ${String(index)}/${String(totalRows)}，等待恢复...`,
        )
        await BGM.sync.waitForResume()
        if (BGM.sync.checkShouldStop()) {
          bgmLog(LOG_LEVELS.INFO, `[preview] 暂停期间收到停止请求，终止`)
          break
        }
      }

      BGM.sync.updatePosition(undefined, rowNumber)

      // 每行让出主线程，确保暂停按钮及时响应
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })

      // 缓存查表放在 try 外：可选链会抬高 try 块复杂度（unicorn/try-complexity）
      const rowCells = rowCellsCache?.get(rowNumber)
      try {
        const rowData = getRowData(worksheet, rowNumber, columnMap, headerRow, 9, rowCells)

        // 过滤无效行
        if (!rowData.bgmUrl || !rowData.subjectId) {
          bgmLog(LOG_LEVELS.INFO, `[preview] 跳过行 ${String(rowNumber)} (无 Bangumi URL)`)
          skippedCount += 1
          updateSyncProgressDialog(
            index + 1,
            totalRows,
            `预览生成 ${String(index + 1)}/${String(totalRows)}（卡片 ${String(actualCardCount)}）`,
            `⊘ [${String(index + 1)}/${String(totalRows)}] 行${String(rowNumber)} 跳过: 无URL`,
          )
        } else if (!rowData.name && !rowData.status && !rowData.tagsRaw) {
          bgmLog(LOG_LEVELS.INFO, `[preview] 跳过行 ${String(rowNumber)} (空卡片)`)
          skippedCount += 1
          updateSyncProgressDialog(
            index + 1,
            totalRows,
            `预览生成 ${String(index + 1)}/${String(totalRows)}（卡片 ${String(actualCardCount)}）`,
            `⊘ [${String(index + 1)}/${String(totalRows)}] 行${String(rowNumber)} 跳过: 空卡片`,
          )
        } else {
          const normalizedStatus = normalizeStatus(rowData.status)
          // 将标准化后的状态放回 rowData，便于后续统计和卡片渲染
          rowData.status = normalizedStatus

          // 更新统计数据（仅当状态码在 1-5 范围内）
          if (rowData.typeNum >= 1 && rowData.typeNum <= 5) {
            detailPreviewData.totalWithType += 1
            detailPreviewData.typeCount[rowData.typeNum] =
              (detailPreviewData.typeCount[rowData.typeNum] ?? 0) + 1
            if (rowData.isUploaded) {
              detailPreviewData.totalUploaded += 1
              detailPreviewData.uploadedCount[rowData.typeNum] =
                (detailPreviewData.uploadedCount[rowData.typeNum] ?? 0) + 1
            }
          }

          // 生成卡片 HTML（渲染成功后才计数）
          cardsHtml += renderDetailItemHtml(rowData, columnMap, worksheet)
          actualCardCount += 1
          updateSyncProgressDialog(
            index + 1,
            totalRows,
            `预览生成 ${String(index + 1)}/${String(totalRows)}（卡片 ${String(actualCardCount)}）`,
            `✓ [${String(index + 1)}/${String(totalRows)}] 行${String(rowNumber)} "${rowData.name || ''}" 已渲染`,
          )
        }
      } catch (error: unknown) {
        errorCount += 1
        BGM.handleError(error, {
          showAlert: false,
          level: BGM.ErrorLevel.WARN,
          context: 'previewSyncContent',
        })
        cardsHtml += `<div class="detail-item error">行 ${String(rowNumber)} 处理出错: ${escapeHtml((error as Error).message)}</div>`
        updateSyncProgressDialog(
          index + 1,
          totalRows,
          `预览生成 ${String(index + 1)}/${String(totalRows)}（卡片 ${String(actualCardCount)}）`,
          `✗ [${String(index + 1)}/${String(totalRows)}] 行${String(rowNumber)} 异常: ${(error as Error).message}`,
        )
      }
    }
    cardsHtml += '</div>'

    // 捕获停止状态（必须在 exitRunningState 之前，因为 exitRunningState 会重置 shouldStop）
    const wasStopped = BGM.sync.checkShouldStop()

    // 切换弹窗为完成状态
    const summary = `📊 预览 ${String(totalRows)} 行 | 卡片 ${String(actualCardCount)}\n\n✅ 已渲染: ${String(actualCardCount)}\n⏭️ 跳过: ${String(skippedCount)}\n❌ 错误: ${String(errorCount)}`
    const detailsArray: string[] = [
      ...(wasStopped ? ['⚠️ 预览被用户停止'] : []),
      `总行数: ${String(totalRows)}`,
      `渲染卡片: ${String(actualCardCount)}`,
      `跳过行数: ${String(skippedCount)}`,
      `错误行数: ${String(errorCount)}`,
    ]
    completeSyncProgressDialog(summary, detailsArray, wasStopped)

    // 生成统计卡片（使用 actualCardCount）
    const statsHtml = buildStatsHtml(actualCardCount)

    // 插入模态框
    const modal = document.getElementById('syncPreviewModal')
    if (!modal) return
    const body = modal.querySelector('.modal-body')
    if (!body) {
      return
    }
    body.removeEventListener('click', handlePreviewBodyClick)
    body.addEventListener('click', handlePreviewBodyClick)

    body.textContent = ''
    body.insertAdjacentHTML('beforeend', sanitizeHtml(statsHtml + cardsHtml))
    modal.style.display = 'block'

    // ----- 状态下拉筛选器 -----
    const header = modal.querySelector('.modal-header')
    if (!header) return

    const oldSelect = document.getElementById('statusFilterSelect')
    if (oldSelect) oldSelect.remove()

    // 收集卡片中出现的标准状态及其计数
    const statusMap = new Map<string, number>()
    body.querySelectorAll<HTMLElement>('.detail-item').forEach((item) => {
      const s = item.dataset.status
      if (s && VALID_STATUSES.has(s)) {
        // 只统计有效标准状态
        statusMap.set(s, (statusMap.get(s) ?? 0) + 1)
      }
    })

    // 按预定义顺序排序
    const priorityStatus = ['想看', '在看', '看过', '搁置', '抛弃']
    // ⚠️ 非优先组**最多只有一个成员**：`dataset.status` 恒为 normalizeStatus() 的产物，
    // 只可能是 WATCH_STATUS_MAP 反查出的 6 个标准名（想看/看过/在看/搁置/抛弃/忽略），
    // 其中 5 个已在 priorityStatus 里，非优先只剩「忽略」。
    // 因此这里**不需要比较器**（原 `.sort(…)` 因 Array#sort 对长度 ≤1 不调用比较器而是死代码，已删）。
    // 若将来 VALID_STATUSES 新增了「不会被 normalizeStatus 收敛」的状态，需把比较器加回来。
    const sortedStatus = [
      ...priorityStatus.filter((s) => statusMap.has(s)),
      ...[...statusMap.keys()].filter((s) => !priorityStatus.includes(s)),
    ]

    const select = document.createElement('select')
    select.id = 'statusFilterSelect'
    select.className = 'status-filter-select'
    // 使用 DOM API 创建 option，避免 innerHTML 拼接（XSS 防护）
    const allOption = document.createElement('option')
    allOption.value = 'all'
    allOption.textContent = `全部 (${String(actualCardCount)})`
    select.appendChild(allOption)
    for (const s of sortedStatus) {
      const option = document.createElement('option')
      option.value = s
      option.textContent = `${s} (${String(statusMap.get(s) ?? 0)})`
      select.appendChild(option)
    }

    const syncAllButton = document.getElementById('syncAllBtn')
    if (syncAllButton) {
      syncAllButton.after(select)
    } else {
      header.appendChild(select)
    }

    select.addEventListener('change', () => {
      const filter = select.value
      body.querySelectorAll<HTMLElement>('.detail-item').forEach((item) => {
        item.style.display = filter === 'all' || item.dataset.status === filter ? '' : 'none'
      })
    })

    select.value = 'all'
    select.dispatchEvent(new Event('change'))

    // ----- 绑定「全部同步」按钮点击事件 -----
    const syncAllButtonElement = document.getElementById('syncAllBtn')
    if (syncAllButtonElement) {
      syncAllButtonElement.addEventListener('click', () => {
        void (async () => {
          try {
            await syncAllRows()
          } catch (error: unknown) {
            bgmLog(LOG_LEVELS.ERROR, `[preview] syncAllRows 异常: ${(error as Error).message}`)
          }
        })()
      })
    }

    // ----- 绑定滚动按钮事件 -----
    const scrollTopButton = document.getElementById('scrollToTopBtn')
    const scrollBottomButton = document.getElementById('scrollToBottomBtn')

    const updateScrollButtons = () => {
      const { scrollTop, scrollHeight, clientHeight } = body
      const maxScroll = scrollHeight - clientHeight

      // 只有内容可滚动时才显示按钮
      if (maxScroll <= 0) {
        scrollTopButton?.classList.add('hidden')
        scrollBottomButton?.classList.add('hidden')
        return
      }

      // 根据位置显示/隐藏按钮
      scrollTopButton?.classList.toggle('hidden', scrollTop <= 10)

      scrollBottomButton?.classList.toggle('hidden', scrollTop >= maxScroll - 10)
    }

    // 初始化按钮可见性
    updateScrollButtons()

    // 滚动事件监听
    body.addEventListener('scroll', updateScrollButtons)

    // 按钮点击事件
    scrollTopButton?.addEventListener('click', () => {
      body.scrollTo({ top: 0, behavior: 'smooth' })
    })
    scrollBottomButton?.addEventListener('click', () => {
      body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' })
    })

    // 窗口大小变化时更新
    window.addEventListener('resize', updateScrollButtons)

    bgmLog(LOG_LEVELS.INFO, `[preview] 模态框已显示（${String(actualCardCount)} 条卡片，下拉全部）`)
  }
  try {
    await renderPreviewCards()
  } finally {
    // 退出运行状态，确保即使异常也能清理
    BGM.sync.exitRunningState()
  }
}

// ========== UI 辅助函数 ==========

// 生成统计卡片HTML
function buildStatsHtml(totalRows: number): string {
  const d = detailPreviewData
  const pending = d.totalWithType - d.totalUploaded

  // 共用统计条（与 clean / enrich / panel 三页预览区同一组件与视觉语言）
  return `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${String(totalRows)}</div>
        <div class="stat-label">总行数</div>
      </div>
      <div class="stat-card stat-card-warning">
        <div class="stat-value">${String(pending)}</div>
        <div class="stat-label">待上传</div>
      </div>
      <div class="stat-card stat-card-success">
        <div class="stat-value">${String(d.totalUploaded)}</div>
        <div class="stat-label">已上传</div>
      </div>
    </div>
  `
}

// ========== 单条上传 ==========
/**
 * 写入同步记录，并在失败时提示用户
 *
 * P1-E：上传已成功（单元格已标记）但记录没落盘时，用户不能只看到"成功"。
 */
function writeSyncRecord(parameters: UpdateRecordParameters): void {
  if (!addSyncRecord(parameters)) {
    showToast('同步记录写入失败：本条记录未登记，请检查「同步记录」工作表', 'error')
  }
}

export async function uploadSingleRow(
  rowNumber: number,
  buttonElement?: HTMLButtonElement,
): Promise<void> {
  const token = loadBgToken()
  if (!token) {
    safeAlert('请先设置 Bangumi Token！')
    return
  }

  if (buttonElement) {
    buttonElement.disabled = true
    buttonElement.classList.add('uploading')
    buttonElement.textContent = '上传中...'
  }

  const uploadSingleRowCore = async (): Promise<void> => {
    const app = getApp()
    if (!app?.ActiveWorkbook) throw new Error('无法获取 Application')

    // #sheetSelect 可能不存在（非预览页调用 / 面板尚未渲染）：不得把 null 断言成
    // HTMLSelectElement 再读 .value —— 那样抛出的 TypeError 会被外层 catch 包装成
    // 「上传出错: Cannot read properties of null」，掩盖真实失败原因。
    const sheetSelectElement = document.getElementById('sheetSelect')
    let selectedSheetValue = ''
    if (sheetSelectElement instanceof HTMLSelectElement) {
      selectedSheetValue = sheetSelectElement.value
    } else {
      bgmLog(LOG_LEVELS.WARN, '[preview] 未找到 #sheetSelect，工作表序号回退到 1')
    }
    // Number('') 为 0 会绕过 isFinite 兜底，空串须显式转 NaN
    const parsedSheetIndex =
      BGM.sheet.lockedIndex ?? (selectedSheetValue === '' ? NaN : Number(selectedSheetValue))
    const sheetIndex = Number.isFinite(parsedSheetIndex) ? parsedSheetIndex : 1
    const worksheet = app.ActiveWorkbook.Worksheets.Item(sheetIndex)

    const headerRow = findHeaderRow(worksheet) || 1
    const columnMap: ColumnMap = getColumnMap(worksheet, headerRow)
    if (!columnMap.has('Bangumi_URL')) throw new Error('未找到 Bangumi URL 列')

    const rowData = getRowData(worksheet, rowNumber, columnMap, headerRow, 9)
    if (!rowData.subjectId) throw new Error('无法提取 Subject ID')

    const jsonBody = buildJsonPayload((key) => {
      const column = columnMap.get(key)
      return column === undefined ? '' : trim(getCellValue(worksheet, rowNumber, column))
    }, rowData.finishedDate)
    if (!jsonBody) throw new Error('无法构建请求体')

    const result = await bgmRequestSync(
      'POST',
      `/v0/users/${_getUserApiPath()}/collections/${rowData.subjectId}`,
      jsonBody,
      token,
    )
    const statusCode = result.code || 0
    // 从列映射中读取序列号列
    const actualSeqColumn = columnMap.get('序列号') ?? 9
    const seqCell = getCell(worksheet, rowNumber, actualSeqColumn)

    if ([200, 201, 202, 204].includes(statusCode)) {
      if (seqCell?.Interior) seqCell.Interior.Color = BGM_COLOR.SUCCESS

      if (buttonElement) {
        buttonElement.classList.remove('uploading')
        buttonElement.classList.add('reupload')
        buttonElement.textContent = '重新上传'
        buttonElement.disabled = false
      }

      const detailItem = buttonElement?.closest('.detail-item') as HTMLElement | null
      if (detailItem) {
        detailItem.classList.remove('pending')
        detailItem.classList.add('uploaded')
        if (!detailItem.querySelector('.uploaded-badge')) {
          const header = detailItem.querySelector('.detail-item-header')
          if (header) {
            const badge = document.createElement('span')
            badge.className = 'uploaded-badge'
            badge.textContent = '✓ 已上传'
            header.appendChild(badge)
          }
        }
      }

      writeSyncRecord({
        name: rowData.name || '(无名称)',
        url: rowData.bgmUrl,
        subjectId: rowData.subjectId,
        type: '',
        content: jsonBody,
        status: '成功',
        message: `行 ${String(rowNumber)}`,
        count: 1,
      })
    } else {
      if (seqCell?.Interior) seqCell.Interior.Color = BGM_COLOR.FAIL

      if (buttonElement) {
        buttonElement.classList.remove('uploading')
        buttonElement.classList.add('error')
        buttonElement.textContent = '✗ 失败'
        buttonElement.disabled = false
      }

      writeSyncRecord({
        name: rowData.name || '(无名称)',
        url: rowData.bgmUrl,
        subjectId: rowData.subjectId,
        type: '',
        content: jsonBody,
        status: '失败',
        message: result.message || `HTTP ${String(statusCode)}`,
        count: 1,
      })
      BGM.handleError(new Error(`上传失败: ${result.message || '未知错误'}`), {
        showAlert: false,
        level: BGM.ErrorLevel.WARN,
        context: 'UploadSingleRow',
      })
      showToast(`上传失败: ${(result.message || '未知错误').substring(0, 60)}`, 'error')
    }
  }
  try {
    await uploadSingleRowCore()
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: true,
      level: BGM.ErrorLevel.ERROR,
      context: 'UploadSingleRow',
    })
    if (buttonElement) {
      buttonElement.disabled = false
      buttonElement.classList.remove('uploading')
      buttonElement.classList.add('error')
      buttonElement.textContent = '✗ 错误'
    }
    showToast(`上传出错: ${(error as Error).message.substring(0, 60)}`, 'error')
    BGM.handleError(error, {
      showAlert: true,
      level: BGM.ErrorLevel.ERROR,
      context: 'UploadSingleRow',
    })
  }
}

export function showDetailModal(): void {
  const modal = document.getElementById('detailModal')
  if (modal) modal.style.display = 'flex'
}

export function closeDetailModal(): void {
  const modal = document.getElementById('detailModal')
  if (modal) modal.style.display = 'none'
}

export function viewSyncRecordDetail(subjectId: string): void {
  if (typeof getAllSyncRecords !== 'function') {
    safeAlert('同步记录功能不可用！')
    return
  }
  const records = getAllSyncRecords()
  const record = records.find((r: SyncRecord) => String(r.subjectId) === subjectId)
  if (!record) {
    safeAlert('未找到该同步记录')
    return
  }
  let content = record.content ?? ''
  try {
    content = JSON.stringify(JSON.parse(content), null, 2)
  } catch (error: unknown) {
    BGM.handleError(error, {
      showAlert: false,
      level: BGM.ErrorLevel.WARN,
      context: 'ViewSyncRecordDetail',
    })
  }
  const detail = `同步记录详情\n\n名称: ${record.name ?? ''}\nSID: ${record.subjectId ?? ''}\nURL: ${record.url ?? ''}\n时间: ${record.time ?? ''}\n状态: ${record.status ?? ''}\n同步次数: ${String(record.count || '')}\n备注: ${record.message ?? ''}\n\n同步内容:\n${content}`
  safeAlert(detail, '同步记录详情')
}

/*
 * 一键同步所有可见数据行（由 BGM.sync.startSync 调用）
 * - 依赖 BGM.dataPreview 中的预览数据
 * - 使用 getSyncPreview 和 detectConflicts 进行统计和冲突检测
 * - 调用 SyncToBangumiAsync 执行批量同步
 * - 通过 showSyncProgressDialog/updateSyncProgressDialog/completeSyncProgressDialog 直接驱动进度弹窗
 * @returns 同步结果统计 { success, fail, skip }（不含 `SyncToBangumiAsync` 的
 * `stopped` —— 该字段只驱动本函数内的进度弹窗文案，不外传）
 */
export async function syncAllRows(): Promise<{ success: number; fail: number; skip: number }> {
  // 防重入预检（与 syncFromPanel 一致）
  if (BGM.sync.isRunning) {
    showToast('同步正在进行中，请稍后', 'warn')
    return { success: 0, fail: 0, skip: 0 }
  }

  const dp = BGM.dataPreview
  if (!dp?.worksheet) {
    showToast('请先在预览面板中加载数据', 'warn')
    return { success: 0, fail: 0, skip: 0 }
  }

  const token = loadBgToken()
  if (!token) {
    // 无 token 流程：显示进度弹窗提示用户，不退出页面
    showSyncProgressDialog('Bangumi Token 未设置', createNoopSyncHandlers())
    completeSyncProgressDialog(
      '⚠️ 无法同步：缺少 Bangumi Token',
      [
        '请先设置 Bangumi Token 后再尝试同步',
        '点击 Ribbon 上的「设置 Token」按钮进行配置',
        '或在任务窗格的「Token 设置」区域输入 Token',
      ],
      false,
    )
    showToast('请先设置 Bangumi Token', 'warn')
    return { success: 0, fail: 0, skip: 0 }
  }

  const { worksheet, visibleRows, headerRow, dataStartRow } = dp
  // 防御性排序 + 去重：确保行号严格升序且无重复
  const dataRows = [
    ...new Set(visibleRows.filter((r) => r !== headerRow && r >= dataStartRow)),
  ].sort((a, b) => a - b)
  if (dataRows.length === 0) {
    showToast('没有可同步的数据行', 'info')
    return { success: 0, fail: 0, skip: 0 }
  }

  const columnMap = getColumnMap(worksheet, headerRow)
  if (columnMap.size === 0) {
    showToast('无法读取列映射', 'error')
    return { success: 0, fail: 0, skip: 0 }
  }

  // 使用可见行最大行号作为数据范围
  const lastRow = Math.max(...dataRows)

  // ---------- 1. 同步预览统计 ----------

  // ---------- 2. 冲突检测（可选，默认以 Excel 覆盖） ----------
  let conflictInfo = ''
  try {
    const { conflictCount } = await detectConflicts(worksheet, columnMap, lastRow, headerRow, token)
    if (conflictCount > 0) {
      // 使用 Ribbon 的统一策略：默认以 Excel 覆盖，所以只需记录，不跳过
      conflictInfo = `检测到 ${String(conflictCount)} 条冲突，将以 Excel 数据覆盖。`
      bgmLog(LOG_LEVELS.WARN, conflictInfo)
      // 如需跳过冲突，可在 detectConflicts 后收集冲突 subjectId 集合，
      // 并通过 skipSubjectIds 选项传给 SyncToBangumiAsync
    }
  } catch (error: unknown) {
    const bgmError = BGM.handleError(error, { showAlert: false })
    bgmError.message = `冲突检测失败，已跳过此步骤。原始错误: ${bgmError.message}`
  }

  // ---------- 3. 读取增量同步设置 ----------
  const app = getApp()
  let isIncremental = false
  try {
    isIncremental = app?.PluginStorage?.getItem('bgm_incremental_sync') === 'true'
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[syncAllRows] 读取增量同步设置失败: ${(error as Error).message}`)
  }
  bgmLog(LOG_LEVELS.INFO, `[syncAllRows] 增量同步: ${isIncremental ? '开启' : '关闭'}`)

  // ---------- 4. 启动同步状态机 + 显示进度弹窗 ----------
  // 进入运行状态（防重入，统一入口）；失败则直接返回
  if (!BGM.sync.enterRunningState()) {
    bgmLog(LOG_LEVELS.WARN, '[syncAllRows] 已有同步进行中，拒绝重入')
    return { success: 0, fail: 0, skip: 0 }
  }

  try {
    // 更新当前位置（便于暂停时定位到表头）
    BGM.sync.updatePosition(worksheet, headerRow, columnMap.get('序列号') ?? 9)

    const uploadConfig: SyncConfigSummary = buildSyncConfig({
      source: '当前工作表',
      strategy: conflictInfo ? 'Excel覆盖冲突' : '标准同步',
      direction: 'Excel → Bangumi',
      extra: [
        { label: '数据行', value: String(dataRows.length) },
        { label: '增量同步', value: isIncremental ? '开启' : '关闭' },
      ],
    })
    // 显示同步进度弹窗（提供暂停/恢复/停止按钮）
    showSyncProgressDialog('正在上传同步', createSyncControlHandlers(BGM.sync), uploadConfig)

    const result = await SyncToBangumiAsync(worksheet, columnMap, token, lastRow, headerRow, {
      // 从 Ribbon 设置读取
      incremental: isIncremental,
      onProgress: (current, total, message) => {
        // 直接调用弹窗 API 更新进度，不再走事件总线
        updateSyncProgressDialog(current, total, message)
      },
      onItemComplete: (_row, _success, _result) => {
        // 颜色标记由内部完成，此处无需额外处理
      },
    })

    // 切换弹窗为完成状态（而非 BGM.setSyncComplete）
    const summary = `📊 同步 ${String(result.success + result.fail + result.skip)} 条\n\n✅ 成功: ${String(result.success)}\n❌ 失败: ${String(result.fail)}\n⏭️ 跳过: ${String(result.skip)}`
    const details: string[] = result.stopped
      ? [
          '⚠️ 同步被用户停止',
          `成功 ${String(result.success)} 条`,
          `失败 ${String(result.fail)} 条`,
          `跳过 ${String(result.skip)} 条`,
        ]
      : [
          `成功 ${String(result.success)} 条`,
          `失败 ${String(result.fail)} 条`,
          `跳过 ${String(result.skip)} 条`,
        ]
    completeSyncProgressDialog(summary, details, result.stopped)

    return { success: result.success, fail: result.fail, skip: result.skip }
  } catch (error: unknown) {
    // 异常时隐藏弹窗，避免残留运行态 UI
    hideSyncProgressDialog()
    BGM.handleError(error, { showAlert: true })
    return { success: 0, fail: 0, skip: 0 }
  } finally {
    // 无论成功、失败还是停止，都退出运行状态
    BGM.sync.exitRunningState()
  }
}

// ========== 注册同步执行体到桥（依赖反转的收口点） ==========
// 底层（tools/util/index.ts 的 BGM.sync.startSync）不再 import 本模块，而是调用
// core/ui-bridge 的 getSyncRunner()。本模块作为实现方在模块求值时注册。
registerSyncRunner(syncAllRows)
