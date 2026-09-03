/**
 * Excel→Bangumi 同步模块 - 进度上报与结果应用
 * @module sync/exceltobangumi/progressReporter
 * @description 同步任务类型定义、同步结果应用到 UI（颜色标记）、写入同步记录、汇总上报。
 *              本模块定义共享类型 SyncTask / SyncResultStats，供 index.ts 使用。
 */
import { LOG_LEVELS, SYNC_STATUS, BGM_COLOR } from '../../core/constants.js'
import { bgmLog, BGM, getCell } from '../../tools/util/index.js'
import type { WpsWorksheet } from '../../tools/wps.js'
import { addSyncRecord } from '../sync-record.js'

/**
 * 同步任务项接口
 */
export interface SyncTask {
  rowNum: number
  sid: string
  bgmUrl: string
  name: string
  jsonBody: string
  fingerprint?: string
  // 观看状态类型 1-5
  type: number
  // 要标记为已完成的集数
  epCount?: number
}

/**
 * 同步结果统计对象类型（成功/失败/跳过/停止计数，会被 UI 更新层直接修改）
 */
export interface SyncResultStats {
  success: number
  fail: number
  skip: number
  stopped: boolean
}

/** 观看状态类型名称映射 (优化点：提取常量) */
export const TYPE_NAMES: Record<number, string> = {
  1: '想看',
  2: '在看',
  3: '看过',
  4: '搁置',
  5: '抛弃',
}

/** 序列号列默认索引 */
export const DEFAULT_SEQ_COL = 4

/**
 * 标记单元格同步结果颜色
 * @param ws 工作表
 * @param row 行号
 * @param isSuccess 是否成功
 * @param seqCol 序列号列索引（可选，默认4）
 */
export function markSyncResultColor(
  ws: WpsWorksheet,
  row: number,
  isSuccess: boolean,
  seqCol?: number,
): void {
  const col = seqCol || DEFAULT_SEQ_COL
  const cell = getCell(ws, row, col)
  if (cell?.Interior) {
    cell.Interior.Color = isSuccess ? BGM_COLOR.SUCCESS : BGM_COLOR.FAIL
  }
}

/**
 * 应用成功任务结果到 UI 和记录（UI 更新层）
 * 标记单元格成功颜色 + 写入同步记录 + 累加成功计数。
 * @param ws 工作表
 * @param seqCol 序列号列索引
 * @param successTasks 成功任务列表
 * @param result 结果统计对象（会被修改：累加 success）
 */
export function applySyncSuccessResults(
  ws: WpsWorksheet,
  seqCol: number,
  successTasks: SyncTask[],
  result: SyncResultStats,
): void {
  for (const task of successTasks) {
    // 标记颜色
    markSyncResultColor(ws, task.rowNum, true, seqCol)

    // 记录同步日志
    addSyncRecord({
      name: task.name || `SID:${task.sid}`,
      url: task.bgmUrl,
      sid: task.sid,
      type: TYPE_NAMES[task.type] || `类型${String(task.type)}`,
      content: task.jsonBody,
      status: SYNC_STATUS.SUCCESS,
      message: '批量同步成功',
      count: 1,
      ...(task.fingerprint === undefined ? {} : { fingerprint: task.fingerprint }),
    })

    result.success += 1
  }
}

/**
 * 应用失败任务结果到 UI 和记录（UI 更新层）
 * 标记单元格失败颜色 + 写入同步记录 + 累加失败计数。
 * @param ws 工作表
 * @param seqCol 序列号列索引
 * @param failTasks 失败任务列表
 * @param result 结果统计对象（会被修改：累加 fail）
 */
export function applySyncFailResults(
  ws: WpsWorksheet,
  seqCol: number,
  failTasks: SyncTask[],
  result: SyncResultStats,
): void {
  for (const task of failTasks) {
    markSyncResultColor(ws, task.rowNum, false, seqCol)

    addSyncRecord({
      name: task.name || `SID:${task.sid}`,
      url: task.bgmUrl,
      sid: task.sid,
      type: TYPE_NAMES[task.type] || `类型${String(task.type)}`,
      content: task.jsonBody,
      status: SYNC_STATUS.FAIL,
      message: '批量同步失败',
      count: 1,
    })

    result.fail += 1
  }
}

/**
 * 处理被停止时的剩余任务（UI 更新层）
 * 将未执行的任务统计为跳过，并设置 stopped 标志。
 * @param syncTasks 全部待同步任务列表
 * @param successTasks 已成功的任务列表
 * @param failTasks 已失败的任务列表
 * @param result 结果统计对象（会被修改：累加 skip、置 stopped=true）
 */
export function handleStoppedRemainingTasks(
  syncTasks: SyncTask[],
  successTasks: SyncTask[],
  failTasks: SyncTask[],
  result: SyncResultStats,
): void {
  result.stopped = true
  const executedCount = successTasks.length + failTasks.length
  const remainingTasks = syncTasks.slice(executedCount)
  for (const task of remainingTasks) {
    result.skip += 1
    bgmLog(LOG_LEVELS.INFO, `[SyncToBangumiAsync] 任务被跳过（停止）: SID=${task.sid}`)
  }
  bgmLog(
    LOG_LEVELS.INFO,
    `[SyncToBangumiAsync] 同步已停止，${String(remainingTasks.length)} 条任务被跳过`,
  )
}

/**
 * 批量更新 UI 和记录（协调函数 - 步骤 6）
 * 协调 applySyncSuccessResults → applySyncFailResults → handleStoppedRemainingTasks，
 * 完成标记颜色、写同步记录、统计剩余任务、reportProgress、BGM.setSyncComplete。
 * @param ws 工作表
 * @param seqCol 序列号列索引
 * @param successTasks 成功任务列表
 * @param failTasks 失败任务列表
 * @param syncTasks 全部待同步任务列表
 * @param stopped 是否被停止
 * @param result 同步结果统计对象（会被直接修改）
 * @param startTime 开始时间戳
 * @param reportProgress 进度回调
 */
export function finalizeSyncResults(
  ws: WpsWorksheet,
  seqCol: number,
  successTasks: SyncTask[],
  failTasks: SyncTask[],
  syncTasks: SyncTask[],
  stopped: boolean,
  result: SyncResultStats,
  startTime: number,
  reportProgress: (current: number, message: string) => void,
): void {
  bgmLog(LOG_LEVELS.INFO, '[SyncToBangumiAsync] 步骤6: 批量更新 UI 和记录')

  // 应用成功结果到 UI 和记录
  applySyncSuccessResults(ws, seqCol, successTasks, result)

  // 应用失败结果到 UI 和记录
  applySyncFailResults(ws, seqCol, failTasks, result)

  // 处理被停止时的剩余任务
  if (stopped) {
    handleStoppedRemainingTasks(syncTasks, successTasks, failTasks, result)
  }

  // 汇总报告
  const totalTime = Date.now() - startTime
  reportProgress(syncTasks.length, stopped ? '同步已停止' : '同步完成')
  BGM.setSyncComplete(result)
  bgmLog(
    LOG_LEVELS.INFO,
    `[SyncToBangumiAsync] 同步完成: 成功=${String(result.success)}, 失败=${String(result.fail)}, 跳过=${String(result.skip)}, 已停止=${String(result.stopped)}, 总耗时=${String(totalTime)}ms`,
  )
}
