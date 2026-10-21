/**
 * @fileoverview 导航显示模式跨页同步
 * @module tools/navMode
 * @description WPS 中每个任务窗格是独立 WebView，postMessage 无法跨上下文广播，
 *              因此在 settings 页勾选/取消「导航仅显示图标」后，panel / enrich 页
 *              需定期从 PluginStorage 读取最新配置并切换 body.nav-icons-only 类，
 *              实现「三个页面同时生效」。各页面入口（panel / settings / enrich）
 *              在启动时调用一次。
 */

import { areNavIconsOnly } from './config.js'

/** 应用或移除「图标仅显示」模式；布局变化后触发 resize 让 shell-nav 重测胶囊位置 */
function applyNavMode(isEnabled: boolean): void {
  if (typeof document === 'undefined') return
  const wasEnabled = document.body.classList.contains('nav-icons-only')
  if (wasEnabled === isEnabled) return
  document.body.classList.toggle('nav-icons-only', isEnabled)
  // 导航宽度变化后，滚动高亮胶囊 / 吸顶偏移需按新布局重测
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('resize'))
  }
}

/**
 * 跨页导航模式同步：轮询 PluginStorage 中的「导航仅显示图标」配置，
 * 变化时切换 body.nav-icons-only 类并重测导航布局。
 */
export function startNavModeSync(): void {
  if (typeof window === 'undefined' || typeof setInterval !== 'function') return
  let wasEnabled = areNavIconsOnly(true)
  applyNavMode(wasEnabled)
  const timer = setInterval(() => {
    try {
      const isCurrentlyEnabled = areNavIconsOnly(true)
      if (isCurrentlyEnabled !== wasEnabled) {
        wasEnabled = isCurrentlyEnabled
        applyNavMode(isCurrentlyEnabled)
      }
    } catch {
      // 静默处理偶发读取异常，轮询继续
    }
  }, 2000)
  window.addEventListener(
    'beforeunload',
    () => {
      clearInterval(timer)
    },
    { once: true },
  )
}
