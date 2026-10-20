// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll, beforeEach } from 'vitest'

// 与 tests/syncSource.test.ts / giteeSync.test.ts 一致：
// syncSourceRegistry.ts 在模块加载时会注册 'github' / 'gitlab' / 'gitee' / 'local'，
// 触发 githubSync.ts / gitlabSync.ts / giteeSync.ts / localFileSync.ts →
// tools/util/index.js → tools/wps.js → index.js → ui/handlers.js 的副作用链，
// handlers.js 顶层访问 document.readyState 并通过 trackedSetTimeout 调度延迟回调。
// 使用 fake timers 使这些 setTimeout 进入 fake 队列而不会真实触发。
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

// mock githubConfig 模块：getLocalFilePath 依赖 getGithubConfig().path，
// 通过 mock 控制其返回值以测试各分支。
// 工厂函数必须提供 localFileSync.ts 可能引入的所有 githubConfig 导出，避免 TS 类型缺失。
vi.mock('../ts/sync/github-config.js', () => ({
  getGithubConfig: vi.fn(),
  isGithubConfigComplete: vi.fn(),
  buildRawUrl: vi.fn(),
  getManualShards: vi.fn(() => []),
  getSyncSourceType: vi.fn(() => 'local'),
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

vi.mock('../ts/sync/jsonl-response.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/sync/jsonl-response.js')>()
  // 默认仍走真实实现，只有「解码失败」那一条用例用 mockRejectedValueOnce 临时改道。
  // 这样既不引入假实现，又能确定性地构造「解码层抛错」。
  return { ...actual, readXhrJsonlText: vi.fn(actual.readXhrJsonlText) }
})

import {
  LocalFileSyncSource,
  readLocalFileContent,
  getLocalFilePath,
  isLocalFileConfigured,
} from '../ts/sync/local-file-sync.js'
import {
  getSyncSource,
  isSyncSourceRegistered,
  getRegisteredSourceTypes,
} from '../ts/sync/sync-source-registry.js'
import { readXhrJsonlText } from '../ts/sync/jsonl-response.js'
import { BgmError } from '../ts/core/result.js'
import { getGithubConfig } from '../ts/sync/github-config.js'

const mockedGetGithubConfig = vi.mocked(getGithubConfig)

// 清空模块加载期间累积的 fake timers，避免它们在测试中被意外触发
vi.clearAllTimers()

let mockXhrConstructor: typeof MockXHR | null = null

afterEach(() => {
  vi.clearAllTimers()
  vi.clearAllMocks()
  // 恢复 XMLHttpRequest（若被替换）
  if (mockXhrConstructor !== null) {
    Reflect.set(globalThis, 'XMLHttpRequest', mockXhrConstructor)
    mockXhrConstructor = null
  }
})

afterAll(() => {
  vi.useRealTimers()
})

// ========== XHR Mock 工具 ========== 提供可控制的 XMLHttpRequest mock，支持 onload/onerror/ontimeout 触发。 每个 MockXHR 实例捕获 open/send 调用，测试通过 mockXhrSetResponse 注入响应。

interface MockXHRCall {
  method: string
  url: string
  async: boolean
  timeout: number
  headers: Record<string, string>
}

let lastXhrCall: MockXHRCall | null = null
let lastMockXhr: MockXHR | null = null

/**
 * 预置响应队列：每次 `send()` 消费一项并异步返回。
 *
 * 分片读取一次同步会读 1 + N 个文件（清单 + 各分片），逐个手动 `_respondOk`
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

  status = 0

  statusText = ''

  responseText = ''

  timeout = 0

  onload: (() => void) | null = null

  onerror: (() => void) | null = null

  ontimeout: (() => void) | null = null

  /** 生产代码经 addEventListener 注册：映射到 onXXX 属性，保留测试手动触发机制 */
  addEventListener(type: 'load' | 'error', handler: () => void): void {
    if (type === 'load') {
      this.onload = handler
    } else {
      this.onerror = handler
    }
  }

  open(method: string, url: string, isAsync: boolean): void {
    this.method = method
    this.url = url
    this.async = isAsync
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value
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

  // 测试辅助方法：模拟成功响应
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
  Reflect.set(globalThis, 'XMLHttpRequest', MockXHR)
  lastXhrCall = null
  lastMockXhr = null
}

beforeEach(() => {
  installMockXhr()
  responseQueue = []
})

// ========== 接口基础行为 ==========
describe('LocalFileSyncSource 接口', () => {
  it('getSourceType 返回 local', () => {
    const source = new LocalFileSyncSource()
    expect(source.getSourceType()).toBe('local')
  })

  it('getDisplayName 返回 本地文件', () => {
    const source = new LocalFileSyncSource()
    expect(source.getDisplayName()).toBe('本地文件')
  })
})

// ========== 配置辅助函数 ==========
describe('getLocalFilePath / isLocalFileConfigured', () => {
  it('getLocalFilePath 返回 githubConfig.path 字段', () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: '',
      repo: '',
      branch: 'main',
      path: String.raw`C:\data\test.jsonl`,
      sourceType: 'local',
    })
    expect(getLocalFilePath()).toBe(String.raw`C:\data\test.jsonl`)
  })

  it('isLocalFileConfigured 在 path 非空时返回 true', () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: '',
      repo: '',
      branch: 'main',
      path: '/some/path/data.jsonl',
      sourceType: 'local',
    })
    expect(isLocalFileConfigured()).toBe(true)
  })

  it('isLocalFileConfigured 在 path 为空时返回 false', () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: '',
      repo: '',
      branch: 'main',
      path: '',
      sourceType: 'local',
    })
    expect(isLocalFileConfigured()).toBe(false)
  })
})

// ========== 配置校验 ==========
describe('LocalFileSyncSource.validateConfig', () => {
  it('path 已配置时返回 Result.ok', () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: '',
      repo: '',
      branch: 'main',
      path: String.raw`C:\data\test.jsonl`,
      sourceType: 'local',
    })
    const source = new LocalFileSyncSource()
    const result = source.validateConfig()
    expect(result.isOk()).toBe(true)
  })

  it('path 为空时返回 Result.fail 且 error 为 BgmError', () => {
    mockedGetGithubConfig.mockReturnValue({
      owner: '',
      repo: '',
      branch: 'main',
      path: '',
      sourceType: 'local',
    })
    const source = new LocalFileSyncSource()
    const result = source.validateConfig()
    expect(result.isFail()).toBe(true)
    expect(result.error).toBeInstanceOf(BgmError)
    expect(result.error?.code).toBe('CONFIG_INCOMPLETE')
    expect(result.error?.message).toContain('本地文件路径')
  })

  it('本地文件源不需要 owner/repo（仅需 path）', () => {
    // 与远程源不同：本地文件源仅校验 path 字段，owner/repo 可为空
    mockedGetGithubConfig.mockReturnValue({
      owner: '',
      repo: '',
      branch: '',
      path: '/data/local.jsonl',
      sourceType: 'local',
    })
    const source = new LocalFileSyncSource()
    const result = source.validateConfig()
    expect(result.isOk()).toBe(true)
  })
})

// ========== readLocalFileContent ==========
describe('readLocalFileContent', () => {
  it('空路径抛出错误', async () => {
    await expect(readLocalFileContent('')).rejects.toThrow(/路径不能为空/)
    await expect(readLocalFileContent(' '.repeat(3))).rejects.toThrow(/路径不能为空/)
  })

  it('成功读取文件内容（status=0）', async () => {
    const promise = readLocalFileContent(String.raw`C:\data\test.jsonl`)
    expect(lastXhrCall).not.toBeNull()
    // 验证 file:// URL 转换：C:\data\test.jsonl → file:///C:/data/test.jsonl
    expect(lastXhrCall?.url).toBe('file:///C:/data/test.jsonl')
    expect(lastXhrCall?.method).toBe('GET')
    expect(lastMockXhr).not.toBeNull()
    lastMockXhr!._respondOk('{"sid":"123","name":"test"}', 0)
    await expect(promise).resolves.toBe('{"sid":"123","name":"test"}')
  })

  it('成功读取文件内容（status=200）', async () => {
    const promise = readLocalFileContent('/path/file.jsonl')
    expect(lastXhrCall?.url).toBe('file:///path/file.jsonl')
    lastMockXhr!._respondOk('hello world', 200)
    await expect(promise).resolves.toBe('hello world')
  })

  it('file:// 前缀路径保持原样', async () => {
    const promise = readLocalFileContent('file:///C:/data/test.jsonl')
    expect(lastXhrCall?.url).toBe('file:///C:/data/test.jsonl')
    lastMockXhr!._respondOk('')
    await promise
  })

  it('网络错误（onerror）时 reject', async () => {
    const promise = readLocalFileContent(String.raw`C:\nonexistent.jsonl`)
    lastMockXhr!._triggerError()
    await expect(promise).rejects.toThrow(/无法读取文件/)
  })

  it('HTTP 错误（如 404）时 reject', async () => {
    const promise = readLocalFileContent(String.raw`C:\missing.jsonl`)
    lastMockXhr!._respondError(404, 'Not Found')
    await expect(promise).rejects.toThrow(/HTTP 404/)
  })

  it('超时时 reject', async () => {
    const promise = readLocalFileContent(String.raw`C:\slow.jsonl`)
    lastMockXhr!._triggerTimeout()
    await expect(promise).rejects.toThrow(/读取文件超时/)
  })

  it('响应已到达但解码失败时 reject（不能静默当作空内容）', async () => {
    // 真实场景：本地 .jsonlines.gz 被截断 / 不是合法 gzip，
    // readXhrJsonlText → decodeJsonlBytes → gunzipBytes 抛错。
    const promise = readLocalFileContent(String.raw`C:\corrupt.jsonlines.gz`)
    vi.mocked(readXhrJsonlText).mockRejectedValueOnce(new Error('解压失败：不是合法的 gzip 流'))
    lastMockXhr!._respondOk('', 200)

    await expect(promise).rejects.toThrow('解压失败：不是合法的 gzip 流')
  })

  it('解码抛出的非 Error 值也统一包成 Error 再 reject', async () => {
    // 生产代码写的是 `error instanceof Error ? error : new Error(String(error))`，
    // 非 Error 的抛出值（如字符串）必须被包一层，否则调用方拿到的不是 Error。
    const promise = readLocalFileContent(String.raw`C:\corrupt.jsonlines.gz`)
    vi.mocked(readXhrJsonlText).mockRejectedValueOnce('裸字符串错误')
    lastMockXhr!._respondOk('', 200)

    await expect(promise).rejects.toThrow('裸字符串错误')
  })
})

/** 构造一份最小分片清单：base（必选）+ summary（可选） */
function makeManifestText(): string {
  return JSON.stringify({
    formatVersion: 1,
    subjectType: 2,
    typeLabel: 'anime',
    updatedAt: '2026-09-08',
    recordCount: 2,
    shards: [
      { name: 'base', file: 'anime.base.jsonlines.gz', fields: ['sid', 'name', 'updatedAt'] },
      { name: 'summary', file: 'anime.summary.jsonlines.gz', fields: ['sid', 'summary'] },
    ],
  })
}

/** 把 getGithubConfig 的 path 指向指定本地路径（sourceType=local） */
function mockLocalPath(path: string): void {
  mockedGetGithubConfig.mockReturnValue({
    owner: '',
    repo: '',
    branch: '',
    path,
    sourceType: 'local',
  })
}

// ========== fetchRemoteEntries（清单 → 选片 → 拼接） ==========
describe('LocalFileSyncSource.fetchRemoteEntries', () => {
  /** 本地清单的绝对路径（以 .json 结尾，下载层据此判定为清单） */
  const MANIFEST_FILE = String.raw`C:\data\anime.manifest.json`

  it('按清单读取必选片并拼出条目', async () => {
    mockLocalPath(MANIFEST_FILE)
    responseQueue = [
      makeManifestText(),
      '["sid","name","updatedAt"]\n["111","条目A","2026-09-08"]\n["222","条目B","2026-09-08"]',
    ]
    const source = new LocalFileSyncSource()
    const entries = await source.fetchRemoteEntries(undefined, { neededFields: new Set() })

    expect(entries).toHaveLength(2)
    expect(entries[0]?.subjectId).toBe('111')
    expect(entries[0]?.name).toBe('条目A')
    expect(entries[1]?.subjectId).toBe('222')
  })

  it('按 neededFields 带出 summary 片并按行拼接', async () => {
    mockLocalPath(MANIFEST_FILE)
    responseQueue = [
      makeManifestText(),
      '["sid","name","updatedAt"]\n["111","条目A","2026-09-08"]',
      '["sid","summary"]\n["111","简介A"]',
    ]
    const source = new LocalFileSyncSource()
    const entries = await source.fetchRemoteEntries(undefined, {
      neededFields: new Set(['summary']),
    })

    expect(entries[0]?.summary).toBe('简介A')
    expect(entries[0]?.name).toBe('条目A')
  })

  it('neededFields 为 undefined 时全量下载（保守兜底）', async () => {
    mockLocalPath(MANIFEST_FILE)
    responseQueue = [
      makeManifestText(),
      '["sid","name","updatedAt"]\n["111","条目A","2026-09-08"]',
      '["sid","summary"]\n["111","简介A"]',
    ]
    const source = new LocalFileSyncSource()
    const entries = await source.fetchRemoteEntries()

    expect(entries[0]?.summary).toBe('简介A')
  })

  it('分片只有表头（无数据行）时返回空数组', async () => {
    mockLocalPath(MANIFEST_FILE)
    responseQueue = [makeManifestText(), '["sid","name","updatedAt"]']
    const source = new LocalFileSyncSource()
    const entries = await source.fetchRemoteEntries(undefined, { neededFields: new Set() })

    expect(entries).toEqual([])
  })

  it('路径不是清单（.json）时抛出明确错误', async () => {
    mockLocalPath(String.raw`C:\data\data.jsonl`)
    const source = new LocalFileSyncSource()

    await expect(source.fetchRemoteEntries()).rejects.toThrow(/必须是分片清单/)
  })

  it('分片表头非法时抛出错误', async () => {
    mockLocalPath(MANIFEST_FILE)
    responseQueue = [makeManifestText(), 'this is not json']
    const source = new LocalFileSyncSource()

    await expect(source.fetchRemoteEntries(undefined, { neededFields: new Set() })).rejects.toThrow(
      /分片表头非法/,
    )
  })

  it('清单格式非法时抛出错误', async () => {
    mockLocalPath(MANIFEST_FILE)
    responseQueue = ['this is not json']
    const source = new LocalFileSyncSource()

    await expect(source.fetchRemoteEntries()).rejects.toThrow(/分片清单格式非法/)
  })

  it('path 未配置时抛出错误', async () => {
    mockLocalPath('')
    const source = new LocalFileSyncSource()
    await expect(source.fetchRemoteEntries()).rejects.toThrow(/本地文件路径未配置/)
  })

  it('文件读取错误时抛出', async () => {
    mockLocalPath(String.raw`C:\nonexistent\anime.manifest.json`)
    const source = new LocalFileSyncSource()
    const promise = source.fetchRemoteEntries()
    lastMockXhr!._triggerError()
    await expect(promise).rejects.toThrow(/无法读取文件/)
  })

  it('AbortSignal 已 aborted 时立即抛出', async () => {
    mockLocalPath(MANIFEST_FILE)
    const controller = new AbortController()
    controller.abort()
    const source = new LocalFileSyncSource()
    await expect(source.fetchRemoteEntries(controller.signal)).rejects.toThrow(/请求被取消/)
  })

  it('AbortSignal 在读取完成后 aborted 时抛出', async () => {
    mockLocalPath(MANIFEST_FILE)
    responseQueue = [makeManifestText(), '["sid","name","updatedAt"]\n["111","条目A","2026-09-08"]']
    const controller = new AbortController()
    const source = new LocalFileSyncSource()
    const promise = source.fetchRemoteEntries(controller.signal, { neededFields: new Set() })
    // 请求已发出后取消：下载会走完，但返回前的 aborted 检查必须抛出
    controller.abort()
    await expect(promise).rejects.toThrow(/请求被取消/)
  })

  it('缺合法 subjectId 计数写入 loadStats（syncFromRemote 弹窗展示用）', async () => {
    mockLocalPath(MANIFEST_FILE)
    responseQueue = [
      makeManifestText(),
      '["sid","name","updatedAt"]\n["111","条目A","2026-09-08"]\n[null,"坏行",""]',
    ]
    const source = new LocalFileSyncSource()
    const entries = await source.fetchRemoteEntries(undefined, { neededFields: new Set() })

    expect(entries).toHaveLength(1)
    expect(source.loadStats.skippedInvalidLines).toBe(1)
  })

  it('数据干净时 loadStats 归零（整体覆写，不累加）', async () => {
    mockLocalPath(MANIFEST_FILE)
    responseQueue = [makeManifestText(), '["sid","name","updatedAt"]\n["111","条目A","2026-09-08"]']
    const source = new LocalFileSyncSource()
    source.loadStats.skippedInvalidLines = 9

    await source.fetchRemoteEntries(undefined, { neededFields: new Set() })

    expect(source.loadStats.skippedInvalidLines).toBe(0)
  })
})

// ========== 注册表 ==========
describe('syncSourceRegistry: local 注册', () => {
  it('local 已注册', () => {
    expect(isSyncSourceRegistered('local')).toBe(true)
  })

  it('getSyncSource(local) 返回 LocalFileSyncSource 实例', () => {
    const source = getSyncSource('local')
    expect(source).toBeInstanceOf(LocalFileSyncSource)
    expect(source?.getSourceType()).toBe('local')
    expect(source?.getDisplayName()).toBe('本地文件')
  })

  it('getRegisteredSourceTypes 包含 local', () => {
    const types = getRegisteredSourceTypes()
    expect(types).toContain('local')
    expect(types).toContain('github')
    expect(types).toContain('gitlab')
    expect(types).toContain('gitee')
  })

  it('每次调用 getSyncSource 返回新实例', () => {
    const s1 = getSyncSource('local')
    const s2 = getSyncSource('local')
    expect(s1).not.toBe(s2)
    expect(s1).toBeInstanceOf(LocalFileSyncSource)
    expect(s2).toBeInstanceOf(LocalFileSyncSource)
  })
})
