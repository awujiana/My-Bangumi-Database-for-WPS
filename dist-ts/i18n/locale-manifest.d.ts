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
import type { LocaleCode } from './translate.js';
/** 清单结构版本（与 `scripts/gen-locale-index.mjs` 的 `INDEX_SCHEMA_VERSION` 保持一致） */
export declare const MANIFEST_SCHEMA_VERSION = 1;
/** 清单里的一种语言 */
export interface LocaleManifestEntry {
    /** 语言代码（必定是 {@link LOCALE_CODES} 之一，其余条目在解析阶段就被丢弃） */
    code: LocaleCode;
    /** 英文名 */
    name: string;
    /** 母语名 */
    nativeName: string;
    /** 语言包版本 */
    version: string;
    /** 最后更新日期（`YYYY-MM-DD`） */
    updatedAt: string;
    /** 该语言的 key 数 */
    keyCount: number;
    /** 覆盖率百分比（口径与 `computeCoverage` 一致） */
    coverage: number;
    /** 语言包源码（LF 归一后）的 SHA-256，小写十六进制 */
    sha256: string;
    /** 语言包源码（LF 归一后）的字节数 */
    bytes: number;
}
/** 语言包清单 */
export interface LocaleManifest {
    /** 结构版本 */
    schemaVersion: number;
    /** 源语言代码 */
    sourceLocale: string;
    /** 源语言的 key 总数 */
    keyCount: number;
    /** 可用语言（已过滤掉不受支持的代码） */
    locales: LocaleManifestEntry[];
}
/**
 * 剥掉 `export default …;` 外壳，取出纯 JSON 文本
 *
 * 清单与语言包是同一个外壳（`export default` 后面跟纯 JSON），两边共用这段逻辑。
 * 前缀里的文件头注释（含中文）会被一并剥掉——它们不是数据。
 */
export declare function stripModuleWrapper(text: string): string;
/**
 * 把「生成物模块」的源码解析成对象
 *
 * 这是**安全边界**：`import()` 会把模块当代码执行，而这里只做 `JSON.parse`，
 * 所以「`export default` 之后还夹带了别的语句」的包会直接解析失败、被拒之门外。
 *
 * @returns 解析结果；不是合法 JSON 返回 null
 */
export declare function parseModuleJson(text: string): unknown;
/**
 * 校验并规整一份清单
 *
 * 严格拒绝而不是「能用就用」：清单说错话的后果是**下载下来的包被自己拒掉**，
 * 界面只会显示「校验失败」，排查时毫无线索。宁可在加载阶段就判定不可用。
 *
 * @returns 规整后的清单；结构不对 / 一条可用语言都没有时返回 null
 */
export declare function parseLocaleManifest(raw: unknown): LocaleManifest | null;
/**
 * 内置清单的 URL
 *
 * 以**模块自身位置**为基准（`dist-ts/i18n/locale-manifest.js` → `../../locales/`），
 * 与 `localeUrl()` 同一个理由：任务窗格在 `ui/` 下、ribbon 在根目录，
 * 用文档基准就得维护「每个页面各自几层」的表。
 */
export declare function bundledManifestUrl(): string;
/** 某个语言包在 raw CDN 上的地址 */
export declare function remoteLocaleModuleUrl(code: LocaleCode): string;
/** 清单在 raw CDN 上的地址 */
export declare function remoteManifestUrl(): string;
/**
 * 只用到 `fetch` 的这两个能力
 *
 * 不直接写 `typeof fetch`：单测注入时不必去满足完整的重载签名，一个
 * `{ ok, status, statusText, text }` 的对象就够，测试代码能少一半噪音。
 */
export type FetchText = (url: string) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    text: () => Promise<string>;
}>;
/** 用 fetch 读一份文本（非 2xx 直接抛错，错误里带状态码） */
export declare function fetchText(url: string, fetchFunction: FetchText): Promise<string>;
/**
 * 清单导入器
 *
 * 生产环境是原生动态 `import()`；单测可整只替换（见 {@link setManifestImporterForTest}），
 * 这样「文件缺失 / 语法错误 / 没有 default 导出」三种失败都能被测到。
 */
type ManifestImporter = (url: string) => Promise<{
    default?: unknown;
}>;
/** 仅测试用：替换导入器；传 null 复位 */
export declare function setManifestImporterForTest(importer: ManifestImporter | null): void;
/** 清单是从哪儿拿到的 */
export type ManifestOrigin = 
/** raw CDN 上的最新清单（能比插件版本更新得更快） */
'remote'
/** 随插件发布的内置清单（离线兜底） */
 | 'bundled'
/** 都不可用 */
 | 'none';
/** 加载清单的结果 */
export interface ManifestLoadResult {
    /** 清单（origin='none' 时为 null） */
    manifest: LocaleManifest | null;
    /** 来源 */
    origin: ManifestOrigin;
    /** 失败原因（origin='none' 时有意义；成功时为空串） */
    detail: string;
}
/** 加载清单的选项 */
export interface LoadManifestOptions {
    /**
     * 注入的 fetch（生产环境传 `fetch`）
     *
     * **不传就完全不联网**，只读内置清单——「在线清单的价值」和「离线也能用」
     * 靠这一个开关表达，比再加一个布尔开关少一种组合。
     */
    fetchFunction?: FetchText;
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
export declare function loadLocaleManifest(options?: LoadManifestOptions): Promise<ManifestLoadResult>;
/** 取某个语言在清单里的条目 */
export declare function findManifestEntry(manifest: LocaleManifest, code: LocaleCode): LocaleManifestEntry | undefined;
/** 已装语言包与清单的关系 */
export type PackState = 
/** 清单里有，但本地没有可用语言包（被删或损坏） */
'missing'
/** 本地有，但与清单的版本 / 日期不同 */
 | 'outdated'
/** 本地与清单一致 */
 | 'current';
/**
 * 比较「本地已装」与「清单声明」
 *
 * 比的是 `version` + `updatedAt`，不是哈希——理由见文件头注释。
 * 两个字段都要对上才算「一致」：只改文案不改版本号时，至少 `updatedAt` 还能兜住。
 */
export declare function comparePackState(entry: LocaleManifestEntry, installed: {
    version: string;
    updatedAt: string;
} | undefined): PackState;
export {};
//# sourceMappingURL=locale-manifest.d.ts.map