// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'

// 注意：syncSourceRegistry.ts 在模块加载时会默认注册 'github' → GithubSyncSource。
// 这会触发 githubSync.ts → tools/util/index.js → tools/wps.js → index.js → ui/handlers/index.js
// 的副作用链，handlers.js 顶层访问 document.readyState，因此需要 jsdom 环境。
//
// handlers.ts 在模块加载时通过 trackedSetTimeout(setupButtonListeners, 0) 与
// initializeListeners() -> trackedSetTimeout(..., 100) 调度了延迟回调，回调内访问
// BGM 全局对象（在测试环境未初始化）会导致 unhandled error。
// 由于 setTimeout(fn, 0) 可能在 ESM 模块加载与测试 body 之间被 event loop 触发，
// clearAllPendingTimeouts() 同步调用无法可靠拦截。
// 解决方案：使用 vi.hoisted() 在所有 import 之前启用 fake timers，
// 使 handlers.ts 模块加载时调度的 setTimeout 进入 fake 队列而不会真实触发。
vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

import {
  registerSyncSource,
  getSyncSource,
  getRegisteredSourceTypes,
  isSyncSourceRegistered,
} from '../ts/sync/sync-source-registry.js'
import { GithubSyncSource } from '../ts/sync/github-sync.js'
import type { SyncSource } from '../ts/sync/sync-source.js'
import { Result } from '../ts/core/result.js'

// 清空模块加载期间累积的 fake timers，避免它们在测试中被意外触发
vi.clearAllTimers()

// 每个测试结束后清理 fake timer 队列，防止跨用例污染
afterEach(() => {
  vi.clearAllTimers()
})

// 全部测试结束后恢复真实 timers，避免影响 vitest 自身的调度
afterAll(() => {
  vi.useRealTimers()
})

/**
 * Mock 同步源实现：用于测试注册表 API
 * 不依赖任何外部资源，校验永远成功，返回空数组。
 */
class MockSource implements SyncSource {
  getSourceType(): string {
    return 'mock'
  }

  getDisplayName(): string {
    return 'Mock'
  }

  fetchRemoteEntries(): Promise<never[]> {
    return Promise.resolve([])
  }

  validateConfig(): Result<void> {
    return Result.ok(undefined)
  }
}

describe('syncSourceRegistry', () => {
  it('GitHub 默认已注册', () => {
    expect(isSyncSourceRegistered('github')).toBe(true)
  })

  it('getSyncSource 返回 GithubSyncSource 实例', () => {
    const source = getSyncSource('github')
    expect(source).toBeInstanceOf(GithubSyncSource)
  })

  it('未注册的类型返回 null', () => {
    expect(getSyncSource('unknown')).toBeNull()
  })

  it('registerSyncSource 注册新类型', () => {
    registerSyncSource('mock', () => new MockSource())
    expect(isSyncSourceRegistered('mock')).toBe(true)
    const source = getSyncSource('mock')
    expect(source).toBeInstanceOf(MockSource)
  })

  it('getRegisteredSourceTypes 返回所有类型', () => {
    registerSyncSource('mock', () => new MockSource())
    const types = getRegisteredSourceTypes()
    expect(types).toContain('github')
    expect(types).toContain('mock')
  })
})

describe('GithubSyncSource', () => {
  it('getSourceType 返回 github', () => {
    const source = new GithubSyncSource()
    expect(source.getSourceType()).toBe('github')
  })

  it('getDisplayName 返回 GitHub', () => {
    const source = new GithubSyncSource()
    expect(source.getDisplayName()).toBe('GitHub')
  })
})
