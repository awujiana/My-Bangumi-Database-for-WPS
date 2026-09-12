/**
 * @fileoverview 功能模块折叠 / 隐藏（按页面持久化 + 跨页同步）
 * @module tools/module-state
 * @description 让每个功能模块右上角出现折叠按钮，并允许在设置页把模块整体隐藏。
 *
 * 设计要点：
 *   1. **两种状态互相独立**：
 *      - 折叠（collapsed）：模块标题保留、内容收起，用户随时可点开；
 *      - 隐藏（hidden）：模块在主区与侧栏锚点中彻底消失，只能在设置页恢复。
 *   2. **按页面分别记录**：`sec-preview` 在 panel / enrich / clean 三页都存在，
 *      折叠 panel 的不影响 enrich —— 与排序配置（`nav-order`）的按页存储口径一致。
 *   3. **都持久化进 PluginStorage**（`bgm_module_collapsed` / `bgm_module_hidden`），
 *      即用户说的「计入缓存配置」：刷新 / 重开任务窗格后仍在。
 *   4. **自愈**：存储里已下线的模块 id 被丢弃，无需迁移逻辑（与 nav-order 同策略）。
 *   5. **跨页同步只能轮询**（WPS 各任务窗格是独立 WebView，没有推送通道），
 *      策略与 `nav-order` 一致：空闲 2s，命中变化后加密到 300ms 并保持 5s。
 *
 * 折叠按钮由 `installCollapseToggles()` **运行时注入**到每个模块的 `<h3>` 里，
 * 而不是手写进 4 份 HTML —— 否则 29 个模块要改 29 处，新增模块还会漏。
 *
 * 新增页面时必须同步更新 `nav-order.ts` 的 `PAGE_MODULES` 并在入口调用
 * `startModuleStateSync('<page>')`，由 `scripts/check-nav-order.mjs` 门禁强制校验。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { CONFIG_KEYS, getConfig, setConfig } from './config.js'
import { PAGE_MODULES } from './nav-order.js'
import { bgmLog } from './util/index.js'

/** 空闲态轮询间隔（ms） */
const SYNC_IDLE_INTERVAL_MS = 2000

/** 检测到变化后使用的加密轮询间隔（ms） */
const SYNC_ACTIVE_INTERVAL_MS = 300

/** 命中一次变化后保持加密轮询的时长（ms） */
const SYNC_ACTIVE_WINDOW_MS = 5000

/** 折叠按钮的类名（同时是样式与查询用的唯一标识） */
const COLLAPSE_BUTTON_CLASS = 'mod-collapse-btn'

/** 模块被折叠时加在模块根元素上的类名 */
const COLLAPSED_CLASS = 'is-module-collapsed'

/** 展开 / 收起两种状态下的按钮图标 */
const ICON_EXPANDED = '▾'
const ICON_COLLAPSED = '▸'

/** 设置页「模块排序」编辑器自身所在模块：禁止隐藏，否则无法恢复其它模块 */
const UNHIDEABLE = { page: 'settings', id: 'sec-modules' } as const

/**
 * 该模块是否允许被隐藏。
 * 编辑器模块本身不可隐藏 —— 隐藏后就没有入口能把它（和其它模块）恢复了。
 */
export function canHideModule(page: string, moduleId: string): boolean {
  return !(page === UNHIDEABLE.page && moduleId === UNHIDEABLE.id)
}

/** 解析某个配置键下的 `{ 页面: [模块 id] }` 映射；异常或无值时返回空对象 */
function readMap(key: string, isSilent: boolean): Record<string, unknown> {
  const raw = getConfig(key, '', isSilent)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[moduleState] 状态配置解析失败: ${(error as Error).message}`)
  }
  return {}
}

/**
 * 读取某页面在某配置键下的模块 id 列表。
 * 自愈：只保留当前注册表中仍存在且未重复的 id；未知页面返回空数组。
 */
function readIds(key: string, page: string, isSilent: boolean): string[] {
  const modules = PAGE_MODULES[page]
  if (!modules) return []
  const stored = readMap(key, isSilent)[page]
  if (!Array.isArray(stored)) return []
  const known = new Set(modules.map((module) => module.id))
  const result: string[] = []
  for (const item of stored) {
    if (typeof item === 'string' && known.has(item) && !result.includes(item)) {
      result.push(item)
    }
  }
  return result
}

/**
 * 写入某页面在某配置键下的模块 id 列表。
 * 只接受注册表中的已知 id；列表为空时删除该页的键（让配置保持干净）。
 */
function setIds(key: string, page: string, ids: readonly string[]): boolean {
  const modules = PAGE_MODULES[page]
  if (!modules) {
    bgmLog(LOG_LEVELS.WARN, `[moduleState] 未知页面，无法写入状态: ${page}`)
    return false
  }
  const known = new Set(modules.map((module) => module.id))
  const normalized: string[] = []
  for (const id of ids) {
    if (known.has(id) && !normalized.includes(id)) normalized.push(id)
  }
  const map = readMap(key, false)
  if (normalized.length === 0) {
    Reflect.deleteProperty(map, page)
  } else {
    map[page] = normalized
  }
  return setConfig(key, JSON.stringify(map))
}

/** 读取被折叠的模块 id */
export function getCollapsedModules(page: string, isSilent = false): string[] {
  return readIds(CONFIG_KEYS.MODULE_COLLAPSED, page, isSilent)
}

/** 读取被隐藏的模块 id */
export function getHiddenModules(page: string, isSilent = false): string[] {
  return readIds(CONFIG_KEYS.MODULE_HIDDEN, page, isSilent)
}

/** 直接写入折叠集合（供「全部展开 / 全部折叠」类批量操作使用） */
export function setCollapsedModules(page: string, ids: readonly string[]): boolean {
  return setIds(CONFIG_KEYS.MODULE_COLLAPSED, page, ids)
}

/** 直接写入隐藏集合 */
export function setHiddenModules(page: string, ids: readonly string[]): boolean {
  return setIds(CONFIG_KEYS.MODULE_HIDDEN, page, ids)
}

/** 切换单个模块的折叠状态；不可隐藏模块的隐藏请求会被静默忽略 */
export function toggleModuleCollapsed(page: string, moduleId: string): void {
  const current = getCollapsedModules(page)
  const next = current.includes(moduleId)
    ? current.filter((id) => id !== moduleId)
    : [...current, moduleId]
  setCollapsedModules(page, next)
}

/**
 * 切换单个模块的隐藏状态。
 *
 * 不可隐藏的模块（设置页的排序编辑器自身）在这里**直接拒绝**：
 * 渲染层只是把按钮置灰，那只是提示；真出事的是有人绕过 disabled 触发点击 ——
 * 一旦编辑器模块被隐藏，就再也没有入口能恢复任何模块了。可恢复性属于不变量，
 * 必须在数据层保证，不能只靠 UI 状态。
 */
export function toggleModuleHidden(page: string, moduleId: string): void {
  if (!canHideModule(page, moduleId)) return
  const current = getHiddenModules(page)
  const next = current.includes(moduleId)
    ? current.filter((id) => id !== moduleId)
    : [...current, moduleId]
  setHiddenModules(page, next)
}

/**
 * 当前页面键：显式传入优先，否则取 `body[data-page]`。
 * 调用方均已保证处于浏览器上下文，故这里不再重复判断 `document` 是否存在。
 */
function resolvePage(page?: string): string {
  return page ?? document.body.dataset.page ?? ''
}

/**
 * 把折叠 / 隐藏状态套用到当前页面的 DOM。
 *
 * 三处一起处理，否则会出现「主区没了但侧栏锚点还在」这类半生效状态：
 *  1. 模块根元素：隐藏用 `hidden` 属性（配 CSS `!important` 覆盖布局类），
 *     折叠用类名 `is-module-collapsed`（CSS 隐藏除标题外的子元素，标题必须留着才能再点开）；
 *  2. 侧栏锚点：模块隐藏时一并隐藏，避免点了跳转到一个不存在的区块；
 *  3. 折叠按钮：`aria-expanded` 与图标跟随状态更新。
 */
export function applyModuleState(page?: string): void {
  if (typeof document === 'undefined') return
  const pageKey = resolvePage(page)
  const modules = PAGE_MODULES[pageKey]
  if (!modules) return

  const hidden = new Set(getHiddenModules(pageKey, true))
  const collapsed = new Set(getCollapsedModules(pageKey, true))
  // 一次性取好再按属性匹配：避免在循环里拼选择器（既慢，又要处理 CSS 转义）
  const navLinks = [...document.querySelectorAll<HTMLElement>('.nav a[href^="#"]')]
  const collapseButtons = [...document.querySelectorAll<HTMLElement>(`.${COLLAPSE_BUTTON_CLASS}`)]

  for (const module of modules) {
    const isHidden = hidden.has(module.id)
    const isCollapsed = collapsed.has(module.id)

    const element = document.getElementById(module.id)
    if (element !== null) {
      element.hidden = isHidden
      element.classList.toggle(COLLAPSED_CLASS, isCollapsed)
    }

    const anchor = navLinks.find((link) => link.getAttribute('href') === `#${module.id}`)
    if (anchor !== undefined) anchor.hidden = isHidden

    const button = collapseButtons.find((item) => item.dataset.modCollapse === module.id)
    if (button !== undefined) {
      button.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true')
      button.textContent = isCollapsed ? ICON_COLLAPSED : ICON_EXPANDED
    }
  }
}

/** 点击委托是否已挂到 document（模块级，避免重复挂载导致一次点击切换两次） */
let hasBoundCollapseListener = false

/** 点击委托：命中折叠按钮就切换状态并立即套用（本页无需等轮询） */
function onCollapseClick(event: Event): void {
  const { target } = event
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLElement>(`.${COLLAPSE_BUTTON_CLASS}`)
  const moduleId = button?.dataset.modCollapse ?? ''
  if (!moduleId) return
  const page = resolvePage()
  if (!page) return
  event.preventDefault()
  toggleModuleCollapsed(page, moduleId)
  applyModuleState(page)
}

/**
 * 往每个模块的第一个 `<h3>` 里注入折叠按钮。
 * 幂等：已注入过（按钮存在）就跳过，重复调用不会叠加。
 */
export function installCollapseToggles(page?: string): void {
  if (typeof document === 'undefined') return
  const pageKey = resolvePage(page)
  const modules = PAGE_MODULES[pageKey]
  if (!modules) return

  for (const module of modules) {
    const heading = document.getElementById(module.id)?.querySelector(':scope > h3')
    // 没有标题的模块（如 panel 的通栏 command-center）没有可收起的正文，不注入按钮；
    // 已注入过的也不重复加（幂等）。
    const existing = heading?.querySelector(`:scope > .${COLLAPSE_BUTTON_CLASS}`)
    if (heading != null && existing === null) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = COLLAPSE_BUTTON_CLASS
      button.dataset.modCollapse = module.id
      button.setAttribute('aria-controls', module.id)
      button.setAttribute('aria-expanded', 'true')
      button.setAttribute('aria-label', `折叠 / 展开「${module.label}」`)
      button.title = `折叠 / 展开「${module.label}」`
      button.textContent = ICON_EXPANDED
      heading.appendChild(button)
    }
  }

  if (!hasBoundCollapseListener) {
    hasBoundCollapseListener = true
    document.addEventListener('click', onCollapseClick)
  }
}

/** 无定时器可清时的空清理函数（非浏览器上下文） */
const noopCleanup = (): void => {
  /* 无需清理 */
}

/** 两个状态键的合并快照，用于判断「配置是否变了」 */
function rawSnapshot(): string {
  const collapsed = getConfig(CONFIG_KEYS.MODULE_COLLAPSED, '', true)
  const hidden = getConfig(CONFIG_KEYS.MODULE_HIDDEN, '', true)
  return `${collapsed}|${hidden}`
}

/**
 * 启动本页的模块状态同步：注入折叠按钮 → 套用一次状态 → 轮询其它页的改动。
 *
 * **为什么是轮询**：见 `nav-order.ts` 的说明 —— WPS 各任务窗格是独立 WebView，
 * 没有跨窗格广播通道，PluginStorage 只能读、不通知。
 *
 * @param page - 当前页面键
 * @returns 清理函数（清除定时器）
 */
export function startModuleStateSync(page: string): () => void {
  if (typeof window === 'undefined') return noopCleanup
  installCollapseToggles(page)
  applyModuleState(page)

  let lastRaw = rawSnapshot()
  // tick() 在返回前已同步执行过一次，定时器必然已赋值，故这里不需要 undefined 分支
  let timer: ReturnType<typeof setTimeout>
  /** 最近一次检测到变化的时间戳；用于决定下一轮用加密还是空闲间隔 */
  let lastChangeAt = 0

  const tick = (): void => {
    try {
      const raw = rawSnapshot()
      if (raw !== lastRaw) {
        lastRaw = raw
        lastChangeAt = Date.now()
        applyModuleState(page)
      }
    } catch {
      // 静默处理偶发读取异常，轮询继续
    }
    const isActive = Date.now() - lastChangeAt < SYNC_ACTIVE_WINDOW_MS
    timer = setTimeout(tick, isActive ? SYNC_ACTIVE_INTERVAL_MS : SYNC_IDLE_INTERVAL_MS)
  }

  tick()
  return () => {
    clearTimeout(timer)
  }
}
