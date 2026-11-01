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
import type { LocaleCode, LocaleCoverage, LocaleMessages } from './translate.js';
/** 语言包文件的 JSON 结构 */
export interface LocaleBundle {
    /** 结构版本：将来改格式时用来拒绝旧包 */
    schemaVersion: number;
    /** 语言代码（必须与目录名一致） */
    code: string;
    /** 英文名（列表里显示） */
    name: string;
    /** 母语名（列表里显示） */
    nativeName: string;
    /** 语言包自身版本 */
    version: string;
    /** 最后更新日期 */
    updatedAt: string;
    /** key → 文案 */
    messages: Record<string, string>;
}
/** 当前支持的结构版本 */
export declare const LOCALE_SCHEMA_VERSION = 1;
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
export declare function localeUrl(code: LocaleCode): string;
/**
 * 校验宿主拿到的 JSON 是否像一个语言包（脏包直接拒绝，不半信半疑地用）
 *
 * 导出给在线安装复用：下载回来的模块要先过这一关才允许写盘，
 * 两处用同一个校验器才不会出现「装上去了但加载时被拒」的自相矛盾。
 *
 * @param raw `import()` / `JSON.parse` 拿到的原始值
 * @param expected 期望的语言代码（与包内声明不符时以它为准，目录即真相）
 */
export declare function parseLocaleBundle(raw: unknown, expected: LocaleCode): LocaleBundle | null;
/**
 * 语言包导入器
 *
 * 生产环境就是原生动态 `import()`；单测可以整只替换（见 {@link setLocaleImporterForTest}），
 * 这样「文件不存在 / 语法错误 / 没有 default 导出」三种失败都能被测到，
 * 而不需要真的往磁盘上写一堆坏模块。
 */
type LocaleImporter = (url: string) => Promise<{
    default?: unknown;
}>;
/** 仅测试用：替换导入器；传 null 复位 */
export declare function setLocaleImporterForTest(importer: LocaleImporter | null): void;
/**
 * 加载一个语言包（带缓存 + 并发去重）
 *
 * @returns 成功返回语言包；失败（文件缺失 / 语法错误 / 脏包）返回 null，调用方负责回退
 */
export declare function loadLocale(code: LocaleCode): Promise<LocaleBundle | null>;
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
export declare function replaceLocaleBundle(bundle: LocaleBundle): void;
/**
 * 取某个语言的文案表（未加载返回 undefined）
 *
 * 不做自动加载：`t()` 是同步的，界面渲染路径上不能等网络。
 */
export declare function getMessages(code: LocaleCode): LocaleMessages | undefined;
/** 取语言包的展示信息（设置页列语言用） */
export declare function getLocaleBundle(code: LocaleCode): LocaleBundle | undefined;
/** 该语言的文案表是否已就绪 */
export declare function hasLocale(code: LocaleCode): boolean;
/** 当前生效的语言 */
export declare function getActiveLocale(): LocaleCode;
/** 把已加载的语言设为当前语言（不持久化、不渲染） */
export declare function useLocale(code: LocaleCode): void;
/**
 * 翻译一个 key
 *
 * 回退链：当前语言 → `zh-CN` → key 本身。
 */
export declare function t(key: string, variables?: Readonly<Record<string, string | number>>): string;
/** 覆盖率（源语言为 100%；未加载的语言为 0%） */
export declare function getLocaleCoverage(code: LocaleCode): LocaleCoverage;
/** 订阅语言变更（返回退订函数） */
export declare function onLocaleChange(listener: (code: LocaleCode) => void): () => void;
/** 广播语言变更（由 {@link module:i18n/index} 在切换成功后调用） */
export declare function notifyLocaleChange(code: LocaleCode): void;
/**
 * 预加载一批语言包（设置页列「可下载语言」时用）
 *
 * 并发加载，单个失败不影响其它——语言包缺一个不该让整个列表空白。
 */
export declare function preloadLocales(codes: readonly LocaleCode[]): Promise<void>;
/** 仅测试用：复位模块级状态 */
export declare function resetLocaleStoreForTest(): void;
/** 仅测试用：直接注入一个语言包（免去构造 fetch 桩） */
export declare function primeLocaleForTest(bundle: LocaleBundle): void;
export {};
//# sourceMappingURL=locale-store.d.ts.map