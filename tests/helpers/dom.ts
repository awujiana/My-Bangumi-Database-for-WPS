/**
 * @fileoverview jsdom 装配工具（供 `// @vitest-environment jsdom` 的测试文件复用）。
 *
 * ## 两个非显然的 jsdom 行为，写在这里以免每个文件都踩一次
 *
 * 1. **`select.value = 'x'` 在不存在同名 `<option>` 时被静默丢弃** —— 不抛错、
 *    值保持 `''`，断言会看着像「生产的同步逻辑没生效」。故 `mountSelect` 一定挂
 *    option；且 `<select>` 默认选中第一个 option，「未被改写」的断言要先预置值。
 * 2. **模块级监听器跨用例累积**：`window.addEventListener` / `document.addEventListener`
 *    的注册不会随 `clearDom()` 消失（监听挂在 window / document 上，不在 body 里）。
 *    需要精确断言「本次注册的 handler」时，用 `spyOn(window, 'addEventListener')`
 *    取最后一次调用，而不是 `dispatchEvent` 撞全量历史监听器。
 *
 * @module tests/helpers/dom
 */

/** 清空 body 子树（不动 window / document 上的监听器，见文件头第 2 条） */
export function clearDom(): void {
  document.body.replaceChildren()
}

/**
 * 建一个带 id 的元素并挂到 body。
 * @param id 元素 id（被测代码按 id 取值）
 * @param tagName 标签名，默认 `div`
 * @param text 初始文本，默认空
 */
export function mountElement(id: string, tagName = 'div', text = ''): HTMLElement {
  const element = document.createElement(tagName)
  element.id = id
  if (text) element.textContent = text
  document.body.append(element)
  return element
}

/**
 * 建一个带 option 的 `<select>`。
 * @param options option 的 value 集合
 * @param value 预置选中值（必须是 options 之一，否则被 jsdom 静默丢弃）
 */
export function mountSelect(
  id: string,
  options: readonly string[],
  value?: string,
): HTMLSelectElement {
  const select = mountElement(id, 'select') as HTMLSelectElement
  for (const item of options) {
    const option = document.createElement('option')
    option.value = item
    option.textContent = item
    select.append(option)
  }
  if (value !== undefined) select.value = value
  return select
}

/** 建一个复选框；`isChecked` 为初始勾选态 */
export function mountCheckbox(id: string, isChecked = false): HTMLInputElement {
  const input = mountElement(id, 'input') as HTMLInputElement
  input.type = 'checkbox'
  input.checked = isChecked
  return input
}

/** 建一个文本输入框；`value` 为初始值 */
export function mountInput(id: string, value = ''): HTMLInputElement {
  const input = mountElement(id, 'input') as HTMLInputElement
  input.type = 'text'
  input.value = value
  return input
}

/** 建一个带 id 的按钮（被测模块按 id 取按钮的场景） */
export function mountButton(id: string, text = ''): HTMLButtonElement {
  return mountElement(id, 'button', text) as HTMLButtonElement
}

/** 派发 `change` 事件（复选框 / 下拉框的绑定入口） */
export function dispatchChange(element: HTMLElement): void {
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

/** 派发 `input` 事件（文本框的绑定入口） */
export function dispatchInput(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 派发 `click`（bubbles，便于走容器上的委托监听） */
export function dispatchClick(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

/**
 * 排空一个宏任务队列再清 DOM。
 *
 * 用于 `vi.resetModules()` 型用例的 `beforeEach`：上一轮用例遗留的
 * `setTimeout(ensureDialogs)` 会先于本用例执行、把模块级 DOM 状态建好，
 * 导致新实例提前 return、事件绑定整段不执行（后续断言静默失效）。
 *
 * 注意：假时钟下本函数会挂住 —— 那条路径请直接 `vi.advanceTimersByTime(0)`。
 */
export async function settleMacrotasks(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}
