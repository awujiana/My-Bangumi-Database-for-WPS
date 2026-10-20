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
  year: number
  month: number
}

/** 季度起点月（番剧四季：1 月 / 4 月 / 7 月 / 10 月） */
export type SeasonMonth = 1 | 4 | 7 | 10

/**
 * air 月 → 所属季起点月（与数据页公式 `LOOKUP(m,{1..12},{1,1,4,4,4,7,7,7,10,10,10,1})` 一致）
 *
 * 12 → 1 是跨年项：12 月播的番剧归属**次年** 1 月季（冬季档）。
 */
const SEASON_TABLE: readonly (readonly [number, SeasonMonth])[] = [
  [1, 1],
  [2, 1],
  [3, 4],
  [4, 4],
  [5, 4],
  [6, 7],
  [7, 7],
  [8, 7],
  [9, 10],
  [10, 10],
  [11, 10],
  [12, 1],
]

/** Excel 日期序列值的纪元（1899-12-31 UTC；serial 1 = 1900-01-01，含 1900 闰年bug 的传统偏移） */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 31)

/** 序列值合法上界（serial 2958465 = 9999-12-31） */
const MAX_EXCEL_SERIAL = 2_958_465

/** 解析结果允许的年份范围（动画史料 1917 起，留足余量） */
const MIN_YEAR = 1850
const MAX_YEAR = 2100

/**
 * air 月 → 所属季起点月
 * @param month 1~12，越界返回 null
 */
export function seasonStartMonth(month: number): SeasonMonth | null {
  const entry = SEASON_TABLE.find(([m]) => m === month)
  return entry ? entry[1] : null
}

/**
 * 把「播出的年月」归一成「所属季的年月」
 *
 * 12 月播出的归属次年 1 月季（`25年12月` → `26年1月`，与数据页公式的
 * `y+IF(m=12,1,0)` / `IF(m=12,1,m)` 同口径）；其余月取所属季起点。
 *
 * @returns 归一后的年月；月份越界返回 null
 */
export function toSeason(ym: YearMonth): YearMonth | null {
  const seasonMonth = seasonStartMonth(ym.month)
  if (seasonMonth === null) return null
  return { year: ym.year + (ym.month === 12 ? 1 : 0), month: seasonMonth }
}

/**
 * 今天所在月 → 当前季目标
 *
 * 例：10 月 → `{2026, 10}`（覆盖 air 月 9/10/11 的行）；
 * 12 月 → `{次年, 1}`（覆盖 12 月播的行）。
 */
export function currentSeason(today: Date): YearMonth {
  const month = today.getMonth() + 1
  const seasonMonth = seasonStartMonth(month) ?? 1
  return { year: today.getFullYear() + (month === 12 ? 1 : 0), month: seasonMonth }
}

/**
 * Excel 日期序列值 → 年月
 *
 * 用 UTC 读取，避免本地时区把日期拨偏一天。
 */
export function excelSerialToYearMonth(serial: number): YearMonth | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > MAX_EXCEL_SERIAL) return null
  const date = new Date(EXCEL_EPOCH_UTC + Math.round(serial) * 86_400_000)
  const year = date.getUTCFullYear()
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  return { year, month: date.getUTCMonth() + 1 }
}

/** 中文日期：`2026年10月` / `2026年10月1日`（四位年） */
const CN_DATE_FULL_YEAR = /^(\d{4})\s*年\s*(\d{1,2})\s*月/
/** 中文日期：`25年4月`（两位年，+2000） */
const CN_DATE_SHORT_YEAR = /^(\d{1,2})\s*年\s*(\d{1,2})\s*月/
/** ISO 风格带日：`2026-10-01` / `2026/10/1` / `2026.10.1` */
const ISO_DATE_WITH_DAY = /^(\d{4})[-/.](\d{1,2})[-/.]\d{1,2}/
/** ISO 风格仅年月：`2026-10` / `2026/10` */
const ISO_DATE = /^(\d{4})[-/.](\d{1,2})/
/** 纯数字串：Excel 序列值被 String() 化后的形态（4~7 位） */
const SERIAL_STRING = /^\d{4,7}$/

/**
 * 解析单元格值为年月；无法解析返回 null（不猜）
 *
 * @param value 单元格文本（`readRangeValues` 一律 String() 化）或数字
 */
export function parseYearMonth(value: unknown): YearMonth | null {
  if (typeof value === 'number') return excelSerialToYearMonth(value)
  if (typeof value !== 'string') return null

  const text = value.trim()
  if (!text) return null

  const cnFull = CN_DATE_FULL_YEAR.exec(text)
  if (cnFull) return buildYearMonth(Number(cnFull[1]), Number(cnFull[2]))

  const cnShort = CN_DATE_SHORT_YEAR.exec(text)
  if (cnShort) return buildYearMonth(Number(cnShort[1]) + 2000, Number(cnShort[2]))

  const isoWithDay = ISO_DATE_WITH_DAY.exec(text)
  if (isoWithDay) return buildYearMonth(Number(isoWithDay[1]), Number(isoWithDay[2]))

  const iso = ISO_DATE.exec(text)
  if (iso) return buildYearMonth(Number(iso[1]), Number(iso[2]))

  if (SERIAL_STRING.test(text)) return excelSerialToYearMonth(Number(text))

  return null
}

/** 年月合法性校验：月 1~12、年在合理区间 */
function buildYearMonth(year: number, month: number): YearMonth | null {
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month)) return null
  if (month < 1 || month > 12) return null
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  return { year, month }
}

/**
 * 格式化为公式列同款季文本：`26年10月`（两位年，与数据页公式输出一致，用于直接比对）
 */
export function formatSeasonKey(ym: YearMonth): string {
  return `${String(ym.year % 100).padStart(2, '0')}年${String(ym.month)}月`
}

/** 格式化为完整季文本：`2026 年 10 月`（UI 展示用） */
export function formatSeasonLabel(ym: YearMonth): string {
  return `${String(ym.year)} 年 ${String(ym.month)} 月`
}

/** 待匹配的一行 */
export interface SeasonRow {
  /** 行号（1-based） */
  row: number
  /** 日期源列的单元格文本 */
  value: string
}

/** 匹配口径选项 */
export interface SeasonSelectOptions {
  /**
   * true = 原始日期列：先把 air 月归一到所属季再与目标比；
   * false = 公式列：值已归一，直接比（非日漫行的原始年月因此永远匹配不上季目标）。
   */
  mapAirMonthToSeason: boolean
}

/** 匹配结果 */
export interface SeasonSelectResult {
  /** 命中行号（升序） */
  matchedRows: number[]
  /** 空单元格数（预览里与「解析失败」分开展示） */
  emptyCount: number
  /** 非空但解析不出年月的数量（公式列的「一次放出」等） */
  invalidCount: number
}

/**
 * 从行列表里选出属于目标季的行
 *
 * 纯函数：行数据由调用方一次性矩形读获得（循环里不碰 COM）。
 */
export function selectSeasonRows(
  rows: readonly SeasonRow[],
  target: YearMonth,
  options: SeasonSelectOptions,
): SeasonSelectResult {
  const matchedRows: number[] = []
  let emptyCount = 0
  let invalidCount = 0

  for (const { row, value } of rows) {
    const isEmpty = value.trim() === ''
    const ym = isEmpty ? null : parseYearMonth(value)
    if (isEmpty) {
      emptyCount += 1
    } else if (ym === null) {
      invalidCount += 1
    } else {
      const season = options.mapAirMonthToSeason ? toSeason(ym) : ym
      if (season !== null && season.year === target.year && season.month === target.month) {
        matchedRows.push(row)
      }
    }
  }

  return { matchedRows, emptyCount, invalidCount }
}

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
export function rowsToRangeAddresses(rows: readonly number[], columnLetter: string): string[] {
  if (rows.length === 0) return []

  const sorted = [...rows].sort((a, b) => a - b)
  const first = sorted[0]
  if (first === undefined) return []

  const addresses: string[] = []
  const pushRun = (start: number, end: number): void => {
    addresses.push(
      start === end
        ? `${columnLetter}${String(start)}`
        : `${columnLetter}${String(start)}:${columnLetter}${String(end)}`,
    )
  }

  let runStart = first
  let runEnd = first
  for (const row of sorted.slice(1)) {
    if (row === runEnd + 1) {
      runEnd = row
    } else {
      pushRun(runStart, runEnd)
      runStart = row
      runEnd = row
    }
  }
  pushRun(runStart, runEnd)
  return addresses
}

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
export const DEFAULT_MAX_ADDRESS_CHARS = 8000

/**
 * 区域地址分块（按组返回，便于失败时对半拆分重试）
 *
 * greedy 装车：每块拼到接近 `maxChars` 为止，保证不把单个地址拆开。
 *
 * @param addresses 区域地址列表（如 `['H100:H105', 'H108']`）
 * @param maxChars 单块字符上限，默认 {@link DEFAULT_MAX_ADDRESS_CHARS}
 * @returns 分组后的地址数组，每组可直接 `join(',')` 成一条并集地址
 */
export function splitRangeAddresses(
  addresses: readonly string[],
  maxChars = DEFAULT_MAX_ADDRESS_CHARS,
): string[][] {
  const groups: string[][] = []
  let current: string[] = []
  let currentLength = 0
  for (const address of addresses) {
    const appendedLength =
      current.length === 0 ? address.length : currentLength + 1 + address.length
    if (current.length > 0 && appendedLength > maxChars) {
      groups.push(current)
      current = [address]
      currentLength = address.length
    } else {
      current.push(address)
      currentLength = appendedLength
    }
  }
  if (current.length > 0) groups.push(current)
  return groups
}

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
export function runRangeGroupsWithSplit(
  groups: readonly string[][],
  attempt: (group: readonly string[]) => void,
  onGroupFailed?: (group: readonly string[], error: unknown) => void,
): number {
  let succeeded = 0
  for (const group of groups) {
    succeeded += attemptRangeGroup(group, attempt, onGroupFailed)
  }
  return succeeded
}

/** 单组尝试；失败拆两半递归，单区域仍失败才交给 `onGroupFailed` */
function attemptRangeGroup(
  group: readonly string[],
  attempt: (group: readonly string[]) => void,
  onGroupFailed?: (group: readonly string[], error: unknown) => void,
): number {
  try {
    attempt(group)
    return 1
  } catch (error: unknown) {
    if (group.length <= 1) {
      onGroupFailed?.(group, error)
      return 0
    }
    const middle = Math.ceil(group.length / 2)
    return (
      attemptRangeGroup(group.slice(0, middle), attempt, onGroupFailed) +
      attemptRangeGroup(group.slice(middle), attempt, onGroupFailed)
    )
  }
}

/**
 * 区域地址分块：每个块拼成一条逗号连接的区域串
 *
 * 调用方对每个块做一次 `worksheet.Range(块)` 属性设置。需要「失败再拆」时用
 * {@link splitRangeAddresses} 拿数组，别把字符串再拆回去。
 */
export function chunkRangeAddresses(
  addresses: readonly string[],
  maxChars = DEFAULT_MAX_ADDRESS_CHARS,
): string[] {
  return splitRangeAddresses(addresses, maxChars).map((group) => group.join(','))
}
