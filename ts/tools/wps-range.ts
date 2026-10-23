/**
 * @fileoverview 宿主 Range 的地址读取（多手段统一入口）
 * @module tools/wpsRange
 *
 * 独立成文件而非并入 wps.ts：wps.ts 被多个测试整体 mock（原子替换，
 * 见 exceltobangumi.selection.test.ts），地址读取是调用方热路径上的**真实
 * 行为**（读空要降级成「（未读到范围）」/「（无法获取）」），不能因为被
 * mock 掉而静默失灵。
 */

import type { WpsRange } from './wps.js'

/**
 * 读「可能是属性也可能是函数」的宿主值：string 直接用，函数无参调用取串。
 *
 * WPS 的 Address / AddressLocal 都有这两副面孔（COM 风格属性在 JS 侧
 * 有时包装成方法），故统一走这里。
 */
function readStringish(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'function') {
    const called = (raw as () => unknown)()
    if (typeof called === 'string') return called
  }
  return ''
}

/** 列号（1 基）转列字母：1→A、27→AA（行列拼装兜底用） */
function columnName(column: number): string {
  let name = ''
  let index = column
  while (index > 0) {
    const remainder = (index - 1) % 26
    name = String.fromCodePoint(65 + remainder) + name
    index = Math.floor((index - 1) / 26)
  }
  return name
}

/** 安全探测一个宿主值（读取可能抛错），返回形态描述（诊断日志用） */
function probe(get: () => unknown): string {
  try {
    const value = get()
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'string') return `string:"${value.slice(0, 40)}"`
    return typeof value
  } catch {
    return '<读取抛错>'
  }
}

/**
 * 从宿主 Range 上读地址，依次尝试三条路，取第一个非空：
 * 1. `Address`——字符串属性，或函数形式无参调用；
 * 2. `AddressLocal`——本地化地址，部分版本只有它可读；
 * 3. 行列拼装——Row/Column + Rows.Count/Columns.Count 合成 "A1:C38"
 *    （整列区域会拼成 "A1:A1048576"，值仍可用）。
 *
 * ## 背景（momo 实测：38 条条件格式规则全「（未读到范围）」）
 * AppliesTo 确是 Range 对象（keys 里有 Address/AddressLocal/Formula 等），
 * 但该版本 Address 属性读数非串、函数调用也拿不到串。故补后两条路。
 *
 * 全失败返回空串：调用方多在遍历规则的循环里，单条失败不该中断整批，
 * 也不该把 undefined 带到渲染层。
 */
export function readRangeAddress(range: WpsRange | undefined): string {
  if (range === undefined) return ''
  try {
    const fromAddress = readStringish(range.Address)
    if (fromAddress !== '') return fromAddress

    const fromLocal = readStringish(range.AddressLocal)
    if (fromLocal !== '') return fromLocal

    const row = range.Row
    const column = range.Column
    const rowCount = range.Rows.Count
    const columnCount = range.Columns.Count
    if (Number.isFinite(row) && Number.isFinite(column) && rowCount > 0 && columnCount > 0) {
      const start = `${columnName(column)}${String(row)}`
      const end = `${columnName(column + columnCount - 1)}${String(row + rowCount - 1)}`
      return start === end ? start : `${start}:${end}`
    }
  } catch {
    // 任一手段抛错都落到空串，由调用方兜底
  }
  return ''
}

/**
 * 诊断：把 Range 各读数路径的形态打成一串（只用于第 1 条失败的 WARN 日志）。
 *
 * 每个探测独立 try：宿主代理对某些属性的读取会直接抛错，一处炸掉不该
 * 丢掉后面几项的形态信息——那是判断「宿主到底给了什么」的唯一依据。
 */
export function describeRangeForDiagnosis(range: WpsRange): string {
  return [
    `Address=${probe(() => range.Address)}`,
    `AddressLocal=${probe(() => range.AddressLocal)}`,
    `Areas=${probe(() => range.Areas)}`,
    `Row=${probe(() => range.Row)}`,
    `Column=${probe(() => range.Column)}`,
    `RowsCount=${probe(() => range.Rows.Count)}`,
    `ColumnsCount=${probe(() => range.Columns.Count)}`,
  ].join(' ')
}
