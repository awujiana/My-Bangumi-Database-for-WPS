/**
 * @fileoverview 富化页面启动入口（编译产物位于 dist-ts/panel/enrich-bootstrap.js）
 * @module panel/enrichBootstrap
 * @description 绑定富化页面初始化逻辑，在 DOM 就绪后调用 initEnrichPage()，
 *   并在模块就绪前禁用 data-action 按钮、收到 bgm:modulesReady 后启用。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/enrich.html 通过
 *   <script type="module" src="./dist-ts/panel/enrich-bootstrap.js"> 加载。
 *   导入路径相对 ts/ 目录，编译后相对 dist-ts/，运行时正确解析。
 */

import '../index.js'
import '../core/constants.js'
import { startNavModeSync } from '../tools/nav-mode.js'
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
import { initTheme, startThemeSync } from '../tools/theme.js'
import { initShellNav } from './shell-nav.js'
import { startModuleStateSync } from '../tools/module-state.js'
import { startNavOrderSync } from '../tools/nav-order.js'

import { installModalA11y } from '../ui/components/modal-a11y.js'
import { initEnrichPage } from './enrich-page.js'

if (typeof document !== 'undefined') {
  // 应用外观主题（深色 / 浅色 / 跟随系统）
  initTheme()
  // 跨页主题同步：监听其他页面（panel / settings）的主题变更并重应用
  startThemeSync()
  // 跨页导航模式同步：监听「导航仅显示图标」配置变更并切换布局
  startNavModeSync()

  // 外壳导航：吸顶偏移测量（--topbar-h / --nav-h）+ 侧栏滚动高亮
  initShellNav()
  // 功能模块排序：启动时应用一次 + 轮询跨页同步（设置页改顺序后其它页实时重排）
  startNavOrderSync('enrich')
  // 模块折叠 / 隐藏：注入右上角折叠按钮 + 应用状态 + 轮询跨页同步
  startModuleStateSync('enrich')

  // 静态模态框无障碍增强（ESC 关闭 + 焦点陷阱，P2-10）
  installModalA11y()

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
    // eslint-disable-next-line no-console -- console 是日志后端/启动兜底的唯一输出通道（启动日志，logger 初始化前可能执行）
    console.log('[BGM Enrich] 模块加载完成，按钮已启用')
  })

  // DOM 就绪后初始化富化页面
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initEnrichPage()
    })
  } else {
    initEnrichPage()
  }
}
