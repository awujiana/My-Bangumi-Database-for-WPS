/**
 * @fileoverview 「重置全部配置」的键筛选逻辑
 * @module ui/handlers/config-reset-keys
 * @description 从 action-handlers 抽出：决定重置操作应该清除哪些配置键。
 *
 * 背景：`CONFIG_KEYS` 里混着两类键 ——
 *   - **偏好键**：主题、导航、模块排序、同步偏好等，重置时应当清除；
 *   - **会话态键**：当前锁定工作表状态 `bgm_locked_sheet_<page>`（按页独立存储于
 *     tools/locked-sheet.ts，记录用户此刻的目标表选择）。它属于工作状态而非「设置」，
 *     清掉会导致下次打开追踪表时丢失目标表选择，且 config-service 的导出白名单也不入档。
 *
 * 此前这里写的是两个 bare 键 `bgm_locked_sheet` / `bgm_locked_workbook`，但真实写入的键带
 * `_<page>` 后缀、bare 键从未被写入，那段「保护」是死代码；真实带后缀键又因为不在
 * `CONFIG_KEYS` 里、重置循环碰不到，才「碰巧」被保留。改成前缀匹配后，「重置保留锁定表」
 * 成为显式且健壮的语义：即便将来有人把 `bgm_locked_sheet_<page>` 加进 `CONFIG_KEYS`，
 * 也不会被误清。
 */
import { CONFIG_KEYS } from '../../tools/config.js';
/**
 * 不参与「重置全部配置」的会话态键前缀。
 * 锁定工作表状态按页独立持久化为 `bgm_locked_sheet_<page>`（见 tools/locked-sheet.ts）。
 */
export const SESSION_STATE_KEY_PREFIXES = ['bgm_locked_sheet_'];
/** 该键是否为会话态（不参与重置） */
export function isSessionStateKey(key) {
    return SESSION_STATE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}
/**
 * 返回「重置全部配置」应当清除的键列表（保持 `CONFIG_KEYS` 声明顺序）。
 * @returns 可安全清除的配置键
 */
export function getResettableConfigKeys() {
    return Object.values(CONFIG_KEYS).filter((key) => !isSessionStateKey(key));
}
