import { describe, it, expect } from 'vitest'
import { colNumberToLetter } from '../ts/tools/string-utilities-pure.js'

/**
 * 纯函数逻辑测试 - colNumberToLetter
 *
 * 测试策略：直接 import 源码实现（来自 string-utilities-pure.ts 零依赖纯模块），
 * 避免复制实现导致源码修改后测试不失败的问题。
 *
 * string-utilities-pure.ts 是从 string-utilities.ts 抽取出的零依赖纯函数模块，
 * 不引入 core/crypto、tools/util、ui/handlers 等含副作用的模块，
 * 因此测试可以直接 import 而不触发副作用链。
 */

describe('colNumberToLetter', () => {
  it('应正确转换 1-26 为 A-Z', () => {
    expect(colNumberToLetter(1)).toBe('A')
    expect(colNumberToLetter(2)).toBe('B')
    expect(colNumberToLetter(26)).toBe('Z')
  })

  it('应正确转换 27-52 为 AA-AZ', () => {
    expect(colNumberToLetter(27)).toBe('AA')
    expect(colNumberToLetter(28)).toBe('AB')
    expect(colNumberToLetter(52)).toBe('AZ')
  })

  it('应正确转换 53 为 BA', () => {
    expect(colNumberToLetter(53)).toBe('BA')
  })

  it('应正确转换 702 为 ZZ', () => {
    expect(colNumberToLetter(702)).toBe('ZZ')
  })

  it('应正确转换 703 为 AAA', () => {
    expect(colNumberToLetter(703)).toBe('AAA')
  })

  it('应正确转换 731 为 ABC', () => {
    expect(colNumberToLetter(731)).toBe('ABC')
  })

  it('应返回空字符串当 col <= 0', () => {
    expect(colNumberToLetter(0)).toBe('')
    expect(colNumberToLetter(-1)).toBe('')
    expect(colNumberToLetter(-100)).toBe('')
  })
})
