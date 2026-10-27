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
    readonly ENABLE_SYNC_RECORD: "bgm_enable_sync_record";
    readonly NAV_ICONS_ONLY: "bgm_nav_icons_only";
    readonly THEME: "bgm_theme";
    readonly THEME_SCHEDULE: "bgm_theme_schedule";
    readonly MODAL_BUTTONS_POSITION: "bgm_modal_buttons_position";
    readonly CF_CLUSTER_MODE: "bgm_cf_cluster_mode";
    readonly CF_MERGE_MODE: "bgm_cf_merge_mode";
    readonly SHORTCUTS_ENABLED: "bgm_shortcuts_enabled";
    readonly SHORTCUT_BINDINGS: "bgm_shortcut_bindings";
    readonly SHORTCUT_MOUSE: "bgm_shortcut_mouse";
    readonly ACCOUNTS: "bgm_accounts";
    readonly LIST_TYPE: "bgm_list_type";
    readonly TIME_FILTER: "bgm_time_filter";
    readonly REFRESH_INTERVAL: "bgm_refresh_interval";
    readonly EXPORT_PATH: "bgm_export_path";
    readonly IMPORT_PATH: "bgm_import_path";
    readonly ENRICH_EP_SINGLE: "bgm_enrich_ep_single";
    readonly ENRICH_EP_FULL: "bgm_enrich_ep_full";
    readonly ENRICH_FILTER_KEYWORDS: "bgm_enrich_filter_keywords";
    readonly ENRICH_TAGS_COLOR: "bgm_enrich_tags_color";
    readonly ENRICH_PREMIERE_COLOR: "bgm_enrich_premiere_color";
    readonly ENRICH_PLATFORM_COLOR: "bgm_enrich_platform_color";
    readonly ENRICH_AUTO_CLEAN: "bgm_enrich_auto_clean";
    readonly HIGHLIGHT_MODE: "highlight.mode";
    readonly HIGHLIGHT_AUTO_WATCH: "highlight.autoWatch";
    readonly NAV_ORDER: "bgm_nav_order";
    readonly MODULE_COLLAPSED: "bgm_module_collapsed";
    readonly MODULE_HIDDEN: "bgm_module_hidden";
    readonly LOG_LEVEL: "bgm_log_level";
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
 * @param isSilent - 静默模式，不打印日志（用于轮询等高频读取）
 */
export declare function getConfig(key: string, defaultValue?: string, isSilent?: boolean): string;
/**
 * 删除配置值
 * @param key - 配置键名
 */
export declare function removeConfig(key: string): boolean;
/**
 * 设置增量同步开关
 */
export declare function setIncrementalSync(isEnabled: boolean): boolean;
/**
 * 获取增量同步开关状态
 * @param isSilent - 静默模式，不打印日志
 */
export declare function isIncrementalSyncEnabled(isSilent?: boolean): boolean;
/**
 * 设置跳过冲突开关
 */
export declare function setSkipConflicts(isEnabled: boolean): boolean;
/**
 * 获取跳过冲突开关状态
 * @param isSilent - 静默模式，不打印日志
 */
export declare function isSkipConflictsEnabled(isSilent?: boolean): boolean;
/**
 * 设置同步记录开关
 */
export declare function setSyncRecordEnabled(isEnabled: boolean): boolean;
/**
 * 获取同步记录开关状态
 * @param isSilent - 静默模式，不打印日志
 */
export declare function isSyncRecordEnabled(isSilent?: boolean): boolean;
export declare function setNavIconsOnly(isEnabled: boolean): boolean;
export declare function areNavIconsOnly(isSilent?: boolean): boolean;
/**
 * 主题模式四种：
 * - `dark` / `light`：固定
 * - `system`：跟随操作系统（prefers-color-scheme）
 * - `schedule`：按「深色开始 / 浅色开始」两个时刻定时切换（momo 2026-10-26）
 */
declare const THEME_MODES: readonly ["dark", "light", "system", "schedule"];
export type ThemeMode = (typeof THEME_MODES)[number];
export declare function setTheme(mode: string): boolean;
export declare function getTheme(isSilent?: boolean): ThemeMode;
/** 主题定时配置 */
export interface ThemeSchedule {
    /** 是否启用定时切换（关闭则 schedule 模式按深色处理） */
    enabled: boolean;
    /** 深色开始时刻 `HH:MM` */
    darkStart: string;
    /** 浅色开始时刻 `HH:MM` */
    lightStart: string;
}
export declare function setThemeSchedule(schedule: ThemeSchedule): boolean;
export declare function getThemeSchedule(isSilent?: boolean): ThemeSchedule;
/**
 * 按定时配置解析当前应处的主题
 *
 * 语义：`[lightStart, darkStart)` 为浅色区间，其余为深色。
 * 跨零点（darkStart 02:00、lightStart 08:00）也能正确判定。
 */
export declare function resolveScheduledTheme(schedule: ThemeSchedule, now: Date): 'dark' | 'light';
declare const MODAL_BUTTON_POSITIONS: readonly ["inside", "outside"];
/**
 * 模态框按钮位置：
 * - `inside`：底部按钮组（模态框之内，默认）
 * - `outside`：标题栏右上角（模态框之外，与 ⛶/▾ 同排——momo 截图里的样式）
 */
export type ModalButtonsPosition = (typeof MODAL_BUTTON_POSITIONS)[number];
export declare function setModalButtonsPosition(position: string): boolean;
export declare function getModalButtonsPosition(isSilent?: boolean): ModalButtonsPosition;
declare const CLUSTER_MODES: readonly ["formula", "range-formula", "column", "row"];
/**
 * 既有规则自动聚类的分组口径（条件格式页「自动聚类」按钮用）：
 * - `formula`：按公式模式（字面串归一后）—— 默认，最贴近「同一业务含义」；
 * - `range-formula`：按「应用范围 + 公式模式」，同公式不同范围也分开；
 * - `column`：按应用范围的**起始列**分组（`列 J`），适合一列一条规则的宽表；
 * - `row`：按应用范围的**起始行**分组（`行 2`），适合按行铺开的模板。
 */
export type ClusterMode = (typeof CLUSTER_MODES)[number];
/** 口径的中文名（设置页按钮、toast 共用，避免两处各写一份） */
export declare const CLUSTER_MODE_LABELS: Readonly<Record<ClusterMode, string>>;
export declare function setClusterMode(mode: string): boolean;
export declare function getClusterMode(isSilent?: boolean): ClusterMode;
/**
 * 口径的中文名；未知取值原样返回（UI 提示用，避免在调用处再写一次类型断言）
 */
export declare function clusterModeLabel(mode: string): string;
declare const MERGE_MODES: readonly ["adjacent", "union"];
/**
 * 合并重复项的口径：
 * - `adjacent`：只合并行号**连续**的单行规则（安全默认，不会给中间空行加格式）；
 * - `union`：同组内取 min..max **强行并成一块**，中间空行也会被覆盖。
 */
export type MergeMode = (typeof MERGE_MODES)[number];
/** 口径中文名（设置页按钮与 toast 共用） */
export declare const MERGE_MODE_LABELS: Readonly<Record<MergeMode, string>>;
export declare function setMergeMode(mode: string): boolean;
export declare function getMergeMode(isSilent?: boolean): MergeMode;
/** 口径中文名；未知取值原样返回 */
export declare function mergeModeLabel(mode: string): string;
declare const LIST_TYPES: readonly ["all", "collect", "wish", "do"];
export type ListType = (typeof LIST_TYPES)[number];
export declare function setListType(type: string): boolean;
export declare function getListType(isSilent?: boolean): ListType;
declare const TIME_FILTERS: readonly ["all", "year", "quarter", "month", "future"];
export type TimeFilterRange = (typeof TIME_FILTERS)[number];
export declare function setTimeFilter(range: string): boolean;
export declare function getTimeFilter(isSilent?: boolean): TimeFilterRange;
export declare function setRefreshInterval(minutes: number): boolean;
export declare function getRefreshInterval(isSilent?: boolean): number;
/**
 * 设置默认导出位置（文件夹路径）
 */
export declare function setExportPath(path: string): boolean;
/**
 * 获取默认导出位置（文件夹路径），未设置时返回空字符串
 * @param isSilent - 静默模式，不打印日志
 */
export declare function getExportPath(isSilent?: boolean): string;
/**
 * 设置默认导入文件夹
 */
export declare function setImportPath(path: string): boolean;
/**
 * 获取默认导入文件夹，未设置时返回空字符串
 * @param isSilent - 静默模式，不打印日志
 */
export declare function getImportPath(isSilent?: boolean): string;
/**
 * 设置全局日志级别。
 * 除持久化外，还会同步更新内存中的 `BGM.LOG_LEVEL` —— `bgmLog()` 依赖该字段做
 * 过滤，只写存储不更新内存会导致「设置后当前页面日志级别不变」。
 */
export declare function setLogLevel(level: number): boolean;
/**
 * 获取全局日志级别（默认 INFO）
 * @param isSilent - 静默模式，不打印日志
 */
export declare function getLogLevel(isSilent?: boolean): number;
/**
 * 把持久化的日志级别应用到内存（`BGM.LOG_LEVEL`）。
 * 供各页面入口启动时调用一次：`bgmLog()` 默认按 INFO 过滤，
 * 用户此前调高/调低过级别的话，启动时必须重新套用。
 */
export declare function applyLogLevel(): void;
export {};
//# sourceMappingURL=config.d.ts.map