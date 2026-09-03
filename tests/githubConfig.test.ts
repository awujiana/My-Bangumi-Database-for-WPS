import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../ts/tools/utility.js', () => ({
  bgmLog: vi.fn(),
  getApp: vi.fn(),
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}))

vi.mock('../ts/tools/events.js', () => ({
  eventBus: { emit: vi.fn() },
  BGM_EVENTS: {
    TOKEN_UPDATED: 'state:tokenUpdated',
    USER_ID_UPDATED: 'state:userIdUpdated',
    CONFIG_UPDATED: 'config:updated',
  },
}))

vi.mock('../ts/core/constants.js', () => ({
  LOG_LEVELS: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  DEFAULT_BANGUMI_API_URL: 'https://api.bgm.tv',
}))

import {
  getGithubConfig,
  setGithubConfig,
  isGithubConfigComplete,
  buildRawUrl,
  getSyncStrategy,
  setSyncStrategy,
  getSyncSourceType,
  setSyncSourceType,
  getGistId,
  setGistId,
  isGistConfigured,
  DEFAULT_GITHUB_CONFIG,
} from '../ts/sync/githubConfig.js'
import { getApp } from '../ts/tools/utility.js'

function createMockStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial }
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
  }
}

function createMockApp(storageData: Record<string, string> = {}) {
  return {
    PluginStorage: createMockStorage(storageData),
  }
}

describe('getGithubConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('首次读取无配置时应返回默认值', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    const config = getGithubConfig()
    expect(config.owner).toBe('awujiana')
    expect(config.repo).toBe('Bangumi-Archive-Anime-Excel')
    expect(config.branch).toBe('main')
  })

  it('应读取已保存的配置', () => {
    vi.mocked(getApp).mockReturnValue(
      createMockApp({
        github_sync_owner: 'myorg',
        github_sync_repo: 'myrepo',
        github_sync_branch: 'develop',
      }),
    )
    const config = getGithubConfig()
    expect(config.owner).toBe('myorg')
    expect(config.repo).toBe('myrepo')
  })

  it('无 PluginStorage 时回退到默认值', () => {
    vi.mocked(getApp).mockReturnValue(null)
    const config = getGithubConfig()
    expect(config.owner).toBe(DEFAULT_GITHUB_CONFIG.owner)
  })
})

describe('setGithubConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应保存配置', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    const isResult = setGithubConfig({
      owner: 'testorg',
      repo: 'testrepo',
      branch: 'main',
      path: 'test.jsonl',
    })
    expect(isResult).toBe(true)
  })

  it('无 PluginStorage 时应返回 false', () => {
    vi.mocked(getApp).mockReturnValue(null)
    const isResult = setGithubConfig({
      owner: 'o',
      repo: 'r',
      branch: 'main',
      path: 'p',
    })
    expect(isResult).toBe(false)
  })

  it('应保存 gistId', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    setGithubConfig({
      owner: 'o',
      repo: 'r',
      branch: 'main',
      path: 'p',
      sourceType: 'gist',
      gistId: 'abc123',
    })
    vi.mocked(getApp).mockReturnValue(
      createMockApp({
        github_sync_gist_id: 'abc123',
        github_sync_owner: 'o',
        github_sync_repo: 'r',
        github_sync_branch: 'main',
        github_sync_path: 'p',
        github_sync_source_type: 'gist',
      }),
    )
    const stored = getGithubConfig()
    expect(stored.gistId).toBe('abc123')
  })
})

describe('isGithubConfigComplete', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('owner/repo/path 均有值时返回 true', () => {
    vi.mocked(getApp).mockReturnValue(
      createMockApp({
        github_sync_owner: 'o',
        github_sync_repo: 'r',
        github_sync_path: 'p',
      }),
    )
    expect(isGithubConfigComplete()).toBe(true)
  })

  it('缺少 owner 时返回 false', () => {
    vi.mocked(getApp).mockReturnValue(
      createMockApp({
        github_sync_repo: 'r',
        github_sync_path: 'p',
      }),
    )
    expect(isGithubConfigComplete()).toBe(false)
  })
})

describe('buildRawUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应构造正确的 GitHub Raw URL', () => {
    vi.mocked(getApp).mockReturnValue(
      createMockApp({
        github_sync_owner: 'owner',
        github_sync_repo: 'repo',
        github_sync_branch: 'main',
        github_sync_path: 'data/file.jsonl',
      }),
    )
    const url = buildRawUrl()
    expect(url).toBe('https://raw.githubusercontent.com/owner/repo/main/data/file.jsonl')
  })

  it('应使用默认配置构造 URL', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    const url = buildRawUrl()
    expect(url).toContain('raw.githubusercontent.com')
    expect(url).toContain('main')
  })
})

describe('getSyncStrategy / setSyncStrategy', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('未设置时应返回默认策略 add-update', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    expect(getSyncStrategy()).toBe('add-update')
  })

  it('应保存和读取同步策略', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    setSyncStrategy('mirror')
    expect(getSyncStrategy()).toBe('mirror')
  })

  it('非法策略值应返回 false', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    expect(setSyncStrategy('invalid' as never)).toBe(false)
  })
})

describe('getSyncSourceType / setSyncSourceType', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('未设置时应返回 github', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    expect(getSyncSourceType()).toBe('github')
  })

  it('应保存和读取同步源类型', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    setSyncSourceType('gitlab')
    expect(getSyncSourceType()).toBe('gitlab')
  })

  it('非法源类型应返回 false', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    expect(setSyncSourceType('invalid' as never)).toBe(false)
  })
})

describe('getGistId / setGistId / isGistConfigured', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('未设置时应返回空字符串', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    expect(getGistId()).toBe('')
  })

  it('应保存和读取 Gist ID', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    setGistId('gist123')
    expect(getGistId()).toBe('gist123')
  })

  it('isGistConfigured 在 gistId 为空时返回 false', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    expect(isGistConfigured()).toBe(false)
  })

  it('isGistConfigured 在 gistId 非空时返回 true', () => {
    vi.mocked(getApp).mockReturnValue(
      createMockApp({
        github_sync_gist_id: 'abc',
      }),
    )
    expect(isGistConfigured()).toBe(true)
  })
})

// ========== 补充测试：storage.setItem 异常与 storage 为 undefined 分支 ==========
describe('githubConfig 异常与回退分支', () => {
  it('非法 sourceType 参数时 setSyncSourceType 返回 false', () => {
    vi.mocked(getApp).mockReturnValue(createMockApp({}))
    expect(setSyncSourceType('invalid' as never)).toBe(false)
  })

  it('setSyncSourceType 正常场景应写入 storage 并返回 true', () => {
    const storage = createMockStorage({})
    vi.mocked(getApp).mockReturnValue({ PluginStorage: storage })
    const isResult = setSyncSourceType('gitlab')
    expect(isResult).toBe(true)
    expect(storage.getItem('github_sync_source_type')).toBe('gitlab')
  })

  it('PluginStorage 为 undefined 时 setSyncSourceType 返回 false (line 287-288)', () => {
    vi.mocked(getApp).mockReturnValue(null)
    const isResult = setSyncSourceType('github')
    expect(isResult).toBe(false)
  })

  it('PluginStorage 为 undefined 时 setGistId 返回 false (line 329-330)', () => {
    vi.mocked(getApp).mockReturnValue(null)
    const isResult = setGistId('gist-id')
    expect(isResult).toBe(false)
  })

  it('PluginStorage 为 undefined 时 setSyncStrategy 返回 false', () => {
    vi.mocked(getApp).mockReturnValue(null)
    const isResult = setSyncStrategy('add-update')
    expect(isResult).toBe(false)
  })

  it('getStorage 返回 storage 为 undefined 时 getGithubConfig 仍能返回默认值', () => {
    vi.mocked(getApp).mockReturnValue(null)
    const config = getGithubConfig()
    expect(config.owner).toBe(DEFAULT_GITHUB_CONFIG.owner)
    expect(config.repo).toBe(DEFAULT_GITHUB_CONFIG.repo)
  })

  it('storage.setItem 抛异常时 setGithubConfig 应向外抛出', () => {
    const badStorage = {
      getItem: (_key: string) => '' as string | null,
      setItem: (_key: string, _value: string) => {
        throw new Error('Storage 写入异常')
      },
      removeItem: (_key: string) => {},
    }
    vi.mocked(getApp).mockReturnValue({ PluginStorage: badStorage })
    // setGithubConfig 未做 try/catch，setItem 抛异常会向外抛出
    expect(() =>
      setGithubConfig({
        owner: 'o',
        repo: 'r',
        branch: 'main',
        path: 'p',
      }),).toThrow('Storage 写入异常')
  })
})
