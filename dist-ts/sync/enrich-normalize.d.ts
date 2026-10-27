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
/** 标签分隔符 */
export declare const TAG_SEPARATOR = " | ";
/** 特点/印象分隔符 */
export declare const FEATURE_SEPARATOR = " | ";
/**
 * 规范化名称
 * 去空格、转小写、全角转半角
 */
export declare function normalizeName(name: string): string;
/**
 * 分割别名字符串
 * 按 |、/、;、， 等分隔符分割
 */
export declare function splitAliases(aliasesString: string): string[];
/**
 * 分割标签字符串
 * 按 TAG_SEPARATOR 或常见分隔符分割
 */
export declare function splitTags(tags: string): string[];
export { mergeTags } from './value-merge.js';
/**
 * 追加特点信息去重
 * 将新特点追加到旧特点后，以 FEATURE_SEPARATOR 分隔
 */
export declare function appendFeatures(oldFeature: string, features: string): string;
/** 清空自定义噪声关键词缓存（设置页保存后调用） */
export declare function resetNoiseKeywordCache(): void;
/**
 * 判断单段文本是否应作为噪声过滤掉（子串匹配）：
 * 内置规则 + 设置页自定义关键词。
 */
export declare function shouldFilterNoise(part: string): boolean;
//# sourceMappingURL=enrich-normalize.d.ts.map