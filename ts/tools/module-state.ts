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
 * 6. **折叠按钮原生写在四页 HTML 的模块 `<h3>` 里**（2026-09-13 由「运行时注入」改回）：
 *      按钮与 `PAGE_MODULES` 的一一对应由 `scripts/check-nav-order.mjs` 门禁强制；
 *      本模块只负责 `bindCollapseToggles()` 挂点击委托 + 套用状态。
 *      改回原生的理由：HTML 自描述、不依赖 JS 执行时机、可被静态检查；
 *      代价是 27 处按钮成了 `PAGE_MODULES` 之外的第二份清单（漏一个只表现为「少一个按钮」，
 *      不报错），所以必须由门禁兜住 —— 与本项目其它平行清单同一个套路。
 *   7. **全隐藏兜底**：某页模块被全部隐藏时，渲染常驻占位块（含「打开设置」按钮）并弹一次
 *      toast。**不禁止全隐藏**（用户可能就是想清屏），但要保证永远有路可回 ——
 *      占位块必须常驻，因为 toast 3 秒就消失了，而用户回来看到的是一片空白。
 *
 * 新增页面时必须同步更新 `nav-order.ts` 的 `PAGE_MODULES`、页面 HTML 里的折叠按钮，并在该页
 * 入口调用 `startModuleStateSync('<page>')` —— 以上均由 `scripts/check-nav-order.mjs` 强制校验。
 */

import { getNotifyApi } from '../core/ui-bridge.js'
import { LOG_LEVELS } from '../core/constants.js'
import { runBeforeEnterSolo } from '../core/solo-hooks.js'
import { CONFIG_KEYS, getConfig, setConfig } from './config.js'
import { subscribeConfigPoll } from './config-poll.js'
import { PAGE_MODULES } from './nav-order.js'
import { bgmLog, showSettingsPanel } from './util/index.js'

import type { NavModule } from './nav-order.js'

/** 折叠按钮的类名（同时是样式与查询用的唯一标识） */
const COLLAPSE_BUTTON_CLASS = 'mod-collapse-btn'

/** 模块被折叠时加在模块根元素上的类名 */
const COLLAPSED_CLASS = 'is-module-collapsed'

/** 展开 / 收起两种状态下的按钮图标 */
const ICON_EXPANDED = '▾'
const ICON_COLLAPSED = '▸'

/** 本页模块被全部隐藏时插入的常驻占位块 id */
const EMPTY_HINT_ID = 'module-empty-hint'

/** 占位块里「打开设置」按钮的类名（供样式与测试定位） */
const EMPTY_HINT_BUTTON_CLASS = 'module-empty-hint-btn'

/** 全隐藏时的 toast 文案（占位块里的说明更详细，这里只做瞬时提醒） */
const EMPTY_HINT_TOAST = '本页模块已全部隐藏，请到「设置 → 模块排序」重新开启'

/** 占位块里的说明文案 */
const EMPTY_HINT_TEXT = '本页模块已全部隐藏。请打开设置页，在「模块排序」中开启需要显示的功能模块。'

/** 设置页「模块排序」编辑器自身所在模块：禁止隐藏，否则无法恢复其它模块 */
const UNHIDEABLE = { page: 'settings', id: 'sec-modules' } as const

// ========== 专注模式（只显示单个模块，可上下切换） ==========

/** 模块标题里「只显示此模块」按钮的类名 */
const SOLO_BUTTON_CLASS = 'mod-solo-btn'

/** 专注模式浮动控制条的 id / 类名 */
const SOLO_BAR_ID = 'solo-mode-bar'

/** 专注模式加在 body 上的类（供 CSS 隐藏顶栏，沉浸显示单个模块） */
const SOLO_BODY_CLASS = 'solo-mode'

/**
 * 专注模式状态：`{ page, moduleId }` 或 null。
 *
 * **为什么不持久化**：专注模式是「视图」不是「配置」。若写进
 * `bgm_module_hidden`，退出时得把用户原来的隐藏集合原样还原（漏一个就丢配置），
 * 而且会和设置页编辑器、跨页轮询、导入导出全缠在一起 —— 为「刷新后还在专注」
 * 这一点收益背一身状态，不值。刷新即退出，符合「临时看一眼」的语义。
 */
let soloMode: { page: string; moduleId: string } | null = null

/** 当前是否处于专注模式 */
export function isSoloMode(): boolean {
  return soloMode !== null
}

/** 当前专注的模块 id（未进入时为 null） */
export function currentSoloModule(): string | null {
  return soloMode?.moduleId ?? null
}

/** 取某页注册表里「可参与专注模式」的模块（按注册顺序 = 页面显示顺序） */
function soloableModules(page: string): readonly NavModule[] {
  const modules = PAGE_MODULES[page]
  if (!modules) return []
  return modules.filter((module) => canHideModule(page, module.id))
}

/**
 * 进入专注模式：本页只显示 `moduleId` 一个模块。
 *
 * 目标模块同时被强制展开 —— 收起状态进专注模式只会看到一条标题栏，
 * 用户会以为功能坏了。
 */
export function enterSoloMode(page: string, moduleId: string): void {
  const isSoloable = soloableModules(page).some((module) => module.id === moduleId)
  if (!isSoloable) {
    bgmLog(LOG_LEVELS.WARN, `[moduleState] 拒绝进入专注模式: ${moduleId} 不在 ${page} 注册表`)
    return
  }
  soloMode = { page, moduleId }
  // 沉浸：隐藏顶栏（CSS 靠 body.solo-mode 命中 .topbar），让单个模块占满可视区
  document.body.classList.add(SOLO_BODY_CLASS)
  // 进入专注前回调：供上层（detachable-panel）收回浮动窗 —— 否则目标模块若在浮动窗里，
  // 专注只会得到「顶部小浮动窗 + 主区大片空白」，而非单组件铺满屏幕。
  // 经 core/solo-hooks 触发「进入专注前」回调（UI 层 detachable 注册了收回浮动窗）——
  // 不在本层直接 import detachable-panel：tools→UI/components 是分层反向依赖，门禁禁。
  runBeforeEnterSolo()
  applyModuleState(page)
  renderSoloBar()
  bgmLog(LOG_LEVELS.INFO, `[moduleState] 进入专注模式: ${page} / ${moduleId}`)
}

/** 退出专注模式，恢复各模块本来的隐藏 / 折叠状态 */
export function exitSoloMode(): void {
  const previous = soloMode
  soloMode = null
  document.body.classList.remove(SOLO_BODY_CLASS)
  removeSoloBar()
  if (previous) {
    applyModuleState(previous.page)
    bgmLog(LOG_LEVELS.INFO, `[moduleState] 退出专注模式: ${previous.page}`)
  }
}

/**
 * 在专注模式里上下切换模块。
 *
 * 跳过「不可参与」的模块（设置页排序编辑器自身）与当前不存在的模块 ——
 * 注册表里有、DOM 里没有的模块（个别页面按需渲染）跳过去，
 * 否则切到它屏幕上什么都不显示，像是切换坏了。
 */
export function stepSoloMode(delta: number): void {
  if (!soloMode) return
  const modules = soloableModules(soloMode.page).filter(
    (module) => document.getElementById(module.id) !== null,
  )
  if (modules.length === 0) return
  const current = modules.findIndex((module) => module.id === soloMode?.moduleId)
  // 从 -1（当前模块不在可切换集合里）出发时按「第一项」算，保证有明确落点
  const base = current === -1 ? 0 : current
  const next = (base + delta + modules.length) % modules.length
  const target = modules[next]
  if (!target) return
  soloMode = { page: soloMode.page, moduleId: target.id }
  applyModuleState(soloMode.page)
  renderSoloBar()
}

/** 切换某模块的专注状态（按钮入口） */
function toggleSoloMode(page: string, moduleId: string): void {
  if (soloMode?.page === page && soloMode.moduleId === moduleId) exitSoloMode()
  else enterSoloMode(page, moduleId)
}

/** 移除浮动控制条（重复调用安全） */
function removeSoloBar(): void {
  document.getElementById(SOLO_BAR_ID)?.remove()
}

/**
 * 渲染专注模式控制条：上下切换与退出（不显示当前组件名）。
 *
 * 不再做成底部固定条 —— momo 要求放到专注模块标题里「折叠 / 展开」按钮的原位置：
 * 进入专注后那个折叠按钮已无意义（模块强制展开且独占视图），控制条就接它的位；
 * 标题（h3）本身是 flex 容器，控制条 `margin-left:auto` 顶到最右，视觉上正好替换
 * 折叠按钮。拿不到标题（极端情况）时退回底部固定条（--fixed）兜底。
 */
function renderSoloBar(): void {
  removeSoloBar()
  if (!soloMode) return

  const bar = document.createElement('div')
  bar.id = SOLO_BAR_ID
  bar.className = 'solo-mode-bar solo-mode-bar--inline'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', '专注模式：只显示单个模块，可上下切换或退出')

  const makeStep = (icon: string, ariaLabel: string, delta: number): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'solo-mode-bar-btn'
    button.textContent = icon
    button.title = ariaLabel
    button.setAttribute('aria-label', ariaLabel)
    button.addEventListener('click', () => {
      stepSoloMode(delta)
    })
    return button
  }

  const exit = document.createElement('button')
  exit.type = 'button'
  exit.className = 'solo-mode-bar-btn solo-mode-bar-btn--exit'
  exit.textContent = '✕ 退出专注'
  exit.title = '退出专注模式，恢复全部模块'
  exit.setAttribute('aria-label', exit.title)
  exit.addEventListener('click', () => {
    exitSoloMode()
  })

  // 不显示当前组件名（用户：不需要表示当前的组件名字）—— 控制条只留 切换 / 退出。
  bar.append(makeStep('↑', '上一个模块', -1), makeStep('↓', '下一个模块', 1), exit)

  // 放进专注模块的标题：接替被隐藏的折叠按钮的位置（标题是 flex，margin-left:auto 顶到最右）。
  // 折叠按钮本身只是 display:none，仍在 DOM，before 永远有可靠落点。
  const section = document.getElementById(soloMode.moduleId)
  const heading = section?.querySelector<HTMLElement>('h3, h2') ?? null
  if (heading === null) {
    // 兜底：极端情况下拿不到标题，退回底部固定条，至少功能可用
    bar.classList.remove('solo-mode-bar--inline')
    bar.classList.add('solo-mode-bar--fixed')
    document.body.append(bar)
    return
  }
  const collapseButton = heading.querySelector<HTMLElement>(`.${COLLAPSE_BUTTON_CLASS}`)
  if (collapseButton === null) heading.append(bar)
  else collapseButton.before(bar)
}

/** 造一个模块标题里的「只显示此模块」按钮 */
function makeSoloButton(module: NavModule): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = SOLO_BUTTON_CLASS
  button.textContent = '⛶'
  button.dataset.modSolo = module.id
  const label = `只显示「${module.label}」，其余模块暂时隐藏（可上下切换）`
  button.title = label
  button.setAttribute('aria-label', label)
  return button
}

/**
 * 给本页所有模块标题注入「只显示此模块」按钮（幂等）。
 *
 * **为什么是运行时注入而不是像折叠按钮那样写进 HTML**：折叠按钮与
 * `PAGE_MODULES` 是一一对应的平行清单，必须静态可查（nav-order 门禁靠它
 * 抓「漏一个按钮」）；专注按钮没有这种对应关系 —— 它对所有模块是同一套逻辑，
 * 写 37 份纯属复制粘贴，漏一个也不影响其它模块工作。故用注入 + 事件委托。
 */
function injectSoloButtons(page: string): void {
  const modules = PAGE_MODULES[page]
  if (!modules) return
  for (const module of modules) {
    const element = document.getElementById(module.id)
    const heading = element?.querySelector('h3, h2')
    // 没有标题元素就跳过：不强行插到模块最前面，那会挡掉模块自己的首行内容。
    // 已注入过的不重复加（幂等，模块被拖进浮动窗口再拖回来时这条会命中）。
    if (heading !== null && heading !== undefined) {
      const isInjected = heading.querySelector(`.${SOLO_BUTTON_CLASS}`) !== null
      if (!isInjected) heading.append(makeSoloButton(module))
    }
  }
}

/** 点击委托是否已挂到 document（模块级，避免重复挂载导致一次点击切换两次） */
let hasBoundSoloListener = false

/** 点击委托：命中专注按钮就切换 */
function onSoloClick(event: Event): void {
  const { target } = event
  if (!(target instanceof Element)) return
  const button = target.closest<HTMLElement>(`.${SOLO_BUTTON_CLASS}`)
  const moduleId = button?.dataset.modSolo ?? ''
  if (!moduleId) return
  const page = resolvePage()
  if (!page) return
  event.preventDefault()
  toggleSoloMode(page, moduleId)
}

/** 挂上专注按钮的点击委托（幂等） */
function bindSoloToggles(): void {
  if (typeof document === 'undefined') return
  if (hasBoundSoloListener) return
  hasBoundSoloListener = true
  document.addEventListener('click', onSoloClick)
}

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

/**
 * 剔除不允许隐藏的模块 id（目前只有设置页的排序编辑器自身）。
 *
 * **读、写两侧都要过滤**，只拦写入侧是不够的：配置还有别的来源 ——
 * 导入配置、旧版本遗留、手改 PluginStorage。这些路径不经过 `toggleModuleHidden`，
 * 只靠写入侧守卫拦不住，而一旦编辑器模块被隐藏就再没有入口能恢复任何模块。
 * 读侧保证「读出来的永远安全」，写侧保证「存下来的永远是干净的」。
 */
function filterHideable(page: string, ids: readonly string[]): string[] {
  return ids.filter((id) => canHideModule(page, id))
}

/** 读取被折叠的模块 id */
export function getCollapsedModules(page: string, isSilent = false): string[] {
  return readIds(CONFIG_KEYS.MODULE_COLLAPSED, page, isSilent)
}

/** 读取被隐藏的模块 id（受保护的模块即使配置里写了也不算隐藏） */
export function getHiddenModules(page: string, isSilent = false): string[] {
  return filterHideable(page, readIds(CONFIG_KEYS.MODULE_HIDDEN, page, isSilent))
}

/** 直接写入折叠集合（供「全部展开 / 全部折叠」类批量操作使用） */
export function setCollapsedModules(page: string, ids: readonly string[]): boolean {
  return setIds(CONFIG_KEYS.MODULE_COLLAPSED, page, ids)
}

/** 直接写入隐藏集合（受保护的模块会被剔除，存储里不留脏数据） */
export function setHiddenModules(page: string, ids: readonly string[]): boolean {
  return setIds(CONFIG_KEYS.MODULE_HIDDEN, page, filterHideable(page, ids))
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
 * 不可隐藏的模块（设置页的排序编辑器自身）在 `filterHideable` 里被剔除 ——
 * 渲染层把按钮置灰只是提示，真出事的是有人绕过 disabled 触发点击；而配置还有
 * 导入 / 旧版本遗留这些不经过本函数的来源。可恢复性属于不变量，必须落在数据层。
 */
export function toggleModuleHidden(page: string, moduleId: string): void {
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
 * 四处一起处理，否则会出现「主区没了但侧栏锚点还在」这类半生效状态：
 *  1. 模块根元素：隐藏用 `hidden` 属性（配 CSS `!important` 覆盖布局类），
 *     折叠用类名 `is-module-collapsed`（CSS 隐藏除标题外的子元素，标题必须留着才能再点开）；
 *  2. 侧栏锚点：模块隐藏时一并隐藏，避免点了跳转到一个不存在的区块；
 *  3. 折叠按钮（HTML 里原生的那些）：`aria-expanded` / `aria-controls` 与图标跟随状态更新；
 *  4. 全隐藏兜底：一个可见模块都不剩时挂常驻占位块（见 `syncEmptyHint`）。
 */
export function applyModuleState(page?: string): void {
  if (typeof document === 'undefined') return
  const pageKey = resolvePage(page)
  const modules = PAGE_MODULES[pageKey]
  if (!modules) return

  const hidden = new Set(getHiddenModules(pageKey, true))
  const collapsed = new Set(getCollapsedModules(pageKey, true))
  // 专注模式：本页只放行 soloId 一个模块，其余一律按隐藏处理。
  // 与 hidden 集合叠加（不是替换）—— 用户原本隐藏的模块退出专注后还是要藏回去。
  const soloId = soloMode?.page === pageKey ? soloMode.moduleId : null
  // 一次性取好再按属性匹配：避免在循环里拼选择器（既慢，又要处理 CSS 转义）
  const navLinks = [...document.querySelectorAll<HTMLElement>('.nav a[href^="#"]')]
  const collapseButtons = [...document.querySelectorAll<HTMLElement>(`.${COLLAPSE_BUTTON_CLASS}`)]
  const soloButtons = [...document.querySelectorAll<HTMLElement>(`.${SOLO_BUTTON_CLASS}`)]

  for (const module of modules) {
    const isSoloTarget = soloId !== null && module.id === soloId
    const isHidden = hidden.has(module.id) || (soloId !== null && !isSoloTarget)
    // 专注目标强制展开：收起状态进专注模式只看到一条标题栏，用户会以为功能坏了
    const isCollapsed = isSoloTarget ? false : collapsed.has(module.id)

    const element = document.getElementById(module.id)
    if (element !== null) {
      element.hidden = isHidden
      element.classList.toggle(COLLAPSED_CLASS, isCollapsed)
    }

    const anchor = navLinks.find((link) => link.getAttribute('href') === `#${module.id}`)
    if (anchor !== undefined) anchor.hidden = isHidden

    const button = collapseButtons.find((item) => item.dataset.modCollapse === module.id)
    if (button !== undefined) {
      // 专注目标：折叠按钮无意义（模块强制展开且独占视图），藏掉、把位置让给专注控制条
      button.hidden = isSoloTarget
      button.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true')
      // `aria-controls` 由这里补：它和 `data-mod-collapse` 是同一个 id，写进 HTML 属于重复，
      // 放在运行时补一次即可（幂等）。
      button.setAttribute('aria-controls', module.id)
      button.textContent = isCollapsed ? ICON_COLLAPSED : ICON_EXPANDED
    }

    // 专注按钮高亮当前目标：用户要能一眼看出「现在只剩哪个模块」，
    // 尤其切到下一项时，高亮跟着走是最直接的反馈。专注目标自身的这个按钮
    // 已成多余（控制条上的 ↑↓ 就是切换），一并藏掉，避免一个亮着却点了没用的按钮。
    const soloButton = soloButtons.find((item) => item.dataset.modSolo === module.id)
    if (soloButton !== undefined) {
      soloButton.classList.toggle('is-active', isSoloTarget)
      soloButton.setAttribute('aria-pressed', isSoloTarget ? 'true' : 'false')
      soloButton.hidden = isSoloTarget
    }

    // 拖出按钮（⧉）在专注态同样多余：专注即「单组件铺满」，再浮出去无意义，
    // 且 onBeforeEnterSolo 已会在进入专注时收掉所有浮动窗。藏掉保持标题整洁。
    const detachTrigger = element?.querySelector<HTMLElement>('.detachable-trigger') ?? null
    if (detachTrigger !== null) detachTrigger.hidden = isSoloTarget
  }

  syncEmptyHint(pageKey, modules, hidden, soloId)
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
 * 挂上折叠按钮的点击委托（**不再创建按钮**）。
 *
 * 按钮原生写在四页 HTML 的模块 `<h3>` 里（见文件头说明），本函数只挂一次 document 级委托。
 * 幂等：重复调用不会重复绑定 —— 绑两次的结果是一次点击切换两次，等于没反应。
 */
export function bindCollapseToggles(): void {
  if (typeof document === 'undefined') return
  if (hasBoundCollapseListener) return
  hasBoundCollapseListener = true
  document.addEventListener('click', onCollapseClick)
}

/** 已经就「本页全隐藏」提示过的页面（恢复可见后清掉，下次再全隐藏仍会提示） */
const warnedEmptyPages = new Set<string>()

/**
 * 全隐藏兜底：本页一个可见模块都不剩时，挂常驻占位块 + 弹一次 toast。
 *
 * 为什么是「兜底」而不是「禁止全隐藏」：用户可能就是想清屏，硬拦反而难用；
 * 真正的风险是**把常用页面藏空后找不到恢复入口** —— 只要有明确回路就够。
 * 占位块必须常驻（toast 3 秒就消失，而用户回来看到的是一片空白），
 * 并复用设置页已有入口 `showSettingsPanel()`；用户在设置页改完，本页靠轮询自动恢复。
 *
 * `soloId` 非空表示正处于专注模式：此时「其它模块不可见」是用户主动选的，
 * 不是误藏空，**不提示**（否则每进一次专注模式就弹一次 toast，很吵）。
 */
function syncEmptyHint(
  page: string,
  modules: readonly NavModule[],
  hidden: ReadonlySet<string>,
  soloId: string | null,
): void {
  const isAllHidden = modules.every((module) => hidden.has(module.id))
  const existing = document.getElementById(EMPTY_HINT_ID)

  if (soloId !== null) {
    // 专注模式有自己的出口（浮动控制条上的「退出专注」），不需要全隐藏兜底
    if (existing !== null) existing.remove()
    warnedEmptyPages.delete(page)
    return
  }

  if (!isAllHidden) {
    if (existing !== null) existing.remove()
    warnedEmptyPages.delete(page)
    return
  }
  if (existing === null) renderEmptyHint()
  // 只在「刚变成全隐藏」时提示一次：applyModuleState 每次轮询命中都会跑，无脑提示会刷屏
  if (!warnedEmptyPages.has(page)) {
    warnedEmptyPages.add(page)
    getNotifyApi().toast(EMPTY_HINT_TOAST, 'warn')
  }
}

/** 渲染常驻占位块（主区被藏空后，这是页面上唯一的可见内容） */
function renderEmptyHint(): void {
  const main = document.querySelector<HTMLElement>('main')
  if (main === null) return
  const hint = document.createElement('div')
  hint.id = EMPTY_HINT_ID
  hint.className = 'module-empty-hint'

  const text = document.createElement('p')
  text.className = 'module-empty-hint-text'
  text.textContent = EMPTY_HINT_TEXT

  const button = document.createElement('button')
  button.type = 'button'
  button.className = `bgm-btn small ${EMPTY_HINT_BUTTON_CLASS}`
  button.textContent = '⚙️ 打开设置'
  button.addEventListener('click', () => {
    showSettingsPanel()
  })

  hint.append(text, button)
  main.append(hint)
}

/** 无定时器可清时的空清理函数（非浏览器上下文） */
const noopCleanup = (): void => {
  /* 无需清理 */
}

/** 两个状态键的合并快照，用于判断「配置是否变了」 */
/**
 * 启动本页的模块状态同步：挂折叠委托 → 套用一次状态 → 轮询其它页的改动。
 *
 * **为什么是轮询**：见 `nav-order.ts` 的说明 —— WPS 各任务窗格是独立 WebView，
 * 没有跨窗格广播通道，PluginStorage 只能读、不通知。
 *
 * @param page - 当前页面键
 * @returns 清理函数（清除定时器）
 */
export function startModuleStateSync(page: string): () => void {
  if (typeof window === 'undefined') return noopCleanup
  bindCollapseToggles()
  // 专注模式：注入「只显示此模块」按钮 + 挂点击委托（幂等，与折叠按钮同套路）
  injectSoloButtons(page)
  bindSoloToggles()
  applyModuleState(page)

  // 轮询本体在 tools/config-poll.ts：与主题 / 导航模式 / 导航顺序共用一个定时器
  // （此前四个模块各一个 2s 定时器 = 5 次 COM 读 / 2s，真机让原生下拉卡顿）
  return subscribeConfigPoll({
    keys: [CONFIG_KEYS.MODULE_COLLAPSED, CONFIG_KEYS.MODULE_HIDDEN],
    apply: () => {
      try {
        applyModuleState(page)
      } catch {
        // 静默处理偶发读取异常，轮询继续
      }
    },
  })
}
