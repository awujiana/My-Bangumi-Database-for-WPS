// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  stringifyCell,
  toCsv,
  toText,
  formatFileTimestamp,
  buildFileName,
  downloadTextFile,
  exportRows,
} from '../ts/tools/file-export.js'

/** 捕获到的 Blob 与「被点击的下载文件名」 */
let capturedBlobs: Blob[]
let clickedNames: string[]

beforeEach(() => {
  capturedBlobs = []
  clickedNames = []
  // jsdom 未实现 createObjectURL，这里只记录入参，不做真实转换
  Reflect.set(URL, 'createObjectURL', (blob: Blob): string => {
    capturedBlobs.push(blob)
    return 'blob:mock-url'
  })
  Reflect.set(URL, 'revokeObjectURL', (): void => {
    /* 测试里无需释放 */
  })
  // 用 function（非箭头）让 this 指向被点击的 <a>，从而拿到 download 属性
  vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function captureDownloadName(this: HTMLAnchorElement): void {
      clickedNames.push(this.download)
    })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('stringifyCell', () => {
  it('null / undefined 转空串', () => {
    expect(stringifyCell(null)).toBe('')
    expect(stringifyCell(undefined)).toBe('')
  })

  it('数字原样输出，非有限数转空串', () => {
    expect(stringifyCell(42)).toBe('42')
    expect(stringifyCell(1.5)).toBe('1.5')
    expect(stringifyCell(NaN)).toBe('')
    expect(stringifyCell(Infinity)).toBe('')
  })

  it('布尔值转中文「是 / 否」', () => {
    expect(stringifyCell(true)).toBe('是')
    expect(stringifyCell(false)).toBe('否')
  })

  it('字符串原样返回（不额外转义，转义由序列化层负责）', () => {
    expect(stringifyCell('a,b')).toBe('a,b')
  })
})

describe('toCsv', () => {
  it('输出表头 + 数据行，列以逗号分隔', () => {
    const csv = toCsv(['名称', '数量'], [['进击的巨人', 12], ['葬送的芙莉莲', 28]])
    // 去掉 BOM 后再比较，避免断言被 BOM 干扰
    expect(csv.slice(1)).toBe('名称,数量\r\n进击的巨人,12\r\n葬送的芙莉莲,28')
  })

  it('带 UTF-8 BOM（Excel 靠它识别编码，缺了中文全乱码）', () => {
    expect(toCsv(['a'], [['b']]).codePointAt(0)).toBe(0xfeff)
  })

  it('字段含逗号 / 双引号 / 换行时加引号，内部引号翻倍', () => {
    const csv = toCsv(['f'], [['a,b'], ['say "hi"'], ['line1\nline2']])
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('"say ""hi"""')
    expect(csv).toContain('"line1\nline2"')
  })

  it('null / undefined 单元格转空串而不是字符串 "null"', () => {
    const csv = toCsv(['a', 'b'], [[null, undefined]])
    expect(csv).not.toContain('null')
    // 末行无行尾换行，故用 endsWith 而非包含 ','
    expect(csv.endsWith(',')).toBe(true)
  })

  it('仅表头无数据时也产出 BOM + 表头', () => {
    expect(toCsv(['a', 'b'], [])).toBe('﻿a,b')
  })
})

describe('toText', () => {
  it('表头与数据行用 " | " 分隔，换行用 LF', () => {
    expect(toText(['时间', '消息'], [[1, '同步完成']])).toBe('时间 | 消息\n1 | 同步完成')
  })

  it('不带 BOM（TXT 不需要）', () => {
    expect(toText(['a'], [['b']]).codePointAt(0)).not.toBe(0xfeff)
  })
})

describe('formatFileTimestamp', () => {
  it('格式化为 YYYYMMDD-HHmmss', () => {
    expect(formatFileTimestamp(new Date(2026, 8, 13, 5, 4, 3).getTime())).toBe('20260913-050403')
  })

  it('个位数月日时分秒补零', () => {
    expect(formatFileTimestamp(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('20260102-030405')
  })
})

describe('buildFileName', () => {
  it('带 bgm- 前缀与格式扩展名', () => {
    const name = buildFileName('同步记录', 'csv')
    expect(name.startsWith('bgm-同步记录-')).toBe(true)
    expect(name.endsWith('.csv')).toBe(true)
  })
})

describe('downloadTextFile', () => {
  it('生成 Blob 并触发一次下载点击，文件名正确', async () => {
    downloadTextFile('a.txt', '内容', 'text/plain;charset=utf-8')
    expect(clickedNames).toEqual(['a.txt'])
    expect(capturedBlobs).toHaveLength(1)
    await expect(capturedBlobs[0]?.text()).resolves.toBe('内容')
  })
})

describe('exportRows', () => {
  it('按 csv 格式导出，返回行数', async () => {
    const count = exportRows('清理日志', ['时间', '消息'], [[1, '删除 3 行']], 'csv')
    expect(count).toBe(1)
    const text = await capturedBlobs[0]?.text()
    expect(text).toContain('时间,消息')
    expect(text).toContain('删除 3 行')
    expect(clickedNames[0]).toContain('.csv')
  })

  it('按 txt 格式导出，扩展名与内容同步切换', async () => {
    const count = exportRows('清理日志', ['时间', '消息'], [[1, 'a'], [2, 'b']], 'txt')
    expect(count).toBe(2)
    const text = await capturedBlobs[0]?.text()
    expect(text).toContain('时间 | 消息')
    expect(clickedNames[0]).toContain('.txt')
  })
})
