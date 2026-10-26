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
  notifyNavOrderChanged,
  resetNavOrder,
  setNavOrder,
} from '../../tools/nav-order.js'
import {
  applyModuleState,
  canHideModule,
  getHiddenModules,
  NAV_MODULE_ID,
  toggleModuleHidden,
} from '../../tools/module-state.js'
import { escapeHtml } from '../../tools/string-utilities.js'
import { createSortable, moveInArray } from '../components/sortable-list.js'
import type { SortableHandle } from '../components/sortable-list.js'

/**
 * 渲染「功能导航（侧栏）」这一行
 *
 * 它不是可排序模块（侧栏顺序由 `PAGE_MODULES` 决定，且 `.nav` 不在主区里，
 * 拖它没有意义），所以单独放在 `<ul>` 之外：既不会进 sortable 的拖拽项集合，
 * 也复用同一个 `data-mod-hidden` 点击委托。
 */
function buildNavRowHtml(page: string, isHidden: boolean): string {
  const hideTitle = isHidden ? '恢复显示侧栏功能导航' : '隐藏本页的侧栏功能导航'
  return `
    <div class="module-order-nav-row${isHidden ? ' is-module-hidden' : ''}">
      <span class="module-order-ico" aria-hidden="true">🧭</span>
      <span class="module-order-label">功能导航（侧栏）</span>
      <span class="module-order-btns">
        <button class="bgm-btn small" data-mod-hidden="${NAV_MODULE_ID}" data-page="${escapeHtml(page)}" title="${hideTitle}" aria-label="功能导航 ${isHidden ? '恢复显示' : '隐藏'}">${isHidden ? '🚫' : '👁️'}</button>
      </span>
    </div>`
}

/** 构建单个页面的排序分组 */
function buildGroupHtml(page: string): string {
  const modules = PAGE_MODULES[page]
  if (!modules || modules.length === 0) return ''
  const order = getNavOrder(page)
  const byId = new Map(modules.map((module) => [module.id, module]))
  const label = PAGE_LABELS[page] ?? page
  const hidden = new Set(getHiddenModules(page))

  const items = order
    .map((id, index) => {
      const module = byId.get(id)
      if (!module) return ''
      const isFirst = index === 0
      const isLast = index === order.length - 1
      const name = escapeHtml(module.label)
      const isHidden = hidden.has(id)
      // 编辑器所在模块禁止隐藏：隐藏后就没有入口能把任何模块恢复了
      const hideDisabled = canHideModule(page, id) ? '' : ' disabled'
      let hideTitle = '在页面中隐藏此模块'
      if (!canHideModule(page, id)) {
        hideTitle = '本模块是排序编辑器自身，不可隐藏'
      } else if (isHidden) {
        hideTitle = '恢复显示'
      }
      return `
        <li class="module-order-item${isHidden ? ' is-module-hidden' : ''}" data-page="${escapeHtml(page)}" data-module="${escapeHtml(module.id)}">
          <span class="module-order-handle" title="拖拽调整顺序（也可用键盘：Space 拾起、↑↓ 移动、Space 放置）" aria-hidden="true">⋮⋮</span>
          <span class="module-order-ico" aria-hidden="true">${escapeHtml(module.icon)}</span>
          <span class="module-order-label">${name}</span>
          <span class="module-order-btns">
            <button class="bgm-btn small" data-mod-hidden="${escapeHtml(module.id)}" data-page="${escapeHtml(page)}" title="${hideTitle}" aria-label="${name} ${isHidden ? '恢复显示' : '隐藏'}"${hideDisabled}>${isHidden ? '🚫' : '👁️'}</button>
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
      ${buildNavRowHtml(page, hidden.has(NAV_MODULE_ID))}
      <ul class="module-order-list" data-list-page="${escapeHtml(page)}">${items}</ul>
    </div>`
}
/** 渲染（或重渲染）整个排序编辑器 */
export function renderModuleOrderEditor(): void {
  const host = document.getElementById('moduleOrderGroups')
  if (!host) return
  const html = ORDERABLE_PAGES.map((page) => buildGroupHtml(page)).join('')
  host.innerHTML = html
  // 容器整树替换过：让 sortable 重新扫描新 DOM（无句柄时是 no-op）
  refreshSortables()
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
  const button = target.closest<HTMLElement>('[data-mod-move], [data-mod-reset], [data-mod-hidden]')
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

  // 显示 / 隐藏：改配置后立刻套用到当前页（设置页隐藏自身模块时也即时生效）
  const hideId = button.dataset.modHidden
  if (hideId) {
    const hidePage = button.dataset.page ?? ''
    const wasHidden = getHiddenModules(hidePage).includes(hideId)
    toggleModuleHidden(hidePage, hideId)
    const isNowHidden = getHiddenModules(hidePage).includes(hideId)
    if (isNowHidden === wasHidden) {
      // 状态没变 = 切换没生效（模块不可隐藏，或页面未知）
      showToast('切换显示状态失败', 'error')
      return
    }
    renderModuleOrderEditor()
    applyModuleState(hidePage)
    const isNavRow = hideId === NAV_MODULE_ID
    const targetName = isNavRow ? '功能导航' : '模块'
    showToast(
      isNowHidden ? `${targetName}已隐藏，可在设置页恢复` : `${targetName}已恢复显示`,
      'success',
    )
    bgmLog(
      LOG_LEVELS.INFO,
      `[moduleOrder] ${PAGE_LABELS[hidePage] ?? hidePage} 模块 ${hideId} ${isNowHidden ? '已隐藏' : '已恢复'}`,
    )
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

/** 轮询间隔（ms），与 nav-order / nav-mode 的跨页同步保持一致 */
const ORDER_SYNC_INTERVAL_MS = 2000

/**
 * 各页排序列表的 sortable 句柄
 *
 * 用 sortable-list（dnd-kit 轻量实现）而非 HTML5 DnD：WPS 任务窗格的 iframe 里
 * dragstart/drop 事件链不稳（旧实现踩过），而 sortable 走 Pointer Events +
 * capture，与 detachable-panel 的 bindDrag 同源，稳；且自带键盘排序 / 拖拽浮层 /
 * 放置指示线 / 自动滚动——HTML5 DnD 那套（is-drop-target 高亮 + dataTransfer）
 * 全部删掉，行为统一到条件格式规则列表那一套。
 */
let sortableHandles: SortableHandle[] = []

/** 渲染（或重渲染）后重新扫描可拖项（容器 innerHTML 重建过，旧扫描失效） */
function refreshSortables(): void {
  for (const handle of sortableHandles) handle.refresh()
}

/** 当前是否正在拖拽（跨页同步轮询用它避免重渲染拆掉拖拽中的 DOM） */
function isSortableDragging(): boolean {
  return sortableHandles.some((handle) => handle.isDragging())
}

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
    // 宿主被移除（设置页模块销毁 / 测试重建 DOM）→ 自清定时器：
    // 不检查的话 interval 会一直空转，还会在别的上下文里重建本页 DOM
    if (!host.isConnected) {
      clearInterval(timer)
      return
    }
    try {
      const raw = getConfig(CONFIG_KEYS.NAV_ORDER, '', true)
      if (raw !== lastRaw) {
        lastRaw = raw
        // 拖拽过程中不重渲染：会拆掉正在拖拽的 DOM 节点
        if (!isSortableDragging()) renderModuleOrderEditor()
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
 * 给每个分页列表装配 sortable（拖拽重排 + 键盘排序）
 *
 * 每次渲染后句柄集合重建：renderModuleOrderEditor 用 innerHTML 整树替换，
 * 旧容器上的监听随节点一起没了，必须对**新容器**建 sortable（建前先销毁旧的，
 * 避免 live region 泄漏）。
 */
function bindSortables(): void {
  for (const handle of sortableHandles) handle.destroy()
  sortableHandles = []
  const host = document.getElementById('moduleOrderGroups')
  if (!host) return
  host.querySelectorAll<HTMLElement>('.module-order-list').forEach((list) => {
    const page = list.dataset.listPage ?? ''
    if (page === '') return
    sortableHandles.push(
      createSortable({
        container: list,
        itemSelector: '.module-order-item',
        getItemId: (item) => item.dataset.module ?? '',
        // 把手启动：行内有隐藏 / 上移 / 下移三个按钮，整行拖会和它们抢手势
        handleSelector: '.module-order-handle',
        // 提交后整树重渲染（顺序存回存储 + afterOrderChanged），动画找不到
        // 「移动后的项」，直接撤浮层（与既有规则表格同口径）
        animateDrop: false,
        onReorder: (event) => {
          const order = getNavOrder(page)
          const fromIndex = order.indexOf(event.fromId)
          // overId 为 null = 拖到列表末尾；placeAfter = 落目标项之后
          const overIndex = event.overId === null ? order.length - 1 : order.indexOf(event.overId)
          if (fromIndex === -1 || overIndex === -1) return
          const toIndex = event.placeAfter ? overIndex + 1 : overIndex
          const next = moveInArray(order, fromIndex, toIndex)
          if (!setNavOrder(page, next)) {
            showToast('调整顺序失败', 'error')
            return
          }
          afterOrderChanged(page, '顺序已更新')
        },
      }),
    )
  })
}

/**
 * 初始化模块排序编辑器：渲染清单并绑定容器级事件委托。
 * 仅在存在 `#moduleOrderGroups` 的设置页生效，其余页面静默跳过。
 */
export function initializeModuleOrderEditor(): void {
  const host = document.getElementById('moduleOrderGroups')
  if (!host) return
  renderModuleOrderEditor()
  bindSortables()
  // 容器元素本身不会被替换，用标记位避免重复初始化时叠加监听器
  if (host.dataset.bound === '1') return
  host.dataset.bound = '1'
  host.addEventListener('click', onEditorClick)
  startModuleOrderSync()
  bgmLog(LOG_LEVELS.INFO, '[moduleOrder] 模块排序编辑器已初始化')
}
