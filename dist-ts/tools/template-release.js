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
export const TEMPLATE_OWNER = 'awujiana';
/** 数据仓库名（模板与分片数据源同一个仓库，见 `sync/github-config.ts` 默认配置） */
export const TEMPLATE_REPO = 'Bangumi-Archive-Anime-Excel';
/** Release 页面基础路径 */
const RELEASES_BASE = `https://github.com/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/releases`;
/** 查最新 Release 的接口（返回跨域头，任务窗格可直接 GET） */
const RELEASE_API = `https://api.github.com/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/releases/latest`;
/** 模板资产后缀：与主数据文件、差异对比文件区分开 */
const TEMPLATE_SUFFIX = '-template.xlsx';
/**
 * 兜底信息：指向 `releases/latest` 页面
 *
 * GitHub 会把 `/releases/latest` 302 到最新 tag 页，所以即使一个字节都查不到，
 * 这个地址也永远是「最新推送」——符合「默认取 Latest」的预期。
 */
export const TEMPLATE_FALLBACK = Object.freeze({
    tag: '',
    assetName: '',
    size: 0,
    downloadUrl: `${RELEASES_BASE}/latest`,
    pageUrl: `${RELEASES_BASE}/latest`,
    resolved: false,
});
/** Release 页面地址：有 tag 用 tag 页，没 tag 用 latest（GitHub 自动跳转） */
export function templateReleasePageUrl(tag) {
    return tag === '' ? `${RELEASES_BASE}/latest` : `${RELEASES_BASE}/tag/${encodeURIComponent(tag)}`;
}
/**
 * 挑模板资产：优先 `-template.xlsx`，没有才退而取第一个 `.xlsx`
 *
 * Release 里同时挂着三类 xlsx（主数据 / 差异对比 / 模板），只按 `.xlsx` 挑会
 * 挑到 75 列的主数据文件 —— 那不是给用户填的表。
 */
function pickTemplateAsset(assets) {
    if (!assets)
        return null;
    let firstXlsx = null;
    for (const asset of assets) {
        const name = asset.name ?? '';
        const downloadUrl = asset.browser_download_url ?? '';
        if (downloadUrl !== '' && name.toLowerCase().endsWith('.xlsx')) {
            const picked = { name, size: asset.size ?? 0, downloadUrl };
            if (name.toLowerCase().endsWith(TEMPLATE_SUFFIX))
                return picked;
            firstXlsx ??= picked;
        }
    }
    return firstXlsx;
}
/** 字节数 → 可读大小（与更新弹窗口径一致：MB 两位小数） */
function formatSize(bytes) {
    if (bytes <= 0)
        return '大小未知';
    if (bytes < 1024)
        return `${String(bytes)} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
/**
 * 纯函数：Release JSON → 模板下载信息
 *
 * 资产缺失时**不返回 null**：tag 拿到了就够给用户指路（页面里有全部三类文件），
 * 让调用方少一个分支。
 */
export function resolveTemplateRelease(data) {
    const tag = (data.tag_name ?? '').trim();
    const pageUrl = templateReleasePageUrl(tag);
    const asset = pickTemplateAsset(data.assets);
    if (asset === null) {
        return { tag, assetName: '', size: 0, downloadUrl: pageUrl, pageUrl, resolved: false };
    }
    return {
        tag,
        assetName: asset.name,
        size: asset.size,
        downloadUrl: asset.downloadUrl,
        pageUrl,
        resolved: true,
    };
}
/**
 * 查最新 Release 的模板资产
 *
 * 不抛异常：任何失败都回落 {@link TEMPLATE_FALLBACK}，保证 UI 永远有东西可显示。
 *
 * @param fetchFunction 可注入的 fetch（测试用；默认全局 fetch）
 */
export async function fetchLatestTemplate(fetchFunction = fetch) {
    try {
        const response = await fetchFunction(RELEASE_API, {
            headers: { Accept: 'application/vnd.github+json' },
            cache: 'no-store',
        });
        if (!response.ok)
            return TEMPLATE_FALLBACK;
        const data = (await response.json());
        return resolveTemplateRelease(data);
    }
    catch {
        // 限流 / 断网 / 宿主拦截：回落页面地址，不打扰用户
        return TEMPLATE_FALLBACK;
    }
}
/** 展示文案：`2026.10.27 · ani-...-template.xlsx · 7.75 MB`（兜底时给出指引） */
export function formatTemplateMeta(info) {
    if (!info.resolved) {
        return '未能解析到最新版本，按钮将打开数据仓库 Release 页（默认停在 Latest，挑最新的 -template.xlsx 即可）';
    }
    const parts = [info.tag === '' ? 'Latest' : info.tag, info.assetName, formatSize(info.size)];
    return parts.join(' · ');
}
