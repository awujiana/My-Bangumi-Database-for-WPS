/**
 * @fileoverview 模板文件来源：数据仓库 Latest Release 里的 `*-template.xlsx`
 * @module tools/template-release
 * @description
 *   「帮助与格式」要给用户一个可直接套用的 Excel 模板（42 列精简表、已带表头）。
 *   模板跟着数据仓库**每周三的推送**走，文件名里带日期（
 *   `ani-bangumi-type2-2026-10-27-template.xlsx`），写死在 HTML 里第二周就过期。
 *   所以这里只认「Latest Release」：查接口拿到 tag + 资产名，默认展示最新的那个。
 *
 *   两条硬约束（写死在注释里，避免后人改回直连下载）：
 *   1. **不能在任务窗格里 fetch 下载资产** —— Release 资产会 302 到
 *      `objects.githubusercontent.com`，该域不返回 `Access-Control-Allow-Origin`，
 *      fetch 直接失败（与网络是否通畅无关，见 `tools/update-check.ts` 同款踩坑）。
 *      本模块只产出**链接**，下载交给宿主 WebView 导航 / 用户自己粘到浏览器。
 *   2. **查不到就回落** —— 接口限流（未鉴权 60 次/小时/IP）、断网、仓库改名时，
 *      「查版本号」这种辅助信息不能挡住「给个下载位置」这件正事：回落到
 *      `releases/latest`（GitHub 自己 302 到最新 tag）。
 */
/** 数据仓库拥有者 */
export declare const TEMPLATE_OWNER = "awujiana";
/** 数据仓库名（模板与分片数据源同一个仓库，见 `sync/github-config.ts` 默认配置） */
export declare const TEMPLATE_REPO = "Bangumi-Archive-Anime-Excel";
/** 一个模板的下载信息 */
export interface TemplateReleaseInfo {
    /** Release tag（如 `2026.10.27`）；兜底时为空串 */
    tag: string;
    /** 资产文件名；兜底时为空串 */
    assetName: string;
    /** 字节数（0 = 未知） */
    size: number;
    /** 资产下载直链（兜底时是 Release 页面地址） */
    downloadUrl: string;
    /** Release 页面地址 */
    pageUrl: string;
    /** 是否查到了真实资产（false = 用的兜底页，UI 要提示「到页面里挑最新的」） */
    resolved: boolean;
}
/**
 * 兜底信息：指向 `releases/latest` 页面
 *
 * GitHub 会把 `/releases/latest` 302 到最新 tag 页，所以即使一个字节都查不到，
 * 这个地址也永远是「最新推送」——符合「默认取 Latest」的预期。
 */
export declare const TEMPLATE_FALLBACK: TemplateReleaseInfo;
/** GitHub Release 接口返回体的最小子集 */
interface ReleaseJson {
    tag_name?: string;
    assets?: {
        name?: string;
        size?: number;
        browser_download_url?: string;
    }[];
}
/** Release 页面地址：有 tag 用 tag 页，没 tag 用 latest（GitHub 自动跳转） */
export declare function templateReleasePageUrl(tag: string): string;
/**
 * 纯函数：Release JSON → 模板下载信息
 *
 * 资产缺失时**不返回 null**：tag 拿到了就够给用户指路（页面里有全部三类文件），
 * 让调用方少一个分支。
 */
export declare function resolveTemplateRelease(data: ReleaseJson): TemplateReleaseInfo;
/**
 * 查最新 Release 的模板资产
 *
 * 不抛异常：任何失败都回落 {@link TEMPLATE_FALLBACK}，保证 UI 永远有东西可显示。
 *
 * @param fetchFunction 可注入的 fetch（测试用；默认全局 fetch）
 */
export declare function fetchLatestTemplate(fetchFunction?: typeof fetch): Promise<TemplateReleaseInfo>;
/** 展示文案：`2026.10.27 · ani-...-template.xlsx · 7.75 MB`（兜底时给出指引） */
export declare function formatTemplateMeta(info: TemplateReleaseInfo): string;
export {};
//# sourceMappingURL=template-release.d.ts.map