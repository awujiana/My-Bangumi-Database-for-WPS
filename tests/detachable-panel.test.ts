// @vitest-environment node
/**
 * @fileoverview `ts/ui/components/detachable-panel.ts` 几何纯函数单测（Node 直跑）
 *
 * 只测纯函数那半边：拖动 / 缩放的「下一步几何」全是 `(当前, 位移, 视口) → 新值`
 * 的映射，没有 DOM 依赖，能在 Node 下把边界钉死。DOM 装配那半边不在这里测
 * （要 jsdom + 指针事件，性价比低），靠人工与页面冒烟。
 *
 * 守住的四条边界：
 * 1. 窗口永远完整留在视口内 —— 拖出去找不回来是最糟的失败模式
 * 2. 尺寸不小于下限 —— 压成一条线内容就没了
 * 3. 尺寸不大于视口 —— 视口比下限还小时仍可用（取下限，不取 0）
 * 4. 连开多个窗口位置要错开 —— 严丝合缝叠一起用户只看到「没反应」
 */

import { describe, expect, it } from 'vitest'

import {
  COLLAPSED_HEIGHT,
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_PANEL_WIDTH,
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
  clampPosition,
  clampSize,
  defaultPanelRect,
  nextPanelHeight,
} from '../ts/ui/components/detachable-panel.js'

/** 常见视口：1440×900 的笔记本 */
const VIEWPORT = { width: 1440, height: 900 }

describe('clampPosition', () => {
  it('负坐标收到 0（标题栏不能被推出视口外，否则用户抓不回来）', () => {
    const next = clampPosition({ left: -80, top: -40 }, { width: 600, height: 400 }, VIEWPORT)
    expect(next).toEqual({ left: 0, top: 0 })
  })

  it('超出右下边界时贴边（保留窗口完整可见）', () => {
    const next = clampPosition({ left: 9999, top: 9999 }, { width: 600, height: 400 }, VIEWPORT)
    expect(next).toEqual({ left: VIEWPORT.width - 600, top: VIEWPORT.height - 400 })
  })

  it('窗口比视口还大时贴在左上角而不是被推成负坐标', () => {
    const next = clampPosition({ left: 100, top: 100 }, { width: 2000, height: 1200 }, VIEWPORT)
    expect(next).toEqual({ left: 0, top: 0 })
  })
})

describe('clampSize', () => {
  it('小于下限时抬到下限（宽高都保底）', () => {
    const next = clampSize({ width: 10, height: 10 }, VIEWPORT)
    expect(next).toEqual({ width: MIN_PANEL_WIDTH, height: MIN_PANEL_HEIGHT })
  })

  it('大于视口时收到视口', () => {
    const next = clampSize({ width: 4000, height: 3000 }, VIEWPORT)
    expect(next).toEqual({ width: VIEWPORT.width, height: VIEWPORT.height })
  })

  it('视口比下限还小时取下限（不返回 0，否则窗口塌成不可见）', () => {
    const next = clampSize({ width: 10, height: 10 }, { width: 120, height: 90 })
    expect(next).toEqual({ width: MIN_PANEL_WIDTH, height: MIN_PANEL_HEIGHT })
  })
})

describe('nextPanelHeight', () => {
  it('收起时收到标题栏一行', () => {
    expect(nextPanelHeight(520, true, 520)).toBe(COLLAPSED_HEIGHT)
  })

  it('展开时还原上次高度', () => {
    expect(nextPanelHeight(40, false, 520)).toBe(520)
  })

  it('没有可还原高度时退回当前高度，且不低于下限', () => {
    expect(nextPanelHeight(300, false, 0)).toBe(300)
    expect(nextPanelHeight(40, false, 0)).toBe(MIN_PANEL_HEIGHT)
  })
})

describe('defaultPanelRect', () => {
  it('默认落在视口内', () => {
    const rect = defaultPanelRect(0, VIEWPORT)
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.left + rect.width).toBeLessThanOrEqual(VIEWPORT.width)
    expect(rect.top + rect.height).toBeLessThanOrEqual(VIEWPORT.height)
  })

  it('连开多个时位置错开（否则叠在一起像没反应）', () => {
    const first = defaultPanelRect(0, VIEWPORT)
    const second = defaultPanelRect(1, VIEWPORT)
    expect(first.left).not.toBe(second.left)
    expect(first.top).not.toBe(second.top)
  })

  it('期望尺寸大于视口时按视口收敛', () => {
    const rect = defaultPanelRect(0, { width: 500, height: 400 }, 2000, 1500)
    expect(rect.width).toBe(500)
    expect(rect.height).toBe(400)
    expect(rect.left).toBe(0)
    expect(rect.top).toBe(0)
  })

  it('不传尺寸时用默认窗口大小', () => {
    const rect = defaultPanelRect(0, VIEWPORT)
    expect(rect.width).toBe(Math.min(DEFAULT_PANEL_WIDTH, VIEWPORT.width))
    expect(rect.height).toBe(Math.min(DEFAULT_PANEL_HEIGHT, VIEWPORT.height))
  })
})
