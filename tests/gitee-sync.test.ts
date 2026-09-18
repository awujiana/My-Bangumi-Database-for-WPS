// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll, beforeEach } from 'vitest'

// 与 tests/gistSync.test.ts / gitlabSync.test.ts 一致：
// syncSourceRegistry.ts 在模块加载时会注册 'github' / 'gitlab' / 'gitee'，
// 触发 githubSync.ts / gitlabSync.ts / giteeSync.ts →
// tools/utility.js → tools/wps.js → index.js → ui/handlers.js 的副作用链，
// handlers.js 顶层访问 document.readyState 并通过 trackedSetTimeout 调度延迟回调。
// 使用 fake timers 使这些 setTimeout 进入 fake 队列而不会真实触发。
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

// mock githubConfig 模块：buildGiteeRawUrl 与 validateConfig 依赖
// getGithubConfig / isGithubConfigComplete，通过 mock 控制其返回值以测试各分支。
vi.mock('../ts/sync/github-config.js', () => ({
  getGithubConfig: vi.fn(),
  isGithubConfigComplete: vi.fn(),
  buildRawUrl: vi.fn(),
  getManualShards: vi.fn(() => []),
  getSyncSourceType: vi.fn(() => 'gitee'),
  setSyncSourceType: vi.fn(() => true),
  getSyncStrategy: vi.fn(() => 'add-update'),
  setSyncStrategy: vi.fn(() => true),
  setGithubConfig: vi.fn(() => true),
  DEFAULT_GITHUB_CONFIG: Object.freeze({
    owner: 'awujiana',
    repo: 'Bangumi-Archive-Anime-Excel-to-sync',
    branch: 'main',
    path: 'data/anime.manifest.json',
    sourceType: 'github',
  }),
}))

import {
  buildGiteeRawUrl,
  fetchGiteeJson,
  fetchGiteeText,
  GiteeSyncSource,
} from '../ts/sync/gitee-sync.js'
import {
  getSyncSource,
  isSyncSourceRegistered,
  getRegisteredSourceTypes,
} from '../ts/sync/sync-source-registry.js'
import { BgmError } from '../ts/core/result.js'
import { getGithubConfig, isGithubConfigComplete } from '../ts/sync/github-config.js'

const mockedGetGithubConfig = vi.mocked(getGithubConfig)
const mockedIsGithubConfigComplete = vi.mocked(isGithubConfigComplete)

/** 分片清单路径（与生产默认值一致） */
const MANIFEST_PATH = 'data/anime.manifest.json'
/** base 片（必选）在仓库内的路径 */
const BASE_FILE = 'data/anime.base.jsonlines.gz'

/**
 * 构造一份最小分片清单：base（必选）+ summary（可选）
 *
 * 字段刻意与真实清单同形（每片都带 sid，其余字段不重叠），这样「连接键不参与
 * 选片匹配」的逻辑也在这一层被测到。
 */
function makeManifestText(): string {
  return JSON.stringify({
    formatVersion: 1,
    subjectType: 2,
    typeLabel: 'anime',
    updatedAt: '2026-09-08',
    recordCount: 1,
    shards: [
      { name: 'base', file: 'anime.base.jsonlines.gz', fields: ['sid', 'name', 'updatedAt'] },
      { name: 'summary', file: 'anime.summary.jsonlines.gz', fields: ['sid', 'summary'] },
    ],
  })
}

// 清空模块加载期间累积的 fake timers，避免它们在测试中被意外触发
vi.clearAllTimers()

// ========== XHR Mock 工具 ==========
interface MockXHRCall {
  method: string
  url: string
  async: boolean
  timeout: number
  headers: Record<string, string>
}

let lastXhrCall: MockXHRCall | null = null
let lastMockXhr: MockXHR | null = null
let mockXhrConstructor: typeof MockXHR | null = null

/**
 * 预置响应队列：每次 `send()` 消费一项并异步返回。
 *
 * 分片下载一次同步会发 1 + N 次请求（清单 + 各分片），逐个手动 `_respondOk`
 * 需要精确插入 microtask 让出点，很容易写脆；队列方式让测试只关心「按顺序返回什么」。
 * 队列为空时保持旧行为（测试手动调用 `_respondOk`）。
 */
let responseQueue: string[] = []

/** 记录最近一次 send() 创建的 MockXHR 实例（避免将 this 直接赋给模块变量触发 no-this-assignment） */
function recordLastMockXhr(xhr: MockXHR): void {
  lastMockXhr = xhr
}

class MockXHR {
  private method = ''

  private url = ''

  private async = true

  private headers: Record<string, string> = {}

  _aborted = false

  status = 0

  statusText = ''

  responseText = ''

  timeout = 0

  onload: (() => void) | null = null

  onerror: (() => void) | null = null

  ontimeout: (() => void) | null = null

  onabort: (() => void) | null = null

  open(method: string, url: string, isAsync: boolean): void {
    this.method = method
    this.url = url
    this.async = isAsync
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value
  }

  addEventListener(event: string, handler: () => void): void {
    switch (event) {
      case 'abort': {
        this.onabort = handler
        break
      }
      case 'load': {
        this.onload = handler
        break
      }
      case 'error': {
        this.onerror = handler
        break
      }
      default: {
        break
      }
    }
  }

  abort(): void {
    this._aborted = true
  }

  send(): void {
    lastXhrCall = {
      method: this.method,
      url: this.url,
      async: this.async,
      timeout: this.timeout,
      headers: { ...this.headers },
    }
    recordLastMockXhr(this)

    const queued = responseQueue.at(0)
    responseQueue = responseQueue.slice(1)
    if (queued !== undefined) {
      queueMicrotask(() => {
        this._respondOk(queued)
      })
    }
  }

  _respondOk(body: string, status = 200): void {
    this.status = status
    this.statusText = 'OK'
    this.responseText = body
    if (this.onload) this.onload()
  }

  _respondError(status: number, statusText = 'Error'): void {
    this.status = status
    this.statusText = statusText
    this.responseText = ''
    if (this.onload) this.onload()
  }

  _triggerError(): void {
    if (this.onerror) this.onerror()
  }

  _triggerTimeout(): void {
    if (this.ontimeout) this.ontimeout()
  }

  _triggerAbort(): void {
    if (this.onabort) this.onabort()
  }
}

function installMockXhr(): void {
  mockXhrConstructor = MockXHR
  Reflect.set(globalThis, 'XMLHttpRequest', MockXHR)
  lastXhrCall = null
  lastMockXhr = null
}

beforeEach(() => {
  installMockXhr()
  responseQueue = []
})

afterEach(() => {
  vi.clearAllTimers()
  vi.clearAllMocks()
  if (mockXhrConstructor !== null) {
    Reflect.set(globalThis, 'XMLHttpRequest', mockXhrConstructor)
    mockXhrConstructor = null
  }
})

afterAll(() => {
  vi.useRealTimers()
})

// ========== 接口基础行为 ==========
describe('GiteeSyncSource 接口', () => {
  it('getSourceType 返回 gitee', () => {
    const source = new GiteeSyncSource()
    expect(source.getSourceType()).toBe('gitee')
  })

  it('getDisplayName 返回 Gitee', () => {
    const source = new GiteeSyncSource()
    expect(source.getDisplayName()).toBe('Gitee')
  })
})

// ========== URL 构建（核心差异点） ==========
describe('buildGiteeRawUrl', () => {
  it('构造正确的 Gitee Raw URL（含 /raw/ 段，不含 /-/）', () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'myname',
      repo: 'myrepo',
      branch: 'main',
      path: 'data.jsonl',
      sourceType: 'gitee',
    })
    mockedIsGithubConfigComplete.mockReturnValue(true)

    const url = buildGiteeRawUrl()
    expect(url).toBe('https://gitee.com/myname/myrepo/raw/main/data.jsonl')
  })

  it('URL 中包含 /raw/ 段（与 GitHub 一致，与 GitLab /-/raw/ 不同）', () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'owner',
      repo: 'repo',
      branch: 'branch',
      path: 'path',
      sourceType: 'gitee',
    })
    mockedIsGithubConfigComplete.mockReturnValue(true)

    const url = buildGiteeRawUrl()
    expect(url).toContain('/raw/')
    expect(url).not.toContain('/-/raw/')
    expect(url).not.toContain('raw.githubusercontent.com')
    expect(url).toBe('https://gitee.com/owner/repo/raw/branch/path')
  })

  it('URL 以 https://gitee.com/ 开头', () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'o',
      repo: 'r',
      branch: 'b',
      path: 'p.jsonl',
      sourceType: 'gitee',
    })
    mockedIsGithubConfigComplete.mockReturnValue(true)

    const url = buildGiteeRawUrl()
    expect(url.startsWith('https://gitee.com/')).toBe(true)
  })

  it('branch 为空时使用默认 main', () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'o',
      repo: 'r',
      branch: '',
      path: 'p.jsonl',
      sourceType: 'gitee',
    })
    mockedIsGithubConfigComplete.mockReturnValue(true)

    const url = buildGiteeRawUrl()
    expect(url).toBe('https://gitee.com/o/r/raw/main/p.jsonl')
  })

  it('配置不完整时抛出 Error', () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: '',
      repo: '',
      branch: '',
      path: '',
      sourceType: 'gitee',
    })
    mockedIsGithubConfigComplete.mockReturnValue(false)

    expect(() => buildGiteeRawUrl()).toThrow(/Gitee 仓库配置不完整/)
  })
})

// ========== fetchGiteeText（传输层：一次 GET + 解码） ==========
describe('fetchGiteeText', () => {
  beforeEach(() => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'testuser',
      repo: 'testrepo',
      branch: 'main',
      path: MANIFEST_PATH,
      sourceType: 'gitee',
    })
    mockedIsGithubConfigComplete.mockReturnValue(true)
  })

  it('成功下载并返回文本', async () => {
    const promise = fetchGiteeText(BASE_FILE)
    lastMockXhr!._respondOk('["sid","name"]\n["1","条目1"]')
    await expect(promise).resolves.toBe('["sid","name"]\n["1","条目1"]')
  })

  it('请求构造正确的 Gitee URL（相对路径覆盖配置 path）', async () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'myowner',
      repo: 'myrepo',
      branch: 'develop',
      path: MANIFEST_PATH,
      sourceType: 'gitee',
    })
    const promise = fetchGiteeText(BASE_FILE)
    lastMockXhr!._respondOk('x')
    await promise
    expect(lastXhrCall?.url).toBe(`https://gitee.com/myowner/myrepo/raw/develop/${BASE_FILE}`)
    expect(lastXhrCall?.method).toBe('GET')
  })

  it('设置 Accept 请求头为 application/json', async () => {
    const promise = fetchGiteeText(BASE_FILE)
    lastMockXhr!._respondOk('x')
    await promise
    expect(lastXhrCall?.headers.Accept).toBe('application/json')
  })

  it('设置 30 秒超时', async () => {
    const promise = fetchGiteeText(BASE_FILE)
    lastMockXhr!._respondOk('x')
    await promise
    expect(lastXhrCall?.timeout).toBe(30_000)
  })

  it('配置不完整时 reject', async () => {
    mockedIsGithubConfigComplete.mockReturnValue(false)
    await expect(fetchGiteeText(BASE_FILE)).rejects.toThrow(/Gitee 仓库配置不完整/)
  })

  it('HTTP 404 时 reject', async () => {
    const promise = fetchGiteeText(BASE_FILE)
    lastMockXhr!._respondError(404, 'Not Found')
    await expect(promise).rejects.toThrow(/文件不存在（404）/)
  })

  it('HTTP 403 时 reject', async () => {
    const promise = fetchGiteeText(BASE_FILE)
    lastMockXhr!._respondError(403, 'Forbidden')
    await expect(promise).rejects.toThrow(/访问被拒（403）/)
  })

  it('其他 HTTP 错误时 reject', async () => {
    const promise = fetchGiteeText(BASE_FILE)
    lastMockXhr!._respondError(500, 'Internal Server Error')
    await expect(promise).rejects.toThrow(/HTTP 错误 500/)
  })

  it('网络错误时 reject', async () => {
    const promise = fetchGiteeText(BASE_FILE)
    lastMockXhr!._triggerError()
    await expect(promise).rejects.toThrow(/网络请求失败/)
  })

  it('请求超时时 reject', async () => {
    const promise = fetchGiteeText(BASE_FILE)
    lastMockXhr!._triggerTimeout()
    await expect(promise).rejects.toThrow(/请求超时（30000ms）/)
  })

  it('AbortSignal 已 aborted 时立即 reject', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(fetchGiteeText(BASE_FILE, controller.signal)).rejects.toThrow(/请求被取消/)
  })

  it('AbortSignal abort 事件触发 xhr.abort()', async () => {
    const controller = new AbortController()
    const promise = fetchGiteeText(BASE_FILE, controller.signal)
    // 触发 abort 事件（模拟 signal.abort）
    lastMockXhr!._triggerAbort()
    // 同时 xhr.onerror 会因 signal.aborted 为 true 而 reject 为取消
    Object.defineProperty(controller.signal, 'aborted', { value: true })
    lastMockXhr!._triggerError()
    await expect(promise).rejects.toThrow(/请求被取消/)
  })

  it('buildGiteeRawUrl 抛出非 Error 时被包装为 Error', async () => {
    mockedGetGithubConfig.mockImplementation(() => {
      throw '非 Error 异常：配置获取失败'
    })
    await expect(fetchGiteeText(BASE_FILE)).rejects.toThrow(/非 Error 异常/)
  })

  it('AbortSignal abort 事件触发时 xhr.abort() 被调用', async () => {
    const controller = new AbortController()
    const promise = fetchGiteeText(BASE_FILE, controller.signal)
    controller.abort()
    expect(lastMockXhr!._aborted).toBe(true)
    lastMockXhr!._triggerError()
    await expect(promise).rejects.toThrow(/请求被取消/)
  })
})

// ========== fetchGiteeJson（清单 → 选片 → 拼接） ==========
describe('fetchGiteeJson', () => {
  beforeEach(() => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'testuser',
      repo: 'testrepo',
      branch: 'main',
      path: MANIFEST_PATH,
      sourceType: 'gitee',
    })
    mockedIsGithubConfigComplete.mockReturnValue(true)
  })

  it('只需要 base 片时只发 2 次请求（清单 + base）', async () => {
    responseQueue = [makeManifestText(), '["sid","name","updatedAt"]\n["1","条目1","2026-09-08"]']
    const entries = await fetchGiteeJson(undefined, new Set())

    expect(responseQueue).toHaveLength(0)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.sid).toBe('1')
    expect(entries[0]!.name).toBe('条目1')
  })

  it('neededFields 为 undefined 时全量下载（保守兜底）', async () => {
    responseQueue = [
      makeManifestText(),
      '["sid","name","updatedAt"]\n["1","条目1","2026-09-08"]',
      '["sid","summary"]\n["1","简介1"]',
    ]
    const entries = await fetchGiteeJson()

    expect(entries[0]!.summary).toBe('简介1')
  })

  it('按 neededFields 带出对应分片并逐行拼接', async () => {
    responseQueue = [
      makeManifestText(),
      '["sid","name","updatedAt"]\n["1","条目1","2026-09-08"]',
      '["sid","summary"]\n["1","简介1"]',
    ]
    const entries = await fetchGiteeJson(undefined, new Set(['summary']))

    expect(entries[0]!.summary).toBe('简介1')
    expect(entries[0]!.name).toBe('条目1')
  })

  it('配置路径不是清单时给出明确报错', async () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'o',
      repo: 'r',
      branch: 'main',
      path: 'data/bangumi.jsonlines.gz',
      sourceType: 'gitee',
    })

    await expect(fetchGiteeJson()).rejects.toThrow(/必须是分片清单/)
  })

  it('清单读取失败时包装为可读错误', async () => {
    const promise = fetchGiteeJson()
    lastMockXhr!._respondError(404, 'Not Found')

    await expect(promise).rejects.toThrow(/分片清单读取失败/)
  })

  it('清单格式非法时报错', async () => {
    responseQueue = ['not json']

    await expect(fetchGiteeJson()).rejects.toThrow(/分片清单格式非法/)
  })

  it('分片表头非法时报错', async () => {
    responseQueue = [makeManifestText(), 'not-a-header']

    await expect(fetchGiteeJson(undefined, new Set())).rejects.toThrow(/分片表头非法/)
  })

  it('各分片行数不一致时报错', async () => {
    responseQueue = [
      makeManifestText(),
      '["sid","name","updatedAt"]\n["1","条目1","2026-09-08"]',
      '["sid","summary"]',
    ]

    await expect(fetchGiteeJson(undefined, new Set(['summary']))).rejects.toThrow(/分片拼接失败/)
  })

  it('拼接后全部缺少合法 sid 时报错', async () => {
    responseQueue = [makeManifestText(), '["sid","name","updatedAt"]\n[null,"条目1","2026-09-08"]']

    await expect(fetchGiteeJson(undefined, new Set())).rejects.toThrow(/没有可用记录/)
  })
})

// ========== GiteeSyncSource.fetchRemoteEntries ==========
describe('GiteeSyncSource.fetchRemoteEntries', () => {
  beforeEach(() => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'testuser',
      repo: 'testrepo',
      branch: 'main',
      path: MANIFEST_PATH,
      sourceType: 'gitee',
    })
    mockedIsGithubConfigComplete.mockReturnValue(true)
  })

  it('委托给 fetchGiteeJson 并返回条目', async () => {
    const source = new GiteeSyncSource()
    responseQueue = [makeManifestText(), '["sid","name","updatedAt"]\n["1","条目1","2026-09-08"]']

    const entries = await source.fetchRemoteEntries(undefined, { neededFields: new Set() })

    expect(entries).toHaveLength(1)
    expect(entries[0]!.sid).toBe('1')
  })

  it('把 neededFields 透传给选片逻辑', async () => {
    const source = new GiteeSyncSource()
    responseQueue = [
      makeManifestText(),
      '["sid","name","updatedAt"]\n["1","条目1","2026-09-08"]',
      '["sid","summary"]\n["1","简介1"]',
    ]

    const entries = await source.fetchRemoteEntries(undefined, {
      neededFields: new Set(['summary']),
    })

    expect(entries[0]!.summary).toBe('简介1')
  })

  it('传递已 aborted 的 AbortSignal 给 fetchGiteeJson', async () => {
    const source = new GiteeSyncSource()
    const controller = new AbortController()
    controller.abort()
    await expect(source.fetchRemoteEntries(controller.signal)).rejects.toThrow(/请求被取消/)
  })
})

// ========== 配置校验 ==========
describe('GiteeSyncSource.validateConfig', () => {
  it('配置完整时返回 Result.ok', () => {
    mockedIsGithubConfigComplete.mockReturnValue(true)
    const source = new GiteeSyncSource()
    const result = source.validateConfig()
    expect(result.isOk()).toBe(true)
  })

  it('配置不完整时返回 Result.fail 且 error 为 BgmError', () => {
    mockedIsGithubConfigComplete.mockReturnValue(false)
    const source = new GiteeSyncSource()
    const result = source.validateConfig()
    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BgmError)
    expect(result.error?.code).toBe('CONFIG_INCOMPLETE')
    expect(result.error?.message).toContain('Gitee')
  })

  it('owner 缺失时配置不完整', () => {
    mockedIsGithubConfigComplete.mockReturnValue(false)
    const source = new GiteeSyncSource()
    const result = source.validateConfig()
    expect(result.isFail()).toBe(true)
  })

  it('repo 缺失时配置不完整', () => {
    mockedIsGithubConfigComplete.mockReturnValue(false)
    const source = new GiteeSyncSource()
    const result = source.validateConfig()
    expect(result.isFail()).toBe(true)
  })

  it('path 缺失时配置不完整', () => {
    mockedIsGithubConfigComplete.mockReturnValue(false)
    const source = new GiteeSyncSource()
    const result = source.validateConfig()
    expect(result.isFail()).toBe(true)
  })
})

// ========== 注册表 ==========
describe('syncSourceRegistry: gitee 注册', () => {
  it('gitee 已注册', () => {
    expect(isSyncSourceRegistered('gitee')).toBe(true)
  })

  it('getSyncSource(gitee) 返回 GiteeSyncSource 实例', () => {
    const source = getSyncSource('gitee')
    expect(source).toBeInstanceOf(GiteeSyncSource)
    expect(source?.getSourceType()).toBe('gitee')
    expect(source?.getDisplayName()).toBe('Gitee')
  })

  it('getRegisteredSourceTypes 包含 gitee', () => {
    const types = getRegisteredSourceTypes()
    expect(types).toContain('gitee')
    expect(types).toContain('github')
    expect(types).toContain('gitlab')
  })

  it('每次调用 getSyncSource 返回新实例', () => {
    const s1 = getSyncSource('gitee')
    const s2 = getSyncSource('gitee')
    expect(s1).not.toBe(s2)
    expect(s1).toBeInstanceOf(GiteeSyncSource)
    expect(s2).toBeInstanceOf(GiteeSyncSource)
  })
})
