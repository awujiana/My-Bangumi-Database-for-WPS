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
import '../sync/exceltobangumi.js'
import { initializeTheme, startThemeSync } from '../tools/theme.js'
import { initializeShellNav } from './shell-nav.js'
import { setupDetachablePanels } from '../ui/components/detachable-panel.js'
import { startModuleStateSync } from '../tools/module-state.js'
import { startNavOrderSync } from '../tools/nav-order.js'

import { installModalA11y } from '../ui/components/modal-a11y.js'
import { initializeEnrichPage } from './enrich-page.js'
import { installActionButtonsGate } from './action-buttons-gate.js'

if (typeof document !== 'undefined') {
  // 应用外观主题（深色 / 浅色 / 跟随系统）
  initializeTheme()
  // 跨页主题同步：监听其他页面（panel / settings）的主题变更并重应用
  startThemeSync()
  // 跨页导航模式同步：监听「导航仅显示图标」配置变更并切换布局
  startNavModeSync()

  // 外壳导航：吸顶偏移测量（--topbar-h / --nav-h）+ 侧栏滚动高亮
  initializeShellNav()
  // 功能模块排序：启动时应用一次 + 轮询跨页同步（设置页改顺序后其它页实时重排）
  startNavOrderSync('enrich')
  // 模块折叠 / 隐藏：注入右上角折叠按钮 + 应用状态 + 轮询跨页同步
  startModuleStateSync('enrich')
  // 区块拖出为浮动窗口：扫描 [data-detachable]，默认在页面上、点「⧉」才拖出
  setupDetachablePanels()

  // 静态模态框无障碍增强（ESC 关闭 + 焦点陷阱，P2-10）
  installModalA11y()

  installActionButtonsGate('[BGM Enrich]')

  // DOM 就绪后初始化富化页面
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeEnrichPage()
    })
  } else {
    initializeEnrichPage()
  }
}
