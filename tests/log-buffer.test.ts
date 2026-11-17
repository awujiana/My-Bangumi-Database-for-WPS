/**
 * @fileoverview RingBuffer 通用环形缓冲区测试
 *
 * 测试策略：纯数据结构，无副作用，直接从 ts/tools/log-buffer.js 导入。
 * 覆盖：正常 push/toArray、超出容量覆盖、last(n)、isEmpty/isFull、clear、边界容量。
 */

import { describe, it, expect } from 'vitest'
import { RingBuffer } from '../ts/tools/log-buffer.js'

describe('RingBuffer', () => {
  it('容量内正常 push 和 toArray', () => {
    const buffer = new RingBuffer<number>(5)
    buffer.push(1)
    buffer.push(2)
    buffer.push(3)
    expect(buffer.size()).toBe(3)
    expect(buffer.toArray()).toEqual([1, 2, 3])
  })

  it('超出容量时覆盖最旧', () => {
    const buffer = new RingBuffer<number>(3)
    buffer.push(1)
    buffer.push(2)
    buffer.push(3)
    buffer.push(4)
    expect(buffer.size()).toBe(3)
    expect(buffer.toArray()).toEqual([2, 3, 4])
  })

  it('last(n) 返回最后 N 个', () => {
    const buffer = new RingBuffer<number>(5)
    buffer.push(1)
    buffer.push(2)
    buffer.push(3)
    buffer.push(4)
    expect(buffer.last(2)).toEqual([3, 4])
  })

  it('isEmpty 和 isFull', () => {
    const buffer = new RingBuffer<number>(2)
    expect(buffer.isEmpty()).toBe(true)
    buffer.push(1)
    expect(buffer.isFull()).toBe(false)
    buffer.push(2)
    expect(buffer.isFull()).toBe(true)
  })

  it('clear 清空', () => {
    const buffer = new RingBuffer<number>(5)
    buffer.push(1)
    buffer.push(2)
    buffer.clear()
    expect(buffer.isEmpty()).toBe(true)
    expect(buffer.size()).toBe(0)
  })

  it('容量为 1 时正常工作', () => {
    const buffer = new RingBuffer<number>(1)
    buffer.push(1)
    buffer.push(2)
    expect(buffer.size()).toBe(1)
    expect(buffer.toArray()).toEqual([2])
  })

  it('容量为 0 时退化为 1', () => {
    const buffer = new RingBuffer<number>(0)
    expect(buffer.size()).toBe(0)
    buffer.push(1)
    expect(buffer.size()).toBe(1)
  })
})
