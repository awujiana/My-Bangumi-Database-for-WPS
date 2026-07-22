/**
 * UI 事件处理模块 - 工作表清洗相关
 * @module ui/handlers/sheet
 * @description 锁定数据表的重复行清洗（按名称合并、保留含 URL 的行、合并标签）。
 */
/**
 * 清洗锁定的数据工作表：
 * 1. 按"名称"列分组，识别重复行
 * 2. 在重复组中保留含 Bangumi_URL 的行，删除无 URL 的行
 * 3. 合并被删除行的"标签/分级"到保留行
 * 4. 批量删除行（合并连续行为范围删除，减少 COM 调用）
 */
export declare function cleanLockedDataSheet(): void;
//# sourceMappingURL=sheet.d.ts.map