/**
 * @fileoverview 富化页面启动入口（编译产物位于 dist-ts/panel/enrich-bootstrap.js）
 * @module panel/enrichBootstrap
 * @description 绑定富化页面初始化逻辑，在 DOM 就绪后调用 initializeEnrichPage()，
 *   并在模块就绪前禁用 data-action 按钮、收到 bgm:modulesReady 后启用。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/enrich.html 通过
 *   <script type="module" src="./dist-ts/panel/enrich-bootstrap.js"> 加载。
 *   导入路径相对 ts/ 目录，编译后相对 dist-ts/，运行时正确解析。
 */

import { startPaneHeartbeat } from '../tools/pane-alive.js'
import '../index.js'
import '../core/constants.js'
import { startNavModeSync } from '../tools/nav-mode.js'
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
import '../sync/exceltobangumi/index.js'
import { initializeTheme, startThemeSync } from '../tools/theme.js'
import { initializeShellNav } from './shell-nav.js'
import { setupDetachablePanels } from '../ui/components/detachable-panel.js'
import { startModuleStateSync } from '../tools/module-state.js'
import { startNavOrderSync } from '../tools/nav-order.js'

import { installModalA11y } from '../ui/components/modal-a11y.js'
import { initializeEnrichPage } from './enrich-page.js'
import { installActionButtonsGate } from './action-buttons-gate.js'
import { installComStartupFallback, openComGate, runComPhases } from '../tools/com-ready.js'

if (typeof document !== 'undefined') {
  // ---- 零 COM 首屏：以下全部是纯 DOM，绝不碰 Application / PluginStorage ----
  installActionButtonsGate('[BGM Enrich]')
  // 降级兜底：撞上宿主初始化窗口时插「点此继续初始化」按钮（见 tools/com-ready.ts）
  installComStartupFallback('enrich')
  initializeShellNav()
  setupDetachablePanels()
  installModalA11y()

  // 开闸门：只注册 load / rAF / setTimeout，本身不发任何 COM
  openComGate('enrich')

  // ---- COM 分片：initializeEnrichPage 里有工作簿枚举 / 表头识别等同步 COM ----
  const startPolling = (): void => {
    startNavModeSync()
    startNavOrderSync('enrich')
    startModuleStateSync('enrich')
    startPaneHeartbeat('enrich')
  }
  runComPhases('enrich', [
    {
      name: '主题与导航',
      run: () => {
        initializeTheme()
        startThemeSync()
      },
    },
    { name: '初始化富化页', run: initializeEnrichPage },
    { name: '启动轮询', run: startPolling },
  ])
}
