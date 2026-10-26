/**
 * @fileoverview 配置管理模块
 * @module tools/config
 * @description 提供统一的配置存储和管理功能。
 *              使用 PluginStorage 持久化存储，通过 eventBus 通知同上下文更新。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { BGM_EVENTS, eventBus } from './events.js';
import { BGM, getApp, bgmLog } from './util/index.js';
// 配置键名常量
export const CONFIG_KEYS = {
    TOKEN: 'bgm_token',
    USER_ID: 'bgm_user_id',
    INCREMENTAL_SYNC: 'bgm_incremental_sync',
    SKIP_CONFLICTS: 'bgm_skip_conflicts',
    ENABLE_SYNC_RECORD: 'bgm_enable_sync_record',
    NAV_ICONS_ONLY: 'bgm_nav_icons_only',
    THEME: 'bgm_theme',
    THEME_SCHEDULE: 'bgm_theme_schedule',
    MODAL_BUTTONS_POSITION: 'bgm_modal_buttons_position',
    CF_CLUSTER_MODE: 'bgm_cf_cluster_mode',
    SHORTCUTS_ENABLED: 'bgm_shortcuts_enabled',
    SHORTCUT_BINDINGS: 'bgm_shortcut_bindings',
    SHORTCUT_MOUSE: 'bgm_shortcut_mouse',
    ACCOUNTS: 'bgm_accounts',
    LIST_TYPE: 'bgm_list_type',
    TIME_FILTER: 'bgm_time_filter',
    REFRESH_INTERVAL: 'bgm_refresh_interval',
    EXPORT_PATH: 'bgm_export_path',
    IMPORT_PATH: 'bgm_import_path',
    ENRICH_EP_SINGLE: 'bgm_enrich_ep_single',
    ENRICH_EP_FULL: 'bgm_enrich_ep_full',
    ENRICH_FILTER_KEYWORDS: 'bgm_enrich_filter_keywords',
    ENRICH_TAGS_COLOR: 'bgm_enrich_tags_color',
    ENRICH_PREMIERE_COLOR: 'bgm_enrich_premiere_color',
    ENRICH_PLATFORM_COLOR: 'bgm_enrich_platform_color',
    ENRICH_AUTO_CLEAN: 'bgm_enrich_auto_clean',
    HIGHLIGHT_MODE: 'highlight.mode',
    HIGHLIGHT_AUTO_WATCH: 'highlight.autoWatch',
    NAV_ORDER: 'bgm_nav_order',
    MODULE_COLLAPSED: 'bgm_module_collapsed',
    MODULE_HIDDEN: 'bgm_module_hidden',
    LOG_LEVEL: 'bgm_log_level',
};
/**
 * 获取 PluginStorage
 */
function getStorage() {
    const app = getApp();
    const storage = app?.PluginStorage;
    if (!storage) {
        bgmLog(LOG_LEVELS.WARN, '[config] PluginStorage 不可用');
    }
    return storage;
}
/**
 * 设置配置值
 * @param key - 配置键名
 * @param value - 配置值
 */
export function setConfig(key, value) {
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, `[config] 无法获取 PluginStorage，无法设置配置 ${key}`);
        return false;
    }
    const oldValue = storage.getItem(key);
    storage.setItem(key, value);
    if (oldValue === value) {
        bgmLog(LOG_LEVELS.INFO, `[config] 配置值未变化: ${key} = ${value}`);
    }
    else {
        bgmLog(LOG_LEVELS.INFO, `[config] 配置已更新: ${key}`);
        bgmLog(LOG_LEVELS.INFO, `[config]   旧值: ${oldValue || '(空)'}`);
        bgmLog(LOG_LEVELS.INFO, `[config]   新值: ${value}`);
    }
    // 触发内部事件
    bgmLog(LOG_LEVELS.INFO, `[config] 触发内部事件: ${BGM_EVENTS.CONFIG_UPDATED}`);
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key, value });
    // 跨文档 postMessage 通知（Ribbon ↔ Panel 双向同步）：
    // 当 Panel 侧修改配置时，需通知 Ribbon 侧 ribbonUI.InvalidateControl() 重新拉取状态；
    // 反之，Ribbon 侧修改时通知 Panel 侧更新 checkbox。
    // window.parent / window.top 在同源场景下均指向 index.html 顶层（Ribbon 上下文）。
    if (oldValue !== value && typeof window !== 'undefined') {
        const messagePayload = {
            type: 'BGM:configUpdated',
            data: { key, value },
        };
        try {
            // 通知所有可能的窗口（顶层和父级），兼顾 iframe 和顶层窗口场景
            if (window.parent !== window) {
                window.parent.postMessage(messagePayload, '*');
            }
            if (window.top && window.top !== window && window.top !== window.parent) {
                window.top.postMessage(messagePayload, '*');
            }
            // 同时通知当前窗口自身（防止 postMessage 只到父窗口时当前窗口的 ribbon 监听器漏掉）
            window.postMessage(messagePayload, '*');
            bgmLog(LOG_LEVELS.INFO, `[config] 已广播 BGM:configUpdated 跨文档消息: key=${key}`);
        }
        catch (error) {
            bgmLog(LOG_LEVELS.WARN, `[config] postMessage 广播失败: ${error.message || String(error)}`);
        }
    }
    return true;
}
/**
 * 获取配置值
 * @param key - 配置键名
 * @param defaultValue - 默认值
 * @param isSilent - 静默模式，不打印日志（用于轮询等高频读取）
 */
export function getConfig(key, defaultValue = '', isSilent = false) {
    const storage = getStorage();
    if (!storage) {
        if (!isSilent)
            bgmLog(LOG_LEVELS.WARN, `[config] 无法获取 PluginStorage，使用默认值: ${key} = ${defaultValue}`);
        return defaultValue;
    }
    const value = storage.getItem(key);
    const result = value ?? defaultValue;
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取配置: ${key} = ${result}`);
    return result;
}
/**
 * 删除配置值
 * @param key - 配置键名
 */
export function removeConfig(key) {
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, `[config] 无法获取 PluginStorage，无法删除配置 ${key}`);
        return false;
    }
    const oldValue = storage.getItem(key);
    storage.removeItem(key);
    bgmLog(LOG_LEVELS.INFO, `[config] 配置已删除: ${key} (原值: ${oldValue || '(空)'})`);
    // 触发内部事件
    bgmLog(LOG_LEVELS.INFO, `[config] 触发内部事件: ${BGM_EVENTS.CONFIG_UPDATED}`);
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key, value: '' });
    return true;
}
/**
 * 设置增量同步开关
 */
export function setIncrementalSync(isEnabled) {
    bgmLog(LOG_LEVELS.INFO, `[config] 设置增量同步: ${isEnabled ? '开启' : '关闭'}`);
    return setConfig(CONFIG_KEYS.INCREMENTAL_SYNC, isEnabled ? 'true' : 'false');
}
/**
 * 获取增量同步开关状态
 * @param isSilent - 静默模式，不打印日志
 */
export function isIncrementalSyncEnabled(isSilent = false) {
    const isResult = getConfig(CONFIG_KEYS.INCREMENTAL_SYNC, '', isSilent) === 'true';
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取增量同步状态: ${isResult ? '开启' : '关闭'}`);
    return isResult;
}
/**
 * 设置跳过冲突开关
 */
export function setSkipConflicts(isEnabled) {
    bgmLog(LOG_LEVELS.INFO, `[config] 设置跳过冲突: ${isEnabled ? '开启' : '关闭'}`);
    return setConfig(CONFIG_KEYS.SKIP_CONFLICTS, isEnabled ? 'true' : 'false');
}
/**
 * 获取跳过冲突开关状态
 * @param isSilent - 静默模式，不打印日志
 */
export function isSkipConflictsEnabled(isSilent = false) {
    const isResult = getConfig(CONFIG_KEYS.SKIP_CONFLICTS, '', isSilent) === 'true';
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取跳过冲突状态: ${isResult ? '开启' : '关闭'}`);
    return isResult;
}
/**
 * 设置同步记录开关
 */
export function setSyncRecordEnabled(isEnabled) {
    bgmLog(LOG_LEVELS.INFO, `[config] 设置同步记录: ${isEnabled ? '开启' : '关闭'}`);
    return setConfig(CONFIG_KEYS.ENABLE_SYNC_RECORD, isEnabled ? 'true' : 'false');
}
/**
 * 获取同步记录开关状态
 * @param isSilent - 静默模式，不打印日志
 */
export function isSyncRecordEnabled(isSilent = false) {
    const isResult = getConfig(CONFIG_KEYS.ENABLE_SYNC_RECORD, '', isSilent) === 'true';
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取同步记录状态: ${isResult ? '开启' : '关闭'}`);
    return isResult;
}
export function setNavIconsOnly(isEnabled) {
    bgmLog(LOG_LEVELS.INFO, `[config] 设置导航仅图标模式: ${isEnabled ? '开启' : '关闭'}`);
    return setConfig(CONFIG_KEYS.NAV_ICONS_ONLY, isEnabled ? 'true' : 'false');
}
export function areNavIconsOnly(isSilent = false) {
    const isResult = getConfig(CONFIG_KEYS.NAV_ICONS_ONLY, '', isSilent) === 'true';
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取导航仅图标状态: ${isResult ? '开启' : '关闭'}`);
    return isResult;
}
// ========== 外观主题 ==========
/**
 * 主题模式四种：
 * - `dark` / `light`：固定
 * - `system`：跟随操作系统（prefers-color-scheme）
 * - `schedule`：按「深色开始 / 浅色开始」两个时刻定时切换（momo 2026-10-26）
 */
const THEME_MODES = ['dark', 'light', 'system', 'schedule'];
export function setTheme(mode) {
    if (!THEME_MODES.includes(mode)) {
        bgmLog(LOG_LEVELS.WARN, `[config] 无效主题模式: ${mode}，已忽略`);
        return false;
    }
    bgmLog(LOG_LEVELS.INFO, `[config] 设置主题模式: ${mode}`);
    return setConfig(CONFIG_KEYS.THEME, mode);
}
export function getTheme(isSilent = false) {
    const v = getConfig(CONFIG_KEYS.THEME, 'dark', isSilent);
    const result = THEME_MODES.includes(v) ? v : 'dark';
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取主题模式: ${result}`);
    return result;
}
// ========== 主题定时切换（schedule 模式的开始时刻） ==========
/** `HH:MM`（24 小时制）；解析失败返回 null */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_THEME_SCHEDULE = {
    enabled: true,
    darkStart: '19:00',
    lightStart: '07:00',
};
export function setThemeSchedule(schedule) {
    if (!TIME_PATTERN.test(schedule.darkStart) || !TIME_PATTERN.test(schedule.lightStart)) {
        bgmLog(LOG_LEVELS.WARN, `[config] 无效主题定时时刻: ${schedule.darkStart} / ${schedule.lightStart}`);
        return false;
    }
    bgmLog(LOG_LEVELS.INFO, `[config] 设置主题定时: ${schedule.enabled ? '开' : '关'} ${schedule.lightStart}→${schedule.darkStart}`);
    return setConfig(CONFIG_KEYS.THEME_SCHEDULE, JSON.stringify(schedule));
}
export function getThemeSchedule(isSilent = false) {
    const raw = getConfig(CONFIG_KEYS.THEME_SCHEDULE, '', isSilent);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed !== null && typeof parsed === 'object') {
                const { darkStart, lightStart, enabled } = parsed;
                if (typeof darkStart === 'string' &&
                    typeof lightStart === 'string' &&
                    TIME_PATTERN.test(darkStart) &&
                    TIME_PATTERN.test(lightStart)) {
                    return { enabled: enabled === true, darkStart, lightStart };
                }
            }
        }
        catch {
            bgmLog(LOG_LEVELS.WARN, '[config] 主题定时配置解析失败，用默认值');
        }
    }
    return DEFAULT_THEME_SCHEDULE;
}
/** `HH:MM` → 当天分钟数（解析失败按 0 处理，调用方已用 TIME_PATTERN 校验过） */
function toMinutesOfDay(value) {
    const [hours, mins] = value.split(':', 2);
    return Number(hours) * 60 + Number(mins);
}
/**
 * 按定时配置解析当前应处的主题
 *
 * 语义：`[lightStart, darkStart)` 为浅色区间，其余为深色。
 * 跨零点（darkStart 02:00、lightStart 08:00）也能正确判定。
 */
export function resolveScheduledTheme(schedule, now) {
    if (!schedule.enabled)
        return 'dark';
    const minutes = now.getHours() * 60 + now.getMinutes();
    const darkStart = toMinutesOfDay(schedule.darkStart);
    const lightStart = toMinutesOfDay(schedule.lightStart);
    // 浅色区间：lightStart ≤ t < darkStart（不跨零点）或 t ≥ lightStart / t < darkStart（跨零点）
    const isLight = lightStart <= darkStart
        ? minutes >= lightStart && minutes < darkStart
        : minutes >= lightStart || minutes < darkStart;
    return isLight ? 'light' : 'dark';
}
// ========== 模态框按钮位置（momo：可放到模态框之外） ==========
const MODAL_BUTTON_POSITIONS = ['inside', 'outside'];
export function setModalButtonsPosition(position) {
    if (!MODAL_BUTTON_POSITIONS.includes(position)) {
        bgmLog(LOG_LEVELS.WARN, `[config] 无效模态框按钮位置: ${position}，已忽略`);
        return false;
    }
    bgmLog(LOG_LEVELS.INFO, `[config] 设置模态框按钮位置: ${position}`);
    return setConfig(CONFIG_KEYS.MODAL_BUTTONS_POSITION, position);
}
export function getModalButtonsPosition(isSilent = false) {
    const v = getConfig(CONFIG_KEYS.MODAL_BUTTONS_POSITION, 'inside', isSilent);
    const result = MODAL_BUTTON_POSITIONS.includes(v)
        ? v
        : 'inside';
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取模态框按钮位置: ${result}`);
    return result;
}
// ========== 条件格式「自动聚类」口径 ==========
const CLUSTER_MODES = ['formula', 'range-formula', 'column', 'row'];
/** 口径的中文名（设置页按钮、toast 共用，避免两处各写一份） */
export const CLUSTER_MODE_LABELS = {
    formula: '按公式',
    'range-formula': '按范围 + 公式',
    column: '按列',
    row: '按行',
};
export function setClusterMode(mode) {
    if (!CLUSTER_MODES.includes(mode)) {
        bgmLog(LOG_LEVELS.WARN, `[config] 无效自动聚类口径: ${mode}，已忽略`);
        return false;
    }
    bgmLog(LOG_LEVELS.INFO, `[config] 设置自动聚类口径: ${mode}`);
    return setConfig(CONFIG_KEYS.CF_CLUSTER_MODE, mode);
}
export function getClusterMode(isSilent = false) {
    const value = getConfig(CONFIG_KEYS.CF_CLUSTER_MODE, 'formula', isSilent);
    const result = CLUSTER_MODES.includes(value) ? value : 'formula';
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取自动聚类口径: ${result}`);
    return result;
}
/**
 * 口径的中文名；未知取值原样返回（UI 提示用，避免在调用处再写一次类型断言）
 */
export function clusterModeLabel(mode) {
    const labels = CLUSTER_MODE_LABELS;
    return labels[mode] ?? mode;
}
// ========== 默认收藏列表类型 ==========
const LIST_TYPES = ['all', 'collect', 'wish', 'do'];
export function setListType(type) {
    if (!LIST_TYPES.includes(type)) {
        bgmLog(LOG_LEVELS.WARN, `[config] 无效收藏列表类型: ${type}，已忽略`);
        return false;
    }
    bgmLog(LOG_LEVELS.INFO, `[config] 设置默认收藏列表类型: ${type}`);
    return setConfig(CONFIG_KEYS.LIST_TYPE, type);
}
export function getListType(isSilent = false) {
    const v = getConfig(CONFIG_KEYS.LIST_TYPE, 'all', isSilent);
    const result = LIST_TYPES.includes(v) ? v : 'all';
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取默认收藏列表类型: ${result}`);
    return result;
}
// ========== 默认时间筛选范围 ==========
const TIME_FILTERS = ['all', 'year', 'quarter', 'month', 'future'];
export function setTimeFilter(range) {
    if (!TIME_FILTERS.includes(range)) {
        bgmLog(LOG_LEVELS.WARN, `[config] 无效时间筛选范围: ${range}，已忽略`);
        return false;
    }
    bgmLog(LOG_LEVELS.INFO, `[config] 设置默认时间筛选范围: ${range}`);
    return setConfig(CONFIG_KEYS.TIME_FILTER, range);
}
export function getTimeFilter(isSilent = false) {
    const v = getConfig(CONFIG_KEYS.TIME_FILTER, 'year', isSilent);
    const result = TIME_FILTERS.includes(v) ? v : 'year';
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取默认时间筛选范围: ${result}`);
    return result;
}
// ========== 自动刷新间隔（分钟，0 表示关闭） ==========
const REFRESH_MIN = 0;
const REFRESH_MAX = 1440;
export function setRefreshInterval(minutes) {
    if (!Number.isFinite(minutes) || minutes < REFRESH_MIN || minutes > REFRESH_MAX) {
        bgmLog(LOG_LEVELS.WARN, `[config] 无效刷新间隔: ${String(minutes)}，已忽略`);
        return false;
    }
    const value = String(Math.round(minutes));
    bgmLog(LOG_LEVELS.INFO, `[config] 设置自动刷新间隔: ${value} 分钟`);
    return setConfig(CONFIG_KEYS.REFRESH_INTERVAL, value);
}
export function getRefreshInterval(isSilent = false) {
    const raw = Number(getConfig(CONFIG_KEYS.REFRESH_INTERVAL, '0', isSilent));
    const result = Number.isFinite(raw) && raw >= REFRESH_MIN ? raw : 0;
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取自动刷新间隔: ${String(result)} 分钟`);
    return result;
}
// ========== 默认导出位置 / 默认导入文件夹 ==========
/**
 * 设置默认导出位置（文件夹路径）
 */
export function setExportPath(path) {
    bgmLog(LOG_LEVELS.INFO, `[config] 设置默认导出位置: ${path}`);
    return setConfig(CONFIG_KEYS.EXPORT_PATH, path);
}
/**
 * 获取默认导出位置（文件夹路径），未设置时返回空字符串
 * @param isSilent - 静默模式，不打印日志
 */
export function getExportPath(isSilent = false) {
    return getConfig(CONFIG_KEYS.EXPORT_PATH, '', isSilent);
}
/**
 * 设置默认导入文件夹
 */
export function setImportPath(path) {
    bgmLog(LOG_LEVELS.INFO, `[config] 设置默认导入文件夹: ${path}`);
    return setConfig(CONFIG_KEYS.IMPORT_PATH, path);
}
/**
 * 获取默认导入文件夹，未设置时返回空字符串
 * @param isSilent - 静默模式，不打印日志
 */
export function getImportPath(isSilent = false) {
    return getConfig(CONFIG_KEYS.IMPORT_PATH, '', isSilent);
}
// ========== 全局日志级别 ==========
/** 日志级别取值范围：DEBUG(0) … ERROR(3)，两端都取 {@link LOG_LEVELS} 里的常量 */
const LOG_LEVEL_MIN = LOG_LEVELS.DEBUG;
const LOG_LEVEL_MAX = LOG_LEVELS.ERROR;
/**
 * 设置全局日志级别。
 * 除持久化外，还会同步更新内存中的 `BGM.LOG_LEVEL` —— `bgmLog()` 依赖该字段做
 * 过滤，只写存储不更新内存会导致「设置后当前页面日志级别不变」。
 */
export function setLogLevel(level) {
    if (!Number.isSafeInteger(level) || level < LOG_LEVEL_MIN || level > LOG_LEVEL_MAX) {
        bgmLog(LOG_LEVELS.WARN, `[config] 无效日志级别: ${String(level)}，已忽略`);
        return false;
    }
    bgmLog(LOG_LEVELS.INFO, `[config] 设置全局日志级别: ${String(level)}`);
    BGM.LOG_LEVEL = level;
    return setConfig(CONFIG_KEYS.LOG_LEVEL, String(level));
}
/**
 * 获取全局日志级别（默认 INFO）
 * @param isSilent - 静默模式，不打印日志
 */
export function getLogLevel(isSilent = false) {
    const raw = Number(getConfig(CONFIG_KEYS.LOG_LEVEL, String(LOG_LEVELS.INFO), isSilent));
    const result = Number.isSafeInteger(raw) && raw >= LOG_LEVEL_MIN && raw <= LOG_LEVEL_MAX
        ? raw
        : LOG_LEVELS.INFO;
    if (!isSilent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取全局日志级别: ${String(result)}`);
    return result;
}
/**
 * 把持久化的日志级别应用到内存（`BGM.LOG_LEVEL`）。
 * 供各页面入口启动时调用一次：`bgmLog()` 默认按 INFO 过滤，
 * 用户此前调高/调低过级别的话，启动时必须重新套用。
 */
export function applyLogLevel() {
    BGM.LOG_LEVEL = getLogLevel(true);
}
