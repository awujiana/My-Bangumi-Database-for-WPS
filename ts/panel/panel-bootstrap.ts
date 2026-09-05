/**
 * @fileoverview Panel 页面启动入口（编译产物位于 dist-ts/panel/panel-bootstrap.js）
 * @module panel/panelBootstrap
 * @description 按依赖顺序加载所有模块并启用按钮；initPanel/initHandlers 由
 *   entry/panel-entry.ts 在导入时（panel.html 上下文）自动触发。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/panel.html 通过
 *   <script type="module" src="./dist-ts/panel/panel-bootstrap.js"> 加载。
 */

// 加载依赖模块（含 panel-entry，其导入时自动启动面板）
import '../index.js'
import '../core/constants.js'
import '../tools/config.js'
import '../tools/utility.js'
import '../core/crypto.js'
import '../tools/events.js'
import '../core/result.js'
import '../tools/wps.js'
import '../tools/http.js'
import '../ui/dialog.js'
import '../ui/message.js'
import '../ui/preview.js'
import '../sync/sync-record.js'
import '../sync/scraping.js'
import '../sync/exceltobangumi.js'
import '../entry/panel-entry.js'

if (typeof window !== 'undefined') {
  window.addEventListener(
    'error',
    (event: Event) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
        const source =
          target.tagName === 'SCRIPT'
            ? (target as HTMLScriptElement).src
            : (target as HTMLLinkElement).href
        // eslint-disable-next-line no-console -- console 是日志后端/启动兜底的唯一输出通道（资源加载失败兜底日志）
        console.error('[BGM] Resource load failed:', source)
      }
    },
    { capture: true },
  )

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    // eslint-disable-next-line no-console -- 启动兜底阶段日志后端未必就绪，console 是唯一输出通道（与上方资源加载失败日志一致）
    console.error('[BGM] Unhandled promise rejection:', event.reason)
  })
}

if (typeof document !== 'undefined') {
  // 模块就绪前禁用所有 data-action 按钮，避免误触发未初始化的处理逻辑
  document.querySelectorAll('button[data-action]').forEach((button) => {
    const b = button as HTMLButtonElement
    b.disabled = true
  })

  // 接收到 modulesReady 事件后启用按钮
  document.addEventListener('bgm:modulesReady', () => {
    document.querySelectorAll('button[data-action]').forEach((button) => {
      const b = button as HTMLButtonElement

      b.disabled = false
    })
    // eslint-disable-next-line no-console -- 启动兜底阶段日志后端未必就绪，console 是唯一输出通道（与上方资源加载失败日志一致）
    console.log('[BGM] 模块加载完成，按钮已启用')
  })
}

// ========== 吸顶偏移测量 ==========
// 将顶栏实际高度写入 --topbar-h，窄态整个吸顶导航块高度写入 --nav-h，
// 供 CSS 控制 sidebar 吸顶位置与锚点 scroll-padding 偏移补偿。
function updateStickyOffsets(): void {
  const root = document.documentElement
  const topbar = document.querySelector('.topbar')
  const topbarH = topbar ? (topbar as HTMLElement).offsetHeight : 0
  root.style.setProperty('--topbar-h', `${String(topbarH)}px`)
  const isNarrow =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 880px)').matches
  let navH = 0
  if (isNarrow) {
    const sb = document.querySelector('.sidebar')
    navH = sb ? (sb as HTMLElement).offsetHeight : 0
  }
  root.style.setProperty('--nav-h', `${String(navH)}px`)
}

if (typeof window !== 'undefined') {
  updateStickyOffsets()
  window.addEventListener('load', updateStickyOffsets)
  window.addEventListener('resize', updateStickyOffsets)
}
