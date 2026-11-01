/**
 * @fileoverview 语言包仓库（加载 / 缓存 / 回退 / 覆盖率）
 * @module i18n/localeStore
 * @description 只管「某个语言有哪些文案」和「当前用哪个语言」这两件事，
 *   **不读写配置、不碰 DOM**——持久化在 {@link module:i18n/index}，
 *   渲染在 {@link module:i18n/dom}。这样单测不需要宿主，也不需要 document。
 *
 * ## 回退链
 * 当前语言 → `zh-CN`（源语言）→ 返回 key 本身。
 *
 * 返回 key 本身而不是空串，是为了让「漏翻译」在界面上可见（`ribbon.buttonOpenSyncPanel`
 * 这种字样一眼能定位），而不是变成一片空白。
 */
import { LOG_LEVELS } from '../core/constants.js';
import { bgmLog } from '../tools/util/index.js';
import { SOURCE_LOCALE, computeCoverage, interpolate, isLocaleCode } from './translate.js';
/** 当前支持的结构版本 */
export const LOCALE_SCHEMA_VERSION = 1;
/** 已加载的语言包（含源语言；源语言也走同一套加载，保证覆盖率有基准） */
const bundles = new Map();
/** 正在进行的加载（同一语言并发请求只发一次） */
const pending = new Map();
/** 当前生效的语言 */
let activeLocale = SOURCE_LOCALE;
/** 已经告警过的缺失 key（每个只 warn 一次，避免每帧刷屏） */
const warnedKeys = new Set();
/** 语言变更监听器 */
const listeners = new Set();
/**
 * 语言包 URL
 *
 * 以**模块自身位置**为基准（`dist-ts/i18n/locale-store.js` → `../../locales/`），
 * 而不是 `document.baseURI`：任务窗格在 `ui/` 下、ribbon 在根目录，两者的相对
 * 路径不同，用文档基准就得维护一张「每个页面各自几层」的表。
 *
 * ## 为什么是 `.js` 而不是 `.json`（真机实测，别再改回去）
 *
 * 安装态的任务窗格跑在 `file://` 下（`ui/settings.html` → `file:///…/jsaddons/<name>/ui/`），
 * 在那里 `fetch('file:///…/locales/zh-CN/locale.json')` 会直接 **`Failed to fetch`**
 * ——CEF 不给 file 源开 connect-src，CSP 的 `'self'` 也不覆盖 file 源。
 * 而 `<script type="module">` 能正常加载（整个插件都靠它跑），所以走 `import()`
 * 这条**已被证明可用**的通道，不新增任何依赖。
 */
export function localeUrl(code) {
    return new URL(`../../locales/${code}/locale.js`, import.meta.url).href;
}
/**
 * 校验宿主拿到的 JSON 是否像一个语言包（脏包直接拒绝，不半信半疑地用）
 *
 * 导出给在线安装复用：下载回来的模块要先过这一关才允许写盘，
 * 两处用同一个校验器才不会出现「装上去了但加载时被拒」的自相矛盾。
 *
 * @param raw `import()` / `JSON.parse` 拿到的原始值
 * @param expected 期望的语言代码（与包内声明不符时以它为准，目录即真相）
 */
export function parseLocaleBundle(raw, expected) {
    if (typeof raw !== 'object' || raw === null) {
        bgmLog(LOG_LEVELS.WARN, `[i18n] 语言包 ${expected} 不是 JSON 对象，已忽略`);
        return null;
    }
    const record = raw;
    const { messages, schemaVersion } = record;
    if (typeof messages !== 'object' || messages === null) {
        bgmLog(LOG_LEVELS.WARN, `[i18n] 语言包 ${expected} 缺少 messages 对象，已忽略`);
        return null;
    }
    if (typeof schemaVersion !== 'number' || schemaVersion !== LOCALE_SCHEMA_VERSION) {
        bgmLog(LOG_LEVELS.WARN, `[i18n] 语言包 ${expected} 的 schemaVersion=${String(schemaVersion)}，期望 ${String(LOCALE_SCHEMA_VERSION)}，已忽略`);
        return null;
    }
    const clean = {};
    for (const [key, value] of Object.entries(messages)) {
        if (typeof value === 'string' && value !== '')
            clean[key] = value;
    }
    const readText = (field, fallback) => {
        const value = record[field];
        return typeof value === 'string' && value !== '' ? value : fallback;
    };
    return {
        schemaVersion,
        code: expected,
        name: readText('name', expected),
        nativeName: readText('nativeName', expected),
        version: readText('version', '0.0.0'),
        updatedAt: readText('updatedAt', ''),
        messages: clean,
    };
}
const defaultImporter = (url) => import(/* @vite-ignore */ url);
let importLocale = defaultImporter;
/** 仅测试用：替换导入器；传 null 复位 */
export function setLocaleImporterForTest(importer) {
    importLocale = importer ?? defaultImporter;
}
/**
 * 加载一个语言包（带缓存 + 并发去重）
 *
 * @returns 成功返回语言包；失败（文件缺失 / 语法错误 / 脏包）返回 null，调用方负责回退
 */
export async function loadLocale(code) {
    const cached = bundles.get(code);
    if (cached !== undefined)
        return cached;
    const inflight = pending.get(code);
    if (inflight !== undefined)
        return inflight;
    const task = (async () => {
        try {
            // 注意：**不能**改回 fetch。安装态页面是 file://，那里 fetch 本地文件直接
            // `Failed to fetch`（2026-11-01 真机实测），只有 ESM 的 import() 能读。
            const module_ = await importLocale(localeUrl(code));
            const bundle = parseLocaleBundle(module_.default, code);
            if (bundle !== null)
                bundles.set(code, bundle);
            return bundle;
        }
        catch (error) {
            // 界面表现只是「没翻译」，看不出是文件缺失还是被拦——协议与完整地址必须一起打出来。
            const detail = error instanceof Error ? error.message : String(error);
            // 非浏览器环境（Node 单测）没有 window，别让日志本身把异常吃掉
            const protocol = typeof window === 'undefined' ? '未知' : window.location.protocol;
            bgmLog(code === SOURCE_LOCALE ? LOG_LEVELS.ERROR : LOG_LEVELS.WARN, `[i18n] 语言包 ${code} 导入失败：${detail}（协议 ${protocol}，地址 ${localeUrl(code)}）`);
            return null;
        }
        finally {
            pending.delete(code);
        }
    })();
    pending.set(code, task);
    return task;
}
/**
 * 直接替换一个语言包（在线安装写盘成功后调用）
 *
 * 为什么不能靠「重新 `loadLocale()`」：ESM 的模块表按 **URL** 缓存，同一个
 * `locales/en/locale.js` 第二次 `import()` 拿到的是**旧模块对象**，加时间戳
 * 查询串在 `file://` 下是否被 CEF 忽略又没法保证（老内核）。所以安装流程
 * 已经手上有解析好的新包，直接塞进来最稳，也免了一次多余的加载。
 *
 * 只改缓存，不切语言、不渲染：要不要立刻应用由调用方决定（装的可能不是当前语言）。
 */
export function replaceLocaleBundle(bundle) {
    bundles.set(bundle.code, bundle);
}
/** 确保源语言已加载（回退与覆盖率都要拿它当基准） */
async function ensureSourceLocale() {
    if (bundles.has(SOURCE_LOCALE))
        return;
    await loadLocale(SOURCE_LOCALE);
}
/**
 * 取某个语言的文案表（未加载返回 undefined）
 *
 * 不做自动加载：`t()` 是同步的，界面渲染路径上不能等网络。
 */
export function getMessages(code) {
    return bundles.get(code)?.messages;
}
/** 取语言包的展示信息（设置页列语言用） */
export function getLocaleBundle(code) {
    return bundles.get(code);
}
/** 该语言的文案表是否已就绪 */
export function hasLocale(code) {
    return bundles.has(code);
}
/** 当前生效的语言 */
export function getActiveLocale() {
    return activeLocale;
}
/** 把已加载的语言设为当前语言（不持久化、不渲染） */
export function useLocale(code) {
    if (!isLocaleCode(code))
        return;
    activeLocale = code;
}
/**
 * 翻译一个 key
 *
 * 回退链：当前语言 → `zh-CN` → key 本身。
 */
export function t(key, variables) {
    const current = bundles.get(activeLocale)?.messages[key];
    if (current !== undefined && current !== '')
        return interpolate(current, variables);
    if (activeLocale !== SOURCE_LOCALE) {
        const fallback = bundles.get(SOURCE_LOCALE)?.messages[key];
        if (fallback !== undefined && fallback !== '') {
            warnOnce(key, `[i18n] ${activeLocale} 缺少 key「${key}」，已回退简体`);
            return interpolate(fallback, variables);
        }
    }
    warnOnce(key, `[i18n] 未知 key「${key}」（简体也没有），已原样输出`);
    return key;
}
/**
 * 取译文；语言包没加载 / 缺 key 时退回调用方给的原文
 *
 * `t()` 在未知 key 时**原样返回 key**。对「文案来自配置数据」的场景（清理规则名、
 * 风险等级这类）这不可接受：数据里本来就存着中文原文，显示 `clean.rule.x.name`
 * 比显示中文更糟。所以这类地方用 `tOr`，把原文当兜底。
 *
 * 注意别拿它替代 `t()` 写普通文案——那样漏翻时会**静默**显示中文，
 * 而 `t()` 至少会把 key 暴露出来。
 */
export function tOr(key, fallback) {
    const text = t(key);
    return text === key ? fallback : text;
}
/** 每个 key 只告警一次 */
function warnOnce(key, message) {
    if (warnedKeys.has(key))
        return;
    warnedKeys.add(key);
    bgmLog(LOG_LEVELS.WARN, message);
}
/** 覆盖率（源语言为 100%；未加载的语言为 0%） */
export function getLocaleCoverage(code) {
    return computeCoverage(bundles.get(SOURCE_LOCALE)?.messages ?? {}, code === SOURCE_LOCALE ? bundles.get(SOURCE_LOCALE)?.messages : bundles.get(code)?.messages);
}
/** 订阅语言变更（返回退订函数） */
export function onLocaleChange(listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
/** 广播语言变更（由 {@link module:i18n/index} 在切换成功后调用） */
export function notifyLocaleChange(code) {
    for (const listener of listeners) {
        try {
            listener(code);
        }
        catch (error) {
            bgmLog(LOG_LEVELS.WARN, `[i18n] 语言变更监听器抛错：${error.message}`);
        }
    }
}
/**
 * 预加载一批语言包（设置页列「可下载语言」时用）
 *
 * 并发加载，单个失败不影响其它——语言包缺一个不该让整个列表空白。
 */
export async function preloadLocales(codes) {
    await ensureSourceLocale();
    await Promise.all(codes.map((code) => loadLocale(code)));
}
/** 仅测试用：复位模块级状态 */
export function resetLocaleStoreForTest() {
    bundles.clear();
    pending.clear();
    listeners.clear();
    warnedKeys.clear();
    activeLocale = SOURCE_LOCALE;
}
/** 仅测试用：直接注入一个语言包（免去构造 fetch 桩） */
export function primeLocaleForTest(bundle) {
    bundles.set(bundle.code, bundle);
}
