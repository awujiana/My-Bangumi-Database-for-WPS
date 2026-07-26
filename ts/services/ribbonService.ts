// ts/services/ribbonService.ts
import {
  getApp,
  bgmLog,
  BGM,
  wpsMsgBox,
  loadBgToken,
  storeBgToken,
  copyTokenToClipboard,
  getDataSheet,
  findHeaderRow,
  getLastRow,
  getColumnMap,
  extractSubjectId,
  mapWatchStatus,
  getCellValue,
  readRangeValues,
  getFilterStatus,
  BGM_COLOR,
  LOG_LEVELS,
  SyncToBangumiAsync,
  _getBgmUserId,
  testTokenValidityForRibbon,
  fetchAllUserCollections,
  type WpsRange,
  type WpsWorksheet,
  getCell,
  trim,
  calcFingerprint,
  syncFromGithub,
  isGithubConfigComplete,
  getSyncStrategy,
  SYNC_STRATEGY_LABELS,
  type GithubSyncResult,
  type SyncStrategy,
  type GithubRemoteEntry,
  type LocalRowEntry,
} from '../index.js'
import { undoLastSync, getLastSessionDescription } from '../sync/undoStack.js'

// ========== GitHub 同步冲突解决类型 ==========

/**
 * 单条字段级冲突描述
 *
 * 用于 GitHub 同步流程中，远程条目与本地 Excel 行在同一字段上取值不同时记录。
 */
export interface Conflict {
  /** Bangumi subject ID（主键） */
  sid: string
  /** 冲突字段名（如 '打分', '名称', '是否看完'） */
  field: string
  /** 本地值（字符串形式，便于直接渲染） */
  localValue: string
  /** 远程值（字符串形式，便于直接渲染） */
  remoteValue: string
  /** 本地行号（用于定位 Excel 行） */
  localRow: number
}

/**
 * 用户对单条冲突的解决决策
 *
 * chosenValue 为 'local' 时表示保留本地值（从 diff.changedFields 中移除该字段）；
 * 为 'remote' 时表示采用远程值（保留该字段在 diff.changedFields 中）。
 */
export interface ConflictResolution {
  /** Bangumi subject ID（主键） */
  sid: string
  /** 冲突字段名（与 Conflict.field 对应） */
  field: string
  /** 用户选择的值来源 */
  chosenValue: 'local' | 'remote'
}

/**
 * 字段比对配置：远程字段 → 本地字段名 + 字符串化函数
 *
 * 将 GithubRemoteEntry 的各字段统一映射为字符串形式后与本地 fields 比对。
 */
interface FieldCompareSpec {
  /** 本地字段名（与 LocalRowEntry.fields 键一致） */
  localField: string
  /** 远程字段值字符串化（undefined → '' 表示无远程值，不视为冲突） */
  remoteToString: (remote: GithubRemoteEntry) => string
}

/** 远程字段比对表（顺序固定，便于稳定测试） */
const GITHUB_CONFLICT_FIELDS: readonly FieldCompareSpec[] = Object.freeze([
  { localField: '名称', remoteToString: (r) => r.name ?? '' },
  { localField: '是否看完', remoteToString: (r) => (r.type !== undefined ? String(r.type) : '') },
  { localField: '打分', remoteToString: (r) => (r.score !== undefined ? String(r.score) : '') },
  {
    localField: '标签/分级',
    remoteToString: (r) => (Array.isArray(r.tags) ? r.tags.join('|') : ''),
  },
  { localField: '集数', remoteToString: (r) => (r.episode !== undefined ? String(r.episode) : '') },
])

/**
 * 检测 GitHub 远程条目与本地 Excel 行之间的字段级冲突
 *
 * 比对规则：
 * - 仅当 SID 同时存在于远程与本地时才可能产生冲突
 * - 仅当远程字段非空（字符串化后非空字符串）且与本地不同时记录为冲突
 * - 远程 type 字段以数值形式与本地「是否看完」文本做字符串比对（调用方负责映射）
 *
 * 注意：本函数为纯函数，不读取 Excel，不发起网络请求，可在 Node 测试环境直接运行。
 *
 * @param remote 远程条目数组
 * @param local 本地条目映射（SID → 行）
 * @returns 冲突列表（按远程数组顺序与字段比对表顺序）
 */
export function detectGithubConflicts(
  remote: GithubRemoteEntry[],
  local: Map<string, LocalRowEntry>,
): Conflict[] {
  const conflicts: Conflict[] = []

  for (const entry of remote) {
    if (!entry.sid) continue
    const localEntry = local.get(entry.sid)
    if (!localEntry) continue

    for (const spec of GITHUB_CONFLICT_FIELDS) {
      const remoteValue = spec.remoteToString(entry)
      if (!remoteValue) continue // 远程无值，不视为冲突
      const localValue = localEntry.fields[spec.localField] ?? ''
      if (remoteValue !== localValue) {
        conflicts.push({
          sid: entry.sid,
          field: spec.localField,
          localValue,
          remoteValue,
          localRow: localEntry.row,
        })
      }
    }
  }

  return conflicts
}

/**
 * 获取同步预览统计（不发送请求，仅扫描 Excel）
 * @param ws 工作表对象
 * @param colMap 列映射
 * @param lastRow 数据最后一行
 * @param headerRow 表头行
 * @param options 可选参数 { incremental: boolean }
 * @returns 统计信息 { total, valid, willSync, willSkip, alreadyUploaded, noUrl, emptyStatus }
 */
export function getSyncPreview(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  lastRow: number,
  headerRow: number,
  options?: { incremental?: boolean; fingerprintMap?: Map<string, string> },
): {
  total: number
  valid: number
  willSync: number
  willSkip: number
  alreadyUploaded: number
  noUrl: number
  emptyStatus: number
  incrementalSkipped: number
} {
  const startRow = headerRow + 1
  let total = 0,
    valid = 0,
    willSync = 0,
    willSkip = 0,
    alreadyUploaded = 0,
    noUrl = 0,
    emptyStatus = 0,
    incrementalSkipped = 0
  const isIncremental = options?.incremental
  const fingerprintMap = options?.fingerprintMap

  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] ========== 数据预览统计开始 ==========`)
  bgmLog(
    LOG_LEVELS.INFO,
    `[getSyncPreview] 起始行: ${startRow}, 最后行: ${lastRow}, 总行数: ${lastRow - startRow + 1}`,
  )
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 增量同步: ${isIncremental ? '开启' : '关闭'}`)

  // 批量读取（与同步函数相同的列范围）
  const neededKeys = [
    'Bangumi_URL',
    '名称',
    '是否看完',
    '打分',
    '标签/分级',
    '原作标签',
    '剧透/感言',
    '集数',
    '集号',
  ]
  let maxCol = 1
  for (const key of neededKeys) {
    if (colMap.has(key)) maxCol = Math.max(maxCol, colMap.get(key)!)
  }
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 最大列号: ${maxCol}`)

  const allData = readRangeValues(ws, startRow, lastRow, 1, maxCol)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 批量读取数据: ${allData?.length || 0} 行`)

  // 获取可见行（与同步函数相同）
  const filterStatus = getFilterStatus(ws, lastRow, headerRow, true)
  bgmLog(
    LOG_LEVELS.INFO,
    `[getSyncPreview] 筛选检测结果: hasFilter=${filterStatus.hasFilter}, visibleRows=${filterStatus.visibleRows.length}`,
  )

  let rowsToProcess: number[] = []
  if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
    rowsToProcess = filterStatus.visibleRows.filter((r) => r >= startRow)
    bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 筛选模式: ${rowsToProcess.length} 行可见`)
  } else {
    for (let r = startRow; r <= lastRow; r++) rowsToProcess.push(r)
    bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 全量模式: ${rowsToProcess.length} 行`)
  }

  const getField = (rowNum: number, key: string): string => {
    if (allData) {
      const col = colMap.get(key)
      if (!col) return ''
      const rowIdx = rowNum - startRow
      if (rowIdx >= 0 && rowIdx < allData.length) {
        const rowData = allData[rowIdx]
        if (Array.isArray(rowData) && col - 1 < rowData.length) {
          return trim(rowData[col - 1])
        }
      }
    }
    return colMap.has(key) ? trim(getCellValue(ws, rowNum, colMap.get(key)!)) : ''
  }

  for (const rowNum of rowsToProcess) {
    total++
    const bgmUrl = getField(rowNum, 'Bangumi_URL')

    if (!bgmUrl || !extractSubjectId(bgmUrl)) {
      noUrl++
      continue // 无效行不计入 valid
    }
    valid++

    // 检查是否已上传（序列号列颜色）
    const seqCol = colMap.get('序列号') || 4
    const seqCell = getCell(ws, rowNum, seqCol) as WpsRange | null
    const isUploaded =
      seqCell?.Interior &&
      (seqCell.Interior.Color === BGM_COLOR.SUCCESS ||
        seqCell.Interior.Color === BGM_COLOR.LIGHT_GREEN ||
        seqCell.Interior.Color === BGM_COLOR.DARK_GREEN)
    if (isUploaded) {
      alreadyUploaded++
      if (isIncremental) {
        // 增量模式：已上传且指纹匹配则跳过
        const sid = extractSubjectId(bgmUrl)
        if (sid && fingerprintMap) {
          const currentFingerprint = calcFingerprint([
            getField(rowNum, '名称'),
            mapWatchStatus(
              getField(rowNum, '是否看完') ||
                getField(rowNum, '状态') ||
                getField(rowNum, '观看状态'),
            ).toString(),
            getField(rowNum, '打分'),
            getField(rowNum, '标签/分级'),
            getField(rowNum, '原作标签'),
            getField(rowNum, '剧透/感言'),
            getField(rowNum, '集数'),
            getField(rowNum, '集号'),
          ])
          if (fingerprintMap.get(sid) === currentFingerprint) {
            incrementalSkipped++
            continue
          }
        }
      } else {
        continue // 非增量模式：已上传跳过
      }
    }

    // 判断观看状态
    const watchStatus =
      getField(rowNum, '是否看完') || getField(rowNum, '状态') || getField(rowNum, '观看状态')

    // 空状态不计入待同步，跳过该条目
    if (!watchStatus) {
      emptyStatus++
      continue
    }

    const type = mapWatchStatus(watchStatus)
    if (type === 0) {
      willSkip++
    } else {
      // 增量模式：检查指纹是否匹配
      if (isIncremental && fingerprintMap) {
        const sid = extractSubjectId(bgmUrl)
        if (sid) {
          const currentFingerprint = calcFingerprint([
            getField(rowNum, '名称'),
            type.toString(),
            getField(rowNum, '打分'),
            getField(rowNum, '标签/分级'),
            getField(rowNum, '原作标签'),
            getField(rowNum, '剧透/感言'),
            getField(rowNum, '集数'),
            getField(rowNum, '集号'),
          ])
          if (fingerprintMap.get(sid) === currentFingerprint) {
            incrementalSkipped++
            continue
          }
        }
      }
      willSync++
    }
  }

  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] ========== 数据预览统计结果 ==========`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 总行数: ${total}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 有效行数: ${valid}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 待同步行数: ${willSync}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 跳过期数: ${willSkip}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 已上传行数: ${alreadyUploaded}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 无URL行数: ${noUrl}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 空状态行数: ${emptyStatus}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 增量跳过行数: ${incrementalSkipped}`)

  return {
    total,
    valid,
    willSync,
    willSkip,
    alreadyUploaded,
    noUrl,
    emptyStatus,
    incrementalSkipped,
  }
}

/** Bangumi 收藏条目（用于冲突检测的本地缓存） */
interface BgmCollectionEntry {
  type: number
  rate?: number
  tags: string[]
  comment: string
  subject_name: string
}

/**
 * 异步检测 Excel 与 Bangumi 收藏之间的冲突
 * @returns 包含冲突条目列表及统计信息的对象
 */
export async function detectConflicts(
  ws: WpsWorksheet,
  colMap: Map<string, number>,
  lastRow: number,
  headerRow: number,
  token: string,
): Promise<{
  conflicts: Array<{
    row: number
    sid: string
    name: string
    existingType?: number
    newType: number
  }>
  conflictCount: number
  bgmCollectionReady: boolean
}> {
  const startRow = headerRow + 1
  const conflicts: Array<{
    row: number
    sid: string
    name: string
    existingType?: number
    newType: number
  }> = []
  let conflictCount = 0
  let bgmCollectionReady = false

  // 1. 获取 Bangumi 收藏快照
  const bgmCollection = new Map<string, BgmCollectionEntry>()
  try {
    const collections = await fetchAllUserCollections(token)
    for (const item of collections) {
      const sid = String(item.subject_id)
      bgmCollection.set(sid, {
        type: item.type,
        ...(item.rate !== undefined && { rate: item.rate }),
        tags: item.tags || [],
        comment: item.comment || '',
        subject_name: item.subject?.name || '',
      })
    }
    bgmCollectionReady = true
  } catch (e: unknown) {
    BGM.handleError(e, { context: 'detectConflicts', showAlert: false })
    // 获取失败时，返回空冲突信息
    return { conflicts, conflictCount, bgmCollectionReady }
  }

  // 2. 遍历 Excel 可见行，比对差异
  const filterStatus = getFilterStatus(ws, lastRow, headerRow, true)
  bgmLog(
    LOG_LEVELS.INFO,
    `[detectConflicts] 筛选检测结果: hasFilter=${filterStatus.hasFilter}, visibleRows=${filterStatus.visibleRows.length}`,
  )

  let rowsToProcess: number[] = []
  if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
    rowsToProcess = filterStatus.visibleRows.filter((r) => r >= startRow)
    bgmLog(LOG_LEVELS.INFO, `[detectConflicts] 筛选模式: ${rowsToProcess.length} 行可见`)
  } else {
    for (let r = startRow; r <= lastRow; r++) rowsToProcess.push(r)
    bgmLog(LOG_LEVELS.INFO, `[detectConflicts] 全量模式: ${rowsToProcess.length} 行`)
  }

  const getField = (row: number, key: string): string => {
    if (colMap.has(key)) return trim(getCellValue(ws, row, colMap.get(key)!))
    return ''
  }

  for (const rowNum of rowsToProcess) {
    const bgmUrl = getField(rowNum, 'Bangumi_URL')
    if (!bgmUrl) continue
    const sid = extractSubjectId(bgmUrl)
    if (!sid) continue

    const bgmEntry = bgmCollection.get(sid)
    if (!bgmEntry) continue // 无对应收藏，不视为冲突

    // 构建 Excel 的 payload
    const excelType = mapWatchStatus(getField(rowNum, '是否看完'))
    if (excelType === 0) continue // 不上传，不参与冲突

    // 对比 type 字段
    if (bgmEntry.type !== undefined && Number(bgmEntry.type) !== excelType) {
      conflicts.push({
        row: rowNum,
        sid,
        name: getField(rowNum, '名称') || '',
        existingType: Number(bgmEntry.type),
        newType: excelType,
      })
      conflictCount++
    }
    // 可扩展对比 rate、tags、comment 等字段
  }

  return { conflicts, conflictCount, bgmCollectionReady }
}

/**
 * Ribbon 专用的完整同步流程：预览 → 冲突检测 → 确认 → 执行
 * @param conflictResolution 冲突处理策略，默认 'excel'（覆盖）
 */
export async function syncWithConfirmation(): Promise<void> {
  const app = getApp()
  const ws = getDataSheet()
  if (!ws) {
    wpsMsgBox('未找到数据工作表', 0, 64)
    return
  }
  if (BGM.sync.isRunning) {
    wpsMsgBox('同步正在进行中，请稍后再试', 0, 48)
    return
  }
  const token = loadBgToken()
  if (!token) {
    wpsMsgBox('请先设置 Token', 0, 48)
    return
  }

  const headerRow = findHeaderRow(ws) || 1
  const lastRow = getLastRow(ws)
  const colMap = getColumnMap(ws, headerRow)
  if (!colMap.has('Bangumi_URL')) {
    wpsMsgBox('未找到 Bangumi URL 列', 0, 48)
    return
  }

  // 1. 预览统计
  const preview = getSyncPreview(ws, colMap, lastRow, headerRow)

  // 2. 读取 Ribbon 复选框状态（冲突策略 + 增量同步）
  let conflictStrategy: 'excel' | 'skip' = 'excel'
  let incremental = false
  try {
    if (app?.PluginStorage) {
      const skipConflicts = app.PluginStorage.getItem('bgm_skip_conflicts')
      if (skipConflicts === 'true') {
        conflictStrategy = 'skip'
      }
      const incr = app.PluginStorage.getItem('bgm_incremental_sync')
      if (incr === 'true') {
        incremental = true
      }
    }
  } catch (e: unknown) {
    BGM.handleError(e, { context: 'syncWithConfirmation:readRibbonOptions', showAlert: false })
  }

  // 3. 先弹确认框（让用户立刻看到反馈，避免冲突检测网络等待期间"无反应"）
  const confirmMsg = `即将开始全面同步

数据预览：
  总行数：${preview.total}
  有效条目：${preview.valid}
  已上传（跳过）：${preview.alreadyUploaded}
  待同步：${preview.willSync}
  不上传（状态跳过）：${preview.willSkip}
  无效（无SID）：${preview.total - preview.valid}

冲突策略：${conflictStrategy === 'skip' ? '跳过冲突' : 'Excel数据覆盖'}
增量同步：${incremental ? '开启' : '关闭'}

点击"是"开始同步，点击"否"取消。`
  const confirmResult = app?.MessageBox?.(confirmMsg, 4 + 32)
  if (confirmResult !== 6) return

  // 4. 冲突检测（用户确认后执行，网络不通时会被 try/catch 捕获并跳过）
  let skipSids: Set<string> | undefined = undefined
  try {
    bgmLog(LOG_LEVELS.INFO, '[syncWithConfirmation] 开始冲突检测（需要请求 Bangumi API）...')
    const { conflicts, conflictCount } = await detectConflicts(
      ws,
      colMap,
      lastRow,
      headerRow,
      token,
    )
    if (conflictCount > 0) {
      if (conflictStrategy === 'skip') {
        skipSids = new Set(conflicts.map((c) => c.sid))
      }
    }
    bgmLog(LOG_LEVELS.INFO, `[syncWithConfirmation] 冲突检测完成: ${conflictCount} 条冲突`)
  } catch (e: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[syncWithConfirmation] 冲突检测失败（可能网络不通），已跳过: ${(e as Error)?.message}`,
    )
    BGM.handleError(e, { context: 'syncWithConfirmation:conflictDetection', showAlert: false })
  }

  // 5. 执行同步（传入跳过冲突集合和增量同步开关）
  if (!BGM.sync.enterRunningState()) {
    wpsMsgBox('同步正在进行中，请稍后再试', 0, 48)
    return
  }
  try {
    bgmLog(LOG_LEVELS.INFO, '[syncWithConfirmation] 开始执行同步...')
    const result = await SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, {
      ...(skipSids !== undefined && { skipSids }),
      incremental,
      onProgress: (current, total, message) => {
        if (app?.StatusBar !== undefined) app.StatusBar = `[${current}/${total}] ${message}`
      },
    })
    if (app) app.StatusBar = false
    BGM.sync.exitRunningState()
    app?.MessageBox?.(
      `同步完成！\n成功: ${result.success} 条\n失败: ${result.fail} 条\n跳过: ${result.skip} 条`,
      0,
      64,
    )
  } catch (err: unknown) {
    if (app) app.StatusBar = false
    BGM.sync.exitRunningState()
    BGM.handleError(err, { context: 'Ribbon同步', showAlert: true })
  }
}

/** 设置 Token（Ribbon 版本） */
export async function setTokenForRibbon(): Promise<boolean> {
  const currentToken = loadBgToken() || ''
  const app = getApp()
  const newToken = app?.InputBox?.('请输入 Access Token', '设置 Token', currentToken, 2)
  if (newToken && typeof newToken === 'string') {
    const saved = storeBgToken(newToken)
    if (saved) {
      bgmLog(LOG_LEVELS.INFO, 'Token 已保存，通知面板更新...')
      BGM.notifyTokenUpdated()

      // 通知面板刷新状态
      notifyPanelTokenUpdated()

      if (typeof testTokenValidityForRibbon === 'function') {
        testTokenValidityForRibbon(newToken)
      }
      return true
    } else {
      app?.MessageBox?.('Token 保存失败，请检查插件存储权限', 0, 16)
    }
  }
  return false
}

/**
 * 通知面板 Token 已更新
 * 通过 postMessage 跨域通信
 */
function notifyPanelTokenUpdated(): void {
  try {
    // 触发事件总线（供面板内的事件监听器使用）
    BGM.notifyTokenUpdated()

    bgmLog(LOG_LEVELS.INFO, '已发送 Token 更新通知')
  } catch (e: unknown) {
    BGM.handleError(new Error('通知面板失败', { cause: e }), { showAlert: false })
  }
}

/** 测试 Token（Ribbon 版本） */
export function testTokenForRibbon(): void {
  const token = loadBgToken()
  if (token) {
    testTokenValidityForRibbon(token)
    BGM.notifyTokenUpdated()
  } else {
    getApp()?.MessageBox?.('请先设置 Token！', 0, 48)
  }
}

/** 复制 Token 到剪贴板（Ribbon 版本） */
export function copyTokenForRibbon(): void {
  const ok = copyTokenToClipboard()
  if (ok) {
    wpsMsgBox('Token 已复制到剪贴板', 0, 64)
  } else {
    wpsMsgBox('复制失败，可能未设置 Token', 0, 48)
  }
}

/** 设置用户 ID（Ribbon 版本） */
export function setUserIdForRibbon(): void {
  const app = getApp()
  const userId = app?.InputBox?.('请输入用户 ID（数字）', '设置用户 ID', '', 2)
  if (userId && typeof userId === 'string') {
    const userIdStr = String(userId).trim()
    BGM.setUserId(userIdStr)
    bgmLog(LOG_LEVELS.INFO, `[setUserIdForRibbon] 用户ID已设置: ${userIdStr}`)

    app?.MessageBox?.('用户 ID 已保存', 0, 64)
  }
}

/** 打开收藏页面（Ribbon 版本） */
export function openCollectionForRibbon(): void {
  const startTime = Date.now()
  bgmLog(LOG_LEVELS.INFO, '[openCollectionForRibbon] ========== Ribbon 打开收藏页面 ==========')

  const app = getApp()
  if (!app) {
    bgmLog(LOG_LEVELS.ERROR, '[openCollectionForRibbon] 无法获取 Application 对象')
    return
  }

  const userId = _getBgmUserId()
  bgmLog(LOG_LEVELS.INFO, `[openCollectionForRibbon] 获取用户ID: ${userId || '(未设置)'}`)

  if (!userId) {
    bgmLog(LOG_LEVELS.ERROR, '[openCollectionForRibbon] 用户ID未设置')
    app.MessageBox?.('请先设置用户ID！', 0, 48)
    return
  }

  const collectionUrl = `https://bgm.tv/user/${userId}/collection`
  bgmLog(LOG_LEVELS.INFO, `[openCollectionForRibbon] 打开收藏页面: ${collectionUrl}`)
  window.open(collectionUrl, '_blank')
  bgmLog(LOG_LEVELS.INFO, `[openCollectionForRibbon] 完成，耗时: ${Date.now() - startTime}ms`)
}

/**
 * 从 GitHub 仓库增量同步数据到本地 Excel（Ribbon 入口）
 *
 * 流程：
 * 1. 校验 GitHub 配置是否完整（owner/repo/path）
 * 2. 读取已保存的同步策略
 * 3. 用户确认对话框（提示当前策略）
 * 4. 调用 syncFromGithub 执行下载、diff、应用
 * 5. 显示结果统计
 *
 * @returns 同步结果统计，失败时返回 null
 */
export async function syncFromGithubForRibbon(): Promise<GithubSyncResult | null> {
  const startTime = Date.now()
  bgmLog(LOG_LEVELS.INFO, '[syncFromGithubForRibbon] ========== Ribbon GitHub 同步 ==========')

  // 1. 配置校验
  if (!isGithubConfigComplete()) {
    bgmLog(LOG_LEVELS.ERROR, '[syncFromGithubForRibbon] GitHub 仓库配置不完整')
    await wpsMsgBox('GitHub 仓库配置不完整，请先在面板中设置 owner/repo/path', 0, 48)
    return null
  }

  // 2. 读取策略
  const strategy: SyncStrategy = getSyncStrategy()
  const strategyLabel = SYNC_STRATEGY_LABELS[strategy]
  bgmLog(LOG_LEVELS.INFO, `[syncFromGithubForRibbon] 同步策略: ${strategy} (${strategyLabel})`)

  // 3. 用户确认
  const confirmed = await wpsMsgBox(
    `将从 GitHub 仓库下载 JSON 并按策略【${strategyLabel}】合并到当前工作表。\n是否继续？`,
    4, // MB_YESNO
    32, // MB_ICONQUESTION
  )
  if (confirmed !== 6) {
    bgmLog(LOG_LEVELS.INFO, '[syncFromGithubForRibbon] 用户取消同步')
    return null
  }

  // 4. 执行同步
  try {
    const result = await syncFromGithub((current, total, message) => {
      if (total > 0) {
        bgmLog(LOG_LEVELS.INFO, `[syncFromGithubForRibbon] 进度 ${current}/${total}: ${message}`)
      }
    }, strategy)
    bgmLog(
      LOG_LEVELS.INFO,
      `[syncFromGithubForRibbon] 完成：远程 ${result.remoteTotal}，新增 ${result.added}，更新 ${result.updated}，删除 ${result.deleted}，失败 ${result.failed}，耗时 ${Date.now() - startTime}ms`,
    )

    // 5. 结果提示
    const summary =
      `GitHub 同步完成（策略：${strategyLabel}）\n\n` +
      `远程条目: ${result.remoteTotal}\n` +
      `新增: ${result.added}\n` +
      `更新: ${result.updated}\n` +
      `删除: ${result.deleted}\n` +
      `无变更: ${result.unchanged}\n` +
      `失败: ${result.failed}`
    await wpsMsgBox(summary, 0, result.failed > 0 ? 48 : 64)
    return result
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e)
    bgmLog(LOG_LEVELS.ERROR, `[syncFromGithubForRibbon] 同步失败: ${errMsg}`)
    await wpsMsgBox(`GitHub 同步失败：${errMsg}`, 0, 16)
    return null
  }
}

/**
 * 撤销最近一次 GitHub 同步操作（Ribbon 入口）
 *
 * 流程：
 * 1. 读取最近一次同步会话描述；若栈为空，提示无可撤销操作
 * 2. 弹确认对话框，提示用户即将撤销的会话描述
 * 3. 调用 undoLastSync 按单元格逆序恢复
 * 4. 显示恢复条目数
 */
export async function undoLastSyncForRibbon(): Promise<void> {
  bgmLog(LOG_LEVELS.INFO, '[undoLastSyncForRibbon] ========== Ribbon 撤销最近同步 ==========')

  const description = getLastSessionDescription()
  if (!description) {
    bgmLog(LOG_LEVELS.INFO, '[undoLastSyncForRibbon] 没有可撤销的同步操作')
    await wpsMsgBox('没有可撤销的同步操作', 0, 48)
    return
  }

  const confirmed = await wpsMsgBox(
    `确认撤销最近一次同步操作？\n\n${description}\n\n将按单元格逆序恢复旧值。`,
    4, // MB_YESNO
    32, // MB_ICONQUESTION
  )
  if (confirmed !== 6) {
    bgmLog(LOG_LEVELS.INFO, '[undoLastSyncForRibbon] 用户取消撤销')
    return
  }

  try {
    const restored = undoLastSync()
    bgmLog(LOG_LEVELS.INFO, `[undoLastSyncForRibbon] 已恢复 ${restored} 项变更`)
    await wpsMsgBox(`已撤销 ${restored} 项变更`, 0, 64)
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e)
    bgmLog(LOG_LEVELS.ERROR, `[undoLastSyncForRibbon] 撤销失败: ${errMsg}`)
    await wpsMsgBox(`撤销失败：${errMsg}`, 0, 16)
  }
}
