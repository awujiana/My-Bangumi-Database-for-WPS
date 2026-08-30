/**
 * @fileoverview Settings 页面启动入口（编译产物位于 dist-ts/panel/settingsBootstrap.js）
 * @module panel/settingsBootstrap
 * @description 按依赖顺序加载所有模块并启用按钮；startSettings 由
 *   entry/settings-entry.ts 在导入时（settings.html 上下文）自动触发。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/settings.html 通过
 *   <script type="module" src="./dist-ts/panel/settingsBootstrap.js"> 加载。
 */

if (typeof window !== 'undefined') {
  window.addEventListener(
    'error',
    (e: Event) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
        const src =
          target.tagName === 'SCRIPT'
            ? (target as HTMLScriptElement).src
            : (target as HTMLLinkElement).href
        console.error('[BGM Settings] Resource load failed:', src)
      }
    },
    true,
  )

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    console.error('[BGM Settings] Unhandled promise rejection:', e.reason)
  })
}

// 加载依赖模块（含 settings-entry，其导入时自动启动设置页）
import '../index.js'
import '../core/constants.js'
import '../tools/config.js'
import '../tools/util.js'
import '../core/crypto.js'
import '../tools/events.js'
import '../core/result.js'
import '../tools/wps.js'
import '../tools/http.js'
import '../ui/dialog.js'
import '../ui/message.js'
import '../ui/preview.js'
import '../sync/syncRecord.js'
import '../sync/scraping.js'
import '../sync/exceltobangumi.js'
import '../entry/settings-entry.js'

if (typeof document !== 'undefined') {
  // 模块就绪前禁用所有 data-action 按钮
  document.querySelectorAll('button[data-action]').forEach((btn) => {
    const b = btn as HTMLButtonElement
    b.disabled = true
  })

  // 接收到 modulesReady 事件后启用按钮
  document.addEventListener('bgm:modulesReady', () => {
    document.querySelectorAll('button[data-action]').forEach((btn) => {
      const b = btn as HTMLButtonElement
      b.disabled = false
    })
    console.log('[BGM Settings] 模块加载完成，按钮已启用')
  })

  // 超时兜底：如果 5 秒后仍未收到 bgm:modulesReady，输出 WARN 日志并强制启用按钮
  const timeoutMs = 5000
  let forced = false
  document.addEventListener('bgm:modulesReady', () => {
    forced = true
  })
  setTimeout(() => {
    if (!forced) {
      console.warn(
        `[BGM Settings] ${timeoutMs}ms 内未收到 bgm:modulesReady 事件，强制启用按钮（兜底）`,
      )
      document.querySelectorAll('button[data-action]').forEach((btn) => {
        const b = btn as HTMLButtonElement
        b.disabled = false
      })
    }
  }, timeoutMs)
}
