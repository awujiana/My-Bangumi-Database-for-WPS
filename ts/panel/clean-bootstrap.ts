/**
 * @fileoverview 清理页面启动入口（编译产物位于 dist-ts/panel/clean-bootstrap.js）
 * @module panel/cleanBootstrap
 * @description 绑定清理页面初始化逻辑，在 DOM 就绪后调用 initializeCleanPage()，
 *   并在模块就绪前禁用 data-action 按钮、收到 bgm:modulesReady 后启用。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/clean.html 通过
 *   <script type="module" src="../dist-ts/panel/clean-bootstrap.js"> 加载。
 */

import '../index.js'
import '../core/constants.js'
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

import { startNavModeSync } from '../tools/nav-mode.js'
import { startModuleStateSync } from '../tools/module-state.js'
import { startNavOrderSync } from '../tools/nav-order.js'
import { initializeCleanPage } from './clean-page.js'
import { installActionButtonsGate } from './action-buttons-gate.js'

if (typeof document !== 'undefined') {
  installActionButtonsGate('[BGM Clean]')

  // DOM 就绪后初始化清理页面
  const onCleanReady = (): void => {
    initializeCleanPage()
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
