/**
 * @fileoverview 同步前列映射确认：本地列 ↔ 远程字段的对应关系
 * @module sync/syncMapping
 * @description 2026-10-17 新增。同步开始前，用户先在确认框里看到「远程字段 → 本地列」
 *              的对应关系，并可：① 取消勾选（该字段本次不同步）；② 拖拽排序（仅影响
 *              清单展示顺序，写入按列名寻址、与顺序无关）；③ 改目标列（换到本地另一列）；
 *              ④ 一键补齐缺失列（把缺的列名写进表头行末尾）。
 *
 *              本模块只放**纯逻辑**（无 DOM / 无 COM）：行构建、状态判定、选择解析、
 *              列名改写应用。DOM 与写表头在 `ui/sync-mapping-dialog.ts`。
 *
 *              字段行由 `github-sync-diff.ts` 的 EXTENDED_FIELD_MAP 与
 *              CORE_FIELD_COLUMNS **派生**，不复制第二份字段表（规避平行清单）。
 *              另有若干远程字段（简介原文 / infobox / 用户标签等）**无 Excel 列映射**，
 *              见 {@link UNMAPPED_REMOTE_FIELDS}，它们随分片下载但不写入任何列，
 *              因此不进交互清单，只在确认框里以脚注告知。
 */
import type { LocalRowEntry } from './github-sync-diff.js';
/** 清单分组（仅影响展示顺序与分组标题） */
export type SyncMappingGroup = 'basic' | 'meta' | 'stats' | 'relations' | 'alias';
/** 分组中文标签（确认框分组标题用） */
export declare const SYNC_MAPPING_GROUP_LABELS: Readonly<Record<SyncMappingGroup, string>>;
/**
 * 无 Excel 列映射的远程字段（随分片下载但不落盘）
 *
 * 列在确认框脚注里，避免用户误以为勾了分片这些字段就会进表。
 * `field` 为远程字段键，`note` 为给用户的一句话说明。
 */
export declare const UNMAPPED_REMOTE_FIELDS: readonly (readonly [string, string])[];
/** 单行映射（一行 = 一个可同步的远程字段） */
export interface SyncMappingRow {
    /** 行 id = 默认 Excel 列名（派生字段用字段名，如 Bangumi_URL） */
    id: string;
    /** 远程字段键（jsonl 字段名；Bangumi_URL 为由 subjectId 构造的派生字段） */
    remoteField: string;
    /** 展示分组 */
    group: SyncMappingGroup;
    /** 默认目标列（本地列名） */
    defaultColumn: string;
    /** 同写的别名列（如「动画制作公司」会同时写「制作公司」与「动画制作公司」） */
    aliasColumns: readonly string[];
    /** 本地是否已有默认列（false = 需补列或改映射，否则本次跳过） */
    hasLocalColumn: boolean;
    /** 是否勾选同步（默认：有列 true / 缺列 false） */
    selected: boolean;
    /** 用户指定的目标列（默认 = defaultColumn；改映射时换成本地已有列） */
    targetColumn: string;
}
/** 用户在确认框里的最终选择（回传给同步主流程） */
export interface SyncMappingConfig {
    /** 取消同步的列（行 id） */
    excludedColumns: readonly string[];
    /** 列名改写：默认列名 → 用户选定的目标列名 */
    columnOverrides: Readonly<Record<string, string>>;
}
/**
 * 构建列映射行（同步前确认框的数据源）
 *
 * @param localColumns 本地表头列名集合（columnMap 的键）
 * @returns 按分组固定顺序排列的映射行；UI 状态取默认值（有列选中 / 缺列不选）
 */
export declare function buildSyncMappingRows(localColumns: readonly string[]): SyncMappingRow[];
/**
 * 解析用户在确认框里的最终选择
 *
 * 规则：
 * - 未勾选的行 → excludedColumns
 * - targetColumn ≠ defaultColumn（且非空）→ columnOverrides（含「改映射到已有列」）
 * - 勾选但本地缺列的行**不产生配置**——补列由对话框在确认前落盘，届时列已存在
 *
 * @param rows 确认框维护的行状态
 */
export declare function resolveSyncMappingConfig(rows: readonly SyncMappingRow[]): SyncMappingConfig;
/**
 * 校验目标列冲突：同一目标列不能同时接收两个字段
 *
 * 冲突来源：① 两个字段的 override 指向同一列；② override 指向另一个字段的默认列；
 * ③ 字段的默认列恰是另一字段的 override 目标。返回有冲突的行 id 列表（空数组 = 无冲突）。
 */
export declare function findOverrideConflicts(rows: readonly SyncMappingRow[]): string[];
/**
 * 把列名改写应用到本地条目：为每个 override 生成「默认列名」键
 *
 * 原理：computeDiff / writeRemoteEntryToRow / collectMissingColumns 全链路按
 * **默认列名**寻址。把 override 列的值复制一份到默认列名键下，这三个消费方
 * 就无需任何改动（core 侧另把 columnMap 的默认列名指向 override 列的列号）。
 *
 * @param entries 本地条目映射（SID → 行），**原地修改**
 * @param overrides 默认列名 → 目标列名
 */
export declare function applyColumnOverrides(entries: Map<string, LocalRowEntry>, overrides: Readonly<Record<string, string>>): void;
/**
 * 排除列的别名闭包：排除主列时，其别名列一并排除
 *
 * 「动画制作公司」字段双列写入（制作公司 + 动画制作公司）：只排除主列会让
 * 别名列照常写入，排除不彻底。这里按 EXTENDED_FIELD_MAP 反查展开。
 */
export declare function excludedColumnClosure(excludedColumns: readonly string[]): Set<string>;
/**
 * 剔除列：返回不含排除列的新 Map（原 Map 不动）
 *
 * 排除的落地方式就是「从 columnMap 摘列」——下游所有写入点（批量写 / 逐字段写 /
 * 回退）都经 columnMap 寻址，列不在映射里即自然跳过，无需逐函数加参。
 */
export declare function withoutColumns(columnMap: Map<string, number>, excluded: ReadonlySet<string>): Map<string, number>;
/**
 * 列名改写：把 columnMap 里默认列的列号替换为目标列的列号
 *
 * 与 {@link applyColumnOverrides} 成对使用：一个改本地数据侧（字段键），
 * 一个改写入侧（列号），computeDiff / 写入口都按默认列名寻址即可命中用户选的列。
 */
export declare function remapColumnIndices(columnMap: Map<string, number>, remap: ReadonlyMap<string, number>): Map<string, number>;
/**
 * 取消同步的列 → 需要从「下载字段集」里剔除的远程字段键
 *
 * neededFields 驱动选片：剔除后整片无所需字段时该分片不再下载
 * （用户手动勾选的分片除外——那种情况下仍会下载，只是不写入）。
 * Bangumi_URL 由 subjectId 派生（subjectId 恒随 base 片下载），不产生剔除项。
 */
export declare function excludedJsonlFields(excludedColumns: readonly string[]): Set<string>;
//# sourceMappingURL=sync-mapping.d.ts.map