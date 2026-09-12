/**
 * @fileoverview 设置页「模块排序」编辑器
 * @module ui/handlers/module-order
 * @description 从 tools/nav-order 的模块注册表渲染各页面的可排序模块清单，
 *              提供 ↑↓ 按钮（键盘可达、WPS 中最稳）与鼠标拖拽两种排序方式。
 *
 * 设计要点：
 *  - 清单由注册表驱动，新增/删除模块无需改本文件或 HTML；
 *  - 事件用容器级委托绑定（列表会随排序整体重渲染，逐项绑定会失效）；
 *  - 自定义属性 `data-mod-move` / `data-mod-reset` 而非 `data-action`，
 *    避免与 setupButtonListeners 的一次性绑定机制互相干扰。
 */

import { LOG_LEVELS, bgmLog, showToast } from '../../index.js'
import { CONFIG_KEYS, getConfig } from '../../tools/config.js'
import {
  ORDERABLE_PAGES,
  PAGE_LABELS,
  PAGE_MODULES,
  getNavOrder,
  moveModuleBy,
  moveModuleTo,
  notifyNavOrderChanged,
  resetNavOrder,
} from '../../tools/nav-order.js'
import { escapeHtml } from '../../tools/string-utilities.js'

/** 拖拽会话状态（仅记录当前被拖起的模块） */
let dragPage = ''
let dragModuleId = ''

/** 构建单个页面的排序分组 */
function buildGroupHtml(page: string): string {
  const modules = PAGE_MODULES[page]
  if (!modules || modules.length === 0) return ''
  const order = getNavOrder(page)
  const byId = new Map(modules.map((module) => [module.id, module]))
  const label = PAGE_LABELS[page] ?? page

  const items = order
    .map((id, index) => {
      const module = byId.get(id)
      if (!module) return ''
      const isFirst = index === 0
      const isLast = index === order.length - 1
      const name = escapeHtml(module.label)
      return `
        <li class="module-order-item" draggable="true" data-page="${escapeHtml(page)}" data-module="${escapeHtml(module.id)}">
          <span class="module-order-handle" title="拖拽调整顺序" aria-hidden="true">⋮⋮</span>
          <span class="module-order-ico" aria-hidden="true">${escapeHtml(module.icon)}</span>
          <span class="module-order-label">${name}</span>
          <span class="module-order-btns">
            <button class="bgm-btn small" data-mod-move="up" data-page="${escapeHtml(page)}" data-module="${escapeHtml(module.id)}" title="上移" aria-label="${name} 上移"${isFirst ? ' disabled' : ''}>↑</button>
            <button class="bgm-btn small" data-mod-move="down" data-page="${escapeHtml(page)}" data-module="${escapeHtml(module.id)}" title="下移" aria-label="${name} 下移"${isLast ? ' disabled' : ''}>↓</button>
          </span>
        </li>`
    })
    .join('')

  return `
    <div class="module-order-group">
      <div class="module-order-head">
        <span class="module-order-title">${escapeHtml(label)}</span>
        <button class="bgm-btn small" data-mod-reset="${escapeHtml(page)}">↩️ 恢复默认顺序</button>
      </div>
      <ul class="module-order-list" data-list-page="${escapeHtml(page)}">${items}</ul>
    </div>`
}

/** 渲染（或重渲染）整个排序编辑器 */
export function renderModuleOrderEditor(): void {
  const host = document.getElementById('moduleOrderGroups')
  if (!host) return
  const html = ORDERABLE_PAGES.map((page) => buildGroupHtml(page)).join('')
  host.innerHTML = html
}

/** 排序变化后的统一收尾：本页即时重排 + 重渲染编辑器 + 提示 */
function afterOrderChanged(page: string, message: string): void {
  renderModuleOrderEditor()
  // 若被调整的正是当前页（如设置页自身），立刻重排，不等跨页轮询
  if (page === getCurrentPageKey()) notifyNavOrderChanged(page)
  showToast(message, 'success')
  bgmLog(LOG_LEVELS.INFO, `[moduleOrder] ${PAGE_LABELS[page] ?? page} 排序已更新`)
}

/** 当前页面的排序键（取自 `body[data-page]`，与 nav-order 的推断口径一致） */
function getCurrentPageKey(): string {
  return document.body.dataset.page ?? ''
}

/** 容器点击委托：↑↓ 与恢复默认 */
function onEditorClick(event: Event): void {
  const { target } = event
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLElement>('[data-mod-move], [data-mod-reset]')
  if (!button) return
  event.preventDefault()

  const resetPage = button.dataset.modReset
  if (resetPage) {
    if (resetNavOrder(resetPage)) {
      afterOrderChanged(resetPage, `已恢复「${PAGE_LABELS[resetPage] ?? resetPage}」默认顺序`)
    } else {
      showToast('恢复默认顺序失败', 'error')
    }
    return
  }

  const direction = button.dataset.modMove
  const page = button.dataset.page ?? ''
  const moduleId = button.dataset.module ?? ''
  if (!direction || !page || !moduleId) return
  const offset = direction === 'up' ? -1 : 1
  if (moveModuleBy(page, moduleId, offset)) {
    afterOrderChanged(page, offset < 0 ? '已上移' : '已下移')
  } else {
    showToast('调整顺序失败', 'error')
  }
}

/** 拖拽开始：记录来源并给出拖拽影像 */
function onDragStart(event: DragEvent): void {
  const { target } = event
  if (!(target instanceof Element)) return
  const item = target.closest<HTMLElement>('.module-order-item')
  if (!item) return
  dragPage = item.dataset.page ?? ''
  dragModuleId = item.dataset.module ?? ''
  if (!dragPage || !dragModuleId) return
  item.classList.add('is-dragging')
  // Firefox / 部分 WebView 要求必须设置数据，否则不触发 drop
  const dt = event.dataTransfer
  if (dt) {
    dt.setData('text/plain', dragModuleId)
    dt.effectAllowed = 'move'
  }
}

/** 拖拽经过：仅同页面内允许放置 */
function onDragOver(event: DragEvent): void {
  const { target } = event
  if (!(target instanceof Element)) return
  const item = target.closest<HTMLElement>('.module-order-item')
  if (item?.dataset.page !== dragPage) return
  event.preventDefault()
  const dt = event.dataTransfer
  if (dt) dt.dropEffect = 'move'
  for (const other of document.querySelectorAll('.module-order-item.is-drop-target')) {
    other.classList.remove('is-drop-target')
  }
  if (item.dataset.module !== dragModuleId) item.classList.add('is-drop-target')
}

/** 放置：按目标项在当前顺序中的下标重排 */
function onDrop(event: DragEvent): void {
  const { target } = event
  if (!(target instanceof Element)) return
  const item = target.closest<HTMLElement>('.module-order-item')
  if (!dragModuleId || item?.dataset.page !== dragPage) return
  event.preventDefault()
  const targetModuleId = item.dataset.module ?? ''
  if (!targetModuleId || targetModuleId === dragModuleId) return
  const order = getNavOrder(dragPage)
  const targetIndex = order.indexOf(targetModuleId)
  if (targetIndex === -1) return
  if (moveModuleTo(dragPage, dragModuleId, targetIndex)) {
    afterOrderChanged(dragPage, '顺序已更新')
  } else {
    showToast('调整顺序失败', 'error')
  }
}

/** 拖拽结束：清理视觉状态 */
function onDragEnd(): void {
  dragPage = ''
  dragModuleId = ''
  for (const item of document.querySelectorAll(
    '.module-order-item.is-dragging, .module-order-item.is-drop-target',
  )) {
    item.classList.remove('is-dragging', 'is-drop-target')
  }
}

/** 轮询间隔（ms），与 nav-order / nav-mode 的跨页同步保持一致 */
const ORDER_SYNC_INTERVAL_MS = 2000

/** 无定时器可清时的空清理函数（非浏览器上下文 / 编辑器不存在） */
const noopCleanup = (): void => {
  /* 无需清理 */
}

/**
 * 跨页刷新：其他任务窗格改动排序后，本页编辑器里的清单会变旧。
 * 与 nav-order 的同步策略一致，轮询 PluginStorage 中的排序配置，变化时重渲染。
 * @returns 清理函数（清除定时器）
 */
export function startModuleOrderSync(): () => void {
  if (typeof window === 'undefined' || typeof setInterval !== 'function') return noopCleanup
  const host = document.getElementById('moduleOrderGroups')
  if (!host) return noopCleanup
  let lastRaw = getConfig(CONFIG_KEYS.NAV_ORDER, '', true)
  const timer = setInterval(() => {
    try {
      const raw = getConfig(CONFIG_KEYS.NAV_ORDER, '', true)
      if (raw !== lastRaw) {
        lastRaw = raw
        // 拖拽过程中不重渲染：会拆掉正在拖拽的 DOM 节点
        if (!dragModuleId) renderModuleOrderEditor()
      }
    } catch {
      // 静默处理偶发读取异常，轮询继续
    }
  }, ORDER_SYNC_INTERVAL_MS)
  window.addEventListener(
    'beforeunload',
    () => {
      clearInterval(timer)
    },
    { once: true },
  )
  return () => {
    clearInterval(timer)
  }
}

/**
 * 初始化模块排序编辑器：渲染清单并绑定容器级事件委托。
 * 仅在存在 `#moduleOrderGroups` 的设置页生效，其余页面静默跳过。
 */
export function initModuleOrderEditor(): void {
  const host = document.getElementById('moduleOrderGroups')
  if (!host) return
  renderModuleOrderEditor()
  // 容器元素本身不会被替换，用标记位避免重复初始化时叠加监听器
  if (host.dataset.bound === '1') return
  host.dataset.bound = '1'
  host.addEventListener('click', onEditorClick)
  host.addEventListener('dragstart', onDragStart)
  host.addEventListener('dragover', onDragOver)
  host.addEventListener('drop', onDrop)
  host.addEventListener('dragend', onDragEnd)
  startModuleOrderSync()
  bgmLog(LOG_LEVELS.INFO, '[moduleOrder] 模块排序编辑器已初始化')
}
