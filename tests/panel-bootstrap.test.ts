// @vitest-environment jsdom
/**
 * @fileoverview 四个页面启动脚本（`panel-bootstrap` / `settings-bootstrap` /
 * `enrich-bootstrap` / `clean-bootstrap`）的单元测试。
 *
 * 这四个文件是**导入即执行**的顶层脚本：没有导出、靠模块求值时的副作用工作。因此
 * 每条用例都 `vi.resetModules()` 后重新 `import()`，用「按钮状态 / 调用了大盘初始化 /
 * console 输出」这些**外部可观察量**断言，而不是断言内部变量。
 *
 * 四个脚本只用到被导入模块的**具名导出**（`installModalA11y` / `initializeShellNav` / …）或
 * 纯副作用（`import '../ui/dialog.js'`）。测试把两类一起接管：副作用模块 mock 成空对象
 * （否则会拖进整张真实依赖图，barrel 循环还会静默回退真实现），具名导出换成 spy。
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
 *    因此三个脚本的分支覆盖率停在 61~77% 是被有意接受的 —— 不是漏测。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ========== 依赖替身 ==========

const stubs = vi.hoisted(() => ({
  initializeTheme: vi.fn<() => void>(),
  startThemeSync: vi.fn<() => void>(),
  startNavModeSync: vi.fn<() => void>(),
  initializeShellNav: vi.fn<() => void>(),
  startNavOrderSync: vi.fn<(page: string) => void>(),
  startModuleStateSync: vi.fn<(page: string) => void>(),
  installModalA11y: vi.fn<() => void>(),
  initializeEnrichPage: vi.fn<() => void>(),
  initializeCleanPage: vi.fn<() => void>(),
}))

// 纯副作用导入：mock 成空对象，避免拖入真实依赖图
vi.mock('../ts/index.js', () => ({}))
vi.mock('../ts/tools/config.js', () => ({}))
vi.mock('../ts/tools/util/index.js', () => ({}))
vi.mock('../ts/core/token-payload.js', () => ({}))
vi.mock('../ts/tools/events.js', () => ({}))
vi.mock('../ts/core/result.js', () => ({}))
vi.mock('../ts/tools/wps.js', () => ({}))
vi.mock('../ts/tools/http.js', () => ({}))
vi.mock('../ts/ui/dialog.js', () => ({}))
vi.mock('../ts/ui/message.js', () => ({}))
vi.mock('../ts/ui/preview.js', () => ({}))
vi.mock('../ts/sync/sync-record.js', () => ({}))
vi.mock('../ts/sync/scraping.js', () => ({}))
vi.mock('../ts/sync/exceltobangumi.js', () => ({}))
vi.mock('../ts/entry/panel-entry.js', () => ({}))
vi.mock('../ts/entry/settings-entry.js', () => ({}))

// 具有名导出的模块：换成 spy
vi.mock('../ts/tools/theme.js', () => ({
  initializeTheme: stubs.initializeTheme,
  startThemeSync: stubs.startThemeSync,
}))
vi.mock('../ts/tools/nav-mode.js', () => ({ startNavModeSync: stubs.startNavModeSync }))
vi.mock('../ts/tools/module-state.js', () => ({
  startModuleStateSync: stubs.startModuleStateSync,
}))
vi.mock('../ts/tools/nav-order.js', () => ({ startNavOrderSync: stubs.startNavOrderSync }))
vi.mock('../ts/panel/shell-nav.js', () => ({ initializeShellNav: stubs.initializeShellNav }))
vi.mock('../ts/panel/enrich-page.js', () => ({ initializeEnrichPage: stubs.initializeEnrichPage }))
vi.mock('../ts/panel/clean-page.js', () => ({ initializeCleanPage: stubs.initializeCleanPage }))
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

  // 用例可能把它改成 'loading'，jsdom 不会自己复位
  Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true })
})

// ========== panel-bootstrap ==========

describe('panel-bootstrap', () => {
  it('导入即禁用所有 data-action 按钮', async () => {
    const buttons = mountActionButtons()

    await import('../ts/panel/panel-bootstrap.js')

    expect(buttons.every((button) => button.disabled)).toBe(true)
  })

  it('收到 bgm:modulesReady → 启用按钮并打印启动日志', async () => {
    const buttons = mountActionButtons()
    await import('../ts/panel/panel-bootstrap.js')
    consoleMocks.log.mockClear()

    signalModulesReady()

    expect(buttons.every((button) => !button.disabled)).toBe(true)
    expect(hasConsoleOutput('log', '[BGM] 模块加载完成，按钮已启用')).toBe(true)
  })

  it('启动外壳导航与跨页同步，页标识为 panel', async () => {
    await import('../ts/panel/panel-bootstrap.js')

    expect(stubs.initializeShellNav).toHaveBeenCalledTimes(1)
    expect(stubs.startNavOrderSync).toHaveBeenCalledWith('panel')
    expect(stubs.startModuleStateSync).toHaveBeenCalledWith('panel')
    expect(stubs.installModalA11y).toHaveBeenCalledTimes(1)
  })

  it('SCRIPT 资源加载失败 → 输出带 src 的错误', async () => {
    await import('../ts/panel/panel-bootstrap.js')
    consoleMocks.error.mockClear()
    const script = document.createElement('script')
    script.src = 'https://cdn.example.com/main.js'

    dispatchWindowEvent('error', script)

    expect(hasConsoleOutput('error', '[BGM] Resource load failed')).toBe(true)
    expect(hasConsoleOutput('error', 'main.js', 1)).toBe(true)
  })

  it('LINK 资源加载失败 → 输出带 href 的错误', async () => {
    await import('../ts/panel/panel-bootstrap.js')
    consoleMocks.error.mockClear()
    const link = document.createElement('link')
    link.href = 'https://cdn.example.com/theme.css'

    dispatchWindowEvent('error', link)

    expect(hasConsoleOutput('error', 'theme.css', 1)).toBe(true)
  })

  it('非 SCRIPT/LINK 的加载失败 → 不输出（避免噪音）', async () => {
    await import('../ts/panel/panel-bootstrap.js')
    consoleMocks.error.mockClear()
    const image = document.createElement('img')

    dispatchWindowEvent('error', image)

    expect(consoleMocks.error).not.toHaveBeenCalled()
  })

  it('未捕获的 Promise 拒绝 → 输出 reason', async () => {
    await import('../ts/panel/panel-bootstrap.js')
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

    expect(stubs.initializeTheme).toHaveBeenCalledTimes(1)
    expect(stubs.startThemeSync).toHaveBeenCalledTimes(1)
    expect(stubs.startNavModeSync).toHaveBeenCalledTimes(1)
    expect(stubs.initializeShellNav).toHaveBeenCalledTimes(1)
    expect(stubs.startNavOrderSync).toHaveBeenCalledWith('enrich')
    expect(stubs.startModuleStateSync).toHaveBeenCalledWith('enrich')
    expect(stubs.installModalA11y).toHaveBeenCalledTimes(1)
  })

  it('document 已就绪 → 立即初始化富化页', async () => {
    await import('../ts/panel/enrich-bootstrap.js')

    expect(stubs.initializeEnrichPage).toHaveBeenCalledTimes(1)
  })

  it('document 仍在加载 → 等 DOMContentLoaded 再初始化', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })

    await import('../ts/panel/enrich-bootstrap.js')
    expect(stubs.initializeEnrichPage).not.toHaveBeenCalled()

    document.dispatchEvent(new Event('DOMContentLoaded'))
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

  it('document 已就绪 → 立即初始化清理页并启动三个跨页同步（页标识 clean）', async () => {
    await import('../ts/panel/clean-bootstrap.js')

    expect(stubs.initializeCleanPage).toHaveBeenCalledTimes(1)
    expect(stubs.startNavModeSync).toHaveBeenCalledTimes(1)
    expect(stubs.startNavOrderSync).toHaveBeenCalledWith('clean')
    expect(stubs.startModuleStateSync).toHaveBeenCalledWith('clean')
  })

  it('document 仍在加载 → 等 DOMContentLoaded 再初始化', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true })

    await import('../ts/panel/clean-bootstrap.js')
    expect(stubs.initializeCleanPage).not.toHaveBeenCalled()

    document.dispatchEvent(new Event('DOMContentLoaded'))
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
