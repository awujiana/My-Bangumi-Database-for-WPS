/**
 * @fileoverview 宿主 API 的构造与权限裁剪
 * @module plugins/hostApi
 * @description 按插件声明的权限**构造** `host` 对象：没授权的成员根本不存在，
 *   而不是「存在但抛错」—— 插件用 `typeof` 检查即可降级（`PLUGIN-SPEC.md` §5.2）。
 *
 *   表格读写直接走 WPS COM，与宿主自身实现同源；`data.*` 是建立在 `sheet.*` 之上的
 *   记录层，负责「表头 ↔ 记录对象」的转换，插件不需要关心列号。
 */
import { LOG_LEVELS, STANDARD_HEADERS } from '../core/constants.js';
import { getApp, bgmLog } from '../tools/util/index.js';
import { isHostAllowed } from './plugin-manifest.js';
/** 取 WPS Application（拿不到返回 null） */
function getApp_() {
    try {
        return getApp();
    }
    catch {
        return null;
    }
}
/** 取工作表集合 */
function getWorksheets() {
    const app = getApp_();
    const worksheets = app?.ActiveWorkbook?.Worksheets;
    if (worksheets === undefined)
        return null;
    return worksheets;
}
/** 列出工作表名 */
function listSheetNames() {
    const worksheets = getWorksheets();
    if (worksheets === null)
        return [];
    const count = worksheets.Count ?? 0;
    const names = [];
    for (let index = 1; index <= count; index += 1) {
        const sheet = worksheets.Item?.(index);
        if (sheet?.Name !== undefined)
            names.push(sheet.Name);
    }
    return names;
}
/** 按名字取工作表 */
function getSheet(name) {
    const worksheets = getWorksheets();
    if (worksheets === null)
        return null;
    try {
        return worksheets.Item?.(name) ?? null;
    }
    catch {
        return null;
    }
}
/** 列号转字母（1 → A，27 → AA） */
export function columnLetter(column) {
    let value = Math.max(1, Math.trunc(column));
    let result = '';
    while (value > 0) {
        const remainder = (value - 1) % 26;
        result = String.fromCodePoint(65 + remainder) + result;
        value = Math.trunc((value - 1) / 26);
    }
    return result;
}
/** 把 `Value2` 归一成二维数组（单格时 WPS 返回标量） */
function toMatrix(value) {
    if (value === null || value === undefined)
        return [];
    if (!Array.isArray(value))
        return [[value]];
    return value.map((row) => (Array.isArray(row) ? row : [row]));
}
/** 读一张表的全部内容（上限 5 万行，防把内存打爆） */
function readSheetMatrix(name) {
    const sheet = getSheet(name);
    if (sheet === null)
        return [];
    const matrix = toMatrix(sheet.UsedRange?.Value2);
    return matrix.slice(0, 50_000);
}
/** 写矩形区域（`rows` 为二维数组，从 1 起算的行列号） */
function saveSheetMatrix(name, row, column, rows) {
    const sheet = getSheet(name);
    if (sheet === null || rows.length === 0)
        return false;
    const columnCount = Math.max(...rows.map((line) => line.length));
    const lastRow = row + rows.length - 1;
    const lastColumn = column + columnCount - 1;
    const address = `${columnLetter(column)}${String(row)}:${columnLetter(lastColumn)}${String(lastRow)}`;
    const range = sheet.Range?.(address);
    if (range === undefined)
        return false;
    const normalized = rows.map((line) => {
        const copy = [];
        for (let index = 0; index < columnCount; index += 1) {
            copy.push(line[index] ?? null);
        }
        return copy;
    });
    range.Value2 = normalized;
    return true;
}
/** 新建工作表 */
function addSheet(name) {
    const worksheets = getWorksheets();
    if (worksheets === null || typeof worksheets.Add !== 'function')
        return false;
    const created = worksheets.Add();
    if (created === null)
        return false;
    created.Name = name;
    return true;
}
/** 删除工作表 */
function removeSheet(name) {
    const sheet = getSheet(name);
    if (sheet === null || typeof sheet.Delete !== 'function')
        return false;
    sheet.Delete();
    return true;
}
/** 把矩阵转成记录数组（首行是表头） */
export function matrixToRecords(matrix) {
    const [header, ...rows] = matrix;
    if (header === undefined)
        return [];
    const headers = header.map((cell) => (cell === null ? '' : String(cell).trim()));
    return rows
        .filter((line) => line.some((cell) => cell !== null && cell !== ''))
        .map((line) => {
        const record = {};
        for (const [index, key] of headers.entries()) {
            if (key !== '')
                record[key] = line[index] ?? null;
        }
        return record;
    });
}
/** 把记录数组转成矩阵（按给定表头顺序） */
export function recordsToMatrix(records, headers) {
    const matrix = [headers.map((header) => header)];
    for (const record of records) {
        matrix.push(headers.map((header) => record[header] ?? null));
    }
    return matrix;
}
/** 「空单元格」的判定集合：合并时这三种值不覆盖已有数据 */
const EMPTY_CELL_VALUES = new Set([null, undefined, '']);
/** 取记录里作为合并键的值（空值视为没有标识） */
function readIdentity(record, key) {
    const value = record[key];
    if (EMPTY_CELL_VALUES.has(value))
        return null;
    return String(value);
}
/** 把 `source` 的非空字段覆盖到 `base` 上，返回新对象（不修改入参） */
function mergeInto(base, source) {
    const result = { ...base };
    for (const [field, value] of Object.entries(source)) {
        if (!EMPTY_CELL_VALUES.has(value))
            result[field] = value;
    }
    return result;
}
/** 按 `key` 合并记录：已存在的只更新非空字段 */
export function mergeRecords(existing, incoming, key) {
    const index = new Map();
    for (const record of existing) {
        const identity = readIdentity(record, key);
        if (identity !== null)
            index.set(identity, record);
    }
    for (const record of incoming) {
        const identity = readIdentity(record, key);
        if (identity !== null) {
            const current = index.get(identity);
            if (current === undefined) {
                index.set(identity, record);
            }
            else {
                index.set(identity, mergeInto(current, record));
            }
        }
    }
    return [...index.values()];
}
/**
 * 插件私有存储：键加 `plugin:<id>:` 前缀，值序列化成 JSON。
 *
 * 宿主的 `PluginStorage` 只有 `getItem/setItem/removeItem`（**没有枚举能力**），
 * 卸载时想清干净就必须自己记账：每次 `set` 把键名登记到 `<前缀>#keys`，
 * 卸载方（`plugin-market`）读这张表逐个删。登记表本身也占一个键，`clear` 时一并删掉。
 */
export function createPluginStorage(id) {
    const prefix = `plugin:${id}:`;
    const registryKey = '#keys';
    const memory = new Map();
    const readRaw = (key) => {
        try {
            const app = getApp();
            const storage = app?.PluginStorage;
            if (storage === undefined)
                return memory.get(key) ?? null;
            return storage.getItem(prefix + key);
        }
        catch {
            return memory.get(key) ?? null;
        }
    };
    const storeRaw = (key, value) => {
        try {
            const app = getApp();
            const storage = app?.PluginStorage;
            if (storage === undefined) {
                if (value === null)
                    memory.delete(key);
                else
                    memory.set(key, value);
                return true;
            }
            if (value === null) {
                storage.removeItem?.(prefix + key);
            }
            else {
                storage.setItem(prefix + key, value);
            }
            return true;
        }
        catch {
            return false;
        }
    };
    /** 读键登记表（坏数据当空表） */
    const readRegistry = () => {
        const raw = readRaw(registryKey);
        if (raw === null)
            return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed)
                ? parsed.filter((item) => typeof item === 'string')
                : [];
        }
        catch {
            return [];
        }
    };
    const writeRegistry = (keys) => {
        storeRaw(registryKey, JSON.stringify(keys));
    };
    const readValue = (key) => {
        const raw = readRaw(key);
        if (raw === null)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    };
    const storeValue = (key, value) => {
        try {
            const isStored = storeRaw(key, JSON.stringify(value));
            if (isStored && !readRegistry().includes(key))
                writeRegistry([...readRegistry(), key]);
            return isStored;
        }
        catch {
            return false;
        }
    };
    /** 删一个键并从登记表里划掉 */
    const removeValue = (key) => {
        const isRemoved = storeRaw(key, null);
        const registry = readRegistry();
        if (registry.includes(key))
            writeRegistry(registry.filter((item) => item !== key));
        return isRemoved;
    };
    const listKeys = () => readRegistry();
    const clearKeys = () => {
        for (const key of readRegistry())
            storeRaw(key, null);
        storeRaw(registryKey, null);
        return true;
    };
    // 五个方法都走同步实现，统一包成 Promise —— 与 `PluginStorageApi` 的异步契约一致，
    // 又不必为「没有 await 的 async」写空转（`@typescript-eslint/require-await`）。
    return {
        get: (key) => Promise.resolve(readValue(key)),
        set: (key, value) => Promise.resolve(storeValue(key, value)),
        remove: (key) => Promise.resolve(removeValue(key)),
        keys: () => Promise.resolve(listKeys()),
        clear: () => Promise.resolve(clearKeys()),
    };
}
/** 按权限构造 `host` 对象 */
export function createHostApi(manifest, granted, dependencies) {
    const host = {
        version: dependencies.hostVersion,
        apiVersion: dependencies.apiVersion,
        plugin: { id: manifest.id, version: manifest.version },
        locale: dependencies.locale(),
    };
    if (granted.has('log')) {
        host.log = dependencies.log;
    }
    if (granted.has('sheet.read') || granted.has('sheet.write')) {
        const sheet = {};
        if (granted.has('sheet.read')) {
            sheet.list = listSheetNames;
            sheet.active = () => getApp_()?.ActiveSheet?.Name ?? '';
            sheet.read = (name) => readSheetMatrix(name);
            sheet.readRange = (name, row, column, rowCount, columnCount) => readSheetMatrix(name)
                .slice(row - 1, row - 1 + rowCount)
                .map((line) => line.slice(column - 1, column - 1 + columnCount));
        }
        if (granted.has('sheet.write')) {
            sheet.writeRange = saveSheetMatrix;
            sheet.add = addSheet;
            sheet.remove = removeSheet;
        }
        host.sheet = sheet;
    }
    if (granted.has('data.read') || granted.has('data.write')) {
        const data = {};
        if (granted.has('data.read')) {
            data.headers = () => [...STANDARD_HEADERS];
            data.read = (options) => {
                const name = options?.sheetName ?? getApp_()?.ActiveSheet?.Name ?? '';
                return matrixToRecords(readSheetMatrix(name));
            };
        }
        if (granted.has('data.write')) {
            data.write = (records, options) => {
                const sheetName = options?.sheetName ?? getApp_()?.ActiveSheet?.Name ?? '';
                const mode = options?.mode ?? 'append';
                const key = options?.key ?? 'id';
                const headers = [...STANDARD_HEADERS];
                if (mode === 'replace') {
                    return saveSheetMatrix(sheetName, 1, 1, recordsToMatrix(records, headers));
                }
                const existing = matrixToRecords(readSheetMatrix(sheetName));
                const merged = mode === 'merge' ? mergeRecords(existing, records, key) : [...existing, ...records];
                return saveSheetMatrix(sheetName, 1, 1, recordsToMatrix(merged, headers));
            };
        }
        host.data = data;
    }
    if (granted.has('net.fetch')) {
        const network = manifest.network ?? [];
        const ensureHostAllowed = (url) => {
            if (!isHostAllowed(url, network)) {
                throw new Error(`域名不在白名单内：${url}`);
            }
        };
        host.net = {
            fetch: async (url, requestOptions) => {
                ensureHostAllowed(url);
                const response = await fetch(url, { ...requestOptions, cache: 'no-store' });
                return {
                    status: response.status,
                    headers: Object.fromEntries(response.headers.entries()),
                    body: await response.text(),
                };
            },
            fetchJson: async (url) => {
                ensureHostAllowed(url);
                const response = await fetch(url, { cache: 'no-store' });
                return (await response.json());
            },
            fetchBytes: async (url) => {
                ensureHostAllowed(url);
                const response = await fetch(url, { cache: 'no-store' });
                return new Uint8Array(await response.arrayBuffer());
            },
        };
    }
    if (granted.has('storage')) {
        host.storage = createPluginStorage(manifest.id);
    }
    // registerCommand 不占权限：没有 ui.toast 的插件也能挂命令
    const uiApi = { registerCommand: dependencies.registerCommand };
    if (granted.has('ui.toast')) {
        uiApi.toast = dependencies.toast;
        uiApi.confirm = dependencies.confirm;
        uiApi.progress = (options) => {
            let done = 0;
            const title = options.title ?? manifest.name;
            return {
                update: (step, message) => {
                    done = step;
                    if (message !== undefined) {
                        bgmLog(LOG_LEVELS.INFO, `[plugin:${manifest.id}] ${message}`);
                    }
                },
                done: () => {
                    bgmLog(LOG_LEVELS.INFO, `[plugin:${manifest.id}] ${title} 完成 ${String(done)}/${String(options.total ?? 0)}`);
                },
            };
        };
    }
    if (granted.has('ui.pane')) {
        uiApi.openPane = dependencies.openPane;
    }
    host.ui = uiApi;
    host.i18n = { t: dependencies.translate, locale: dependencies.locale() };
    return host;
}
