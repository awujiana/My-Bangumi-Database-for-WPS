/**
 * UI 事件处理模块 - 工作表清洗相关
 * @module ui/handlers/sheet
 * @description 锁定数据表的重复行清洗（按名称合并、保留含 URL 的行、合并标签）。
 *              核心逻辑在 sync/sheet-cleaning.ts（富化完成后自动去重复用同一实现）。
 */
import type { WpsWorksheet } from '../../tools/wps.js';
/**
 * 选中「上次同步失败的行」，供用户接着点「👆 选中行同步」只重发这几行。
 *
 * 只做选中、不直接发请求——用户能在发请求前先看清要重试哪些行；同步路径完全
 * 复用现有的 `app.Selection` 读取逻辑，不新增一条同步实现。
 *
 * 三条拒绝条件（都比「静默选中错行」好）：
 *  1. 没有失败记录；
 *  2. 失败行属于另一张表（行号换表就错位了）；
 *  3. 地址串超长（Excel Range 地址有长度上限）。
 */
export declare function selectFailedRowsFromLastSync(): void;
/**
 * 清洗锁定的数据工作表：
 * 1. 按"名称"列分组，识别重复行
 * 2. 在重复组中保留含 Bangumi_URL 的行，删除无 URL 的行
 * 3. 合并被删除行的"标签/分级"到保留行
 * 4. 批量删除行（合并连续行为范围删除，减少 COM 调用）
 *
 * @param targetWorksheet 可选：直接指定要清洗的工作表（富化页在目标表上自动去重时使用）；
 *                 缺省时按锁定索引从活动工作簿解析。
 */
export declare function cleanLockedDataSheet(targetWorksheet?: WpsWorksheet): void;
//# sourceMappingURL=sheet.d.ts.map