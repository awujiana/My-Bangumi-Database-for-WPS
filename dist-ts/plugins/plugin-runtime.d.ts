import type { HostApiDependencies, PluginCommand } from './host-api.js';
import type { InstalledPluginRecord, LoadedPlugin, PluginLoggerApi, PluginManifest } from './plugin-types.js';
/** 加载结果 */
export type PluginActivateResult = {
    ok: true;
    plugin: LoadedPlugin;
} | {
    ok: false;
    reason: string;
};
/** 造一个带插件 id 前缀的 logger */
export declare function createPluginLogger(id: string, write: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void): PluginLoggerApi;
/**
 * 加载并激活一个已安装插件。
 *
 * @param rootUrl 加载项目录 URL
 * @param record 索引记录
 * @param manifest 插件清单（从索引记录还原，见 `manifestFromRecord`）
 * @param dependencies 宿主 API 依赖
 */
export declare function activatePlugin(rootUrl: URL, record: InstalledPluginRecord, manifest: PluginManifest, dependencies: HostApiDependencies): Promise<PluginActivateResult>;
/** 停用一个插件（调用 deactivate + 清理 disposables） */
export declare function deactivatePlugin(id: string): Promise<void>;
/** 停用全部插件（页面卸载时调用） */
export declare function deactivateAllPlugins(): Promise<void>;
/** 取已加载的插件 */
export declare function getLoadedPlugin(id: string): LoadedPlugin | null;
/** 取全部已加载的插件 id */
export declare function listLoadedPluginIds(): string[];
/** 取某插件注册的命令 */
export declare function listPluginCommands(id: string): PluginCommand[];
/**
 * 从索引记录还原一份最小清单。
 *
 * 索引里只存了构造 API 必需的 id / name / version / author / permissions / network ——
 * 权限与白名单决定「给不给能力」，其余字段（features / homepage / checksum）由市场页
 * 在联网拉清单时补全，离线时降级展示。
 */
export declare function manifestFromRecord(record: InstalledPluginRecord): PluginManifest;
/** 标记插件「已加载」，供市场页显示运行状态 */
export declare function markPluginLoaded(id: string, version: string): void;
//# sourceMappingURL=plugin-runtime.d.ts.map