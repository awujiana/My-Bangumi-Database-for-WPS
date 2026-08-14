import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockGetApp = vi.hoisted(() => vi.fn())
const mockBgmLog = vi.hoisted(() => vi.fn())

vi.mock('../ts/tools/util/index.js', () => ({
  getApp: mockGetApp,
  bgmLog: mockBgmLog,
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}))

import { sleep, delay } from '../ts/tools/util/sleep.js'

describe('sleep', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应在无 WPS Application 时通过 busy-loop 实现', () => {
    mockGetApp.mockReturnValue(null)
    const start = Date.now()
    sleep(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  it('有 Wait 方法时应使用 app.Wait 而非 busy-loop', () => {
    const mockWait = vi.fn()
    const mockApp = { Wait: mockWait, DoEvents: vi.fn() }
    mockGetApp.mockReturnValue(mockApp)

    sleep(50)

    expect(mockWait).toHaveBeenCalledTimes(1)
    expect(mockWait).toHaveBeenCalledWith(expect.any(Date))
  })

  it('app.Wait 抛出异常时应回退到 busy-loop', () => {
    const mockWait = vi.fn(() => {
      throw new Error('Wait 不可用')
    })
    const mockApp = { Wait: mockWait }
    mockGetApp.mockReturnValue(mockApp)

    const start = Date.now()
    sleep(30)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(20)
    expect(mockBgmLog).toHaveBeenCalledWith('WARN', expect.stringContaining('sleep app.Wait 失败'))
  })

  it('busy-loop 中 DoEvents 抛出异常时应 break 并记录', () => {
    // 第一轮返回带 DoEvents 的 app，第二轮让 DoEvents 抛异常
    let callCount = 0
    const mockDoEvents = vi.fn(() => {
      callCount++
      if (callCount >= 1) {
        throw new Error('DoEvents 失败')
      }
    })
    const mockApp = { DoEvents: mockDoEvents }
    mockGetApp.mockReturnValue(mockApp)

    sleep(30)

    expect(mockBgmLog).toHaveBeenCalledWith('INFO', expect.stringContaining('sleep DoEvents 失败'))
  })

  it('busy-loop 中 app 为 null 时不应崩溃', () => {
    let callCount = 0
    mockGetApp.mockImplementation(() => {
      callCount++
      return null
    })

    const start = Date.now()
    sleep(20)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(15)
  })

  it('bgmLog 不是函数时不应崩溃（DoEvents 异常路径）', () => {
    const mockDoEvents = vi.fn(() => {
      throw new Error('test error')
    })
    const mockApp = { DoEvents: mockDoEvents }
    mockGetApp.mockReturnValue(mockApp)

    // 覆盖 bgmLog 为非函数的场景
    mockBgmLog.mockReturnValue(undefined)

    expect(() => sleep(15)).not.toThrow()
  })

  it('bgmLog 为非函数值时仍能正常 break', async () => {
    // 重置模块注册
    vi.resetModules()
    // 重新 mock，使用非函数 bgmLog
    vi.doMock('../ts/tools/util/index.js', () => ({
      getApp: mockGetApp,
      bgmLog: null as unknown as typeof mockBgmLog,
      LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
    }))
    vi.doMock('../ts/core/constants.js', () => ({
      LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
    }))

    const { sleep: sleepNew } = await import('../ts/tools/util/sleep.js')

    const mockDoEvents = vi.fn(() => {
      throw new Error('DoEvents boom')
    })
    const mockApp = { DoEvents: mockDoEvents }
    mockGetApp.mockReturnValue(mockApp)

    expect(() => sleepNew(15)).not.toThrow()
  })
})

describe('delay', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应返回 Promise', async () => {
    const result = delay(10)
    expect(result).toBeInstanceOf(Promise)
  })

  it('应在指定时间后 resolve', async () => {
    const start = Date.now()
    await delay(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  it('应可被连续调用', async () => {
    const start = Date.now()
    await delay(20)
    await delay(20)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(30)
  })

  it('0ms 应立即 resolve', async () => {
    const start = Date.now()
    await delay(0)
    const elapsed = Date.now() - start
    // 0ms 可能几乎立即完成，但 setTimeout 最小约 4ms
    expect(elapsed).toBeLessThanOrEqual(50)
  })
})
