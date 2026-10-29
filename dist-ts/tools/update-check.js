/**
 * @fileoverview 从 GitHub Release 检查更新 / 下载更新包 / 校验完整性（纯逻辑 + 网络，零 WPS 依赖）
 * @module tools/update-check
 * @description
 *   流程：查 `releases/latest` → 比对版本 → 下载 zip（带进度回调）→ 校验 SHA-256。
 *
 *   本模块只负责「查版本 + 下载字节 + 校验」；真正的安装（关 WPS → 覆盖 → 重启）在
 *   `tools/update-install.ts`：任务窗格运行期覆盖自身文件会因文件锁失败，
 *   必须交给等 WPS 退出的外部进程来做。
 *
 *   **完整性校验（v2.2.4 起）**：发布端在 `download/version.json` 里声明 `sha256`
 *   与 `size`，下载完成后先在 JS 里比对，不一致直接拒绝安装（连辅助脚本都不生成）。
 *   这一环与「用不用脚本」无关，防的是供应链投毒：GitHub 账号被盗后替换
 *   `download/*.zip`，插件会静默执行任意 JS（CEF 里有 FSO + ShellExecute，
 *   等于任意代码执行）。HTTPS 挡不住中间人代理（企业根证书）与仓库被改。
 *
 *   版本号口径：去掉 `v` 前缀，按 `.` / `-` / `+` 切段，逐段比数字；缺失段按 0
 *   处理（`2.1` == `2.1.0`），预发布后缀（`2.1.0-beta.1`）按数字段继续比较。
 */
/** 当前插件版本（与 package.json / manifest.xml 的展示版本保持一致） */
export const CURRENT_VERSION = '2.2.5';
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
/**
 * 归一化发布端声明的 SHA-256
 *
 * 兼容 `sha256:abc…`（GitHub 的 `digest` 口径）与纯十六进制；不合法一律返回空串
 * （= 当作「没提供」，跳过校验而不是让更新失败）。
 */
export function normalizeSha256(text) {
    const cleaned = text
        .trim()
        .toLowerCase()
        .replace(/^sha256:/u, '');
    return /^[\da-f]{64}$/u.test(cleaned) ? cleaned : '';
}
/** 从 raw.githubusercontent.com 读取 version.json（无 API 限流） */
async function readVersionManifest(fetchFunction) {
    const response = await fetchFunction(RAW_VERSION_JSON, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`兜底版本源返回 HTTP ${String(response.status)} ${response.statusText}`);
    }
    const data = (await response.json());
    const version = (data.version ?? '').trim();
    if (version === '')
        throw new Error('兜底版本源缺少 version 字段');
    return {
        version,
        sha256: normalizeSha256(data.sha256 ?? ''),
        size: typeof data.size === 'number' ? data.size : 0,
    };
}
/**
 * 尽力读取清单里的校验信息（拿不到就返回空值，不阻断更新）
 *
 * API 查询成功时不需要清单的版本号，但需要它的 `sha256`。清单缺失、或清单里的
 * 版本号与 Release 对不上（发布到一半），都只降级为「跳过校验」——
 * 不能因为拿不到哈希就让整个检查更新失败。
 */
async function readIntegrityQuietly(version, fetchFunction) {
    try {
        const manifest = await readVersionManifest(fetchFunction);
        if (compareVersions(manifest.version, version) !== 0)
            return { sha256: '', size: 0 };
        return { sha256: manifest.sha256, size: manifest.size };
    }
    catch {
        return { sha256: '', size: 0 };
    }
}
/** 按命名约定构造发布包信息（用于 API 限流时的兜底） */
function buildReleaseFromManifest(manifest) {
    const tag = manifest.version.startsWith('v') ? manifest.version : `v${manifest.version}`;
    return {
        version: tag,
        notes: '',
        publishedAt: '',
        htmlUrl: `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/tag/${tag}`,
        asset: buildReleaseAsset(tag, null, { sha256: manifest.sha256, size: manifest.size }),
    };
}
/** 从 raw.githubusercontent.com 读取 version.json（无 API 限流） */
async function fetchLatestReleaseFromRaw(fetchFunction) {
    return buildReleaseFromManifest(await readVersionManifest(fetchFunction));
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
 * 由版本号 + Release 资产 + 清单校验信息构造下载信息
 *
 * 主源固定为仓库内 `download/` 的 raw 地址（跨域可用）；Release 资产只作兜底
 * （`github.com → objects.githubusercontent.com` 不带跨域头，fetch 会失败）。
 *
 * 校验值只认 `version.json` 里声明的 `sha256`，不认 Release 资产的 `digest`：
 * 两者虽然通常指向同一个 zip，但 Release 资产是人工上传的，主下载源却是
 * `download/` 里的文件——用 A 的哈希去校验 B 的字节，对不上就会误报。
 */
function buildReleaseAsset(version, releaseAsset, integrity) {
    const tag = version.startsWith('v') ? version : `v${version}`;
    const asset = {
        name: `${UPDATE_REPO}-${tag}.zip`,
        size: integrity.size > 0 ? integrity.size : (releaseAsset?.size ?? 0),
        downloadUrl: repoAssetUrl(tag),
        sha256: integrity.sha256,
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
        const integrity = await readIntegrityQuietly(version, fetchFunction);
        return {
            version,
            notes: data.body ?? '',
            publishedAt: data.published_at ?? '',
            htmlUrl: data.html_url ?? '',
            asset: buildReleaseAsset(version, pickZipAsset(data.assets), integrity),
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
/** 取当前环境的 SubtleCrypto（CEF 太旧或非安全上下文时可能没有） */
function defaultSubtleCrypto() {
    // 走中间变量而不是直接 `globalThis.crypto.subtle`：旧 CEF 可能整个没有 crypto
    const host = globalThis;
    return host.crypto?.subtle ?? null;
}
/**
 * 计算字节的 SHA-256
 *
 * @param bytes 待校验字节
 * @param subtle 可注入的 WebCrypto（测试用；默认取 `globalThis.crypto.subtle`）
 * @returns 64 位小写十六进制；环境不提供 WebCrypto 时返回 null
 */
export async function sha256Hex(bytes, subtle = defaultSubtleCrypto()) {
    if (subtle === null)
        return null;
    try {
        const digest = await subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    catch {
        return null;
    }
}
/**
 * 校验下载到的字节是否与发布端声明一致
 *
 * 这是整条更新链路上**唯一**的完整性关卡：HTTPS 只保证「传输没被偷看」，
 * 挡不住企业代理装根证书做中间人，也挡不住仓库被改（供应链投毒）。
 * 不一致时调用方必须**放弃安装**，而不是提示「可能有问题，要继续吗」。
 */
export async function verifyAssetIntegrity(bytes, expectedSha256, subtle = defaultSubtleCrypto()) {
    const expected = normalizeSha256(expectedSha256);
    if (expected === '')
        return { status: 'skipped', actual: '', expected: '' };
    const actual = await sha256Hex(bytes, subtle);
    if (actual === null)
        return { status: 'skipped', actual: '', expected };
    return { status: actual === expected ? 'verified' : 'mismatch', actual, expected };
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
