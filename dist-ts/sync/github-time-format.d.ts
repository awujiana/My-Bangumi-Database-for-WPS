/**
 * @fileoverview GitHub 同步的日期 / 时长格式化纯函数
 * @module sync/githubTimeFormat
 * @description 从 `github-sync.ts` 抽出的零副作用纯逻辑：日期字符串本地化、值追加合并、
 *              时长 / ETA 格式化、时间筛选标签。无任何 WPS / DOM 依赖，
 *              可在 Node 测试环境直接运行（P1-G 上帝模块拆分 + P1-H 测试安全网）。
 */
import type { SyncTimeFilter } from './github-sync-diff.js';
/**
 * 日期列名集合（写入时转换为本地"年月日"字符串格式）
 */
export declare const DATE_COLUMNS: Set<string>;
/**
 * 将远程日期字符串（YYYY-MM-DD 等格式）转换为本地"年月日"格式字符串
 *
 * 本地 Excel 的"开播日期""完播日"列使用"YYYY年MM月DD日"格式的字符串，
 * 远程仓库使用 YYYY-MM-DD 格式，同步时需转换为本地格式写入。
 *
 * @param dateString 日期字符串，支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 等格式
 * @returns "年月日"格式字符串，如"2015年12月15日"，解析失败返回 null
 */
export declare function formatDateToLocal(dateString: string): string | null;
export { appendValueWithSeparator } from './value-merge.js';
/**
 * 格式化持续时间（毫秒 → 可读字符串）。
 *
 * 实现已下沉到 `tools/util/duration.ts`（全项目唯一一份）。此前这里与
 * `ui/components/progress.ts`、`ui/sync-result-dialog.ts` 各有一份且已漂移
 * （999ms 四舍五入成 `1.00秒`、整分补成 `1分00秒`），2026-10-15 统一为
 * progress 版的截断语义（`0.99秒` / `1分`）。
 */
export { formatDuration } from '../tools/util/duration.js';
/**
 * 格式化预估剩余时间
 */
export declare function formatEta(ms: number): string;
/**
 * 格式化时间筛选标签（year/quarter/month，future 归入 month 分支，与原有三元逻辑一致）
 */
export declare function formatTimeFilterLabel(timeFilter: SyncTimeFilter): string;
//# sourceMappingURL=github-time-format.d.ts.map