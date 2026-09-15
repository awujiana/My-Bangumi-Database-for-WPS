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
  getDebugGlobals,
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

/** 环境面板单项：值单元格的 class 与文本 */
interface EnvironmentCell {
  cls: string
  text: string
}

/**
 * 从环境面板 HTML 里取出某个标签对应的值单元格。
 * 找不到卡片时**直接抛错** —— 标签被改名属于契约破坏，用例必须红而不是静默跳过。
 */
function environmentCell(html: string, label: string): EnvironmentCell {
  const host = document.createElement('div')
  host.innerHTML = html
  const card = [...host.querySelectorAll('.bgm-dp-env-card')].find(
    (item) => item.querySelector('.bgm-dp-env-label')?.textContent === label,
  )
  const value = card?.querySelector('.bgm-dp-env-value')
  if (value === null || value === undefined) {
    throw new Error(`环境面板缺少「${label}」卡片`)
  }
  return { cls: value.className, text: value.textContent }
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

  it('WpsInvoke 存在但为 undefined 仍算调试环境（判据是 === undefined，不是 in）', () => {
    // 宿主脚本可能先 `window.WpsInvoke = undefined` 占位；若判据写成 `'WpsInvoke' in window`
    // 或 `!window.WpsInvoke`，真机上的调试面板就会**该出不出 / 不该出却出**
    setWin('WpsInvoke', undefined)
    expect(isDebugEnvironment()).toBe(true)
  })

  it('getDebugGlobals 返回 window 本身（读的是同一份宿主全局）', () => {
    expect(getDebugGlobals()).toBe(window)
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

  it('转义 & 且不改动纯文本；空串原样返回', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
    expect(escapeHtml('普通文本 123')).toBe('普通文本 123')
    expect(escapeHtml('')).toBe('')
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

  it('buildStatusBarHTML：_bgmRibbonReady 非函数时一律算未就绪（typeof 判据，不是真值判据）', () => {
    // 宿主可能先塞 `true` 占位再替换成真函数；若这里写成 `!!_bgmRibbonReady`，
    // 占位期间会谎报「Ribbon 就绪」，把「按钮全点了没反应」的问题掩盖掉
    setWin('_bgmRibbonReady', true)
    const html = buildStatusBarHTML([{ src: 'a', loaded: true, critical: false }])
    expect(html).toContain('○ Ribbon 未就绪')
    expect(html).toContain('bgm-dp-badge-err')
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
    // 已加载项必须是绿点；且非 critical 的项**不得**带 critical 标签
    expect(html).toContain('bgm-dp-mod-dot-ok')
    expect(html.match(/bgm-dp-mod-tag-critical/g)).toHaveLength(1)
  })

  it('buildRibbonPanelHTML：每个按钮都有卡片', () => {
    const html = buildRibbonPanelHTML()
    for (const b of RIBBON_BUTTONS) {
      expect(html).toContain(`data-btn="${b.id}"`)
      expect(html).toContain(`data-result="${b.id}"`)
      expect(html).toContain(`data-imgurl="${b.id}"`)
    }
    // 卡片数必须与常量一一对应：漏渲染一个按钮等于面板上少一个测试入口
    const host = document.createElement('div')
    host.innerHTML = html
    expect(host.querySelectorAll('.bgm-dp-ribbon-card')).toHaveLength(RIBBON_BUTTONS.length)
  })

  it('buildConsolePanelHTML：筛选按钮 + 清空/导出', () => {
    const html = buildConsolePanelHTML()
    expect(html).toContain('data-level="all"')
    expect(html).toContain('data-level="ERROR"')
    expect(html).toContain('id="bgm-dp-log-clear"')
    expect(html).toContain('id="bgm-dp-log-export"')
    // 首个筛选按钮（「全部」）默认高亮
    expect(html).toContain('bgm-dp-filter-btn active" data-level="all"')
    expect(html.match(/bgm-dp-filter-btn active/g)).toHaveLength(1)
  })

  it('buildEnvironmentPanelHTML：开发模式显示 WpsInvoke undefined + 警告色', () => {
    const html = buildEnvironmentPanelHTML()
    expect(html).toContain(window.location.href)
    expect(html).toContain('undefined (开发模式)')
    expect(html).toContain('bgm-dp-env-value-warn')
  })

  it('buildEnvironmentPanelHTML：9 项齐全，缺依赖时按「回调缺失=红 / 依赖缺失=黄」分别标注', () => {
    // 9 项的类型探测口径各不相同（`typeof === 'function'` vs `=== undefined` vs 真值），
    // 错一处就会在真机上把「缺依赖」报成「正常」，让排查方向彻底跑偏
    const html = buildEnvironmentPanelHTML()

    const warn = (label: string, text: string): void => {
      const cell = environmentCell(html, label)
      expect(cell.text).toBe(text)
      expect(cell.cls).toContain('bgm-dp-env-value-warn')
    }
    const expectError = (label: string, text: string): void => {
      const cell = environmentCell(html, label)
      expect(cell.text).toBe(text)
      expect(cell.cls).toContain('bgm-dp-env-value-err')
    }

    // 4 个宿主回调缺失 → 红
    expectError('OnAddinLoad', 'undefined')
    expectError('OnAction', 'undefined')
    expectError('GetBangumiImage', 'undefined')
    expectError('GetIncrementalSyncPressed', 'undefined')
    // _ribbonReady 走 `?? false`，缺失时显示 false 而非 undefined
    expectError('Ribbon 就绪 (_ribbonReady)', 'false')
    // 开发模式 / 依赖缺失 → 黄（不是红：这两个在开发服务器上本来就该缺）
    warn('WpsInvoke', 'undefined (开发模式)')
    warn('DOMPurify (window)', 'undefined')
    warn('Zod (window.z)', 'undefined')
    expect(environmentCell(html, '页面 URL').text).toBe(window.location.href)
  })

  it('buildEnvironmentPanelHTML：宿主可用时 9 项全部为就绪色', () => {
    setWin('WpsInvoke', noop)
    setWin('_ribbonReady', true)
    setWin('OnAddinLoad', noop)
    setWin('OnAction', () => true)
    setWin('GetBangumiImage', () => 'x')
    setWin('GetIncrementalSyncPressed', noop)
    setWin('DOMPurify', {})
    setWin('z', {})
    const html = buildEnvironmentPanelHTML()

    for (const label of [
      'WpsInvoke',
      'Ribbon 就绪 (_ribbonReady)',
      'OnAddinLoad',
      'OnAction',
      'GetBangumiImage',
      'GetIncrementalSyncPressed',
      'DOMPurify (window)',
      'Zod (window.z)',
    ]) {
      expect(environmentCell(html, label).cls).toContain('bgm-dp-env-value-ok')
    }
    expect(environmentCell(html, 'WpsInvoke').text).toBe('available')
    // 值一律走 `typeof` 输出，不是真值转换
    expect(environmentCell(html, 'OnAction').text).toBe('function')
    expect(environmentCell(html, 'Zod (window.z)').text).toBe('object')
    expect(html).toContain('id="bgm-dp-export-report"')
  })
})
