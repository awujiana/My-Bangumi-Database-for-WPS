/**
 * @fileoverview 从 GitHub Release 检查更新 / 下载更新包（纯逻辑 + 网络，零 WPS 依赖）
 * @module tools/update-check
 * @description
 *   流程：查 `releases/latest` → 比对版本 → 下载 zip（带进度回调）。
 *
 *   为什么只做到「下载」而不自动覆盖加载项目录：任务窗格运行期覆盖自身文件
 *   可能因文件锁失败、且半途失败会把插件写坏。下载完成后由页面给出「关闭 WPS
 *   → 解压覆盖 → 重新打开」的明确指引，把破坏性操作交给用户确认。
 *
 *   版本号口径：去掉 `v` 前缀，按 `.` / `-` / `+` 切段，逐段比数字；缺失段按 0
 *   处理（`2.1` == `2.1.0`），预发布后缀（`2.1.0-beta.1`）按数字段继续比较。
 */
/** 当前插件版本（与 package.json / manifest.xml 的展示版本保持一致） */
export const CURRENT_VERSION = '2.2.2';
/** 更新来源仓库 */
export const UPDATE_OWNER = 'awujiana';
export const UPDATE_REPO = 'My-Bangumi-Database-for-WPS';
/** GitHub 最新 Release 接口 */
const RELEASE_API = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`;
/**
 * 更新包在**仓库内**的托管目录（走 raw.githubusercontent.com）。
 *
 * 为什么不用 Release 资产：`github.com/.../releases/download/...` 会 302 到
 * `objects.githubusercontent.com`，这两个域都不返回允许跨域的响应头，任务窗格里
 * `fetch` 直接报 `Failed to fetch`（CORS），与网络是否通畅无关。
 * `raw.githubusercontent.com` 返回 `Access-Control-Allow-Origin: *`，插件的数据同步
 * 也走它 —— 把 zip 提交进仓库的 `download/` 目录即可稳定下载。
 */
const REPO_ASSET_DIRECTORY = 'download';
/** 按版本号拼出仓库内托管更新包的 raw 地址（如 `.../main/download/<repo>-v2.2.1.zip`） */
export function repoAssetUrl(version) {
    const tag = version.startsWith('v') ? version : `v${version}`;
    return `https://raw.githubusercontent.com/${UPDATE_OWNER}/${UPDATE_REPO}/main/${REPO_ASSET_DIRECTORY}/${UPDATE_REPO}-${tag}.zip`;
}
/**
 * API 不可用时的兜底版本来源：仓库内 `download/version.json`（发布脚本自动生成）。
 *
 * 不用 `main/package.json`：发布分支刻意不含 package.json（本地工具链不入库）。
 * raw.githubusercontent.com 允许跨域且不限流。
 */
const RAW_VERSION_JSON = `https://raw.githubusercontent.com/${UPDATE_OWNER}/${UPDATE_REPO}/main/${REPO_ASSET_DIRECTORY}/version.json`;
/** 按命名约定构造发布包信息（用于 API 限流时的兜底） */
function buildReleaseFromVersion(version) {
    const tag = version.startsWith('v') ? version : `v${version}`;
    return {
        version: tag,
        notes: '',
        publishedAt: '',
        htmlUrl: `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/tag/${tag}`,
        asset: buildReleaseAsset(tag, null),
    };
}
/** 从 raw.githubusercontent.com 读取 version.json（无 API 限流） */
async function fetchLatestReleaseFromRaw(fetchFunction) {
    const response = await fetchFunction(RAW_VERSION_JSON, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`兜底版本源返回 HTTP ${String(response.status)} ${response.statusText}`);
    }
    const data = (await response.json());
    const version = data.version ?? '';
    if (version === '')
        throw new Error('兜底版本源缺少 version 字段');
    return buildReleaseFromVersion(version);
}
/**
 * 解析版本号为数字段数组
 *
 * `v2.1.0` → `[2, 1, 0]`；`2.1.0-beta.1` → `[2, 1, 0, 1]`。
 */
export function parseVersion(text) {
    const cleaned = text.trim().replace(/^v/iu, '');
    if (cleaned === '')
        return [];
    return cleaned.split(/[.\-+]/u).map((part) => {
        const match = /^\d+/u.exec(part);
        return match ? Number(match[0]) : 0;
    });
}
/**
 * 比较两个版本号
 * @returns 1 = a 更新；-1 = b 更新；0 = 相同
 */
export function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = left[index] ?? 0;
        const rightPart = right[index] ?? 0;
        if (leftPart !== rightPart)
            return leftPart > rightPart ? 1 : -1;
    }
    return 0;
}
/** 最新版是否比当前版新 */
export function isNewerVersion(latest, current) {
    return compareVersions(latest, current) > 0;
}
/** 从资产列表里挑第一个 zip */
function pickZipAsset(assets) {
    if (!assets)
        return null;
    for (const asset of assets) {
        const name = asset.name ?? '';
        const downloadUrl = asset.browser_download_url ?? '';
        if (downloadUrl !== '' && name.toLowerCase().endsWith('.zip')) {
            return { name, size: asset.size ?? 0, downloadUrl };
        }
    }
    return null;
}
/**
 * 由版本号 + Release 资产构造下载信息
 *
 * 主源固定为仓库内 `download/` 的 raw 地址（跨域可用）；Release 资产只作兜底
 * （`github.com → objects.githubusercontent.com` 不带跨域头，fetch 会失败）。
 */
function buildReleaseAsset(version, releaseAsset) {
    const tag = version.startsWith('v') ? version : `v${version}`;
    const asset = {
        name: `${UPDATE_REPO}-${tag}.zip`,
        size: releaseAsset?.size ?? 0,
        downloadUrl: repoAssetUrl(tag),
    };
    if (releaseAsset !== null)
        asset.fallbackDownloadUrl = releaseAsset.downloadUrl;
    return asset;
}
/**
 * 查询最新 Release
 *
 * @param fetchImpl 可注入的 fetch（测试用；默认全局 fetch）
 * @throws 网络错误 / 非 2xx / 响应缺版本号
 */
export async function fetchLatestRelease(fetchFunction = fetch) {
    try {
        const response = await fetchFunction(RELEASE_API, {
            headers: { Accept: 'application/vnd.github+json' },
            cache: 'no-store',
        });
        if (response.status === 404) {
            throw new Error('仓库还没有发布任何 Release');
        }
        if (!response.ok) {
            throw new Error(`GitHub 接口返回 HTTP ${String(response.status)} ${response.statusText}`);
        }
        const data = (await response.json());
        const version = data.tag_name ?? data.name ?? '';
        if (version === '')
            throw new Error('Release 缺少版本号（tag_name）');
        return {
            version,
            notes: data.body ?? '',
            publishedAt: data.published_at ?? '',
            htmlUrl: data.html_url ?? '',
            asset: buildReleaseAsset(version, pickZipAsset(data.assets)),
        };
    }
    catch (error) {
        // 404 是明确的业务状态，不应被兜底掩盖
        if (error instanceof Error && error.message.includes('还没有发布'))
            throw error;
        try {
            return await fetchLatestReleaseFromRaw(fetchFunction);
        }
        catch {
            // 兜底也失败时保留原始错误，便于用户定位（限流 / 网络拦截 / 仓库不可达）
            throw error;
        }
    }
}
/** 把分块合并成一个连续 Uint8Array */
function mergeChunks(chunks, totalLength) {
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return merged;
}
/**
 * 下载更新包（带进度回调）
 *
 * @param url 资产下载地址
 * @param onProgress 每次读到一块数据时回调（`total` 未知时为 0）
 * @param fetchImpl 可注入的 fetch（测试用）
 */
export async function downloadReleaseAsset(url, onProgress, fetchFunction = fetch) {
    const response = await fetchFunction(url);
    if (!response.ok) {
        throw new Error(`下载更新包失败：HTTP ${String(response.status)} ${response.statusText}`);
    }
    if (!response.body) {
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        onProgress({ loaded: bytes.byteLength, total: bytes.byteLength });
        return bytes;
    }
    const totalHeader = response.headers.get('content-length');
    const total = totalHeader === null ? 0 : Number(totalHeader);
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    let isDone = false;
    while (!isDone) {
        const result = await reader.read();
        if (result.done) {
            isDone = true;
        }
        else {
            const chunk = result.value;
            chunks.push(chunk);
            loaded += chunk.byteLength;
            onProgress({ loaded, total });
        }
    }
    return mergeChunks(chunks, loaded);
}
/**
 * 触发浏览器下载（落 CEF 下载目录），二进制安全
 *
 * @param bytes 文件内容
 * @param fileName 建议文件名
 */
export function saveZipViaBrowser(bytes, fileName) {
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 10_000);
}
