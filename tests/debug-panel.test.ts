/**
 * @fileoverview `ts/entry/debug-panel.ts` 自动启动与守卫冒烟（jsdom）
 *
 * ## 这个文件守的是什么
 *
 * `debug-panel.ts` 是**随生产包发布**的代码：`index.html` 末尾有
 * `<script type="module" src="./dist-ts/entry/debug-panel.js">`，WPS 启动时会加载它。
 * 它之所以没在用户面前出现，全靠 `initDebugPanel()` 开头那条
 * `if (!isDebugEnvironment()) return`（即 `window.WpsInvoke === undefined`）。
 *
 * 所以它唯一真正重要的行为就是**那条守卫**：写错就会在用户的 Excel 任务窗格里
 * 糊上一个 420px 的调试面板。本文件钉住三条契约：
 *
 *  1. **生产 inert** —— 宿主在场时导入 / 调用都不得产生任何 DOM 副作用；
 *  2. **幂等** —— 重复调用不重复插样式、不覆盖已存在的面板；
 *  3. **启动时机** —— `readyState === 'loading'` 时推迟到 `DOMContentLoaded`，
 *     否则导入即初始化。
 *
 * 面板内部的日志轮询、按钮交互属于开发期工具（且生产 inert），不在冒烟范围内。
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RIBBON_BUTTONS } from '../ts/entry/debug-panel-render.js'

type DebugPanelModule = typeof import('../ts/entry/debug-panel.js')

/** window 的单点写入口（避免 casts 散布到每个用例） */
const host = window as unknown as Record<string, unknown>

/**
 * 导入模块体，同时让**模块级自动启动**空转：宿主在场时 `initDebugPanel()` 会立即
 * return，于是用例可以自己控制「什么时候、在什么宿主状态下」显式调用它。
 */
async function importIdle(): Promise<DebugPanelModule> {
  host.WpsInvoke = { name: 'wps' }
  vi.resetModules()
  return await import('../ts/entry/debug-panel.js')
}

/** 面板是否已建出来 */
function panelRoot(): HTMLElement | null {
  return document.getElementById('bgm-debug-panel-root')
}

/** 面板注入的样式表（只认含 `.bgm-dp-root` 的那张，避开环境自带的 style） */
function panelStyles(): HTMLStyleElement[] {
  return [...document.head.querySelectorAll<HTMLStyleElement>('style')].filter((style) =>
    style.innerHTML.includes('.bgm-dp-root'),
  )
}

beforeEach(() => {
  // 面板会挂 500ms 的延迟刷新和 3s 的状态轮询；不冻结定时器就会在用例之间互相串
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  document.body.replaceChildren()
  for (const style of panelStyles()) style.remove()
  delete host.WpsInvoke
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  delete host.WpsInvoke
  delete (document as unknown as Record<string, unknown>).readyState
})

describe('debug-panel / 生产守卫', () => {
  it('宿主在场时导入不产生任何 DOM 副作用（生产 inert）', async () => {
    await importIdle()

    expect(panelRoot()).toBeNull()
    expect(panelStyles()).toHaveLength(0)
    expect(document.body.querySelector('.bgm-dp-fab')).toBeNull()
  })

  it('宿主在场时显式调用 initDebugPanel() 也直接返回', async () => {
    const entry = await importIdle()

    entry.initDebugPanel()

    expect(panelRoot()).toBeNull()
    expect(panelStyles()).toHaveLength(0)
  })
})

describe('debug-panel / 开发环境初始化', () => {
  it('无宿主时建出面板骨架：样式 + 根节点 + 折叠按钮 + 四个面板', async () => {
    const entry = await importIdle()
    delete host.WpsInvoke

    entry.initDebugPanel()

    const root = panelRoot()
    expect(root?.className).toBe('bgm-dp-root')
    expect(panelStyles()).toHaveLength(1)
    expect(document.body.querySelector('.bgm-dp-fab')).not.toBeNull()
    // 渲染层确实被接进来了：4 个 Tab、4 个面板、与常量一一对应的 Ribbon 卡片
    expect(root?.querySelectorAll('.bgm-dp-tab')).toHaveLength(4)
    expect(root?.querySelectorAll('.bgm-dp-panel')).toHaveLength(4)
    expect(root?.querySelectorAll('.bgm-dp-ribbon-card')).toHaveLength(RIBBON_BUTTONS.length)
  })

  it('重复调用幂等：不重复插样式、不重复建根节点', async () => {
    const entry = await importIdle()
    delete host.WpsInvoke

    entry.initDebugPanel()
    entry.initDebugPanel()

    expect(document.querySelectorAll('.bgm-dp-root')).toHaveLength(1)
    expect(panelStyles()).toHaveLength(1)
  })

  it('已有根节点时直接返回，不覆盖既有面板', async () => {
    const entry = await importIdle()
    const existing = document.createElement('div')
    existing.id = 'bgm-debug-panel-root'
    existing.textContent = '既有面板'
    document.body.append(existing)
    delete host.WpsInvoke

    entry.initDebugPanel()

    expect(panelStyles()).toHaveLength(0)
    expect(panelRoot()?.textContent).toBe('既有面板')
  })
})

describe('debug-panel / 自动启动时机', () => {
  it('readyState 非 loading 时导入即初始化', async () => {
    vi.resetModules()

    await import('../ts/entry/debug-panel.js')

    expect(panelRoot()).not.toBeNull()
  })

  it('readyState === loading 时推迟到 DOMContentLoaded 之后才建面板', async () => {
    // jsdom 的 readyState 是原型 getter，用自有属性盖掉；finally 里删掉即恢复
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })
    try {
      vi.resetModules()

      await import('../ts/entry/debug-panel.js')

      expect(panelRoot()).toBeNull()

      document.dispatchEvent(new Event('DOMContentLoaded'))

      expect(panelRoot()).not.toBeNull()
    } finally {
      delete (document as unknown as Record<string, unknown>).readyState
    }
  })
})
