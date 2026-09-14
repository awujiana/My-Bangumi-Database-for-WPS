/**
 * @fileoverview core/ui-bridge.ts 单元测试
 *
 * 覆盖 P1-5（消除分层反向依赖 → 依赖反转）引入的桥（见 文档/TS_AUDIT_2026_09_10.md）：
 *  - 未注册时返回降级实现：不抛错、confirm 按「未确认」回调、写一次告警
 *  - 注册后返回被注册的实现，调用直接透传
 *  - **生产装配**：仅 import ui/dialog.ts / ui/preview.ts 即完成注册
 *    （防止「忘了注册」导致通知与进度弹窗静默失效——降级实现只写日志，肉眼看不见）
 */

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { NotifyApi } from '../ts/core/ui-bridge.js'

/** 构造一个记录调用的 NotifyApi 实现 */
function createSpyNotify(): NotifyApi {
  return {
    alert: vi.fn(),
    confirm: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    input: vi.fn(),
  }
}

describe('core/ui-bridge', () => {
  beforeEach(() => {
    // 桥的状态是模块级单例，必须重置模块注册表才能测「未注册」分支
    vi.resetModules()
  })

  describe('未注册时的降级行为', () => {
    it('getNotifyApi 返回不抛错的降级实现', async () => {
      const bridge = await import('../ts/core/ui-bridge.js')
      const notify = bridge.getNotifyApi()
      expect(() => {
        notify.alert('标题', '消息')
        notify.error('标题', '消息')
        notify.success('标题', '消息')
        notify.toast('消息', 'warn')
        notify.input('标题', '提示')
      }).not.toThrow()
    })

    it('confirm 在无 UI 环境按「未确认」回调（不能让调用方把默认值当作用户同意）', async () => {
      const bridge = await import('../ts/core/ui-bridge.js')
      const callback = vi.fn()
      bridge.getNotifyApi().confirm('确定吗？', callback)
      expect(callback).toHaveBeenCalledWith(false)
    })

    it('getSyncProgressApi 返回不抛错的降级实现', async () => {
      const bridge = await import('../ts/core/ui-bridge.js')
      const progress = bridge.getSyncProgressApi()
      expect(() => {
        progress.show('同步中', { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn() })
        progress.update(1, 10, '消息')
        progress.complete('完成', [])
        progress.hide()
      }).not.toThrow()
    })

    it('getSyncRunner 未注册时返回 null（调用方需给出「同步不可用」提示）', async () => {
      const bridge = await import('../ts/core/ui-bridge.js')
      expect(bridge.getSyncRunner()).toBeNull()
    })
  })

  describe('注册后透传', () => {
    it('registerNotifyApi 后 getNotifyApi 返回注册的实现', async () => {
      const bridge = await import('../ts/core/ui-bridge.js')
      const api = createSpyNotify()
      bridge.registerNotifyApi(api)

      expect(bridge.getNotifyApi()).toBe(api)
      bridge.getNotifyApi().toast('你好', 'warn')
      expect(api.toast).toHaveBeenCalledWith('你好', 'warn')
    })

    it('registerSyncProgressApi 后 getSyncProgressApi 返回注册的实现', async () => {
      const bridge = await import('../ts/core/ui-bridge.js')
      const show = vi.fn()
      const update = vi.fn()
      const complete = vi.fn()
      const hide = vi.fn()
      bridge.registerSyncProgressApi({ show, update, complete, hide })

      bridge.getSyncProgressApi().update(3, 10, '消息')
      expect(update).toHaveBeenCalledWith(3, 10, '消息')
    })

    it('registerSyncRunner 后 getSyncRunner 返回注册的执行体', async () => {
      const bridge = await import('../ts/core/ui-bridge.js')
      const run = vi.fn().mockResolvedValue({ success: 1, fail: 0, skip: 0 })
      bridge.registerSyncRunner(run)

      expect(bridge.getSyncRunner()).toBe(run)
      await bridge.getSyncRunner()?.()
      expect(run).toHaveBeenCalledTimes(1)
    })
  })

  // 这两条要 `await import` 整条生产依赖链（preview.ts → sync/… 几十个模块），
  // 冷启动 + 并行 worker 争 CPU 时首次 transform 会超过默认 5s —— 是环境慢、不是断言错，
  // 因此单独放宽超时，避免它反复把全量测试染红（隔离单跑一直是 9/9 稳过）。
  describe('生产装配（防止忘记注册）', { timeout: 30_000 }, () => {
    it('import ui/dialog.ts 即注册通知与同步进度实现', async () => {
      const dialog = await import('../ts/ui/dialog.js')
      const bridge = await import('../ts/core/ui-bridge.js')

      const notify = bridge.getNotifyApi()
      expect(notify.alert).toBe(dialog.showAlert)
      expect(notify.confirm).toBe(dialog.showConfirm)
      expect(notify.error).toBe(dialog.showError)
      expect(notify.success).toBe(dialog.showSuccess)
      expect(notify.toast).toBe(dialog.showToast)
      expect(notify.input).toBe(dialog.showInput)

      const progress = bridge.getSyncProgressApi()
      expect(progress.show).toBe(dialog.showSyncProgressDialog)
      expect(progress.update).toBe(dialog.updateSyncProgressDialog)
      expect(progress.complete).toBe(dialog.completeSyncProgressDialog)
      expect(progress.hide).toBe(dialog.hideSyncProgressDialog)
    })

    it('import ui/preview.ts 即注册同步执行体', async () => {
      const preview = await import('../ts/ui/preview.js')
      const bridge = await import('../ts/core/ui-bridge.js')
      expect(bridge.getSyncRunner()).toBe(preview.syncAllRows)
    })
  })
})
