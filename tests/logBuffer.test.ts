/**
 * @fileoverview RingBuffer 通用环形缓冲区测试
 *
 * 测试策略：纯数据结构，无副作用，直接从 ts/tools/logBuffer.js 导入。
 * 覆盖：正常 push/toArray、超出容量覆盖、last(n)、isEmpty/isFull、clear、边界容量。
 */

import { describe, it, expect } from 'vitest'
import { RingBuffer } from '../ts/tools/logBuffer.js'

describe('RingBuffer', () => {
  it('容量内正常 push 和 toArray', () => {
    const buf = new RingBuffer<number>(5)
    buf.push(1)
    buf.push(2)
    buf.push(3)
    expect(buf.size()).toBe(3)
    expect(buf.toArray()).toEqual([1, 2, 3])
  })

  it('超出容量时覆盖最旧', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1)
    buf.push(2)
    buf.push(3)
    buf.push(4)
    expect(buf.size()).toBe(3)
    expect(buf.toArray()).toEqual([2, 3, 4])
  })

  it('last(n) 返回最后 N 个', () => {
    const buf = new RingBuffer<number>(5)
    buf.push(1)
    buf.push(2)
    buf.push(3)
    buf.push(4)
    expect(buf.last(2)).toEqual([3, 4])
  })

  it('isEmpty 和 isFull', () => {
    const buf = new RingBuffer<number>(2)
    expect(buf.isEmpty()).toBe(true)
    buf.push(1)
    expect(buf.isFull()).toBe(false)
    buf.push(2)
    expect(buf.isFull()).toBe(true)
  })

  it('clear 清空', () => {
    const buf = new RingBuffer<number>(5)
    buf.push(1)
    buf.push(2)
    buf.clear()
    expect(buf.isEmpty()).toBe(true)
    expect(buf.size()).toBe(0)
  })

  it('容量为 1 时正常工作', () => {
    const buf = new RingBuffer<number>(1)
    buf.push(1)
    buf.push(2)
    expect(buf.size()).toBe(1)
    expect(buf.toArray()).toEqual([2])
  })

  it('容量为 0 时退化为 1', () => {
    const buf = new RingBuffer<number>(0)
    expect(buf.size()).toBe(0)
    buf.push(1)
    expect(buf.size()).toBe(1)
  })
})
