/**
 * @fileoverview 富化页面启动入口（编译产物位于 dist-ts/panel/enrichBootstrap.js）
 * @module panel/enrichBootstrap
 * @description 绑定富化页面初始化逻辑，在 DOM 就绪后调用 initEnrichPage()，
 *   并在模块就绪前禁用 data-action 按钮、收到 bgm:modulesReady 后启用。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/enrich.html 通过
 *   <script type="module" src="./dist-ts/panel/enrichBootstrap.js"> 加载。
 *   导入路径相对 ts/ 目录，编译后相对 dist-ts/，运行时正确解析。
 */

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
import { initTheme } from '../tools/theme.js'

import { initEnrichPage } from './enrichPage.js'

if (typeof document !== 'undefined') {
  // 应用外观主题（深色 / 浅色 / 跟随系统）
  initTheme()

  // 模块就绪前禁用所有 data-action 按钮，避免误触发未初始化的处理逻辑
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
