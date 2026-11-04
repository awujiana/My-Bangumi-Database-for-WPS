import type { PluginManifest, PluginPermission, PluginSignatureStatus, PluginSource } from './plugin-types.js';
/** 插件目录名（位于加载项目录下） */
export declare const PLUGIN_DIRECTORY = "plugins";
/** 安装/更新失败的原因（界面直接展示，属动态内容，不进语言包） */
export interface PluginOperationFailure {
    ok: false;
    reason: string;
    /** 仅因「签名未通过且未授权无视风险」而失败时为 true，界面据此换按钮文案 */
    requiresTrust?: boolean;
}
export type PluginManifestFetchResult = PluginOperationFailure | {
    ok: true;
    manifest: PluginManifest;
    baseUrl: string;
    signatureStatus: PluginSignatureStatus;
};
export type PluginInstallResult = PluginOperationFailure | {
    ok: true;
    manifest: PluginManifest;
    pendingPermissions: PluginPermission[];
    signatureStatus: PluginSignatureStatus;
};
/** 安装选项 */
export interface PluginInstallOptions {
    /**
     * 允许安装未通过验签的插件。
     *
     * 只有界面在用户点过「无视风险安装」并二次确认后才置 true —— 调用方绝不能默认给 true。
     */
    allowUntrusted?: boolean;
}
/** 签名结论的中文说明（失败原因里内联用，界面另有徽标） */
export declare function describeSignatureStatus(status: PluginSignatureStatus): string;
/** 把 `file:///D:/a/b` 转成 Windows 路径 `D:\a\b` */
export declare function fileUrlToPath(url: URL): string;
/** 插件根目录（`<加载项目录>/plugins/`） */
export declare function pluginRootUrl(rootUrl: URL): URL;
/** 某个插件的目录 URL */
export declare function pluginDirectoryUrl(rootUrl: URL, id: string): URL;
/** 某个插件的入口 URL（用于 `import()`） */
export declare function pluginEntryUrl(rootUrl: URL, id: string): string;
/**
 * 把源码里的非 ASCII 字符转成 `\uXXXX` 转义。
 *
 * 为什么必须转：FSO 的 `CreateTextFile` 只能写 UTF-16LE / 系统 ANSI，写不了 UTF-8，
 * 而 `.js` 模块必须按 UTF-8 解析 —— 转义后整份源码是纯 ASCII，两种编码下逐字节相同。
 * 代理对（emoji）走 `\u{...}`，仍是合法 ES 语法。
 */
export declare function toAsciiSource(text: string): string;
/** 计算字节的 sha256（小写十六进制） */
export declare function sha256HexOfBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
/**
 * 拉取并校验插件清单。
 *
 * @param source 用户填写的来源
 * @param hostVersion 宿主版本（判 `minHostVersion`）
 */
export declare function fetchPluginManifest(source: PluginSource, hostVersion: string): Promise<PluginManifestFetchResult>;
/**
 * 安装（或升级）插件。
 *
 * 步骤：取清单 → 验签 → 下载入口文件 → 校验 size/sha256 → 转 ASCII → 落盘 → 写索引。
 * 任何一步失败都不会留下半装状态（先写文件再写索引，索引写失败会清掉文件）。
 *
 * @param rootUrl 加载项目录的 URL（`<root>/ui/` 的上一级）
 * @param source 来源
 * @param hostVersion 宿主版本
 * @param options 安装选项（`allowUntrusted` 只在用户确认过风险后由界面置 true）
 */
export declare function installPlugin(rootUrl: URL, source: PluginSource, hostVersion: string, options?: PluginInstallOptions): Promise<PluginInstallResult>;
/**
 * 用 FSO 递归删目录（失败返回 false，由调用方提示「请手动删除」）
 */
export declare function deletePluginDirectory(directoryPath: string): void;
/**
 * 卸载插件：删目录 + 删索引 + 清私有存储。
 *
 * @returns 是否完全成功；目录删不掉时返回 `{ ok: false }` 但索引仍会清掉
 *   （用户下次打开市场页看不到它，残留目录不影响运行）
 */
export declare function uninstallPlugin(rootUrl: URL, id: string): {
    ok: boolean;
    reason?: string;
};
//# sourceMappingURL=plugin-market.d.ts.map