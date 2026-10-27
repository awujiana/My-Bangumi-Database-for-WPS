/**
 * @fileoverview 功能模块排序（跨页同步）
 * @module tools/navOrder
 * @description 让用户在设置页调整 panel / enrich / clean / settings 四个页面的
 *              「侧栏导航项 + 主区模块」显示顺序。
 *
 * 设计要点：
 *   1. 顺序持久化在 PluginStorage 的 `bgm_nav_order`（JSON 对象，形如
 *      `{ "panel": ["sec-command", ...] }`）；未设置的页面回落到注册表默认顺序。
 *   2. 自愈：读取时过滤掉存储中已不存在的模块 id，并把注册表里新增但存储中缺失的
 *      模块追加到末尾 —— 因此新增/删除模块无需写迁移逻辑，旧配置也不会失效。
 *   3. 跨页同步分两条路径：
 *      - **本页（编辑器所在页）**：改动后由 `notifyNavOrderChanged(page)` 同步重排，
 *        零延迟 —— 用户点完 ↑↓ 立刻看到结果；
 *      - **其它页**：各页入口调用 `startNavOrderSync()`，各自轮询 PluginStorage
 *        （WPS 各任务窗格是独立 WebView，postMessage 无法跨窗格广播，没有推送通道）。
 *        轮询间隔自适应：空闲 2s，命中变化后一段时间内加密到 300ms，让连续调整跟手。
 *
 * 新增页面时必须同步更新：`PAGE_MODULES` / `PAGE_LABELS` / `ORDERABLE_PAGES`，
 * 并在该页入口加上 `startNavOrderSync('<page>')` 与 `startNavModeSync()`。
 * 以上一致性由 `scripts/check-nav-order.mjs` 门禁强制校验。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { CONFIG_KEYS, getConfig, setConfig } from './config.js'
import { subscribeConfigPoll } from './config-poll.js'
import { bgmLog } from './util/index.js'

/** 单个可排序模块的定义 */
export interface NavModule {
  /** 模块根元素 id（同时是导航锚点 `#id`） */
  id: string
  /** 展示名称（导航文案） */
  label: string
  /** 导航图标（emoji） */
  icon: string
}

/** 页面键 → 该页可排序模块的默认顺序 */
export const PAGE_MODULES: Readonly<Record<string, readonly NavModule[]>> = {
  panel: [
    { id: 'sec-command', label: '同步操作', icon: '🚀' },
    { id: 'sec-account', label: '账户与凭证', icon: '🔑' },
    { id: 'sec-scope', label: '同步范围与选择', icon: '🎯' },
    { id: 'sec-strategy', label: '同步策略', icon: '⚖️' },
    { id: 'sec-remote', label: '远程数据同步', icon: '🗄️' },
    { id: 'sec-preview', label: '数据预览', icon: '👁️' },
    { id: 'sec-records', label: '记录与日志', icon: '📊' },
    { id: 'sec-help', label: '帮助与格式', icon: '📖' },
  ],
  enrich: [
    { id: 'sec-file', label: '新番表文件', icon: '📁' },
    { id: 'sec-target', label: '目标工作表', icon: '🎯' },
    { id: 'sec-preview', label: '数据预览', icon: '👁️' },
    { id: 'sec-enrich', label: '富化执行', icon: '⚡️' },
    { id: 'sec-records', label: '富化记录', icon: '📊' },
    { id: 'sec-tips', label: '使用提示', icon: '💡' },
  ],
  clean: [
    { id: 'sec-targets', label: '选择清理的表格', icon: '🎯' },
    { id: 'sec-items', label: '可清理项', icon: '☑️' },
    { id: 'sec-preview', label: '执行前预览', icon: '🔍' },
    { id: 'sec-run', label: '执行清理', icon: '🧹' },
    { id: 'sec-log', label: '结果日志', icon: '📜' },
  ],
  highlight: [
    { id: 'sec-condition', label: '匹配条件', icon: '🎯' },
    { id: 'sec-columns', label: '高亮列', icon: '☑️' },
    { id: 'sec-preview', label: '实时预览', icon: '👁️' },
    { id: 'sec-run', label: '应用与清除', icon: '🖌️' },
  ],
  'conditional-format': [
    { id: 'sec-target', label: '目标工作表', icon: '🎯' },
    { id: 'sec-existing', label: '工作表规则', icon: '👀' },
    { id: 'sec-rules', label: '我的规则', icon: '☑️' },
    { id: 'sec-defaults', label: '默认规则集', icon: '📦' },
    { id: 'sec-apply', label: '应用与修复', icon: '🖌️' },
  ],
  settings: [
    { id: 'sec-appearance', label: '外观与导航', icon: '🎨' },
    { id: 'sec-modules', label: '模块排序', icon: '🧩' },
    { id: 'sec-shortcuts', label: '快捷键', icon: '⌨️' },
    { id: 'sec-accounts', label: '账号', icon: '👤' },
    { id: 'sec-sync-pref', label: '同步偏好', icon: '🔄' },
    { id: 'sec-enrich-preview', label: '富化预览', icon: '⚡️' },
    { id: 'sec-feature-toggles', label: '功能开关', icon: '⚙️' },
    { id: 'sec-cf-pref', label: '条件格式', icon: '🎨' },
    { id: 'sec-paths', label: '默认路径', icon: '📁' },
    { id: 'sec-log-pref', label: '日志偏好', icon: '📜' },
    { id: 'sec-data', label: '配置管理', icon: '📦' },
    { id: 'sec-export', label: '数据导出', icon: '📤' },
    { id: 'sec-about', label: '关于', icon: 'ℹ️' },
  ],
}

/** 页面键 → 页面中文名（供设置页展示） */
export const PAGE_LABELS: Readonly<Record<string, string>> = {
  panel: '主面板',
  enrich: '富化面板',
  clean: '清理面板',
  highlight: '高亮面板',
  'conditional-format': '条件格式面板',
  settings: '设置页',
}

/** 设置页中可配置排序的页面键（顺序即展示顺序） */
export const ORDERABLE_PAGES: readonly string[] = [
  'panel',
  'enrich',
  'clean',
  'highlight',
  'conditional-format',
  'settings',
]

/** 读取页面默认顺序 */
function getDefaultOrder(page: string): string[] {
  const modules = PAGE_MODULES[page]
  return modules ? modules.map((module) => module.id) : []
}

/** 解析存储中的整个排序对象；异常时返回空对象（视为全部走默认顺序） */
function readOrderMap(isSilent = true): Record<string, unknown> {
  const raw = getConfig(CONFIG_KEYS.NAV_ORDER, '', isSilent)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[navOrder] 排序配置解析失败: ${(error as Error).message}`)
  }
  return {}
}

/** 写回整个排序对象 */
function saveOrderMap(map: Record<string, unknown>): boolean {
  return setConfig(CONFIG_KEYS.NAV_ORDER, JSON.stringify(map))
}

/**
 * 读取指定页面的模块顺序。
 * 结果始终包含该页注册表中的**全部**模块 id：存储里缺失的按注册表顺序补到末尾，
 * 存储里多余的（已下线模块）被丢弃。
 * @param page - 页面键（panel / enrich / clean）
 * @param isSilent - 静默模式，不打印日志（轮询用）
 */
export function getNavOrder(page: string, isSilent = false): string[] {
  const defaults = getDefaultOrder(page)
  if (defaults.length === 0) return []
  const stored = readOrderMap(isSilent)[page]
  if (!Array.isArray(stored)) return defaults

  const known = new Set(defaults)
  const result: string[] = []
  for (const item of stored) {
    if (typeof item === 'string' && known.has(item) && !result.includes(item)) {
      result.push(item)
    }
  }
  // 自愈：注册表中新增但存储中缺失的模块追加到末尾
  for (const id of defaults) {
    if (!result.includes(id)) result.push(id)
  }
  return result
}

/**
 * 写入指定页面的模块顺序。
 * 只接受该页注册表中的已知 id，未出现的模块按注册表顺序补到末尾，
 * 保证写入的数组永远是「完整且合法」的。
 * @param page - 页面键
 * @param order - 期望顺序
 */
export function setNavOrder(page: string, order: readonly string[]): boolean {
  const defaults = getDefaultOrder(page)
  if (defaults.length === 0) {
    bgmLog(LOG_LEVELS.WARN, `[navOrder] 未知页面，无法设置排序: ${page}`)
    return false
  }
  const known = new Set(defaults)
  const normalized: string[] = []
  for (const id of order) {
    if (known.has(id) && !normalized.includes(id)) normalized.push(id)
  }
  for (const id of defaults) {
    if (!normalized.includes(id)) normalized.push(id)
  }

  const map = readOrderMap()
  map[page] = normalized
  const isSaved = saveOrderMap(map)
  if (isSaved) bgmLog(LOG_LEVELS.INFO, `[navOrder] 已保存 ${page} 排序: ${normalized.join(', ')}`)
  return isSaved
}

/** 把指定页面恢复为注册表默认顺序（删除该页面的存储项） */
export function resetNavOrder(page: string): boolean {
  const map = readOrderMap()
  if (!Object.hasOwn(map, page)) return true
  Reflect.deleteProperty(map, page)
  const isSaved = saveOrderMap(map)
  if (isSaved) bgmLog(LOG_LEVELS.INFO, `[navOrder] 已重置 ${page} 排序为默认`)
  return isSaved
}

/**
 * 把模块移动到目标下标（供拖拽使用）。
 * @param page - 页面键
 * @param moduleId - 被移动的模块 id
 * @param targetIndex - 目标下标（会被夹取到合法范围）
 */
export function moveModuleTo(page: string, moduleId: string, targetIndex: number): boolean {
  const order = getNavOrder(page)
  const from = order.indexOf(moduleId)
  if (from === -1) return false
  const clamped = Math.max(0, Math.min(order.length - 1, targetIndex))
  if (from === clamped) return true
  order.splice(from, 1)
  order.splice(clamped, 0, moduleId)
  return setNavOrder(page, order)
}

/**
 * 把模块上移/下移若干位（供 ↑↓ 按钮使用）。
 * @param page - 页面键
 * @param moduleId - 被移动的模块 id
 * @param offset - 位移（-1 上移，+1 下移）
 */
export function moveModuleBy(page: string, moduleId: string, offset: number): boolean {
  const order = getNavOrder(page)
  const from = order.indexOf(moduleId)
  if (from === -1) return false
  return moveModuleTo(page, moduleId, from + offset)
}

/**
 * 按当前配置就地重排页面的「侧栏导航项」与「主区模块」。
 *
 * 之所以同时重排两处：侧栏锚点顺序与主区实际顺序必须一致，
 * 否则 scrollspy 的「从上到下第一个完整可见标题」判定会与视觉顺序错位。
 *
 * 不存在的模块 id 会被跳过（页面结构差异，如 enrich 无 sec-command），
 * 主区中不属于排序表的子元素统一追加到末尾，避免被挤到中间破坏布局。
 *
 * @param page - 页面键；缺省时按 `document.body.dataset.page` 推断
 */
export function applyNavOrder(page?: string): void {
  if (typeof document === 'undefined') return
  const pageKey = page ?? document.body.dataset.page ?? ''
  if (!pageKey) return
  const order = getNavOrder(pageKey, true)
  if (order.length === 0) return

  // 1) 侧栏导航项：按 order 重排（.nav-label / .nav-indicator 不是 a 元素，位置不受影响）
  const nav = document.querySelector('.nav')
  if (nav) {
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
    const byHref = new Map<string, HTMLAnchorElement>()
    for (const link of links) {
      const href = link.getAttribute('href') ?? ''
      if (href.length > 1) byHref.set(href.slice(1), link)
    }
    for (const id of order) {
      const link = byHref.get(id)
      if (link) nav.appendChild(link)
    }
  }

  // 2) 主区模块：按 order 重排 main 的直接子元素
  // 选择器用 `main.main` 而非 `main.main-grid`：只有 panel 是栅格布局，
  // enrich / clean 用的是 `main.main` 单列布局，写死 main-grid 会让这两页静默不重排。
  const main = document.querySelector('main.main')
  if (main) {
    const children = [...main.children]
    const applied = new Set<Element>()
    for (const id of order) {
      const element = children.find((child) => child.id === id)
      if (element) {
        main.appendChild(element)
        applied.add(element)
      }
    }
    for (const child of children) {
      if (!applied.has(child)) main.appendChild(child)
    }
    // panel 的通栏模块（.command-center）用 CSS `grid-column: 1 / -1` 跨满整行来固定
    // 「视觉焦点在最上方」。但栅格自动布局下，通栏项的放置行由它之前的自动项决定 ——
    // 一旦被排到中段，它只跨当前那一行，上方的自动项会被挤到它下方，形成空洞。
    // 显式指定 order 让 CSS Grid 把通栏项重新提到第一行。
    if (main.classList.contains('main-grid')) {
      for (const child of main.children) {
        const element = child as HTMLElement
        const index = order.indexOf(child.id)
        // 不参与排序的元素（未列入注册表）：保持声明顺序，排在已排序元素之后
        element.style.order = String(index === -1 ? order.length : index + 1)
        // 通栏项提到首行（order 0 小于所有已排序项）
        if (element.classList.contains('command-center')) element.style.order = '0'
      }
    }
  }

  // 3) 布局变化后重测吸顶偏移 / 导航胶囊 / 当前高亮区块
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('scroll'))
  }
}

/**
 * 本页排序已变更：立即就地重排，无需等待轮询。
 *
 * 供设置页的模块排序编辑器在 `setNavOrder` / `resetNavOrder` / `moveModule*`
 * 成功后调用 —— 用户期望「点完 ↑↓ 立刻看到结果」，而跨页轮询最快也要一个间隔。
 * 本页与编辑器处于同一 WebView，可以直接同步调用。
 *
 * @param page - 发生变化的页面键
 */
export function notifyNavOrderChanged(page: string): void {
  if (typeof document === 'undefined') return
  applyNavOrder(page)
}

/**
 * 跨页排序同步：轮询 PluginStorage 中的排序配置，变化时就地重排当前页面。
 * 各页面入口（panel / enrich / clean / settings）在启动时调用一次。
 *
 * **为什么是轮询而不是事件推送**：WPS 每个任务窗格是独立 WebView，
 * `window.postMessage` 只在同源同进程的 iframe 树内有效，跨任务窗格不会送达，
 * 因此没有可用的跨窗格广播通道 —— 唯一共享媒介是 PluginStorage（只能读，不通知）。
 * 各页只能各自轮询。
 *
 * **自适应间隔**：改动往往成串发生（用户连点 ↑↓ 或连续拖拽），固定间隔会让
 * 中间几次改动被合并、看起来"没反应"。轮询本体在 `tools/config-poll.ts`：空闲 3s、
 * 命中变化后 600ms 快拍 4s，且与主题 / 导航模式 / 模块状态**共用一个定时器**
 * （此前四个模块各一个 2s 定时器 = 5 次 COM 读 / 2s，真机让原生下拉卡顿）。
 *
 * 编辑页自身的响应由 {@link notifyNavOrderChanged} 负责，不走轮询（零延迟）。
 *
 * @param page - 当前页面键
 */
/** 非 DOM 环境（SSR / 测试）下的空退订函数 */
function noopUnsubscribe(): void {
  // 没有订阅，无需退订
}

export function startNavOrderSync(page: string): () => void {
  if (typeof window === 'undefined') return noopUnsubscribe
  // 启动时先应用一次，避免首屏闪回默认顺序
  applyNavOrder(page)
  return subscribeConfigPoll({
    keys: [CONFIG_KEYS.NAV_ORDER],
    apply: () => {
      try {
        applyNavOrder(page)
      } catch {
        // 静默处理偶发读取异常，轮询继续
      }
    },
  })
}
