/**
 * UI 事件处理模块 - 工作表清洗相关
 * @module ui/handlers/sheet
 * @description 锁定数据表的重复行清洗（按名称合并、保留含 URL 的行、合并标签）。
 */

import {
  LOG_LEVELS,
  bgmLog,
  BGM,
  getApp,
  setCellValue,
  findHeaderRow,
  getColumnMap,
  getLastRow,
  readRangeValues,
  showToast,
} from '../../index.js'

/**
 * 清洗锁定的数据工作表：
 * 1. 按"名称"列分组，识别重复行
 * 2. 在重复组中保留含 Bangumi_URL 的行，删除无 URL 的行
 * 3. 合并被删除行的"标签/分级"到保留行
 * 4. 批量删除行（合并连续行为范围删除，减少 COM 调用）
 */
export function cleanLockedDataSheet(): void {
  const startTime = Date.now()
  bgmLog(LOG_LEVELS.INFO, '[cleanLockedDataSheet] ======== 开始清洗锁定数据表 ========')

  const app = getApp()
  if (!app?.ActiveWorkbook) {
    bgmLog(LOG_LEVELS.WARN, '[cleanLockedDataSheet] 无法获取工作簿，终止')
    showToast('无法获取工作簿', 'error')
    return
  }

  if (!BGM.sheet.isLocked || !BGM.sheet.lockedIndex) {
    bgmLog(LOG_LEVELS.WARN, '[cleanLockedDataSheet] 未锁定数据表，终止')
    showToast('请先锁定数据表', 'warn')
    return
  }

  const wb = app.ActiveWorkbook
  const ws = wb.Sheets.Item(BGM.sheet.lockedIndex)
  const sheetName = ws.Name || '未知'
  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanLockedDataSheet] 锁定工作表: "${sheetName}" (索引: ${String(BGM.sheet.lockedIndex)})`,
  )

  const headerRow = findHeaderRow(ws)
  if (!headerRow) {
    bgmLog(LOG_LEVELS.ERROR, '[cleanLockedDataSheet] 未找到表头行，终止')
    showToast('未找到表头行', 'error')
    return
  }

  const colMap = getColumnMap(ws, headerRow)
  const nameCol = colMap.get('名称')
  const urlCol = colMap.get('Bangumi_URL')
  const tagsCol = colMap.get('标签/分级')
  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanLockedDataSheet] 列映射: 名称列=${String(nameCol ?? '')}, Bangumi_URL列=${String(urlCol ?? '')}, 标签/分级列=${String(tagsCol ?? '')}`,
  )

  if (!nameCol) {
    bgmLog(LOG_LEVELS.ERROR, '[cleanLockedDataSheet] 未找到"名称"列，终止')
    showToast('未找到"名称"列', 'error')
    return
  }
  if (!urlCol) {
    bgmLog(LOG_LEVELS.ERROR, '[cleanLockedDataSheet] 未找到"Bangumi_URL"列，终止')
    showToast('未找到"Bangumi_URL"列', 'error')
    return
  }

  const lastRow = getLastRow(ws)
  const dataRows = lastRow - headerRow
  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanLockedDataSheet] 数据区间: headerRow=${String(headerRow)}, lastRow=${String(lastRow)}, 数据行数=${String(dataRows)}`,
  )

  if (dataRows <= 0) {
    bgmLog(LOG_LEVELS.WARN, '[cleanLockedDataSheet] 无数据行，终止')
    showToast('无数据行', 'info')
    return
  }

  // ========== 1. 只读需要的 3 列（三次小范围 COM 调用，安全不卡死） ==========
  const nameData = readRangeValues(ws, headerRow + 1, lastRow, nameCol, nameCol)
  if (nameData.length === 0) {
    bgmLog(LOG_LEVELS.WARN, '[cleanLockedDataSheet] 未读取到名称列数据，终止')
    showToast('未读取到数据', 'error')
    return
  }
  const urlData = readRangeValues(ws, headerRow + 1, lastRow, urlCol, urlCol)
  const tagsData = tagsCol ? readRangeValues(ws, headerRow + 1, lastRow, tagsCol, tagsCol) : null

  const totalRows = nameData.length
  bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 数据读取完成: ${String(totalRows)} 行`)

  // ========== 2. 按名称分组（纯内存操作） ==========
  const nameRows = new Map<string, number[]>()
  let emptyNameCount = 0
  for (let index = 0; index < totalRows; index += 1) {
    const row = headerRow + 1 + index
    const name = (nameData[index]?.[0] ?? '').trim()
    if (name) {
      const rows = nameRows.get(name) ?? []
      rows.push(row)
      nameRows.set(name, rows)
    } else {
      emptyNameCount += 1
    }
  }
  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanLockedDataSheet] 名称扫描完成: 有效名称=${String(nameRows.size)}个, 空名称行=${String(emptyNameCount)}行`,
  )

  // ========== 3. 处理重复行 ==========
  const toDelete: number[] = []
  let mergedTagsCount = 0
  let duplicateNameCount = 0
  const mergedTagEntries: string[] = []
  const duplicateDetails: { name: string; rows: number[]; keep: number[]; del: number[] }[] = []
  const skippedNoUrl: string[] = []

  for (const [name, rows] of nameRows) {
    const hasDuplicates = rows.length > 1
    if (hasDuplicates) {
      const withUrl: number[] = []
      const withoutUrl: number[] = []
      for (const row of rows) {
        const index = row - headerRow - 1
        const url = index < urlData.length ? (urlData[index]?.[0] ?? '').trim() : ''
        ;(url ? withUrl : withoutUrl).push(row)
      }

      const keepRow = withUrl[0]
      if (keepRow === undefined) {
        skippedNoUrl.push(name)
      } else {
        duplicateNameCount += 1
        duplicateDetails.push({ name, rows, keep: withUrl, del: withoutUrl })

        const nameNewTags: string[] = []
        if (tagsData && withoutUrl.length > 0) {
          const keepIndex = keepRow - headerRow - 1
          const existingSet = new Set(
            (keepIndex < tagsData.length ? (tagsData[keepIndex]?.[0] ?? '') : '')
              .split(/\s*\|\s*/)
              .map((t) => t.trim())
              .filter(Boolean),
          )

          for (const delRow of withoutUrl) {
            const delIndex = delRow - headerRow - 1
            const delTags = delIndex < tagsData.length ? (tagsData[delIndex]?.[0] ?? '').trim() : ''
            if (delTags) {
              for (const t of delTags.split(/\s*\|\s*/)) {
                const trimmed = t.trim()
                if (trimmed && !existingSet.has(trimmed)) {
                  nameNewTags.push(trimmed)
                  existingSet.add(trimmed)
                }
              }
            }
          }

          if (tagsCol !== undefined && nameNewTags.length > 0) {
            const mergedTags = [...existingSet].join(' | ')
            setCellValue(ws, keepRow, tagsCol, mergedTags)
            mergedTagsCount += 1
            mergedTagEntries.push(`${name}: ${nameNewTags.join(' | ')}`)
          }
        }

        for (const delRow of withoutUrl) {
          toDelete.push(delRow)
        }
      }
    }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanLockedDataSheet] 统计: 重复名称=${String(duplicateNameCount)}个, 待删除行=${String(toDelete.length)}, 合并标签组=${String(mergedTagsCount)}`,
  )

  if (duplicateDetails.length > 0) {
    const lines = duplicateDetails.map(
      (d) =>
        `  "${d.name}": ${String(d.keep.length)}条含URL(行${d.keep.join(',')}), ${String(d.del.length)}条无URL(行${d.del.join(',')})`,
    )
    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 重复名称详情:\n${lines.join('\n')}`)
  }
  if (skippedNoUrl.length > 0) {
    bgmLog(
      LOG_LEVELS.INFO,
      `[cleanLockedDataSheet] 因全无URL而跳过的名称: ${skippedNoUrl.join(', ')}`,
    )
  }

  if (toDelete.length === 0) {
    bgmLog(
      LOG_LEVELS.INFO,
      `[cleanLockedDataSheet] 未发现需清洗的重复数据，耗时: ${String(Date.now() - startTime)}ms`,
    )
    showToast('未发现需清洗的重复数据', 'info')
    return
  }

  // ========== 4. 批量删除行（合并连续行为范围删除） ==========
  toDelete.sort((a, b) => b - a)
  bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 开始删除 ${String(toDelete.length)} 行...`)
  let removalCallCount = 0
  let index = 0
  while (index < toDelete.length) {
    let index_ = index
    while (
      index_ + 1 < toDelete.length &&
      (toDelete[index_] ?? 0) - (toDelete[index_ + 1] ?? 0) === 1
    ) {
      index_ += 1
    }
    if (index === index_) {
      ws.Range(`${String(toDelete[index] ?? '')}:${String(toDelete[index] ?? '')}`).Delete()
    } else {
      ws.Range(`${String(toDelete[index_] ?? '')}:${String(toDelete[index] ?? '')}`).Delete()
    }
    removalCallCount += 1
    index = index_ + 1
  }
  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanLockedDataSheet] 删除行: ${String(toDelete.length)}行, 实际COM调用: ${String(removalCallCount)}次`,
  )

  const mergedSummary = mergedTagEntries.length > 0 ? `\n  ${mergedTagEntries.join('\n  ')}` : ''
  bgmLog(
    LOG_LEVELS.INFO,
    `[cleanLockedDataSheet] ======== 清洗完成: 删除 ${String(toDelete.length)} 行${tagsCol ? `，合并 ${String(mergedTagsCount)} 个名称组的标签` : ''}，耗时: ${String(Date.now() - startTime)}ms ========`,
  )
  if (mergedSummary)
    bgmLog(LOG_LEVELS.INFO, `[cleanLockedDataSheet] 实际合并的标签:\n${mergedSummary}`)
  showToast(
    `清洗完成：删除 ${String(toDelete.length)} 行${tagsCol ? `，合并 ${String(mergedTagsCount)} 个名称组的标签` : ''}`,
    'success',
  )
}
