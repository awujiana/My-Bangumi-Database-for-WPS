/**
 * @fileoverview 通用文件导出（CSV / TXT）
 * @module tools/file-export
 * @description
 *   把「表头 + 行数据」导出成本地文件，供三个工具的日志/记录导出共用。
 *
 *   设计要点：
 *   1. **CSV 带 UTF-8 BOM**：Excel 靠 BOM 判断 UTF-8，没有它中文全是乱码。
 *      这是本模块存在的唯一非显然细节，改动时别把 BOM 删了。
 *   2. **只依赖标准 DOM API**（Blob / URL.createObjectURL / a.download）。
 *      WPS 任务窗格是 WebView，这些 API 都可用；不要用 `FileDialog`
 *      （那是「选择已有文件」的 API，没有「另存为」用法）。
 *   3. 本模块是**纯逻辑 + 一个副作用出口**（{@link downloadTextFile}），
 *      序列化函数（{@link toCsv} / {@link toText}）无 DOM 依赖，便于单测。
 *
 * @remarks 此前 Blob 下载逻辑在 logger / export-jsonl / action-handlers /
 *   debug-panel 四处各写一遍，后续可逐步收敛到 {@link downloadTextFile}。
 */
/** 导出格式 */
export type ExportFormat = 'csv' | 'txt';
/** 单元格原始值（导出前统一转成字符串） */
export type ExportCell = string | number | boolean | null | undefined;
/** 把任意单元格值转成安全的展示字符串 */
export declare function stringifyCell(value: ExportCell): string;
/**
 * 序列化为 CSV 文本（**含 UTF-8 BOM**）。
 *
 * 换行用 CRLF 而非 LF —— 与 RFC4180 一致，且 Excel 对 CRLF 兼容更好。
 */
export declare function toCsv(headers: readonly string[], rows: readonly (readonly ExportCell[])[]): string;
/**
 * 序列化为纯文本：首行表头，其余为数据行，列之间用 ` | ` 分隔。
 *
 * 刻意**不做列宽对齐** —— 中文是等宽字体的两倍宽，算显示宽度要维护一张
 * CJK 区间表，收益（好看一点）不抵复杂度和出错风险。
 */
export declare function toText(headers: readonly string[], rows: readonly (readonly ExportCell[])[]): string;
/** 把时间戳格式化成文件名用的 `YYYYMMDD-HHmmss`（本地时区） */
export declare function formatFileTimestamp(timestamp: number): string;
/** 拼装导出文件名，形如 `bgm-同步记录-20260913-055403.csv` */
export declare function buildFileName(baseName: string, format: ExportFormat): string;
/**
 * 触发浏览器下载一段文本。
 *
 * 这是本模块**唯一**有副作用的函数（其余都是纯函数）。
 * 无 DOM 环境（单测 / SSR）下静默返回，不抛错 —— 导出失败的代价远小于
 * 打断当前业务流程。
 */
export declare function downloadTextFile(fileName: string, text: string, mimeType: string): void;
/**
 * 按格式导出一组行数据。
 *
 * @param baseName - 文件名主体（不含前缀与扩展名）
 * @param headers - 表头
 * @param rows - 数据行（每行长度不必与表头一致，缺失补空）
 * @param format - 导出格式
 * @returns 实际导出的行数（供调用方弹 toast 提示）
 */
export declare function exportRows(baseName: string, headers: readonly string[], rows: readonly (readonly ExportCell[])[], format: ExportFormat): number;
//# sourceMappingURL=file-export.d.ts.map