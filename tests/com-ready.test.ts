/**
 * @fileoverview 宿主 COM 就绪闸门单测（ts/tools/com-ready.ts）
 * @module tests/comReady
 * @description 覆盖「打开高亮页面卡 70 秒」修复链路里容易静默失效的分支：
 *   1. 闸门未开 → 任务只排队不执行（首屏零 COM）；
 *   2. 闸门开启 → 排队任务按序执行；
 *   3. 单片超预算 → 停止后续分片 + 派发降级事件 + resume 能续跑；
 *   4. 自适应延迟：观测到 stall 后下次闸门延迟 = stall + 余量（上限 15s）；
 *   5. 降级兜底 UI：插入提示条，「点此继续」按钮触发 resume。
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COM_DEGRADED_EVENT,
  installComStartupFallback,
  isComGateOpen,
  isHeavyAutoAllowed,
  openComGate,
  readHeavyCostMs,
  readLastStallMs,
  resetComGateForTest,
  resolveGateDelayMs,
  runComPhases,
  scheduleComTask,
} from '../ts/tools/com-ready.js'

/** 假 PluginStorage：内存 Map */
function installFakeHost(): Map<string, string> {
  const storage = new Map<string, string>()
  ;(window as unknown as { Application: unknown }).Application = {
    PluginStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
    },
  }
  return storage
}

/** 捕获挂起 / 降级事件里的 resume 与 mode（监听后返回可变容器） */
function capturePending(): { resume?: () => void; mode?: string | undefined } {
  const captured: { resume?: () => void; mode?: string | undefined } = {}
  document.addEventListener(COM_DEGRADED_EVENT, (event: Event) => {
    const { detail } = event as CustomEvent<{ resume: () => void; mode?: string }>
    captured.resume = detail.resume
    captured.mode = detail.mode
  })
  return captured
}

beforeEach(() => {
  resetComGateForTest()
  installFakeHost()
  document.body.replaceChildren()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  resetComGateForTest()
  delete (window as unknown as { Application?: unknown }).Application
})

describe('闸门排队语义（首屏零 COM）', () => {
  it('闸门未开时任务只排队，不执行', () => {
    const run = vi.fn()
    scheduleComTask('配置', run)

    vi.advanceTimersByTime(5000)
    expect(run).not.toHaveBeenCalled()
    expect(isComGateOpen()).toBe(false)
  })

  it('闸门开启后排队任务被执行', () => {
    const run = vi.fn()
    scheduleComTask('配置', run)

    openComGate('highlight')
    // load（readyState complete 分支）→ 两帧 → 自适应延迟 800ms → 开闸 → 排空
    vi.advanceTimersByTime(2000)

    expect(isComGateOpen()).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('多个任务按入队顺序依次执行', () => {
    const order: string[] = []
    const record = (name: string) => () => {
      order.push(name)
    }
    scheduleComTask('a', record('a'))
    scheduleComTask('b', record('b'))
    scheduleComTask('c', record('c'))

    openComGate('clean')
    vi.advanceTimersByTime(3000)

    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('单个任务抛异常不影响后续任务', () => {
    const later = vi.fn()
    scheduleComTask('炸', () => {
      throw new Error('boom')
    })
    scheduleComTask('后', later)

    openComGate('enrich')
    vi.advanceTimersByTime(3000)

    expect(later).toHaveBeenCalledTimes(1)
  })
})

describe('分片执行与卡顿降级', () => {
  it('全部片都在预算内 → 依次跑完，不派发降级事件', () => {
    const degraded = vi.fn()
    document.addEventListener(COM_DEGRADED_EVENT, degraded)
    const order: string[] = []

    runComPhases('highlight', [
      {
        name: '配置',
        run: () => {
          order.push('配置')
        },
      },
      {
        name: '读表',
        run: () => {
          order.push('读表')
        },
      },
    ])
    openComGate('highlight')
    vi.advanceTimersByTime(3000)

    expect(order).toEqual(['配置', '读表'])
    expect(degraded).not.toHaveBeenCalled()
  })

  it('单片超预算 → 停止后续分片并派发降级事件（不再硬扛 70 秒）', () => {
    const degraded = vi.fn()
    document.addEventListener(COM_DEGRADED_EVENT, degraded)
    const heavy = vi.fn()

    runComPhases(
      'highlight',
      [
        {
          name: '配置',
          run: () => {
            // 空分片：占位
          },
        },
        {
          name: '大 Range 读',
          run: () => {
            // 模拟同步 COM 阻塞：推进假时钟 1500ms（> 800ms 预算）
            vi.advanceTimersByTime(1500)
          },
        },
        { name: '渲染预览', run: heavy },
      ],
      800,
    )
    openComGate('highlight')
    vi.advanceTimersByTime(3000)

    expect(heavy).not.toHaveBeenCalled()
    expect(degraded).toHaveBeenCalledTimes(1)
  })

  it('降级事件的 resume 能续跑剩余分片（用户点击时宿主已空闲）', () => {
    // 用对象装 resume：直接 let resume 会被 TS 控制流收窄成 null（赋值发生在回调里）
    const captured: { resume?: () => void } = {}
    document.addEventListener(COM_DEGRADED_EVENT, (event: Event) => {
      captured.resume = (event as CustomEvent<{ resume: () => void }>).detail.resume
    })
    const tail = vi.fn()

    runComPhases(
      'highlight',
      [
        {
          name: '大 Range 读',
          run: () => {
            vi.advanceTimersByTime(1500)
          },
        },
        { name: '渲染预览', run: tail },
      ],
      800,
    )
    openComGate('highlight')
    vi.advanceTimersByTime(3000)
    expect(tail).not.toHaveBeenCalled()

    captured.resume?.()
    vi.advanceTimersByTime(100)
    expect(tail).toHaveBeenCalledTimes(1)
  })

  it('分片抛异常不中断整条链', () => {
    const tail = vi.fn()
    runComPhases('clean', [
      {
        name: '炸',
        run: () => {
          throw new Error('boom')
        },
      },
      { name: '后', run: tail },
    ])
    openComGate('clean')
    vi.advanceTimersByTime(3000)

    expect(tail).toHaveBeenCalledTimes(1)
  })
})

describe('自适应闸门延迟', () => {
  it('无 stall 记录 → 走默认 800ms', () => {
    expect(resolveGateDelayMs('highlight')).toBe(800)
  })

  it('有 stall 记录 → 延迟 = stall + 200ms 余量', () => {
    installFakeHost().set('bgm_com_stall_highlight', '1000')
    expect(resolveGateDelayMs('highlight')).toBe(1200)
  })

  it('延迟有上限 3s（重活已改按需，没必要让按钮陪着等十几秒）', () => {
    installFakeHost().set('bgm_com_stall_highlight', '70000')
    expect(resolveGateDelayMs('highlight')).toBe(3000)
  })

  it('踩到 stall 后会把观测值写进 PluginStorage（下次绕开窗口）', () => {
    const storage = installFakeHost()
    runComPhases(
      'highlight',
      [
        {
          name: '大 Range 读',
          run: () => {
            vi.advanceTimersByTime(1500)
          },
        },
      ],
      800,
    )
    openComGate('highlight')
    vi.advanceTimersByTime(3000)

    expect(readLastStallMs('highlight')).toBeGreaterThan(800)
    expect(storage.get('bgm_com_stall_highlight')).toBe(String(readLastStallMs('highlight')))
  })

  it('脏值 / 缺失一律按 0 处理', () => {
    installFakeHost().set('bgm_com_stall_clean', 'not-a-number')
    expect(readLastStallMs('clean')).toBe(0)
  })
})

describe('降级兜底 UI', () => {
  it('收到本页降级事件 → 插入提示条，点按钮触发 resume 并移除提示条', () => {
    const resume = vi.fn()
    installComStartupFallback('highlight')

    document.dispatchEvent(
      new CustomEvent(COM_DEGRADED_EVENT, {
        detail: { pageKey: 'highlight', reason: '分片「渲染预览」耗时 70000ms', resume },
      }),
    )

    const banner = document.getElementById('bgm-com-fallback')
    expect(banner).not.toBeNull()
    const button = banner?.querySelector('button')
    expect(button).not.toBeNull()
    button?.click()

    expect(resume).toHaveBeenCalledTimes(1)
    expect(document.getElementById('bgm-com-fallback')).toBeNull()
  })

  it('其它页面的降级事件不响应（多窗格共用 document 也不串台）', () => {
    installComStartupFallback('highlight')
    document.dispatchEvent(
      new CustomEvent(COM_DEGRADED_EVENT, {
        detail: {
          pageKey: 'clean',
          reason: 'x',
          resume: () => {
            // 不该被调用
          },
        },
      }),
    )
    expect(document.getElementById('bgm-com-fallback')).toBeNull()
  })

  it('awaiting 模式文案是「点此加载数据」（还没跑，不是跑崩了）', () => {
    installComStartupFallback('highlight')
    document.dispatchEvent(
      new CustomEvent(COM_DEGRADED_EVENT, {
        detail: {
          pageKey: 'highlight',
          reason: '先挂起',
          mode: 'awaiting',
          resume: () => {
            // 不该被调用
          },
        },
      }),
    )
    const button = document.getElementById('bgm-com-fallback')?.querySelector('button')
    expect(button?.textContent).toBe('点此加载数据')
  })
})

describe('重分片（heavy）按需：不再拿用户赌 70 秒', () => {
  it('无历史记录 → 重分片挂起，不自动跑', () => {
    const heavy = vi.fn()
    runComPhases('highlight', [
      {
        name: '配置',
        run: () => {
          // 轻分片：占位
        },
      },
      { name: '读取工作表', run: heavy, heavy: true },
    ])
    openComGate('highlight')
    vi.advanceTimersByTime(3000)

    expect(heavy).not.toHaveBeenCalled()
  })

  it('轻分片照常自动跑（按钮尽早可用），只有重分片挂起', () => {
    const light = vi.fn()
    const heavy = vi.fn()
    runComPhases('highlight', [
      { name: '事件接线', run: light },
      { name: '读取工作表', run: heavy, heavy: true },
    ])
    openComGate('highlight')
    vi.advanceTimersByTime(3000)

    expect(light).toHaveBeenCalledTimes(1)
    expect(heavy).not.toHaveBeenCalled()
  })

  it('挂起时派发 awaiting 事件，用户点击才跑重分片', () => {
    const captured = capturePending()
    const heavy = vi.fn()
    runComPhases('highlight', [{ name: '读取工作表', run: heavy, heavy: true }])
    openComGate('highlight')
    vi.advanceTimersByTime(3000)

    expect(captured.mode).toBe('awaiting')
    captured.resume?.()
    vi.advanceTimersByTime(100)
    expect(heavy).toHaveBeenCalledTimes(1)
  })

  it('重分片跑完且够快 → 记下耗时，下次自动跑（自愈）', () => {
    const captured = capturePending()
    const heavy = vi.fn()
    const phases = [{ name: '读取工作表', run: heavy, heavy: true }]

    runComPhases('highlight', phases)
    openComGate('highlight')
    vi.advanceTimersByTime(3000)
    expect(heavy).not.toHaveBeenCalled()

    captured.resume?.()
    vi.advanceTimersByTime(100)
    expect(heavy).toHaveBeenCalledTimes(1)
    expect(readHeavyCostMs('highlight')).toBeGreaterThan(0)
    expect(readHeavyCostMs('highlight')).toBeLessThanOrEqual(1500)

    // 第二次打开同一页：应自动跑，不再弹按钮
    resetComGateForTest()
    heavy.mockClear()
    runComPhases('highlight', phases)
    openComGate('highlight')
    vi.advanceTimersByTime(3000)
    expect(heavy).toHaveBeenCalledTimes(1)
  })

  it('曾 stall 过 → 即使有耗时记录也不自动跑', () => {
    const storage = installFakeHost()
    storage.set('bgm_com_stall_highlight', '69735')
    storage.set('bgm_com_heavy_highlight', '642')
    expect(isHeavyAutoAllowed('highlight')).toBe(false)
  })

  it('实测耗时超预算 → 下次仍不自动跑', () => {
    const storage = installFakeHost()
    storage.set('bgm_com_heavy_highlight', '5000')
    expect(isHeavyAutoAllowed('highlight')).toBe(false)
  })

  it('重分片实测够快 → 清掉 stall 记录（窗口过了就恢复自动）', () => {
    const storage = installFakeHost()
    storage.set('bgm_com_stall_highlight', '69735')
    const captured = capturePending()

    // 历史 stall 69735ms → 本次闸门延迟被抬到上限 3s（先把闸门等开）
    runComPhases('highlight', [
      {
        name: '读取工作表',
        run: () => {
          // 模拟用户点击时已出窗口：瞬时完成
        },
        heavy: true,
      },
    ])
    openComGate('highlight')
    vi.advanceTimersByTime(5000)
    captured.resume?.()
    vi.advanceTimersByTime(100)

    expect(storage.get('bgm_com_stall_highlight')).toBe('0')
    expect(isHeavyAutoAllowed('highlight')).toBe(true)
  })
})
