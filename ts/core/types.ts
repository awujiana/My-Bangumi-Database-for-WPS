/**
 * 核心类型定义 - 全局状态接口
 * @module core/types
 * @description 定义 BGM 全局状态对象的接口，包括缓存、工作表状态、同步状态、用户信息等。
 *              本文件仅包含类型定义，无运行时依赖，可被任意模块安全导入。
 */

import type { WpsWorksheet } from '../tools/wps.js'

// ========== BGM 缓存数据结构 ==========
export interface BGMCache {
  /** WPS 文档总行数缓存 */
  totalRows: number
  /** 当前用户 ID */
  userId: string | null
  /** 当前用户名 */
  username: string | null
  /** 当前用户头像 URL */
  avatarUrl: string | null
  /** Subject ID 缓存（sid → 行号） */
  sidCache: Map<string, string>
  /** 列表缓存（通用数据） */
  listCache: unknown[]
}

// ========== BGM 工作表状态 ==========
export interface BGMSheet {
  /** 锁定的工作表索引 */
  lockedIndex: number | null
  /** 锁定的工作表名称 */
  lockedName: string | null
  /** 是否已锁定 */
  isLocked: boolean
  /** 锁定的工作簿名称（空字符串表示当前活动工作簿） */
  lockedWorkbookName: string | null
}

// ========== BGM 同步状态 ==========
export interface BGMSync {
  /** 是否正在同步 */
  isRunning: boolean
  /** 是否请求停止同步 */
  shouldStop: boolean
  /** 是否暂停中 */
  isPaused: boolean
  /** 上次同步时间（ISO 格式） */
  lastSyncTime: string | null
  /** 当前正在处理的行号（用于暂停时定位） */
  currentRow: number
  /** 当前正在处理的工作表（用于暂停时定位） */
  currentSheet: WpsWorksheet | null
  /** 当前正在处理的列号（用于暂停时定位） */
  currentCol: number
  /** 进入运行状态（统一入口） */
  enterRunningState: () => boolean
  /** 退出运行状态（统一入口） */
  exitRunningState: () => void
  /** 启动同步流程（由"全面同步"按钮触发） */
  startSync: () => void
  /** 请求停止同步 */
  requestStop: () => void
  /** 暂停同步 */
  pause: () => void
  /** 恢复同步 */
  resume: () => void
  /** 检查是否应该停止同步 */
  checkShouldStop: () => boolean
  /** 检查是否暂停中 */
  checkPaused: () => boolean
  /** 暂停时等待恢复（每 50ms 轮询） */
  waitForResume: () => Promise<void>
  /** 定位到当前正在处理的单元格 */
  locateCurrentCell: () => boolean
  /** 更新当前位置 */
  updatePosition: (ws: WpsWorksheet | null | undefined, row: number, col?: number) => void
  /** 重置停止标志 */
  resetStopFlag: () => void
}

// ========== BGM 用户信息 ==========
export interface BGMUserInfo {
  /** 用户 ID */
  id: string
  /** 用户名 */
  username: string
  /** 头像 URL */
  avatarUrl?: string | undefined
}

// ========== BGM 富化工作簿锁定状态 ==========
export interface EnrichWorkbookState {
  /** 锁定的工作簿名称 */
  lockedWorkbookName: string | null
  /** 锁定的工作表名称 */
  lockedSheetName: string | null
  /** 锁定的工作表索引（1-based） */
  lockedSheetIndex: number | null
  /** 是否已锁定 */
  isLocked: boolean
}
