// ts/services/ribbonService.ts
import {
  getApp,
  bgmLog,
  BGM,
  wpsMsgBox,
  loadBgToken,
  storeBgToken,
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
  _setBgmUserId,
  _setBgmUsername,
  testTokenValidityForRibbon,
  fetchAllUserCollections,
  getCell,
  trim,
  calcFingerprint,
  isGithubConfigComplete,
} from '../index.js'
import type { WpsWorksheet, GithubSyncResult, GithubRemoteEntry, LocalRowEntry } from '../index.js'
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
export { type ConflictResolution } from '../sync/githubSyncDiff.js'

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
  {
    localField: '标签/分级',
    remoteToString: (r) => (Array.isArray(r.meta_tags) ? r.meta_tags.join('|') : ''),
  },
  { localField: '集数', remoteToString: (r) => r['话数'] ?? '' },
])

/**
 * 检测 GitHub 远程条目与本地 Excel 行之间的字段级冲突
 *
 * 比对规则：
 * - 仅当 SID 同时存在于远程与本地时才可能产生冲突
 * - 仅当远程字段非空（字符串化后非空字符串）且与本地不同时记录为冲突
 * - 「是否看完」为用户本地字段，远程数据不含此字段，不参与冲突比对
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
  let total = 0
  let valid = 0
  let willSync = 0
  let willSkip = 0
  let alreadyUploaded = 0
  let noUrl = 0
  let emptyStatus = 0
  let incrementalSkipped = 0
  const isIncremental = options?.incremental
  const fingerprintMap = options?.fingerprintMap

  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] ========== 数据预览统计开始 ==========`)
  bgmLog(
    LOG_LEVELS.INFO,
    `[getSyncPreview] 起始行: ${String(startRow)}, 最后行: ${String(lastRow)}, 总行数: ${String(lastRow - startRow + 1)}`,
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
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 最大列号: ${String(maxCol)}`)

  const allData = readRangeValues(ws, startRow, lastRow, 1, maxCol)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 批量读取数据: ${String(allData.length || 0)} 行`)

  // 获取可见行（与同步函数相同）
  const filterStatus = getFilterStatus(ws, lastRow, headerRow, true)
  bgmLog(
    LOG_LEVELS.INFO,
    `[getSyncPreview] 筛选检测结果: hasFilter=${String(filterStatus.hasFilter)}, visibleRows=${String(filterStatus.visibleRows.length)}`,
  )

  let rowsToProcess: number[] = []
  if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
    rowsToProcess = filterStatus.visibleRows.filter((r) => r >= startRow)
    bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 筛选模式: ${String(rowsToProcess.length)} 行可见`)
  } else {
    for (let r = startRow; r <= lastRow; r++) rowsToProcess.push(r)
    bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 全量模式: ${String(rowsToProcess.length)} 行`)
  }

  const getField = (rowNum: number, key: string): string => {
    const col = colMap.get(key)
    if (!col) return ''
    const rowIdx = rowNum - startRow
    if (rowIdx >= 0 && rowIdx < allData.length) {
      const rowData = allData[rowIdx]
      if (Array.isArray(rowData) && col - 1 < rowData.length) {
        return trim(rowData[col - 1])
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
    const seqCell = getCell(ws, rowNum, seqCol)
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
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 总行数: ${String(total)}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 有效行数: ${String(valid)}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 待同步行数: ${String(willSync)}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 跳过期数: ${String(willSkip)}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 已上传行数: ${String(alreadyUploaded)}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 无URL行数: ${String(noUrl)}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 空状态行数: ${String(emptyStatus)}`)
  bgmLog(LOG_LEVELS.INFO, `[getSyncPreview] 增量跳过行数: ${String(incrementalSkipped)}`)

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
  conflicts: {
    row: number
    sid: string
    name: string
    existingType?: number
    newType: number
  }[]
  conflictCount: number
  bgmCollectionReady: boolean
}> {
  const startRow = headerRow + 1
  const conflicts: {
    row: number
    sid: string
    name: string
    existingType?: number
    newType: number
  }[] = []
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
    `[detectConflicts] 筛选检测结果: hasFilter=${String(filterStatus.hasFilter)}, visibleRows=${String(filterStatus.visibleRows.length)}`,
  )

  let rowsToProcess: number[] = []
  if (filterStatus.hasFilter && filterStatus.visibleRows.length > 0) {
    rowsToProcess = filterStatus.visibleRows.filter((r) => r >= startRow)
    bgmLog(LOG_LEVELS.INFO, `[detectConflicts] 筛选模式: ${String(rowsToProcess.length)} 行可见`)
  } else {
    for (let r = startRow; r <= lastRow; r++) rowsToProcess.push(r)
    bgmLog(LOG_LEVELS.INFO, `[detectConflicts] 全量模式: ${String(rowsToProcess.length)} 行`)
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
    if (bgmEntry.type !== excelType) {
      conflicts.push({
        row: rowNum,
        sid,
        name: getField(rowNum, '名称') || '',
        existingType: bgmEntry.type,
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
    void wpsMsgBox('未找到数据工作表', 0, 64)
    return
  }
  if (BGM.sync.isRunning) {
    void wpsMsgBox('同步正在进行中，请稍后再试', 0, 48)
    return
  }
  const token = loadBgToken()
  if (!token) {
    void wpsMsgBox('请先设置 Token', 0, 48)
    return
  }

  const headerRow = findHeaderRow(ws) || 1
  const lastRow = getLastRow(ws)
  const colMap = getColumnMap(ws, headerRow)
  if (!colMap.has('Bangumi_URL')) {
    void wpsMsgBox('未找到 Bangumi URL 列', 0, 48)
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
  const confirmMsg = `即将开始上传同步（Excel → Bangumi）

数据预览：
  总行数：${String(preview.total)}
  有效条目：${String(preview.valid)}
  已上传（跳过）：${String(preview.alreadyUploaded)}
  待同步：${String(preview.willSync)}
  不上传（状态跳过）：${String(preview.willSkip)}
  无效（无SID）：${String(preview.total - preview.valid)}

冲突策略：${conflictStrategy === 'skip' ? '跳过冲突' : 'Excel数据覆盖'}
增量同步：${incremental ? '开启' : '关闭'}

点击"是"开始同步，点击"否"取消。`
  const confirmResult = app?.MessageBox?.(confirmMsg, 4 + 32)
  if (confirmResult !== 6) return

  // 4. 冲突检测（用户确认后执行，网络不通时会被 try/catch 捕获并跳过）
  let skipSids: Set<string> | undefined
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
    bgmLog(LOG_LEVELS.INFO, `[syncWithConfirmation] 冲突检测完成: ${String(conflictCount)} 条冲突`)
  } catch (e: unknown) {
    bgmLog(
      LOG_LEVELS.WARN,
      `[syncWithConfirmation] 冲突检测失败（可能网络不通），已跳过: ${(e as Error).message}`,
    )
    BGM.handleError(e, { context: 'syncWithConfirmation:conflictDetection', showAlert: false })
  }

  // 5. 执行同步（传入跳过冲突集合和增量同步开关）
  if (!BGM.sync.enterRunningState()) {
    void wpsMsgBox('同步正在进行中，请稍后再试', 0, 48)
    return
  }
  try {
    bgmLog(LOG_LEVELS.INFO, '[syncWithConfirmation] 开始执行同步...')
    const result = await SyncToBangumiAsync(ws, colMap, token, lastRow, headerRow, {
      ...(skipSids !== undefined && { skipSids }),
      incremental,
      onProgress: (current, total, message) => {
        if (app?.StatusBar !== undefined)
          app.StatusBar = `[${String(current)}/${String(total)}] ${message}`
      },
    })
    if (app) app.StatusBar = false
    BGM.sync.exitRunningState()
    app?.MessageBox?.(
      `同步完成！\n成功: ${String(result.success)} 条\n失败: ${String(result.fail)} 条\n跳过: ${String(result.skip)} 条`,
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
export function setTokenForRibbon(): boolean {
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
    }
    app?.MessageBox?.('Token 保存失败，请检查插件存储权限', 0, 16)
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

/**
 * 测试 Token（Ribbon 版本）
 *
 * Ribbon 上下文中 index.html 对用户不可见，DOM 弹窗（showAlert/showSuccess）无法展示。
 * 因此本函数使用 wpsMsgBox（带浏览器 alert 兜底）替代 DOM 弹窗进行所有用户交互。
 */
export async function testTokenForRibbon(): Promise<void> {
  const token = loadBgToken()
  if (!token) {
    await wpsMsgBox('请先设置 Token！', 0, 48)
    return
  }

  // Ribbon 上下文：使用 XHR + wpsMsgBox，避免依赖不可见的 DOM 弹窗
  const apiUrl = 'https://api.bgm.tv/v0/me'
  bgmLog(LOG_LEVELS.INFO, `[testTokenForRibbon] 开始测试 Token，API: ${apiUrl}`)

  await new Promise<void>((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', apiUrl, true)
    xhr.timeout = 15_000
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/json')

    xhr.onload = async () => {
      if (xhr.status === 200) {
        try {
          const data = JSON.parse(xhr.responseText) as {
            nickname?: string
            username?: string
            id?: number
          }
          const nickname = data.nickname || data.username || '未知用户'
          const userId = String(data.id || '')
          bgmLog(LOG_LEVELS.INFO, `[testTokenForRibbon] Token 有效，用户: ${nickname} (${userId})`)
          _setBgmUserId(userId)
          _setBgmUsername(nickname)
          BGM.notifyTokenUpdated()
          await wpsMsgBox(`Token 有效！\n用户: ${nickname}\nID: ${userId}`, 0, 64)
        } catch (e: unknown) {
          bgmLog(LOG_LEVELS.ERROR, `[testTokenForRibbon] 解析响应失败: ${(e as Error).message}`)
          await wpsMsgBox('解析响应失败，请重试', 0, 16)
        }
      } else if (xhr.status === 401) {
        bgmLog(LOG_LEVELS.WARN, '[testTokenForRibbon] Token 无效或已过期')
        await wpsMsgBox('Token 无效或已过期，请重新设置', 0, 48)
      } else {
        bgmLog(LOG_LEVELS.ERROR, `[testTokenForRibbon] HTTP ${String(xhr.status)}`)
        await wpsMsgBox(`Token 验证失败 (HTTP ${String(xhr.status)})`, 0, 16)
      }
      resolve()
    }

    xhr.onerror = async () => {
      bgmLog(LOG_LEVELS.ERROR, '[testTokenForRibbon] 网络错误')
      await wpsMsgBox('网络错误，无法连接到 Bangumi API\n可能原因：网络被墙或断网', 0, 16)
      resolve()
    }

    xhr.ontimeout = async () => {
      bgmLog(LOG_LEVELS.WARN, '[testTokenForRibbon] 请求超时（15s）')
      await wpsMsgBox('网络超时，请重试', 0, 48)
      resolve()
    }

    xhr.send()
  })
}

/**
 * 复制 Token 到剪贴板（Ribbon 版本）
 *
 * 使用 wpsMsgBox（带浏览器兜底）显示结果，确保在 Ribbon 和浏览器环境均可见。
 */
export async function copyTokenForRibbon(): Promise<void> {
  const token = loadBgToken()
  if (!token) {
    await wpsMsgBox('未设置 Token，请先设置！', 0, 48)
    return
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = token
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    // execCommand 已废弃（no-deprecated），但 WPS WebView 中 Clipboard API 不可用时需回退使用，
    // 这里以精确类型调用规避废弃标注
    const ok = (
      document as unknown as {
        execCommand: (commandId: string, showUI?: boolean, value?: string) => boolean
      }
    ).execCommand('copy')
    document.body.removeChild(textarea)
    if (ok) {
      bgmLog(LOG_LEVELS.INFO, '[copyTokenForRibbon] Token 已复制到剪贴板')
      await wpsMsgBox('Token 已复制到剪贴板', 0, 64)
    } else {
      bgmLog(LOG_LEVELS.WARN, '[copyTokenForRibbon] execCommand copy 失败')
      await wpsMsgBox('复制失败，浏览器不支持剪贴板操作', 0, 48)
    }
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e)
    bgmLog(LOG_LEVELS.ERROR, `[copyTokenForRibbon] 复制失败: ${errMsg}`)
    await wpsMsgBox(`复制失败: ${errMsg}`, 0, 16)
  }
}

/** 设置用户 ID（Ribbon 版本） */
export function setUserIdForRibbon(): void {
  const app = getApp()
  const userId = app?.InputBox?.('请输入用户 ID（数字）', '设置用户 ID', '', 2)
  if (userId && typeof userId === 'string') {
    const userIdStr = userId.trim()
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
  bgmLog(
    LOG_LEVELS.INFO,
    `[openCollectionForRibbon] 完成，耗时: ${String(Date.now() - startTime)}ms`,
  )
}

/**
 * 从 GitHub 仓库增量同步数据到本地 Excel（Ribbon 入口）
 *
 * 流程：
 * 1. 校验 GitHub 配置是否完整（owner/repo/path）
 * 2. 确保 panel 面板可见（不切换，只显示）
 * 3. 写入 PluginStorage 信号（bgm_request_github_sync = 时间戳）
 *    - panel 通过 userInfoPolling 轮询检测该信号
 *    - 检测到后通过 panel 内部 eventBus 触发 syncFromGithub handler
 *    - panel handler 负责显示确认对话框 + 模块化进度弹窗
 *
 * 跨上下文通信说明：
 * WPS 中 Ribbon 和 Panel 是独立 iframe，eventBus 无法跨上下文通信。
 * 必须通过 PluginStorage 作为中间介质，panel 轮询检测信号变化。
 *
 * @returns 同步结果统计（信号触发模式返回 null，实际结果由 panel handler 处理）
 */
export async function syncFromGithubForRibbon(): Promise<GithubSyncResult | null> {
  bgmLog(LOG_LEVELS.INFO, '[syncFromGithubForRibbon] ========== Ribbon GitHub 同步 ==========')

  // 1. 配置校验
  if (!isGithubConfigComplete()) {
    bgmLog(LOG_LEVELS.ERROR, '[syncFromGithubForRibbon] GitHub 仓库配置不完整')
    await wpsMsgBox('GitHub 仓库配置不完整，请先在面板中设置 owner/repo/path', 0, 48)
    return null
  }

  // 2. 确保 panel 面板可见（不切换隐藏，仅设置为可见）
  ensurePanelVisible()

  // 3. 写入 PluginStorage 信号，panel 轮询检测后触发 syncFromGithub handler
  try {
    const app = getApp()
    if (app?.PluginStorage) {
      app.PluginStorage.setItem('bgm_request_github_sync', String(Date.now()))
      bgmLog(LOG_LEVELS.INFO, '[syncFromGithubForRibbon] 已写入数据同步请求信号到 PluginStorage')
    } else {
      bgmLog(LOG_LEVELS.ERROR, '[syncFromGithubForRibbon] PluginStorage 不可用，无法通知 panel')
      await wpsMsgBox('无法通知任务面板执行同步，请手动在面板中点击「立即同步」', 0, 48)
    }
  } catch (e: unknown) {
    bgmLog(LOG_LEVELS.ERROR, `[syncFromGithubForRibbon] 写入信号失败: ${(e as Error).message}`)
  }

  return null
}

/**
 * 确保 panel 面板可见（不切换，仅显示）
 *
 * 与 showBangumiPanel 的区别：showBangumiPanel 会切换可见性（可见→隐藏），
 * 本函数仅确保面板可见，不会隐藏已显示的面板。
 */
function ensurePanelVisible(): void {
  try {
    const app = getApp() as {
      PluginStorage?: {
        getItem: (k: string) => string | null
        setItem: (k: string, v: string) => void
      }
      GetTaskPane?: (id: string) => { Visible: boolean }
      CreateTaskPane?: (url: string) => { ID: string; Visible: boolean }
    } | null
    if (!app) return

    const tsId = app.PluginStorage?.getItem('panel_id')
    if (!tsId) {
      // 面板未创建，调用 showBangumiPanel 创建并显示
      void import('../index.js').then(({ showBangumiPanel }) => {
        showBangumiPanel()
      })
      return
    }

    const tskpane = app.GetTaskPane?.(tsId)
    if (tskpane && !tskpane.Visible) {
      tskpane.Visible = true
      app.PluginStorage?.setItem('bgm_panel_shown_at', String(Date.now()))
      bgmLog(LOG_LEVELS.INFO, '[ensurePanelVisible] 面板已显示')
    }
  } catch (e: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[ensurePanelVisible] 失败: ${(e as Error).message}`)
  }
}

/**
 * 撤销最近一次 GitHub 同步操作（Ribbon 入口）
 *
 * Ribbon 与 Panel 为独立 iframe，撤销栈仅在 panel 环境中有效。
 * 因此本函数通过 PluginStorage 写入请求信号，交由 panel 轮询后执行实际撤销流程
 *（包含检查会话、确认对话框、恢复操作、结果提示）。
 *
 * 流程：
 * 1. 写入 PluginStorage 信号（bgm_request_undo_sync = 时间戳）
 * 2. 通知用户已发送撤销请求
 */
export async function undoLastSyncForRibbon(): Promise<void> {
  bgmLog(LOG_LEVELS.INFO, '[undoLastSyncForRibbon] ========== Ribbon 撤销最近同步 ==========')

  try {
    const app = getApp() as {
      PluginStorage?: {
        getItem: (k: string) => string | null
        setItem: (k: string, v: string) => void
      }
    } | null
    if (!app?.PluginStorage) {
      bgmLog(LOG_LEVELS.ERROR, '[undoLastSyncForRibbon] PluginStorage 不可用')
      await wpsMsgBox('无法连接到任务面板，请稍后重试', 0, 48)
      return
    }

    app.PluginStorage.setItem('bgm_request_undo_sync', String(Date.now()))
    bgmLog(LOG_LEVELS.INFO, '[undoLastSyncForRibbon] 已写入撤销请求信号到 PluginStorage')
    await wpsMsgBox('已发送撤销请求，请在任务面板中确认操作', 0, 64)
  } catch (e: unknown) {
    bgmLog(LOG_LEVELS.ERROR, `[undoLastSyncForRibbon] 写入撤销信号失败: ${(e as Error).message}`)
    await wpsMsgBox('发送撤销请求失败，请稍后重试', 0, 16)
  }
}

/**
 * 执行撤销最近一次同步操作（Panel 上下文）
 *
 * 本函数在 panel 环境中运行，可访问 undoStack 中的实际会话数据。
 * 流程：
 * 1. 检查是否有可撤销的会话；若无，提示并返回
 * 2. 弹出确认对话框，展示会话描述
 * 3. 执行撤销操作（undoLastSync）
 * 4. 显示恢复结果
 *
 * 适用于：
 * - Panel 面板中的"撤销同步"按钮点击
 * - Ribbon 通过 PluginStorage 信号转发后的事件监听
 *
 * @returns 恢复的条目数，若用户取消或无会话则返回 0
 */
export async function executeUndoLastSync(): Promise<number> {
  bgmLog(LOG_LEVELS.INFO, '[executeUndoLastSync] ========== 执行撤销最近同步 ==========')

  const description = getLastSessionDescription()
  if (!description) {
    bgmLog(LOG_LEVELS.INFO, '[executeUndoLastSync] 没有可撤销的同步操作')
    await wpsMsgBox('没有可撤销的同步操作', 0, 48)
    return 0
  }

  const confirmed = await wpsMsgBox(
    `确认撤销最近一次同步操作？\n\n${description}\n\n将按单元格逆序恢复旧值。`,
    4, // MB_YESNO
    32, // MB_ICONQUESTION
  )
  if (confirmed !== 6) {
    bgmLog(LOG_LEVELS.INFO, '[executeUndoLastSync] 用户取消撤销')
    return 0
  }

  try {
    const restored = undoLastSync()
    bgmLog(LOG_LEVELS.INFO, `[executeUndoLastSync] 已恢复 ${String(restored)} 项变更`)
    await wpsMsgBox(`已撤销 ${String(restored)} 项变更`, 0, 64)
    return restored
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e)
    bgmLog(LOG_LEVELS.ERROR, `[executeUndoLastSync] 撤销失败: ${errMsg}`)
    await wpsMsgBox(`撤销失败：${errMsg}`, 0, 16)
    return 0
  }
}
