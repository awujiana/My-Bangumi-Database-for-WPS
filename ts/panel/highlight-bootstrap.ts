/**
 * @fileoverview 番剧高亮页面启动入口（编译产物位于 dist-ts/panel/highlight-bootstrap.js）
 * @module panel/highlightBootstrap
 * @description 绑定高亮页面初始化逻辑，在 DOM 就绪后调用 initHighlightPage()，
 *   并在模块就绪前禁用 data-action 按钮、收到 bgm:modulesReady 后启用。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/highlight.html 通过
 *   <script type="module" src="../dist-ts/panel/highlight-bootstrap.js"> 加载。
 */

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
import { startModuleStateSync } from '../tools/module-state.js'
import { startNavOrderSync } from '../tools/nav-order.js'
import { initHighlightPage } from './highlight-page.js'
import { installActionButtonsGate } from './action-buttons-gate.js'

if (typeof document !== 'undefined') {
  installActionButtonsGate('[BGM Highlight]')

  // DOM 就绪后初始化高亮页面
  const onHighlightReady = (): void => {
    initHighlightPage()
    // 跨页导航模式同步：设置页勾选「导航仅显示图标」后本页跟随切换
    startNavModeSync()
    // 功能模块排序：启动时应用一次 + 轮询跨页同步（设置页改顺序后其它页实时重排）
    startNavOrderSync('highlight')
    // 模块折叠 / 隐藏：注入右上折叠按钮 + 应用状态 + 轮询跨页同步
    startModuleStateSync('highlight')
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onHighlightReady)
  } else {
    onHighlightReady()
  }
}
