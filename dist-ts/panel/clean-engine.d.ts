/**
 * @fileoverview 通用清理功能 · 执行引擎（扫描 / 预览 / 执行）
 * @module panel/cleanEngine
 * @description
 * 引擎不认识任何「具体清理项」，只做三件事：
 *  1. 按 {@link CLEAN_TARGETS} / {@link CLEAN_EXCLUDES} 解析出待清理目标（工作簿 × 工作表）；
 *  2. 对每个目标 × 每条勾选规则调用对应扫描器，产出**只读**计划（待删除行 / 待写入变更）；
 *  3. 执行阶段：先写单元格变更 → 再批量删行，逐目标异常隔离并回传进度。
 *
 * 规则与展示分离：页面只消费引擎产出的统计与计划，具体清理项全部来自 clean-rules.ts。
 */
import type { WpsWorksheet } from '../tools/wps.js';
import type { DeletedRowPreview, DuplicateGroupPreview } from '../sync/sheet-cleaning.js';
/** 一个待清理目标（工作簿中的一张工作表） */
export interface CleanTargetInfo {
    /** 唯一键：`工作簿全路径::表名` */
    key: string;
    /** 工作簿名 */
    workbookName: string;
    /** 工作簿全路径（预览与日志展示用） */
    workbookPath: string;
    /** 工作表名 */
    sheetName: string;
    /** 显示用标签：`工作簿名 / 表名` */
    label: string;
    /** 表头行号 */
    headerRow: number;
    /** 最后数据行号 */
    lastRow: number;
    /** 列名 → 列号 */
    columnMap: Map<string, number>;
    /** 工作表对象（执行阶段使用） */
    worksheet: WpsWorksheet;
}
/** 单元格变更（含新旧值，供预览与日志使用） */
export interface CellChange {
    /** Excel 行号 */
    row: number;
    /** 列号 */
    column: number;
    /** 列名（用于日志展示） */
    columnName: string;
    /** 原值 */
    oldValue: string;
    /** 变更后的值 */
    nextValue: string;
}
/** 单条规则 × 单个目标的清理计划 */
export interface RulePlan {
    /** 规则 ID */
    ruleId: string;
    /** 规则名 */
    ruleName: string;
    /** 目标键 */
    targetKey: string;
    /** 目标显示标签 */
    targetLabel: string;
    /** 待删除行号（升序） */
    deleteRows: number[];
    /** 待写入的单元格变更 */
    changes: CellChange[];
    /** 预计释放字节数 */
    estimatedBytes: number;
    /** 跳过原因（无计划时） */
    skipped?: string;
    /** 待删除行的预览数据（执行前预览的 diff 视图用；行级规则产出） */
    rowPreviews?: DeletedRowPreview[] | undefined;
    /** 重复分组结构（保留行 vs 待删除行；重复类规则产出） */
    groupPreviews?: DuplicateGroupPreview[] | undefined;
}
/** 扫描结果（执行前预览的数据源） */
export interface CleanScanResult {
    /** 命中的目标（工作簿 × 工作表）列表 */
    targets: CleanTargetInfo[];
    /** 全部计划（含跳过项，便于日志说明） */
    plans: RulePlan[];
    /** 涉及文件数（= 不同工作簿数量） */
    fileCount: number;
    /** 涉及目标表数量 */
    targetCount: number;
    /** 待清理条目数（删除行 + 单元格变更） */
    itemCount: number;
    /** 预计释放空间（字节，估算值） */
    estimatedBytes: number;
    /** 扫描过程中的提示（目标过滤原因、跳过原因等） */
    notes: string[];
}
/** 单个目标的执行结果 */
export interface TargetRunResult {
    targetKey: string;
    targetLabel: string;
    /** 实际删除行数 */
    deletedRows: number;
    /** 实际写入单元格数 */
    changedCells: number;
    /** 失败信息（成功时为 undefined） */
    error?: string;
}
/** 执行结果 */
export interface CleanRunResult {
    /** 逐目标结果 */
    targets: TargetRunResult[];
    /** 删除行合计 */
    deletedRows: number;
    /** 写入单元格合计 */
    changedCells: number;
    /** 涉及文件数 */
    fileCount: number;
    /** 耗时（毫秒） */
    elapsedMs: number;
}
/** 进度回调：(已完成目标数, 总目标数, 当前描述) */
export type CleanProgressCallback = (done: number, total: number, message: string) => void;
/** 工作簿是否允许清理（排除规则优先于包含规则；供 clean-page 复用，保证 UI 候选与引擎口径一致） */
export declare function isWorkbookAllowed(path: string): boolean;
/**
 * 工作表探测结果（页面「选择清理的表格」与引擎共用同一套识别逻辑，
 * 避免页面显示与实际清理范围不一致）。
 */
export interface SheetInspection {
    /** 表头行号（0 = 未识别到任何表头） */
    headerRow: number;
    /** 最后一行行号（UsedRange 末行） */
    lastRow: number;
    /** 数据行数（lastRow - headerRow，最小 0） */
    dataRows: number;
    /** 表头文本（前 8 个非空值，仅展示用） */
    headers: string[];
    /** 是否识别为月历式新番表（无「名称」表头） */
    isXinFan: boolean;
    /** 是否具备「名称」列（含新番表锚点列推导；仅作展示信息，不再作为入选门槛） */
    hasNameColumn: boolean;
    /** 是否识别为 Bangumi 数据表（命中特征列，或命中月历式新番表签名） */
    isBangumiSheet: boolean;
    /** 是否满足清理条件（识别为 Bangumi 数据表 / 新番表 + 数据行数在护栏内） */
    eligible: boolean;
    /** 未满足清理条件的原因（达标时为空串，页面据此展示提示） */
    reason: string;
}
/**
 * 探测单张工作表的表头与数据规模（只读，不修改任何数据）。
 *
 * 识别路径与目标构造完全一致：
 *  1. 标准路径：表头行可识别（`getColumnMap` 归一化），且命中任一
 *     {@link CLEAN_TARGETS.identityColumns} 特征列（名称 / Bangumi_URL）；
 *  2. 新番表路径：表头无特征列，但命中 {@link XINFAN_HEADER} 专属签名（月历式新番表）。
 */
export declare function inspectWorksheet(worksheet: WpsWorksheet): SheetInspection;
/**
 * 解析全部待清理目标：遍历已打开工作簿 → 按配置过滤 → 校验表头与数据行数。
 * 无任何可用目标时返回空数组（调用方据此提示）。
 *
 * @param selectedSheets 用户显式勾选的工作表（按 `工作簿全路径 :: 表名` 匹配）。
 *   非空时仅保留白名单命中，且命中项跳过「必须有名称列」的硬门槛（用户已确认要清理）。
 */
export declare function listCleanTargets(selectedSheets?: readonly {
    workbookKey: string;
    sheetName: string;
}[]): CleanTargetInfo[];
/**
 * 计算单个目标中「不参与清理」的行号集合（汇总行 / 说明行等）。
 * 只扫描前 rowScanColumns 列，避免整表读取。
 */
export declare function collectExcludedRows(target: CleanTargetInfo, block?: readonly string[][]): Set<number>;
/**
 * 估算单个目标的「每行平均字节数」：均匀采样至多 ROW_BYTES_SAMPLE_LIMIT 行读取整行，
 * 取平均；采样失败时回退到 ROW_BYTES_FALLBACK。
 */
export declare function estimateRowBytes(target: CleanTargetInfo, block?: readonly string[][]): number;
/**
 * 扫描全部勾选规则（只读，不修改任何单元格）。
 *
 * **异步**：逐目标之间让出宏任务（setTimeout 0，而非微任务 —— 微任务不足以
 * 让浏览器重绘）。大表扫描是整块 COM 读取，同步执行会让任务窗格在扫描期间
 * 完全冻结（按钮无反馈、无法滚动）；让出后每完成一张表就有一次重绘机会。
 *
 * @param ruleIds 勾选的规则 ID
 * @param options.selectedSheets 用户显式勾选的工作表白名单（按 `工作簿全路径 :: 表名` 形式）；
 *   传空数组表示不限制（保留旧行为，向后兼容）。
 *   命中时只清理白名单内的目标；未命中时整张表跳过。
 */
export declare function scanCleanRules(ruleIds: readonly string[], options?: {
    selectedSheets?: readonly {
        workbookKey: string;
        sheetName: string;
    }[];
}): Promise<CleanScanResult>;
/** 按目标聚合后的计划 */
interface AggregatedTargetPlan {
    target: CleanTargetInfo;
    /** 待删除行号 */
    removedRows: Set<number>;
    /** key = `${row}:${column}` */
    changes: Map<string, CellChange>;
}
/** 合并同一单元格的多次变更：按 ` | ` 拆分后保序去重（标签合并场景安全） */
export declare function mergeChangeValues(base: string, extra: string): string;
/** 把计划按目标聚合，并剔除「所在行将被删除」的变更 */
export declare function aggregatePlans(result: CleanScanResult): AggregatedTargetPlan[];
/**
 * 执行清理：先写单元格变更，再批量删行。
 * 单个目标失败不影响其他目标，失败原因通过 TargetRunResult.error 返回。
 */
export declare function runCleanPlans(result: CleanScanResult, onProgress?: CleanProgressCallback): Promise<CleanRunResult>;
/** 字节数格式化为可读文本（B / KB / MB / GB） */
export declare function formatBytes(bytes: number): string;
/** 目标摘要（页面「清理范围」区块展示，全部来自配置） */
export interface CleanScopeSummary {
    /** 工作簿路径包含规则（空 = 不限制） */
    includeWorkbookPath: string[];
    /** 工作簿路径排除规则 */
    excludeWorkbookPath: string[];
    /** 表名包含规则（空 = 自动识别） */
    includeSheetName: string[];
    /** 判定 Bangumi 数据表的特征列（命中任一即视为数据表） */
    identityColumns: string[];
    /** 排除表名关键词 */
    excludeSheetName: string[];
    /** 排除行文本关键词 */
    excludeRowText: string[];
    /** 单表最大扫描行数 */
    maxDataRows: number;
}
/** 读取当前生效的清理范围配置（页面只读展示，不硬编码） */
export declare function describeCleanScope(): CleanScopeSummary;
/** 当前可被清理的目标表数量 */
export declare function countCleanTargets(): number;
export {};
//# sourceMappingURL=clean-engine.d.ts.map