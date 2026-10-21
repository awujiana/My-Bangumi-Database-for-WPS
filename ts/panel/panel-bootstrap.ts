/**
 * @fileoverview Panel 页面启动入口（编译产物位于 dist-ts/panel/panel-bootstrap.js）
 * @module panel/panelBootstrap
 * @description 按依赖顺序加载所有模块并启用按钮；initializePanel/initializeHandlers 由
 *   entry/panel-entry.ts 在导入时（panel.html 上下文）自动触发。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/panel.html 通过
 *   <script type="module" src="./dist-ts/panel/panel-bootstrap.js"> 加载。
 */

// 加载依赖模块（含 panel-entry，其导入时自动启动面板）
import { startPaneHeartbeat } from '../tools/pane-alive.js'
import '../index.js'
import '../core/constants.js'
import '../tools/config.js'
import '../tools/util/index.js'
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
import '../entry/panel-entry.js'
import { installModalA11y } from '../ui/components/modal-a11y.js'
import { initializeShellNav } from './shell-nav.js'
import { installActionButtonsGate } from './action-buttons-gate.js'
import { setupDetachablePanels } from '../ui/components/detachable-panel.js'
import { startModuleStateSync } from '../tools/module-state.js'
import { startNavOrderSync } from '../tools/nav-order.js'

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

installActionButtonsGate('[BGM]')

// ========== 外壳导航（吸顶偏移测量 + 滚动高亮） ==========
// 逻辑已抽到 shell-nav.ts 由三页面共享；此处调用统一初始化。
if (typeof window !== 'undefined') {
  initializeShellNav()
  // 功能模块排序：启动时应用一次 + 轮询跨页同步（设置页改顺序后其它页实时重排）
  startNavOrderSync('panel')
  // 模块折叠 / 隐藏：注入右上角折叠按钮 + 应用状态 + 轮询跨页同步
  startModuleStateSync('panel')
  // 区块拖出为浮动窗口：扫描 [data-detachable]，默认在页面上、点「⧉」才拖出
  // 页面心跳：COM 侧开关面板前校验窗格内容是否真活着（黑屏窗格自愈，见 tools/pane-alive.ts）
  startPaneHeartbeat('panel')
  setupDetachablePanels()
}

// ========== 静态模态框无障碍增强（ESC 关闭 + 焦点陷阱，P2-10） ==========
// 逻辑在 ui/components/modal-a11y.ts；document 不可用时内部直接返回。
installModalA11y()
