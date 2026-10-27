// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/components/option-picker.ts` 单测（jsdom）
 *
 * 守住三种形态与回调：
 * 1. ≤2 个选项：单选按钮（不渲染 select）；
 * 2. 3–10 个选项：原生 select；
 * 3. >10 个选项：搜索框 + 过滤列表；
 * 4. 空列表：显示 emptyText。
 */

import { describe, expect, it, vi } from 'vitest'

import { renderOptionPicker } from '../ts/ui/components/option-picker.js'

function makeContainer(): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  return container
}

describe('renderOptionPicker', () => {
  it('≤2 个选项用单选按钮（不渲染 select）', () => {
    const container = makeContainer()
    const onChange = vi.fn()
    renderOptionPicker(
      container,
      [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
      ],
      { value: 'a', ariaLabel: '测试', onChange },
    )

    expect(container.querySelector('select')).toBeNull()
    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    expect(radios).toHaveLength(2)
    expect(radios[0]?.checked).toBe(true)

    radios[1]?.click()
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('3–10 个选项用原生 select', () => {
    const container = makeContainer()
    const onChange = vi.fn()
    renderOptionPicker(
      container,
      [
        { value: 'a', label: '甲' },
        { value: 'b', label: '乙' },
        { value: 'c', label: '丙' },
      ],
      { value: 'b', ariaLabel: '测试', onChange },
    )

    const select = container.querySelector<HTMLSelectElement>('select')
    expect(select).not.toBeNull()
    expect(select?.options).toHaveLength(3)
    expect(select?.value).toBe('b')

    if (select) {
      select.value = 'c'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('>10 个选项带搜索框，输入过滤列表', () => {
    const container = makeContainer()
    const onChange = vi.fn()
    const items = Array.from({ length: 12 }, (_unused, index) => ({
      value: `v${String(index)}`,
      label: `选项${String(index)}`,
    }))
    renderOptionPicker(container, items, { value: 'v0', ariaLabel: '测试', onChange })

    const search = container.querySelector<HTMLInputElement>('input[type="search"]')
    expect(search).not.toBeNull()
    expect(container.querySelectorAll('.bgm-option-picker-item')).toHaveLength(12)

    if (search) {
      search.value = '选项1'
      search.dispatchEvent(new Event('input', { bubbles: true }))
    }
    // 选项1 / 选项10 / 选项11
    const visible = container.querySelectorAll<HTMLButtonElement>('.bgm-option-picker-item')
    expect(visible).toHaveLength(3)

    visible[0]?.click()
    expect(onChange).toHaveBeenCalledWith('v1')
  })

  it('空列表显示 emptyText', () => {
    const container = makeContainer()
    renderOptionPicker(container, [], {
      value: '',
      ariaLabel: '测试',
      onChange: vi.fn(),
      emptyText: '没有东西',
    })
    expect(container.textContent).toContain('没有东西')
  })
})
