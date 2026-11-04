/**
 * @fileoverview 已装插件索引的持久化
 * @module plugins/pluginStore
 * @description 索引存在 `PluginStorage` 的 `bgm_plugins_index` 键里（JSON 字符串）。
 *   为什么不写 `plugins/index.json`：写文件只有 FSO 一条路，且安装态页面读本地文件
 *   只能靠 `import()`（读不了任意 JSON），索引放在宿主存储里反而更可靠、可迁移。
 *
 *   单测 / 无宿主环境用内存回退，行为与真实存储一致（只是不落盘）。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { bgmLog, getApp } from '../tools/util/index.js';
import { PLUGIN_SCHEMA_VERSION } from './plugin-types.js';
/** 索引在 PluginStorage 里的键名 */
export const PLUGIN_INDEX_KEY = 'bgm_plugins_index';
/** 单测用的内存索引（无宿主时读写它） */
let memoryIndex = null;
/** 取宿主 PluginStorage（没有则返回 null，走内存回退） */
function getStorage() {
    try {
        const app = getApp();
        const storage = app?.PluginStorage;
        if (storage === undefined ||
            typeof storage.getItem !== 'function' ||
            typeof storage.setItem !== 'function') {
            return null;
        }
        return storage;
    }
    catch {
        return null;
    }
}
/** 空索引 */
function emptyIndex() {
    return { schemaVersion: PLUGIN_SCHEMA_VERSION, plugins: [] };
}
/** 把任意值收窄成索引项（丢弃结构不对的项，避免一条坏数据毁掉整个列表） */
function toRecord(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const item = value;
    const { id, name, version, author, installedAt } = item;
    if (typeof id !== 'string' ||
        typeof name !== 'string' ||
        typeof version !== 'string' ||
        typeof author !== 'string' ||
        typeof installedAt !== 'string') {
        return null;
    }
    const source = item.source;
    if (source === undefined || typeof source.kind !== 'string' || typeof source.value !== 'string') {
        return null;
    }
    const { kind } = source;
    if (kind !== 'github' && kind !== 'api' && kind !== 'local')
        return null;
    const record = {
        id,
        name,
        version,
        author,
        installedAt,
        enabled: item.enabled !== false,
        source: { kind, value: source.value },
    };
    if (Array.isArray(item.permissions)) {
        const permissions = item.permissions.filter((permission) => typeof permission === 'string');
        record.permissions = permissions;
    }
    if (Array.isArray(item.network)) {
        record.network = item.network.filter((host) => typeof host === 'string');
    }
    if (typeof item.lastCheckedAt === 'string')
        record.lastCheckedAt = item.lastCheckedAt;
    if (typeof item.minHostVersion === 'string')
        record.minHostVersion = item.minHostVersion;
    if (typeof item.dataSourceVersion === 'string') {
        record.dataSourceVersion = item.dataSourceVersion;
    }
    if (item.pendingReload === true)
        record.pendingReload = true;
    // 签名结论必须持久化：更新链路靠它判「信任是否变差」，丢了就每次都要重新确认
    if (isSignatureStatus(item.signatureStatus))
        record.signatureStatus = item.signatureStatus;
    if (Array.isArray(item.pendingPermissions)) {
        record.pendingPermissions = item.pendingPermissions.filter((permission) => typeof permission === 'string');
    }
    return record;
}
/** 已知的签名结论集合（用于把持久化数据收窄回联合类型） */
const SIGNATURE_STATUSES = new Set([
    'verified',
    'unsigned',
    'untrusted-key',
    'invalid',
    'unsupported',
]);
/** 收窄签名结论（未知值一律丢弃，不做兜底猜测） */
function isSignatureStatus(value) {
    return typeof value === 'string' && SIGNATURE_STATUSES.has(value);
}
/** 解析索引 JSON（坏数据一律当空索引，不抛错） */
export function parsePluginIndex(text) {
    if (text === null || text.trim() === '')
        return emptyIndex();
    try {
        const raw = JSON.parse(text);
        if (typeof raw !== 'object' || raw === null)
            return emptyIndex();
        const { plugins } = raw;
        if (!Array.isArray(plugins))
            return emptyIndex();
        const records = [];
        for (const item of plugins) {
            const record = toRecord(item);
            if (record !== null)
                records.push(record);
        }
        return { schemaVersion: PLUGIN_SCHEMA_VERSION, plugins: records };
    }
    catch {
        return emptyIndex();
    }
}
/** 读索引 */
export function loadPluginIndex() {
    const storage = getStorage();
    if (storage === null) {
        return memoryIndex ?? emptyIndex();
    }
    try {
        return parsePluginIndex(storage.getItem(PLUGIN_INDEX_KEY));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bgmLog(LOG_LEVELS.WARN, `[plugins] 读取插件索引失败：${message}`);
        return emptyIndex();
    }
}
/** 写索引 */
export function savePluginIndex(index) {
    const payload = JSON.stringify(index);
    const storage = getStorage();
    if (storage === null) {
        memoryIndex = index;
        return true;
    }
    try {
        storage.setItem(PLUGIN_INDEX_KEY, payload);
        return true;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bgmLog(LOG_LEVELS.WARN, `[plugins] 保存插件索引失败：${message}`);
        return false;
    }
}
/** 按 id 取一条记录 */
export function findPluginRecord(id) {
    return loadPluginIndex().plugins.find((item) => item.id === id) ?? null;
}
/** 新增或覆盖一条记录（写失败只记日志，调用方用 `findPluginRecord` 复查） */
export function upsertPluginRecord(record) {
    const index = loadPluginIndex();
    const position = index.plugins.findIndex((item) => item.id === record.id);
    if (position === -1) {
        index.plugins.push(record);
    }
    else {
        index.plugins[position] = record;
    }
    savePluginIndex(index);
}
/** 局部更新一条记录（不存在时静默忽略） */
export function patchPluginRecord(id, partial) {
    const index = loadPluginIndex();
    const position = index.plugins.findIndex((item) => item.id === id);
    if (position === -1)
        return;
    const current = index.plugins[position];
    if (current === undefined)
        return;
    index.plugins[position] = { ...current, ...partial };
    savePluginIndex(index);
}
/** 删除一条记录 */
export function removePluginRecord(id) {
    const index = loadPluginIndex();
    const next = index.plugins.filter((item) => item.id !== id);
    if (next.length === index.plugins.length)
        return;
    savePluginIndex({ schemaVersion: PLUGIN_SCHEMA_VERSION, plugins: next });
}
/** 清空内存回退（单测用） */
export function resetPluginIndexForTest() {
    memoryIndex = null;
}
