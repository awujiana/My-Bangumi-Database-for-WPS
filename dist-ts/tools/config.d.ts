/**
 * @fileoverview 配置管理模块
 * @module tools/config
 * @description 提供统一的配置存储和管理功能，支持 Ribbon 和侧边栏双向同步。
 *              使用 PluginStorage 持久化存储，通过 postMessage 跨端通知。
 */
export declare const CONFIG_KEYS: {
    readonly TOKEN: "bgm_token";
    readonly USER_ID: "bgm_user_id";
    readonly INCREMENTAL_SYNC: "bgm_incremental_sync";
    readonly SKIP_CONFLICTS: "bgm_skip_conflicts";
    readonly LOCKED_SHEET: "bgm_locked_sheet";
};
/**
 * 配置更新消息类型
 */
export declare const CONFIG_MESSAGE_TYPES: {
    readonly CONFIG_UPDATED: "BGM:configUpdated";
    readonly SYNC_PROGRESS: "BGM:syncProgress";
};
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
 * 设置配置值
 * @param key - 配置键名
 * @param value - 配置值
 * @param notifyRibbon - 是否通知 Ribbon
 */
export declare function setConfig(key: string, value: string, notifyRibbon?: boolean): boolean;
/**
 * 获取配置值
 * @param key - 配置键名
 * @param defaultValue - 默认值
 */
export declare function getConfig(key: string, defaultValue?: string): string;
/**
 * 删除配置值
 * @param key - 配置键名
 */
export declare function removeConfig(key: string): boolean;
/**
 * 通过 postMessage 向 Ribbon 发送配置更新通知
 * @param key - 配置键名
 * @param value - 配置值
 */
export declare function sendConfigUpdateToRibbon(key: string, value: string): void;
/**
 * 发送同步进度通知到 Ribbon
 * @param progress - 进度数据
 */
export declare function sendSyncProgressToRibbon(progress: SyncProgressData): void;
/**
 * 监听 Ribbon 发送的配置更新通知
 * @param callback - 回调函数
 */
export declare function listenToRibbonConfigUpdates(callback: (data: ConfigUpdateData) => void): void;
/**
 * 设置增量同步开关
 */
export declare function setIncrementalSync(enabled: boolean): boolean;
/**
 * 获取增量同步开关状态
 */
export declare function getIncrementalSync(): boolean;
/**
 * 设置跳过冲突开关
 */
export declare function setSkipConflicts(enabled: boolean): boolean;
/**
 * 获取跳过冲突开关状态
 */
export declare function getSkipConflicts(): boolean;
//# sourceMappingURL=config.d.ts.map