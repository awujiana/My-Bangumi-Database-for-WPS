/**
 * @fileoverview 语言包清单（`locales/index.js`）：解析、校验、在线获取
 * @module i18n/localeManifest
 *
 * @description
 *   清单是「有哪些语言包、各自什么版本、下载下来该是什么哈希」的唯一真相。
 *   设置页的「更新语言包」拿它当发布端的承诺：清单说 sha256=X、bytes=N，
 *   下载完就按这个值校验，对不上一个字节都不写盘。
 *
 * ## 为什么清单也是 `.js` 而不是 `.json`
 *
 * 与语言包同一个理由（见 {@link module:i18n/localeStore} 的 `localeUrl`）：
 * 安装态页面跑在 `file://` 下，`fetch` 读本地文件会被 CEF 直接拦掉
 * （2026-11-01 真机实测 `Failed to fetch`），只有 `import()` 能读。
 * 在线那份走 `fetch`（`https://` 不受此限），所以两条通道各读各的。
 *
 * ## 为什么不校验「本地已装的包是不是最新」
 *
 * 做不到，也不该假装做得到：本地语言包是 UTF-8 源码，而落盘用的是 FSO
 * （只能写 UTF-16 或系统 ANSI），装完之后磁盘上的字节与仓库里的字节**必然不同**，
 * 拿清单里的 sha256 去比本地文件永远是「不一致」。所以：
 *   - 校验只发生在**下载到写盘之间**（比的是下载到的字节，这才是供应链那一关）；
 *   - 「要不要更新」看清单里的 `version` / `updatedAt`，不看哈希。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { UPDATE_OWNER, UPDATE_REPO } from '../tools/update-check.js';
import { bgmLog } from '../tools/util/index.js';
import { SOURCE_LOCALE, isLocaleCode } from './translate.js';
/** 清单结构版本（与 `scripts/gen-locale-index.mjs` 的 `INDEX_SCHEMA_VERSION` 保持一致） */
export const MANIFEST_SCHEMA_VERSION = 1;
/** raw CDN 上的仓库基址（与更新包、数据同步同一个仓库 / 同一条分支） */
const RAW_BASE = `https://raw.githubusercontent.com/${UPDATE_OWNER}/${UPDATE_REPO}/main`;
/** 合法的 SHA-256（64 位小写十六进制） */
const SHA256_PATTERN = /^[\da-f]{64}$/u;
/**
 * 剥掉 `export default …;` 外壳，取出纯 JSON 文本
 *
 * 清单与语言包是同一个外壳（`export default` 后面跟纯 JSON），两边共用这段逻辑。
 * 前缀里的文件头注释（含中文）会被一并剥掉——它们不是数据。
 */
export function stripModuleWrapper(text) {
    return text.replace(/^[\s\S]*?export\s+default\s+/u, '').replace(/;\s*$/u, '');
}
/**
 * 把「生成物模块」的源码解析成对象
 *
 * 这是**安全边界**：`import()` 会把模块当代码执行，而这里只做 `JSON.parse`，
 * 所以「`export default` 之后还夹带了别的语句」的包会直接解析失败、被拒之门外。
 *
 * @returns 解析结果；不是合法 JSON 返回 null
 */
export function parseModuleJson(text) {
    try {
        return JSON.parse(stripModuleWrapper(text));
    }
    catch {
        return null;
    }
}
/** 读字符串字段（缺失或类型不对时给空串，交由调用方决定怎么处理） */
function readString(record, field) {
    const value = record[field];
    return typeof value === 'string' ? value : '';
}
/** 读非负数字字段（缺失/类型不对/负数一律给 -1，便于判「不合法」） */
function readCount(record, field) {
    const value = record[field];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : -1;
}
/** 解析单条语言条目（不合法的条目丢掉而不是让整份清单作废） */
function parseManifestEntry(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const record = raw;
    const code = readString(record, 'code');
    if (!isLocaleCode(code)) {
        bgmLog(LOG_LEVELS.WARN, `[i18n] 清单里有不受支持的语言「${code}」，已忽略`);
        return null;
    }
    const sha256 = readString(record, 'sha256').trim().toLowerCase();
    if (!SHA256_PATTERN.test(sha256)) {
        // 没有哈希就等于没有校验，装上去只能靠运气——宁可当成「这个语言不可用」
        bgmLog(LOG_LEVELS.WARN, `[i18n] 清单里 ${code} 的 sha256 不合法，已忽略`);
        return null;
    }
    const bytes = readCount(record, 'bytes');
    if (bytes <= 0) {
        bgmLog(LOG_LEVELS.WARN, `[i18n] 清单里 ${code} 的 bytes 不合法，已忽略`);
        return null;
    }
    return {
        code,
        name: readString(record, 'name') || code,
        nativeName: readString(record, 'nativeName') || code,
        version: readString(record, 'version') || '0.0.0',
        updatedAt: readString(record, 'updatedAt'),
        keyCount: readCount(record, 'keyCount'),
        coverage: readCount(record, 'coverage'),
        sha256,
        bytes,
    };
}
/**
 * 校验并规整一份清单
 *
 * 严格拒绝而不是「能用就用」：清单说错话的后果是**下载下来的包被自己拒掉**，
 * 界面只会显示「校验失败」，排查时毫无线索。宁可在加载阶段就判定不可用。
 *
 * @returns 规整后的清单；结构不对 / 一条可用语言都没有时返回 null
 */
export function parseLocaleManifest(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const record = raw;
    const { schemaVersion } = record;
    if (typeof schemaVersion !== 'number' || schemaVersion !== MANIFEST_SCHEMA_VERSION) {
        bgmLog(LOG_LEVELS.WARN, `[i18n] 清单 schemaVersion=${String(schemaVersion)}，期望 ${String(MANIFEST_SCHEMA_VERSION)}，已忽略`);
        return null;
    }
    const sourceLocale = readString(record, 'sourceLocale');
    if (sourceLocale !== SOURCE_LOCALE) {
        bgmLog(LOG_LEVELS.WARN, `[i18n] 清单 sourceLocale=「${sourceLocale}」，期望「${SOURCE_LOCALE}」，已忽略`);
        return null;
    }
    const { locales: rawEntries } = record;
    if (!Array.isArray(rawEntries))
        return null;
    const locales = [];
    for (const item of rawEntries) {
        const entry = parseManifestEntry(item);
        // 同一语言重复出现时只认第一条：后面的可能是手工拼进去的脏数据
        if (entry !== null && locales.every((existing) => existing.code !== entry.code)) {
            locales.push(entry);
        }
    }
    if (locales.length === 0) {
        bgmLog(LOG_LEVELS.WARN, '[i18n] 清单里没有任何可用的语言条目');
        return null;
    }
    return { schemaVersion, sourceLocale, keyCount: readCount(record, 'keyCount'), locales };
}
/**
 * 内置清单的 URL
 *
 * 以**模块自身位置**为基准（`dist-ts/i18n/locale-manifest.js` → `../../locales/`），
 * 与 `localeUrl()` 同一个理由：任务窗格在 `ui/` 下、ribbon 在根目录，
 * 用文档基准就得维护「每个页面各自几层」的表。
 */
export function bundledManifestUrl() {
    return new URL('../../locales/index.js', import.meta.url).href;
}
/** 某个语言包在 raw CDN 上的地址 */
export function remoteLocaleModuleUrl(code) {
    return `${RAW_BASE}/locales/${code}/locale.js`;
}
/** 清单在 raw CDN 上的地址 */
export function remoteManifestUrl() {
    return `${RAW_BASE}/locales/index.js`;
}
/** 用 fetch 读一份文本（非 2xx 直接抛错，错误里带状态码） */
export async function fetchText(url, fetchFunction) {
    const response = await fetchFunction(url);
    if (!response.ok) {
        throw new Error(`HTTP ${String(response.status)} ${response.statusText}`.trim());
    }
    return response.text();
}
const defaultImporter = (url) => import(/* @vite-ignore */ url);
let importManifest = defaultImporter;
/** 仅测试用：替换导入器；传 null 复位 */
export function setManifestImporterForTest(importer) {
    importManifest = importer ?? defaultImporter;
}
/**
 * 加载清单：优先在线，失败回落内置
 *
 * 在线清单的价值：修一处译文错字不必等发新版本插件。取不到就回落内置，
 * 界面照常可用——语言包本身是随插件发布的，缺了在线清单不影响已有语言。
 *
 * 两处失败都要记住原因：在线失败是常态（断网 / 代理），不该刷 ERROR；
 * 但内置也失败就说明插件装坏了，此时 `detail` 里两段原因都要留着，否则没法排查。
 */
export async function loadLocaleManifest(options = {}) {
    const { fetchFunction } = options;
    let remoteDetail = '';
    if (fetchFunction !== undefined) {
        try {
            const text = await fetchText(remoteManifestUrl(), fetchFunction);
            const manifest = parseLocaleManifest(parseModuleJson(text));
            if (manifest !== null)
                return { manifest, origin: 'remote', detail: '' };
            remoteDetail = '在线清单格式不正确';
        }
        catch (error) {
            remoteDetail = error instanceof Error ? error.message : String(error);
        }
        bgmLog(LOG_LEVELS.WARN, `[i18n] 在线清单不可用（${remoteDetail}），改用内置清单`);
    }
    try {
        const module_ = await importManifest(bundledManifestUrl());
        const manifest = parseLocaleManifest(module_.default);
        if (manifest !== null)
            return { manifest, origin: 'bundled', detail: '' };
        return {
            manifest: null,
            origin: 'none',
            detail: remoteDetail === '' ? '内置清单格式不正确' : `${remoteDetail}；内置清单格式不正确`,
        };
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
            manifest: null,
            origin: 'none',
            detail: remoteDetail === '' ? detail : `${remoteDetail}；${detail}`,
        };
    }
}
/** 取某个语言在清单里的条目 */
export function findManifestEntry(manifest, code) {
    return manifest.locales.find((entry) => entry.code === code);
}
/**
 * 比较「本地已装」与「清单声明」
 *
 * 比的是 `version` + `updatedAt`，不是哈希——理由见文件头注释。
 * 两个字段都要对上才算「一致」：只改文案不改版本号时，至少 `updatedAt` 还能兜住。
 */
export function comparePackState(entry, installed) {
    if (installed === undefined)
        return 'missing';
    const isSameVersion = installed.version === entry.version;
    const isSameDate = installed.updatedAt === entry.updatedAt;
    return isSameVersion && isSameDate ? 'current' : 'outdated';
}
