// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll, beforeEach } from 'vitest'

// 与 tests/gistSync.test.ts / gitlabSync.test.ts 一致：
// syncSourceRegistry.ts 在模块加载时会注册 'github' / 'gitlab' / 'gitee'，
// 触发 githubSync.ts / gitlabSync.ts / giteeSync.ts →
// tools/util.js → tools/wps.js → index.js → ui/handlers.js 的副作用链，
// handlers.js 顶层访问 document.readyState 并通过 trackedSetTimeout 调度延迟回调。
// 使用 fake timers 使这些 setTimeout 进入 fake 队列而不会真实触发。
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

// mock githubConfig 模块：buildGiteeRawUrl 与 validateConfig 依赖
// getGithubConfig / isGithubConfigComplete，通过 mock 控制其返回值以测试各分支。
vi.mock('../ts/sync/githubConfig.js', () => ({
  getGithubConfig: vi.fn(),
  isGithubConfigComplete: vi.fn(),
  buildRawUrl: vi.fn(),
  getSyncSourceType: vi.fn(() => 'gitee'),
  setSyncSourceType: vi.fn(() => true),
  getSyncStrategy: vi.fn(() => 'add-update'),
  setSyncStrategy: vi.fn(() => true),
  setGithubConfig: vi.fn(() => true),
  DEFAULT_GITHUB_CONFIG: Object.freeze({
    owner: 'awujiana',
    repo: 'Bangumi-Archive-Anime-Excel-to-sync',
    branch: 'main',
    path: 'data.jsonl',
    sourceType: 'github',
  }),
}))

// Mock githubSyncDiff 以覆盖 parseJsonl 异常分支
const mockParseJsonl = vi.hoisted(() => vi.fn())
const realParseJsonlHolder = vi.hoisted(() => ({
  current: null as ((text: string) => { entries: unknown[]; errors: unknown[] }) | null,
}))
vi.mock('../ts/sync/githubSyncDiff.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/sync/githubSyncDiff.js')>(
    '../ts/sync/githubSyncDiff.js',
  )
  realParseJsonlHolder.current = actual.parseJsonl
  mockParseJsonl.mockImplementation((text: string) => realParseJsonlHolder.current!(text))
  return {
    ...actual,
    parseJsonl: mockParseJsonl,
  }
})

import { buildGiteeRawUrl, fetchGiteeJson, GiteeSyncSource } from '../ts/sync/giteeSync.js'
import {
  getSyncSource,
  isSyncSourceRegistered,
  getRegisteredSourceTypes,
} from '../ts/sync/syncSourceRegistry.js'
import { BgmError } from '../ts/core/result.js'
import { getGithubConfig, isGithubConfigComplete } from '../ts/sync/githubConfig.js'

const mockedGetGithubConfig = vi.mocked(getGithubConfig)
const mockedIsGithubConfigComplete = vi.mocked(isGithubConfigComplete)
const mockedParseJsonl = vi.mocked(mockParseJsonl)

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

class MockXHR {
  status = 0
  statusText = ''
  responseText = ''
  timeout = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  private method = ''
  private url = ''
  private async = true
  private headers: Record<string, string> = {}
  private _aborted = false

  open(method: string, url: string, async: boolean): void {
    this.method = method
    this.url = url
    this.async = async
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value
  }

  addEventListener(event: string, handler: () => void): void {
    if (event === 'abort') {
      this.onabort = handler
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
    lastMockXhr = this
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
  ;(globalThis as { XMLHttpRequest: typeof MockXHR }).XMLHttpRequest = MockXHR
  lastXhrCall = null
  lastMockXhr = null
}

beforeEach(() => {
  installMockXhr()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.clearAllMocks()
  if (mockXhrConstructor !== null) {
    ;(globalThis as { XMLHttpRequest?: typeof MockXHR }).XMLHttpRequest = mockXhrConstructor
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

// ========== fetchGiteeJson ==========
describe('fetchGiteeJson', () => {
  beforeEach(() => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'testuser',
      repo: 'testrepo',
      branch: 'main',
      path: 'data.jsonl',
      sourceType: 'gitee',
    })
    mockedIsGithubConfigComplete.mockReturnValue(true)
  })

  it('成功下载并解析 JSONL', async () => {
    const jsonlContent = '{"sid":"1","name":"条目1"}\n{"sid":"2","name":"条目2"}'
    const promise = fetchGiteeJson()
    lastMockXhr!._respondOk(jsonlContent)
    const entries = await promise
    expect(entries.length).toBe(2)
    expect(entries[0]!.sid).toBe('1')
    expect(entries[1]!.sid).toBe('2')
  })

  it('请求构造正确的 Gitee URL', async () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'myowner',
      repo: 'myrepo',
      branch: 'develop',
      path: 'data.jsonl',
      sourceType: 'gitee',
    })
    const promise = fetchGiteeJson()
    lastMockXhr!._respondOk('{"sid":"1"}')
    await promise
    expect(lastXhrCall?.url).toBe('https://gitee.com/myowner/myrepo/raw/develop/data.jsonl')
    expect(lastXhrCall?.method).toBe('GET')
  })

  it('设置 Accept 请求头为 application/json', async () => {
    const promise = fetchGiteeJson()
    lastMockXhr!._respondOk('{"sid":"1"}')
    await promise
    expect(lastXhrCall?.headers['Accept']).toBe('application/json')
  })

  it('设置 30 秒超时', async () => {
    const promise = fetchGiteeJson()
    lastMockXhr!._respondOk('{"sid":"1"}')
    await promise
    expect(lastXhrCall?.timeout).toBe(30000)
  })

  it('配置不完整时 reject', async () => {
    mockedIsGithubConfigComplete.mockReturnValue(false)
    await expect(fetchGiteeJson()).rejects.toThrow(/Gitee 仓库配置不完整/)
  })

  it('HTTP 404 时 reject', async () => {
    const promise = fetchGiteeJson()
    lastMockXhr!._respondError(404, 'Not Found')
    await expect(promise).rejects.toThrow(/文件不存在（404）/)
  })

  it('HTTP 403 时 reject', async () => {
    const promise = fetchGiteeJson()
    lastMockXhr!._respondError(403, 'Forbidden')
    await expect(promise).rejects.toThrow(/访问被拒（403）/)
  })

  it('其他 HTTP 错误时 reject', async () => {
    const promise = fetchGiteeJson()
    lastMockXhr!._respondError(500, 'Internal Server Error')
    await expect(promise).rejects.toThrow(/HTTP 错误 500/)
  })

  it('网络错误时 reject', async () => {
    const promise = fetchGiteeJson()
    lastMockXhr!._triggerError()
    await expect(promise).rejects.toThrow(/网络请求失败/)
  })

  it('请求超时时 reject', async () => {
    const promise = fetchGiteeJson()
    lastMockXhr!._triggerTimeout()
    await expect(promise).rejects.toThrow(/请求超时（30000ms）/)
  })

  it('AbortSignal 已 aborted 时立即 reject', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(fetchGiteeJson(controller.signal)).rejects.toThrow(/请求被取消/)
  })

  it('AbortSignal abort 事件触发 xhr.abort()', async () => {
    const controller = new AbortController()
    const promise = fetchGiteeJson(controller.signal)
    // 触发 abort 事件（模拟 signal.abort）
    lastMockXhr!._triggerAbort()
    // 同时 xhr.onerror 会因 signal.aborted 为 true 而 reject 为取消
    Object.defineProperty(controller.signal, 'aborted', { value: true })
    lastMockXhr!._triggerError()
    await expect(promise).rejects.toThrow(/请求被取消/)
  })

  it('解析结果全为非法行时 reject', async () => {
    const jsonlContent = 'invalid json\nalso broken\n'
    const promise = fetchGiteeJson()
    lastMockXhr!._respondOk(jsonlContent)
    await expect(promise).rejects.toThrow(/JSONL 解析失败/)
  })

  it('部分非法行仍返回合法条目', async () => {
    const jsonlContent = '{"sid":"1","name":"有效"}\ninvalid\n{"sid":"2","name":"也有效"}'
    const promise = fetchGiteeJson()
    lastMockXhr!._respondOk(jsonlContent)
    const entries = await promise
    expect(entries.length).toBe(2)
    expect(entries[0]!.sid).toBe('1')
    expect(entries[1]!.sid).toBe('2')
  })

  it('空 JSONL 返回空数组', async () => {
    const promise = fetchGiteeJson()
    lastMockXhr!._respondOk('')
    const entries = await promise
    expect(entries).toEqual([])
  })

  it('单行有效 JSONL', async () => {
    const jsonlContent = '{"sid":"42","name":"单条记录","updatedAt":"2026-08-01"}'
    const promise = fetchGiteeJson()
    lastMockXhr!._respondOk(jsonlContent)
    const entries = await promise
    expect(entries.length).toBe(1)
    expect(entries[0]!.sid).toBe('42')
    expect(entries[0]!.name).toBe('单条记录')
    expect(entries[0]!.updatedAt).toBe('2026-08-01')
  })

  it('buildGiteeRawUrl 抛出非 Error 时被包装为 Error (line 76)', async () => {
    mockedGetGithubConfig.mockImplementation(() => {
      throw '非 Error 异常：配置获取失败'
    })
    await expect(fetchGiteeJson()).rejects.toThrow(/非 Error 异常/)
  })

  it('parseJsonl 抛出异常时 reject (line 123)', async () => {
    mockedParseJsonl.mockImplementationOnce(() => {
      throw new Error('JSON 解析器内部错误')
    })
    const promise = fetchGiteeJson()
    lastMockXhr!._respondOk('{"sid":"1"}')
    await expect(promise).rejects.toThrow(/JSONL 解析失败/)
  })

  it('parseJsonl 抛出非 Error 时使用 String() 转换 (line 123)', async () => {
    mockedParseJsonl.mockImplementationOnce(() => {
      throw '字符串异常'
    })
    const promise = fetchGiteeJson()
    lastMockXhr!._respondOk('{"sid":"1"}')
    await expect(promise).rejects.toThrow(/JSONL 解析失败: 字符串异常/)
  })

  it('AbortSignal abort 事件触发时 xhr.abort() 被调用 (line 95)', async () => {
    const controller = new AbortController()
    const promise = fetchGiteeJson(controller.signal)
    controller.abort()
    expect(lastMockXhr!._aborted).toBe(true)
    lastMockXhr!._triggerError()
    await expect(promise).rejects.toThrow(/请求被取消/)
  })
})

// ========== GiteeSyncSource.fetchRemoteEntries ==========
describe('GiteeSyncSource.fetchRemoteEntries', () => {
  beforeEach(() => {
    mockedGetGithubConfig.mockReturnValue({
      owner: 'testuser',
      repo: 'testrepo',
      branch: 'main',
      path: 'data.jsonl',
      sourceType: 'gitee',
    })
    mockedIsGithubConfigComplete.mockReturnValue(true)
  })

  it('委托给 fetchGiteeJson 并返回条目', async () => {
    const source = new GiteeSyncSource()
    const jsonlContent = '{"sid":"1","name":"条目1"}'
    const promise = source.fetchRemoteEntries()
    lastMockXhr!._respondOk(jsonlContent)
    const entries = await promise
    expect(entries.length).toBe(1)
    expect(entries[0]!.sid).toBe('1')
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
