// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getNavOrder,
  setNavOrder,
  resetNavOrder,
  moveModuleBy,
  moveModuleTo,
  applyNavOrder,
  notifyNavOrderChanged,
  startNavOrderSync,
  PAGE_MODULES,
  ORDERABLE_PAGES,
  PAGE_LABELS,
} from '../ts/tools/nav-order.js'
import { CONFIG_KEYS } from '../ts/tools/config.js'

/**
 * mock 的配置存储与实现。
 * `vi.mock` 会被提升到 import 之前，因此工厂内不能引用模块级变量 ——
 * 用 `vi.hoisted` 把存储与实现一并提升。
 */
const { configStore, mockGetConfig, mockSetConfig } = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    configStore: store,
    mockGetConfig: (key: string, fallback = ''): string => store.get(key) ?? fallback,
    mockSetConfig: (key: string, value: string): boolean => {
      store.set(key, value)
      return true
    },
  }
})

vi.mock('../ts/tools/config.js', () => ({
  CONFIG_KEYS: { NAV_ORDER: 'bgm_nav_order', LOG_LEVEL: 'bgm_log_level' },
  getConfig: mockGetConfig,
  setConfig: mockSetConfig,
}))

/** 直接写入 mock 的存储，模拟「另一任务窗格改了配置」 */
function writeRaw(value: string): void {
  configStore.set(CONFIG_KEYS.NAV_ORDER, value)
}

/** 按字典序排序字符串数组（不依赖 lib 是否声明 toSorted） */
function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b))
}

/** 建一个最小 panel 结构：main.main-grid + 一个通栏 command-center */
function buildPanelDom(): void {
  document.body.innerHTML = `
      <aside><nav class="nav">
        <a href="#sec-command">1</a>
        <a href="#sec-account">2</a>
        <a href="#sec-scope">3</a>
      </nav></aside>
      <main class="main main-grid">
        <section class="command-center" id="sec-command">cmd</section>
        <section class="section" id="sec-account">a</section>
        <section class="section" id="sec-scope">b</section>
      </main>`
}

/** 读取 main 下直接子元素的 id 顺序 */
function mainChildIds(): string[] {
  return [...document.querySelectorAll('main.main > *')].map((element) => element.id)
}

beforeEach(() => {
  configStore.clear()
  document.body.replaceChildren()
  document.body.dataset.page = 'panel'
})

describe('nav-order 读取与自愈', () => {
  it('未设置时返回注册表默认顺序', () => {
    expect(getNavOrder('panel')).toEqual((PAGE_MODULES.panel ?? []).map((m) => m.id))
  })

  it('未知页面返回空数组', () => {
    expect(getNavOrder('not-a-page')).toEqual([])
  })

  it('存储中的已知项按存储顺序返回', () => {
    writeRaw(JSON.stringify({ panel: ['sec-preview', 'sec-command'] }))
    const order = getNavOrder('panel')
    expect(order.slice(0, 2)).toEqual(['sec-preview', 'sec-command'])
  })

  it('自愈：丢弃已下线模块，并把注册表新增模块补到末尾', () => {
    writeRaw(JSON.stringify({ panel: ['sec-gone', 'sec-preview'] }))
    const order = getNavOrder('panel')
    expect(order).not.toContain('sec-gone')
    expect(order[0]).toBe('sec-preview')
    // 结果始终是注册表的完整集合（无重复、无缺失）
    const expected = sorted((PAGE_MODULES.panel ?? []).map((module) => module.id))
    expect(sorted(order)).toEqual(expected)
  })

  it('损坏的 JSON 回落到默认顺序且不抛错', () => {
    writeRaw('{不是 JSON')
    expect(getNavOrder('panel')).toEqual((PAGE_MODULES.panel ?? []).map((m) => m.id))
  })

  it('存储为数组（非对象）时回落到默认顺序', () => {
    writeRaw(JSON.stringify(['a', 'b']))
    expect(getNavOrder('panel')).toEqual((PAGE_MODULES.panel ?? []).map((m) => m.id))
  })

  it('去重：存储中重复的 id 只保留一次', () => {
    writeRaw(JSON.stringify({ panel: ['sec-preview', 'sec-preview'] }))
    const order = getNavOrder('panel')
    expect(order.filter((id) => id === 'sec-preview')).toHaveLength(1)
  })
})

describe('nav-order 写入', () => {
  it('setNavOrder 自动补全缺失模块', () => {
    expect(setNavOrder('panel', ['sec-help'])).toBe(true)
    const order = getNavOrder('panel')
    expect(order[0]).toBe('sec-help')
    expect(order).toHaveLength((PAGE_MODULES.panel ?? []).length)
  })

  it('setNavOrder 拒绝未知模块 id', () => {
    setNavOrder('panel', ['sec-nope', 'sec-preview'])
    const order = getNavOrder('panel')
    expect(order).not.toContain('sec-nope')
    expect(order[0]).toBe('sec-preview')
  })

  it('setNavOrder 对未知页面返回 false', () => {
    expect(setNavOrder('not-a-page', ['a'])).toBe(false)
  })

  it('resetNavOrder 删除该页存储项后回到默认顺序', () => {
    setNavOrder('panel', ['sec-help'])
    expect(getNavOrder('panel')[0]).toBe('sec-help')
    expect(resetNavOrder('panel')).toBe(true)
    expect(getNavOrder('panel')).toEqual((PAGE_MODULES.panel ?? []).map((m) => m.id))
  })

  it('resetNavOrder 对未设置过的页面是幂等成功', () => {
    expect(resetNavOrder('panel')).toBe(true)
  })

  it('重置一页不影响另一页', () => {
    setNavOrder('panel', ['sec-help'])
    setNavOrder('enrich', ['sec-tips'])
    resetNavOrder('panel')
    expect(getNavOrder('enrich')[0]).toBe('sec-tips')
  })
})

describe('nav-order 移动', () => {
  it('moveModuleBy 上移一位', () => {
    const before = getNavOrder('panel')
    const target = before[2] ?? ''
    moveModuleBy('panel', target, -1)
    expect(getNavOrder('panel')[1]).toBe(target)
  })

  it('moveModuleBy 首项上移无变化但返回 true', () => {
    const first = getNavOrder('panel')[0] ?? ''
    expect(moveModuleBy('panel', first, -1)).toBe(true)
    expect(getNavOrder('panel')[0]).toBe(first)
  })

  it('moveModuleBy 未找到模块返回 false', () => {
    expect(moveModuleBy('panel', 'sec-nope', 1)).toBe(false)
  })

  it('moveModuleTo 目标下标超界时夹取到末尾', () => {
    const before = getNavOrder('panel')
    const target = before[0] ?? ''
    moveModuleTo('panel', target, 999)
    expect(getNavOrder('panel').at(-1)).toBe(target)
  })

  it('moveModuleTo 负下标夹取到首位', () => {
    const before = getNavOrder('panel')
    const target = before.at(-1) ?? ''
    moveModuleTo('panel', target, -5)
    expect(getNavOrder('panel')[0]).toBe(target)
  })
})

describe('applyNavOrder 就地重排 DOM', () => {
  it('按配置重排主区子元素顺序', () => {
    buildPanelDom()
    setNavOrder('panel', ['sec-scope', 'sec-command', 'sec-account'])
    applyNavOrder('panel')
    const ids = mainChildIds()
    expect(ids.indexOf('sec-scope')).toBeLessThan(ids.indexOf('sec-account'))
  })

  it('侧栏锚点顺序同步重排，与主区一致', () => {
    buildPanelDom()
    setNavOrder('panel', ['sec-scope', 'sec-account', 'sec-command'])
    applyNavOrder('panel')
    const hrefs = [...document.querySelectorAll('.nav a')].map((anchor) =>
      (anchor.getAttribute('href') ?? '').slice(1),
    )
    expect(hrefs).toEqual(['sec-scope', 'sec-account', 'sec-command'])
  })

  it('回归：通栏 command-center 被排到中段时仍须置首行（style.order 最小）', () => {
    buildPanelDom()
    // 故意把通栏项排到中间 —— 修复前它会被排到中段并挤掉上方自动项
    setNavOrder('panel', ['sec-account', 'sec-command', 'sec-scope'])
    applyNavOrder('panel')
    const commandElement = document.getElementById('sec-command')!
    // 通栏项 order 必须小于所有非通栏项，否则栅格会把自动项挤到它下方形成空洞
    const others = [...document.querySelectorAll<HTMLElement>('main.main > *')]
      .filter((element) => element.id !== 'sec-command')
      .map((element) => Number(element.style.order))
    expect(Number(commandElement.style.order)).toBeLessThan(Math.min(...others))
  })

  it('非栅格页面（enrich/clean 的 main.main）不写入 order 样式', () => {
    document.body.innerHTML = `
      <main class="main">
        <section class="section" id="sec-file">f</section>
        <section class="section" id="sec-target">t</section>
      </main>`
    setNavOrder('enrich', ['sec-target', 'sec-file'])
    applyNavOrder('enrich')
    expect(mainChildIds()).toEqual(['sec-target', 'sec-file'])
    for (const element of document.querySelectorAll<HTMLElement>('main.main > *')) {
      expect(element.style.order).toBe('')
    }
  })

  it('页面无 data-page 且未传参时静默返回', () => {
    delete document.body.dataset.page
    expect(() => {
      applyNavOrder()
    }).not.toThrow()
  })
})

describe('nav-order 页面注册表', () => {
  it('五个页面全部登记：panel / enrich / clean / highlight / settings', () => {
    expect([...ORDERABLE_PAGES].sort((a, b) => a.localeCompare(b))).toEqual([
      'clean',
      'enrich',
      'highlight',
      'panel',
      'settings',
    ])
  })

  it('PAGE_MODULES 与 ORDERABLE_PAGES 键集合一致', () => {
    expect(Object.keys(PAGE_MODULES).sort((a, b) => a.localeCompare(b))).toEqual(
      [...ORDERABLE_PAGES].sort((a, b) => a.localeCompare(b)),
    )
  })

  it('每个可排序页面都有中文名', () => {
    for (const page of ORDERABLE_PAGES) {
      expect(PAGE_LABELS[page]).toBeTruthy()
    }
  })

  it('settings 页登记了 9 个模块（含数据导出），且每个都能读到默认顺序', () => {
    expect(PAGE_MODULES.settings).toHaveLength(9)
    expect(getNavOrder('settings')).toHaveLength(9)
    expect(PAGE_MODULES.settings?.map((module) => module.id)).toContain('sec-export')
  })

  it('每个页面的模块 id 无重复', () => {
    for (const page of ORDERABLE_PAGES) {
      const ids = (PAGE_MODULES[page] ?? []).map((module) => module.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('startNavOrderSync 跨页同步', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('启动时先应用一次，配置变化后轮询重排', () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <main class="main">
        <section id="sec-file">f</section>
        <section id="sec-target">t</section>
      </main>`
    setNavOrder('enrich', ['sec-target', 'sec-file'])
    startNavOrderSync('enrich')
    expect(mainChildIds()).toEqual(['sec-target', 'sec-file'])
    // 模拟另一窗格把顺序改成「文件在前」
    writeRaw(JSON.stringify({ enrich: ['sec-file', 'sec-target'] }))
    vi.advanceTimersByTime(2000)
    expect(mainChildIds()).toEqual(['sec-file', 'sec-target'])
  })

  it('轮询中配置未变化时不重排（幂等）', () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <main class="main">
        <section id="sec-file">f</section>
        <section id="sec-target">t</section>
      </main>`
    startNavOrderSync('enrich')
    const before = mainChildIds()
    vi.advanceTimersByTime(6000)
    expect(mainChildIds()).toEqual(before)
  })

  it('容错：轮询读取异常不抛出', () => {
    vi.useFakeTimers()
    startNavOrderSync('panel')
    const original = configStore.get.bind(configStore)
    const spy = vi.spyOn(configStore, 'get').mockImplementationOnce(() => {
      throw new Error('read fail')
    })
    expect(() => {
      vi.advanceTimersByTime(2000)
    }).not.toThrow()
    spy.mockImplementation(original)
  })

  it('自适应：命中变化后切换为加密轮询（300ms 即再次检查）', () => {
    vi.useFakeTimers()
    document.body.innerHTML = `
      <main class="main">
        <section id="sec-file">f</section>
        <section id="sec-target">t</section>
      </main>`
    startNavOrderSync('enrich')
    // 空闲态：2s 才检查一次
    writeRaw(JSON.stringify({ enrich: ['sec-target', 'sec-file'] }))
    vi.advanceTimersByTime(1999)
    expect(mainChildIds()).toEqual(['sec-file', 'sec-target'])
    vi.advanceTimersByTime(1)
    expect(mainChildIds()).toEqual(['sec-target', 'sec-file'])
    // 命中变化后进入活跃窗口：再改一次只需 300ms 就被跟进
    writeRaw(JSON.stringify({ enrich: ['sec-file', 'sec-target'] }))
    vi.advanceTimersByTime(300)
    expect(mainChildIds()).toEqual(['sec-file', 'sec-target'])
  })

  it('页面卸载（beforeunload）时清除轮询定时器', () => {
    vi.useFakeTimers()
    startNavOrderSync('enrich')
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    window.dispatchEvent(new Event('beforeunload'))
    expect(vi.getTimerCount()).toBe(0)
    // 清理后不再有新的轮询被排入
    vi.advanceTimersByTime(60_000)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('notifyNavOrderChanged（本页即时重排）', () => {
  it('调用后立即重排，无需等待轮询', () => {
    document.body.innerHTML = `
      <main class="main">
        <section id="sec-file">f</section>
        <section id="sec-target">t</section>
      </main>`
    setNavOrder('enrich', ['sec-target', 'sec-file'])
    // 未启动任何同步，直接通知 —— 应同步生效
    notifyNavOrderChanged('enrich')
    expect(mainChildIds()).toEqual(['sec-target', 'sec-file'])
  })

  it('对未知页面是安全的空操作', () => {
    document.body.innerHTML = '<main class="main"></main>'
    expect(() => {
      notifyNavOrderChanged('nope')
    }).not.toThrow()
  })
})
