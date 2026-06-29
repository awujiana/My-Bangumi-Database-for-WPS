/**
 * @fileoverview Bangumi 同步纯函数模块
 * @module sync/pureUtils
 * @description 提供 URL 识别、Subject ID 提取、观看状态映射等纯函数。
 *              这些函数不依赖 WPS API，仅依赖常量定义和字符串工具。
 */
import { URL_PATTERNS, WATCH_STATUS_MAP, LOG_LEVELS } from '../core/constants.js';
import { bgmLog } from '../tools/util.js';
import { trim } from '../tools/stringUtils.js';
/** 序列号列默认索引 */
const DEFAULT_SEQ_COL = 4;
/**
 * 判断字符串是否为 Bangumi 条目 URL（支持 bgm.tv / bangumi.tv / chii.in）
 * @param url 待检测的字符串
 * @returns 如果是 BGM 域名链接返回 true；纯数字 ID 也返回 true；否则返回 false
 */
export function isBangumiUrl(url) {
    if (!url)
        return false;
    const s = trim(url);
    if (!s)
        return false;
    // 纯数字视为合法的 Subject ID
    if (/^\d+$/.test(s))
        return true;
    // 检查是否匹配任一 BGM URL 模式
    return URL_PATTERNS.some(pattern => pattern.test(s));
}
/**
 * 获取序列号列索引（支持 colMap 或默认列号）
 */
export function getSeqColIndex(colMap) {
    return colMap?.get('序列号') || DEFAULT_SEQ_COL;
}
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
export function extractSubjectId(input) {
    if (!input)
        return '';
    const trimmed = trim(input);
    if (!trimmed)
        return '';
    // 如果是纯数字，直接返回
    if (/^\d+$/.test(trimmed)) {
        return trimmed;
    }
    // 尝试匹配URL模式
    for (const pattern of URL_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    // 尝试从文本中提取数字
    const numMatch = trimmed.match(/\d+/);
    if (numMatch) {
        return numMatch[0];
    }
    return '';
}
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
export function mapWatchStatus(status) {
    if (!status)
        return 1;
    const normalized = trim(status).toLowerCase();
    // 直接查找
    if (WATCH_STATUS_MAP[normalized] !== undefined) {
        return WATCH_STATUS_MAP[normalized];
    }
    // 模糊匹配
    for (const [key, value] of Object.entries(WATCH_STATUS_MAP)) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return value;
        }
    }
    // 布尔值转换
    if (normalized === 'true')
        return 3;
    if (normalized === 'false')
        return 0;
    // 数字字符串转换
    const num = parseInt(normalized, 10);
    if (!isNaN(num) && num >= 0 && num <= 5) {
        return num;
    }
    // 无法识别的状态，记录警告日志
    bgmLog(LOG_LEVELS.WARN, `[mapWatchStatus] 无法识别的状态值: "${status}"，返回 0（无效）`);
    return 0;
}
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
export function addTagsFromStr(tagSet, raw) {
    if (!raw)
        return;
    // 按 | 或 , 或 ; 分割，并过滤掉纯符号和空白
    const parts = raw.split(/[|,;，；]/);
    parts.forEach(part => {
        const tag = part.trim();
        if (tag && !['|', ',', ';', '，', '；'].includes(tag)) {
            tagSet.add(tag);
        }
    });
}
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
export function buildTagsArray(tagsRaw) {
    const tagSet = new Set();
    addTagsFromStr(tagSet, tagsRaw);
    return Array.from(tagSet);
}
