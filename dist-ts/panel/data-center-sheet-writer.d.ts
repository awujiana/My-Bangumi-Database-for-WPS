/**
 * @fileoverview 搜索结果写入工作表的 COM 薄封装（找/建同名表 → 清空 → 矩形写）
 * @module panel/dataCenterSheetWriter
 * @description 行数据构造在 services/data-center-export.ts（纯函数、可单测）；
 *              本模块只做 WPS COM 往返，遵循两个项目约束：
 *                1. 覆盖语义 = 找到同名表后清空数据区再写，不删表（删表会移位/触发确认框）；
 *                2. 一次 Range.Value2 矩形写表头与数据，避免逐格写放大成 N 次跨进程调用。
 *              WPS 任务窗格启动期不能碰 COM，本模块的函数只在按钮回调里调用。
 */
import type { WpsCellValue } from '../tools/wps.js';
/** 写入结果 */
export interface WriteResult {
    ok: boolean;
    /** 写入的数据行数（不含表头） */
    written: number;
    /** 失败原因（成功时为空） */
    error: string;
}
/**
 * 把行数据写入当前工作簿的「搜索结果」表（同名则覆盖数据区）。
 * @param rows 二维数组，第 0 行为表头，其余为数据行
 */
export declare function writeRowsToResultSheet(rows: readonly (readonly WpsCellValue[])[]): WriteResult;
//# sourceMappingURL=data-center-sheet-writer.d.ts.map