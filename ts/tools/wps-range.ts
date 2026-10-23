/**
 * @fileoverview 宿主 Range 的地址读取（属性 / 函数两副面孔的统一入口）
 * @module tools/wpsRange
 *
 * 独立成文件而非并入 wps.ts：wps.ts 被多个测试整体 mock（原子替换，
 * 见 exceltobangumi.selection.test.ts），地址读取是调用方热路径上的**真实
 * 行为**（读空要降级成「（未读到范围）」/「（无法获取）」），不能因为被
 * mock 掉而静默失灵。
 */

import type { WpsRange } from './wps.js'

/**
 * 从宿主 Range 上读地址：字符串属性优先，函数形式兜底。
 *
 * ## 为什么要两副面孔都试（momo 实测：38 条条件格式规则全「（未读到范围）」）
 * WPS 各版本下 `Address` 形态不一：有的直接读属性就是地址串
 * （"A1:B10" / "$B$3:$B$26958"），有的 `Address` 是 COM 风格的方法——
 * **属性读数恒为函数对象**（typeof 是 function 而非 string），必须调用才返回
 * 地址。条件格式读 `FormatCondition.AppliesTo.Address` 与同步页读
 * `Selection.Address` 都踩到过后者。
 *
 * 读空或宿主抛错一律返回空串：调用方多在遍历规则的循环里，单条地址读失败
 * 不该中断整批，也不该把 undefined 带到渲染层。
 */
export function readRangeAddress(range: WpsRange | undefined): string {
  if (range === undefined) return ''
  try {
    const raw = range.Address
    if (typeof raw === 'string') return raw
    // 函数形式：COM 风格的 Address() 调用；无参即默认 A1 相对引用
    if (typeof raw === 'function') {
      const called = raw()
      if (typeof called === 'string') return called
    }
  } catch {
    // 联合选区等形态下宿主可能直接抛错，交由调用方兜底
  }
  return ''
}
