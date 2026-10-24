/**
 * @fileoverview 外观主题应用模块
 * @module tools/theme
 * @description 负责将主题配置（深色 / 浅色 / 跟随系统）应用到 <html data-theme>，
 *              并在「跟随系统」模式下监听系统外观变化实时切换。
 *              配置读写复用 tools/config.ts 的 getTheme / setTheme。
 */

import { CONFIG_KEYS, getTheme, setTheme } from './config.js'
import type { ThemeMode } from './config.js'
import { subscribeConfigPoll } from './config-poll.js'

const systemMedia =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null

/**
 * 解析最终主题：system 模式按系统外观解析为 light / dark。
 */
export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') return systemMedia?.matches ? 'light' : 'dark'
  return mode
}

/**
 * 将主题应用到 <html> 元素（data-theme 属性 + color-scheme）。
 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  const resolved = resolveTheme(mode)
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

/**
 * 初始化主题：从配置读取并应用；若为「跟随系统」则监听系统外观变化。
 * 各页面入口（panel / settings / enrich）在启动时调用一次。
 */
export function initializeTheme(): void {
  const mode = getTheme(true)
  applyTheme(mode)
  systemMedia?.addEventListener('change', () => {
    if (getTheme(true) === 'system') applyTheme('system')
  })
}

/**
 * 保存主题并立即应用。
 * @returns 是否保存成功
 */
export function saveTheme(mode: string): boolean {
  if (mode !== 'dark' && mode !== 'light' && mode !== 'system') return false
  const isOk = setTheme(mode)
  if (isOk) applyTheme(mode)
  return isOk
}

/**
 * 跨页主题同步：订阅共享配置轮询，主题变化时重新应用。
 *
 * WPS 中每个任务窗格是独立 WebView，postMessage 无法跨上下文广播，
 * 因此在 settings 页切换主题后，panel / enrich 页需定期从 PluginStorage
 * 读取最新主题并 `applyTheme`，实现「所有页面同时变色」。
 * 各页面入口（panel / settings / enrich）在启动时调用一次。
 *
 * 轮询本体在 `tools/config-poll.ts`（单定时器 + 键去重 + 隐藏跳过 + 原生下拉
 * 交互让路）——此前这里自带 2s `setInterval`，与另外三个同步模块叠加成
 * 「5 次 COM 读 / 2s、每 400ms 一次微卡顿」，真机上让原生 `<select>` 下拉卡顿。
 */
/** 非 DOM 环境（SSR / 测试）下的空退订函数 */
function noopUnsubscribe(): void {
  // 没有订阅，无需退订
}

export function startThemeSync(): () => void {
  if (typeof window === 'undefined') return noopUnsubscribe
  let lastApplied = resolveTheme(getTheme(true))
  return subscribeConfigPoll({
    keys: [CONFIG_KEYS.THEME],
    apply: () => {
      try {
        // system 模式下 resolveTheme 会随系统外观变化，因此比较解析值即可同时捕获
        // 配置变更与系统外观切换，变化时才重应用样式。
        const mode = getTheme(true)
        const resolved = resolveTheme(mode)
        if (resolved !== lastApplied) {
          lastApplied = resolved
          applyTheme(mode)
        }
      } catch {
        // 静默处理偶发读取异常，轮询继续
      }
    },
  })
}

export { type ThemeMode } from './config.js'
