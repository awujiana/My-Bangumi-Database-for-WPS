// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'

// 与 tests/syncSource.test.ts 一致：syncSourceRegistry.ts 在模块加载时会注册
// 'github' / 'gitlab' / 'gitee' → 触发 githubSync.ts / gitlabSync.ts / giteeSync.ts →
// tools/util.js → tools/wps.js → index.js → ui/handlers.js 的副作用链，handlers.js
// 顶层访问 document.readyState 并通过 trackedSetTimeout 调度延迟回调。使用 fake timers
// 使这些 setTimeout 进入 fake 队列而不会真实触发。
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

// mock githubConfig 模块：buildGiteeRawUrl 与 validateConfig 依赖
// getGithubConfig / isGithubConfigComplete，通过 mock 控制其返回值以测试各分支。
// 工厂函数必须提供 giteeSync.ts 可能引入的所有 githubConfig 导出，避免 TS 类型缺失。
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

import { buildGiteeRawUrl, GiteeSyncSource } from '../ts/sync/giteeSync.js'
import {
  getSyncSource,
  isSyncSourceRegistered,
  getRegisteredSourceTypes,
} from '../ts/sync/syncSourceRegistry.js'
import { BgmError } from '../ts/core/result.js'
import { getGithubConfig, isGithubConfigComplete } from '../ts/sync/githubConfig.js'

const mockedGetGithubConfig = vi.mocked(getGithubConfig)
const mockedIsGithubConfigComplete = vi.mocked(isGithubConfigComplete)

// 清空模块加载期间累积的 fake timers，避免它们在测试中被意外触发
vi.clearAllTimers()

afterEach(() => {
  vi.clearAllTimers()
  vi.clearAllMocks()
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
    // 关键：Gitee 使用 /raw/，不是 /-/raw/
    expect(url).toContain('/raw/')
    // 确保不出现 GitLab 风格的 /-/raw/ 段
    expect(url).not.toContain('/-/raw/')
    // 确保不出现 GitHub 风格的 raw.githubusercontent.com 域名
    expect(url).not.toContain('raw.githubusercontent.com')
    // 精确匹配：完整 URL 形态
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
    // isGithubConfigComplete 内部检查 owner/repo/path，缺失任一返回 false
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
