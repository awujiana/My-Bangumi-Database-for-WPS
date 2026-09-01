/**
 * @fileoverview 冲突解决 UI 测试
 *
 * 验证 showConflictResolver 的核心交互：
 *   - 空冲突列表直接返回空数组（不弹窗）
 *   - 有冲突时正确渲染模态框（表格行数、文本内容）
 *   - 点击「确认」返回决策数组，默认全部 'local'
 *   - 点击「取消」返回 null
 *   - 「全部使用本地」按钮将所有 radio 设为 local
 *   - 「全部使用远程」按钮将所有 radio 设为 remote
 *   - 单条切换为 remote 后确认，对应决策为 'remote'
 *   - 模态框关闭后从 DOM 移除（避免残留监听器）
 *
 * 测试环境：jsdom（需要 document API）
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest'
import { showConflictResolver } from '../ts/ui/conflictResolver.js'
import type { Conflict } from '../ts/services/ribbonService.js'

// ========== 公共测试数据 ==========
const SAMPLE_CONFLICTS: Conflict[] = [
  { sid: '123', field: '打分', localValue: '8', remoteValue: '9', localRow: 2 },
  { sid: '456', field: '名称', localValue: '旧名称', remoteValue: '新名称', localRow: 3 },
]

/** 每个测试前清理 body，避免上次测试残留 */
beforeEach((): void => {
  document.body.replaceChildren();
})

// ========== 测试用例 ==========

describe('showConflictResolver - 空冲突列表', () => {
  it('空冲突列表返回空数组', async (): Promise<void> => {
    const result = await showConflictResolver([])
    expect(result).toEqual([])
  })

  it('空冲突列表不创建模态框', async (): Promise<void> => {
    await showConflictResolver([])
    const modal = document.querySelector('.conflict-modal')
    expect(modal).toBeNull()
  })
})

describe('showConflictResolver - 模态框渲染', () => {
  it('有冲突时创建模态框', async (): Promise<void> => {
    // 不 await：模态框是异步的，需要先验证 DOM 再点击按钮关闭
    const promise = showConflictResolver(SAMPLE_CONFLICTS)

    // 验证模态框已添加到 DOM
    const modal = document.querySelector('.conflict-modal')
    expect(modal).not.toBeNull()

    // 关闭模态框（避免悬挂 Promise）
    const confirmButton = document.querySelector<HTMLButtonElement>('.conflict-btn-confirm')
    confirmButton?.click()
    await promise
  })

  it('模态框包含正确数量的冲突行', async (): Promise<void> => {
    const promise = showConflictResolver(SAMPLE_CONFLICTS)

    const rows = document.querySelectorAll('.conflict-row')
    expect(rows).toHaveLength(SAMPLE_CONFLICTS.length)

    // 清理
    const confirmButton = document.querySelector<HTMLButtonElement>('.conflict-btn-confirm')
    confirmButton?.click()
    await promise
  })

  it('冲突行正确渲染 SID、字段、本地值、远程值', async (): Promise<void> => {
    const promise = showConflictResolver(SAMPLE_CONFLICTS)

    const firstRow = document.querySelector<HTMLTableRowElement>('.conflict-row')
    expect(firstRow).not.toBeNull()

    const cells = firstRow?.querySelectorAll('td')
    expect(cells).toHaveLength(5)
    // 使用 textContent 验证（防 XSS 的关键）
    expect(cells?.[0]?.textContent).toBe('123')
    expect(cells?.[1]?.textContent).toBe('打分')
    expect(cells?.[2]?.textContent).toBe('8')
    expect(cells?.[3]?.textContent).toBe('9')

    // 清理
    const confirmButton = document.querySelector<HTMLButtonElement>('.conflict-btn-confirm')
    confirmButton?.click()
    await promise
  })

  it('冲突计数文本正确显示', async (): Promise<void> => {
    const promise = showConflictResolver(SAMPLE_CONFLICTS)

    const count = document.querySelector('.conflict-count')
    expect(count?.textContent).toBe(`${String(SAMPLE_CONFLICTS.length)} 个冲突`)

    // 清理
    const confirmButton = document.querySelector<HTMLButtonElement>('.conflict-btn-confirm')
    confirmButton?.click()
    await promise
  })

  it('XSS payload 被正确转义（使用 textContent）', async (): Promise<void> => {
    const xssConflicts: Conflict[] = [
      {
        sid: '<img onerror=alert(1)>',
        field: '<script>alert(1)</script>',
        localValue: '"><svg onload=alert(1)>',
        remoteValue: 'javascript:alert(1)',
        localRow: 1,
      },
    ]
    const promise = showConflictResolver(xssConflicts)

    // 验证没有 script 标签被注入
    const injectedScripts = document.querySelectorAll('script')
    expect(injectedScripts).toHaveLength(0)

    // 验证 img 标签没有被注入（textContent 应将其作为纯文本）
    const injectedImgs = document.querySelectorAll('img')
    expect(injectedImgs).toHaveLength(0)

    // 清理
    const confirmButton = document.querySelector<HTMLButtonElement>('.conflict-btn-confirm')
    confirmButton?.click()
    await promise
  })
})

describe('showConflictResolver - 确认与取消', () => {
  it('点击确认按钮返回决策数组，默认全部 local', async (): Promise<void> => {
    const promise = showConflictResolver(SAMPLE_CONFLICTS)

    const confirmButton = document.querySelector<HTMLButtonElement>('.conflict-btn-confirm')
    confirmButton?.click()

    const result = await promise
    expect(result).not.toBeNull()
    expect(result).toHaveLength(SAMPLE_CONFLICTS.length)
    // 默认全部 local
    expect(result?.every((r) => r.chosenValue === 'local')).toBe(true)
    // 验证 sid 与 field 对应
    expect(result?.[0]?.sid).toBe('123')
    expect(result?.[0]?.field).toBe('打分')
    expect(result?.[1]?.sid).toBe('456')
    expect(result?.[1]?.field).toBe('名称')
  })

  it('点击取消按钮返回 null', async (): Promise<void> => {
    const promise = showConflictResolver(SAMPLE_CONFLICTS)

    // 找到取消按钮（工具栏第 4 个 button：全部本地、全部远程、取消、确认）
    const cancelButton = document.querySelectorAll<HTMLButtonElement>(
      '.conflict-toolbar .btn.small',
    )[2]
    expect(cancelButton?.textContent).toBe('取消')
    cancelButton?.click()

    const result = await promise
    expect(result).toBeNull()
  })

  it('确认后模态框从 DOM 移除', async (): Promise<void> => {
    const promise = showConflictResolver(SAMPLE_CONFLICTS)

    const confirmButton = document.querySelector<HTMLButtonElement>('.conflict-btn-confirm')
    confirmButton?.click()
    await promise

    const modal = document.querySelector('.conflict-modal')
    expect(modal).toBeNull()
  })

  it('取消后模态框从 DOM 移除', async (): Promise<void> => {
    const promise = showConflictResolver(SAMPLE_CONFLICTS)

    const cancelButton = document.querySelectorAll<HTMLButtonElement>(
      '.conflict-toolbar .btn.small',
    )[2]
    cancelButton?.click()
    await promise

    const modal = document.querySelector('.conflict-modal')
    expect(modal).toBeNull()
  })
})

describe('showConflictResolver - 批量选择', () => {
  it('点击「全部使用本地」按钮，所有决策为 local', async (): Promise<void> => {
    const promise = showConflictResolver(SAMPLE_CONFLICTS)

    // 先切换部分为 remote
    const remoteRadios = document.querySelectorAll<HTMLInputElement>(
      '.conflict-col-select input[value="remote"]',
    )
    remoteRadios.forEach((r) => {
      r.checked = true
    })

    // 点击「全部使用本地」（工具栏第 1 个 button）
    const allLocalButton = document.querySelectorAll<HTMLButtonElement>(
      '.conflict-toolbar .btn.small',
    )[0]
    expect(allLocalButton?.textContent).toBe('全部使用本地')
    allLocalButton?.click()

    // 确认
    const confirmButton = document.querySelector<HTMLButtonElement>('.conflict-btn-confirm')
    confirmButton?.click()

    const result = await promise
    expect(result?.every((r) => r.chosenValue === 'local')).toBe(true)
  })

  it('点击「全部使用远程」按钮，所有决策为 remote', async (): Promise<void> => {
    const promise = showConflictResolver(SAMPLE_CONFLICTS)

    // 点击「全部使用远程」（工具栏第 2 个 button）
    const allRemoteButton = document.querySelectorAll<HTMLButtonElement>(
      '.conflict-toolbar .btn.small',
    )[1]
    expect(allRemoteButton?.textContent).toBe('全部使用远程')
    allRemoteButton?.click()

    // 确认
    const confirmButton = document.querySelector<HTMLButtonElement>('.conflict-btn-confirm')
    confirmButton?.click()

    const result = await promise
    expect(result?.every((r) => r.chosenValue === 'remote')).toBe(true)
  })
})

describe('showConflictResolver - 单条切换', () => {
  it('将第一条切换为 remote 后确认，第一条返回 remote，第二条仍为 local', async (): Promise<void> => {
    const promise = showConflictResolver(SAMPLE_CONFLICTS)

    // 找到第一行的 remote radio 并选中
    const firstRow = document.querySelectorAll<HTMLTableRowElement>('.conflict-row')[0]
    const remoteRadio = firstRow?.querySelector<HTMLInputElement>('input[value="remote"]')
    expect(remoteRadio).toBeTruthy()
    remoteRadio!.checked = true

    // 确认
    const confirmButton = document.querySelector<HTMLButtonElement>('.conflict-btn-confirm')
    confirmButton?.click()

    const result = await promise
    expect(result).toHaveLength(2)
    expect(result?.[0]?.chosenValue).toBe('remote')
    expect(result?.[1]?.chosenValue).toBe('local')
  })

  it('单条冲突切换为 remote 后确认', async (): Promise<void> => {
    const singleConflict: Conflict[] = [
      { sid: '789', field: '是否看完', localValue: '在看', remoteValue: '看过', localRow: 5 },
    ]
    const promise = showConflictResolver(singleConflict)

    const remoteRadio = document.querySelector<HTMLInputElement>('input[value="remote"]')
    expect(remoteRadio).toBeTruthy()
    remoteRadio!.checked = true

    const confirmButton = document.querySelector<HTMLButtonElement>('.conflict-btn-confirm')
    confirmButton?.click()

    const result = await promise
    expect(result).toHaveLength(1)
    expect(result?.[0]?.chosenValue).toBe('remote')
    expect(result?.[0]?.sid).toBe('789')
    expect(result?.[0]?.field).toBe('是否看完')
  })
})
