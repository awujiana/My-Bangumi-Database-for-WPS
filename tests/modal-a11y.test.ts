/**
 * @fileoverview 静态模态框无障碍增强（ts/ui/components/modal-a11y.ts）单元测试
 * @description 覆盖 ESC 关闭（走自身关闭控件）、焦点陷阱（Tab / Shift+Tab 环绕）、
 *   最上层判定、无关闭控件时不强关、未显示模态框不响应、幂等安装与卸载。
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installModalA11y, teardownModalA11y } from '../ts/ui/components/modal-a11y.js'

interface ModalFixture {
  modal: HTMLElement
  close: HTMLButtonElement | null
  firstFocusable: HTMLButtonElement
  lastFocusable: HTMLButtonElement
}

interface CreateModalOptions {
  visible?: boolean
  withClose?: boolean
  modalClass?: string
  closeButtonClass?: string
  id?: string
  withFocusables?: boolean
}

/** 构建一个静态模态框：可选关闭控件 + 两个可聚焦按钮 */
function createModal(options: CreateModalOptions = {}): ModalFixture {
  const {
    visible = true,
    withClose = true,
    modalClass = 'modal',
    closeButtonClass = 'modal-close-btn',
    id,
    withFocusables = true,
  } = options

  const modal = document.createElement('div')
  if (id) modal.id = id
  modal.className = modalClass
  modal.style.display = visible ? 'flex' : 'none'

  const content = document.createElement('div')
  content.className = 'modal-content'

  let close: HTMLButtonElement | null = null
  if (withClose) {
    close = document.createElement('button')
    close.className = closeButtonClass
    close.textContent = 'close'
    close.addEventListener('click', () => {
      modal.style.display = 'none'
    })
    content.appendChild(close)
  }

  const first = document.createElement('button')
  first.textContent = 'first'
  const last = document.createElement('button')
  last.textContent = 'last'
  if (withFocusables) content.append(first, last)

  modal.appendChild(content)
  document.body.appendChild(modal)

  return {
    modal,
    close,
    firstFocusable: close ?? first,
    lastFocusable: withFocusables ? last : (close ?? first),
  }
}

function pressKey(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  document.dispatchEvent(event)
  return event
}

describe('静态模态框无障碍增强（modal-a11y）', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    installModalA11y()
  })

  afterEach(() => {
    teardownModalA11y()
  })

  it('ESC 关闭最上层可见模态框并阻止默认行为', () => {
    const { modal } = createModal()
    expect(modal.style.display).toBe('flex')

    const event = pressKey('Escape')

    expect(modal.style.display).toBe('none')
    expect(event.defaultPrevented).toBe(true)
  })

  it('ESC 通过点击模态框自身关闭控件关闭（保证既有清理逻辑执行）', () => {
    const fixture = createModal()
    const spy = vi.fn()
    fixture.close?.addEventListener('click', spy)

    pressKey('Escape')

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('无关闭控件时 ESC 不强关（保持现状）', () => {
    const { modal } = createModal({ withClose: false })

    const event = pressKey('Escape')

    expect(modal.style.display).toBe('flex')
    expect(event.defaultPrevented).toBe(false)
  })

  it('未显示的模态框不响应 ESC', () => {
    const { modal } = createModal({ visible: false })

    const event = pressKey('Escape')

    expect(modal.style.display).toBe('none')
    expect(event.defaultPrevented).toBe(false)
  })

  it('多个可见模态框时只关闭最上层（文档顺序最后）', () => {
    const lower = createModal({ id: 'lower' })
    const upper = createModal({ id: 'upper' })

    pressKey('Escape')

    expect(upper.modal.style.display).toBe('none')
    expect(lower.modal.style.display).toBe('flex')
  })

  it('Tab 在最后一个可聚焦元素上环绕回第一个', () => {
    const fixture = createModal()
    fixture.lastFocusable.focus()

    const event = pressKey('Tab')

    expect(document.activeElement).toBe(fixture.firstFocusable)
    expect(event.defaultPrevented).toBe(true)
  })

  it('Shift+Tab 在第一个可聚焦元素上环绕回最后一个', () => {
    const fixture = createModal()
    fixture.firstFocusable.focus()

    const event = pressKey('Tab', { shiftKey: true })

    expect(document.activeElement).toBe(fixture.lastFocusable)
    expect(event.defaultPrevented).toBe(true)
  })

  it('焦点在模态框外时 Tab 拉回第一个可聚焦元素', () => {
    const fixture = createModal()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    const event = pressKey('Tab')

    expect(document.activeElement).toBe(fixture.firstFocusable)
    expect(event.defaultPrevented).toBe(true)
  })

  it('焦点在中间元素时 Tab 不拦截（交给浏览器默认行为）', () => {
    const fixture = createModal()
    fixture.firstFocusable.focus()

    const event = pressKey('Tab')

    expect(event.defaultPrevented).toBe(false)
  })

  it('模态框内无可聚焦元素时阻止 Tab 逃逸', () => {
    createModal({ withClose: false, withFocusables: false })

    const event = pressKey('Tab')

    expect(event.defaultPrevented).toBe(true)
  })

  it('.detail-modal 使用 .detail-close-btn 关闭，并纳入焦点陷阱', () => {
    const fixture = createModal({
      modalClass: 'detail-modal',
      closeButtonClass: 'detail-close-btn',
    })

    const event = pressKey('Escape')
    expect(fixture.modal.style.display).toBe('none')
    expect(event.defaultPrevented).toBe(true)

    // 重新显示后验证焦点陷阱
    fixture.modal.style.display = 'flex'
    fixture.lastFocusable.focus()
    pressKey('Tab')
    expect(document.activeElement).toBe(fixture.firstFocusable)
  })

  it('关闭控件也可由 [data-action^="close"] 识别', () => {
    const modal = document.createElement('div')
    modal.className = 'modal'
    modal.style.display = 'flex'
    const button = document.createElement('button')
    button.dataset.action = 'closeLogModal'
    button.addEventListener('click', () => {
      modal.style.display = 'none'
    })
    modal.appendChild(button)
    document.body.appendChild(modal)

    pressKey('Escape')

    expect(modal.style.display).toBe('none')
  })

  it('install 幂等：重复调用不抛错且行为不变', () => {
    installModalA11y()
    const { modal } = createModal()

    pressKey('Escape')

    expect(modal.style.display).toBe('none')
  })

  it('teardown 后 ESC 不再关闭模态框', () => {
    const { modal } = createModal()

    teardownModalA11y()
    pressKey('Escape')

    expect(modal.style.display).toBe('flex')
  })
})
