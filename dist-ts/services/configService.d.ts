/**
 * @fileoverview 配置导入导出服务
 * @module services/configService
 * @description 聚合 PluginStorage 中的配置为 JSON 字符串以便备份迁移，
 *              导入时使用 zod 进行严格结构校验，校验失败返回 Result.fail。
 */
import { Result } from '../core/result.js';
/**
 * 导出所有配置为 JSON 字符串
 *
 * 收集以下配置项：
 * - Bangumi Access Token（明文，来自 bgm_token）
 * - Bangumi 用户 ID（来自 bgm_user_id）
 * - GitHub 仓库配置（owner/repo/branch/path，来自 github_sync_*）
 * - 同步策略（来自 github_sync_strategy）
 *
 * @returns 格式化的 JSON 字符串（2 空格缩进）
 *
 * @example
 * ```typescript
 * const json = exportConfig();
 * // { "version": 1, "exportedAt": "2026-07-21T...", "token": "...", ... }
 * ```
 */
export declare function exportConfig(): string;
/**
 * 导入配置（带 zod 严格校验）
 *
 * 解析并校验 JSON 字符串，校验通过后将各配置项写回对应的 PluginStorage key。
 * 校验失败时返回 Result.fail，不会修改任何已存储的配置。
 *
 * @param json - JSON 格式的配置字符串
 * @returns `Result<void>` — 成功返回 ok，失败返回包含 BgmError 的 fail
 *
 * @example
 * ```typescript
 * const result = importConfig(jsonString);
 * if (result.isOk()) {
 *     showToast('配置导入成功', 'success');
 * } else {
 *     showToast(`导入失败: ${result.error?.message}`, 'error');
 * }
 * ```
 */
export declare function importConfig(json: string): Result<void>;
//# sourceMappingURL=configService.d.ts.map