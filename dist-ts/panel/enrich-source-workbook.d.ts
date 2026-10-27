/**
 * @fileoverview 富化页源工作簿的打开/回收生命周期
 * @module panel/enrich-source-workbook
 * @description
 *   新番表源工作簿的开关被「表头自动识别 / 工作簿变化监听 / 多新番表切换 /
 *   匹配预览 / 富化执行」多处共用，且必须**只回收本插件自己打开的那一个**
 *   （用户已打开的工作簿不能关）。抽成叶子模块，让各流程块单向依赖。
 */
import type { WpsWorksheet, WpsWorkbook } from '../tools/wps.js';
/** 打开新番表文件；已在 WPS 中打开时直接复用，返回是否由本函数打开 */
export declare function openSourceWorkbook(filePath: string): {
    wb: WpsWorkbook;
    isOpenedByUs: boolean;
} | null;
/** 关闭工作簿且不保存修改 */
export declare function closeWorkbook(wb: WpsWorkbook): void;
/** 回收单文件自动识别时接管的源工作簿（仅关闭本插件打开的，用户已打开的保持不动） */
export declare function closeOpenedSourceWorkbook(): void;
/** 仅关闭源工作簿并断开引用，保留已识别的表头行/列映射（closeSourceAfterDetect 模式用） */
export declare function closeSourceWorkbookOnly(): void;
/**
 * 确保开始富化/预览时的源表可用。
 * closeSourceAfterDetect 模式下识别后工作簿已关闭，此处按需重开并恢复源表引用。
 * @returns 可用的源工作表；不可用返回 null
 */
export declare function ensureSourceSheet(): WpsWorksheet | null;
//# sourceMappingURL=enrich-source-workbook.d.ts.map