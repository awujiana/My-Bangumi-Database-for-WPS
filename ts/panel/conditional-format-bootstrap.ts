/**
 * @fileoverview 条件格式管理页面启动入口（编译产物位于 dist-ts/panel/conditional-format-bootstrap.js）
 * @module panel/conditionalFormatBootstrap
 * @description 绑定条件格式管理页面初始化逻辑，在 DOM 就绪后调用 initializeConditionalFormatPage()，
 *   并在模块就绪前禁用 data-action 按钮、收到 bgm:modulesReady 后启用。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/conditional-format.html 通过
 *   <script type="module" src="../dist-ts/panel/conditional-format-bootstrap.js"> 加载。
 */

import { startPaneHeartbeat } from '../tools/pane-alive.js'
import '../index.js'
import '../core/constants.js'
import '../tools/util/index.js'
import '../core/token-payload.js'
import '../tools/events.js'
import '../core/result.js'
import '../tools/wps.js'
import '../ui/dialog.js'
import '../ui/message.js'

import { startNavModeSync } from '../tools/nav-mode.js'
import { setupDetachablePanels } from '../ui/components/detachable-panel.js'
import { startModuleStateSync } from '../tools/module-state.js'
import { startNavOrderSync } from '../tools/nav-order.js'
import { initializeConditionalFormatPage } from './conditional-format-page.js'
import { installActionButtonsGate } from './action-buttons-gate.js'
import { installComStartupFallback, openComGate, runComPhases } from '../tools/com-ready.js'

if (typeof document !== 'undefined') {
  // ---- 零 COM 首屏：以下全部是纯 DOM，绝不碰 Application / PluginStorage ----
  installActionButtonsGate('[BGM ConditionalFormat]')
  // 降级兜底：撞上宿主初始化窗口时插「点此继续初始化」按钮（见 tools/com-ready.ts）
  installComStartupFallback('conditionalFormat')
  setupDetachablePanels()

  // 开闸门：只注册 load / rAF / setTimeout，本身不发任何 COM
  openComGate('conditionalFormat')

  // ---- COM 分片：initializeConditionalFormatPage 里有工作簿/工作表枚举等同步 COM ----
  const startPolling = (): void => {
    startNavModeSync()
    startNavOrderSync('conditional-format')
    startModuleStateSync('conditional-format')
    startPaneHeartbeat('conditionalFormat')
  }
  runComPhases('conditionalFormat', [
    { name: '初始化条件格式页', run: initializeConditionalFormatPage },
    { name: '启动轮询', run: startPolling },
  ])
}
