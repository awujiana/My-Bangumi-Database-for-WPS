/**
 * @fileoverview `ts/panel/enrich-page-context.js` 的 state 单例重锚工具。
 *
 * `state` 是**模块级单例**：某个用例残留的 `columnMapping` / `pendingConflicts` /
 * `headerRow` 会让下一条用例的早退断言静默失效（断言「元素缺失 → 早退」的用例
 * 可能因为上一条把 state 填满而走了另一条分支）。所以每条用例前都要重锚。
 *
 * ## 默认值不手抄
 *
 * 本模块在**首次求值时**对 state 拍一张深拷贝快照 —— 那一刻 state 还是生产默认值。
 * 重锚时把快照写回，因此生产改了默认字段，这里自动跟随，不会漂移。
 *
 * @module tests/helpers/enrich-context
 */

import { state } from '../../ts/panel/enrich-page-context.js'
import type { EnrichPageState } from '../../ts/panel/enrich-page-context.js'

/** 生产默认值快照（helper 首次求值时拍摄） */
const INITIAL_STATE: EnrichPageState = structuredClone(state)

/**
 * 把 enrich 页状态重锚回生产默认值，并叠加本用例需要的字段。
 *
 * @param overrides 本用例要预置的字段（如 `{ pendingConflicts: [conflict] }`）
 */
export function resetEnrichState(overrides: Partial<EnrichPageState> = {}): void {
  Object.assign(state, structuredClone(INITIAL_STATE), overrides)
}
