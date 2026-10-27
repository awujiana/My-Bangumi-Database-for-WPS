/**
 * @fileoverview `ts/tools/target-detect-cache.ts`（识别结果缓存）单元测试。
 *
 * 契约：
 *  - 签名 = `Count|各簿Name|活动簿名`（默认含活动簿；可显式关闭）；
 *  - 签名一致 + 字段完整才命中，否则一律视为未命中（调用方回退全扫）；
 *  - 存储不可用 / 内容损坏 / 写入抛错 → 全部静默降级，不影响主流程。
 */

import { describe, expect, it } from 'vitest'

import {
  TARGET_CACHE_KEY,
  clearTargetCache,
  loadTargetCache,
  readWorkbookSignature,
  saveTargetCache,
} from '../ts/tools/target-detect-cache.js'
import type { CachedTarget, StorageLike } from '../ts/tools/target-detect-cache.js'

/** 内存存储替身 */
function createStorage(initial: string | null = null): StorageLike & { raw: () => string | null } {
  let value: string | null = initial
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
    raw: () => value,
  }
}

const TARGET: CachedTarget = {
  workbookName: 'BGM.xlsx',
  sheetIndex: 3,
  sheetName: '动画',
  headerRow: 1,
  matchCount: 7,
  columnCount: 7,
}

describe('readWorkbookSignature', () => {
  const app = {
    Workbooks: {
      Count: 2,
      Item: (index: number) => ({ Name: index === 1 ? 'A.xlsx' : 'B.xlsx' }),
    },
    ActiveWorkbook: { Name: 'B.xlsx' },
  }

  it('默认包含活动工作簿名', () => {
    expect(readWorkbookSignature(app)).toBe('2|A.xlsx,B.xlsx|B.xlsx')
  })

  it('includeActive: false 时只按工作簿集合判等', () => {
    expect(readWorkbookSignature(app, { includeActive: false })).toBe('2|A.xlsx,B.xlsx')
  })

  it('活动工作簿读取抛错 → 视为空名，不抛', () => {
    const throwing = {
      Workbooks: app.Workbooks,
      get ActiveWorkbook(): never {
        throw new Error('切换中')
      },
    }
    expect(readWorkbookSignature(throwing)).toBe('2|A.xlsx,B.xlsx|')
  })

  it('单个工作簿 Name 读取抛错 → 占位 ?，不中断', () => {
    const partial = {
      Workbooks: {
        Count: 2,
        Item: (index: number) => {
          if (index === 2) throw new Error('已关闭')
          return { Name: 'A.xlsx' }
        },
      },
    }
    expect(readWorkbookSignature(partial, { includeActive: false })).toBe('2|A.xlsx,?')
  })

  it('app 为空 → 0||（含空活动簿名）', () => {
    expect(readWorkbookSignature(null)).toBe('0||')
    expect(readWorkbookSignature(undefined, { includeActive: false })).toBe('0|')
  })
})

describe('loadTargetCache / saveTargetCache', () => {
  it('无存储 → 未命中', () => {
    expect(loadTargetCache('panel', 'sig', null)).toBeNull()
  })

  it('空存储 → 未命中', () => {
    expect(loadTargetCache('panel', 'sig', createStorage())).toBeNull()
  })

  it('写入后可原样读回（含用途隔离）', () => {
    const storage = createStorage()
    saveTargetCache('panel', 'sig-1', TARGET, storage)

    expect(loadTargetCache('panel', 'sig-1', storage)).toEqual(TARGET)
    expect(loadTargetCache('enrich', 'sig-1', storage)).toBeNull()
  })

  it('签名不一致 → 未命中（调用方回退全扫）', () => {
    const storage = createStorage()
    saveTargetCache('panel', 'sig-1', TARGET, storage)

    expect(loadTargetCache('panel', 'sig-2', storage)).toBeNull()
  })

  it('两种用途互不覆盖', () => {
    const storage = createStorage()
    saveTargetCache('panel', 'sig-1', TARGET, storage)
    saveTargetCache('enrich', 'sig-1', { ...TARGET, sheetName: '番剧' }, storage)

    expect(loadTargetCache('panel', 'sig-1', storage)?.sheetName).toBe('动画')
    expect(loadTargetCache('enrich', 'sig-1', storage)?.sheetName).toBe('番剧')
  })

  it('同用途再次写入 → 覆盖旧值', () => {
    const storage = createStorage()
    saveTargetCache('panel', 'sig-1', TARGET, storage)
    saveTargetCache('panel', 'sig-2', { ...TARGET, sheetIndex: 9 }, storage)

    expect(loadTargetCache('panel', 'sig-1', storage)).toBeNull()
    expect(loadTargetCache('panel', 'sig-2', storage)?.sheetIndex).toBe(9)
  })

  it('内容损坏 → 视为未命中，不抛', () => {
    expect(loadTargetCache('panel', 'sig', createStorage('{坏 JSON'))).toBeNull()
    expect(loadTargetCache('panel', 'sig', createStorage('null'))).toBeNull()
    expect(loadTargetCache('panel', 'sig', createStorage('"字符串"'))).toBeNull()
  })

  it('字段不完整 → 视为未命中', () => {
    const storage = createStorage(
      JSON.stringify({ panel: { signature: 'sig', target: { workbookName: '', sheetIndex: 1 } } }),
    )
    expect(loadTargetCache('panel', 'sig', storage)).toBeNull()
  })

  it('写入抛错（存储只读）→ 不抛', () => {
    const readonly: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('只读')
      },
    }
    expect(() => {
      saveTargetCache('panel', 'sig', TARGET, readonly)
    }).not.toThrow()
  })
})

describe('clearTargetCache', () => {
  it('按用途清除只影响该用途', () => {
    const storage = createStorage()
    saveTargetCache('panel', 'sig', TARGET, storage)
    saveTargetCache('enrich', 'sig', TARGET, storage)

    clearTargetCache('panel', storage)

    expect(loadTargetCache('panel', 'sig', storage)).toBeNull()
    expect(loadTargetCache('enrich', 'sig', storage)).not.toBeNull()
  })

  it('不传用途 → 全部清除', () => {
    const storage = createStorage()
    saveTargetCache('panel', 'sig', TARGET, storage)
    saveTargetCache('enrich', 'sig', TARGET, storage)

    clearTargetCache(undefined, storage)

    expect(loadTargetCache('panel', 'sig', storage)).toBeNull()
    expect(loadTargetCache('enrich', 'sig', storage)).toBeNull()
    expect(storage.raw()).toBe('')
  })

  it('无存储 / 清除抛错 → 不抛', () => {
    expect(() => {
      clearTargetCache('panel', null)
      clearTargetCache('panel', {
        getItem: () => null,
        setItem: () => {
          throw new Error('只读')
        },
      })
    }).not.toThrow()
  })

  it('缓存键固定（跨版本兼容）', () => {
    expect(TARGET_CACHE_KEY).toBe('bgm_target_detect_cache')
  })
})
