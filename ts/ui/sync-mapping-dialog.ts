/**
 * @fileoverview 同步前列映射确认对话框
 * @module ui/syncMappingDialog
 * @description 2026-10-17 新增。点「立即同步」后**先**弹本框，展示「远程字段 → 本地列」
 *              的对应关系，用户可：
 *              ① 取消勾选（该字段本次不下载也不写入）；
 *              ② 拖拽排序（仅展示顺序；写入按列名寻址，顺序不影响结果）；
 *              ③ 改目标列（把某个远程字段写到本地另一列）；
 *              ④ 一键补齐缺失列（把缺的列名写进表头行末尾，写后读回校验）。
 *              确认后返回 {@link SyncMappingConfig} 交给同步主流程；取消返回 null。
 *
 *              纯逻辑（行构建 / 选择解析 / 冲突校验）在 `sync/sync-mapping.ts`；
 *              本模块只负责 DOM 与写表头。DOM 模式与 `sync-result-dialog.ts` 一致
 *              （自建 `.bgm-modal` + innerHTML + 事件绑定），复用既有 dialog 样式类。
 */

import {
  getCellValue,
  getColumnMap,
  getDataSheet,
  findHeaderRow,
  setCellValue,
} from '../tools/util/index.js'
import type { WpsWorksheet } from '../tools/wps.js'

import {
  SYNC_MAPPING_GROUP_LABELS,
  UNMAPPED_REMOTE_FIELDS,
  buildSyncMappingRows,
  findOverrideConflicts,
  resolveSyncMappingConfig,
} from '../sync/sync-mapping.js'
import type { SyncMappingConfig, SyncMappingRow } from '../sync/sync-mapping.js'

/** 弹窗根节点 id（重复调用时先移除旧框） */
const MODAL_ID = 'bgmSyncMappingModal'

/**
 * 显示列映射确认框
 *
 * @returns 用户确认后的配置；点「取消同步」/ 遮罩 / ESC 返回 null。
 *          读不到工作表时返回空配置（不阻塞同步，等价于「全部按默认」）。
 */
export function showSyncMappingDialog(): Promise<SyncMappingConfig | null> {
  const worksheet = getDataSheet()
  if (!worksheet) {
    return Promise.resolve({ excludedColumns: [], columnOverrides: {} })
  }

  const headerRow = findHeaderRow(worksheet) || 1
  const columnMap = getColumnMap(worksheet, headerRow)
  const rows = buildSyncMappingRows([...columnMap.keys()])

  return new Promise<SyncMappingConfig | null>((resolve) => {
    renderDialog(worksheet, headerRow, columnMap, rows, resolve)
  })
}

/** 渲染并绑定事件（resolve 只调用一次） */
function renderDialog(
  worksheet: WpsWorksheet,
  headerRow: number,
  columnMap: Map<string, number>,
  rows: SyncMappingRow[],
  resolve: (config: SyncMappingConfig | null) => void,
): void {
  // 移除旧框（重复点击同步时）
  document.querySelector(`#${MODAL_ID}`)?.remove()

  const modal = document.createElement('div')
  modal.className = 'bgm-modal'
  modal.id = MODAL_ID

  const missingCount = rows.filter((row) => !row.hasLocalColumn).length
  const unmappedNames = UNMAPPED_REMOTE_FIELDS.map(([, note]) => note).join('、')

  modal.innerHTML = `
    <div class="bgm-modal-content">
      <div class="bgm-dialog-header">
        <span class="bgm-dialog-title">同步前列映射确认</span>
      </div>
      <div class="bgm-dialog-body">
        <div class="bgm-result-section">
          <div class="bgm-result-date-label">
            勾选本次要同步的字段。未勾选的字段<strong>不下载也不写入</strong>；可拖拽行或点 ▲▼ 调整展示顺序；「目标列」可改成你表里的任意列。
          </div>
          <div class="bgm-mapping-toolbar">
            <button id="bgmMappingAddMissing" type="button" class="bgm-dialog-btn bgm-dialog-btn-default"${
              missingCount === 0 ? ' disabled' : ''
            }>＋ 一键补齐缺失列（${String(missingCount)}）</button>
            <span id="bgmMappingStatus" class="bgm-result-date-label"></span>
          </div>
          <div id="bgmMappingList"></div>
          <div class="bgm-result-date-label">
            另有 ${String(UNMAPPED_REMOTE_FIELDS.length)} 个远程字段无对应列，随分片下载但不写入：${unmappedNames}。
          </div>
        </div>
      </div>
      <div class="bgm-dialog-footer">
        <button id="bgmMappingCancel" type="button" class="bgm-dialog-btn bgm-dialog-btn-default">取消同步</button>
        <button id="bgmMappingConfirm" type="button" class="bgm-dialog-btn bgm-dialog-btn-primary">开始同步</button>
      </div>
    </div>`

  document.body.appendChild(modal)
  modal.style.display = 'flex'

  const list = modal.querySelector<HTMLElement>('#bgmMappingList')
  const status = modal.querySelector<HTMLElement>('#bgmMappingStatus')
  const fillMissingButton = modal.querySelector<HTMLButtonElement>('#bgmMappingAddMissing')
  const confirmButton = modal.querySelector<HTMLButtonElement>('#bgmMappingConfirm')
  const cancelButton = modal.querySelector<HTMLButtonElement>('#bgmMappingCancel')

  /** 关闭弹窗（只 resolve 一次） */
  let isSettled = false
  const close = (config: SyncMappingConfig | null): void => {
    if (isSettled) return
    isSettled = true
    modal.remove()
    resolve(config)
  }

  /** 重新渲染列表（排序 / 补列后） */
  const renderList = (): void => {
    if (!list) return
    const localColumns = [...columnMap.keys()]
    list.innerHTML = rows
      .map((row, index) => renderRowHtml(row, index, rows.length, localColumns))
      .join('')
  }

  /** 行内交互绑定（每次重渲染后重绑） */
  const bindListEvents = (): void => {
    if (!list) return

    list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const row = rows.find((candidate) => candidate.id === checkbox.dataset.rowId)
        if (row) row.selected = checkbox.checked
      })
    })

    list.querySelectorAll<HTMLSelectElement>('select[data-row-id]').forEach((select) => {
      select.addEventListener('change', () => {
        const row = rows.find((candidate) => candidate.id === select.dataset.rowId)
        if (row) row.targetColumn = select.value
      })
    })

    // 上移 / 下移（拖拽在 iframe 里不稳，按钮是主通道）
    list.querySelectorAll<HTMLButtonElement>('button[data-move]').forEach((button) => {
      button.addEventListener('click', () => {
        const { rowId } = button.dataset
        const direction = button.dataset.move
        const index = rows.findIndex((row) => row.id === rowId)
        if (index === -1) return
        const target = direction === 'up' ? index - 1 : index + 1
        if (target === -1 || target >= rows.length) return
        const [moved] = rows.splice(index, 1)
        if (moved) rows.splice(target, 0, moved)
        renderList()
        bindListEvents()
      })
    })
  }

  /** 拖拽排序（HTML5 DnD；仅影响展示顺序） */
  let draggingId: string | null = null
  const bindDragEvents = (): void => {
    if (!list) return
    list.querySelectorAll<HTMLElement>('.bgm-mapping-row').forEach((rowElement) => {
      rowElement.addEventListener('dragstart', () => {
        draggingId = rowElement.dataset.rowId ?? null
        rowElement.classList.add('bgm-mapping-row--dragging')
      })
      rowElement.addEventListener('dragend', () => {
        rowElement.classList.remove('bgm-mapping-row--dragging')
        draggingId = null
      })
      rowElement.addEventListener('dragover', (event) => {
        event.preventDefault()
      })
      rowElement.addEventListener('drop', (event) => {
        event.preventDefault()
        const targetId = rowElement.dataset.rowId
        if (draggingId === null || targetId === undefined || draggingId === targetId) return
        const fromIndex = rows.findIndex((row) => row.id === draggingId)
        const toIndex = rows.findIndex((row) => row.id === targetId)
        if (fromIndex === -1 || toIndex === -1) return
        const [moved] = rows.splice(fromIndex, 1)
        if (moved) rows.splice(toIndex, 0, moved)
        renderList()
        bindListEvents()
        bindDragEvents()
      })
    })
  }

  /** 一键补列：写表头 → 读回校验 → 只有校验通过的才标记为已有列 */
  const handleAddMissing = (): void => {
    const missingNames = [
      ...new Set(
        rows
          .filter(
            (row) => row.selected && !row.hasLocalColumn && row.targetColumn === row.defaultColumn,
          )
          .map((row) => row.defaultColumn),
      ),
    ]
    if (missingNames.length === 0) {
      if (status) status.textContent = '没有需要补齐的列（未勾选任何缺失列字段）'
      return
    }

    const { added, failed } = addHeaderColumns(worksheet, headerRow, columnMap, missingNames)
    for (const name of added) {
      const index = columnMap.get(name)
      const affectedRows = rows.filter((candidate) => candidate.defaultColumn === name)
      for (const row of affectedRows) {
        row.hasLocalColumn = true
        row.selected = true
        if (index !== undefined) row.targetColumn = name
      }
    }
    renderList()
    bindListEvents()
    bindDragEvents()
    if (status) {
      status.textContent =
        failed.length === 0
          ? `已补齐 ${String(added.length)} 列并读回校验通过`
          : `已补齐 ${String(added.length)} 列；${String(failed.length)} 列写入校验失败（${failed.join('、')}）`
    }
  }

  const handleConfirm = (): void => {
    const conflicts = findOverrideConflicts(rows)
    if (conflicts.length > 0) {
      if (status) {
        status.textContent = `目标列冲突：${conflicts.join('、')} 指向的列已被其他字段使用，请调整后再同步`
      }
      return
    }
    close(resolveSyncMappingConfig(rows))
  }

  fillMissingButton?.addEventListener('click', handleAddMissing)
  confirmButton?.addEventListener('click', handleConfirm)
  cancelButton?.addEventListener('click', () => {
    close(null)
  })
  // 点遮罩 / ESC = 取消同步（与既有弹窗口径一致）
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close(null)
  })
  document.addEventListener('keydown', function onEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    document.removeEventListener('keydown', onEscape)
    close(null)
  })

  renderList()
  bindListEvents()
  bindDragEvents()
  confirmButton?.focus()
}

/** 单行 HTML（含勾选 / 拖拽手柄 / 目标列下拉 / 状态徽章 / 上下移） */
function renderRowHtml(
  row: SyncMappingRow,
  index: number,
  total: number,
  localColumns: readonly string[],
): string {
  const options = buildTargetOptions(row, localColumns)
  const badge = row.hasLocalColumn
    ? '<span class="bgm-meta-tag">已匹配</span>'
    : '<span class="bgm-meta-tag bgm-meta-tag-warn">本地缺列</span>'
  const groupLabel = SYNC_MAPPING_GROUP_LABELS[row.group]

  return `
    <div class="bgm-mapping-row${row.hasLocalColumn ? '' : ' bgm-mapping-row--missing'}" data-row-id="${escapeAttribute(row.id)}" draggable="true">
      <span class="bgm-mapping-handle" title="拖拽排序">⋮⋮</span>
      <input type="checkbox" data-row-id="${escapeAttribute(row.id)}"${row.selected ? ' checked' : ''} />
      <span class="bgm-mapping-field" title="${escapeAttribute(row.remoteField)}（${escapeAttribute(groupLabel)}）">${escapeHtml(row.id)}</span>
      <span class="bgm-mapping-arrow">→</span>
      <select class="bgm-mapping-select" data-row-id="${escapeAttribute(row.id)}">${options}</select>
      ${badge}
      <button type="button" class="bgm-dialog-btn bgm-dialog-btn-default" data-move="up" data-row-id="${escapeAttribute(row.id)}"${index === 0 ? ' disabled' : ''}>▲</button>
      <button type="button" class="bgm-dialog-btn bgm-dialog-btn-default" data-move="down" data-row-id="${escapeAttribute(row.id)}"${index === total - 1 ? ' disabled' : ''}>▼</button>
    </div>`
}

/** 目标列下拉选项：本地全部列（可改映射）+ 默认列（缺列时标「新增」） */
function buildTargetOptions(row: SyncMappingRow, localColumns: readonly string[]): string {
  // 本地列（去重）在前，默认列与当前目标列兜底在后（缺列时也要能选中）
  const columns = new Set<string>(localColumns)
  columns.add(row.defaultColumn)
  columns.add(row.targetColumn)

  const options: string[] = []
  for (const column of columns) {
    const suffix = column === row.defaultColumn && !row.hasLocalColumn ? '（新增）' : ''
    options.push(
      `<option value="${escapeAttribute(column)}"${column === row.targetColumn ? ' selected' : ''}>${escapeHtml(column)}${suffix}</option>`,
    )
  }
  return options.join('')
}

/**
 * 把列名写入表头行末尾，并读回校验
 *
 * 遵循 P2-6 的纪律：写后读回，只有读回值一致才算成功（返回 added）；
 * 校验失败的列不并入映射，交由调用方提示用户。
 */
function addHeaderColumns(
  worksheet: WpsWorksheet,
  headerRow: number,
  columnMap: Map<string, number>,
  names: readonly string[],
): { added: string[]; failed: string[] } {
  let maxCol = 0
  for (const column of columnMap.values()) {
    if (column > maxCol) maxCol = column
  }

  const written: { name: string; column: number }[] = []
  let nextCol = maxCol
  for (const name of names) {
    nextCol += 1
    if (setCellValue(worksheet, headerRow, nextCol, name)) {
      written.push({ name, column: nextCol })
    }
  }

  const added: string[] = []
  const failed: string[] = []
  for (const { name, column } of written) {
    const readBack = getCellValue(worksheet, headerRow, column)
    if (readBack === name) {
      columnMap.set(name, column)
      added.push(name)
    } else {
      failed.push(name)
    }
  }
  return { added, failed }
}

/** 属性值转义（列名可能含引号） */
function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

/** 文本节点转义 */
function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
