import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock WPS API：测试环境无 WPS，用空对象模拟工作表使 setCellValue 能被调用
vi.mock('../ts/tools/util.js', () => ({
  getDataSheet: (): object => ({}),
  setCellValue: vi.fn(),
  bgmLog: vi.fn(),
}))

import {
  beginUndoSession,
  recordUndoEntry,
  endUndoSession,
  undoLastSync,
  getUndoSessionCount,
  getLastSessionDescription,
  clearUndoStack,
} from '../ts/sync/undoStack.js'

describe('UndoStack', () => {
  beforeEach((): void => {
    clearUndoStack()
  })

  it('beginUndoSession 后可记录条目', (): void => {
    beginUndoSession('test')
    recordUndoEntry({ row: 1, col: 1, oldValue: 'a', newValue: 'b' })
    endUndoSession()
    expect(getUndoSessionCount()).toBe(1)
  })

  it('endUndoSession 后 currentSession 被清空', (): void => {
    beginUndoSession('test')
    endUndoSession()
    // 再次 recordUndoEntry 不会记录（无活动会话）
    recordUndoEntry({ row: 1, col: 1, oldValue: 'a', newValue: 'b' })
    expect(getUndoSessionCount()).toBe(0)
  })

  it('undoLastSync 恢复最近会话', (): void => {
    beginUndoSession('test')
    recordUndoEntry({ row: 1, col: 1, oldValue: 'old', newValue: 'new' })
    endUndoSession()
    const restored = undoLastSync()
    expect(restored).toBe(1)
    expect(getUndoSessionCount()).toBe(0)
  })

  it('无会话时 undoLastSync 返回 0', (): void => {
    expect(undoLastSync()).toBe(0)
  })

  it('超过 MAX_SESSIONS 时自动清理最旧的', (): void => {
    for (let i = 0; i < 25; i++) {
      beginUndoSession('session ' + i)
      recordUndoEntry({ row: i, col: 1, oldValue: 'old', newValue: 'new' })
      endUndoSession()
    }
    expect(getUndoSessionCount()).toBe(20)
  })

  it('getLastSessionDescription 返回最近会话描述', (): void => {
    beginUndoSession('GitHub 同步')
    recordUndoEntry({ row: 1, col: 1, oldValue: 'a', newValue: 'b' })
    endUndoSession()
    expect(getLastSessionDescription()).toBe('GitHub 同步')
  })

  it('空会话不入栈', (): void => {
    beginUndoSession('empty')
    endUndoSession()
    expect(getUndoSessionCount()).toBe(0)
  })

  it('无会话时 getLastSessionDescription 返回 null', (): void => {
    expect(getLastSessionDescription()).toBeNull()
  })

  it('clearUndoStack 清空所有会话', (): void => {
    beginUndoSession('a')
    recordUndoEntry({ row: 1, col: 1, oldValue: 'a', newValue: 'b' })
    endUndoSession()
    beginUndoSession('b')
    recordUndoEntry({ row: 2, col: 1, oldValue: 'c', newValue: 'd' })
    endUndoSession()
    expect(getUndoSessionCount()).toBe(2)
    clearUndoStack()
    expect(getUndoSessionCount()).toBe(0)
    expect(getLastSessionDescription()).toBeNull()
  })

  it('多次 undoLastSync 按栈序逐个撤销', (): void => {
    beginUndoSession('first')
    recordUndoEntry({ row: 1, col: 1, oldValue: 'a1', newValue: 'b1' })
    endUndoSession()
    beginUndoSession('second')
    recordUndoEntry({ row: 2, col: 1, oldValue: 'a2', newValue: 'b2' })
    endUndoSession()
    expect(getUndoSessionCount()).toBe(2)
    // 第一次撤销：弹出 second
    expect(undoLastSync()).toBe(1)
    expect(getLastSessionDescription()).toBe('first')
    // 第二次撤销：弹出 first
    expect(undoLastSync()).toBe(1)
    expect(getLastSessionDescription()).toBeNull()
    // 第三次撤销：无会话
    expect(undoLastSync()).toBe(0)
  })
})
