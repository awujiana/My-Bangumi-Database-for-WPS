/**
 * @fileoverview 外观主题应用模块
 * @module tools/theme
 * @description 负责将主题配置（深色 / 浅色 / 跟随系统）应用到 <html data-theme>，
 *              并在「跟随系统」模式下监听系统外观变化实时切换。
 *              配置读写复用 tools/config.ts 的 getTheme / setTheme。
 */

import { getTheme, setTheme } from './config.js'
import type { ThemeMode } from './config.js'

export type { ThemeMode }

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
  document.documentElement.setAttribute('data-theme', resolved)
  document.documentElement.style.colorScheme = resolved
}

/**
 * 初始化主题：从配置读取并应用；若为「跟随系统」则监听系统外观变化。
 * 各页面入口（panel / settings / enrich）在启动时调用一次。
 */
export function initTheme(): void {
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
