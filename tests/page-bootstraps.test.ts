// @vitest-environment jsdom
/**
 * @fileoverview 七个页面启动脚本（`sync-panel` / `settings` / `enrich` / `clean` /
 * `highlight` / `conditional-format` / `donate` 的 `*-bootstrap.ts`）的单元测试。
 *
 * 这些文件是**导入即执行**的顶层脚本：没有导出、靠模块求值时的副作用工作。因此
 * 每条用例都 `vi.resetModules()` 后重新 `import()`，用「按钮状态 / 调用了大盘初始化 /
 * console 输出」这些**外部可观察量**断言，而不是断言内部变量。
 *
 * 脚本只用到被导入模块的**具名导出**（`installModalA11y` / `initializeShellNav` / …）或
 * 纯副作用（`import '../ui/dialog.js'`）。测试把两类一起接管：副作用模块 mock 成空对象
 * （否则会拖进整张真实依赖图，barrel 循环还会静默回退真实现），具名导出换成 spy。
 * **`com-ready` 故意不 mock**：闸门本身就是被测对象的一部分（「闸门没开时一个分片都不
 * 跑」只有用真实现才测得出来），用例靠 `drainComGate()` 推进时钟开闸。
 *
 * ## 三条让本文件稳定的做法（都是踩过的坑）
 *
 * 1. **`vi.clearAllTimers()` 必须留在 `beforeEach`**：`settings-bootstrap` 的 5 秒兜底
 *    定时器会随历史实例累积，不清理就会在下一条用例推进时钟时替「本该超时」的实例
 *    把按钮启用，断言直接反向。
 * 2. **`document.readyState` 要显式复位成 `'complete'`**：用例把它改成 `'loading'` 驱动
 *    DOMContentLoaded 分支后，jsdom 不会自己改回来。
 * 3. **`bgm:modulesReady` 监听器跨用例累积**（挂在 document 上，清 body 清不掉）。
 *    所有实例的 handler 都只操作当前 DOM，故断言一律用 `.some(...)` / 状态而非精确调用次数。
 * 4. **刻意不追 `typeof window/document !== 'undefined'` 保护的另一侧**：那半边只在
 *    无宿主环境（node）可达，而这些脚本的意义正在于「有宿主时装配页面」。另建一个
 *    node 环境的文件只为点亮 SSR 保护分支，收益是 0 行覆盖（lines 已 100%），
 *    因此七个脚本的分支覆盖率停在 50~82% 是被有意接受的 —— 不是漏测。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ========== 依赖替身 ==========

const stubs = vi.hoisted(() => ({
  initializeTheme: vi.fn<() => void>(),
  initializeI18n: vi.fn<() => void>(),
  startThemeSync: vi.fn<() => void>(),
  startNavModeSync: vi.fn<() => void>(),
  initializeShellNav: vi.fn<() => void>(),
  startNavOrderSync: vi.fn<(page: string) => void>(),
  startModuleStateSync: vi.fn<(page: string) => void>(),
  installModalA11y: vi.fn<() => void>(),
  initializeEnrichPage: vi.fn<() => void>(),
  initializeCleanPage: vi.fn<() => void>(),
  // ---- highlight / conditional-format / donate ----
  // 心跳与分片都是**跨进程副作用**，这里换成 spy：断言「哪个页面起了心跳」「分片按什么
  // 顺序跑」比断言 DOM 更直接。`ComPhase` 结构只有 name/run 两个字段，内联声明即可
  // （vi.hoisted 在 import 之前执行，拿不到类型导入）。
  startPaneHeartbeat: vi.fn<(page: string) => void>(),
  createHighlightPagePhases: vi.fn<() => { name: string; run: () => void }[]>(),
  initializeConditionalFormatPage: vi.fn<() => void>(),
  copyTextWithResult: vi.fn<(text: string) => { ok: boolean }>(),
  markDonatePaneLoaded: vi.fn<() => void>(),
  showToast: vi.fn<(message: string, type?: string) => void>(),
  phaseConfig: vi.fn<() => void>(),
  phaseWiring: vi.fn<() => void>(),
  phaseExtra: vi.fn<() => void>(),
}))

// 纯副作用导入：mock 成空对象，避免拖入真实依赖图
vi.mock('../ts/index.js', () => ({}))
vi.mock('../ts/tools/config.js', () => ({}))
// 目录工具在这里只有副作用 + 两个具名导出（赞赏页复制联系方式 / 标记页面已加载）
vi.mock('../ts/tools/util/index.js', () => ({
  copyTextWithResult: stubs.copyTextWithResult,
  markDonatePaneLoaded: stubs.markDonatePaneLoaded,
}))
vi.mock('../ts/core/token-payload.js', () => ({}))
vi.mock('../ts/tools/events.js', () => ({}))
vi.mock('../ts/core/result.js', () => ({}))
vi.mock('../ts/tools/wps.js', () => ({}))
vi.mock('../ts/tools/http.js', () => ({}))
vi.mock('../ts/ui/dialog.js', () => ({ showToast: stubs.showToast }))
vi.mock('../ts/ui/message.js', () => ({}))
vi.mock('../ts/ui/preview.js', () => ({}))
vi.mock('../ts/sync/sync-record.js', () => ({}))
vi.mock('../ts/sync/scraping.js', () => ({}))
vi.mock('../ts/sync/exceltobangumi/index.js', () => ({}))
vi.mock('../ts/entry/sync-panel-entry.js', () => ({}))
vi.mock('../ts/entry/settings-entry.js', () => ({}))
// 心跳是周期性 COM：换 spy，才能断言「哪个页面起了心跳」
vi.mock('../ts/tools/pane-alive.js', () => ({ startPaneHeartbeat: stubs.startPaneHeartbeat }))

// 具有名导出的模块：换成 spy
vi.mock('../ts/tools/theme.js', () => ({
  initializeTheme: stubs.initializeTheme,
  startThemeSync: stubs.startThemeSync,
}))
// 语言初始化也是装配层职责：这里只钉「有没有调」，翻译行为在 tests/i18n.test.ts
vi.mock('../ts/i18n/locale-store.js', () => ({
  // 赞赏页的复制提示走 t()：回显 key，断言「用了哪个 key」比断言中文原文更防回归
  t: (key: string) => `[${key}]`,
}))
vi.mock('../ts/i18n/runtime.js', () => ({
  initializeI18n: stubs.initializeI18n,
}))
vi.mock('../ts/tools/nav-mode.js', () => ({ startNavModeSync: stubs.startNavModeSync }))
vi.mock('../ts/tools/module-state.js', () => ({
  startModuleStateSync: stubs.startModuleStateSync,
}))
vi.mock('../ts/tools/nav-order.js', () => ({ startNavOrderSync: stubs.startNavOrderSync }))
vi.mock('../ts/panel/shell-nav.js', () => ({ initializeShellNav: stubs.initializeShellNav }))
vi.mock('../ts/panel/enrich-page.js', () => ({ initializeEnrichPage: stubs.initializeEnrichPage }))
vi.mock('../ts/panel/clean-page.js', () => ({ initializeCleanPage: stubs.initializeCleanPage }))
// 高亮页的分片由 bootstrap 组装：mock 成可控数组，才能测「分片顺序」与「越界兜底」
vi.mock('../ts/panel/highlight-page.js', () => ({
  createHighlightPagePhases: stubs.createHighlightPagePhases,
}))
vi.mock('../ts/panel/conditional-format-page.js', () => ({
  initializeConditionalFormatPage: stubs.initializeConditionalFormatPage,
}))
vi.mock('../ts/ui/components/modal-a11y.js', () => ({
  installModalA11y: stubs.installModalA11y,
}))

import { clearDom, mountButton } from './helpers/dom.js'

// ========== console 替身 ==========

const consoleMocks = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
}

/** console 输出里是否有某条包含给定片段 */
function hasConsoleOutput(
  channel: keyof typeof consoleMocks,
  fragment: string,
  argumentIndex = 0,
): boolean {
  return consoleMocks[channel].mock.calls.some((call) =>
    String(call[argumentIndex]).includes(fragment),
  )
}

// ========== 工具 ==========

/** 建 N 个带 data-action 的按钮（启动脚本按这个选择器批量禁用 / 启用） */
function mountActionButtons(count = 2): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = []
  for (let index = 0; index < count; index += 1) {
    const button = mountButton(`action-${String(index)}`)
    button.dataset.action = `do-${String(index)}`
    button.disabled = false
    buttons.push(button)
  }
  return buttons
}

/** 派发 window.load（闸门等待的生命周期事件） */
function signalLoad(): void {
  window.dispatchEvent(new Event('load'))
}

/**
 * 推进时钟直到「宿主 COM 就绪闸门」开启并排空分片队列
 *
 * 各 bootstrap 的 COM 初始化现在都过闸门（load → 两帧 → 800ms → 逐片跑），
 * 所以断言「初始化函数被调用」前必须先让闸门开、队列排空。
 */
async function drainComGate(): Promise<void> {
  await vi.advanceTimersByTimeAsync(3000)
}

/** 在 window 上派发一个带自定义 target 的事件（资源加载失败监听靠 target 分辨类型） */
function dispatchWindowEvent(type: string, target: EventTarget): void {
  const event = new Event(type)
  Object.defineProperty(event, 'target', { value: target })
  window.dispatchEvent(event)
}

/** 派发「模块就绪」事件 */
function signalModulesReady(): void {
  document.dispatchEvent(new Event('bgm:modulesReady'))
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllTimers()
  clearDom()

  for (const stub of Object.values(stubs)) stub.mockClear()
  for (const mockInstance of Object.values(consoleMocks)) mockInstance.mockClear()

  // 高亮页正常返回 2 个分片（恢复配置 / 事件接线）；个别用例改成 4、5 个测越界兜底
  stubs.createHighlightPagePhases.mockImplementation(() => [
    { name: '恢复配置', run: stubs.phaseConfig },
    { name: '事件接线', run: stubs.phaseWiring },
  ])
  stubs.copyTextWithResult.mockReturnValue({ ok: true })

  // 用例可能把它改成 'loading'，jsdom 不会自己复位
  Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true })
})

// ========== sync-panel-bootstrap ==========

describe('sync-panel-bootstrap', () => {
  it('导入即禁用所有 data-action 按钮', async () => {
    const buttons = mountActionButtons()

    await import('../ts/panel/sync-panel-bootstrap.js')

    expect(buttons.every((button) => button.disabled)).toBe(true)
  })

  it('收到 bgm:modulesReady → 启用按钮并打印启动日志', async () => {
    const buttons = mountActionButtons()
    await import('../ts/panel/sync-panel-bootstrap.js')
    consoleMocks.log.mockClear()

    signalModulesReady()

    expect(buttons.every((button) => !button.disabled)).toBe(true)
    expect(hasConsoleOutput('log', '[BGM] 模块加载完成，按钮已启用')).toBe(true)
  })

  it('启动外壳导航与跨页同步，页标识为 panel', async () => {
    await import('../ts/panel/sync-panel-bootstrap.js')
    await drainComGate()

    expect(stubs.initializeShellNav).toHaveBeenCalledTimes(1)
    expect(stubs.startNavOrderSync).toHaveBeenCalledWith('sync-panel')
    expect(stubs.startModuleStateSync).toHaveBeenCalledWith('sync-panel')
    expect(stubs.installModalA11y).toHaveBeenCalledTimes(1)
  })

  it('SCRIPT 资源加载失败 → 输出带 src 的错误', async () => {
    await import('../ts/panel/sync-panel-bootstrap.js')
    consoleMocks.error.mockClear()
    const script = document.createElement('script')
    script.src = 'https://cdn.example.com/main.js'

    dispatchWindowEvent('error', script)

    expect(hasConsoleOutput('error', '[BGM] Resource load failed')).toBe(true)
    expect(hasConsoleOutput('error', 'main.js', 1)).toBe(true)
  })

  it('LINK 资源加载失败 → 输出带 href 的错误', async () => {
    await import('../ts/panel/sync-panel-bootstrap.js')
    consoleMocks.error.mockClear()
    const link = document.createElement('link')
    link.href = 'https://cdn.example.com/theme.css'

    dispatchWindowEvent('error', link)

    expect(hasConsoleOutput('error', 'theme.css', 1)).toBe(true)
  })

  it('非 SCRIPT/LINK 的加载失败 → 不输出（避免噪音）', async () => {
    await import('../ts/panel/sync-panel-bootstrap.js')
    consoleMocks.error.mockClear()
    const image = document.createElement('img')

    dispatchWindowEvent('error', image)

    expect(consoleMocks.error).not.toHaveBeenCalled()
  })

  it('未捕获的 Promise 拒绝 → 输出 reason', async () => {
    await import('../ts/panel/sync-panel-bootstrap.js')
    consoleMocks.error.mockClear()
    const event = new Event('unhandledrejection')
    Object.defineProperty(event, 'reason', { value: new Error('boom') })

    window.dispatchEvent(event)

    expect(hasConsoleOutput('error', '[BGM] Unhandled promise rejection')).toBe(true)
  })
})

// ========== settings-bootstrap ==========

describe('settings-bootstrap', () => {
  it('导入即禁用按钮，收到 modulesReady 后启用并打印启动日志', async () => {
    const buttons = mountActionButtons()
    await import('../ts/panel/settings-bootstrap.js')
    expect(buttons.every((button) => button.disabled)).toBe(true)

    consoleMocks.log.mockClear()
    signalModulesReady()

    expect(buttons.every((button) => !button.disabled)).toBe(true)
    expect(hasConsoleOutput('log', '[BGM Settings] 模块加载完成，按钮已启用')).toBe(true)
  })

  it('5 秒内没等到 modulesReady → WARN 并强制启用按钮（兜底）', async () => {
    const buttons = mountActionButtons()
    await import('../ts/panel/settings-bootstrap.js')
    consoleMocks.warn.mockClear()

    vi.advanceTimersByTime(5000)

    expect(buttons.every((button) => !button.disabled)).toBe(true)
    expect(hasConsoleOutput('warn', '[BGM Settings] 5000ms 内未收到 bgm:modulesReady')).toBe(true)
  })

  it('4.9 秒时仍未触发兜底（足额等待）', async () => {
    const buttons = mountActionButtons()
    await import('../ts/panel/settings-bootstrap.js')
    consoleMocks.warn.mockClear()

    vi.advanceTimersByTime(4999)

    expect(buttons.every((button) => button.disabled)).toBe(true)
    expect(consoleMocks.warn).not.toHaveBeenCalled()
  })

  it('收到过 modulesReady → 超时不强制启用也不告警', async () => {
    const buttons = mountActionButtons()
    await import('../ts/panel/settings-bootstrap.js')
    signalModulesReady()

    // 重新禁用，这样「被强制启用」才会留下可观察痕迹
    for (const button of buttons) button.disabled = true
    consoleMocks.warn.mockClear()

    vi.advanceTimersByTime(5000)

    expect(buttons.every((button) => button.disabled)).toBe(true)
    expect(consoleMocks.warn).not.toHaveBeenCalled()
  })

  it('装配模态框无障碍增强', async () => {
    await import('../ts/panel/settings-bootstrap.js')

    expect(stubs.installModalA11y).toHaveBeenCalledTimes(1)
  })

  it('资源加载失败与未捕获拒绝的日志带 Settings 前缀', async () => {
    await import('../ts/panel/settings-bootstrap.js')
    consoleMocks.error.mockClear()
    const script = document.createElement('script')
    script.src = 'https://cdn.example.com/settings.js'
    const rejection = new Event('unhandledrejection')
    Object.defineProperty(rejection, 'reason', { value: 'nope' })

    dispatchWindowEvent('error', script)
    window.dispatchEvent(rejection)

    expect(hasConsoleOutput('error', '[BGM Settings] Resource load failed')).toBe(true)
    expect(hasConsoleOutput('error', '[BGM Settings] Unhandled promise rejection')).toBe(true)
  })
})

// ========== enrich-bootstrap ==========

describe('enrich-bootstrap', () => {
  it('装配主题、跨页同步与导航（页标识 enrich）', async () => {
    await import('../ts/panel/enrich-bootstrap.js')
    await drainComGate()

    expect(stubs.initializeTheme).toHaveBeenCalledTimes(1)
    expect(stubs.initializeI18n).toHaveBeenCalledTimes(1)
    expect(stubs.startThemeSync).toHaveBeenCalledTimes(1)
    expect(stubs.startNavModeSync).toHaveBeenCalledTimes(1)
    expect(stubs.initializeShellNav).toHaveBeenCalledTimes(1)
    expect(stubs.startNavOrderSync).toHaveBeenCalledWith('enrich')
    expect(stubs.startModuleStateSync).toHaveBeenCalledWith('enrich')
    expect(stubs.installModalA11y).toHaveBeenCalledTimes(1)
  })

  it('document 已就绪 → 闸门开启后初始化富化页', async () => {
    await import('../ts/panel/enrich-bootstrap.js')
    await drainComGate()

    expect(stubs.initializeEnrichPage).toHaveBeenCalledTimes(1)
  })

  it('document 仍在加载 → 等 load 事件开闸门后才初始化', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })

    await import('../ts/panel/enrich-bootstrap.js')
    await drainComGate()
    expect(stubs.initializeEnrichPage).not.toHaveBeenCalled()

    signalLoad()
    await drainComGate()
    expect(stubs.initializeEnrichPage).toHaveBeenCalledTimes(1)
  })

  it('按钮禁用 → modulesReady 后启用并打印启动日志', async () => {
    const buttons = mountActionButtons()
    await import('../ts/panel/enrich-bootstrap.js')
    expect(buttons.every((button) => button.disabled)).toBe(true)

    consoleMocks.log.mockClear()
    signalModulesReady()

    expect(buttons.every((button) => !button.disabled)).toBe(true)
    expect(hasConsoleOutput('log', '[BGM Enrich] 模块加载完成，按钮已启用')).toBe(true)
  })
})

// ========== clean-bootstrap ==========

describe('clean-bootstrap', () => {
  it('导入即禁用所有 data-action 按钮', async () => {
    const buttons = mountActionButtons()

    await import('../ts/panel/clean-bootstrap.js')

    expect(buttons.every((button) => button.disabled)).toBe(true)
  })

  it('收到 bgm:modulesReady → 启用按钮并打印启动日志', async () => {
    const buttons = mountActionButtons()
    await import('../ts/panel/clean-bootstrap.js')
    consoleMocks.log.mockClear()

    signalModulesReady()

    expect(buttons.every((button) => !button.disabled)).toBe(true)
    expect(hasConsoleOutput('log', '[BGM Clean] 模块加载完成，按钮已启用')).toBe(true)
  })

  it('document 已就绪 → 闸门开启后初始化清理页并启动三个跨页同步（页标识 clean）', async () => {
    await import('../ts/panel/clean-bootstrap.js')
    await drainComGate()

    expect(stubs.initializeCleanPage).toHaveBeenCalledTimes(1)
    expect(stubs.startNavModeSync).toHaveBeenCalledTimes(1)
    expect(stubs.startNavOrderSync).toHaveBeenCalledWith('clean')
    expect(stubs.startModuleStateSync).toHaveBeenCalledWith('clean')
  })

  it('document 仍在加载 → 等 load 事件开闸门后才初始化', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })

    await import('../ts/panel/clean-bootstrap.js')
    await drainComGate()
    expect(stubs.initializeCleanPage).not.toHaveBeenCalled()

    signalLoad()
    await drainComGate()
    expect(stubs.initializeCleanPage).toHaveBeenCalledTimes(1)
    expect(stubs.startNavOrderSync).toHaveBeenCalledWith('clean')
  })

  it('不装配主题与外壳导航（清理页无对应依赖）', async () => {
    await import('../ts/panel/clean-bootstrap.js')

    expect(stubs.initializeTheme).not.toHaveBeenCalled()
    expect(stubs.initializeShellNav).not.toHaveBeenCalled()
    expect(stubs.installModalA11y).not.toHaveBeenCalled()
  })
})

// ========== highlight-bootstrap ==========

describe('highlight-bootstrap', () => {
  it('导入即禁用 data-action 按钮，modulesReady 后启用并打印 Highlight 前缀日志', async () => {
    const buttons = mountActionButtons()
    await import('../ts/panel/highlight-bootstrap.js')
    expect(buttons.every((button) => button.disabled)).toBe(true)

    consoleMocks.log.mockClear()
    signalModulesReady()

    expect(buttons.every((button) => !button.disabled)).toBe(true)
    expect(hasConsoleOutput('log', '[BGM Highlight] 模块加载完成，按钮已启用')).toBe(true)
  })

  it('页标识为 highlight：外壳导航 + 三个跨页同步 + 心跳', async () => {
    await import('../ts/panel/highlight-bootstrap.js')
    await drainComGate()

    expect(stubs.initializeShellNav).toHaveBeenCalledTimes(1)
    expect(stubs.startNavModeSync).toHaveBeenCalledTimes(1)
    expect(stubs.startNavOrderSync).toHaveBeenCalledWith('highlight')
    expect(stubs.startModuleStateSync).toHaveBeenCalledWith('highlight')
    expect(stubs.startPaneHeartbeat).toHaveBeenCalledWith('highlight')
  })

  it('分片顺序：恢复配置 → 事件接线 → 启动轮询（数据读取绝不自动跑）', async () => {
    await import('../ts/panel/highlight-bootstrap.js')
    await drainComGate()

    expect(stubs.createHighlightPagePhases).toHaveBeenCalledTimes(1)
    const configOrder = stubs.phaseConfig.mock.invocationCallOrder.at(0) ?? -1
    const wiringOrder = stubs.phaseWiring.mock.invocationCallOrder.at(0) ?? -1
    const pollingOrder = stubs.startNavModeSync.mock.invocationCallOrder.at(0) ?? -1
    expect(configOrder).toBeGreaterThan(-1)
    expect(configOrder).toBeLessThan(wiringOrder)
    expect(wiringOrder).toBeLessThan(pollingOrder)
  })

  it('分片多于槽位时多出的不执行（槽位只有 4 个：0/1/轮询/2/3）', async () => {
    stubs.createHighlightPagePhases.mockImplementation(() => [
      { name: '恢复配置', run: stubs.phaseConfig },
      { name: '事件接线', run: stubs.phaseWiring },
      { name: '槽位二', run: stubs.phaseExtra },
      { name: '槽位三', run: stubs.phaseExtra },
      // 第 5 片没有槽位：bootstrap 只取 phases[0..3]
      { name: '越界分片', run: stubs.phaseExtra },
    ])
    await import('../ts/panel/highlight-bootstrap.js')
    await drainComGate()

    expect(stubs.phaseConfig).toHaveBeenCalledTimes(1)
    expect(stubs.phaseWiring).toHaveBeenCalledTimes(1)
    expect(stubs.phaseExtra).toHaveBeenCalledTimes(2)
  })

  it('document 仍在加载 → 闸门不开，分片一个都不跑', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })

    await import('../ts/panel/highlight-bootstrap.js')
    await drainComGate()
    expect(stubs.phaseConfig).not.toHaveBeenCalled()
    expect(stubs.startNavModeSync).not.toHaveBeenCalled()

    signalLoad()
    await drainComGate()
    expect(stubs.phaseConfig).toHaveBeenCalledTimes(1)
    expect(stubs.startPaneHeartbeat).toHaveBeenCalledWith('highlight')
  })
})

// ========== conditional-format-bootstrap ==========

describe('conditional-format-bootstrap', () => {
  it('导入即禁用 data-action 按钮，modulesReady 后启用并打印 ConditionalFormat 前缀日志', async () => {
    const buttons = mountActionButtons()
    await import('../ts/panel/conditional-format-bootstrap.js')
    expect(buttons.every((button) => button.disabled)).toBe(true)

    consoleMocks.log.mockClear()
    signalModulesReady()

    expect(buttons.every((button) => !button.disabled)).toBe(true)
    expect(hasConsoleOutput('log', '[BGM ConditionalFormat] 模块加载完成，按钮已启用')).toBe(true)
  })

  it('闸门开启后初始化页面并启动轮询（页标识 conditionalFormat）', async () => {
    await import('../ts/panel/conditional-format-bootstrap.js')
    await drainComGate()

    expect(stubs.initializeConditionalFormatPage).toHaveBeenCalledTimes(1)
    expect(stubs.startNavModeSync).toHaveBeenCalledTimes(1)
    expect(stubs.startNavOrderSync).toHaveBeenCalledWith('conditional-format')
    expect(stubs.startModuleStateSync).toHaveBeenCalledWith('conditional-format')
    expect(stubs.startPaneHeartbeat).toHaveBeenCalledWith('conditionalFormat')
  })

  it('初始化先于轮询（轮询依赖页面已装配）', async () => {
    await import('../ts/panel/conditional-format-bootstrap.js')
    await drainComGate()

    const initializationOrder =
      stubs.initializeConditionalFormatPage.mock.invocationCallOrder.at(0) ?? -1
    const pollingOrder = stubs.startNavModeSync.mock.invocationCallOrder.at(0) ?? -1
    expect(initializationOrder).toBeGreaterThan(-1)
    expect(initializationOrder).toBeLessThan(pollingOrder)
  })

  it('document 仍在加载 → 等 load 事件开闸门后才初始化', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })

    await import('../ts/panel/conditional-format-bootstrap.js')
    await drainComGate()
    expect(stubs.initializeConditionalFormatPage).not.toHaveBeenCalled()

    signalLoad()
    await drainComGate()
    expect(stubs.initializeConditionalFormatPage).toHaveBeenCalledTimes(1)
  })

  it('不装配外壳导航、主题与模态框增强（条件格式页无侧栏）', async () => {
    await import('../ts/panel/conditional-format-bootstrap.js')

    expect(stubs.initializeShellNav).not.toHaveBeenCalled()
    expect(stubs.initializeTheme).not.toHaveBeenCalled()
    expect(stubs.installModalA11y).not.toHaveBeenCalled()
  })
})

// ========== donate-bootstrap ==========

describe('donate-bootstrap', () => {
  it('点击 [data-copy] → 复制成功弹 success 提示', async () => {
    const button = mountButton('copy-github')
    button.dataset.copy = 'https://github.com/awujiana'

    await import('../ts/panel/donate-bootstrap.js')
    button.click()

    expect(stubs.copyTextWithResult).toHaveBeenCalledWith('https://github.com/awujiana')
    expect(stubs.showToast).toHaveBeenCalledWith('[common.copySuccess]', 'success')
  })

  it('复制失败 → 弹 error 提示引导手动复制', async () => {
    stubs.copyTextWithResult.mockReturnValue({ ok: false })
    const button = mountButton('copy-email')
    button.dataset.copy = 'bingshanlengtie@qq.com'

    await import('../ts/panel/donate-bootstrap.js')
    button.click()

    expect(stubs.showToast).toHaveBeenCalledWith('[common.copyFailedManual]', 'error')
  })

  it('data-copy 为空 → 既不复制也不弹提示（防误报成功）', async () => {
    const button = mountButton('copy-empty')

    await import('../ts/panel/donate-bootstrap.js')
    button.click()

    expect(stubs.copyTextWithResult).not.toHaveBeenCalled()
    expect(stubs.showToast).not.toHaveBeenCalled()
  })

  it('闸门开启后：应用主题 + 初始化语言 + 标记页面已加载 + 起心跳', async () => {
    await import('../ts/panel/donate-bootstrap.js')
    await drainComGate()

    expect(stubs.initializeTheme).toHaveBeenCalledTimes(1)
    expect(stubs.initializeI18n).toHaveBeenCalledTimes(1)
    expect(stubs.markDonatePaneLoaded).toHaveBeenCalledTimes(1)
    expect(stubs.startPaneHeartbeat).toHaveBeenCalledWith('donate')
  })

  it('纯展示页：不装按钮门禁、不装配外壳导航与跨页同步', async () => {
    const buttons = mountActionButtons()

    await import('../ts/panel/donate-bootstrap.js')

    // 没有 data-action 门禁 → 按钮保持可用（赞赏页只有 data-copy）
    expect(buttons.every((button) => !button.disabled)).toBe(true)
    expect(stubs.initializeShellNav).not.toHaveBeenCalled()
    expect(stubs.startNavOrderSync).not.toHaveBeenCalled()
    expect(stubs.startModuleStateSync).not.toHaveBeenCalled()
  })
})
