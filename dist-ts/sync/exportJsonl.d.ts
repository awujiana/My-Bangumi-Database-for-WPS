/**
 * @fileoverview JSONL 导出模块
 * @module sync/exportJsonl
 * @description 将 Excel 工作表中的数据导出为 JSONL（JSON Lines）格式文件。
 *              JSONL 格式：每行一个独立的 JSON 对象，无外层数组括号，无逗号分隔。
 *              兼容 GitHub 仓库同步的 JSONL 数据格式。
 */
/**
 * 将 Excel 工作表中的数据导出为 JSONL 字符串
 *
 * 读取数据工作表中的所有行，按 {@link GithubRemoteEntry} 格式组织，
 * 包含 sid、name、updatedAt、date、meta_tags、话数 等字段。
 *
 * 日期字段（开播日期、完播日）优先使用单元格的本地格式（Text 属性），
 * 保留用户设置的日期格式，无格式时回退到默认的 Value2 值。
 *
 * @returns JSONL 字符串，若无数据则返回空字符串
 */
export declare function buildJsonlFromSheet(): string;
/**
 * 导出工作表中的数据为 JSONL 文件（通过浏览器下载）
 *
 * 使用 Blob + URL.createObjectURL 创建临时下载链接，兼容 WPS 内嵌浏览器。
 * 若浏览器不支持下载，则提示用户手动复制。
 *
 * @returns 是否成功导出
 */
export declare function exportSheetToJsonlFile(): boolean;
//# sourceMappingURL=exportJsonl.d.ts.map