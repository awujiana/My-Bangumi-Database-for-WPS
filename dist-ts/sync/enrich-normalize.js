/**
 * @fileoverview 富化引擎的纯文本工具：名称规范化 / 标签与特点拼接 / 噪声过滤
 * @module sync/enrich-normalize
 * @description
 *   从 `enrich-engine.ts` 切出的**无副作用纯函数簇**。切出的理由有二：
 *   ① 它们是引擎里唯一不碰 WPS COM 的部分，独立后可被预览、富化、设置页共用而不
 *      必引入整个引擎；② `enrich-engine.ts` 超过 2000 行，先挪走最独立的一簇。
 *
 *   本模块**不 import `enrich-engine.ts`**（会成环），也不反向依赖任何上层模块。
 */
import { CONFIG_KEYS, getConfig } from '../tools/config.js';
/** 标签分隔符 */
export const TAG_SEPARATOR = ' | ';
/** 特点/印象分隔符 */
export const FEATURE_SEPARATOR = ' | ';
/**
 * 规范化名称
 * 去空格、转小写、全角转半角
 */
export function normalizeName(name) {
    return name
        .replace(/\s+/g, '')
        .toLowerCase()
        .replace(/[！-～]/g, (char) => {
        const code = char.codePointAt(0) ?? 0;
        return String.fromCodePoint(code - 0xfee0);
    });
}
/**
 * 分割别名字符串
 * 按 |、/、;、， 等分隔符分割
 */
export function splitAliases(aliasesString) {
    if (!aliasesString)
        return [];
    return aliasesString
        .split(/\s*\|\s*|\s*[;，、]\s*|\s*\/\s*/)
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
}
/**
 * 分割标签字符串
 * 按 TAG_SEPARATOR 或常见分隔符分割
 */
export function splitTags(tags) {
    if (!tags)
        return [];
    return tags
        .split(/\s*\|\s*|\s*[,、;]\s*|\s*\/\s*/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
}
// 合并标签去重的实现已下沉到 value-merge.ts（零依赖叶子模块，语义差异见其模块文档），
// 此处 re-export 保持既有导入路径（enrich-engine / index barrel / 测试）不变。
export { mergeTags } from './value-merge.js';
/**
 * 追加特点信息去重
 * 将新特点追加到旧特点后，以 FEATURE_SEPARATOR 分隔
 */
export function appendFeatures(oldFeature, features) {
    if (!oldFeature)
        return features;
    if (!features)
        return oldFeature;
    const oldList = oldFeature
        .split(FEATURE_SEPARATOR)
        .map((f) => f.trim())
        .filter(Boolean);
    const list = features
        .split(FEATURE_SEPARATOR)
        .map((f) => f.trim())
        .filter(Boolean);
    const merged = [...oldList];
    for (const feat of list) {
        if (!merged.includes(feat)) {
            merged.push(feat);
        }
    }
    return merged.join(FEATURE_SEPARATOR);
}
/** 内置噪声关键词：署名行 / 标注示例 / 占位文本 */
const NOISE_KEYWORDS_DEFAULT = [
    '新番表 by Hazx',
    '版权平台标注示例',
    '播放平台示例',
    '标注示例',
    '示例',
    'placeholder',
    '（示例）',
    '(示例)',
];
let customNoiseKeywordsCache = null;
/** 清空自定义噪声关键词缓存（设置页保存后调用） */
export function resetNoiseKeywordCache() {
    customNoiseKeywordsCache = null;
}
/** 读取自定义噪声关键词（CONFIG_KEYS.ENRICH_FILTER_KEYWORDS，换行/逗号分隔，带缓存） */
function getCustomNoiseKeywords() {
    if (customNoiseKeywordsCache)
        return customNoiseKeywordsCache;
    let keywords = [];
    try {
        const raw = getConfig(CONFIG_KEYS.ENRICH_FILTER_KEYWORDS, '', true).trim();
        if (raw) {
            keywords = raw
                .split(/[\n,]/)
                .map((keyword) => keyword.trim())
                .filter((keyword) => keyword !== '');
        }
    }
    catch {
        keywords = [];
    }
    customNoiseKeywordsCache = keywords;
    return keywords;
}
/**
 * 判断单段文本是否应作为噪声过滤掉（子串匹配）：
 * 内置规则 + 设置页自定义关键词。
 */
export function shouldFilterNoise(part) {
    const trimmed = part.trim();
    if (!trimmed)
        return true;
    for (const keyword of NOISE_KEYWORDS_DEFAULT) {
        if (trimmed.includes(keyword))
            return true;
    }
    for (const keyword of getCustomNoiseKeywords()) {
        if (trimmed.includes(keyword))
            return true;
    }
    return false;
}
