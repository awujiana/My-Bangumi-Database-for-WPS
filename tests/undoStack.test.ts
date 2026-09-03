// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 使用 vi.hoisted 声明 mock 变量，确保在 vi.mock 工厂执行前已初始化
const { mockSetCellValue, mockGetDataSheet, mockBgmLog } = vi.hoisted(() => ({
  mockSetCellValue: vi.fn(),
  mockGetDataSheet: vi.fn(),
  mockBgmLog: vi.fn(),
}))

vi.mock('../ts/tools/util.js', () => ({
  getDataSheet: mockGetDataSheet,
  setCellValue: mockSetCellValue,
  bgmLog: mockBgmLog,
}))

import {
  beginUndoSession,
  recordUndoEntry,
  recordRowDeleteEntry,
  endUndoSession,
  undoLastSync,
  getUndoSessionCount,
  getLastSessionDescription,
  clearUndoStack,
} from '../ts/sync/undoStack.js'

function createMockWs(): any {
  const ws: any = {
    Range: vi.fn((addr: string) => {
      if (addr.includes(':')) {
        return { Insert: vi.fn() }
      }
      return {}
    }),
  }
  return ws
}

describe('UndoStack', () => {
  beforeEach((): void => {
    clearUndoStack()
    mockSetCellValue.mockClear()
    mockGetDataSheet.mockClear()
    mockBgmLog.mockClear()
    mockGetDataSheet.mockReturnValue(createMockWs())
  })

  describe('基础会话管理', () => {
    it('beginUndoSession 后可记录条目', (): void => {
      beginUndoSession('test')
      recordUndoEntry({ row: 1, col: 1, oldValue: 'a', newValue: 'b' })
      endUndoSession()
      expect(getUndoSessionCount()).toBe(1)
    })

    it('endUndoSession 后 currentSession 被清空', (): void => {
      beginUndoSession('test')
      endUndoSession()
      recordUndoEntry({ row: 1, col: 1, oldValue: 'a', newValue: 'b' })
      expect(getUndoSessionCount()).toBe(0)
    })

    it('空会话不入栈', (): void => {
      beginUndoSession('empty')
      endUndoSession()
      expect(getUndoSessionCount()).toBe(0)
    })

    it('无会话时 recordUndoEntry 不记录', (): void => {
      recordUndoEntry({ row: 1, col: 1, oldValue: 'a', newValue: 'b' })
      expect(getUndoSessionCount()).toBe(0)
    })

    it('无会话时 recordRowDeleteEntry 不记录', (): void => {
      recordRowDeleteEntry({ row: 5, values: { '1': 'val' } })
      expect(getUndoSessionCount()).toBe(0)
    })
  })

  describe('undoLastSync - 单元格恢复', () => {
    it('恢复最近会话的单元格变更', (): void => {
      beginUndoSession('test')
      recordUndoEntry({ row: 1, col: 1, oldValue: 'old', newValue: 'new' })
      endUndoSession()
      const restored = undoLastSync()
      expect(restored).toBe(1)
      expect(mockSetCellValue).toHaveBeenCalledWith(expect.anything(), 1, 1, 'old')
    })

    it('无会话时返回 0', (): void => {
      expect(undoLastSync()).toBe(0)
    })

    it('getDataSheet 返回 null 时返回 0', (): void => {
      mockGetDataSheet.mockReturnValue(null)
      beginUndoSession('test')
      recordUndoEntry({ row: 1, col: 1, oldValue: 'old', newValue: 'new' })
      endUndoSession()
      expect(undoLastSync()).toBe(0)
    })

    it('逆序恢复多条单元格变更', (): void => {
      beginUndoSession('test')
      recordUndoEntry({ row: 1, col: 1, oldValue: 'a', newValue: 'b' })
      recordUndoEntry({ row: 2, col: 1, oldValue: 'c', newValue: 'd' })
      endUndoSession()
      undoLastSync()
      // 应逆序调用：先 row=2，再 row=1
      expect(mockSetCellValue).toHaveBeenCalledTimes(2)
      expect(mockSetCellValue).toHaveBeenNthCalledWith(1, expect.anything(), 2, 1, 'c')
      expect(mockSetCellValue).toHaveBeenNthCalledWith(2, expect.anything(), 1, 1, 'a')
    })

    it('返回恢复的条目总数', (): void => {
      beginUndoSession('test')
      recordUndoEntry({ row: 1, col: 1, oldValue: 'a', newValue: 'b' })
      recordUndoEntry({ row: 2, col: 1, oldValue: 'c', newValue: 'd' })
      recordUndoEntry({ row: 3, col: 1, oldValue: 'e', newValue: 'f' })
      endUndoSession()
      expect(undoLastSync()).toBe(3)
    })
  })

  describe('undoLastSync - 行删除恢复', () => {
    it('恢复被删除的行', (): void => {
      const ws = createMockWs()
      mockGetDataSheet.mockReturnValue(ws)
      beginUndoSession('test')
      recordRowDeleteEntry({ row: 5, values: { '1': 'name', '2': 'value' } })
      endUndoSession()
      undoLastSync()
      // 应调用 Range.Insert() 在 row=5 处插入
      expect(ws.Range).toHaveBeenCalledWith('5:5')
    })

    it('按行号从大到小恢复多行删除', (): void => {
      const ws = createMockWs()
      mockGetDataSheet.mockReturnValue(ws)
      beginUndoSession('test')
      recordRowDeleteEntry({ row: 3, values: { '1': 'a' } })
      recordRowDeleteEntry({ row: 7, values: { '1': 'b' } })
      recordRowDeleteEntry({ row: 5, values: { '1': 'c' } })
      endUndoSession()
      undoLastSync()
      // 应按 7, 5, 3 顺序插入
      expect(ws.Range).toHaveBeenNthCalledWith(1, '7:7')
      expect(ws.Range).toHaveBeenNthCalledWith(2, '5:5')
      expect(ws.Range).toHaveBeenNthCalledWith(3, '3:3')
    })

    it('行恢复时设置单元格值', (): void => {
      const ws = createMockWs()
      mockGetDataSheet.mockReturnValue(ws)
      beginUndoSession('test')
      recordRowDeleteEntry({ row: 1, values: { '1': 'name', '3': 'value' } })
      endUndoSession()
      undoLastSync()
      // 应恢复 col=1 和 col=3 的值
      expect(mockSetCellValue).toHaveBeenCalledWith(expect.anything(), 1, 1, 'name')
      expect(mockSetCellValue).toHaveBeenCalledWith(expect.anything(), 1, 3, 'value')
    })

    it('行恢复时跳过 NaN 列索引', (): void => {
      const ws = createMockWs()
      mockGetDataSheet.mockReturnValue(ws)
      beginUndoSession('test')
      // 使用非数字字符串作为 key
      recordRowDeleteEntry({ row: 1, values: { abc: 'val', '2': 'ok' } })
      endUndoSession()
      undoLastSync()
      // 只应恢复 col=2 的值
      expect(mockSetCellValue).toHaveBeenCalledTimes(1)
      expect(mockSetCellValue).toHaveBeenCalledWith(expect.anything(), 1, 2, 'ok')
    })

    it('Range.Insert 失败时记录警告并继续', (): void => {
      const ws = {
        Range: vi.fn((addr: string) => {
          if (addr.includes(':')) {
            return {
              Insert: vi.fn(() => {
                throw new Error('插入失败')
              }),
            }
          }
          return {}
        }),
      }
      mockGetDataSheet.mockReturnValue(ws)
      beginUndoSession('test')
      recordRowDeleteEntry({ row: 1, values: { '1': 'val' } })
      endUndoSession()
      undoLastSync()
      expect(mockBgmLog).toHaveBeenCalled()
    })

    it('Range.Insert 抛出非 Error 对象时也能处理', (): void => {
      const ws = {
        Range: vi.fn((addr: string) => {
          if (addr.includes(':')) {
            return {
              Insert: vi.fn(() => {
                throw 'string error'
              }),
            }
          }
          return {}
        }),
      }
      mockGetDataSheet.mockReturnValue(ws)
      beginUndoSession('test')
      recordRowDeleteEntry({ row: 1, values: { '1': 'val' } })
      endUndoSession()
      undoLastSync()
      expect(mockBgmLog).toHaveBeenCalled()
    })

    it('混合单元格变更和行删除的会话', (): void => {
      const ws = createMockWs()
      mockGetDataSheet.mockReturnValue(ws)
      beginUndoSession('mixed')
      recordUndoEntry({ row: 10, col: 1, oldValue: 'old', newValue: 'new' })
      recordRowDeleteEntry({ row: 5, values: { '1': 'deleted' } })
      endUndoSession()
      const count = undoLastSync()
      // 1 cell + 1 row-delete
      expect(count).toBe(2)
    })
  })

  describe('会话栈管理', () => {
    it('超过 MAX_SESSIONS(20) 时自动清理最旧的', (): void => {
      for (let index = 0; index < 25; index += 1) {
        beginUndoSession(`session ${String(index)}`)
        recordUndoEntry({ row: index, col: 1, oldValue: 'old', newValue: 'new' })
        endUndoSession()
      }
      expect(getUndoSessionCount()).toBe(20)
    })

    it('多次 undoLastSync 按栈序逐个撤销', (): void => {
      beginUndoSession('first')
      recordUndoEntry({ row: 1, col: 1, oldValue: 'a1', newValue: 'b1' })
      endUndoSession()
      beginUndoSession('second')
      recordUndoEntry({ row: 2, col: 1, oldValue: 'a2', newValue: 'b2' })
      endUndoSession()
      expect(getUndoSessionCount()).toBe(2)
      expect(undoLastSync()).toBe(1)
      expect(getLastSessionDescription()).toBe('first')
      expect(undoLastSync()).toBe(1)
      expect(getLastSessionDescription()).toBeNull()
      expect(undoLastSync()).toBe(0)
    })

    it('getLastSessionDescription 返回最近会话描述', (): void => {
      beginUndoSession('GitHub 同步')
      recordUndoEntry({ row: 1, col: 1, oldValue: 'a', newValue: 'b' })
      endUndoSession()
      expect(getLastSessionDescription()).toBe('GitHub 同步')
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

    it('undoLastSync 后会话被弹出，栈长度减少', (): void => {
      beginUndoSession('test')
      recordUndoEntry({ row: 1, col: 1, oldValue: 'old', newValue: 'new' })
      endUndoSession()
      expect(getUndoSessionCount()).toBe(1)
      undoLastSync()
      expect(getUndoSessionCount()).toBe(0)
    })
  })
})
