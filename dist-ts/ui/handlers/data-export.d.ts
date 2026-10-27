/**
 * @fileoverview 日志/记录导出源注册表
 * @module ui/handlers/data-export
 * @description
 *   三个工具（Bangumi 同步 / 新番表富化 / 数据清理）的日志与记录，统一在这里
 *   登记「表头 + 取数函数」，再交由 `tools/file-export` 输出 CSV 或 TXT。
 *
 *   为什么做成注册表而不是四处各写一个导出函数：
 *   导出入口有 **8 个**（4 个数据源 × 2 种格式），还要在「各页日志区」和
 *   「设置页集中入口」两处重复出现。散着写必然漏改，所以收敛成一个
 *   `data-action="exportData"` + `data-args='["<key>","<format>"]'`，
 *   新增数据源只需在 {@link EXPORT_SOURCES} 加一项。
 *
 *   本模块位于 UI 层，可依赖 tools / sync / panel 任意模块。
 */
import type { ExportCell, ExportFormat } from '../../tools/file-export.js';
import type { LogLevel } from '../../tools/logger.js';
/**
 * 导出的可选筛选。
 *
 * 目前只有「系统日志」用得上：日志弹窗顶部有一个级别下拉框，用户选中某一级后
 * 点「导出」，期望拿到的是**筛选后**的内容，而不是全量 —— 两者不一致会让人
 * 以为导出坏了。
 */
export interface ExportOptions {
    /**
     * 仅导出该级别的系统日志；不传（或显式传 `undefined`）表示全部级别。
     *
     * 显式带上 `| undefined` 是 `exactOptionalPropertyTypes: true` 的要求：
     * 调用方（`exportLogs` handler）会把下拉框的取值直接塞进来，而它的类型
     * 天然是 `LogLevel | undefined`，不这样声明就传不进去。
     */
    logLevel?: LogLevel | undefined;
}
/** 文件名主体 + 提示里的补充说明（由数据源按筛选条件自行派生） */
export interface ExportNaming {
    /** 文件名主体（不含 `bgm-` 前缀、时间戳与扩展名） */
    baseName: string;
    /** 追加到提示文案里的补充说明，如 `（仅 ERROR）`；无筛选时为空串 */
    note: string;
}
/** 一个可导出的数据源 */
export interface ExportSource {
    /** 唯一键，用于 `data-args` 与 {@link getExportSource} 查找 */
    key: string;
    /** 中文名（设置页展示 + 文件名主体） */
    label: string;
    /** CSV/TXT 表头 */
    headers: readonly string[];
    /** 取数（导出时才调用，避免启动时白读一次存储） */
    getRows: (options?: ExportOptions) => ExportCell[][];
    /**
     * 按筛选条件派生文件名与提示后缀。
     *
     * **不实现即表示该数据源不支持筛选** —— 此时传进来的 `options` 会被忽略，
     * 不会污染文件名（否则给「清理日志」传个 `logLevel` 就会导出
     * `bgm-清理日志-ERROR-….csv` 这种名不副实的文件）。
     */
    getNaming?: (options?: ExportOptions) => ExportNaming;
}
export declare const EXPORT_SOURCES: readonly ExportSource[];
/** 按键查找数据源（未找到返回 undefined） */
export declare function getExportSource(key: string): ExportSource | undefined;
/**
 * 执行导出。
 *
 * 无数据时不落文件 —— 生成一个只有表头的空文件对用户毫无价值，
 * 不如明确告诉他「暂无数据」。
 *
 * @param key - {@link EXPORT_SOURCES} 里的 key
 * @param format - 导出格式
 * @param options - 可选筛选（目前仅系统日志的级别筛选会用到）
 * @returns 导出的行数；0 表示未导出（数据源不存在或无数据）
 */
export declare function exportData(key: string, format: ExportFormat, options?: ExportOptions): number;
//# sourceMappingURL=data-export.d.ts.map