// @vitest-environment jsdom
/**
 * @fileoverview `ts/i18n/locale-manifest.ts` + `ts/i18n/locale-install.ts` 单测
 *
 * 覆盖三块：
 * 1. **清单解析**：结构校验严格到什么程度（schemaVersion / sourceLocale / 单条哈希 /
 *    不支持的语言 / 重复 code），以及「坏条目丢掉但整份清单仍可用」的取舍；
 * 2. **清单加载**：在线优先、失败回落内置、两处都失败时原因要两段都留着；
 * 3. **在线安装**：字节数与 SHA-256 是写盘前的硬门槛（不一致时**一个字节都不写**）、
 *    `export default` 后面夹带语句的包必须被拒、落盘内容必须是纯 ASCII、
 *    目录缺失要能建回来。
 *
 * 用真 FSO 桩而不是 mock 整个 `save-file`：要验证的正是「调用方按什么顺序、
 * 用什么参数去写」，把写盘模块整只换掉就测不到那层契约了。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  comparePackState,
  findManifestEntry,
  loadLocaleManifest,
  parseLocaleManifest,
  setManifestImporterForTest,
} from '../ts/i18n/locale-manifest.js'
import type { LocaleManifest, LocaleManifestEntry } from '../ts/i18n/locale-manifest.js'
import {
  describeInstalledPacks,
  installLocalePacks,
  isAsciiRoundTripSafe,
  openLocaleDirectory,
  toAsciiModule,
} from '../ts/i18n/locale-install.js'
import {
  getLocaleBundle,
  parseLocaleBundle,
  replaceLocaleBundle,
  resetLocaleStoreForTest,
} from '../ts/i18n/locale-store.js'
import { LOCALE_CODES } from '../ts/i18n/translate.js'
import type { LocaleCode } from '../ts/i18n/translate.js'

/** 假的加载项目录（`resolveAddinDirectory` 会把它变成反斜杠形式） */
const ADDIN_BASE_URL = 'file:///C:/jsaddons/p'
/** `joinPath` 统一成正斜杠后的同一路径 */
const ADDIN_ROOT = 'C:/jsaddons/p'
/** raw CDN 上的仓库基址（与生产代码同一份拼接规则） */
const RAW_BASE = 'https://raw.githubusercontent.com/awujiana/My-Bangumi-Database-for-WPS/main'

/**
 * 判断文本是否纯 ASCII
 *
 * 用 `for...of` 逐码点走而不是 `[...text]`：后者在 lint 里被判定为「展开字符串
 * 可能拆错复杂字符」，而这里恰好要的就是码点级判断。
 */
function isPureAscii(text: string): boolean {
  for (const character of text) {
    if ((character.codePointAt(0) ?? 0) > 0x7f) return false
  }
  return true
}

/** 算一段文本的 SHA-256（与生产代码同一套 WebCrypto） */
async function sha256HexOf(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 造一份语言包模块源码（`export default` + 纯 JSON，与真实文件同款外壳） */
function buildPackText(
  code: string,
  options: { version?: string; updatedAt?: string; messages?: Record<string, string> } = {},
): string {
  const bundle = {
    schemaVersion: 1,
    code,
    name: `${code} name`,
    nativeName: `${code} native`,
    version: options.version ?? '2.3.0',
    updatedAt: options.updatedAt ?? '2026-11-01',
    messages: options.messages ?? { 'a.b': '中文文案', 'c.d': '带 {count} 的文案' },
  }
  return `export default ${JSON.stringify(bundle, undefined, 2)};\n`
}

/** 由语言包源码算出清单条目（哈希与字节数必须对得上，否则安装会先被拦） */
async function entryFor(
  code: LocaleCode,
  text: string,
  overrides: Partial<LocaleManifestEntry> = {},
): Promise<LocaleManifestEntry> {
  return {
    code,
    name: `${code} name`,
    nativeName: `${code} native`,
    version: '2.3.0',
    updatedAt: '2026-11-01',
    keyCount: 2,
    coverage: 100,
    sha256: await sha256HexOf(text),
    bytes: new TextEncoder().encode(text).byteLength,
    ...overrides,
  }
}

/** 只含一条语言的清单 */
function manifestWith(entries: LocaleManifestEntry[]): LocaleManifest {
  return { schemaVersion: 1, sourceLocale: 'zh-CN', keyCount: 2, locales: entries }
}

/** FSO 桩：记录写入内容与建过的目录 */
interface FsoStub {
  files: Map<string, string>
  createdFolders: string[]
  writtenFlags: boolean[]
}

/**
 * 装配假的 FileSystemObject
 *
 * @param options.existingFolders 已存在的目录（不在里面的会走 `CreateFolder`）
 * @param options.failWrite 写入时抛错（模拟无权限 / 磁盘满）
 */
function stubFso(options: { existingFolders?: string[]; failWrite?: boolean } = {}): FsoStub {
  const stub: FsoStub = { files: new Map(), createdFolders: [], writtenFlags: [] }
  const folders = new Set(options.existingFolders)
  ;(window as unknown as { wps: unknown }).wps = {
    OAAssist: {
      CoCreateInstance: vi.fn(() => ({
        FolderExists: (folderPath: string): boolean => folders.has(folderPath),
        CreateFolder: (folderPath: string): void => {
          stub.createdFolders.push(folderPath)
          folders.add(folderPath)
        },
        CreateTextFile: (filePath: string, _isOverwrite: boolean, isUnicode: boolean) => {
          if (options.failWrite === true) throw new Error('无权限')
          return {
            Write: (text: string): void => {
              stub.files.set(filePath, text)
              stub.writtenFlags.push(isUnicode)
            },
            Close: vi.fn(),
          }
        },
      })),
    },
  }
  return stub
}

/** 造一个只认指定 URL 的 fetch */
function stubFetch(routes: Record<string, string>): (url: string) => Promise<{
  ok: boolean
  status: number
  statusText: string
  text: () => Promise<string>
}> {
  return (url: string) => {
    const body = routes[url]
    if (body === undefined) {
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve(''),
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(body),
    })
  }
}

beforeEach(() => {
  resetLocaleStoreForTest()
  setManifestImporterForTest(null)
})

afterEach(() => {
  delete (window as unknown as { wps?: unknown }).wps
  delete (window as unknown as { Application?: unknown }).Application
  resetLocaleStoreForTest()
  setManifestImporterForTest(null)
})

describe('toAsciiModule', () => {
  it('把非 ASCII 字符转成 Unicode 转义', () => {
    expect(toAsciiModule('中')).toBe(String.raw`\u4e2d`)
    expect(toAsciiModule('「」')).toBe(String.raw`\u300c\u300d`)
  })

  it('ASCII 原样保留，不动结构', () => {
    const text = 'export default {\n  "a": "b"\n};\n'
    expect(toAsciiModule(text)).toBe(text)
  })

  it('补充平面字符拆成代理对', () => {
    // U+1F600 = D83D DE00
    expect(toAsciiModule('😀')).toBe(String.raw`\ud83d\ude00`)
  })

  it('真实语言包转完是纯 ASCII，且语义不变', () => {
    const text = buildPackText('en', { messages: { 'a.b': '中文 😀 混排' } })
    const escaped = toAsciiModule(text)
    expect(isPureAscii(escaped)).toBe(true)
    expect(isAsciiRoundTripSafe(JSON.parse(stripPrefix(text)), escaped)).toBe(true)
  })

  it('转义写坏（代理对算错）能被自检抓到', () => {
    const text = buildPackText('en', { messages: { 'a.b': '😀' } })
    const broken = toAsciiModule(text).replace(String.raw`\ud83d\ude00`, String.raw`\ud83d`)
    expect(isAsciiRoundTripSafe(JSON.parse(stripPrefix(text)), broken)).toBe(false)
  })
})

/** 剥掉外壳，只为在测试里拿到「原始对象」做对比 */
function stripPrefix(text: string): string {
  return text.replace(/^[\s\S]*?export\s+default\s+/u, '').replace(/;\s*$/u, '')
}

describe('parseLocaleManifest', () => {
  /** 一份合法清单 */
  const validManifest = {
    schemaVersion: 1,
    sourceLocale: 'zh-CN',
    keyCount: 415,
    locales: [
      {
        code: 'zh-CN',
        name: 'Simplified Chinese',
        nativeName: '简体中文',
        version: '2.3.0',
        updatedAt: '2026-11-01',
        keyCount: 415,
        coverage: 100,
        sha256: 'a'.repeat(64),
        bytes: 36_549,
      },
    ],
  }

  it('解析合法清单', () => {
    const manifest = parseLocaleManifest(validManifest)
    expect(manifest?.locales).toHaveLength(1)
    expect(manifest?.locales[0]?.code).toBe('zh-CN')
    expect(manifest?.keyCount).toBe(415)
  })

  it('schemaVersion 不符整份作废', () => {
    expect(parseLocaleManifest({ ...validManifest, schemaVersion: 2 })).toBeNull()
    expect(parseLocaleManifest({ ...validManifest, schemaVersion: '1' })).toBeNull()
  })

  it('sourceLocale 不是简体时整份作废', () => {
    expect(parseLocaleManifest({ ...validManifest, sourceLocale: 'en' })).toBeNull()
  })

  it('locales 不是数组时整份作废', () => {
    expect(parseLocaleManifest({ ...validManifest, locales: {} })).toBeNull()
  })

  it('sha256 不合法的条目被丢掉（没有哈希就等于没有校验）', () => {
    const broken = {
      ...validManifest,
      locales: [{ ...validManifest.locales[0], sha256: 'not-a-hash' }],
    }
    expect(parseLocaleManifest(broken)).toBeNull()
  })

  it('bytes 为 0 的条目被丢掉', () => {
    const broken = { ...validManifest, locales: [{ ...validManifest.locales[0], bytes: 0 }] }
    expect(parseLocaleManifest(broken)).toBeNull()
  })

  it('不受支持的语言代码被丢掉，其余条目仍可用', () => {
    const broken = {
      ...validManifest,
      locales: [validManifest.locales[0], { ...validManifest.locales[0], code: 'ja' }],
    }
    const manifest = parseLocaleManifest(broken)
    expect(manifest?.locales.map((entry) => entry.code)).toEqual(['zh-CN'])
  })

  it('同一语言重复出现时只认第一条', () => {
    const duplicated = {
      ...validManifest,
      locales: [
        { ...validManifest.locales[0], version: '1.0.0' },
        { ...validManifest.locales[0], version: '2.0.0' },
      ],
    }
    expect(parseLocaleManifest(duplicated)?.locales[0]?.version).toBe('1.0.0')
  })

  it('不是对象时返回 null', () => {
    expect(parseLocaleManifest(null)).toBeNull()
    expect(parseLocaleManifest('x')).toBeNull()
  })
})

describe('loadLocaleManifest', () => {
  const remoteText = buildPackText('en')
  /** 清单条目要在 describe 阶段就算好（哈希是异步的，注入器本身是同步函数） */
  const enEntry = entryFor('en', remoteText)
  const remoteIndexUrl = `${RAW_BASE}/locales/index.js`

  it('在线清单可用时用在线那份', async () => {
    const fetchFunction = stubFetch({
      [remoteIndexUrl]: `export default ${JSON.stringify(manifestWith([await enEntry]))};`,
    })
    const loaded = await loadLocaleManifest({ fetchFunction })
    expect(loaded.origin).toBe('remote')
    expect(loaded.manifest?.locales[0]?.code).toBe('en')
  })

  it('在线失败回落内置清单', async () => {
    const entry = await enEntry
    setManifestImporterForTest(() => Promise.resolve({ default: manifestWith([entry]) }))
    const loaded = await loadLocaleManifest({ fetchFunction: stubFetch({}) })
    expect(loaded.origin).toBe('bundled')
    expect(loaded.manifest?.locales).toHaveLength(1)
  })

  it('不传 fetch 时只读内置清单（离线也能用）', async () => {
    const entry = await enEntry
    setManifestImporterForTest(() => Promise.resolve({ default: manifestWith([entry]) }))
    const loaded = await loadLocaleManifest()
    expect(loaded.origin).toBe('bundled')
  })

  it('两处都失败时 detail 里两段原因都在', async () => {
    setManifestImporterForTest(() => Promise.reject(new Error('内置文件缺失')))
    const loaded = await loadLocaleManifest({ fetchFunction: stubFetch({}) })
    expect(loaded.origin).toBe('none')
    expect(loaded.manifest).toBeNull()
    expect(loaded.detail).toContain('404')
    expect(loaded.detail).toContain('内置文件缺失')
  })

  it('在线内容不是合法清单时同样回落', async () => {
    const entry = await enEntry
    setManifestImporterForTest(() => Promise.resolve({ default: manifestWith([entry]) }))
    const fetchFunction = stubFetch({
      [remoteIndexUrl]: 'export default {"schemaVersion":9};',
    })
    const loaded = await loadLocaleManifest({ fetchFunction })
    expect(loaded.origin).toBe('bundled')
  })
})

describe('comparePackState', () => {
  const entry = {
    code: 'en' as const,
    name: 'en',
    nativeName: 'en',
    version: '2.3.0',
    updatedAt: '2026-11-01',
    keyCount: 1,
    coverage: 100,
    sha256: 'a'.repeat(64),
    bytes: 1,
  }

  it('本地没有 → missing', () => {
    expect(comparePackState(entry, undefined)).toBe('missing')
  })

  it('版本与日期都一致 → current', () => {
    expect(comparePackState(entry, { version: '2.3.0', updatedAt: '2026-11-01' })).toBe('current')
  })

  it('只改日期也算过期（版本号忘 bump 时靠它兜住）', () => {
    expect(comparePackState(entry, { version: '2.3.0', updatedAt: '2026-10-01' })).toBe('outdated')
  })

  it('只改版本也算过期', () => {
    expect(comparePackState(entry, { version: '2.2.0', updatedAt: '2026-11-01' })).toBe('outdated')
  })
})

describe('installLocalePacks', () => {
  it('全部成功：逐语言写盘、内容纯 ASCII、目录已存在时不重复创建', async () => {
    const fso = stubFso({
      existingFolders: LOCALE_CODES.map((code) => `${ADDIN_ROOT}/locales/${code}`),
    })
    const texts: Record<string, string> = {}
    const entries: LocaleManifestEntry[] = []
    for (const code of LOCALE_CODES) {
      texts[`${RAW_BASE}/locales/${code}/locale.js`] = buildPackText(code)
      entries.push(await entryFor(code, texts[`${RAW_BASE}/locales/${code}/locale.js`] ?? ''))
    }

    const outcome = await installLocalePacks({
      baseUrl: ADDIN_BASE_URL,
      manifest: manifestWith(entries),
      fetchFunction: stubFetch(texts),
      subtle: crypto.subtle,
    })

    expect(outcome.status).toBe('installed')
    expect(outcome.directory).toBe(String.raw`C:\jsaddons\p`)
    expect(fso.files.size).toBe(LOCALE_CODES.length)
    expect(fso.createdFolders).toEqual([])
    // isUnicode 必须是 false：写 UTF-16 会把模块写坏
    expect(fso.writtenFlags).toEqual([false, false, false])
    for (const [, content] of fso.files) {
      expect(isPureAscii(content)).toBe(true)
      expect(content.startsWith('export default {')).toBe(true)
    }
    // 装完立刻生效：仓库里已经是新版本
    expect(getLocaleBundle('en')?.version).toBe('2.3.0')
  })

  it('目录被删过也能恢复：缺哪个建哪个', async () => {
    const fso = stubFso({ existingFolders: [`${ADDIN_ROOT}/locales/zh-CN`] })
    const text = buildPackText('en')
    const outcome = await installLocalePacks({
      baseUrl: ADDIN_BASE_URL,
      manifest: manifestWith([await entryFor('en', text)]),
      fetchFunction: stubFetch({ [`${RAW_BASE}/locales/en/locale.js`]: text }),
      subtle: crypto.subtle,
    })
    expect(outcome.status).toBe('installed')
    expect(fso.createdFolders).toEqual([`${ADDIN_ROOT}/locales/en`])
  })

  it('字节数不一致 → 拒绝写入', async () => {
    const fso = stubFso()
    const text = buildPackText('en')
    const outcome = await installLocalePacks({
      baseUrl: ADDIN_BASE_URL,
      manifest: manifestWith([await entryFor('en', text, { bytes: 999 })]),
      fetchFunction: stubFetch({ [`${RAW_BASE}/locales/en/locale.js`]: text }),
      subtle: crypto.subtle,
    })
    expect(outcome.status).toBe('failed')
    expect(outcome.detail).toContain('大小不一致')
    expect(fso.files.size).toBe(0)
  })

  it('SHA-256 不一致 → 拒绝写入（供应链那一关）', async () => {
    const fso = stubFso()
    const text = buildPackText('en')
    const outcome = await installLocalePacks({
      baseUrl: ADDIN_BASE_URL,
      manifest: manifestWith([await entryFor('en', text, { sha256: 'b'.repeat(64) })]),
      fetchFunction: stubFetch({ [`${RAW_BASE}/locales/en/locale.js`]: text }),
      subtle: crypto.subtle,
    })
    expect(outcome.status).toBe('failed')
    expect(outcome.detail).toContain('SHA-256 不一致')
    expect(fso.files.size).toBe(0)
  })

  it('环境没有 WebCrypto → 拒绝写入（不拿没校验的内容落盘）', async () => {
    const fso = stubFso()
    const text = buildPackText('en')
    const outcome = await installLocalePacks({
      baseUrl: ADDIN_BASE_URL,
      manifest: manifestWith([await entryFor('en', text)]),
      fetchFunction: stubFetch({ [`${RAW_BASE}/locales/en/locale.js`]: text }),
      subtle: null,
    })
    expect(outcome.status).toBe('failed')
    expect(outcome.detail).toContain('不支持 SHA-256')
    expect(fso.files.size).toBe(0)
  })

  it('哈希对得上但夹带了别的语句 → 解析阶段就拒掉', async () => {
    const fso = stubFso()
    const text = `${buildPackText('en')}fetch('http://evil.example')`
    const outcome = await installLocalePacks({
      baseUrl: ADDIN_BASE_URL,
      manifest: manifestWith([await entryFor('en', text)]),
      fetchFunction: stubFetch({ [`${RAW_BASE}/locales/en/locale.js`]: text }),
      subtle: crypto.subtle,
    })
    expect(outcome.status).toBe('failed')
    expect(outcome.detail).toContain('不是合法的语言包')
    expect(fso.files.size).toBe(0)
  })

  it('下载失败 → 该语言失败，其余照常', async () => {
    stubFso()
    const goodText = buildPackText('zh-CN')
    const outcome = await installLocalePacks({
      baseUrl: ADDIN_BASE_URL,
      manifest: manifestWith([
        await entryFor('zh-CN', goodText),
        await entryFor('en', buildPackText('en')),
      ]),
      fetchFunction: stubFetch({ [`${RAW_BASE}/locales/zh-CN/locale.js`]: goodText }),
      subtle: crypto.subtle,
    })
    expect(outcome.status).toBe('partial')
    expect(outcome.reports.map((report) => report.status)).toEqual(['installed', 'failed'])
    expect(outcome.detail).toContain('1 个失败')
  })

  it('写盘失败 → 该语言报失败，且不污染仓库缓存', async () => {
    stubFso({ failWrite: true })
    const text = buildPackText('en')
    const outcome = await installLocalePacks({
      baseUrl: ADDIN_BASE_URL,
      manifest: manifestWith([await entryFor('en', text)]),
      fetchFunction: stubFetch({ [`${RAW_BASE}/locales/en/locale.js`]: text }),
      subtle: crypto.subtle,
    })
    expect(outcome.status).toBe('failed')
    expect(outcome.detail).toContain('无法写入')
    expect(getLocaleBundle('en')).toBeUndefined()
  })

  it('开发期（http）无法定位加载项目录 → unsupported', async () => {
    const outcome = await installLocalePacks({
      baseUrl: 'http://localhost:5173',
      manifest: manifestWith([await entryFor('en', buildPackText('en'))]),
      fetchFunction: stubFetch({}),
      subtle: crypto.subtle,
    })
    expect(outcome.status).toBe('unsupported')
    expect(outcome.directory).toBe('')
    expect(outcome.reports).toEqual([])
  })
})

describe('describeInstalledPacks', () => {
  it('未加载的语言标「未安装」', () => {
    expect(describeInstalledPacks(['en'])).toBe('en 未安装')
  })

  it('已加载的带上版本与日期', () => {
    const bundle = parseLocaleBundle(JSON.parse(stripPrefix(buildPackText('en'))), 'en')
    expect(bundle).not.toBeNull()
    if (bundle === null) return
    replaceLocaleBundle(bundle)
    expect(describeInstalledPacks(['en'])).toBe('en 2.3.0（2026-11-01）')
  })

  it('空列表给空串', () => {
    expect(describeInstalledPacks([])).toBe('')
  })
})

describe('openLocaleDirectory', () => {
  it('宿主没有 ShellExecute → 报失败而不是静默', () => {
    const outcome = openLocaleDirectory(ADDIN_BASE_URL)
    expect(outcome.ok).toBe(false)
    expect(outcome.directory).toBe(`${ADDIN_ROOT}/locales`)
    expect(outcome.detail).toContain('ShellExecute')
  })

  it('有 ShellExecute → 传入 locales 目录', () => {
    const shellExecute = vi.fn()
    ;(window as unknown as { Application: unknown }).Application = {
      OAAssist: { ShellExecute: shellExecute },
    }
    const outcome = openLocaleDirectory(ADDIN_BASE_URL)
    expect(outcome.ok).toBe(true)
    expect(shellExecute).toHaveBeenCalledWith(`${ADDIN_ROOT}/locales`)
  })

  it('无法定位加载项目录 → 空目录 + 原因', () => {
    const outcome = openLocaleDirectory('http://localhost:5173')
    expect(outcome.ok).toBe(false)
    expect(outcome.directory).toBe('')
    expect(outcome.detail).toContain('无法定位加载项目录')
  })
})

describe('findManifestEntry', () => {
  it('按语言代码取条目', async () => {
    const entry = await entryFor('en', buildPackText('en'))
    const manifest = manifestWith([entry])
    expect(findManifestEntry(manifest, 'en')).toBe(entry)
    expect(findManifestEntry(manifest, 'zh-TW')).toBeUndefined()
  })
})
