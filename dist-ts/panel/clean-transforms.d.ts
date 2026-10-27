/**
 * @fileoverview 通用清理功能 · 单元格值变换（纯函数，不依赖 WPS / DOM）
 * @module panel/cleanTransforms
 * @description
 * 对单个单元格文本做无损 / 有损变换，供 `cellTransform` 类清理项复用。
 * 全部为纯函数，便于单测与在预览阶段复用（预览与执行走同一份逻辑，
 * 保证「预览显示的条数」与「实际执行的条数」严格一致）。
 *
 * 规则常量（噪声词表、归一化规则）来自 clean-rules.ts，本文件只做算法。
 */
import type { CellTransformId } from './clean-rules.js';
/** 变换所需的同行上下文 */
export interface TransformContext {
    /** 同行「名称」列的值（别名去重等需要参照列的变换使用） */
    name: string;
}
/** 变换结果 */
export interface TransformOutcome {
    /** 变换后的值（未变更时等于入参） */
    value: string;
    /** 是否发生变更 */
    changed: boolean;
    /** 被移除 / 归并的条目数（用于日志与统计） */
    removed: number;
}
/**
 * 按 `|`（允许两侧空格，兼容全角 `｜`）拆分标签文本为去空后的标签数组。
 */
export declare function splitTagValue(raw: string): string[];
/**
 * 估算字符串的 UTF-8 字节数。
 * 不依赖 TextEncoder（WPS 内嵌浏览器版本差异），按 Unicode 码点区间自行计算。
 */
export declare function estimateUtf8Bytes(text: string): number;
/** 判断单个标签是否为噪声标签（全等匹配或整项命中噪声正则） */
export declare function isNoiseTag(tag: string): boolean;
/**
 * 按 ID 执行单元格变换。未知 ID 或空值均返回「未变更」，绝不抛错。
 */
export declare function transformCellValue(id: CellTransformId, raw: string, context: TransformContext): TransformOutcome;
//# sourceMappingURL=clean-transforms.d.ts.map