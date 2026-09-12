/**
 * @fileoverview 清理页面启动入口（编译产物位于 dist-ts/panel/clean-bootstrap.js）
 * @module panel/cleanBootstrap
 * @description 绑定清理页面初始化逻辑，在 DOM 就绪后调用 initCleanPage()，
 *   并在模块就绪前禁用 data-action 按钮、收到 bgm:modulesReady 后启用。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/clean.html 通过
 *   <script type="module" src="../dist-ts/panel/clean-bootstrap.js"> 加载。
 */

import '../index.js'
import '../core/constants.js'
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

import { startNavModeSync } from '../tools/nav-mode.js'
import { startModuleStateSync } from '../tools/module-state.js'
import { startNavOrderSync } from '../tools/nav-order.js'
import { initCleanPage } from './clean-page.js'

if (typeof document !== 'undefined') {
  // 模块就绪前禁用所有 data-action 按钮，避免误触发未初始化的处理逻辑
  document.querySelectorAll('button[data-action]').forEach((button) => {
    const b = button as HTMLButtonElement
    b.disabled = true
  })

  document.addEventListener('bgm:modulesReady', () => {
    document.querySelectorAll('button[data-action]').forEach((button) => {
      const b = button as HTMLButtonElement
      b.disabled = false
    })
    // eslint-disable-next-line no-console -- 启动兜底阶段日志后端未必就绪，console 是唯一输出通道
    console.log('[BGM Clean] 模块加载完成，按钮已启用')
  })

  // DOM 就绪后初始化清理页面
  const onCleanReady = (): void => {
    initCleanPage()
    // 跨页导航模式同步：设置页勾选「导航仅显示图标」后本页跟随切换
    startNavModeSync()
    // 功能模块排序：启动时应用一次 + 轮询跨页同步（设置页改顺序后其它页实时重排）
    startNavOrderSync('clean')
    // 模块折叠 / 隐藏：注入右上折叠按钮 + 应用状态 + 轮询跨页同步
    startModuleStateSync('clean')
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onCleanReady)
  } else {
    onCleanReady()
  }
}
