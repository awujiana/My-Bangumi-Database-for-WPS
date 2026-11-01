/**
 * @fileoverview 语言包在线安装：下载 → 校验 → 转纯 ASCII → 落盘 → 立即生效
 * @module i18n/localeInstall
 *
 * @description
 *   语言包随插件发布（`viteStaticCopy` 的 `locales/**\/*.js` 白名单），正常情况下
 *   用户不需要这个模块。它解决的是两个真实场景：
 *
 *   1. **修复**：用户手动删过 / 覆盖过 `locales/<code>/`，界面一片 key 名；
 *   2. **追新**：修一处译文错字不该逼用户重装整个插件。
 *
 * ## 为什么落盘前必须把内容转成纯 ASCII（最容易踩的一脚）
 *
 *   写盘唯一的通道是 FSO 的 `CreateTextFile(path, isOverwrite, isUnicode)`，
 *   它只能写 **UTF-16 LE（带 BOM）** 或 **系统 ANSI**，**写不了 UTF-8**——
 *   而 `.js` 模块必须是 UTF-8，否则中文全是乱码、`import()` 直接语法错误。
 *
 *   绕法：把非 ASCII 字符全部转成 `\uXXXX`。转义后的文本仍是合法 JS
 *   （字符串里的转义语义不变，注释里只是普通字符），而 **ASCII 在 ANSI 代码页
 *   与 UTF-8 下逐字节相同**，编码问题就此消失。
 *
 * ## 校验只发生在「下载到写盘之间」
 *
 *   落盘后的字节与仓库里的字节必然不同（见上），所以清单里的 `sha256` / `bytes`
 *   只用来校验**下载到的内容**。这也是唯一有意义的时机：那一关挡的是
 *   「发布端被替换 / 代理返回了别的东西」。
 */
import type { FetchText, LocaleManifest } from './locale-manifest.js';
import type { LocaleCode } from './translate.js';
/**
 * 把模块源码转成**纯 ASCII**
 *
 * 只做字符替换，不动结构：`export default {…};` 的外壳、注释、缩进全部原样保留。
 *
 * 为什么保留注释里的中文（转义后成为 `\u4e2d` 这种字面量）：注释不参与解析，
 * 删掉反而要写一个能识别注释的词法分析器，风险更大。转义它零风险。
 */
export declare function toAsciiModule(text: string): string;
/**
 * 转义后再解析一遍，确认语义没变
 *
 * 转义写错（比如把 `\` 也吃了、或者代理对算错）会让用户装上一个**坏语言包**，
 * 而那时界面只会退回中文，看不出是安装器干的。这一步是纯函数级的自证：
 * 转义前后 `JSON.stringify` 的结果必须逐字相同。
 */
export declare function isAsciiRoundTripSafe(original: unknown, escaped: string): boolean;
/** 单个语言的安装结果 */
export interface LocaleInstallReport {
    /** 语言代码 */
    code: LocaleCode;
    /** 是否写盘成功 */
    status: 'installed' | 'failed';
    /** 给用户看的一句话（成功时是版本号，失败时是原因） */
    detail: string;
}
/** 整次安装的结果 */
export interface LocaleInstallOutcome {
    /** installed = 全部成功；partial = 部分成功；failed = 一个都没成；unsupported = 环境不支持 */
    status: 'installed' | 'partial' | 'failed' | 'unsupported';
    /** 给用户看的一句话说明 */
    detail: string;
    /** 加载项目录（unsupported 时为空串） */
    directory: string;
    /** 逐语言结果 */
    reports: LocaleInstallReport[];
}
/** 安装选项 */
export interface InstallLocalePacksOptions {
    /** 插件基址（`getUrlPath()` 的返回值） */
    baseUrl: string;
    /** 已加载的清单（决定装哪些语言、按什么哈希校验） */
    manifest: LocaleManifest;
    /** 注入的 fetch（测试用；生产环境由调用方传 `fetch`） */
    fetchFunction: FetchText;
    /** 注入的 WebCrypto（测试用；不传则用全局的） */
    subtle?: SubtleCrypto | null;
}
/**
 * 按清单安装 / 修复语言包
 *
 * 全部语言一起装，不做「只装当前语言」：三个包加起来约 110 KB，
 * 少一次分支就少一类「切过去才发现没装」的问题。
 *
 * @returns 逐语言结果；`unsupported` 表示当前环境根本没法写盘（开发期 HTTP）
 */
export declare function installLocalePacks(options: InstallLocalePacksOptions): Promise<LocaleInstallOutcome>;
/**
 * 已装语言包的版本摘要（设置页状态行用）
 *
 * 只读内存里的包，不碰磁盘：`version` / `updatedAt` 就在语言包头上，
 * 加载过的语言直接取得到。
 */
export declare function describeInstalledPacks(codes: readonly LocaleCode[]): string;
/** 打开语言包目录的结果 */
export interface OpenDirectoryOutcome {
    /** 是否已把「打开目录」交给宿主 */
    ok: boolean;
    /** 目标目录（无法定位加载项时为空串） */
    directory: string;
    /** 失败原因（成功时为空串） */
    detail: string;
}
/**
 * 在资源管理器里打开语言包目录
 *
 * 为什么自己调 ShellExecute 而不用 `shellExecuteByOAAssist`：那个封装在宿主
 * 不支持时**静默什么都不做**，用户点一下按钮毫无反应、也拿不到任何提示。
 * 这里必须能区分「已打开」和「宿主不让开」。
 */
export declare function openLocaleDirectory(baseUrl: string): OpenDirectoryOutcome;
//# sourceMappingURL=locale-install.d.ts.map