/**
 * @fileoverview 番剧高亮季度引擎（纯函数，零 WPS / DOM 依赖，可在 Node 下单测）
 * @module panel/highlightSeason
 * @description 「按季度起点高亮最新番剧」的匹配逻辑，自 WPS 宏「高亮最新日期」移植并修正。
 *
 * 与宏的三处关键差异（宏的「取距离今天最近的季度起点」算法是错的）：
 * 1. **季度归属表**改用数据页公式同款 LOOKUP：air 月 → 所属季为
 *    `{1,2→1月季; 3,4,5→4月季; 6,7,8→7月季; 9,10,11→10月季; 12→次年1月季}`。
 *    宏按 `|当前月 - 季度起点|` 取最小，12 月会错算成 10 月季（且无跨年处理）。
 * 2. **日期解析兼容三种形态**：中文文本（`25年4月` / `2026年10月1日`）、
 *    ISO（`2026-10-01`）、Excel 日期序列值（`readRangeValues` 会 `String()` 化成
 *    `"46023"` 这样的纯数字串，真实日期单元格走这条）。
 * 3. **解析失败一律跳过不猜**：公式列产出的「一次放出」「日期格式错误」等
 *    非日期文本天然落空，由调用方计入 invalidCount 展示，不参与匹配。
 *
 * 两种匹配口径（由调用方按数据源选择，见 {@link SeasonSelectOptions}）：
 * - 原始日期列（开播日期/完播日）：先把 air 月归一到所属季再比
 *   （3 月播的算 4 月季，12 月播的算次年 1 月季）；
 * - 公式列（开播季度）：值已被公式归一过（且只对日漫归一），直接与目标比，
 *   非日漫行的原始年月（如 `25年12月`）永远匹配不上任何季目标——与公式的设计意图一致。
 */
/** 年月 */
export interface YearMonth {
    year: number;
    month: number;
}
/** 季度起点月（番剧四季：1 月 / 4 月 / 7 月 / 10 月） */
export type SeasonMonth = 1 | 4 | 7 | 10;
/**
 * air 月 → 所属季起点月
 * @param month 1~12，越界返回 null
 */
export declare function seasonStartMonth(month: number): SeasonMonth | null;
/**
 * 把「播出的年月」归一成「所属季的年月」
 *
 * 12 月播出的归属次年 1 月季（`25年12月` → `26年1月`，与数据页公式的
 * `y+IF(m=12,1,0)` / `IF(m=12,1,m)` 同口径）；其余月取所属季起点。
 *
 * @returns 归一后的年月；月份越界返回 null
 */
export declare function toSeason(ym: YearMonth): YearMonth | null;
/**
 * 今天所在月 → 当前季目标
 *
 * 例：10 月 → `{2026, 10}`（覆盖 air 月 9/10/11 的行）；
 * 12 月 → `{次年, 1}`（覆盖 12 月播的行）。
 */
export declare function currentSeason(today: Date): YearMonth;
/**
 * Excel 日期序列值 → 年月
 *
 * 用 UTC 读取，避免本地时区把日期拨偏一天。
 */
export declare function excelSerialToYearMonth(serial: number): YearMonth | null;
/**
 * 解析单元格值为年月；无法解析返回 null（不猜）
 *
 * @param value 单元格文本（`readRangeValues` 一律 String() 化）或数字
 */
export declare function parseYearMonth(value: unknown): YearMonth | null;
/**
 * 格式化为公式列同款季文本：`26年10月`（两位年，与数据页公式输出一致，用于直接比对）
 */
export declare function formatSeasonKey(ym: YearMonth): string;
/** 格式化为完整季文本：`2026 年 10 月`（UI 展示用） */
export declare function formatSeasonLabel(ym: YearMonth): string;
/** 待匹配的一行 */
export interface SeasonRow {
    /** 行号（1-based） */
    row: number;
    /** 日期源列的单元格文本 */
    value: string;
}
/**
 * 筛选范围（与 {@link SyncTimeFilter.range} 同款五模式）
 *
 * - `all`：不过滤
 * - `year`：年度（如 2026 年度新番）
 * - `quarter`：季度（如 2026 年 10 月新番）
 * - `month`：精确到月（如 2025 年 1 月）
 * - `future`：预告 / 未来番（无开播日期）
 */
export type SeasonFilterRange = 'all' | 'year' | 'quarter' | 'month' | 'future';
/**
 * 高亮页的筛选条件
 *
 * **口径与 `ts/sync/github-sync-diff.ts` 的 {@link SyncTimeFilter} 保持一致**
 * （momo：和从 GitHub 仓库同步的筛选一样）：四季月份划分同为
 * 1 月季 = 12/1/2 月、4 月季 = 3/4/5、7 月季 = 6/7/8、10 月季 = 9/10/11，
 * 12 月播出的归属次年 1 月季。两边各有一份实现（本页吃本地行、同步吃远程条目），
 * 由 `tests/season-filter-parity.test.ts` 锁口径一致。
 *
 * 与同步筛选的唯一差异：`year` 模式按**季归属年**算（25 年 12 月播的算
 * 26 年 1 月季 → 属于 2026 年度新番），同步侧按自然年算——本页整体是「季」
 * 语义，年度 = 这一年有哪些季，更符合「年度新番」的说法。
 */
export interface SeasonFilter {
    /** 是否启用筛选（关闭时 matchesSeasonFilter 恒 true） */
    enabled: boolean;
    /** 目标年份 */
    year: number;
    /** 筛选范围 */
    range: SeasonFilterRange;
    /** 季度起点月（仅 range='quarter' 有效） */
    quarter?: SeasonMonth;
    /** 月份（仅 range='month' 有效） */
    month?: number;
}
/**
 * 判断一行的日期源是否命中筛选条件
 *
 * 纯函数：`value` 为 null 表示该行没有日期源（公式列 + 未提供原始日期时），
 * 仅 `future` 模式会命中它。
 */
export declare function isSeasonFilterMatch(value: string | null, filter: SeasonFilter): boolean;
/** 匹配口径选项 */
export interface SeasonSelectOptions {
    /**
     * true = 原始日期列：先把 air 月归一到所属季再与目标比；
     * false = 公式列：值已归一，直接比（非日漫行的原始年月因此永远匹配不上季目标）。
     */
    mapAirMonthToSeason: boolean;
}
/** 匹配结果 */
export interface SeasonSelectResult {
    /** 命中行号（升序） */
    matchedRows: number[];
    /** 空单元格数（预览里与「解析失败」分开展示） */
    emptyCount: number;
    /** 非空但解析不出年月的数量（公式列的「一次放出」等） */
    invalidCount: number;
}
/**
 * 从行列表里选出属于目标季的行
 *
 * 纯函数：行数据由调用方一次性矩形读获得（循环里不碰 COM）。
 */
export declare function selectSeasonRows(rows: readonly SeasonRow[], target: YearMonth, options: SeasonSelectOptions): SeasonSelectResult;
/**
 * 连续行合并：行号列表 → 最少的区域地址
 *
 * 宏的做法是逐行拼地址（`H123,H124,…`），匹配行一多就会踩到地址串上限而静默失败
 * （宏里错误出口是 `提示()` → `Console.log`，用户看不到）。合并连续行后，
 * 按日期排序的数据一季通常只剩一两个区域（`H100:H105`），一次调用搞定。
 *
 * @param rows 行号列表（无需有序，内部会排序）
 * @param columnLetter 列字母（大写）
 * @returns 区域地址数组，如 `['H100:H105', 'H108']`
 */
export declare function rowsToRangeAddresses(rows: readonly number[], columnLetter: string): string[];
/**
 * 地址串单次可接受的长度上限（字符）
 *
 * 2026-10-20 真机探针两次实测（都在 WPS JS 宏里，同一台机器）：
 * - **字符数**：`Application.ActiveSheet.Range(地址)` 能接受约 **524287** 字符
 *   （二分收敛值，2^19 边界）。VBA 经典的 255 是 Excel 95~2003 的遗留说法，套到
 *   WPS JS 上会把 COM 调用次数白放大三个数量级——这就是 200 这个旧默认的来历。
 * - **区域个数（Area 数）**：约 **8188**（≈ Excel 的 8192 上限）。
 *
 * 取 8000 而不是贴着任一上限，依据是**两条上限哪个先撞**：
 * 单格地址最短是 `A1`（2 字符）+ 逗号 = 3 字符/区域，8000 / 3 ≈ **2666 个区域**，
 * 比 8188 低 3 倍——也就是说**字符上限严格更紧，区域上限永远撞不到**。
 * 真机场景（一季 400 行 × 5 列 = 2000 个散点区域 ≈ 14KB）也就 2 组，再往上调没有收益。
 * 真有超大并集被拒，调用方还有对半拆分重试兜底（见 {@link runRangeGroupsWithSplit}）。
 */
export declare const DEFAULT_MAX_ADDRESS_CHARS = 8000;
/**
 * 区域地址分块（按组返回，便于失败时对半拆分重试）
 *
 * greedy 装车：每块拼到接近 `maxChars` 为止，保证不把单个地址拆开。
 *
 * @param addresses 区域地址列表（如 `['H100:H105', 'H108']`）
 * @param maxChars 单块字符上限，默认 {@link DEFAULT_MAX_ADDRESS_CHARS}
 * @returns 分组后的地址数组，每组可直接 `join(',')` 成一条并集地址
 */
export declare function splitRangeAddresses(addresses: readonly string[], maxChars?: number): string[][];
/**
 * 逐组执行写入，单组失败时对半拆分重试（组 → 两个子组 → … → 单区域）。
 *
 * 为什么抽成纯函数：真正的 COM 写入通过 `attempt` 注入，测试里用一个「区域数超过 N 就抛错」
 * 的假实现就能走完拆分路径，不必造 WPS 宿主——这是本项目唯一能验证该分支的办法。
 *
 * 为什么不直接猜一个「安全长度」：探针只证明了**字符数**能到 50 万级（2026-10-20 实测
 * 524287），「区域个数」上限（并集里能放多少个 Area）没测过，各版本 WPS 对超大并集的
 * 处理也不一致。与其赌，不如失败就拆：最坏退化成逐区域调用，也比宏那种「整批静默不上色」强。
 *
 * @param groups 地址分组（{@link splitRangeAddresses} 的产物）
 * @param attempt 对单组执行写入；抛错表示该组被宿主拒绝
 * @param onGroupFailed 拆到单区域仍失败时的回调（调用方用来记日志，不传则静默）
 * @returns 成功的组数（拆分后的子组各计 1；0 表示全部失败）
 */
export declare function runRangeGroupsWithSplit(groups: readonly string[][], attempt: (group: readonly string[]) => void, onGroupFailed?: (group: readonly string[], error: unknown) => void): number;
/**
 * 区域地址分块：每个块拼成一条逗号连接的区域串
 *
 * 调用方对每个块做一次 `worksheet.Range(块)` 属性设置。需要「失败再拆」时用
 * {@link splitRangeAddresses} 拿数组，别把字符串再拆回去。
 */
export declare function chunkRangeAddresses(addresses: readonly string[], maxChars?: number): string[];
//# sourceMappingURL=highlight-season.d.ts.map