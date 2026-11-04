/**
 * @fileoverview `ts/plugins/plugin-updater.ts` 单测
 *
 * 无感更新最容易「悄悄把用户不想要的东西装进来」，所以这里盯三条硬规则：
 * 1. **权限只增不减**：新版本要多权限就暂停更新，等用户重新授权；
 * 2. **签名只许变好或不变**：原本已验证的作者突然未签名 / 验签失败 → 暂停；
 * 3. **定时器要能停**：页面卸载后不能再跑（否则窗格关了还在后台发请求）。
 *
 * `plugin-market` / `plugin-store` / `plugin-signature` 全部 mock —— 本文件只验证
 * 「按什么顺序判断、判断结果怎么落到索引上」，网络与磁盘另有自己的单测。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  InstalledPluginRecord,
  PluginManifest,
  PluginSignatureStatus,
} from '../ts/plugins/plugin-types.js'

/** 被 mock 的依赖（返回类型显式写出，避免 `any` 一路漏进断言） */
const fetchPluginManifest = vi.fn<(source: unknown, hostVersion: string) => Promise<unknown>>()
const installPlugin =
  vi.fn<
    (rootUrl: URL, source: unknown, hostVersion: string, options?: unknown) => Promise<unknown>
  >()
const loadPluginIndex = vi.fn<() => { schemaVersion: number; plugins: InstalledPluginRecord[] }>()
const patchPluginRecord = vi.fn<(id: string, partial: Record<string, unknown>) => void>()
const verifyPluginSignature = vi.fn<(candidate: unknown) => Promise<PluginSignatureStatus>>()

vi.mock('../ts/plugins/plugin-market.js', () => ({
  fetchPluginManifest: (source: unknown, hostVersion: string) =>
    fetchPluginManifest(source, hostVersion),
  installPlugin: (rootUrl: URL, source: unknown, hostVersion: string, options?: unknown) =>
    installPlugin(rootUrl, source, hostVersion, options),
  describeSignatureStatus: (status: PluginSignatureStatus) => `签名状态:${status}`,
}))

vi.mock('../ts/plugins/plugin-store.js', () => ({
  loadPluginIndex: () => loadPluginIndex(),
  patchPluginRecord: (id: string, partial: Record<string, unknown>) =>
    patchPluginRecord(id, partial),
}))

vi.mock('../ts/plugins/plugin-signature.js', () => ({
  verifyPluginSignature: (candidate: unknown) => verifyPluginSignature(candidate),
}))

// vi.mock 被提升到文件顶部，所以这里可以静态 import（拿到的已是替身）
import { checkPluginUpdates, startPluginUpdateLoop } from '../ts/plugins/plugin-updater.js'

const ROOT_URL = new URL('file:///D:/wps/jsaddons/mbd_2.4.1/')
const HOST_VERSION = '2.4.1'

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

/** 造一份远端清单 */
function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schemaVersion: 1,
    id: 'hmoe-new-anime',
    name: 'H萌新番',
    version: '1.1.0',
    apiVersion: '1.0.0',
    minHostVersion: '2.4.0',
    description: '一键下载 H萌新番 Excel',
    author: 'awujiana',
    entry: 'plugin.js',
    permissions: ['sheet.write'],
    updatePolicy: 'auto',
    checksum: { 'plugin.js': { sha256: 'a'.repeat(64), size: 10 } },
    ...overrides,
  }
}

beforeEach(() => {
  loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [record()] })
  fetchPluginManifest.mockResolvedValue({
    ok: true,
    manifest: manifest(),
    baseUrl: 'x',
    signatureStatus: 'verified',
  })
  verifyPluginSignature.mockResolvedValue('verified')
  installPlugin.mockResolvedValue({
    ok: true,
    manifest: manifest(),
    pendingPermissions: [],
    signatureStatus: 'verified',
  })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('checkPluginUpdates · 分流', () => {
  it('已禁用的插件记 skipped，不发请求', async () => {
    loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [record({ enabled: false })] })
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.status).toBe('skipped')
    expect(outcomes[0]?.reason).toBe('已禁用')
    expect(fetchPluginManifest).not.toHaveBeenCalled()
  })

  it('onlyId 只检查指定插件', async () => {
    loadPluginIndex.mockReturnValue({
      schemaVersion: 1,
      plugins: [record(), record({ id: 'yucwiki', name: '长门有C' })],
    })
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION, 'yucwiki')
    expect(outcomes.map((item) => item.id)).toEqual(['yucwiki'])
  })

  it('取清单失败时记 failed 并写 lastCheckedAt', async () => {
    fetchPluginManifest.mockResolvedValue({ ok: false, reason: '断网' })
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(outcomes[0]?.status).toBe('failed')
    expect(outcomes[0]?.reason).toBe('断网')
    expect(patchPluginRecord).toHaveBeenCalledWith(
      'hmoe-new-anime',
      expect.objectContaining({
        lastCheckedAt: expect.any(String) as unknown as string,
      }),
    )
  })

  it('版本不更高时记 up-to-date，不下载', async () => {
    fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest({ version: '1.0.0' }),
      baseUrl: 'x',
      signatureStatus: 'verified',
    })
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(outcomes[0]?.status).toBe('up-to-date')
    expect(installPlugin).not.toHaveBeenCalled()
  })

  it('远端版本更低也记 up-to-date（不回退）', async () => {
    fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest({ version: '0.9.0' }),
      baseUrl: 'x',
      signatureStatus: 'verified',
    })
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(outcomes[0]?.status).toBe('up-to-date')
  })

  it('新版本要更多权限时暂停更新并记 pendingPermissions', async () => {
    fetchPluginManifest.mockResolvedValue({
      ok: true,
      manifest: manifest({ permissions: ['sheet.write', 'data.write'] }),
      baseUrl: 'x',
      signatureStatus: 'verified',
    })
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(outcomes[0]?.status).toBe('needs-permission')
    expect(outcomes[0]?.reason).toContain('data.write')
    expect(patchPluginRecord).toHaveBeenCalledWith(
      'hmoe-new-anime',
      expect.objectContaining({
        pendingPermissions: ['data.write'],
      }),
    )
    expect(installPlugin).not.toHaveBeenCalled()
  })
})

describe('checkPluginUpdates · 签名门禁', () => {
  it('原本已验证、新版本未签名 → needs-trust 且不装', async () => {
    verifyPluginSignature.mockResolvedValue('unsigned')
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(outcomes[0]?.status).toBe('needs-trust')
    expect(installPlugin).not.toHaveBeenCalled()
  })

  it('原本已验证、新版本验签失败 → needs-trust（仓库可能被接管）', async () => {
    verifyPluginSignature.mockResolvedValue('invalid')
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(outcomes[0]?.status).toBe('needs-trust')
    expect(outcomes[0]?.reason).toBe('签名状态:invalid')
    expect(installPlugin).not.toHaveBeenCalled()
  })

  it('原本就未签名、新版本也未签名 → 维持原状，允许更新', async () => {
    loadPluginIndex.mockReturnValue({
      schemaVersion: 1,
      plugins: [record({ signatureStatus: 'unsigned' })],
    })
    verifyPluginSignature.mockResolvedValue('unsigned')
    installPlugin.mockResolvedValue({
      ok: true,
      manifest: manifest(),
      pendingPermissions: [],
      signatureStatus: 'unsigned',
    })
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(outcomes[0]?.status).toBe('updated')
    expect(installPlugin).toHaveBeenCalledWith(ROOT_URL, expect.anything(), HOST_VERSION, {
      allowUntrusted: true,
    })
  })

  it('已验证的插件更新时不需要放行未信任', async () => {
    await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(installPlugin).toHaveBeenCalledWith(ROOT_URL, expect.anything(), HOST_VERSION, {
      allowUntrusted: false,
    })
  })

  it('老记录没有 signatureStatus 时按「信任变差」处理（宁停一次也不放行）', async () => {
    const oldRecord = record()
    delete oldRecord.signatureStatus
    loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [oldRecord] })
    verifyPluginSignature.mockResolvedValue('unsigned')
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(outcomes[0]?.status).toBe('needs-trust')
  })
})

describe('checkPluginUpdates · 安装结果', () => {
  it('装成功时写新版本号并标待重载', async () => {
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(outcomes[0]?.status).toBe('updated')
    expect(outcomes[0]?.to).toBe('1.1.0')
    expect(patchPluginRecord).toHaveBeenCalledWith(
      'hmoe-new-anime',
      expect.objectContaining({
        version: '1.1.0',
        pendingReload: true,
      }),
    )
  })

  it('装失败时记 failed，且不写新版本号', async () => {
    installPlugin.mockResolvedValue({ ok: false, reason: 'sha256 不一致' })
    const outcomes = await checkPluginUpdates(ROOT_URL, HOST_VERSION)
    expect(outcomes[0]?.status).toBe('failed')
    expect(outcomes[0]?.reason).toBe('sha256 不一致')
    const patched = patchPluginRecord.mock.calls.at(-1)?.[1]
    expect(patched?.version).toBeUndefined()
  })
})

describe('startPluginUpdateLoop', () => {
  it('首次延迟到点才检查', async () => {
    vi.useFakeTimers()
    const onOutcome = vi.fn()
    const stop = startPluginUpdateLoop(ROOT_URL, HOST_VERSION, onOutcome, {
      initialDelay: 30_000,
      interval: 6 * 60 * 60 * 1000,
    })
    expect(fetchPluginManifest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(29_000)
    expect(fetchPluginManifest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchPluginManifest).toHaveBeenCalledTimes(1)
    stop()
  })

  it('有结果时回调，空结果不回调', async () => {
    vi.useFakeTimers()
    const onOutcome = vi.fn()
    const stop = startPluginUpdateLoop(ROOT_URL, HOST_VERSION, onOutcome, {
      initialDelay: 10,
      interval: 1000,
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(onOutcome).toHaveBeenCalledTimes(1)

    loadPluginIndex.mockReturnValue({ schemaVersion: 1, plugins: [] })
    await vi.advanceTimersByTimeAsync(1000)
    expect(onOutcome).toHaveBeenCalledTimes(1)
    stop()
  })

  it('检查抛错时被吃掉，不影响后续轮次', async () => {
    vi.useFakeTimers()
    fetchPluginManifest.mockRejectedValue(new Error('断网'))
    const onOutcome = vi.fn()
    const stop = startPluginUpdateLoop(ROOT_URL, HOST_VERSION, onOutcome, {
      initialDelay: 10,
      interval: 1000,
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(onOutcome).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchPluginManifest).toHaveBeenCalledTimes(2)
    stop()
  })

  it('停止后定时器不再触发', async () => {
    vi.useFakeTimers()
    const stop = startPluginUpdateLoop(ROOT_URL, HOST_VERSION, vi.fn(), {
      initialDelay: 10,
      interval: 1000,
    })
    stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchPluginManifest).not.toHaveBeenCalled()
  })

  it('默认间隔是 30 秒首查（不传 options 也能跑）', async () => {
    vi.useFakeTimers()
    const stop = startPluginUpdateLoop(ROOT_URL, HOST_VERSION, vi.fn())
    await vi.advanceTimersByTimeAsync(29_999)
    expect(fetchPluginManifest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchPluginManifest).toHaveBeenCalledTimes(1)
    stop()
  })
})
