/**
 * @fileoverview debug-panel-render 单测：调试面板的常量 / 全局读取 / HTML 模板。
 *
 * 该模块从 `entry/debug-panel.ts` 抽出，**无 import 时副作用**（原文件顶部会自动
 * `initDebugPanel()`），因此可直接单测。这里把每条模板的关键结构锁死，并覆盖
 * 「有 / 无宿主全局」两类分支。
 */

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  RIBBON_BUTTONS,
  LOG_FILTERS,
  isDebugEnvironment,
  getModuleStatuses,
  escapeHtml,
  buildHeaderHTML,
  buildStatusBarHTML,
  buildTabsHTML,
  buildModulesPanelHTML,
  buildRibbonPanelHTML,
  buildConsolePanelHTML,
  buildEnvironmentPanelHTML,
} from '../ts/entry/debug-panel-render.js'
import type { ModuleStatus } from '../ts/entry/debug-panel-render.js'

/** 单点写/删 window 上的调试全局（避免 casts 散布到每个用例） */
const setWin = (key: string, value: unknown): void => {
  Reflect.set(window, key, value)
}
/** 用作「存在且为函数」的宿主全局占位值 */
const noop = (): void => {}
const delWin = (key: string): void => {
  Reflect.deleteProperty(window, key)
}

const CLEARED = [
  'WpsInvoke',
  '_bgmRibbonReady',
  '_ribbonReady',
  'OnAddinLoad',
  'OnAction',
  'GetBangumiImage',
  'GetIncrementalSyncPressed',
  'DOMPurify',
  'z',
  '__BGM_MODULE_STATUS__',
]

beforeEach(() => {
  for (const key of CLEARED) delWin(key)
})

afterEach(() => {
  for (const key of CLEARED) delWin(key)
})

describe('debug-panel-render / 常量', () => {
  it('RIBBON_BUTTONS 每项含 id/label/icon', () => {
    expect(RIBBON_BUTTONS.length).toBeGreaterThan(0)
    for (const b of RIBBON_BUTTONS) {
      expect(b.id).toMatch(/^btn/)
      expect(b.label.length).toBeGreaterThan(0)
      expect(b.icon.length).toBeGreaterThan(0)
    }
  })

  it('LOG_FILTERS 首项为「全部」(level=undefined)', () => {
    expect(LOG_FILTERS[0]).toEqual({ label: '全部', level: undefined })
    expect(LOG_FILTERS.map((f) => f.level)).toContain('ERROR')
  })
})

describe('debug-panel-render / 宿主全局读取', () => {
  it('无 WpsInvoke 视为调试环境；有则不是', () => {
    expect(isDebugEnvironment()).toBe(true)
    setWin('WpsInvoke', noop)
    expect(isDebugEnvironment()).toBe(false)
  })

  it('getModuleStatuses 缺失时返回空数组，存在时原样返回', () => {
    expect(getModuleStatuses()).toEqual([])
    const mods: ModuleStatus[] = [{ src: 'a.ts', loaded: true, critical: false }]
    setWin('__BGM_MODULE_STATUS__', mods)
    expect(getModuleStatuses()).toBe(mods)
  })
})

describe('debug-panel-render / escapeHtml', () => {
  it('转义标签尖括号，阻止注入为元素', () => {
    const out = escapeHtml('<img src=x onerror=alert(1)>')
    expect(out).toContain('&lt;img')
    expect(out).not.toContain('<img')
  })
})

describe('debug-panel-render / 模板构建', () => {
  it('buildHeaderHTML 含标题与折叠按钮', () => {
    const html = buildHeaderHTML()
    expect(html).toContain('bgm-dp-header')
    expect(html).toContain('调试面板')
    expect(html).toContain('id="bgm-dp-collapse"')
  })

  it('buildStatusBarHTML：Ribbon 未就绪 + 失败模块 + 计数', () => {
    const mods: ModuleStatus[] = [
      { src: 'a', loaded: true, critical: true },
      { src: 'b', loaded: false, critical: false },
    ]
    const html = buildStatusBarHTML(mods)
    expect(html).toContain('○ Ribbon 未就绪')
    expect(html).toContain('1 模块失败')
    expect(html).toContain('1/2 已加载')
    expect(html).toContain('bgm-dp-badge-warn')
  })

  it('buildStatusBarHTML：Ribbon 就绪 + 关键模块失败用 err 徽标', () => {
    setWin('_bgmRibbonReady', noop)
    const mods: ModuleStatus[] = [{ src: 'a', loaded: false, critical: true }]
    const html = buildStatusBarHTML(mods)
    expect(html).toContain('● Ribbon 就绪')
    expect(html).toContain('bgm-dp-badge-err')
  })

  it('buildStatusBarHTML：全加载时不出现失败徽标', () => {
    const mods: ModuleStatus[] = [{ src: 'a', loaded: true, critical: false }]
    const html = buildStatusBarHTML(mods)
    expect(html).not.toContain('模块失败')
    expect(html).toContain('1/1 已加载')
  })

  it('buildTabsHTML 写入日志数与模块数', () => {
    setWin('__BGM_MODULE_STATUS__', [
      { src: 'a', loaded: true, critical: false },
    ] satisfies ModuleStatus[])
    const html = buildTabsHTML(42)
    expect(html).toContain('data-tab="console"')
    expect(html).toContain('>42<')
    // 模块状态页签计数来自 getModuleStatuses()
    expect(html).toContain('>1<')
    expect(html).toContain(`>${String(RIBBON_BUTTONS.length)}<`)
  })

  it('buildModulesPanelHTML：空态', () => {
    expect(buildModulesPanelHTML()).toContain('等待模块加载')
  })

  it('buildModulesPanelHTML：渲染 src / error / critical 标记', () => {
    setWin('__BGM_MODULE_STATUS__', [
      { src: 'ok.ts', loaded: true, critical: false },
      { src: 'bad.ts', loaded: false, critical: true, error: 'boom' },
    ] satisfies ModuleStatus[])
    const html = buildModulesPanelHTML()
    expect(html).toContain('ok.ts')
    expect(html).toContain('bad.ts — boom')
    expect(html).toContain('bgm-dp-mod-tag-critical')
    expect(html).toContain('bgm-dp-mod-dot-err')
  })

  it('buildRibbonPanelHTML：每个按钮都有卡片', () => {
    const html = buildRibbonPanelHTML()
    for (const b of RIBBON_BUTTONS) {
      expect(html).toContain(`data-btn="${b.id}"`)
      expect(html).toContain(`data-result="${b.id}"`)
    }
  })

  it('buildConsolePanelHTML：筛选按钮 + 清空/导出', () => {
    const html = buildConsolePanelHTML()
    expect(html).toContain('data-level="all"')
    expect(html).toContain('data-level="ERROR"')
    expect(html).toContain('id="bgm-dp-log-clear"')
    expect(html).toContain('id="bgm-dp-log-export"')
  })

  it('buildEnvironmentPanelHTML：开发模式显示 WpsInvoke undefined + 警告色', () => {
    const html = buildEnvironmentPanelHTML()
    expect(html).toContain(window.location.href)
    expect(html).toContain('undefined (开发模式)')
    expect(html).toContain('bgm-dp-env-value-warn')
  })

  it('buildEnvironmentPanelHTML：宿主可用时显示 available + 就绪色', () => {
    setWin('WpsInvoke', noop)
    setWin('_ribbonReady', true)
    setWin('OnAction', () => true)
    setWin('GetBangumiImage', () => 'x')
    setWin('DOMPurify', {})
    const html = buildEnvironmentPanelHTML()
    expect(html).toContain('available')
    expect(html).toContain('bgm-dp-env-value-ok')
    expect(html).toContain('id="bgm-dp-export-report"')
  })
})
