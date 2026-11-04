/**
 * @fileoverview 插件清单的解析、校验与来源地址拼接
 * @module plugins/pluginManifest
 * @description 纯函数层：把 `plugin.json` 的原始 JSON 校验成 `PluginManifest`，
 *   以及把用户填写的来源（`owner/repo` / base URL / 本地目录）拼成可下载的地址。
 *
 *   校验顺序与失败原因严格对应 `PLUGIN-SPEC.md` §3.2 —— 少一条就会出现
 *   「装上了但加载不了」的黑盒，所以这里宁可多报一条也不放过。
 */
import type { PluginManifest, PluginManifestResult, PluginSource } from './plugin-types.js';
/** 宿主插件 API 版本。插件按 MAJOR 判兼容（`PLUGIN-SPEC.md` §8）。 */
export declare const HOST_PLUGIN_API_VERSION = "1.0.0";
/** `plugin.json` 在仓库里的固定文件名 */
export declare const PLUGIN_MANIFEST_FILE = "plugin.json";
/** 插件入口的固定文件名（清单里的 `entry` 也必须是它） */
export declare const PLUGIN_ENTRY_FILE = "plugin.js";
/**
 * 生成待签名字符串（签名与验签双方必须逐字节一致，见 `PLUGIN-SPEC.md` §7）。
 *
 * 只覆盖「决定插件能做什么」的字段：身份、版本、入口、权限、域名白名单、文件校验值。
 * `name` / `description` / `features` 不参与签名 —— 改文案不该导致重签，而它们
 * 被篡改最多让界面显示错乱，不会改变插件的行为边界。
 */
export declare function pluginSignaturePayload(manifest: PluginManifest): string;
/**
 * 校验并归一化插件清单。
 *
 * @param input `JSON.parse` 之后的原始值
 * @param hostVersion 宿主版本（判 `minHostVersion`），默认取 `CURRENT_VERSION` 之外传入，
 *   便于单测注入
 * @returns 校验通过返回归一化后的清单，否则返回全部错误（一次报全，不让作者反复试）
 */
export declare function parsePluginManifest(input: unknown, hostVersion: string): PluginManifestResult;
/**
 * 把用户填写的来源拼成 base URL（末尾不带斜杠）。
 *
 * - `github`：`owner/repo` → `https://raw.githubusercontent.com/owner/repo/main`
 * - `api`：原样返回（必须是 HTTPS，本地调试允许 `127.0.0.1` 的明文地址）
 * - `local`：返回空串（本地目录不走网络，由调用方直接读文件）
 */
export declare function pluginSourceBaseUrl(source: PluginSource): string;
/**
 * 解析用户输入的来源。
 *
 * 判定顺序：完整 URL → API 模式；`owner/repo` → GitHub 仓库；其余（含盘符路径）→ 本地目录。
 * 本地来源只在开发者模式下可用，由调用方再判一次。
 */
export declare function parsePluginSource(text: string): PluginSource | null;
/**
 * 判断某个 URL 是否在插件声明的域名白名单内。
 *
 * 精确匹配域名；`*.example.com` 匹配它的所有子域（不含 `example.com` 本身）——
 * 同一注册域下的子域由同一个所有者控制，不再按层级收紧。与 `PLUGIN-SPEC.md` §5.3 一致。
 */
export declare function isHostAllowed(url: string, network: readonly string[] | undefined): boolean;
//# sourceMappingURL=plugin-manifest.d.ts.map