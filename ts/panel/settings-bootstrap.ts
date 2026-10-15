/**
 * @fileoverview Settings 页面启动入口（编译产物位于 dist-ts/panel/settings-bootstrap.js）
 * @module panel/settingsBootstrap
 * @description 按依赖顺序加载所有模块并启用按钮；startSettings 由
 *   entry/settings-entry.ts 在导入时（settings.html 上下文）自动触发。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/settings.html 通过
 *   <script type="module" src="./dist-ts/panel/settings-bootstrap.js"> 加载。
 */

// 加载依赖模块（含 settings-entry，其导入时自动启动设置页）
import '../index.js'
import '../core/constants.js'
import '../tools/config.js'
import '../tools/utility.js'
import '../core/token-payload.js'
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
import '../entry/settings-entry.js'
import { installModalA11y } from '../ui/components/modal-a11y.js'
import { installActionButtonsGate } from './action-buttons-gate.js'

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
        console.error('[BGM Settings] Resource load failed:', source)
      }
    },
    { capture: true },
  )

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    // eslint-disable-next-line no-console -- 启动兜底阶段日志后端未必就绪，console 是唯一输出通道（与上方资源加载失败日志一致）
    console.error('[BGM Settings] Unhandled promise rejection:', event.reason)
  })
}

if (typeof document !== 'undefined') {
  installActionButtonsGate('[BGM Settings]')

  // ========== 静态模态框无障碍增强（ESC 关闭 + 焦点陷阱，P2-10） ==========
  installModalA11y()
}
