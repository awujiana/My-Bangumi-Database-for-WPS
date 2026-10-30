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
export declare const CURRENT_VERSION = "2.3.0";
/** 更新来源仓库 */
export declare const UPDATE_OWNER = "awujiana";
export declare const UPDATE_REPO = "My-Bangumi-Database-for-WPS";
/** 按版本号拼出仓库内托管更新包的 raw 地址（如 `.../main/download/<repo>-v2.2.1.zip`） */
export declare function repoAssetUrl(version: string): string;
/**
 * 归一化发布端声明的 SHA-256
 *
 * 兼容 `sha256:abc…`（GitHub 的 `digest` 口径）与纯十六进制；不合法一律返回空串
 * （= 当作「没提供」，跳过校验而不是让更新失败）。
 */
export declare function normalizeSha256(text: string): string;
/** 发布包信息 */
export interface ReleaseAsset {
    /** 文件名（如 `My-Bangumi-Database-for-WPS-v2.2.0.zip`） */
    name: string;
    /** 字节数（0 = 未知） */
    size: number;
    /** 主下载地址（仓库内 `download/` 的 raw 地址，允许跨域） */
    downloadUrl: string;
    /** 回退下载地址（GitHub Release 资产；CORS 受限，仅作兜底） */
    fallbackDownloadUrl?: string;
    /**
     * 发布端声明的 SHA-256（小写十六进制）
     *
     * 空串 = 发布端没提供（旧版 `version.json` 只有 `version` 字段）→ 跳过校验。
     */
    sha256: string;
}
/** 一次「检查更新」的结果 */
export interface ReleaseInfo {
    /** 版本号（tag_name，如 `v2.2.0`） */
    version: string;
    /** Release 正文（更新简述） */
    notes: string;
    /** 发布时间（ISO 字符串，可能为空） */
    publishedAt: string;
    /** Release 页面地址 */
    htmlUrl: string;
    /** 匹配到的 zip 资产；没有 zip 时为 null */
    asset: ReleaseAsset | null;
}
/** 下载进度 */
export interface DownloadProgress {
    /** 已下载字节 */
    loaded: number;
    /** 总字节（0 = 未知） */
    total: number;
}
/**
 * 解析版本号为数字段数组
 *
 * `v2.1.0` → `[2, 1, 0]`；`2.1.0-beta.1` → `[2, 1, 0, 1]`。
 */
export declare function parseVersion(text: string): number[];
/**
 * 比较两个版本号
 * @returns 1 = a 更新；-1 = b 更新；0 = 相同
 */
export declare function compareVersions(a: string, b: string): number;
/** 最新版是否比当前版新 */
export declare function isNewerVersion(latest: string, current: string): boolean;
/**
 * 查询最新 Release
 *
 * @param fetchImpl 可注入的 fetch（测试用；默认全局 fetch）
 * @throws 网络错误 / 非 2xx / 响应缺版本号
 */
export declare function fetchLatestRelease(fetchFunction?: typeof fetch): Promise<ReleaseInfo>;
/**
 * 下载更新包（带进度回调）
 *
 * @param url 资产下载地址
 * @param onProgress 每次读到一块数据时回调（`total` 未知时为 0）
 * @param fetchImpl 可注入的 fetch（测试用）
 */
export declare function downloadReleaseAsset(url: string, onProgress: (progress: DownloadProgress) => void, fetchFunction?: typeof fetch): Promise<Uint8Array<ArrayBuffer>>;
/**
 * 计算字节的 SHA-256
 *
 * @param bytes 待校验字节
 * @param subtle 可注入的 WebCrypto（测试用；默认取 `globalThis.crypto.subtle`）
 * @returns 64 位小写十六进制；环境不提供 WebCrypto 时返回 null
 */
export declare function sha256Hex(bytes: Uint8Array<ArrayBuffer>, subtle?: SubtleCrypto | null): Promise<string | null>;
/** 完整性校验结论 */
export type IntegrityStatus = 
/** 算出的哈希与发布端声明一致 */
'verified'
/** 算出的哈希与发布端声明不一致 —— 必须拒绝安装 */
 | 'mismatch'
/** 无法校验（发布端没给哈希，或环境没有 WebCrypto） */
 | 'skipped';
/** 完整性校验结果 */
export interface IntegrityResult {
    /** 结论 */
    status: IntegrityStatus;
    /** 实际算出的 SHA-256（未算出时为空串） */
    actual: string;
    /** 发布端声明的 SHA-256（空串 = 没提供） */
    expected: string;
}
/**
 * 校验下载到的字节是否与发布端声明一致
 *
 * 这是整条更新链路上**唯一**的完整性关卡：HTTPS 只保证「传输没被偷看」，
 * 挡不住企业代理装根证书做中间人，也挡不住仓库被改（供应链投毒）。
 * 不一致时调用方必须**放弃安装**，而不是提示「可能有问题，要继续吗」。
 */
export declare function verifyAssetIntegrity(bytes: Uint8Array<ArrayBuffer>, expectedSha256: string, subtle?: SubtleCrypto | null): Promise<IntegrityResult>;
/**
 * 触发浏览器下载（落 CEF 下载目录），二进制安全
 *
 * @param bytes 文件内容
 * @param fileName 建议文件名
 */
export declare function saveZipViaBrowser(bytes: Uint8Array<ArrayBuffer>, fileName: string): void;
//# sourceMappingURL=update-check.d.ts.map