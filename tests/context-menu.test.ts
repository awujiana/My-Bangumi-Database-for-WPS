// @vitest-environment jsdom
/**
 * @fileoverview `ts/ui/components/context-menu.ts` 通用右键菜单单测（jsdom）
 *
 * 守住的东西：
 * 1. 定位算法（resolveMenuPosition）：右 / 下溢出翻转，永不出屏；
 * 2. 开：items 渲染、分隔线、禁用项 aria-disabled 且不进导航、danger/shortcut；
 * 3. 交互：点击执行 + 关闭、禁用项点了没反应、onSelect 返回 false 保持打开、
 *    异步 onSelect 先关菜单再后台跑；
 * 4. 键盘：↑↓ 循环、Home/End、Esc 关闭并还原焦点、Tab 不困菜单；
 * 5. 关闭时机：外部 pointerdown、scroll/resize；
 * 6. attachContextMenu：contextmenu 打开 + preventDefault；provider 返空则不拦
 *    默认菜单（浏览器原生菜单有权出来）。
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import {
  attachContextMenu,
  attachDelegatedContextMenu,
  hideContextMenu,
  isContextMenuOpen,
  resolveMenuPosition,
  showContextMenu,
} from '../ts/ui/components/context-menu.js'
import type { ContextMenuItem } from '../ts/ui/components/context-menu.js'

/** 键盘事件（挂在当前焦点元素上） */
function key(target: EventTarget, k: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
}

function menuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.bgm-context-menu-item')]
}

beforeEach(() => {
  hideContextMenu()
  document.body.replaceChildren()
})

afterEach(() => {
  hideContextMenu()
})

describe('resolveMenuPosition', () => {
  const base = { width: 200, height: 100, viewportWidth: 1000, viewportHeight: 800 }

  it('放得下就原样在指针处', () => {
    expect(resolveMenuPosition({ ...base, x: 100, y: 200 })).toEqual({ left: 100, top: 200 })
  })

  it('右侧溢出 → 翻到指针左边', () => {
    expect(resolveMenuPosition({ ...base, x: 900, y: 200 })).toEqual({ left: 700, top: 200 })
  })

  it('左侧也放不下 → 贴视口左边（不留负值）', () => {
    // 视口 400：x=50 + 宽 600 右侧放不下 → 翻左边 50-600=-550 → 钳到 margin 8
    expect(resolveMenuPosition({ ...base, viewportWidth: 400, width: 600, x: 50, y: 200 })).toEqual({
      left: 8,
      top: 200,
    })
  })

  it('下侧溢出 → 翻到指针上边', () => {
    expect(resolveMenuPosition({ ...base, x: 100, y: 780 })).toEqual({ left: 100, top: 680 })
  })

  it('上面也放不下 → 贴视口顶', () => {
    expect(resolveMenuPosition({ ...base, height: 900, x: 100, y: 50 })).toEqual({
      left: 100,
      top: 8,
    })
  })
})

describe('showContextMenu', () => {
  const items: ContextMenuItem[] = [
    { id: 'edit', label: '✎ 编辑' },
    { id: 'sep', separator: true },
    { id: 'copy', label: '⧉ 复制', shortcut: 'Ctrl+C' },
    { id: 'del', label: '✕ 删除', danger: true },
    { id: 'off', label: '◐ 隐藏', disabled: true, disabledReason: '已经隐藏了' },
  ]

  it('渲染全部项 + 分隔线 + 快捷键 + danger/disabled 态', () => {
    showContextMenu({ items, x: 10, y: 10 })
    expect(isContextMenuOpen()).toBe(true)
    const buttons = menuItems()
    expect(buttons.map((button) => button.dataset.menuItem)).toEqual([
      'edit',
      'copy',
      'del',
      'off',
    ])
    expect(document.querySelectorAll('.bgm-context-menu-separator')).toHaveLength(1)
    expect(document.querySelector('.bgm-context-menu-shortcut')?.textContent).toBe('Ctrl+C')
    expect(buttons[2]?.classList.contains('is-danger')).toBe(true)
    expect(buttons[3]?.getAttribute('aria-disabled')).toBe('true')
    expect(buttons[3]?.title).toBe('已经隐藏了')
    // 禁用项不可聚焦（导航要跳过它）
    buttons[0]?.focus()
    key(document.activeElement ?? document.body, 'ArrowDown')
    expect(document.activeElement).toBe(buttons[1])
  })

  it('空 items 不开菜单', () => {
    showContextMenu({ items: [], x: 10, y: 10 })
    expect(isContextMenuOpen()).toBe(false)
  })

  it('点击可用项 → 执行 onSelect 并关闭', () => {
    const onSelect = vi.fn()
    showContextMenu({ items: [{ id: 'a', label: 'A', onSelect }], x: 10, y: 10 })
    menuItems()[0]?.click()
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(isContextMenuOpen()).toBe(false)
  })

  it('点击禁用项 → 没反应，菜单保持开着', () => {
    const onSelect = vi.fn()
    showContextMenu({ items: [{ id: 'a', label: 'A', disabled: true, onSelect }], x: 10, y: 10 })
    menuItems()[0]?.click()
    expect(onSelect).not.toHaveBeenCalled()
    expect(isContextMenuOpen()).toBe(true)
  })

  it('onSelect 返回 false → 保持打开（切换类操作的逃生门）', () => {
    showContextMenu({
      items: [{ id: 'a', label: 'A', onSelect: () => false }],
      x: 10,
      y: 10,
    })
    menuItems()[0]?.click()
    expect(isContextMenuOpen()).toBe(true)
  })

  it('异步 onSelect → 先关菜单，动作后台跑完', async () => {
    const onSelect = vi.fn(async () => {
      await Promise.resolve()
    })
    showContextMenu({ items: [{ id: 'a', label: 'A', onSelect }], x: 10, y: 10 })
    menuItems()[0]?.click()
    expect(isContextMenuOpen()).toBe(false)
    await Promise.resolve()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('onSelect 抛错 → 菜单照常关闭，不把骨架留在屏幕上', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    showContextMenu({
      items: [
        {
          id: 'a',
          label: 'A',
          onSelect: () => {
            throw new Error('boom')
          },
        },
      ],
      x: 10,
      y: 10,
    })
    menuItems()[0]?.click()
    expect(isContextMenuOpen()).toBe(false)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('单例：开第二个菜单替换第一个', () => {
    showContextMenu({ items: [{ id: 'a', label: 'A' }], x: 10, y: 10 })
    showContextMenu({ items: [{ id: 'b', label: 'B' }], x: 20, y: 20 })
    expect(document.querySelectorAll('.bgm-context-menu')).toHaveLength(1)
    expect(menuItems()[0]?.dataset.menuItem).toBe('b')
  })
})

describe('菜单键盘导航', () => {
  it('↑↓ 循环、Home/End、Esc 关闭并还原焦点', () => {
    const anchor = document.createElement('button')
    document.body.append(anchor)
    anchor.focus()
    showContextMenu({
      items: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      x: 10,
      y: 10,
      anchor,
    })
    const buttons = menuItems()
    // 打开即聚焦第一项
    expect(document.activeElement).toBe(buttons[0])
    key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement).toBe(buttons[1])
    key(document.activeElement!, 'ArrowDown')
    key(document.activeElement!, 'ArrowDown')
    // 循环回第一项
    expect(document.activeElement).toBe(buttons[0])
    key(document.activeElement!, 'ArrowUp')
    expect(document.activeElement).toBe(buttons[2])
    key(document.activeElement!, 'Home')
    expect(document.activeElement).toBe(buttons[0])
    key(document.activeElement!, 'End')
    expect(document.activeElement).toBe(buttons[2])
    key(document.activeElement!, 'Escape')
    expect(isContextMenuOpen()).toBe(false)
    expect(document.activeElement).toBe(anchor)
  })

  it('Enter 执行当前项', () => {
    const onSelect = vi.fn()
    showContextMenu({ items: [{ id: 'a', label: 'A', onSelect }], x: 10, y: 10 })
    const active = document.activeElement!
    key(active, 'Enter')
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(isContextMenuOpen()).toBe(false)
  })

  it('Tab 直接关（不困在菜单里）', () => {
    showContextMenu({
      items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      x: 10,
      y: 10,
    })
    key(document.activeElement!, 'Tab')
    expect(isContextMenuOpen()).toBe(false)
  })
})

describe('菜单关闭时机', () => {
  it('外部 pointerdown 关闭；菜单内按下不关', () => {
    showContextMenu({
      items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      x: 10,
      y: 10,
    })
    // 菜单内按下：不关
    menuItems()[1]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(isContextMenuOpen()).toBe(true)
    // 菜单外按下：关
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(isContextMenuOpen()).toBe(false)
  })

  it('scroll / resize 关闭（页面滚走还原地挂着比没有更糟）', () => {
    showContextMenu({ items: [{ id: 'a', label: 'A' }], x: 10, y: 10 })
    window.dispatchEvent(new Event('scroll'))
    expect(isContextMenuOpen()).toBe(false)

    showContextMenu({ items: [{ id: 'a', label: 'A' }], x: 10, y: 10 })
    window.dispatchEvent(new Event('resize'))
    expect(isContextMenuOpen()).toBe(false)
  })
})

describe('attachContextMenu', () => {
  it('右键打开菜单并 preventDefault；provider 返空则不拦默认菜单', () => {
    const row = document.createElement('div')
    document.body.append(row)
    const onSelect = vi.fn()
    const unbind = attachContextMenu(row, () => [{ id: 'a', label: 'A', onSelect }])
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 30,
      clientY: 40,
    })
    row.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(isContextMenuOpen()).toBe(true)
    expect(menuItems()[0]?.dataset.menuItem).toBe('a')
    menuItems()[0]?.click()
    expect(onSelect).toHaveBeenCalledTimes(1)

    // 空菜单：不 preventDefault（浏览器原生菜单有权出来）
    const bare = document.createElement('div')
    document.body.append(bare)
    attachContextMenu(bare, () => [])
    const bareEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    bare.dispatchEvent(bareEvent)
    expect(bareEvent.defaultPrevented).toBe(false)
    unbind()
  })

  it('解绑后右键不再拦截', () => {
    const row = document.createElement('div')
    document.body.append(row)
    const unbind = attachContextMenu(row, () => [{ id: 'a', label: 'A' }])
    unbind()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(isContextMenuOpen()).toBe(false)
  })
})

describe('attachDelegatedContextMenu', () => {
  it('容器委托：行内右键开菜单，重渲染后仍然有效（监听在容器上）', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onSelect = vi.fn()
    attachDelegatedContextMenu(container, '.row', (row) => [
      { id: 'act', label: `操作 ${row.dataset.itemId ?? ''}`, onSelect },
    ])
    // 第一版行
    container.innerHTML = '<div class="row" data-item-id="r1">a</div>'
    container
      .querySelector('.row')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(isContextMenuOpen()).toBe(true)
    menuItems()[0]?.click()
    expect(onSelect).toHaveBeenCalledTimes(1)

    // 重渲染换成新行节点：不需要重新挂载，右键依然有效
    container.innerHTML = '<div class="row" data-item-id="r2">b</div>'
    container
      .querySelector('.row')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(isContextMenuOpen()).toBe(true)
    expect(menuItems()[0]?.textContent).toContain('r2')
  })

  it('点在非行元素上不开菜单（不拦默认菜单）', () => {
    const container = document.createElement('div')
    document.body.append(container)
    container.innerHTML = '<div class="other">x</div><div class="row">a</div>'
    attachDelegatedContextMenu(container, '.row', () => [{ id: 'a', label: 'A' }])
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    container.querySelector('.other')?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(isContextMenuOpen()).toBe(false)
  })

  it('provider 返空数组 = 不拦默认菜单', () => {
    const container = document.createElement('div')
    document.body.append(container)
    container.innerHTML = '<div class="row">a</div>'
    attachDelegatedContextMenu(container, '.row', () => [])
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    container.querySelector('.row')?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
