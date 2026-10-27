/**
 * @fileoverview 配置导入导出服务
 * @module services/configService
 * @description 聚合 PluginStorage 中的配置为 JSON 字符串以便备份迁移，
 *              导入时使用 zod 进行严格结构校验，校验失败返回 Result.fail。
 *
 *              导出内容分三部分：
 *              - 核心字段（token / userId / githubConfig 含 sourceType 与 Gist ID）：
 *                结构化、经 zod 校验；
 *              - preferences：全部长期偏好键的扁平映射（主题与定时、导航模式、模块
 *                排序与折叠、快捷键、同步偏好、默认路径、日志级别、富化预览设置、
 *                番剧高亮含筛选、条件格式含规则库 / 分组映射 / 锚定与固定记录、
 *                数据清理的规则开关、多账号列表与用户资料缓存）。
 *                新增偏好键需登记进 {@link EXPORTABLE_PREFERENCE_KEYS}，导出才会带上。
 *              - 会话态（锁定工作表、面板信号、探测缓存）**不导出**，理由见白名单注释。
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
 * - preferences：全部长期偏好键（主题 / 导航 / 模块排序 / 同步偏好 / 默认路径 /
 *   日志级别 / 富化预览设置）
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
 * `preferences` 字段为可选扩展：缺失（旧版导出文件）时仅恢复核心字段，
 * 存在时按白名单逐键写回，未知键与非字符串值静默忽略。
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
//# sourceMappingURL=config-service.d.ts.map