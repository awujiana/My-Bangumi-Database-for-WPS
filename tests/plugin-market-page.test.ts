// @vitest-environment jsdom
/**
 * @fileoverview `ts/panel/plugin-market-page.ts` 单测
 *
 * 页面层只做「渲染 + 交互编排」，所以断言全部落在**用户看得到、点得动的东西**上：
 * 1. 未签名的清单必须出现风险徽标 + 按钮变「无视风险安装」，且点下去要**二次确认**；
 * 2. 已验证的清单只弹一次安装确认；
 * 3. 更新遇到签名变化时，只有用户在确认框里点「是」才强制更新。
 *
 * DOM 用**内联骨架**（与 `ui/plugin-market.html` 的 id 一一对应）而不是读文件：
 * 本目录测试不允许 `import node:fs`，HTML 的 `data-i18n` 一致性归
 * `scripts/check-i18n-consistency.mjs` 管。
 *
 * 模块内有页面级状态（`state`），故每个用例 `vi.resetModules()` 后动态 import。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstalledPluginRecord, PluginManifest } from '../ts/plugins/plugin-types.js'

const m = vi.hoisted(() => ({
  tOr: vi.fn<
    (key: string, fallback: string, parameters?: Record<string, string | number>) => string
  >(),
  confirmAsync: vi.fn<(message: string) => Promise<boolean>>(),
  showToast: vi.fn<(message: string, type?: string) => void>(),
  fetchPluginManifest: vi.fn(),
  installPlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
  loadPluginIndex: vi.fn(),
  patchPluginRecord: vi.fn(),
  activatePlugin: vi.fn(),
  deactivatePlugin: vi.fn(),
  markPluginLoaded: vi.fn(),
  checkPluginUpdates: vi.fn(),
  startPluginUpdateLoop: vi.fn(),
  bgmLog: vi.fn(),
  getApp: vi.fn(),
  copyTextWithResult: vi.fn(),
  shellExecute: vi.fn(),
}))

vi.mock('../ts/i18n/locale-store.js', () => ({ tOr: m.tOr }))
vi.mock('../ts/ui/dialog.js', () => ({ confirmAsync: m.confirmAsync, showToast: m.showToast }))
vi.mock('../ts/tools/util/index.js', () => ({
  bgmLog: m.bgmLog,
  getApp: m.getApp,
  copyTextWithResult: m.copyTextWithResult,
}))
vi.mock('../ts/tools/update-check.js', () => ({ CURRENT_VERSION: '2.4.1' }))
vi.mock('../ts/plugins/plugin-market.js', () => ({
  fetchPluginManifest: m.fetchPluginManifest,
  installPlugin: m.installPlugin,
  uninstallPlugin: m.uninstallPlugin,
  pluginDirectoryUrl: () => new URL('file:///D:/p/'),
  describeSignatureStatus: (status: string) => `说明:${status}`,
}))
vi.mock('../ts/plugins/plugin-store.js', () => ({
  loadPluginIndex: m.loadPluginIndex,
  patchPluginRecord: m.patchPluginRecord,
}))
vi.mock('../ts/plugins/plugin-runtime.js', () => ({
  activatePlugin: m.activatePlugin,
  deactivatePlugin: m.deactivatePlugin,
  createPluginLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  manifestFromRecord: () => ({}),
  markPluginLoaded: m.markPluginLoaded,
}))
vi.mock('../ts/plugins/plugin-updater.js', () => ({
  checkPluginUpdates: m.checkPluginUpdates,
  startPluginUpdateLoop: m.startPluginUpdateLoop,
}))

/** 与 `ui/plugin-market.html` 同构的最小骨架（只保留 id 与层级） */
const BODY_HTML = `
  <main>
    <input id="pluginSourceInput" type="text" />
    <button id="pluginInstallButton">安装 / 更新</button>
    <input id="pluginDevModeToggle" type="checkbox" />
    <a id="pluginSpecLink" href="https://github.com/awujiana/My-Bangumi-Database-for-WPS/blob/main/PLUGIN-SPEC.md"></a>
    <p id="pluginSourceMessage"></p>
    <span id="pluginInstalledCount"></span>
    <div id="pluginInstalledList"></div>
    <p id="pluginInstalledEmpty"></p>
    <div id="pluginPendingList"></div>
    <p id="pluginPendingEmpty"></p>
    <button id="pluginCheckUpdatesButton"></button>
    <button id="pluginRefreshButton"></button>
    <button id="pluginLogClearButton"></button>
    <pre id="pluginLog"></pre>
  </main>
`

/** 造一份清单 */
function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schemaVersion: 1,
    id: 'hmoe-new-anime',
    name: 'H萌新番',
    version: '1.0.0',
    apiVersion: '1.0.0',
    minHostVersion: '2.4.0',
    description: '一键下载 H萌新番 Excel',
    author: 'awujiana',
    entry: 'plugin.js',
    permissions: ['sheet.write'],
    checksum: { 'plugin.js': { sha256: 'a'.repeat(64), size: 10 } },
    ...overrides,
  }
}

/** 造一条已安装记录 */
function record(overrides: Partial<InstalledPluginRecord> = {}): InstalledPluginRecord {
  return {
    id: 'hmoe-new-anime',
    name: 'H萌新番',
    version: '1.0.0',
    author: 'awujiana',
    source: { kind: 'github', value: 'awujiana/MBD-plugin-hmacg' },
    enabled: true,
    installedAt: '2026-11-01T00:00:00.000Z',
    permissions: ['sheet.write'],
    signatureStatus: 'verified',
    ...overrides,
  }
}

/** 取元素（不存在直接抛，避免 null 断言散落各处） */
function byId(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`缺少元素 #${id}`)
  return node
}

/** 点一下并让微任务跑完 */
async function click(node: HTMLElement): Promise<void> {
  // cancelable 让页面里的 preventDefault() 真的生效：否则 jsdom 会对 <a> 报「导航未实现」
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => {})
}

/** 装载页面模块（每次拿干净实例） */
async function loadPage(): Promise<typeof import('../ts/panel/plugin-market-page.js')> {
  vi.resetModules()
  return import('../ts/panel/plugin-market-page.js')
}

beforeEach(() => {
  document.body.innerHTML = BODY_HTML
  m.tOr.mockImplementation((_key, fallback, parameters) => {
    if (parameters === undefined) return fallback
    let text = fallback
    for (const [name, value] of Object.entries(parameters)) {
      text = text.replaceAll(`{${name}}`, () => String(value))
    }
    return text
  })
  m.getApp.mockReturnValue({ OAAssist: { ShellExecute: m.shellExecute } })
  m.copyTextWithResult.mockReturnValue({ ok: true })
  m.confirmAsync.mockResolvedValue(true)
  m.loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [] })
  m.startPluginUpdateLoop.mockReturnValue(() => {})
  m.checkPluginUpdates.mockResolvedValue([])
  m.uninstallPlugin.mockReturnValue({ ok: true })
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('initializePluginMarketPage · 首屏', () => {
  it('空索引时显示空态并把计数写成 0', async () => {
    const page = await loadPage()
    page.initializePluginMarketPage()
    expect(byId('pluginInstalledCount').textContent).toBe('0')
    expect(byId('pluginInstalledEmpty').hidden).toBe(false)
  })

  it('有记录时渲染条目并显示签名徽标', async () => {
    m.loadPluginIndex.mockReturnValue({
      schemaVersion: 1,
      plugins: [record({ signatureStatus: 'unsigned' })],
    })
    const page = await loadPage()
    page.initializePluginMarketPage()
    const list = byId('pluginInstalledList')
    expect(list.textContent).toContain('H萌新番')
    const badge = list.querySelector('.plugin-signature-badge')
    expect(badge?.textContent).toBe('未签名')
    expect((badge as HTMLElement).dataset.status).toBe('unsigned')
  })

  it('待重载与已禁用都有标记', async () => {
    m.loadPluginIndex.mockReturnValue({
      schemaVersion: 1,
      plugins: [record({ pendingReload: true, enabled: false })],
    })
    const page = await loadPage()
    page.initializePluginMarketPage()
    expect(byId('pluginInstalledList').textContent).toContain('待重载生效')
    expect(byId('pluginInstalledList').textContent).toContain('已禁用')
  })
})

describe('拉清单 → 待确认卡片', () => {
  it('来源为空时提示，不发请求', async () => {
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))
    expect(byId('pluginSourceMessage').textContent).toBe('请先填写仓库地址')
    expect(m.fetchPluginManifest).not.toHaveBeenCalled()
  })

  it('本地目录来源在非开发者模式下被拒', async () => {
    ;(byId('pluginSourceInput') as HTMLInputElement).value = String.raw`D:\plugins\hmoe`
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))
    expect(byId('pluginSourceMessage').textContent).toContain('开发者模式')
    expect(m.fetchPluginManifest).not.toHaveBeenCalled()
  })

  it('清单校验失败时把原因写到提示区与日志', async () => {
    m.fetchPluginManifest.mockResolvedValue({ ok: false, reason: 'schemaVersion 必须是 1' })
    ;(byId('pluginSourceInput') as HTMLInputElement).value = 'awujiana/MBD-plugin-hmacg'
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))
    expect(byId('pluginSourceMessage').textContent).toBe('schemaVersion 必须是 1')
    expect(byId('pluginLog').textContent).toContain('清单校验失败')
  })

  it('未签名的清单：按钮变「无视风险安装」并显示未签名徽标', async () => {
    m.fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest(),
      baseUrl: 'x',
      signatureStatus: 'unsigned',
    })
    ;(byId('pluginSourceInput') as HTMLInputElement).value = 'awujiana/MBD-plugin-hmacg'
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))

    const pending = byId('pluginPendingList')
    expect(pending.querySelector('.plugin-signature-badge')?.textContent).toBe('未签名')
    const buttons = pending.querySelectorAll('button')
    expect(buttons[0]?.textContent).toBe('无视风险安装')
    expect(buttons[0]?.className).toContain('danger')
  })

  it('已验证的清单：按钮是「确认安装」，不带危险样式', async () => {
    m.fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest(),
      baseUrl: 'x',
      signatureStatus: 'verified',
    })
    ;(byId('pluginSourceInput') as HTMLInputElement).value = 'awujiana/MBD-plugin-hmacg'
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))

    const buttons = byId('pluginPendingList').querySelectorAll('button')
    expect(buttons[0]?.textContent).toBe('确认安装')
    expect(buttons[0]?.className).not.toContain('danger')
  })

  it('清单里声明的权限与功能都渲染出来', async () => {
    m.fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest({
        permissions: ['sheet.write', 'net.fetch'],
        network: ['raw.githubusercontent.com'],
        features: [{ key: 'download', name: '一键下载', description: '拉最新番表' }],
      }),
      baseUrl: 'x',
      signatureStatus: 'verified',
    })
    ;(byId('pluginSourceInput') as HTMLInputElement).value = 'awujiana/MBD-plugin-hmacg'
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))

    const pending = byId('pluginPendingList')
    expect(pending.querySelectorAll('.plugin-permission')).toHaveLength(2)
    expect(pending.textContent).toContain('一键下载：拉最新番表')
    expect(pending.textContent).toContain('MBD ≥ 2.4.0')
  })
})

describe('安装确认', () => {
  it('取消第一次确认就不装', async () => {
    m.fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest(),
      baseUrl: 'x',
      signatureStatus: 'verified',
    })
    m.confirmAsync.mockResolvedValue(false)
    ;(byId('pluginSourceInput') as HTMLInputElement).value = 'awujiana/MBD-plugin-hmacg'
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))
    await click(byId('pluginPendingList').querySelector('button') as HTMLElement)
    expect(m.installPlugin).not.toHaveBeenCalled()
  })

  it('已验证的清单只弹一次确认，且不要求放行未信任', async () => {
    m.fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest(),
      baseUrl: 'x',
      signatureStatus: 'verified',
    })
    m.installPlugin.mockResolvedValue({
      ok: true,
      manifest: manifest(),
      pendingPermissions: [],
      signatureStatus: 'verified',
    })
    ;(byId('pluginSourceInput') as HTMLInputElement).value = 'awujiana/MBD-plugin-hmacg'
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))
    await click(byId('pluginPendingList').querySelector('button') as HTMLElement)

    expect(m.confirmAsync).toHaveBeenCalledTimes(1)
    expect(m.installPlugin).toHaveBeenCalledWith(expect.anything(), expect.anything(), '2.4.1', {
      allowUntrusted: false,
    })
    expect(byId('pluginPendingList').children).toHaveLength(0)
  })

  it('未签名时必须第二次确认，取消就放弃安装', async () => {
    m.fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest(),
      baseUrl: 'x',
      signatureStatus: 'unsigned',
    })
    m.confirmAsync.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    ;(byId('pluginSourceInput') as HTMLInputElement).value = 'awujiana/MBD-plugin-hmacg'
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))
    await click(byId('pluginPendingList').querySelector('button') as HTMLElement)

    expect(m.confirmAsync).toHaveBeenCalledTimes(2)
    expect(m.installPlugin).not.toHaveBeenCalled()
    expect(byId('pluginLog').textContent).toContain('已放弃安装')
  })

  it('未签名且两次都确认后才以 allowUntrusted 安装', async () => {
    m.fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest(),
      baseUrl: 'x',
      signatureStatus: 'unsigned',
    })
    m.installPlugin.mockResolvedValue({
      ok: true,
      manifest: manifest(),
      pendingPermissions: [],
      signatureStatus: 'unsigned',
    })
    ;(byId('pluginSourceInput') as HTMLInputElement).value = 'awujiana/MBD-plugin-hmacg'
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))
    await click(byId('pluginPendingList').querySelector('button') as HTMLElement)

    expect(m.installPlugin).toHaveBeenCalledWith(expect.anything(), expect.anything(), '2.4.1', {
      allowUntrusted: true,
    })
    await vi.waitFor(() => {
      expect(byId('pluginSourceMessage').textContent).toContain('已安装')
    })
  })

  it('安装失败时把原因写到提示区', async () => {
    m.fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest(),
      baseUrl: 'x',
      signatureStatus: 'verified',
    })
    m.installPlugin.mockResolvedValue({ ok: false, reason: 'sha256 不一致' })
    ;(byId('pluginSourceInput') as HTMLInputElement).value = 'awujiana/MBD-plugin-hmacg'
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))
    await click(byId('pluginPendingList').querySelector('button') as HTMLElement)
    expect(byId('pluginSourceMessage').textContent).toBe('sha256 不一致')
  })
})

describe('已安装列表的按钮', () => {
  it('启用按钮在禁用记录上显示「启用」并调 activate', async () => {
    m.loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [record({ enabled: false })] })
    m.activatePlugin.mockResolvedValue({ ok: true })
    const page = await loadPage()
    page.initializePluginMarketPage()
    const buttons = byId('pluginInstalledList').querySelectorAll('button')
    expect(buttons[0]?.textContent).toBe('启用')
    await click(buttons[0] as HTMLElement)
    expect(m.patchPluginRecord).toHaveBeenCalledWith('hmoe-new-anime', { enabled: true })
    expect(m.activatePlugin).toHaveBeenCalled()
  })

  it('启用失败时写错误日志', async () => {
    m.loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [record({ enabled: false })] })
    m.activatePlugin.mockResolvedValue({ ok: false, reason: '文件不见了' })
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstalledList').querySelector('button') as HTMLElement)
    expect(byId('pluginLog').textContent).toContain('启用失败：文件不见了')
  })

  it('卸载要先确认，取消就不动', async () => {
    m.loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [record()] })
    m.confirmAsync.mockResolvedValue(false)
    const page = await loadPage()
    page.initializePluginMarketPage()
    const buttons = byId('pluginInstalledList').querySelectorAll('button')
    await click(buttons[2] as HTMLElement)
    expect(m.uninstallPlugin).not.toHaveBeenCalled()
  })

  it('确认后卸载并停用', async () => {
    m.loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [record()] })
    const page = await loadPage()
    page.initializePluginMarketPage()
    const buttons = byId('pluginInstalledList').querySelectorAll('button')
    await click(buttons[2] as HTMLElement)
    expect(m.deactivatePlugin).toHaveBeenCalledWith('hmoe-new-anime')
    expect(m.uninstallPlugin).toHaveBeenCalled()
    expect(byId('pluginLog').textContent).toContain('已卸载')
  })
})

describe('检查更新', () => {
  it('needs-trust 时弹确认，点「是」才强制更新', async () => {
    m.loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [record()] })
    m.checkPluginUpdates.mockResolvedValue([
      {
        id: 'hmoe-new-anime',
        name: 'H萌新番',
        from: '1.0.0',
        to: '1.1.0',
        status: 'needs-trust',
        reason: '未签名',
      },
    ])
    m.installPlugin.mockResolvedValue({
      ok: true,
      manifest: manifest({ version: '1.1.0' }),
      pendingPermissions: [],
    })
    const page = await loadPage()
    page.initializePluginMarketPage()
    const buttons = byId('pluginInstalledList').querySelectorAll('button')
    await click(buttons[1] as HTMLElement)

    expect(m.confirmAsync).toHaveBeenCalledTimes(1)
    expect(m.installPlugin).toHaveBeenCalledWith(expect.anything(), expect.anything(), '2.4.1', {
      allowUntrusted: true,
    })
    await vi.waitFor(() => {
      expect(byId('pluginLog').textContent).toContain('强制更新')
    })
  })

  it('needs-trust 时点「否」就不装', async () => {
    m.loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [record()] })
    m.checkPluginUpdates.mockResolvedValue([
      {
        id: 'hmoe-new-anime',
        name: 'H萌新番',
        from: '1.0.0',
        to: '1.1.0',
        status: 'needs-trust',
        reason: '未签名',
      },
    ])
    m.confirmAsync.mockResolvedValue(false)
    const page = await loadPage()
    page.initializePluginMarketPage()
    const buttons = byId('pluginInstalledList').querySelectorAll('button')
    await click(buttons[1] as HTMLElement)
    expect(m.installPlugin).not.toHaveBeenCalled()
  })

  it('检查全部：没有插件时直接提示', async () => {
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginCheckUpdatesButton'))
    expect(byId('pluginLog').textContent).toContain('没有已安装的插件')
  })

  it('各种更新结果都写进日志', async () => {
    m.loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [record()] })
    m.checkPluginUpdates.mockResolvedValue([
      { id: 'a', name: 'A', from: '1.0.0', to: '1.1.0', status: 'updated' },
      { id: 'b', name: 'B', from: '1.0.0', status: 'failed', reason: '断网' },
      {
        id: 'c',
        name: 'C',
        from: '1.0.0',
        to: '1.1.0',
        status: 'needs-permission',
        reason: '要 data.write',
      },
      { id: 'd', name: 'D', from: '1.0.0', status: 'up-to-date' },
      { id: 'e', name: 'E', from: '1.0.0', status: 'skipped', reason: '已禁用' },
    ])
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginCheckUpdatesButton'))

    const log = byId('pluginLog').textContent
    expect(log).toContain('A 已更新 1.0.0 → 1.1.0')
    expect(log).toContain('B 检查失败：断网')
    expect(log).toContain('C 需要重新授权')
    expect(log).toContain('D 已是最新版本')
  })
})

describe('其它交互', () => {
  it('刷新按钮重绘列表', async () => {
    const page = await loadPage()
    page.initializePluginMarketPage()
    m.loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [record()] })
    await click(byId('pluginRefreshButton'))
    expect(byId('pluginInstalledList').textContent).toContain('H萌新番')
    expect(byId('pluginLog').textContent).toContain('列表已刷新')
  })

  it('清空按钮清掉日志', async () => {
    const page = await loadPage()
    page.initializePluginMarketPage()
    byId('pluginLog').textContent = '旧日志'
    await click(byId('pluginLogClearButton'))
    expect(byId('pluginLog').textContent).toBe('')
  })

  it('勾选开发者模式后允许本地目录来源', async () => {
    ;(byId('pluginSourceInput') as HTMLInputElement).value = String.raw`D:\plugins\hmoe`
    m.fetchPluginManifest.mockResolvedValue({ ok: false, reason: '取不到 plugin.json' })
    const page = await loadPage()
    page.initializePluginMarketPage()
    const toggle = byId('pluginDevModeToggle') as HTMLInputElement
    toggle.checked = true
    toggle.dispatchEvent(new Event('change'))
    await click(byId('pluginInstallButton'))
    expect(m.fetchPluginManifest).toHaveBeenCalled()
  })

  it('启动无感更新循环，页面卸载时停掉', async () => {
    const stop = vi.fn()
    m.startPluginUpdateLoop.mockReturnValue(stop)
    const page = await loadPage()
    page.initializePluginMarketPage()
    expect(m.startPluginUpdateLoop).toHaveBeenCalled()
    window.dispatchEvent(new Event('beforeunload'))
    expect(stop).toHaveBeenCalled()
  })
})

describe('三项版本信息', () => {
  it('待确认卡片把插件版本 / 数据源版本 / 最低宿主版本放在同一行', async () => {
    m.fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest({
        version: '1.0.1',
        minHostVersion: '2.5.0',
        dataSourceVersion: '2026H2-2026-11-04',
      }),
      baseUrl: 'x',
      signatureStatus: 'verified',
    })
    ;(byId('pluginSourceInput') as HTMLInputElement).value = 'awujiana/MBD-plugin-hmacg'
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))

    const line = byId('pluginPendingList').querySelector('.plugin-version-line')
    expect(line?.textContent).toBe(
      '插件 v1.0.1 · 数据源 v2026H2-2026-11-04 · 支持 MBD ≥ 2.5.0',
    )
  })

  it('没有数据源的清单用短模板，不露出未替换的占位符', async () => {
    m.fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest(),
      baseUrl: 'x',
      signatureStatus: 'verified',
    })
    ;(byId('pluginSourceInput') as HTMLInputElement).value = 'awujiana/MBD-plugin-hmacg'
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginInstallButton'))

    const line = byId('pluginPendingList').querySelector('.plugin-version-line')
    expect(line?.textContent).toBe('插件 v1.0.0 · 支持 MBD ≥ 2.4.0')
    expect(line?.textContent).not.toContain('{')
  })

  it('已安装卡片从索引读三项，页面重载后仍完整显示', async () => {
    m.loadPluginIndex.mockReturnValue({
      schemaVersion: 1,
      plugins: [
        record({ minHostVersion: '2.5.0', dataSourceVersion: '2026H2-2026-11-04' }),
      ],
    })
    const page = await loadPage()
    page.initializePluginMarketPage()

    const line = byId('pluginInstalledList').querySelector('.plugin-version-line')
    expect(line?.textContent).toBe(
      '插件 v1.0.0 · 数据源 v2026H2-2026-11-04 · 支持 MBD ≥ 2.5.0',
    )
  })

  it('旧索引缺 minHostVersion 时显示破折号而不是 undefined', async () => {
    m.loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [record()] })
    const page = await loadPage()
    page.initializePluginMarketPage()

    const line = byId('pluginInstalledList').querySelector('.plugin-version-line')
    expect(line?.textContent).toBe('插件 v1.0.0 · 支持 MBD ≥ —')
    expect(line?.textContent).not.toContain('undefined')
  })
})

describe('插件开发规范链接', () => {
  const specUrl =
    'https://github.com/awujiana/My-Bangumi-Database-for-WPS/blob/main/PLUGIN-SPEC.md'

  it('点击交给宿主 ShellExecute 打开，并把地址复制到剪贴板', async () => {
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginSpecLink'))
    expect(m.shellExecute).toHaveBeenCalledWith(specUrl)
    expect(m.copyTextWithResult).toHaveBeenCalledWith(specUrl)
    expect(m.showToast).toHaveBeenCalled()
  })

  it('宿主没有 ShellExecute 时退回 window.open', async () => {
    m.getApp.mockReturnValue(null)
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginSpecLink'))
    expect(openSpy).toHaveBeenCalledWith(specUrl, '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()
  })

  it('复制失败时把地址写进日志，用户仍能手动访问', async () => {
    m.copyTextWithResult.mockReturnValue({ ok: false })
    const page = await loadPage()
    page.initializePluginMarketPage()
    await click(byId('pluginSpecLink'))
    expect(byId('pluginLog').textContent).toContain(specUrl)
    expect(m.showToast).not.toHaveBeenCalled()
  })
})
