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
import { areNavIconsOnly } from '../tools/config.js'
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
import { initTheme } from '../tools/theme.js'
import { initShellNav } from './shell-nav.js'

import { initEnrichPage } from './enrich-page.js'

if (typeof document !== 'undefined') {
  // 应用外观主题（深色 / 浅色 / 跟随系统）
  initTheme()

  // 导航仅图标模式（与 panel / settings 页一致，CSS 由 panel-theme.css 提供）
  if (areNavIconsOnly(true)) {
    document.body.classList.add('nav-icons-only')
  }

  // 外壳导航：吸顶偏移测量（--topbar-h / --nav-h）+ 侧栏滚动高亮
  initShellNav()

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
