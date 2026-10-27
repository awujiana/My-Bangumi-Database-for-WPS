/**
 * 锁定数据表的重复行清洗核心（与 UI 解耦，供主面板清洗按钮、富化完成后自动去重、
 * 以及通用清理页的「扫描预览 / 执行」两阶段复用）。
 * @module sync/sheet-cleaning
 * @description
 * 按「名称」列分组识别重复行：保留含 Bangumi_URL 的行、合并被删除行的
 * 「标签/分级」到保留行、批量删除无 URL 的重复行。
 * 不做任何 UI 交互（toast/弹窗），由调用方根据返回结果自行提示。
 *
 * 两阶段设计：
 * - `plan*`：**只读扫描**，产出待删除行与待写入变更（供执行前预览）；
 * - `applyRowPlan`：**写入**，先应用单元格变更、再从大到小批量删行。
 * 预览与执行走同一份计划，保证预览条数与实际执行条数严格一致。
 */
import type { WpsWorksheet } from '../tools/wps.js';
/** 清洗结果摘要（cleanSheetDuplicates 的返回类型） */
export interface CleanDuplicatesResult {
    /** 是否执行了删除（发生重复清洗） */
    performed: boolean;
    /** 删除的重复行数 */
    deletedRows: number;
    /** 合并了标签的名称组数 */
    mergedTagGroups: number;
    /** 重复名称组数 */
    duplicateNameGroups: number;
    /** 未执行清洗的原因（无重复/缺列/无数据等），已执行时为 undefined */
    skippedReason?: string | undefined;
}
/** 单个待写入的单元格变更 */
export interface RowChange {
    /** 行号（1-based，Excel 行号） */
    row: number;
    /** 列号（1-based） */
    column: number;
    /** 目标值 */
    value: string;
    /** 原值（行级规则的标签合并等；采集自已读入的列，零额外 COM 读取） */
    oldValue?: string | undefined;
}
/**
 * 待删除行的预览数据（执行前预览的 diff 视图用）。
 * 扫描期顺带采集：names / urls 等列本就已读入内存，**不产生额外 COM 读取**。
 */
export interface DeletedRowPreview {
    /** Excel 行号（1-based） */
    row: number;
    /** 名称列值（空白行 / 无名称列时为空串） */
    name: string;
    /** Bangumi_URL 值（无 URL 列或无 URL 时为空串） */
    url: string;
}
/** 重复分组的「保留行 vs 待删除行」结构（diff 对比视图用） */
export interface DuplicateGroupPreview {
    /** 保留行行号 */
    keepRow: number;
    /** 保留行名称 */
    keepName: string;
    /** 保留行 URL */
    keepUrl: string;
    /** 待删除行（含名称与 URL，便于用户核对引擎是否留对了行） */
    victims: DeletedRowPreview[];
}
/** 行级清理计划（只读扫描的产物） */
export interface RowPlan {
    /** 待删除行号（升序） */
    deleteRows: number[];
    /** 待写入的单元格变更（如合并后的标签） */
    changes: RowChange[];
    /** 命中的重复组数 */
    groups: number;
    /** 发生标签合并的组数 */
    mergedGroups: number;
    /** 未产生任何清理时的原因 */
    skippedReason?: string | undefined;
    /** 待删除行的预览数据（执行前预览用；扫描期顺带采集，零额外 COM 读取） */
    rowPreviews?: DeletedRowPreview[];
    /** 重复分组结构（保留行 vs 待删除行；仅重复类规则产出） */
    groupPreviews?: DuplicateGroupPreview[];
}
/** 扫描选项 */
export interface RowPlanOptions {
    /** 不参与清理的行号集合（汇总行 / 说明行等，由排除规则得出） */
    excludedRows?: ReadonlySet<number>;
    /**
     * 调用方已解析的表结构（每目标解析一次、多规则共用，见 `clean-engine` 的 `scanTarget`）。
     *
     * 传入时跳过内部 `readSheetLayout`——每规则省 ~3 次 COM
     * （`findHeaderRow` + `getLastRow` + `getColumnMap`）。传 `null` 表示
     * 「已解析且失败」，直接返回空计划，不再重复解析。
     *
     * ⚠️ 语义契约：调用方须传 `readSheetLayout(worksheet)` 的**同一结果**。新番表无标准
     * 「名称」表头时解析结果为 `null`——与不传时各计划自行解析的结果一致，
     * 因此新番表不会因共享而突然获得行级清理能力（推导 columnMap 只在
     * `buildTarget` 的新番表专属签名路径内使用，不进本选项）。
     * 不传（`undefined`）时按原行为自行解析，保持 `plan*` 可独立调用。
     */
    layout?: SheetLayout | null;
}
/** 表结构信息（扫描阶段统一解析，避免重复 COM 调用） */
export interface SheetLayout {
    /** 表头行号 */
    headerRow: number;
    /** 最后数据行号 */
    lastRow: number;
    /** 列名 → 列号 */
    columnMap: Map<string, number>;
    /** 数据起始行 */
    dataStartRow: number;
}
/**
 * 解析工作表结构。失败（无表头 / 无数据行）时返回 null，由调用方记日志。
 */
export declare function readSheetLayout(worksheet: WpsWorksheet): SheetLayout | null;
export { mergeTagValues } from './value-merge.js';
/**
 * 扫描「重复名称行」。
 * 按「名称」分组，保留组内首个含 Bangumi_URL 的行，删除组内无 URL 的重复行，
 * 并把被删行的「标签/分级」合并进保留行（去重）。
 */
export declare function planDuplicateRows(worksheet: WpsWorksheet, options?: RowPlanOptions): RowPlan;
/**
 * 扫描「同一 Bangumi_URL 出现在多行」的重复行（含跨名称场景）：
 * 保留行号最大的一行，合并其余行的「标签/分级」后删除其余行。
 */
export declare function planDuplicateUrlRows(worksheet: WpsWorksheet, options?: RowPlanOptions): RowPlan;
/**
 * 扫描数据区内部的空白行：「名称」为空，且所有已识别列均无数据。
 * 只清理数据区内部（表头行 +1 ~ 最后数据行）的空洞，不动表尾。
 */
export declare function planEmptyNameRows(worksheet: WpsWorksheet, options?: RowPlanOptions): RowPlan;
/**
 * 批量删除行：从大到小删除，并把连续行合并为单个 Range 调用，减少 COM 次数。
 * @returns 实际发生的 Range.Delete 调用次数
 */
export declare function deleteRowsBatched(worksheet: WpsWorksheet, rows: readonly number[]): number;
/**
 * 应用行级清理计划：先写入单元格变更，再从大到小批量删除行。
 * 变更所在行若同时处于待删除列表则跳过，避免写入即将删除的行。
 * @returns 实际删除的行数
 */
export declare function applyRowPlan(worksheet: WpsWorksheet, plan: RowPlan): number;
/**
 * 清洗指定工作表的重复行（一步到位版本，供主面板「数据清洗」按钮与富化后自动去重使用）。
 *
 * 1. 按「名称」列分组，识别重复行；
 * 2. 重复组中保留含 Bangumi_URL 的行，无 URL 的行进入待删除；
 * 3. 把被删除行的「标签/分级」合并到保留行（去重，` | ` 连接）；
 * 4. 合并连续行为范围删除，减少 COM 调用。
 */
export declare function cleanSheetDuplicates(worksheet: WpsWorksheet): CleanDuplicatesResult;
//# sourceMappingURL=sheet-cleaning.d.ts.map