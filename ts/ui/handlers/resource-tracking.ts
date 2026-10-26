/**
 * 面板资源追踪（定时器 / DOM 监听器 / 事件总线监听器）
 * @module ui/handlers/resource-tracking
 * @description 从 handlers/index.ts 抽出：统一登记模块级资源，便于面板重新初始化前一次性清理，
 *              防止重复注册与内存泄漏。仅依赖 tools/events，无上层依赖。
 */

import { eventBus } from '../../tools/events.js'
import type { EventHandler } from '../../tools/events.js'

// ========== 模块级资源追踪（防止事件监听器与定时器泄漏） ==========
const _pendingTimeouts = new Set<ReturnType<typeof setTimeout>>()

/**
 * 受追踪的 setTimeout：将 timeoutId 加入模块级 Set，便于统一清理。
 * 回调执行时自动从 Set 中移除。
 */
export function trackedSetTimeout(
  function_: () => void,
  delay: number,
): ReturnType<typeof setTimeout> {
  const id = setTimeout(() => {
    _pendingTimeouts.delete(id)
    function_()
  }, delay)
  _pendingTimeouts.add(id)
  return id
}

/**
 * 清理所有仍在等待的 setTimeout，防止面板关闭后回调仍被触发。
 */
export function clearAllPendingTimeouts(): void {
  for (const id of _pendingTimeouts) {
    clearTimeout(id)
  }
  _pendingTimeouts.clear()
}

// ========== 模块级 DOM / 事件总线监听器追踪（防止重复注册与内存泄漏） ==========

interface TrackedDomListener {
  kind: 'dom'
  element: EventTarget
  type: string
  handler: EventListenerOrEventListenerObject
}

interface TrackedBusListener {
  kind: 'eventBus'
  eventName: string
  handler: EventHandler
}

type TrackedListener = TrackedDomListener | TrackedBusListener

const _trackedListeners: TrackedListener[] = []

/**
 * 清理所有已追踪的监听器。
 * 在 initializeHandlers 重新初始化前调用，防止同一面板内重复注册。
 */
export function clearTrackedListeners(): void {
  for (const item of _trackedListeners) {
    if (item.kind === 'dom') {
      item.element.removeEventListener(item.type, item.handler)
    } else {
      eventBus.off(item.eventName, item.handler)
    }
  }
  _trackedListeners.length = 0
}

/**
 * 受追踪的 addEventListener：自动记录，便于统一清理。
 */
export function trackedAddEventListener(
  element: EventTarget,
  type: string,
  handler: EventListenerOrEventListenerObject,
): void {
  element.addEventListener(type, handler)
  _trackedListeners.push({ kind: 'dom', element, type, handler })
}

/**
 * 受追踪的 eventBus.on：自动记录，便于统一清理。
 */
export function trackedEventBusOn<T = unknown>(eventName: string, handler: EventHandler<T>): void {
  eventBus.on(eventName, handler)
  _trackedListeners.push({ kind: 'eventBus', eventName, handler: handler as EventHandler })
}
