// @vitest-environment jsdom
/**
 * @fileoverview `ts/plugins/plugin-market.ts` 单测
 *
 * 这是唯一碰网络和磁盘的模块，所以重点全在「硬门槛」上：
 * 1. **字节数与 sha256 必须与清单一致** —— 不一致时一个字节都不写；
 * 2. **签名未通过必须显式放行** —— `allowUntrusted` 不给就拒装（防止界面忘了确认）；
 * 3. **落盘内容必须是纯 ASCII** —— FSO 写不了 UTF-8，中文必须转 `\uXXXX`；
 * 4. **失败不留半装状态** —— 索引写不进去就不算装好。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { canWriteTextFile, ensureDirectory } from '../ts/tools/save-file.js'
import {
  deletePluginDirectory,
  describeSignatureStatus,
  fetchPluginManifest,
  fileUrlToPath,
  installPlugin,
  pluginDirectoryUrl,
  pluginEntryUrl,
  pluginRootUrl,
  sha256HexOfBytes,
  toAsciiSource,
  uninstallPlugin,
} from '../ts/plugins/plugin-market.js'
import {
  PLUGIN_INDEX_KEY,
  findPluginRecord,
  resetPluginIndexForTest,
} from '../ts/plugins/plugin-store.js'
import { manifestFromRecord } from '../ts/plugins/plugin-runtime.js'

vi.mock('../ts/tools/save-file.js', () => ({
  canWriteTextFile: vi.fn(() => true),
  ensureDirectory: vi.fn(() => true),
}))

const ROOT_URL = new URL('file:///D:/wps/jsaddons/mbd_2.4.1/')
const ENTRY_SOURCE = "export function activate() {\n  console.log('新番 Excel')\n}\n"

/** 造一个 fetch 响应桩（jsdom 下没有 Response，用最小接口即可） */
function stubResponse(body: string): unknown {
  const bytes = new TextEncoder().encode(body)
  return {
    ok: true,
    status: 200,
    text: async () => body,
    arrayBuffer: async () => bytes.buffer,
  }
}

/** 造一个失败响应 */
function stubFailure(status = 404): unknown {
  return { ok: false, status, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
}

/** 清单 JSON 文本（checksum 按真实字节算，测试里现算） */
async function manifestText(overrides: Record<string, unknown> = {}): Promise<string> {
  const bytes = new TextEncoder().encode(ENTRY_SOURCE)
  const sha256 = await sha256HexOfBytes(bytes)
  return JSON.stringify({
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
    checksum: { 'plugin.js': { sha256, size: bytes.byteLength } },
    ...overrides,
  })
}

/** 按 URL 分派的 fetch 桩 */
function mockFetch(routes: Record<string, unknown>): void {
  vi.stubGlobal('fetch', (url: string) => Promise.resolve(routes[url] ?? stubFailure()))
}

beforeEach(() => {
  resetPluginIndexForTest()
  vi.mocked(canWriteTextFile).mockReturnValue(true)
  vi.mocked(ensureDirectory).mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as { Application?: unknown }).Application
  delete (window as unknown as { wps?: unknown }).wps
  vi.restoreAllMocks()
})

describe('toAsciiSource', () => {
  it('纯 ASCII 原样返回', () => {
    expect(toAsciiSource('const a = 1;\n')).toBe('const a = 1;\n')
  })

  it(String.raw`中文转成 \uXXXX`, () => {
    expect(toAsciiSource('新番')).toBe(String.raw`\u65b0\u756a`)
  })

  it('保留制表符与换行（它们是合法 ASCII 空白）', () => {
    expect(toAsciiSource('a\tb\r\nc')).toBe('a\tb\r\nc')
  })

  it(String.raw`emoji（代理对）走 \u{...}`, () => {
    expect(toAsciiSource('🎉')).toBe(String.raw`\u{1f389}`)
  })

  it('输出里不含任何非 ASCII 字符', () => {
    const output = toAsciiSource('const 标题 = "新番 🎉"\n')
    let isAsciiOnly = true
    for (const character of output) {
      const code = character.codePointAt(0) ?? 0
      const isAllowed = code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)
      if (!isAllowed) isAsciiOnly = false
    }
    expect(isAsciiOnly).toBe(true)
  })
})

describe('sha256HexOfBytes', () => {
  it('空字节是 e3b0c442...', async () => {
    expect(await sha256HexOfBytes(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('输出是 64 位小写十六进制', async () => {
    const hex = await sha256HexOfBytes(new TextEncoder().encode('abc'))
    expect(hex).toMatch(/^[0-9a-f]{64}$/u)
  })
})

describe('路径拼接', () => {
  it('插件根目录在加载项目录下的 plugins/', () => {
    expect(pluginRootUrl(ROOT_URL).href).toBe('file:///D:/wps/jsaddons/mbd_2.4.1/plugins/')
  })

  it('单个插件的目录与入口 URL', () => {
    expect(pluginDirectoryUrl(ROOT_URL, 'hmoe-new-anime').href).toBe(
      'file:///D:/wps/jsaddons/mbd_2.4.1/plugins/hmoe-new-anime/',
    )
    expect(pluginEntryUrl(ROOT_URL, 'hmoe-new-anime')).toBe(
      'file:///D:/wps/jsaddons/mbd_2.4.1/plugins/hmoe-new-anime/plugin.js',
    )
  })

  it('file:// URL 转 Windows 路径', () => {
    expect(fileUrlToPath(new URL('file:///D:/a/b/'))).toBe('D:\\a\\b\\')
  })

  it('路径里的中文按百分号解码', () => {
    expect(fileUrlToPath(new URL('file:///D:/%E6%8F%92%E4%BB%B6/'))).toBe('D:\\插件\\')
  })
})

describe('fetchPluginManifest', () => {
  it('来源格式不对时直接拒，不发请求', async () => {
    const result = await fetchPluginManifest({ kind: 'github', value: 'bad' }, '2.4.1')
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toContain('来源格式不对')
  })

  it('网络失败时把原因带出来', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('断网')))
    const result = await fetchPluginManifest({ kind: 'github', value: 'a/b' }, '2.4.1')
    expect(result.ok ? '' : result.reason).toContain('取不到 plugin.json')
  })

  it('HTTP 非 2xx 时报出状态码', async () => {
    mockFetch({ 'https://raw.githubusercontent.com/a/b/main/plugin.json': stubFailure(404) })
    const result = await fetchPluginManifest({ kind: 'github', value: 'a/b' }, '2.4.1')
    expect(result.ok ? '' : result.reason).toContain('HTTP 404')
  })

  it('JSON 非法时报出解析失败', async () => {
    mockFetch({ 'https://raw.githubusercontent.com/a/b/main/plugin.json': stubResponse('{') })
    const result = await fetchPluginManifest({ kind: 'github', value: 'a/b' }, '2.4.1')
    expect(result.ok ? '' : result.reason).toContain('不是合法 JSON')
  })

  it('清单校验失败时把所有错误拼起来', async () => {
    mockFetch({
      'https://raw.githubusercontent.com/a/b/main/plugin.json': stubResponse(
        JSON.stringify({ schemaVersion: 9 }),
      ),
    })
    const result = await fetchPluginManifest({ kind: 'github', value: 'a/b' }, '2.4.1')
    expect(result.ok ? '' : result.reason).toContain('schemaVersion')
  })

  it('成功时带回 baseUrl 与签名结论', async () => {
    mockFetch({
      'https://raw.githubusercontent.com/a/b/main/plugin.json': stubResponse(await manifestText()),
    })
    const result = await fetchPluginManifest({ kind: 'github', value: 'a/b' }, '2.4.1')
    expect(result.ok).toBe(true)
    expect(result.ok ? result.baseUrl : '').toBe('https://raw.githubusercontent.com/a/b/main')
    expect(result.ok ? result.signatureStatus : '').toBe('unsigned')
  })
})

describe('installPlugin', () => {
  const manifestUrl = 'https://raw.githubusercontent.com/a/b/main/plugin.json'
  const entryUrl = 'https://raw.githubusercontent.com/a/b/main/plugin.js'

  it('未签名且没放行时拒装，且不下载入口文件', async () => {
    const text = await manifestText()
    const fetchSpy = vi.fn((url: string) =>
      Promise.resolve(url === manifestUrl ? stubResponse(text) : stubFailure()),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const result = await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1')
    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.requiresTrust).toBe(true)
    expect(result.ok ? '' : result.reason).toContain('签名未通过')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('放行后安装成功：文件与索引都写好', async () => {
    mockFetch({
      [manifestUrl]: stubResponse(await manifestText()),
      [entryUrl]: stubResponse(ENTRY_SOURCE),
    })
    const result = await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })
    expect(result.ok).toBe(true)
    expect(ensureDirectory).toHaveBeenCalledWith(
      'D:\\wps\\jsaddons\\mbd_2.4.1\\plugins\\hmoe-new-anime\\',
    )
    expect(canWriteTextFile).toHaveBeenCalledTimes(2)
    expect(findPluginRecord('hmoe-new-anime')?.signatureStatus).toBe('unsigned')
  })

  it('域名白名单跟着索引持久化，重载后重建清单仍带着它', async () => {
    const text = await manifestText({ network: ['raw.githubusercontent.com'] })
    mockFetch({ [manifestUrl]: stubResponse(text), [entryUrl]: stubResponse(ENTRY_SOURCE) })
    await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })

    const record = findPluginRecord('hmoe-new-anime')
    expect(record?.network).toEqual(['raw.githubusercontent.com'])
    expect(record === null ? [] : manifestFromRecord(record).network).toEqual([
      'raw.githubusercontent.com',
    ])
  })

  it('三项版本信息写进索引，重载后重建清单仍带着它', async () => {
    const text = await manifestText({
      minHostVersion: '2.5.0',
      dataSourceVersion: '2026H2-2026-11-04',
    })
    mockFetch({ [manifestUrl]: stubResponse(text), [entryUrl]: stubResponse(ENTRY_SOURCE) })
    await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.5.0', {
      allowUntrusted: true,
    })

    const installed = findPluginRecord('hmoe-new-anime')
    expect(installed?.version).toBe('1.0.0')
    expect(installed?.minHostVersion).toBe('2.5.0')
    expect(installed?.dataSourceVersion).toBe('2026H2-2026-11-04')
    if (installed === null) throw new Error('索引里没有记录')
    const rebuilt = manifestFromRecord(installed)
    expect(rebuilt.version).toBe('1.0.0')
    expect(rebuilt.minHostVersion).toBe('2.5.0')
    expect(rebuilt.dataSourceVersion).toBe('2026H2-2026-11-04')
  })

  it('纯工具型插件没有数据源时不写 dataSourceVersion', async () => {
    const text = await manifestText()
    mockFetch({ [manifestUrl]: stubResponse(text), [entryUrl]: stubResponse(ENTRY_SOURCE) })
    await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })

    const installed = findPluginRecord('hmoe-new-anime')
    expect(installed?.minHostVersion).toBe('2.4.0')
    expect(installed?.dataSourceVersion).toBeUndefined()
    if (installed === null) throw new Error('索引里没有记录')
    expect(manifestFromRecord(installed).dataSourceVersion).toBeUndefined()
  })

  it('落盘的源码是纯 ASCII（中文被转义）', async () => {
    mockFetch({
      [manifestUrl]: stubResponse(await manifestText()),
      [entryUrl]: stubResponse(ENTRY_SOURCE),
    })
    await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })
    const written = vi.mocked(canWriteTextFile).mock.calls[0]
    expect(written?.[1]).toContain(String.raw`\u65b0\u756a`)
    expect(written?.[1]).not.toContain('新番')
  })

  it('大小不符时拒装且不写盘', async () => {
    mockFetch({
      [manifestUrl]: stubResponse(await manifestText()),
      [entryUrl]: stubResponse(`${ENTRY_SOURCE}// 多一行`),
    })
    const result = await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })
    expect(result.ok ? '' : result.reason).toContain('文件大小不符')
    expect(canWriteTextFile).not.toHaveBeenCalled()
  })

  it('sha256 不符时拒装（大小相同也拦）', async () => {
    const text = await manifestText({
      checksum: {
        'plugin.js': {
          sha256: 'c'.repeat(64),
          size: new TextEncoder().encode(ENTRY_SOURCE).byteLength,
        },
      },
    })
    mockFetch({ [manifestUrl]: stubResponse(text), [entryUrl]: stubResponse(ENTRY_SOURCE) })
    const result = await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })
    expect(result.ok ? '' : result.reason).toContain('sha256 不一致')
    expect(canWriteTextFile).not.toHaveBeenCalled()
  })

  it('下载入口文件失败时报出原因', async () => {
    mockFetch({ [manifestUrl]: stubResponse(await manifestText()), [entryUrl]: stubFailure(500) })
    const result = await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })
    expect(result.ok ? '' : result.reason).toContain('下载插件失败')
  })

  it('建目录失败时拒装', async () => {
    vi.mocked(ensureDirectory).mockReturnValue(false)
    mockFetch({
      [manifestUrl]: stubResponse(await manifestText()),
      [entryUrl]: stubResponse(ENTRY_SOURCE),
    })
    const result = await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })
    expect(result.ok ? '' : result.reason).toContain('无法创建插件目录')
  })

  it('写文件失败时拒装', async () => {
    vi.mocked(canWriteTextFile).mockReturnValue(false)
    mockFetch({
      [manifestUrl]: stubResponse(await manifestText()),
      [entryUrl]: stubResponse(ENTRY_SOURCE),
    })
    const result = await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })
    expect(result.ok ? '' : result.reason).toContain('写入插件文件失败')
  })

  it('索引写不进去时算失败（不留「文件在、列表里没有」的半装状态）', async () => {
    ;(window as unknown as { Application: unknown }).Application = {
      PluginStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('只读')
        },
      },
    }
    mockFetch({
      [manifestUrl]: stubResponse(await manifestText()),
      [entryUrl]: stubResponse(ENTRY_SOURCE),
    })
    const result = await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })
    expect(result.ok ? '' : result.reason).toContain('写入插件索引失败')
  })

  it('升级时把新增权限记成待授权', async () => {
    mockFetch({
      [manifestUrl]: stubResponse(await manifestText()),
      [entryUrl]: stubResponse(ENTRY_SOURCE),
    })
    await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })
    mockFetch({
      [manifestUrl]: stubResponse(
        await manifestText({ version: '1.1.0', permissions: ['sheet.write', 'data.write'] }),
      ),
      [entryUrl]: stubResponse(ENTRY_SOURCE),
    })
    const result = await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })
    expect(result.ok ? result.pendingPermissions : []).toEqual(['data.write'])
    expect(findPluginRecord('hmoe-new-anime')?.pendingPermissions).toEqual(['data.write'])
  })
})

describe('uninstallPlugin', () => {
  it('未安装时返回失败原因', () => {
    const result = uninstallPlugin(ROOT_URL, 'nobody')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('插件未安装')
  })

  it('已安装时删目录、删索引、清私有存储', async () => {
    const removed: string[] = []
    const storage = new Map<string, string>()
    ;(window as unknown as { Application: unknown }).Application = {
      PluginStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value)
        },
        removeItem: (key: string) => {
          removed.push(key)
          storage.delete(key)
        },
      },
    }
    ;(window as unknown as { wps: unknown }).wps = {
      OAAssist: {
        CoCreateInstance: () => ({
          FolderExists: () => true,
          DeleteFolder: () => {},
        }),
      },
    }
    const manifestUrl = 'https://raw.githubusercontent.com/a/b/main/plugin.json'
    const entryUrl = 'https://raw.githubusercontent.com/a/b/main/plugin.js'
    mockFetch({
      [manifestUrl]: stubResponse(await manifestText()),
      [entryUrl]: stubResponse(ENTRY_SOURCE),
    })
    await installPlugin(ROOT_URL, { kind: 'github', value: 'a/b' }, '2.4.1', {
      allowUntrusted: true,
    })
    expect(storage.get(PLUGIN_INDEX_KEY)).toContain('hmoe-new-anime')

    // 模拟插件自己存过两个键（登记表由 createPluginStorage 维护）
    storage.set('plugin:hmoe-new-anime:last', '"2026-11-04"')
    storage.set('plugin:hmoe-new-anime:#keys', '["last"]')

    expect(uninstallPlugin(ROOT_URL, 'hmoe-new-anime').ok).toBe(true)
    expect(findPluginRecord('hmoe-new-anime')).toBeNull()
    expect(removed).toContain('plugin:hmoe-new-anime:last')
    expect(removed).toContain('plugin:hmoe-new-anime:#keys')
    expect(storage.get(PLUGIN_INDEX_KEY)).not.toContain('hmoe-new-anime')
  })
})

describe('deletePluginDirectory', () => {
  it('没有 FSO 时静默返回（不抛错）', () => {
    expect(() => deletePluginDirectory(String.raw`D:\x`)).not.toThrow()
  })

  it('目录不存在时不调 DeleteFolder', () => {
    const deleteFolder = vi.fn()
    ;(window as unknown as { wps: unknown }).wps = {
      OAAssist: {
        CoCreateInstance: () => ({ FolderExists: () => false, DeleteFolder: deleteFolder }),
      },
    }
    deletePluginDirectory(String.raw`D:\x`)
    expect(deleteFolder).not.toHaveBeenCalled()
  })

  it('FSO 抛错时被吃掉（卸载不该因删目录失败而中断）', () => {
    ;(window as unknown as { wps: unknown }).wps = {
      OAAssist: {
        CoCreateInstance: () => ({
          FolderExists: () => {
            throw new Error('COM 挂了')
          },
          DeleteFolder: () => {},
        }),
      },
    }
    expect(() => deletePluginDirectory(String.raw`D:\x`)).not.toThrow()
  })
})

describe('describeSignatureStatus', () => {
  it('五种结论都有中文说明', () => {
    const statuses = ['verified', 'unsigned', 'untrusted-key', 'unsupported', 'invalid'] as const
    for (const status of statuses) {
      expect(describeSignatureStatus(status).length).toBeGreaterThan(2)
    }
    expect(describeSignatureStatus('verified')).toBe('作者签名已验证')
  })
})
