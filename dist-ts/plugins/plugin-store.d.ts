import type { InstalledPluginRecord, PluginIndexFile } from './plugin-types.js';
/** 索引在 PluginStorage 里的键名 */
export declare const PLUGIN_INDEX_KEY = "bgm_plugins_index";
/** 解析索引 JSON（坏数据一律当空索引，不抛错） */
export declare function parsePluginIndex(text: string | null): PluginIndexFile;
/** 读索引 */
export declare function loadPluginIndex(): PluginIndexFile;
/** 写索引 */
export declare function savePluginIndex(index: PluginIndexFile): boolean;
/** 按 id 取一条记录 */
export declare function findPluginRecord(id: string): InstalledPluginRecord | null;
/** 新增或覆盖一条记录（写失败只记日志，调用方用 `findPluginRecord` 复查） */
export declare function upsertPluginRecord(record: InstalledPluginRecord): void;
/** 局部更新一条记录（不存在时静默忽略） */
export declare function patchPluginRecord(id: string, partial: Partial<InstalledPluginRecord>): void;
/** 删除一条记录 */
export declare function removePluginRecord(id: string): void;
/** 清空内存回退（单测用） */
export declare function resetPluginIndexForTest(): void;
//# sourceMappingURL=plugin-store.d.ts.map