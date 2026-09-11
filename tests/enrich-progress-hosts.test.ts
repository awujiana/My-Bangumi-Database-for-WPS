/**
 * @fileoverview enrich-progress-hosts 单测：三处内嵌进度的槽位与工厂
 *
 * 重点锁两件事：
 *   1. `progressHosts` 是**可变对象**而非 `export let` —— ESM 的 live binding 只允许
 *      导入方读取、不能赋值，而三个槽位必须能被「富化执行 / 批量富化 / 冲突对话框」
 *      各自写入。若哪天改回 `export let`，这里的赋值断言会立刻失败。
 *   2. `createInlineProgress` 只在提供 `onStop` 时才打开「停止」按钮。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const createProgressMock = vi.fn()

vi.mock('../ts/ui/components/progress.js', () => ({
  createProgress: (options: unknown): unknown => createProgressMock(options) as unknown,
}))

import { progressHosts, createInlineProgress } from '../ts/panel/enrich-progress-hosts.js'
import type { ProgressShowOptions } from '../ts/ui/components/progress.js'

beforeEach(() => {
  vi.clearAllMocks()
  progressHosts.enrich = null
  progressHosts.batch = null
  progressHosts.conflict = null
})

describe('progressHosts 槽位', () => {
  it('三个槽位初始为 null', () => {
    expect(progressHosts).toEqual({ enrich: null, batch: null, conflict: null })
  })

  it('槽位可被外部赋值（对象持有而非 live binding）', () => {
    const fake = { update: vi.fn(), hide: vi.fn() }
    progressHosts.batch = fake as never
    expect(progressHosts.batch).toBe(fake)

    progressHosts.batch = null
    expect(progressHosts.batch).toBeNull()
  })
})

describe('createInlineProgress', () => {
  it('走 inline 模式并透传 hostId / title / icon', () => {
    createInlineProgress('enrichProgressHost', '富化进度', '✨')
    expect(createProgressMock).toHaveBeenCalledTimes(1)
    expect(createProgressMock).toHaveBeenCalledWith({
      mode: 'inline',
      hostId: 'enrichProgressHost',
      title: '富化进度',
      icon: '✨',
    })
  })

  it('未提供 onStop 时不渲染「停止」按钮', () => {
    createInlineProgress('host', 't', 'i')
    const options = createProgressMock.mock.calls[0]?.[0] as ProgressShowOptions
    expect(options.enableStop).toBeUndefined()
    expect(options.onStop).toBeUndefined()
  })

  it('提供 onStop 时同时设置 enableStop 与 onStop', () => {
    const onStop = vi.fn()
    createInlineProgress('host', 't', 'i', onStop)
    const options = createProgressMock.mock.calls[0]?.[0] as ProgressShowOptions
    expect(options.enableStop).toBe(true)
    expect(options.onStop).toBe(onStop)
  })

  it('返回 createProgress 的返回值（宿主缺失时为 null，调用方需判空）', () => {
    createProgressMock.mockReturnValueOnce(null)
    expect(createInlineProgress('missingHost', 't', 'i')).toBeNull()
  })
})
