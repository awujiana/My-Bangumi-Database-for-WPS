/**
 * @fileoverview `ts/tools/util/index.js`（tools barrel）的**共享替身**。
 *
 * 抽这里的理由：enrich 子流程 / 面板流程 / 启动脚本三类被测模块全都从同一个
 * tools barrel 取 `bgmLog` / `BGM` / `getApp` / `getCellValue` …。内联到每个
 * 测试文件里意味着同一份 spy 集合抄 N 遍，且每处都得自己记得「重置实现」。
 *
 * ## 用法
 *
 * ```ts
 * vi.mock('../ts/tools/util/index.js', async () => {
 *   const helpers = await import('./helpers/utility-mock.js')
 *   return helpers.utilityMock
 * })
 * import { utilityMock, resetUtilityMock } from './helpers/utility-mock.js'
 * ```
 *
 * mock 工厂与测试文件静态 import 解析到**同一模块实例**，因此断言的 spy 就是
 * 被 mock 进去的那批。工厂必须 async：`vi.mock` 的注册先于本文件顶层求值
 * （改用顶层 `const` 引用会踩 TDZ）。
 *
 * ## 为什么 `resetUtilityMock` 用 `mockReset` 而不是 `mockClear`
 *
 * `clearAllMocks` **不清实现**：上一条用例改过的 `mockReturnValue` / 抛错实现会
 * 泄漏到下一条，让「必然抛错」的分支静默改变后续用例的含义（见 `REF-testing.md`）。
 * 所以这里统一 `mockReset()` 再把默认实现重锚回中性值。
 *
 * @module tests/helpers/utility-mock
 */

import { vi } from 'vitest'

import { ErrorLevel } from '../../ts/core/constants.js'

/** 列号 → 字母（1→A、26→Z、27→AA），与 `tools/string-utilities` 的真实实现等价 */
export function numberToColumnLetters(col: number): string {
  let result = ''
  let remaining = col
  while (remaining > 0) {
    result = String.fromCodePoint(65 + ((remaining - 1) % 26)) + result
    remaining = Math.floor((remaining - 1) / 26)
  }
  return result
}

/**
 * 共享替身。只列被测模块**真正会取用**的成员 —— 缺的成员是运行期 TypeError，
 * 多出来的成员则会让门禁报未使用。
 */
export const utilityMock = {
  bgmLog: vi.fn<(level: number, message: string) => void>(),
  getApp: vi.fn<() => unknown>(() => null),
  getCellValue: vi.fn<(ws: unknown, row: number, col: number) => string>(() => ''),
  getLastRow: vi.fn<(ws: unknown) => number>(() => 0),
  setCellValue: vi.fn<(...input: unknown[]) => boolean>(() => true),
  readRangeValues: vi.fn<(...input: unknown[]) => string[][]>(() => []),
  findHeaderRow: vi.fn<(ws: unknown) => number>(() => 1),
  getColumnMap: vi.fn<(ws: unknown, headerRow?: number) => Map<string, number>>(() => new Map()),
  colNumberToLetter: vi.fn((col: number) => numberToColumnLetters(col)),
  BGM: {
    Dialog: {
      alert: vi.fn<(title: string, message?: string) => void>(),
      error: vi.fn<(title: string, message?: string) => void>(),
      /** 默认**不回调**：要驱动「确认 / 取消」的用例自行覆写实现 */
      confirm: vi.fn<(message: string, callback: (isConfirmed: boolean) => void) => void>(),
      prompt: vi.fn<(message: string, callback: (value: string) => void) => void>(),
    },
    handleError: vi.fn<(error: unknown, options?: unknown) => void>(),
    /** 用真实常量：断言可写 `expect(options.level).toBe(ErrorLevel.ERROR)`（= 2） */
    ErrorLevel,
  },
}

/** 所有 spy 的引用（`mockReset` 不改引用，故模块顶层算一次即可） */
const utilityFns = [
  utilityMock.bgmLog,
  utilityMock.getApp,
  utilityMock.getCellValue,
  utilityMock.getLastRow,
  utilityMock.setCellValue,
  utilityMock.readRangeValues,
  utilityMock.findHeaderRow,
  utilityMock.getColumnMap,
  utilityMock.colNumberToLetter,
  utilityMock.BGM.Dialog.alert,
  utilityMock.BGM.Dialog.error,
  utilityMock.BGM.Dialog.confirm,
  utilityMock.BGM.Dialog.prompt,
  utilityMock.BGM.handleError,
]

/**
 * 清空调用记录并重锚默认实现。在 `beforeEach` 里调用。
 *
 * 默认值是「中性」的：不抛错、返回空值、宿主不存在（`getApp` → `null`）。
 * 需要其它行为的用例覆写即可 —— 下一条用例调用本函数后自然复位。
 *
 * 注意本函数**只负责这个 barrel**：测试文件自己 `vi.hoisted` 出来的其它替身
 * （如 `enrich-engine` / `progress` 的 spy）仍需各自 `mockReset()`。
 */
export function resetUtilityMock(): void {
  for (const mockFunction of utilityFns) mockFunction.mockReset()

  utilityMock.getApp.mockReturnValue(null)
  utilityMock.getCellValue.mockReturnValue('')
  utilityMock.getLastRow.mockReturnValue(0)
  utilityMock.setCellValue.mockReturnValue(true)
  utilityMock.readRangeValues.mockReturnValue([])
  utilityMock.findHeaderRow.mockReturnValue(1)
  utilityMock.getColumnMap.mockReturnValue(new Map())
  utilityMock.colNumberToLetter.mockImplementation(numberToColumnLetters)
}

/** 取 `bgmLog` 的**消息体**列表（`LOG_LEVELS.INFO` 是数字 1，别用 `expect.any(String)` 匹级别） */
export function loggedMessages(): string[] {
  return utilityMock.bgmLog.mock.calls.map((call) => call[1])
}

/** 是否有一条日志消息包含给定片段 */
export function hasLogMessage(fragment: string): boolean {
  return loggedMessages().some((message) => message.includes(fragment))
}
