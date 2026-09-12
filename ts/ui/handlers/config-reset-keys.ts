/**
 * @fileoverview 「重置全部配置」的键筛选逻辑
 * @module ui/handlers/config-reset-keys
 * @description 从 action-handlers 抽出：决定重置操作应该清除哪些配置键。
 *
 * 背景：`CONFIG_KEYS` 里混着两类键 ——
 *   - **偏好键**：主题、导航、模块排序、同步偏好等，重置时应当清除；
 *   - **会话态键**：当前锁定的工作表/工作簿（`bgm_locked_sheet` / `bgm_locked_workbook`）。
 *     它们记录的是用户此刻的工作状态而非「设置」，清掉会导致下次打开追踪表时
 *     丢失目标表选择，且 config-service 的导出白名单也不把它们入档。
 * 因此重置时按 `Object.values(CONFIG_KEYS)` 遍历会让用户意外丢失工作状态。
 */

import { CONFIG_KEYS } from '../../tools/config.js'

/** 不参与「重置全部配置」的会话态键 */
export const SESSION_STATE_KEYS: ReadonlySet<string> = new Set<string>([
  CONFIG_KEYS.LOCKED_SHEET,
  CONFIG_KEYS.LOCKED_WORKBOOK,
])

/**
 * 返回「重置全部配置」应当清除的键列表（保持 `CONFIG_KEYS` 声明顺序）。
 * @returns 可安全清除的配置键
 */
export function getResettableConfigKeys(): string[] {
  return Object.values(CONFIG_KEYS).filter((key) => !SESSION_STATE_KEYS.has(key))
}
