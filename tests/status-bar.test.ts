/**
 * @fileoverview `ts/tools/util/status-bar.ts`（StatusBar 节流写入器）单元测试。
 *
 * 背景：同步流程在每行的进度回调里写一次 `app.StatusBar`，每次赋值都是一次
 * 跨进程往返。节流器把写入压到 200 ms 一档，本文件锁定其契约：
 * 首次立即写、窗口内只留最新值、flush 立即落盘、宿主不支持时全程无操作。
 */

import { describe, expect, it } from 'vitest'

import {
  createStatusBarWriter,
  STATUS_BAR_THROTTLE_MS,
} from '../ts/tools/util/status-bar.js'
import type { StatusBarHost } from '../ts/tools/util/status-bar.js'

/** 可控时钟 */
function makeClock(start = 0): { now: () => number; set: (value: number) => void } {
  let t = start
  return {
    now: () => t,
    set: (value: number) => {
      t = value
    },
  }
}

describe('createStatusBarWriter', () => {
  it('默认节流窗口为 200ms', () => {
    expect(STATUS_BAR_THROTTLE_MS).toBe(200)
  })

  it('首次写入立即落盘（与时钟起点无关）', () => {
    const clock = makeClock(0)
    const app: StatusBarHost = { StatusBar: '' }
    const writer = createStatusBarWriter(app, 200, clock.now)

    writer.write('[1/10] 开始')

    expect(app.StatusBar).toBe('[1/10] 开始')
  })

  it('窗口内只保留最新值，窗口到期后的下一次写入立即落盘', () => {
    const clock = makeClock(0)
    const app: StatusBarHost = { StatusBar: '' }
    const writer = createStatusBarWriter(app, 200, clock.now)

    writer.write('first')
    expect(app.StatusBar).toBe('first')

    clock.set(50)
    writer.write('second')
    clock.set(100)
    writer.write('third')
    // 窗口内：不落盘，只更新待写值
    expect(app.StatusBar).toBe('first')

    clock.set(200)
    writer.write('fourth')
    expect(app.StatusBar).toBe('fourth')
  })

  it('flush 立即写出待写值；无待写值时保持原值', () => {
    const clock = makeClock(0)
    const app: StatusBarHost = { StatusBar: '' }
    const writer = createStatusBarWriter(app, 200, clock.now)

    writer.write('a')
    clock.set(10)
    writer.write('b')
    expect(app.StatusBar).toBe('a')

    writer.flush()
    expect(app.StatusBar).toBe('b')

    writer.flush()
    expect(app.StatusBar).toBe('b')
  })

  it('宿主不支持 StatusBar（undefined）→ 全程无操作且不抛错', () => {
    const app: StatusBarHost = {}
    const writer = createStatusBarWriter(app, 200, makeClock(0).now)

    expect(() => {
      writer.write('x')
      writer.flush()
    }).not.toThrow()
    expect('StatusBar' in app).toBe(false)
  })

  it('app 为 null / undefined → 全程无操作且不抛错', () => {
    const clock = makeClock(0)
    for (const app of [null, undefined]) {
      const writer = createStatusBarWriter(app, 200, clock.now)
      expect(() => {
        writer.write('x')
        writer.flush()
      }).not.toThrow()
    }
  })
})
