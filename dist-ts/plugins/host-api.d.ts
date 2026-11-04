import type { PluginLoggerApi, PluginManifest, PluginPermission, PluginStorageApi } from './plugin-types.js';
/** 单元格值 */
export type CellValue = string | number | boolean | null;
/** 标准记录：键是表头文本，值是单元格值 */
export type StandardRecord = Record<string, CellValue>;
/** 插件注册的命令（市场页 / 详情页渲染成按钮） */
export interface PluginCommand {
    id: string;
    title: string;
    run: () => void | Promise<void>;
}
/** 宿主注入给 API 的依赖（页面侧实现，便于单测替换） */
export interface HostApiDependencies {
    hostVersion: string;
    apiVersion: string;
    locale: () => string;
    toast: (message: string, level: 'info' | 'warn' | 'error') => void;
    confirm: (message: string) => Promise<boolean>;
    openPane: (pageId: string) => void;
    registerCommand: (command: PluginCommand) => void;
    translate: (key: string, fallback: string, parameters?: Record<string, string | number>) => string;
    log: PluginLoggerApi;
}
/** 列号转字母（1 → A，27 → AA） */
export declare function columnLetter(column: number): string;
/** 把矩阵转成记录数组（首行是表头） */
export declare function matrixToRecords(matrix: CellValue[][]): StandardRecord[];
/** 把记录数组转成矩阵（按给定表头顺序） */
export declare function recordsToMatrix(records: StandardRecord[], headers: readonly string[]): CellValue[][];
/** 按 `key` 合并记录：已存在的只更新非空字段 */
export declare function mergeRecords(existing: StandardRecord[], incoming: StandardRecord[], key: string): StandardRecord[];
/**
 * 插件私有存储：键加 `plugin:<id>:` 前缀，值序列化成 JSON。
 *
 * 宿主的 `PluginStorage` 只有 `getItem/setItem/removeItem`（**没有枚举能力**），
 * 卸载时想清干净就必须自己记账：每次 `set` 把键名登记到 `<前缀>#keys`，
 * 卸载方（`plugin-market`）读这张表逐个删。登记表本身也占一个键，`clear` 时一并删掉。
 */
export declare function createPluginStorage(id: string): PluginStorageApi;
/** 按权限构造 `host` 对象 */
export declare function createHostApi(manifest: PluginManifest, granted: ReadonlySet<PluginPermission>, dependencies: HostApiDependencies): Record<string, unknown>;
//# sourceMappingURL=host-api.d.ts.map