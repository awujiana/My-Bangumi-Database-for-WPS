/**
 * @fileoverview Bangumi 同步纯函数模块
 * @module sync/pure-utilities
 * @description 提供 URL 识别、Subject ID 提取、观看状态映射、标签解析等函数。
 *
 * 模块拆分说明：
 *   - isBangumiUrl / extractSubjectId / mapWatchStatus 是无副作用依赖的纯函数，
 *     已抽取到 ./pure-utilities-core.js（仅依赖 core/constants 与 tools/string-utilities-pure）。
 *     本模块 re-export 以保持向后兼容。
 *   - mapWatchStatus 在状态无法识别时调用 bgmLog 记录警告。pure-utilities-core.ts 通过
 *     setLogger 接受注入的日志函数；本模块在加载时注入实际的 bgmLog。
 *   - getSeqColumnIndex / addTagsFromString / buildTagsArray 不依赖副作用模块，保留在本模块。
 *
 * 测试策略：单元测试应直接 import 自 pure-utilities-core.js，并通过 setLogger(vi.fn())
 * 注入 mock 日志函数，以避免触发 tools/util → ui/handlers 的副作用链。
 */
export { isBangumiUrl, extractSubjectId, mapWatchStatus } from './pure-utilities-core.js';
/**
 * 获取序列号列索引（支持 columnMap 或默认列号）
 */
export declare function getSeqColumnIndex(columnMap: Map<string, number> | undefined): number;
/**
 * 从字符串解析标签数组
 *
 * @function addTagsFromString
 * @param {Set<string>} tagSet - 标签集合（输出参数）
 * @param {string} tagsRaw - 原始标签字符串
 *
 * @description
 * 标签分隔符支持：英文逗号、中文逗号、空格、分号、顿号、换行
 * 标签会被trim后加入集合，空白标签会被忽略
 *
 * @example
 * const tags = new Set<string>();
 * addTagsFromString(tags, '治愈,日常,萌系');
 * // tags = {'治愈', '日常', '萌系'}
 */
export declare function addTagsFromString(tagSet: Set<string>, raw: string): void;
/**
 * 构建标签数组
 *
 * @function buildTagsArray
 * @param {string} tagsRaw - 原始标签字符串
 * @returns {string[]} 标签数组
 *
 * @example
 * buildTagsArray('治愈,日常 萌系'); // 返回 ['治愈', '日常', '萌系']
 */
export declare function buildTagsArray(tagsRaw: string): string[];
//# sourceMappingURL=pure-utilities.d.ts.map