/**
 * @fileoverview Bangumi 同步纯函数模块
 * @module sync/pureUtils
 * @description 提供 URL 识别、Subject ID 提取、观看状态映射等纯函数。
 *              这些函数不依赖 WPS API，仅依赖常量定义和字符串工具。
 */
/**
 * 判断字符串是否为 Bangumi 条目 URL（支持 bgm.tv / bangumi.tv / chii.in）
 * @param url 待检测的字符串
 * @returns 如果是 BGM 域名链接返回 true；纯数字 ID 也返回 true；否则返回 false
 */
export declare function isBangumiUrl(url: string): boolean;
/**
 * 获取序列号列索引（支持 colMap 或默认列号）
 */
export declare function getSeqColIndex(colMap: Map<string, number> | undefined): number;
/**
 * 从URL或文本中提取Bangumi Subject ID
 *
 * @function extractSubjectId
 * @param {string} input - URL或包含ID的文本
 * @returns {string} 提取的Subject ID，失败返回空字符串
 *
 * @description
 * 支持的URL格式：
 * - https://bgm.tv/subject/123456
 * - https://bangumi.tv/subject/123456
 * - https://chii.in/subject/123456
 * - 直接输入数字ID
 *
 * @example
 * extractSubjectId('https://bgm.tv/subject/123456'); // 返回 '123456'
 * extractSubjectId('123456'); // 返回 '123456'
 */
export declare function extractSubjectId(input: string): string;
/**
 * @function mapWatchStatus
 * @param {string} status - 观看状态文本
 * @returns {number} API数值：1=想看, 2=在看, 3=看过, 4=搁置, 5=抛弃
 *
 * @description
 * 支持的状态文本映射：
 * - 想看/想看动画/否/wish → 1
 * - 在看/在看动画/在追/追/watching → 2
 * - 看过/看完/已看/完/completed → 3
 * - 搁置/暂停/on_hold → 4
 * - 抛弃/弃/弃番/drop/dropped → 5
 *
 * @example
 * mapWatchStatus('看完'); // 返回 3
 * mapWatchStatus('在看'); // 返回 2
 */
export declare function mapWatchStatus(status: string): number;
/**
 * 从字符串解析标签数组
 *
 * @function addTagsFromStr
 * @param {Set<string>} tagSet - 标签集合（输出参数）
 * @param {string} tagsRaw - 原始标签字符串
 *
 * @description
 * 标签分隔符支持：英文逗号、中文逗号、空格、分号、顿号、换行
 * 标签会被trim后加入集合，空白标签会被忽略
 *
 * @example
 * const tags = new Set<string>();
 * addTagsFromStr(tags, '治愈,日常,萌系');
 * // tags = {'治愈', '日常', '萌系'}
 */
export declare function addTagsFromStr(tagSet: Set<string>, raw: string): void;
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
//# sourceMappingURL=pureUtils.d.ts.map