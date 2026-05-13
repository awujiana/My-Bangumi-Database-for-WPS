/**
 * @fileoverview 配置管理模块
 * @module tools/config
 * @description 提供统一的配置存储和管理功能，支持 Ribbon 和侧边栏双向同步。
 *              使用 PluginStorage 持久化存储，通过 postMessage 跨端通知。
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
} as const;

/**
 * 配置更新消息类型
 */
export const CONFIG_MESSAGE_TYPES = {
    CONFIG_UPDATED: 'BGM:configUpdated',
    SYNC_PROGRESS: 'BGM:syncProgress',
} as const;

/**
 * 配置更新数据接口
 */
export interface ConfigUpdateData {
    key: string;
    value: string;
}

/**
 * 同步进度数据接口
 */
export interface SyncProgressData {
    current: number;
    total: number;
    message?: string;
}

/**
 * 获取 PluginStorage
 */
function getStorage(): any {
    const app = getApp();
    return app?.PluginStorage;
}

/**
 * 设置配置值
 * @param key - 配置键名
 * @param value - 配置值
 * @param notifyRibbon - 是否通知 Ribbon
 */
export function setConfig(key: string, value: string, notifyRibbon: boolean = true): boolean {
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, `[config] 无法获取 PluginStorage，无法设置配置 ${key}`);
        return false;
    }

    storage.setItem(key, value);
    bgmLog(LOG_LEVELS.DEBUG, `[config] 配置已更新: ${key} = ${value}`);

    // 触发内部事件
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key, value });

    // 通知 Ribbon
    if (notifyRibbon) {
        sendConfigUpdateToRibbon(key, value);
    }

    return true;
}

/**
 * 获取配置值
 * @param key - 配置键名
 * @param defaultValue - 默认值
 */
export function getConfig(key: string, defaultValue: string = ''): string {
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.WARN, `[config] 无法获取 PluginStorage，使用默认值: ${key} = ${defaultValue}`);
        return defaultValue;
    }

    const value = storage.getItem(key);
    return value !== null ? value : defaultValue;
}

/**
 * 删除配置值
 * @param key - 配置键名
 */
export function removeConfig(key: string): boolean {
    const storage = getStorage();
    if (!storage) {
        bgmLog(LOG_LEVELS.ERROR, `[config] 无法获取 PluginStorage，无法删除配置 ${key}`);
        return false;
    }

    storage.removeItem(key);
    bgmLog(LOG_LEVELS.DEBUG, `[config] 配置已删除: ${key}`);

    // 触发内部事件
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key, value: '' });

    // 通知 Ribbon
    sendConfigUpdateToRibbon(key, '');

    return true;
}

/**
 * 通过 postMessage 向 Ribbon 发送配置更新通知
 * @param key - 配置键名
 * @param value - 配置值
 */
export function sendConfigUpdateToRibbon(key: string, value: string): void {
    try {
        const message = {
            type: CONFIG_MESSAGE_TYPES.CONFIG_UPDATED,
            data: { key, value }
        };
        window.parent.postMessage(message, '*');
        bgmLog(LOG_LEVELS.DEBUG, `[config] 已向 Ribbon 发送配置更新通知: ${key} = ${value}`);
    } catch (error) {
        bgmLog(LOG_LEVELS.ERROR, `[config] 发送配置更新通知失败: ${error}`);
    }
}

/**
 * 发送同步进度通知到 Ribbon
 * @param progress - 进度数据
 */
export function sendSyncProgressToRibbon(progress: SyncProgressData): void {
    try {
        const message = {
            type: CONFIG_MESSAGE_TYPES.SYNC_PROGRESS,
            data: progress
        };
        window.parent.postMessage(message, '*');
        bgmLog(LOG_LEVELS.DEBUG, `[config] 已向 Ribbon 发送同步进度: ${progress.current}/${progress.total}`);
    } catch (error) {
        bgmLog(LOG_LEVELS.ERROR, `[config] 发送同步进度失败: ${error}`);
    }
}

/**
 * 监听 Ribbon 发送的配置更新通知
 * @param callback - 回调函数
 */
export function listenToRibbonConfigUpdates(callback: (data: ConfigUpdateData) => void): void {
    const handler = (event: MessageEvent) => {
        if (event.data?.type === CONFIG_MESSAGE_TYPES.CONFIG_UPDATED) {
            const data = event.data.data as ConfigUpdateData;
            bgmLog(LOG_LEVELS.DEBUG, `[config] 收到 Ribbon 配置更新通知: ${data.key} = ${data.value}`);
            callback(data);
        }
    };

    window.addEventListener('message', handler);
    bgmLog(LOG_LEVELS.INFO, '[config] 已注册 Ribbon 配置更新监听器');
}

/**
 * 设置增量同步开关
 */
export function setIncrementalSync(enabled: boolean): boolean {
    return setConfig(CONFIG_KEYS.INCREMENTAL_SYNC, enabled ? 'true' : 'false');
}

/**
 * 获取增量同步开关状态
 */
export function getIncrementalSync(): boolean {
    return getConfig(CONFIG_KEYS.INCREMENTAL_SYNC) === 'true';
}

/**
 * 设置跳过冲突开关
 */
export function setSkipConflicts(enabled: boolean): boolean {
    return setConfig(CONFIG_KEYS.SKIP_CONFLICTS, enabled ? 'true' : 'false');
}

/**
 * 获取跳过冲突开关状态
 */
export function getSkipConflicts(): boolean {
    return getConfig(CONFIG_KEYS.SKIP_CONFLICTS) === 'true';
}