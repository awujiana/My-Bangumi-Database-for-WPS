import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../ts/tools/util.js', () => ({
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
import { getApp } from '../ts/tools/util.js'

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
    const result = setGithubConfig({
      owner: 'testorg',
      repo: 'testrepo',
      branch: 'main',
      path: 'test.jsonl',
    })
    expect(result).toBe(true)
  })

  it('无 PluginStorage 时应返回 false', () => {
    vi.mocked(getApp).mockReturnValue(null)
    const result = setGithubConfig({
      owner: 'o',
      repo: 'r',
      branch: 'main',
      path: 'p',
    })
    expect(result).toBe(false)
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
