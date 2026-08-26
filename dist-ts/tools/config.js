/**
 * @fileoverview 配置管理模块
 * @module tools/config
 * @description 提供统一的配置存储和管理功能。
 *              使用 PluginStorage 持久化存储，通过 eventBus 通知同上下文更新。
 */
import { getApp, bgmLog, LOG_LEVELS } from '../index.js';
import { BGM_EVENTS, eventBus } from './events.js';
// 配置键名常量
export const CONFIG_KEYS = {
    TOKEN: 'bgm_token',
    USER_ID: 'bgm_user_id',
    INCREMENTAL_SYNC: 'bgm_incremental_sync',
    SKIP_CONFLICTS: 'bgm_skip_conflicts',
    LOCKED_SHEET: 'bgm_locked_sheet',
    LOCKED_WORKBOOK: 'bgm_locked_workbook',
    ENABLE_SYNC_RECORD: 'bgm_enable_sync_record',
    ENRICH_LOCKED_WORKBOOK: 'bgm_enrich_locked_workbook',
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
    if (oldValue !== value) {
        bgmLog(LOG_LEVELS.INFO, `[config] 配置已更新: ${key}`);
        bgmLog(LOG_LEVELS.INFO, `[config]   旧值: ${oldValue || '(空)'}`);
        bgmLog(LOG_LEVELS.INFO, `[config]   新值: ${value}`);
    }
    else {
        bgmLog(LOG_LEVELS.INFO, `[config] 配置值未变化: ${key} = ${value}`);
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
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(messagePayload, '*');
            }
            if (window.top && window.top !== window && window.top !== window.parent) {
                window.top.postMessage(messagePayload, '*');
            }
            // 同时通知当前窗口自身（防止 postMessage 只到父窗口时当前窗口的 ribbon 监听器漏掉）
            window.postMessage(messagePayload, '*');
            bgmLog(LOG_LEVELS.INFO, `[config] 已广播 BGM:configUpdated 跨文档消息: key=${key}`);
        }
        catch (e) {
            bgmLog(LOG_LEVELS.WARN, `[config] postMessage 广播失败: ${e?.message || String(e)}`);
        }
    }
    return true;
}
/**
 * 获取配置值
 * @param key - 配置键名
 * @param defaultValue - 默认值
 * @param silent - 静默模式，不打印日志（用于轮询等高频读取）
 */
export function getConfig(key, defaultValue = '', silent = false) {
    const storage = getStorage();
    if (!storage) {
        if (!silent)
            bgmLog(LOG_LEVELS.WARN, `[config] 无法获取 PluginStorage，使用默认值: ${key} = ${defaultValue}`);
        return defaultValue;
    }
    const value = storage.getItem(key);
    const result = value !== null ? value : defaultValue;
    if (!silent)
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
export function setIncrementalSync(enabled) {
    bgmLog(LOG_LEVELS.INFO, `[config] 设置增量同步: ${enabled ? '开启' : '关闭'}`);
    return setConfig(CONFIG_KEYS.INCREMENTAL_SYNC, enabled ? 'true' : 'false');
}
/**
 * 获取增量同步开关状态
 * @param silent - 静默模式，不打印日志
 */
export function getIncrementalSync(silent = false) {
    const result = getConfig(CONFIG_KEYS.INCREMENTAL_SYNC, '', silent) === 'true';
    if (!silent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取增量同步状态: ${result ? '开启' : '关闭'}`);
    return result;
}
/**
 * 设置跳过冲突开关
 */
export function setSkipConflicts(enabled) {
    bgmLog(LOG_LEVELS.INFO, `[config] 设置跳过冲突: ${enabled ? '开启' : '关闭'}`);
    return setConfig(CONFIG_KEYS.SKIP_CONFLICTS, enabled ? 'true' : 'false');
}
/**
 * 获取跳过冲突开关状态
 * @param silent - 静默模式，不打印日志
 */
export function getSkipConflicts(silent = false) {
    const result = getConfig(CONFIG_KEYS.SKIP_CONFLICTS, '', silent) === 'true';
    if (!silent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取跳过冲突状态: ${result ? '开启' : '关闭'}`);
    return result;
}
/**
 * 设置同步记录开关
 */
export function setSyncRecordEnabled(enabled) {
    bgmLog(LOG_LEVELS.INFO, `[config] 设置同步记录: ${enabled ? '开启' : '关闭'}`);
    return setConfig(CONFIG_KEYS.ENABLE_SYNC_RECORD, enabled ? 'true' : 'false');
}
/**
 * 获取同步记录开关状态
 * @param silent - 静默模式，不打印日志
 */
export function getSyncRecordEnabled(silent = false) {
    const result = getConfig(CONFIG_KEYS.ENABLE_SYNC_RECORD, '', silent) === 'true';
    if (!silent)
        bgmLog(LOG_LEVELS.INFO, `[config] 获取同步记录状态: ${result ? '开启' : '关闭'}`);
    return result;
}
