/**
 * @fileoverview `ts/ui/dom-scroll.ts` 合帧滚动单测
 * @module tests/domScroll
 * @description
 *   守住「读 scrollHeight 会强制同步布局」这条性能不变量：
 *   1. 同一帧内多次调用只读一次 scrollHeight（日志一行一读 = 一行一次 reflow，
 *      4000 行同步日志足以把任务窗格卡成幻灯片）；
 *   2. 元素粒度去重：不同日志区互不干扰；
 *   3. 无 rAF 的环境（node env 单测）退化为同步滚动，行为不变。
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { scrollToBottomCoalesced } from '../ts/ui/dom-scroll.js'

/** 造一个滚动容器，并把 scrollHeight 桩成可观测的计数 getter */
function makeScroller(height: number): { element: HTMLDivElement; reads: () => number } {
  const element = document.createElement('div')
  document.body.append(element)
  let reads = 0
  Object.defineProperty(element, 'scrollHeight', {
    get: () => {
      reads += 1
      return height
    },
    configurable: true,
  })
  return { element, reads: () => reads }
}

/** 等一帧：让 rAF 回调跑完 */
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('scrollToBottomCoalesced', () => {
  it('同一帧内多次调用只读一次 scrollHeight、只滚一次', async () => {
    const { element, reads } = makeScroller(300)

    scrollToBottomCoalesced(element)
    scrollToBottomCoalesced(element)
    scrollToBottomCoalesced(element)
    // 调用即时：一次布局都没读（写不强制布局，读才强制）
    expect(reads()).toBe(0)
    expect(element.scrollTop).toBe(0)

    await nextFrame()
    expect(reads()).toBe(1)
    expect(element.scrollTop).toBe(300)
  })

  it('不同元素各自排队、互不干扰', async () => {
    const first = makeScroller(100)
    const second = makeScroller(200)

    scrollToBottomCoalesced(first.element)
    scrollToBottomCoalesced(second.element)
    await nextFrame()

    expect(first.reads()).toBe(1)
    expect(second.reads()).toBe(1)
    expect(first.element.scrollTop).toBe(100)
    expect(second.element.scrollTop).toBe(200)
  })

  it('跨帧的调用各滚一次（每帧最多一次读取）', async () => {
    const { element, reads } = makeScroller(300)

    scrollToBottomCoalesced(element)
    await nextFrame()
    scrollToBottomCoalesced(element)
    await nextFrame()

    expect(reads()).toBe(2)
    expect(element.scrollTop).toBe(300)
  })

  it('没有 rAF 的环境退化为同步滚动（行为不变）', () => {
    const { element, reads } = makeScroller(300)
    const original = requestAnimationFrame
    // 置空触发模块内的 typeof 降级分支
    ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined

    try {
      scrollToBottomCoalesced(element)
      expect(reads()).toBe(1)
      expect(element.scrollTop).toBe(300)
    } finally {
      globalThis.requestAnimationFrame = original
    }
  })
})
