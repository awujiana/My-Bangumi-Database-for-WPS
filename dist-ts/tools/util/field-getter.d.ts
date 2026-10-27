/**
 * @fileoverview 批量字段访问器与同步行指纹（COM 矩形读 + 逐格回退的收敛点）
 * @module tools/util/fieldGetter
 * @description
 * 「一次矩形读 + 逐格读回退」的字段访问器此前在 `sync/exceltobangumi` 的
 * `createFieldGetter` 与 `services/ribbon-service` 的 `getField` 各存一份
 * 逐字相同的实现；增量同步行指纹数组也有三份逐字重复（ribbon-service 两处 +
 * exceltobangumi 一处）。本模块收敛为一份：
 *   - {@link createBatchFieldGetter}：矩形读 `startRow..lastRow × 1..maxColumn`，
 *     访问器优先取批量结果，行/列越界或宿主返回形状异常时回退 `getCellValue`；
 *   - {@link calcSyncRowFingerprint}：按 `buildJsonPayload` 的字段口径算行指纹。
 *
 * 矩形读宽度由调用方传入的列名表决定（同步预览与上传预处理的列集不同），
 * 收敛后行为与收敛前逐字一致。
 */
import type { WpsWorksheet } from '../wps.js';
/** 字段访问器：(行号, 列名) → 单元格文本 */
export type FieldGetter = (row: number, key: string) => string;
/**
 * 批量读取数据并创建字段快速访问器（矩形读 + 逐格回退）。
 *
 * @param worksheet 工作表
 * @param columnMap 列名 → 列号
 * @param startRow 数据起始行
 * @param lastRow 数据末行
 * @param columns 参与批量读取的列名（只决定矩形读宽度；访问器对表外列走逐格回退）
 * @returns 字段访问器
 */
export declare function createBatchFieldGetter(worksheet: WpsWorksheet, columnMap: Map<string, number>, startRow: number, lastRow: number, columns: readonly string[]): FieldGetter;
/**
 * 增量同步行指纹：字段口径与 `buildJsonPayload` 保持一致
 * （名称 / 观看状态 / 打分 / 标签/分级 / 原作标签 / 剧透/感言 / 集数 / 集号）。
 *
 * @param getField 单行字段访问器（列名 → 文本）
 * @param watchType `mapWatchStatus` 归一化后的观看状态（空状态为 1）
 * @returns 行指纹字符串
 */
export declare function calcSyncRowFingerprint(getField: (key: string) => string, watchType: number): string;
//# sourceMappingURL=field-getter.d.ts.map