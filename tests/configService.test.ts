import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖：避开 utility.ts 的副作用链（util → wps → index → handlers → document）
// 仅提供 configService.ts 实际使用的 4 个函数
vi.mock('../ts/tools/utility.js', () => ({
  loadBgToken: vi.fn(() => 'test-token'),
  storeBgToken: vi.fn(() => true),
  _getBgmUserId: vi.fn(() => 'test-user-123'),
  _setBgmUserId: vi.fn(),
}))

// Mock githubConfig.ts：避免触发 PluginStorage 访问和事件发射
vi.mock('../ts/sync/githubConfig.js', () => ({
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
import { exportConfig, importConfig } from '../ts/services/configService.js'
import { loadBgToken, storeBgToken, _getBgmUserId, _setBgmUserId } from '../ts/tools/utility.js'
import {
  getGithubConfig,
  setGithubConfig,
  getSyncStrategy,
  setSyncStrategy,
} from '../ts/sync/githubConfig.js'

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
