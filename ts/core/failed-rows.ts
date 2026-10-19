/**
 * 上次同步的失败行号（内存态）。
 *
 * @module core/failed-rows
 * @description
 * 同步（全表 `SyncToBangumiAsync` / 选中行 `syncSelectedRows`）会把失败任务压成
 * 一个**计数**就丢掉，用户看到「❌ 失败: 3」却无从下手——只能整表重跑，
 * 把已经成功的几十行再发一遍请求。
 *
 * 这里把失败行号留一份，供「重试失败行」入口使用：选中这些行，再走已有的
 * 「选中行同步」，只重发失败的那几行。
 *
 * **只活在本次会话**：不落 PluginStorage。行号会随用户增删行而错位，隔天再
 * 按旧行号重试可能写到别的条目上，这比「没得重试」更糟。语义就是
 * 「重试刚才那一次」。
 *
 * 连所属工作表名一起记：失败行只对产生它们的那张表有意义，换表后选中就是
 * 拿 A 表的行号去选 B 表的行。
 */

export interface FailedRowsRecord {
  /** 失败行号（升序去重） */
  rows: number[]
  /** 产生这些失败行的工作表名（用于换表后拒绝选中） */
  sheetName: string
}

let lastFailed: FailedRowsRecord | null = null

/** 地址串上限：Excel 的 Range 地址有长度限制，超了会直接抛错 */
const MAX_ADDRESS_LENGTH = 240

/**
 * 记录一次同步的失败行。
 * @param rows 失败行号（允许乱序 / 重复 / 含非法值，内部会清洗）
 * @param sheetName 所属工作表名
 */
export function setLastFailedRows(rows: readonly number[], sheetName: string): void {
  const cleaned = [...new Set(rows)]
    .filter((row) => Number.isFinite(row) && row > 0)
    .sort((a, b) => a - b)
  lastFailed = cleaned.length > 0 ? { rows: cleaned, sheetName } : null
}

/** 取上次失败记录（防御性拷贝，避免调用方改到内部状态） */
export function getLastFailedRows(): FailedRowsRecord | null {
  return lastFailed === null ? null : { rows: [...lastFailed.rows], sheetName: lastFailed.sheetName }
}

/** 清空（用户换表 / 重新全量同步时调用） */
export function clearLastFailedRows(): void {
  lastFailed = null
}

/**
 * 把行号拼成 Excel 可识别的多区域地址（如 `A3,A7:A9,A12`）。
 *
 * 连续行合并成块，避免 200 行失败时地址串爆掉长度上限。
 * 只选 A 列：`syncSelectedRows` 读的是 `sel.Row` / `sel.Rows.Count` /
 * `sel.Areas`，一列足以定位行，且比整行选区在各种宿主上都稳。
 *
 * @param rows 升序行号
 * @returns 地址串；行号过多导致超长时返回 `null`（调用方应提示用户）
 */
export function buildFailedRowsAddress(rows: readonly number[]): string | null {
  const sorted = [...new Set(rows)].filter((row) => Number.isFinite(row) && row > 0).sort((a, b) => a - b)
  const first = sorted[0]
  if (first === undefined) return null

  const parts: string[] = []
  let start = first
  let previous = first
  // 用 for…of 迭代（索引访问会被 noUncheckedIndexedAccess 判为可能 undefined，
  // 多一层 continue 既不必要也不合 lint 规则）
  for (const row of sorted.slice(1)) {
    if (row === previous + 1) {
      previous = row
    } else {
      parts.push(start === previous ? `A${String(start)}` : `A${String(start)}:A${String(previous)}`)
      start = row
      previous = row
    }
  }
  parts.push(start === previous ? `A${String(start)}` : `A${String(start)}:A${String(previous)}`)

  const address = parts.join(',')
  return address.length > MAX_ADDRESS_LENGTH ? null : address
}
