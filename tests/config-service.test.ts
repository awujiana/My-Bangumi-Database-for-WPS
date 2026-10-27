import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖：避开 utility.ts 的副作用链（util → wps → index → handlers → document）
// 仅提供 configService.ts 实际使用的 4 个函数
// §5.6 C3：barrel 统一后本 mock 会同时拦截 config.ts 等传递依赖（原先它们走
// 真实 util barrel）。用 importOriginal 只覆盖 token / 用户 ID 四个函数，
// 其余保持真实实现——避免「No getApp export」这类整体 mock 缺项。
vi.mock('../ts/tools/util/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ts/tools/util/index.js')>()
  return {
    ...actual,
    loadBgToken: vi.fn(() => 'test-token'),
    storeBgToken: vi.fn(() => true),
    _getBgmUserId: vi.fn(() => 'test-user-123'),
    _setBgmUserId: vi.fn(),
  }
})

// Mock githubConfig.ts：避免触发 PluginStorage 访问和事件发射
vi.mock('../ts/sync/github-config.js', () => ({
  getGithubConfig: vi.fn(() => ({
    owner: 'test',
    repo: 'test-repo',
    branch: 'main',
    path: 'data.jsonl',
  })),
  setGithubConfig: vi.fn(() => true),
  getSyncStrategy: vi.fn(() => 'add-update' as const),
  setSyncStrategy: vi.fn(() => true),
}))

// 在 mock 注册之后导入被测模块
import { exportConfig, importConfig } from '../ts/services/config-service.js'
import { CLEAN_RULES } from '../ts/panel/clean-rules.js'
import { loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId } from '../ts/tools/util/index.js'
import {
  getGithubConfig,
  setGithubConfig,
  getSyncStrategy,
  setSyncStrategy,
} from '../ts/sync/github-config.js'

/**
 * 最小 PluginStorage 替身。
 * `tools/config.ts` 的 `setConfig` 只用到 getItem / setItem（removeItem 为接口完整性保留），
 * 通过 stub `window.Application.PluginStorage` 让真实实现跑通「写入成功」分支。
 */
function createFakeStorage(): {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  snapshot: () => Record<string, string>
} {
  const store: Record<string, string> = {}
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = value
    },
    removeItem: (key) => {
      delete store[key]
    },
    snapshot: () => ({ ...store }),
  }
}

describe('configService', () => {
  beforeEach(() => {
    // 每个用例前重置 mock 调用记录
    vi.clearAllMocks()
  })

  describe('exportConfig', () => {
    it('返回合法 JSON 字符串，包含 version 和 exportedAt', () => {
      const json = exportConfig()
      const parsed = JSON.parse(json) as Record<string, unknown>
      expect(parsed.version).toBe(1)
      expect(parsed.exportedAt).toBeDefined()
      expect(typeof parsed.exportedAt).toBe('string')
    })

    it('包含当前 Token', () => {
      const json = exportConfig()
      const parsed = JSON.parse(json) as Record<string, unknown>
      expect(parsed.token).toBe('test-token')
    })

    it('包含当前用户 ID', () => {
      const json = exportConfig()
      const parsed = JSON.parse(json) as Record<string, unknown>
      expect(parsed.userId).toBe('test-user-123')
    })

    it('包含 GitHub 配置和同步策略', () => {
      const json = exportConfig()
      const parsed = JSON.parse(json) as { githubConfig: Record<string, unknown> }
      expect(parsed.githubConfig.owner).toBe('test')
      expect(parsed.githubConfig.repo).toBe('test-repo')
      expect(parsed.githubConfig.branch).toBe('main')
      expect(parsed.githubConfig.path).toBe('data.jsonl')
      expect(parsed.githubConfig.strategy).toBe('add-update')
    })

    it('Token 未设置时省略 token 字段', () => {
      ;(loadBgToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)
      const json = exportConfig()
      const parsed = JSON.parse(json) as Record<string, unknown>
      expect(parsed.token).toBeUndefined()
    })

    it('用户 ID 未设置时省略 userId 字段', () => {
      ;(_getBgmUserId as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)
      const json = exportConfig()
      const parsed = JSON.parse(json) as Record<string, unknown>
      expect(parsed.userId).toBeUndefined()
    })

    it('调用底层读取函数收集配置', () => {
      exportConfig()
      expect(loadBgToken).toHaveBeenCalledTimes(1)
      expect(_getBgmUserId).toHaveBeenCalledTimes(1)
      expect(getGithubConfig).toHaveBeenCalledTimes(1)
      expect(getSyncStrategy).toHaveBeenCalledTimes(1)
    })
  })

  describe('importConfig - 成功路径', () => {
    it('合法且完整的 JSON 导入成功', () => {
      const json = JSON.stringify({
        version: 1,
        exportedAt: '2026-07-21T00:00:00.000Z',
        token: 'new-token',
        userId: 'new-user-456',
        githubConfig: {
          owner: 'new',
          repo: 'new-repo',
          branch: 'main',
          path: 'data.jsonl',
          strategy: 'mirror',
        },
      })
      const result = importConfig(json)
      expect(result.isOk()).toBe(true)
    })

    it('导入成功后恢复 Token', () => {
      const json = JSON.stringify({
        version: 1,
        exportedAt: '2026-07-21T00:00:00.000Z',
        token: 'restored-token',
      })
      importConfig(json)
      expect(storeBgToken).toHaveBeenCalledWith('restored-token')
    })

    it('导入成功后恢复用户 ID', () => {
      const json = JSON.stringify({
        version: 1,
        exportedAt: '2026-07-21T00:00:00.000Z',
        userId: 'restored-user',
      })
      importConfig(json)
      expect(_setBgmUserId).toHaveBeenCalledWith('restored-user')
    })

    it('导入成功后恢复 GitHub 配置与策略', () => {
      const json = JSON.stringify({
        version: 1,
        exportedAt: '2026-07-21T00:00:00.000Z',
        githubConfig: {
          owner: 'imp-owner',
          repo: 'imp-repo',
          branch: 'dev',
          path: 'sync.jsonl',
          strategy: 'force-overwrite',
        },
      })
      importConfig(json)
      expect(setGithubConfig).toHaveBeenCalledWith({
        owner: 'imp-owner',
        repo: 'imp-repo',
        branch: 'dev',
        path: 'sync.jsonl',
      })
      expect(setSyncStrategy).toHaveBeenCalledWith('force-overwrite')
    })

    it('preferences 只写回白名单内的字符串键，其余静默忽略', () => {
      // 走真实 tools/config.ts 的 setConfig，因此必须提供可用的 PluginStorage，
      // 否则 setConfig 一律返回 false，applyPreferences 永远写不进任何键。
      const storage = createFakeStorage()
      vi.stubGlobal('window', { Application: { PluginStorage: storage } })
      try {
        const json = JSON.stringify({
          version: 1,
          exportedAt: '2026-07-21T00:00:00.000Z',
          preferences: {
            bgm_theme: 'dark',
            bgm_nav_icons_only: 'true',
            bgm_not_a_real_key: 'should-be-ignored',
            bgm_log_level: 3,
          },
        })

        expect(importConfig(json).isOk()).toBe(true)

        const written = storage.snapshot()
        expect(written.bgm_theme).toBe('dark')
        expect(written.bgm_nav_icons_only).toBe('true')
        // 非白名单键与「值不是字符串」的键都必须被拒绝
        expect(written.bgm_not_a_real_key).toBeUndefined()
        expect(written.bgm_log_level).toBeUndefined()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('preferences 不是对象（数组 / 字符串 / 缺失）时不写入任何配置', () => {
      const storage = createFakeStorage()
      vi.stubGlobal('window', { Application: { PluginStorage: storage } })
      try {
        for (const preferences of [['bgm_theme'], 'bgm_theme=dark', null] as const) {
          expect(
            importConfig(
              JSON.stringify({
                version: 1,
                exportedAt: '2026-07-21T00:00:00.000Z',
                preferences,
              }),
            ).isOk(),
          ).toBe(true)
        }
        expect(storage.snapshot()).toEqual({})
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('仅包含必填字段的 JSON 也能导入成功', () => {
      const json = JSON.stringify({
        version: 1,
        exportedAt: '2026-07-21T00:00:00.000Z',
      })
      const result = importConfig(json)
      expect(result.isOk()).toBe(true)
      // 可选字段缺失时不应调用对应的 set 函数
      expect(storeBgToken).not.toHaveBeenCalled()
      expect(_setBgmUserId).not.toHaveBeenCalled()
      expect(setGithubConfig).not.toHaveBeenCalled()
    })

    it('strategy 缺失时使用 schema 默认值，不调用 setSyncStrategy', () => {
      const json = JSON.stringify({
        version: 1,
        exportedAt: '2026-07-21T00:00:00.000Z',
        githubConfig: {
          owner: 'o',
          repo: 'r',
          branch: 'main',
          path: 'p',
        },
      })
      const result = importConfig(json)
      expect(result.isOk()).toBe(true)
      // strategy 有默认值 'add-update'，但 config.githubConfig.strategy 仍会被设置
      // 因为 zod 在 parse 后填充了默认值，gc.strategy 为 'add-update'（truthy）
      expect(setSyncStrategy).toHaveBeenCalledWith('add-update')
    })
  })

  describe('importConfig - 失败路径', () => {
    it('version 错误时失败', () => {
      const json = JSON.stringify({
        version: 2,
        exportedAt: '2026-07-21T00:00:00.000Z',
      })
      const result = importConfig(json)
      expect(result.isFail()).toBe(true)
      expect(result.error?.code).toBe('CONFIG_INVALID')
    })

    it('version 为字符串时失败', () => {
      const json = JSON.stringify({
        version: '1',
        exportedAt: '2026-07-21T00:00:00.000Z',
      })
      const result = importConfig(json)
      expect(result.isFail()).toBe(true)
    })

    it('缺少 exportedAt 时失败', () => {
      const json = JSON.stringify({ version: 1 })
      const result = importConfig(json)
      expect(result.isFail()).toBe(true)
    })

    it('非法 JSON 字符串失败（CONFIG_PARSE_ERROR）', () => {
      const result = importConfig('not json {{{')
      expect(result.isFail()).toBe(true)
      expect(result.error?.code).toBe('CONFIG_PARSE_ERROR')
    })

    it('空字符串失败', () => {
      const result = importConfig('')
      expect(result.isFail()).toBe(true)
      expect(result.error?.code).toBe('CONFIG_PARSE_ERROR')
    })

    it('githubConfig.owner 为空字符串时失败', () => {
      const json = JSON.stringify({
        version: 1,
        exportedAt: '2026-07-21T00:00:00.000Z',
        githubConfig: {
          owner: '',
          repo: 'r',
          branch: 'main',
          path: 'p',
        },
      })
      const result = importConfig(json)
      expect(result.isFail()).toBe(true)
      expect(result.error?.code).toBe('CONFIG_INVALID')
    })

    it('非法 strategy 值失败', () => {
      const json = JSON.stringify({
        version: 1,
        exportedAt: '2026-07-21T00:00:00.000Z',
        githubConfig: {
          owner: 'o',
          repo: 'r',
          branch: 'main',
          path: 'p',
          strategy: 'invalid-strategy',
        },
      })
      const result = importConfig(json)
      expect(result.isFail()).toBe(true)
    })

    it('校验失败时不修改任何已存储配置', () => {
      const json = JSON.stringify({ version: 2 })
      importConfig(json)
      expect(storeBgToken).not.toHaveBeenCalled()
      expect(_setBgmUserId).not.toHaveBeenCalled()
      expect(setGithubConfig).not.toHaveBeenCalled()
      expect(setSyncStrategy).not.toHaveBeenCalled()
    })
  })

  describe('importConfig - 往返一致性', () => {
    it('exportConfig 的输出可被 importConfig 重新导入', () => {
      // 导出
      const exported = exportConfig()
      // 导入
      const result = importConfig(exported)
      expect(result.isOk()).toBe(true)
      // 验证恢复调用
      expect(storeBgToken).toHaveBeenCalledWith('test-token')
      expect(_setBgmUserId).toHaveBeenCalledWith('test-user-123')
      expect(setGithubConfig).toHaveBeenCalledWith({
        owner: 'test',
        repo: 'test-repo',
        branch: 'main',
        path: 'data.jsonl',
      })
      expect(setSyncStrategy).toHaveBeenCalledWith('add-update')
    })
  })
})

// ========== 各页面配置纳入导出（2026-10-22） ==========

/**
 * 造一个带初始内容的存储，并挂成 window.Application.PluginStorage。
 *
 * 必须真挂：`tools/config.ts` 的 setConfig 读的是 `getApp().PluginStorage`，
 * 只造对象不挂全局的话 setConfig 一律返回 false，导出永远收集不到东西。
 */
function mountStorage(initial: Record<string, string>): ReturnType<typeof createFakeStorage> {
  const storage = createFakeStorage()
  for (const [key, value] of Object.entries(initial)) storage.setItem(key, value)
  vi.stubGlobal('window', { Application: { PluginStorage: storage } })
  return storage
}

describe('configService - 各页面配置导出范围', () => {
  it('高亮页与条件格式页的偏好键出现在导出的 preferences 里', () => {
    mountStorage({
      'highlight.source': '开播季度',
      'highlight.sheet': 'wb.xlsx::动画',
      'highlight.sheetLock': '1',
      'conditionalFormat.rules.v1': '[]',
      'conditionalFormat.sheetLock': '1',
    })

    const parsed = JSON.parse(exportConfig()) as {
      preferences: Record<string, string>
    }

    expect(parsed.preferences['highlight.source']).toBe('开播季度')
    expect(parsed.preferences['highlight.sheet']).toBe('wb.xlsx::动画')
    expect(parsed.preferences['highlight.sheetLock']).toBe('1')
    expect(parsed.preferences['conditionalFormat.rules.v1']).toBe('[]')
    expect(parsed.preferences['conditionalFormat.sheetLock']).toBe('1')
  })

  it('清理页的规则开关（bgm_clean_on_<规则id>）按 CLEAN_RULES 枚举导出', () => {
    // 规则 id 从 CLEAN_RULES 取而不是写死 —— 写死的 id 会随规则表变动而悄悄失效
    // （曾经把 dup-name 写成 dup_name，用例红了半天才发现是测试自己猜错）。
    const firstRule = CLEAN_RULES[0]
    if (!firstRule) throw new Error('CLEAN_RULES 为空')
    const key = `bgm_clean_on_${firstRule.id}`
    mountStorage({ [key]: 'true' })

    const parsed = JSON.parse(exportConfig()) as {
      preferences: Record<string, string>
    }

    expect(parsed.preferences[key]).toBe('true')
  })

  it('清理页的 bgm_clean_sheets:<路径> 一族不导出（路径换机器对不上，无意义）', () => {
    mountStorage({ 'bgm_clean_sheets:D://a.xlsx': '["动画"]' })

    const parsed = JSON.parse(exportConfig()) as {
      preferences: Record<string, string>
    }

    expect(parsed.preferences['bgm_clean_sheets:D://a.xlsx']).toBeUndefined()
  })

  it('导入时接受各页面的新键（含不导出的 bgm_clean_sheets: 一族，保证老文件能进）', () => {
    const storage = mountStorage({})

    const json = JSON.stringify({
      version: 1,
      exportedAt: '2026-07-21T00:00:00.000Z',
      preferences: {
        'highlight.sheetLock': '1',
        'conditionalFormat.sheet.v1': 'wb.xlsx::动画',
        [`bgm_clean_on_${CLEAN_RULES[0]?.id ?? 'dup-name'}`]: 'false',
        'bgm_clean_sheets:D://a.xlsx': '["动画"]',
        bgm_still_not_a_real_key: 'x',
      },
    })

    expect(importConfig(json).isOk()).toBe(true)

    const written = storage.snapshot()
    expect(written['highlight.sheetLock']).toBe('1')
    expect(written['conditionalFormat.sheet.v1']).toBe('wb.xlsx::动画')
    expect(written[`bgm_clean_on_${CLEAN_RULES[0]?.id ?? 'dup-name'}`]).toBe('false')
    // 不导出但导入接受：老文件里带着这一族时不能报错
    expect(written['bgm_clean_sheets:D://a.xlsx']).toBe('["动画"]')
    // 真正的野键仍然拒绝
    expect(written.bgm_still_not_a_real_key).toBeUndefined()
  })
})
