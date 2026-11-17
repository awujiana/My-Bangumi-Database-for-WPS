/**
 * @fileoverview `ts/core/sync-progress-handlers.ts`（同步进度弹窗三键工厂）单元测试。
 *
 * 该模块是 §5.6 C1 的收敛产物：5 处逐字重复的 `BGM.sync` 委托 handlers +
 * 1 处空实现变体 → 两个零依赖工厂。本文件锁定工厂的核心契约：
 * 三键与状态机一一对应、无操作变体不抛错。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  createNoopSyncHandlers,
  createSyncControlHandlers,
} from '../ts/core/sync-progress-handlers.js'
import type { SyncStateMachine } from '../ts/core/sync-progress-handlers.js'

describe('createSyncControlHandlers', () => {
  it('三键分别委托状态机的 pause / resume / requestStop', () => {
    const sync: SyncStateMachine = {
      pause: vi.fn(),
      resume: vi.fn(),
      requestStop: vi.fn(),
    }

    const handlers = createSyncControlHandlers(sync)
    handlers.onPause()
    handlers.onResume()
    handlers.onStop()

    expect(sync.pause).toHaveBeenCalledTimes(1)
    expect(sync.resume).toHaveBeenCalledTimes(1)
    expect(sync.requestStop).toHaveBeenCalledTimes(1)
  })

  it('注入的状态机替换后委托跟随新对象（调用方依赖路径可换）', () => {
    const first: SyncStateMachine = { pause: vi.fn(), resume: vi.fn(), requestStop: vi.fn() }
    const second: SyncStateMachine = { pause: vi.fn(), resume: vi.fn(), requestStop: vi.fn() }

    createSyncControlHandlers(first).onPause()
    createSyncControlHandlers(second).onPause()

    expect(first.pause).toHaveBeenCalledTimes(1)
    expect(second.pause).toHaveBeenCalledTimes(1)
  })
})

describe('createNoopSyncHandlers', () => {
  it('三键均为无操作且不抛错', () => {
    const handlers = createNoopSyncHandlers()

    expect(() => {
      handlers.onPause()
      handlers.onResume()
      handlers.onStop()
    }).not.toThrow()
  })
})
