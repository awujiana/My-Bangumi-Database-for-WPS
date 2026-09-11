import { describe, it, expect, vi, beforeEach } from 'vitest'

// 隔离底层依赖：wps.ts 依赖 util/index（getApp/bgmLog）、core/ui-bridge（getNotifyApi）、core/constants。
vi.mock('../ts/tools/util/index.js', () => ({
  getApp: vi.fn(),
  bgmLog: vi.fn(),
}))

vi.mock('../ts/core/ui-bridge.js', () => ({
  getNotifyApi: vi.fn(() => ({
    input: vi.fn(),
    confirm: vi.fn(),
    alert: vi.fn(),
  })),
}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { WARN: 'warn', INFO: 'info', ERROR: 'error' },
}))

import {
  isWpsApp,
  isWpsWorksheet,
  isWpsRange,
  getRowRange,
  getRowRangeSafe,
  wpsPrompt,
  wpsMessageBox,
} from '../ts/tools/wps.js'
import { getApp } from '../ts/tools/util/index.js'
import type { WpsWorksheet } from '../ts/tools/wps.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('wps 类型守卫', () => {
  it('isWpsApp', () => {
    expect(isWpsApp({ ActiveWorkbook: {} })).toBe(true)
    expect(isWpsApp(null)).toBe(false)
    expect(isWpsApp('x')).toBe(false)
  })

  it('isWpsWorksheet', () => {
    expect(isWpsWorksheet({ Name: 'a', Range: () => ({}) })).toBe(true)
    expect(isWpsWorksheet({})).toBe(false)
    expect(isWpsWorksheet(null)).toBe(false)
  })

  it('isWpsRange', () => {
    expect(isWpsRange({ Row: 1 })).toBe(true)
    expect(isWpsRange({ Value2: null })).toBe(true)
    expect(isWpsRange({})).toBe(false)
    expect(isWpsRange(42)).toBe(false)
  })
})

describe('getRowRange', () => {
  const ws = {
    Range: (addr: string) => ({ Address: addr }),
    Rows: { Item: (index: number) => ({ Row: index }) },
  } as unknown as WpsWorksheet

  it('返回 A1 表示法的整行 Range', () => {
    const range = getRowRange(ws, 5)
    expect(range.Address).toBe('5:5')
  })

  it('Range 非函数时抛 TypeError', () => {
    const bad = { Range: 'not-fn' } as unknown as WpsWorksheet
    expect(() => getRowRange(bad, 5)).toThrow(TypeError)
  })

  it('行号非法时抛 Error', () => {
    expect(() => getRowRange(ws, 0)).toThrow(Error)
    expect(() => getRowRange(ws, NaN)).toThrow(Error)
  })
})

describe('getRowRangeSafe', () => {
  it('Range 可用时走 getRowRange', () => {
    const ws = {
      Range: (addr: string) => ({ Address: addr }),
    } as unknown as WpsWorksheet
    expect(getRowRangeSafe(ws, 2).Address).toBe('2:2')
  })

  it('Range 抛错时回退到 Rows.Item', () => {
    const ws = {
      Rows: { Item: (index: number) => ({ Row: index }) },
    } as unknown as WpsWorksheet
    const range = getRowRangeSafe(ws, 3) as unknown as { Row: number }
    expect(range.Row).toBe(3)
  })
})

describe('wpsPrompt', () => {
  it('优先使用 WPS InputBox，返回输入字符串', async () => {
    ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({
      InputBox: vi.fn(() => 'typed'),
    })
    const result = await wpsPrompt('请输入', 'def')
    expect(result).toBe('typed')
  })

  it('InputBox 返回 false 时解析为 null', async () => {
    const inputBox = vi.fn(() => false)
    ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({ InputBox: inputBox })
    const result = await wpsPrompt('请输入')
    expect(result).toBeNull()
    expect(inputBox).toHaveBeenCalledWith('请输入', 'Bangumi 设置', '', 2)
  })
})

describe('wpsMessageBox', () => {
  it('优先使用 WPS MessageBox，返回其数值', async () => {
    const messageBox = vi.fn(() => 6)
    ;(getApp as ReturnType<typeof vi.fn>).mockReturnValue({ MessageBox: messageBox })
    const result = await wpsMessageBox('确认？', 4, 64)
    expect(result).toBe(6)
    expect(messageBox).toHaveBeenCalledWith('确认？', 68)
  })
})
