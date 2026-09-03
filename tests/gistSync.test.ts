// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll, beforeEach } from 'vitest'

// 与 tests/syncSource.test.ts / giteeSync.test.ts / localFileSync.test.ts 一致：
// syncSourceRegistry.ts 在模块加载时会注册 'github' / 'gitlab' / 'gitee' / 'local' / 'gist'，
// 触发 githubSync.ts / gitlabSync.ts / giteeSync.ts / localFileSync.ts / gistSync.ts →
// tools/util.js → tools/wps.js → index.js → ui/handlers.js 的副作用链，
// handlers.js 顶层访问 document.readyState 并通过 trackedSetTimeout 调度延迟回调。
// 使用 fake timers 使这些 setTimeout 进入 fake 队列而不会真实触发。
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

// mock githubConfig 模块：gistSync.ts 依赖 getGistId / isGistConfigured，
// 通过 mock 控制其返回值以测试各分支。
// 工厂函数必须提供 syncSourceRegistry 加载链中所有模块可能引入的 githubConfig 导出，
// 避免 TS 类型缺失（githubSync/gitlabSync/giteeSync/localFileSync 均从此模块导入）。
vi.mock('../ts/sync/githubConfig.js', () => ({
  getGithubConfig: vi.fn(),
  isGithubConfigComplete: vi.fn(),
  buildRawUrl: vi.fn(),
  getSyncSourceType: vi.fn(() => 'gist'),
  setSyncSourceType: vi.fn(() => true),
  getSyncStrategy: vi.fn(() => 'add-update'),
  setSyncStrategy: vi.fn(() => true),
  setGithubConfig: vi.fn(() => true),
  getGistId: vi.fn(() => ''),
  setGistId: vi.fn(() => true),
  isGistConfigured: vi.fn(() => false),
  DEFAULT_GITHUB_CONFIG: Object.freeze({
    owner: 'awujiana',
    repo: 'Bangumi-Archive-Anime-Excel-to-sync',
    branch: 'main',
    path: 'data.jsonl',
    sourceType: 'github',
  }),
}))

import {
  GistSyncSource,
  buildGistApiUrl,
  extractGistContent,
  fetchGistJson,
} from '../ts/sync/gistSync.js'
import {
  getSyncSource,
  isSyncSourceRegistered,
  getRegisteredSourceTypes,
} from '../ts/sync/syncSourceRegistry.js'
import { BgmError } from '../ts/core/result.js'
import { getGistId, isGistConfigured } from '../ts/sync/githubConfig.js'

const mockedGetGistId = vi.mocked(getGistId)
const mockedIsGistConfigured = vi.mocked(isGistConfigured)

// 清空模块加载期间累积的 fake timers，避免它们在测试中被意外触发
vi.clearAllTimers()

afterEach(() => {
  vi.clearAllTimers()
  vi.clearAllMocks()
  // 恢复 XMLHttpRequest（若被替换）
  if (mockXhrConstructor !== null) {
    ;(globalThis as { XMLHttpRequest?: typeof MockXHR }).XMLHttpRequest = mockXhrConstructor
    mockXhrConstructor = null
  }
})

afterAll(() => {
  vi.useRealTimers()
})

// ========== XHR Mock 工具 ==========
// 与 tests/localFileSync.test.ts 一致：提供可控制的 XMLHttpRequest mock，
// 支持 onload/onerror/ontimeout 触发。每个 MockXHR 实例捕获 open/send 调用，
// 测试通过 _respondOk / _respondError / _triggerError / _triggerTimeout 注入响应。

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

  _aborted = false

  private method = ''

  private url = ''

  private async = true

  private headers: Record<string, string> = {}

  open(method: string, url: string, async: boolean): void {
    this.method = method
    this.url = url
    this.async = async
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value
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

  // 测试辅助方法：模拟成功响应（默认 200）
  _respondOk(body: string, status = 200): void {
    this.status = status
    this.statusText = 'OK'
    this.responseText = body
    if (this.onload) this.onload()
  }

  // 测试辅助方法：模拟错误响应
  _respondError(status: number, statusText = 'Error'): void {
    this.status = status
    this.statusText = statusText
    this.responseText = ''
    if (this.onload) this.onload()
  }

  // 测试辅助方法：模拟网络错误
  _triggerError(): void {
    if (this.onerror) this.onerror()
  }

  // 测试辅助方法：模拟超时
  _triggerTimeout(): void {
    if (this.ontimeout) this.ontimeout()
  }
}

/** 安装 MockXHR 替换全局 XMLHttpRequest */
function installMockXhr(): void {
  mockXhrConstructor = MockXHR
  ;(globalThis as { XMLHttpRequest: typeof MockXHR }).XMLHttpRequest = MockXHR
  lastXhrCall = null
  lastMockXhr = null
}

beforeEach(() => {
  installMockXhr()
})

// ========== 接口基础行为 ==========
describe('GistSyncSource 接口', () => {
  it('getSourceType 返回 gist', () => {
    const source = new GistSyncSource()
    expect(source.getSourceType()).toBe('gist')
  })

  it('getDisplayName 返回 Gist', () => {
    const source = new GistSyncSource()
    expect(source.getDisplayName()).toBe('Gist')
  })
})

// ========== URL 构建 ==========
describe('buildGistApiUrl', () => {
  it('构造正确的 Gist API URL', () => {
    const url = buildGistApiUrl('abc123')
    expect(url).toBe('https://api.github.com/gists/abc123')
  })

  it('URL 以 https://api.github.com/gists/ 开头', () => {
    const url = buildGistApiUrl('myGistId123')
    expect(url.startsWith('https://api.github.com/gists/')).toBe(true)
  })

  it('gistId 为空时返回 base URL（无尾随 ID）', () => {
    const url = buildGistApiUrl('')
    expect(url).toBe('https://api.github.com/gists/')
  })

  it('不同 gistId 生成不同 URL', () => {
    expect(buildGistApiUrl('id1')).toBe('https://api.github.com/gists/id1')
    expect(buildGistApiUrl('id2')).toBe('https://api.github.com/gists/id2')
    expect(buildGistApiUrl('id1')).not.toBe(buildGistApiUrl('id2'))
  })
})

// ========== extractGistContent ==========
describe('extractGistContent', () => {
  it('null 输入返回空字符串', () => {
    expect(extractGistContent(null)).toBe('')
  })

  it('undefined 输入返回空字符串', () => {
    expect(extractGistContent(undefined)).toBe('')
  })

  it('非对象输入（如数字、字符串）返回空字符串', () => {
    expect(extractGistContent(123)).toBe('')
    expect(extractGistContent('string')).toBe('')
    expect(extractGistContent(true)).toBe('')
  })

  it('缺失 files 字段返回空字符串', () => {
    expect(extractGistContent({ id: 'gist1', description: 'no files' })).toBe('')
  })

  it('files 为 null 返回空字符串', () => {
    expect(extractGistContent({ files: null })).toBe('')
  })

  it('files 为非对象返回空字符串', () => {
    expect(extractGistContent({ files: 'not-an-object' })).toBe('')
  })

  it('单文件：返回该文件的 content', () => {
    const apiResponse = {
      files: {
        'data.jsonl': { content: '{"sid":"111","name":"条目A"}' },
      },
    }
    expect(extractGistContent(apiResponse)).toBe('{"sid":"111","name":"条目A"}')
  })

  it('多文件：用换行符拼接所有 content', () => {
    const apiResponse = {
      files: {
        'data1.jsonl': { content: '{"sid":"111"}' },
        'data2.jsonl': { content: '{"sid":"222"}' },
      },
    }
    const result = extractGistContent(apiResponse)
    expect(result).toBe('{"sid":"111"}\n{"sid":"222"}')
  })

  it('多文件按文件名字典序拼接（保证顺序确定）', () => {
    // 故意以非字典序输入，验证输出按字典序排序
    const apiResponse = {
      files: {
        'z-last.jsonl': { content: 'Z_CONTENT' },
        'a-first.jsonl': { content: 'A_CONTENT' },
        'm-middle.jsonl': { content: 'M_CONTENT' },
      },
    }
    const result = extractGistContent(apiResponse)
    expect(result).toBe('A_CONTENT\nM_CONTENT\nZ_CONTENT')
  })

  it('文件缺失 content 字段：跳过该文件', () => {
    const apiResponse = {
      files: {
        // 缺失 content
        'no-content.jsonl': {},
        'has-content.jsonl': { content: 'PRESENT' },
      },
    }
    expect(extractGistContent(apiResponse)).toBe('PRESENT')
  })

  it('文件 content 为 undefined：跳过该文件', () => {
    const apiResponse = {
      files: {
        'undef.jsonl': { content: undefined },
        'has.jsonl': { content: 'OK' },
      },
    }
    expect(extractGistContent(apiResponse)).toBe('OK')
  })

  it('文件 content 为空字符串：跳过该文件', () => {
    const apiResponse = {
      files: {
        'empty.jsonl': { content: '' },
        'has.jsonl': { content: 'OK' },
      },
    }
    expect(extractGistContent(apiResponse)).toBe('OK')
  })

  it('所有文件 content 均缺失：返回空字符串', () => {
    const apiResponse = {
      files: {
        'a.jsonl': {},
        'b.jsonl': { content: undefined },
        'c.jsonl': { content: '' },
      },
    }
    expect(extractGistContent(apiResponse)).toBe('')
  })

  it('files 为空对象：返回空字符串', () => {
    const apiResponse = { files: {} }
    expect(extractGistContent(apiResponse)).toBe('')
  })

  it('单文件 content 包含多行 JSONL：原样返回（不拆分）', () => {
    const multiLineContent = '{"sid":"111"}\n{"sid":"222"}\n{"sid":"333"}'
    const apiResponse = {
      files: {
        'data.jsonl': { content: multiLineContent },
      },
    }
    // 单文件 content 原样返回（内部多行交给 parseJsonl 处理）
    expect(extractGistContent(apiResponse)).toBe(multiLineContent)
  })

  it('文件 content 类型非法（非字符串）：跳过该文件（类型守卫拒绝）', () => {
    const apiResponse = {
      files: {
        // 非法 content 类型
        'numeric.jsonl': { content: 12_345 },
      },
    }
    // isGistFile 类型守卫拒绝 content 非 string 的文件，因此整个响应视为非法
    expect(extractGistContent(apiResponse)).toBe('')
  })

  it('Gist 完整响应（含 id/description/owner 等字段）：仅提取 files[*].content', () => {
    const fullGistResponse = {
      id: 'abc123',
      description: 'My bangumi data',
      public: true,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-21T00:00:00Z',
      owner: { login: 'myuser', id: 12_345 },
      files: {
        'data.jsonl': {
          filename: 'data.jsonl',
          language: 'JSON',
          raw_url: 'https://gist.githubusercontent.com/...',
          size: 42,
          content: '{"sid":"111","name":"测试"}',
        },
      },
    }
    expect(extractGistContent(fullGistResponse)).toBe('{"sid":"111","name":"测试"}')
  })
})

// ========== 配置校验 ==========
describe('GistSyncSource.validateConfig', () => {
  it('gist_id 已配置时返回 Result.ok', () => {
    mockedIsGistConfigured.mockReturnValue(true)
    const source = new GistSyncSource()
    const result = source.validateConfig()
    expect(result.isOk()).toBe(true)
  })

  it('gist_id 为空时返回 Result.fail 且 error 为 BgmError', () => {
    mockedIsGistConfigured.mockReturnValue(false)
    const source = new GistSyncSource()
    const result = source.validateConfig()
    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BgmError)
    expect(result.error?.code).toBe('CONFIG_INCOMPLETE')
    expect(result.error?.message).toContain('Gist')
  })

  it('不要求 owner/repo/branch/path（与 GitHub/GitLab/Gitee 不同）', () => {
    // Gist 仅校验 gist_id，不需要 owner/repo/branch/path
    // 通过 isGistConfigured 返回 true 验证：即使 owner/repo 均空，只要 gist_id 非空就通过
    mockedIsGistConfigured.mockReturnValue(true)
    const source = new GistSyncSource()
    const result = source.validateConfig()
    expect(result.isOk()).toBe(true)
  })

  it('gist_id 未配置时返回 fail（独立于 owner/repo/branch/path）', () => {
    // 即使 owner/repo 完整，gist_id 为空时仍 fail
    mockedIsGistConfigured.mockReturnValue(false)
    const source = new GistSyncSource()
    const result = source.validateConfig()
    expect(result.isFail()).toBe(true)
  })
})

// ========== fetchGistJson / fetchRemoteEntries ==========
describe('GistSyncSource.fetchRemoteEntries', () => {
  it('gist_id 未配置时抛出错误', async () => {
    mockedGetGistId.mockReturnValue('')
    const source = new GistSyncSource()
    await expect(source.fetchRemoteEntries()).rejects.toThrow(/Gist ID 未配置/)
  })

  it('成功响应：返回解析后的 JSONL 条目', async () => {
    mockedGetGistId.mockReturnValue('gist123')
    const jsonlContent =
      '{"sid":"111","name":"条目A","type":3,"score":8}\n{"sid":"222","name":"条目B","type":2,"score":9}'
    const gistApiResponse = {
      id: 'gist123',
      files: {
        'data.jsonl': { content: jsonlContent },
      },
    }
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    expect(lastXhrCall).not.toBeNull()
    expect(lastXhrCall?.url).toBe('https://api.github.com/gists/gist123')
    expect(lastXhrCall?.method).toBe('GET')
    expect(lastMockXhr).not.toBeNull()
    lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
    const entries = await promise
    expect(entries).toHaveLength(2)
    expect(entries[0]?.sid).toBe('111')
    expect(entries[0]?.name).toBe('条目A')
    expect(entries[1]?.sid).toBe('222')
    expect(entries[1]?.name).toBe('条目B')
  })

  it('多文件 Gist：拼接所有 content 后解析', async () => {
    mockedGetGistId.mockReturnValue('multi')
    const gistApiResponse = {
      files: {
        'data1.jsonl': { content: '{"sid":"111","name":"A"}' },
        'data2.jsonl': { content: '{"sid":"222","name":"B"}' },
      },
    }
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
    const entries = await promise
    expect(entries).toHaveLength(2)
    expect(entries[0]?.sid).toBe('111')
    expect(entries[1]?.sid).toBe('222')
  })

  it('空 content（files 为空对象）返回空数组', async () => {
    mockedGetGistId.mockReturnValue('empty')
    const gistApiResponse = { id: 'empty', files: {} }
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
    const entries = await promise
    expect(entries).toEqual([])
  })

  it('所有文件 content 缺失返回空数组', async () => {
    mockedGetGistId.mockReturnValue('nocontent')
    const gistApiResponse = {
      files: {
        'a.jsonl': {},
        'b.jsonl': { content: undefined },
      },
    }
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
    const entries = await promise
    expect(entries).toEqual([])
  })

  it('包含非法 JSONL 行时跳过非法行（不抛出，返回合法条目）', async () => {
    mockedGetGistId.mockReturnValue('mixed')
    // 第一行非法 JSON，第二行合法 JSONL，第三行缺少 sid
    const content = 'this is not json\n{"sid":"111","name":"条目A"}\n{"name":"no sid"}'
    const gistApiResponse = {
      files: { 'data.jsonl': { content } },
    }
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
    const entries = await promise
    // 仅第二行（合法且含 sid）应被解析
    expect(entries).toHaveLength(1)
    expect(entries[0]?.sid).toBe('111')
  })

  it('全部行非法时抛出错误', async () => {
    mockedGetGistId.mockReturnValue('allbad')
    const content = 'this is not json\nalso not json'
    const gistApiResponse = {
      files: { 'data.jsonl': { content } },
    }
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
    await expect(promise).rejects.toThrow(/JSONL 解析失败/)
  })

  it('响应非合法 JSON 时抛出错误', async () => {
    mockedGetGistId.mockReturnValue('badjson')
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    // 返回非 JSON 文本
    lastMockXhr!._respondOk('not a json response')
    await expect(promise).rejects.toThrow(/Gist 响应解析失败/)
  })

  it('HTTP 404 时抛出 Gist 不存在错误', async () => {
    mockedGetGistId.mockReturnValue('missing')
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    lastMockXhr!._respondError(404, 'Not Found')
    await expect(promise).rejects.toThrow(/Gist 不存在/)
  })

  it('HTTP 403 时抛出访问被拒错误', async () => {
    mockedGetGistId.mockReturnValue('forbidden')
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    lastMockXhr!._respondError(403, 'Forbidden')
    await expect(promise).rejects.toThrow(/访问被拒/)
  })

  it('网络错误（onerror）时 reject', async () => {
    mockedGetGistId.mockReturnValue('neterror')
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    lastMockXhr!._triggerError()
    await expect(promise).rejects.toThrow(/网络请求失败/)
  })

  it('超时时 reject', async () => {
    mockedGetGistId.mockReturnValue('timeout')
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    lastMockXhr!._triggerTimeout()
    await expect(promise).rejects.toThrow(/请求超时/)
  })

  it('AbortSignal 已 aborted 时立即抛出', async () => {
    mockedGetGistId.mockReturnValue('aborted')
    const controller = new AbortController()
    controller.abort()
    const source = new GistSyncSource()
    await expect(source.fetchRemoteEntries(controller.signal)).rejects.toThrow(/请求被取消/)
  })

  it('设置 Accept: application/vnd.github+json 请求头', async () => {
    mockedGetGistId.mockReturnValue('headercheck')
    const source = new GistSyncSource()
    const promise = source.fetchRemoteEntries()
    expect(lastXhrCall?.headers.Accept).toBe('application/vnd.github+json')
    lastMockXhr!._respondOk(JSON.stringify({ files: {} }))
    await promise
  })
})

// ========== fetchGistJson 直接调用（不通过 GistSyncSource 类） ==========
describe('fetchGistJson', () => {
  it('gist_id 为空时抛出错误（不发起 XHR）', async () => {
    mockedGetGistId.mockReturnValue('')
    await expect(fetchGistJson()).rejects.toThrow(/Gist ID 未配置/)
    // 不应发起任何 XHR 请求
    expect(lastXhrCall).toBeNull()
  })

  it('使用 buildGistApiUrl 构造的 URL 发起请求', async () => {
    mockedGetGistId.mockReturnValue('abc789')
    const promise = fetchGistJson()
    expect(lastXhrCall?.url).toBe('https://api.github.com/gists/abc789')
    lastMockXhr!._respondOk(JSON.stringify({ files: {} }))
    await promise
  })

  it('30 秒超时', async () => {
    mockedGetGistId.mockReturnValue('timeout30')
    const promise = fetchGistJson()
    expect(lastXhrCall?.timeout).toBe(30_000)
    lastMockXhr!._respondOk(JSON.stringify({ files: {} }))
    await promise
  })

  it('AbortSignal abort 事件触发时 xhr.abort() 被调用 (line 215)', async () => {
    mockedGetGistId.mockReturnValue('abort-test')
    const controller = new AbortController()
    const promise = fetchGistJson(controller.signal)
    controller.abort()
    expect(lastMockXhr!._aborted).toBe(true)
    lastMockXhr!._triggerError()
    await expect(promise).rejects.toThrow(/请求被取消/)
  })

  it('HTTP 500 时 reject 并返回错误信息 (line 267)', async () => {
    mockedGetGistId.mockReturnValue('server-error')
    const promise = fetchGistJson()
    lastMockXhr!._respondError(500, 'Internal Server Error')
    await expect(promise).rejects.toThrow(/HTTP 错误 500/)
  })

  it('onerror 且 signal.aborted 时返回取消错误 (line 274-275)', async () => {
    mockedGetGistId.mockReturnValue('onerror-abort')
    const controller = new AbortController()
    const promise = fetchGistJson(controller.signal)
    // 直接触发 abort 标记 + onerror
    controller.abort()
    // onerror 时 signal.aborted 为 true，应返回取消错误
    lastMockXhr!.onerror?.()
    await expect(promise).rejects.toThrow(/请求被取消/)
  })

  it('单文件且有内容时返回该内容 (line 163)', async () => {
    mockedGetGistId.mockReturnValue('single-file')
    const content = '{"sid":"single","name":"单文件测试"}'
    const gistApiResponse = {
      files: { 'data.jsonl': { content } },
    }
    const promise = fetchGistJson()
    lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
    const entries = await promise
    expect(entries.length).toBeGreaterThan(0)
  })

  it('files 映射中值为 undefined 时跳过 (line 151)', async () => {
    mockedGetGistId.mockReturnValue('undefined-file')
    // 手动构造：files 中某个键对应值为 undefined
    const gistApiResponse = {
      files: { 'valid.jsonl': { content: '{"sid":"v1"}' }, 'bad.jsonl': undefined },
    }
    const promise = fetchGistJson()
    lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
    const entries = await promise
    expect(entries.length).toBe(1)
  })

  it('isGistFile 遇到非对象值时整体响应被拒绝，返回空结果 (line 86)', async () => {
    mockedGetGistId.mockReturnValue('non-object')
    // files 中某个键对应值为数字（非法类型）→ isGistApiResponse 返回 false
    // extractGistContent 返回空字符串 → parseJsonl 返回空结果
    const gistApiResponse = {
      files: { 'data.jsonl': 42 },
    }
    const promise = fetchGistJson()
    lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
    const entries = await promise
    // 非法响应被拒绝，返回空数组
    expect(entries.length).toBe(0)
  })

  it('content 为 null 时被 isGistFile 拒绝，返回空结果', async () => {
    mockedGetGistId.mockReturnValue('null-content')
    // content 为 null → isGistFile 拒绝该文件 → isGistApiResponse 返回 false
    // extractGistContent 返回 '' → parseJsonl 返回空 → resolve([])
    const gistApiResponse = {
      files: { 'data.jsonl': { content: null } },
    }
    const promise = fetchGistJson()
    lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
    const entries = await promise
    expect(entries.length).toBe(0)
  })

  it('catch 分支中非 Error 异常应使用 String(e) 格式化 (line 256)', async () => {
    mockedGetGistId.mockReturnValue('non-error')
    // Mock JSON.parse 抛出非 Error 值（字符串），覆盖 e instanceof Error 的 false 分支
    const origParse = JSON.parse
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation((_text: string) => {
      throw 'a string error is not an Error instance'
    })
    try {
      const promise = fetchGistJson()
      lastMockXhr!._respondOk('{"files":{}}')
      await expect(promise).rejects.toThrow(/a string error is not an Error instance/)
    } finally {
      parseSpy.mockRestore()
      expect(JSON.parse).toBe(origParse)
    }
  })

  // ========== 补充测试：extractGistContent 分支覆盖 ==========
  describe('extractGistContent 分支覆盖', () => {
    it('单文件内容为有效 JSONL 时正常返回 (line 163)', async () => {
      mockedGetGistId.mockReturnValue('valid-single')
      const gistApiResponse = {
        files: { 'data.jsonl': { content: '{"sid":"s1","name":"单文件"}' } },
      }
      const promise = fetchGistJson()
      lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
      const entries = await promise
      expect(entries.length).toBe(1)
      expect(entries[0].sid).toBe('s1')
    })

    it('files 中有 null 值条目时 isGistApiResponse 提前返回空', async () => {
      mockedGetGistId.mockReturnValue('null-file')
      // null 文件使 isGistApiResponse 返回 false → extractGistContent 返回 ''
      const gistApiResponse = {
        files: { 'valid.jsonl': { content: '{"sid":"v1"}' }, 'null.jsonl': null },
      }
      const promise = fetchGistJson()
      lastMockXhr!._respondOk(JSON.stringify(gistApiResponse))
      const entries = await promise
      // isGistApiResponse 返回 false → 返回 '' → parseJsonl 返回空
      expect(entries.length).toBe(0)
    })

    it('catch 分支中 Error 实例使用 e.message (line 259-260)', async () => {
      mockedGetGistId.mockReturnValue('parse-error')
      const origParse = JSON.parse
      const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation((_text: string) => {
        throw new Error('模拟解析错误')
      })
      try {
        const promise = fetchGistJson()
        lastMockXhr!._respondOk('{"files":{"data.jsonl":{"content":"test"}}}')
        await expect(promise).rejects.toThrow(/模拟解析错误/)
      } finally {
        parseSpy.mockRestore()
      }
    })

    it('onerror 网络错误处理 (line 277)', async () => {
      mockedGetGistId.mockReturnValue('network-error')
      const promise = fetchGistJson()
      lastMockXhr!._triggerError()
      await expect(promise).rejects.toThrow(/网络请求失败/)
    })
  })
})

// ========== 注册表 ==========
describe('syncSourceRegistry: gist 注册', () => {
  it('gist 已注册', () => {
    expect(isSyncSourceRegistered('gist')).toBe(true)
  })

  it('getSyncSource(gist) 返回 GistSyncSource 实例', () => {
    const source = getSyncSource('gist')
    expect(source).toBeInstanceOf(GistSyncSource)
    expect(source?.getSourceType()).toBe('gist')
    expect(source?.getDisplayName()).toBe('Gist')
  })

  it('getRegisteredSourceTypes 包含 gist 与其他已注册类型', () => {
    const types = getRegisteredSourceTypes()
    expect(types).toContain('gist')
    expect(types).toContain('github')
    expect(types).toContain('gitlab')
    expect(types).toContain('gitee')
    expect(types).toContain('local')
  })

  it('每次调用 getSyncSource 返回新实例', () => {
    const s1 = getSyncSource('gist')
    const s2 = getSyncSource('gist')
    expect(s1).not.toBe(s2)
    expect(s1).toBeInstanceOf(GistSyncSource)
    expect(s2).toBeInstanceOf(GistSyncSource)
  })
})
