/**
 * @fileoverview 字符串工具函数模块
 * @module tools/string-utilities
 * @description 提供 Excel 列号转换、字符串修剪、HTML 转义、指纹计算等函数。
 *
 * 模块拆分说明：
 *   - columnNumberToLetter / escapeHtml / trim 是无项目依赖的纯函数，已抽取到
 *     ./string-utilities-pure.js（零依赖模块）。本模块 re-export 以保持向后兼容。
 *   - calcFingerprint 依赖 core/token-payload 中的 calcChecksum（纯算术函数），但
 *     crypto.ts 又 import 自 index.ts，会随 utility.ts 一同进入已有的循环依赖链
 *     （util → crypto → index → util），由于均为 hoisted 的 function 声明，
 *     运行时安全。
 *
 * 测试策略：单元测试应直接 import 自 string-utilities-pure.js，以避免触发
 * handlers.ts 的 setTimeout / addEventListener 副作用。
 */
/**
 * 计算 Excel 行数据的指纹（用于增量同步比较）
 *
 * @param fields - 关键字段值数组，如 [name, type, rate, tags, comment]
 * @returns 指纹字符串（16 进制校验和，左侧补零至 4 位）
 */
export declare function calcFingerprint(fields: string[]): string;
export { columnNumberToLetter, escapeHtml, trim } from './string-utilities-pure.js';
//# sourceMappingURL=string-utilities.d.ts.map