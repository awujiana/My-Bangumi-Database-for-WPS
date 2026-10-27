import type { WpsCellValue, WpsWorksheet } from '../wps.js';
/**
 * 批量读取工作表中指定范围的值（一律 `String()` 化），返回二维数组 [行][列]。
 *
 * 读取失败返回空数组——调用方**必须**据此放弃写入，绝不能拿空数组覆盖整行。
 */
export declare function readRangeValues(worksheet: WpsWorksheet | null | undefined, startRow: number, endRow: number, startColumn: number, endColumn: number): string[][];
/**
 * 工作表单元格会话缓存（**写穿透**）。
 *
 * 面向「同一单元格在一次任务里被多次读、且读之间夹着写」的 COM 热点：
 * 典型如富化链——`enrichIntroData` 写「特点」列后 `enrichOpEdPv` 会再读同一格。
 * 只读缓存在这里会拿到**写前旧值**导致合并出错，因此写必须同步更新缓存。
 */
export interface SheetCellCache {
    /**
     * 读单元格：命中缓存直接返回（写后读拿到的是新值）；
     * 未命中回落 `getCellValue` 并回填缓存。
     */
    read(row: number, column: number): string;
    /**
     * 写单元格：**先写 COM**，成功后才更新缓存。
     * 写抛错时不更新缓存——缓存保持与工作表一致（旧值仍是表里的真实值）。
     */
    write(row: number, column: number, value: string): void;
}
/**
 * 缓存的后备单元格 IO。
 *
 * 默认用真实 COM 封装；**可注入**是为了让调用方把自身依赖路径上的读写函数
 * 传进来（典型：调用方从 barrel 导入、测试对 barrel 做 mock）——
 * 本模块内部的 cell.js 导入是测试 mock 不到的，直接用会让测试里的读写
 * 打到无宿主的真实封装上（写变 no-op）。
 */
export interface SheetCellIo {
    read(worksheet: WpsWorksheet, row: number, column: number): string;
    write(worksheet: WpsWorksheet, row: number, column: number, value: string): void;
}
/**
 * 建一个写穿透单元格缓存：先用 `readRowsCache` 做一次矩形读播种
 * （O(行×列) 次跨进程往返 → 1 次），之后读命中缓存、写穿透更新。
 *
 * 适用条件与 `readRowsCache` 相同：任务期间这些行不发生插入/删除位移。
 * 播种失败（跨度过大 / 宿主返回形状不符）时不播种——读写全部回落逐格路径，
 * 行为与不建缓存一致（只是没有加速）。
 *
 * @param worksheet 工作表
 * @param rows 预计会访问的行号（可离散；循环中动态新增的行不在此列也能用——
 *   未播种的行首次读回落 `getCellValue` 并回填）
 * @param maxColumn 预计会访问的最大列号（超出列的访问同样回落逐格读）
 * @param io 后备单元格 IO（默认真实 COM 封装；见 {@link SheetCellIo}）
 */
export declare function createSheetCellCache(worksheet: WpsWorksheet, rows: readonly number[], maxColumn: number, io?: SheetCellIo): SheetCellCache;
/**
 * 为「一批离散行号」做一次矩形读，返回 行号 → 该行 1..maxColumn 的文本。
 *
 * 面向「循环里对每个条目逐格读 N 列」的 COM 热点：把 O(条目数 × 列数) 次跨进程往返
 * 压成 1 次。典型用法是循环外先建缓存、循环内命中即用、未命中回退逐格读。
 *
 * ⚠️ 传入的行号必须是**尚未发生插入/删除**的原始行号；一旦期间发生行位移，缓存即失效。
 *
 * 形状守卫沿用本项目不变式：行数/列宽对不上就返回 `null`，调用方回退逐格读，绝不猜形状。
 *
 * @param worksheet 工作表
 * @param rows 需要的行号（可离散、可无序、允许重复）
 * @param maxColumn 需要的最大列号（读取范围恒为 1..maxColumn）
 * @returns 行号 → 该行文本数组；`null` 表示批量读不可用，调用方须回退逐格读
 */
export declare function readRowsCache(worksheet: WpsWorksheet | null | undefined, rows: readonly number[], maxColumn: number): Map<number, readonly string[]> | null;
/**
 * 批量读取工作表中指定范围的值，**保留单元格原始类型**，返回 `WpsCellValue` 二维数组 [行][列]。
 * 与 `readRangeValues`（一律 `String()` 化）不同，本函数用于「读-改-写整行」场景：
 * 读回的 number/Date 不会被强转成字符串，从而避免整行写回时把数字列变成文本列。
 * 如果读取失败则返回空数组，调用方**必须**据此放弃写入（绝不能拿空数组覆盖整行，否则会清空用户数据）。
 * @param worksheet 工作表对象
 * @param startRow 起始行
 * @param endRow 结束行
 * @param startColumn 起始列
 * @param endColumn 结束列
 * @returns `WpsCellValue` 二维数组（失败时为空数组）
 */
export declare function readRangeCellValues(worksheet: WpsWorksheet | null | undefined, startRow: number, endRow: number, startColumn: number, endColumn: number): WpsCellValue[][];
/**
 * 获取或设置缓存
 * @param key 缓存键
 * @param factory 当缓存不存在时执行的工厂函数
 * @returns 缓存的值
 */
export declare function cacheGet<T>(key: string, factory: () => T): T;
export declare function findHeaderRow(worksheet: WpsWorksheet | null | undefined, startRow?: number): number;
/**
 * 获取列名到列号的映射（优化版：正则规则数组 + 缓存）
 * @param worksheet 工作表对象
 * @param headerRow 表头行号
 * @returns Map<string, number> 列名 -> 列号
 */
export declare function getColumnMap(worksheet: WpsWorksheet | null | undefined, headerRow: number): Map<string, number>;
/** 清除指定工作表的所有缓存 */
export declare function clearSheetCache(worksheet: WpsWorksheet | null | undefined): void;
/**
 * 获取工作表的最后有效数据行
 * @param worksheet            工作表对象（WpsWorksheet）
 * @param shouldForceRefresh  是否强制刷新（跳过缓存）
 * @param headerRow     可选：表头行号。若提供，则自动检测“序号/ID”列并用该列定位最后行；
 *                      若未找到或未提供，回退到原有逻辑（D列 → A列 → UsedRange）。
 * @returns 最后数据行号（1‑based），至少返回 1
 */
export declare function getLastRow(worksheet: WpsWorksheet | null | undefined, shouldForceRefresh?: boolean, headerRow?: number): number;
export declare function isEmptyValue(value: unknown): boolean;
export declare function getDataSheet(): WpsWorksheet | null | undefined;
export declare function safeActivate(worksheet: WpsWorksheet | null | undefined): void;
/**
 * 检查工作表是否为空（无表头行），若是则写入标准表头
 *
 * 判定逻辑：findHeaderRow() 返回 0（前 10 行未匹配到 ≥3 个关键字），
 * **且第 1 行无任何内容**（后者用于区分「真空表」与「有数据但表头不规范」）。
 * 写入位置：第 1 行，按 STANDARD_HEADERS 顺序逐列写入。
 * 写入后清除缓存，确保后续 getColumnMap / findHeaderRow 能读到新表头。
 *
 * @param worksheet 工作表对象
 * @returns true 表示已填充表头（原为空表），false 表示已有表头 / 拒绝填充
 */
export declare function ensureSheetHeaders(worksheet: WpsWorksheet | null | undefined): boolean;
//# sourceMappingURL=sheet.d.ts.map