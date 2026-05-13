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
 * @param notifyRibbon - 是否通知 Ribbon
 */
export function setConfig(key: string, value: string, notifyRibbon: boolean = true): boolean {
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
    } else {
        bgmLog(LOG_LEVELS.INFO, `[config] 配置值未变化: ${key} = ${value}`);
    }

    // 触发内部事件
    bgmLog(LOG_LEVELS.INFO, `[config] 触发内部事件: ${BGM_EVENTS.CONFIG_UPDATED}`);
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key, value });

    // 通知 Ribbon
    if (notifyRibbon) {
        bgmLog(LOG_LEVELS.INFO, `[config] 准备向 Ribbon 发送通知`);
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
    const result = value !== null ? value : defaultValue;
    bgmLog(LOG_LEVELS.INFO, `[config] 获取配置: ${key} = ${result}`);
    return result;
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

    const oldValue = storage.getItem(key);
    storage.removeItem(key);
    bgmLog(LOG_LEVELS.INFO, `[config] 配置已删除: ${key} (原值: ${oldValue || '(空)'})`);

    // 触发内部事件
    bgmLog(LOG_LEVELS.INFO, `[config] 触发内部事件: ${BGM_EVENTS.CONFIG_UPDATED}`);
    eventBus.emit(BGM_EVENTS.CONFIG_UPDATED, { key, value: '' });

    // 通知 Ribbon
    bgmLog(LOG_LEVELS.INFO, `[config] 准备向 Ribbon 发送删除通知`);
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
        bgmLog(LOG_LEVELS.INFO, `[config] postMessage 发送中...`);
        bgmLog(LOG_LEVELS.INFO, `[config]   目标: window.parent`);
        bgmLog(LOG_LEVELS.INFO, `[config]   消息类型: ${message.type}`);
        bgmLog(LOG_LEVELS.INFO, `[config]   数据: ${JSON.stringify(message.data)}`);
        
        window.parent.postMessage(message, '*');
        
        bgmLog(LOG_LEVELS.INFO, `[config] 已向 Ribbon 发送配置更新通知: ${key} = ${value}`);
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
        bgmLog(LOG_LEVELS.INFO, `[config] postMessage 发送同步进度...`);
        bgmLog(LOG_LEVELS.INFO, `[config]   进度: ${progress.current}/${progress.total}`);
        bgmLog(LOG_LEVELS.INFO, `[config]   消息: ${progress.message || '(无)'}`);
        
        window.parent.postMessage(message, '*');
        
        bgmLog(LOG_LEVELS.INFO, `[config] 已向 Ribbon 发送同步进度: ${progress.current}/${progress.total}`);
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
        bgmLog(LOG_LEVELS.INFO, `[config] 收到 postMessage: ${event.data?.type || '(未知类型)'}`);
        
        if (event.data?.type === CONFIG_MESSAGE_TYPES.CONFIG_UPDATED) {
            const data = event.data.data as ConfigUpdateData;
            bgmLog(LOG_LEVELS.INFO, `[config] 收到 Ribbon 配置更新通知:`);
            bgmLog(LOG_LEVELS.INFO, `[config]   配置键: ${data.key}`);
            bgmLog(LOG_LEVELS.INFO, `[config]   新值: ${data.value}`);
            
            callback(data);
        } else if (event.data?.type === CONFIG_MESSAGE_TYPES.SYNC_PROGRESS) {
            bgmLog(LOG_LEVELS.INFO, `[config] 收到同步进度通知: ${event.data.data?.current}/${event.data.data?.total}`);
        }
    };

    window.addEventListener('message', handler);
    bgmLog(LOG_LEVELS.INFO, '[config] 已注册 Ribbon 配置更新监听器');
}

/**
 * 设置增量同步开关
 */
export function setIncrementalSync(enabled: boolean): boolean {
    bgmLog(LOG_LEVELS.INFO, `[config] 设置增量同步: ${enabled ? '开启' : '关闭'}`);
    return setConfig(CONFIG_KEYS.INCREMENTAL_SYNC, enabled ? 'true' : 'false');
}

/**
 * 获取增量同步开关状态
 */
export function getIncrementalSync(): boolean {
    const result = getConfig(CONFIG_KEYS.INCREMENTAL_SYNC) === 'true';
    bgmLog(LOG_LEVELS.INFO, `[config] 获取增量同步状态: ${result ? '开启' : '关闭'}`);
    return result;
}

/**
 * 设置跳过冲突开关
 */
export function setSkipConflicts(enabled: boolean): boolean {
    bgmLog(LOG_LEVELS.INFO, `[config] 设置跳过冲突: ${enabled ? '开启' : '关闭'}`);
    return setConfig(CONFIG_KEYS.SKIP_CONFLICTS, enabled ? 'true' : 'false');
}

/**
 * 获取跳过冲突开关状态
 */
export function getSkipConflicts(): boolean {
    const result = getConfig(CONFIG_KEYS.SKIP_CONFLICTS) === 'true';
    bgmLog(LOG_LEVELS.INFO, `[config] 获取跳过冲突状态: ${result ? '开启' : '关闭'}`);
    return result;
}