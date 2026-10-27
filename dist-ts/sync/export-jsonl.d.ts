/**
 * @fileoverview JSONL 导出模块
 * @module sync/exportJsonl
 * @description 将 Excel 工作表中的数据导出为 JSONL（JSON Lines）格式文件。
 *              采用「表头 + 值数组」两段式：第 1 行是字段名数组，其后每行是与
 *              表头等长的值数组（仍是 JSON Lines，每行一个合法 JSON）。
 *              与 GitHub 仓库同步的数据格式一致，可直接作为本地同步数据源。
 */
/**
 * 导出字段顺序
 *
 * 必须与数据仓库分片的字段并集一致（不含 type）
 * （上游由 Archive/scripts/step09_build_jsonl.py 的 SHARD_DEFS 派生），
 * 这样导出的文件可以直接当作「本地文件同步」的数据源使用。
 */
export declare const EXPORT_FIELDS: readonly ["sid", "name", "updatedAt", "date", "meta_tags", "nsfw", "播放结束", "动画制作公司", "话数", "片长", "制片国家", "语言", "类型", "导演", "音乐", "人物设定", "机械设定", "原作", "脚本", "分镜", "演出", "原案", "系列构成", "在线播放平台", "关联条目ID", "关联的动漫ID", "name_original", "platform", "series", "score", "rank", "score_details", "favorite", "tags", "summary", "infobox", "别名"];
/**
 * 将 Excel 工作表中的数据导出为 JSONL 字符串
 *
 * 读取数据工作表中的所有行，按 {@link GithubRemoteEntry} 格式组织，
 * 包含 subjectId、name、updatedAt、date、meta_tags、话数 等字段。
 *
 * 输出第 1 行为表头（{@link EXPORT_FIELDS}），其后每行为等长的值数组。
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
//# sourceMappingURL=export-jsonl.d.ts.map