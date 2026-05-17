/**
 * @fileoverview 配置管理模块
 * @module tools/config
 * @description 提供统一的配置存储和管理功能。
 *              使用 PluginStorage 持久化存储，通过 eventBus 通知同上下文更新。
 */
export declare const CONFIG_KEYS: {
    readonly TOKEN: "bgm_token";
    readonly USER_ID: "bgm_user_id";
    readonly INCREMENTAL_SYNC: "bgm_incremental_sync";
    readonly SKIP_CONFLICTS: "bgm_skip_conflicts";
    readonly LOCKED_SHEET: "bgm_locked_sheet";
};
/**
 * 设置配置值
 * @param key - 配置键名
 * @param value - 配置值
 */
export declare function setConfig(key: string, value: string): boolean;
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