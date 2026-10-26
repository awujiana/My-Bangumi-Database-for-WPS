/**
 * @fileoverview 赞赏页启动入口（编译产物位于 dist-ts/panel/donate-bootstrap.js）
 * @module panel/donateBootstrap
 * @description 赞赏页是纯展示页：只做「应用主题 + 起页面心跳」，不读工作表、
 *   不碰任何业务 COM。宿主初始化窗口内同步 COM 会互锁，故两步都过 COM 闸门。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/，由 ui/donate.html 通过
 *   <script type="module" src="../dist-ts/panel/donate-bootstrap.js"> 加载。
 */

import { startPaneHeartbeat } from '../tools/pane-alive.js'
import '../index.js'
import '../core/constants.js'
import { markDonatePaneLoaded } from '../tools/util/index.js'
import '../tools/events.js'
import '../core/result.js'
import '../tools/wps.js'
import '../ui/dialog.js'

import { initializeTheme } from '../tools/theme.js'
import { installComStartupFallback, openComGate, runComPhases } from '../tools/com-ready.js'

if (typeof document !== 'undefined') {
  // 降级兜底：撞上宿主初始化窗口时插「点此继续初始化」按钮
  installComStartupFallback('donate')

  // 开闸门：只注册 load / rAF / setTimeout，本身不发任何 COM
  openComGate('donate')

  runComPhases('donate', [
    {
      name: '应用主题',
      run: () => {
        initializeTheme()
        // 标记页面已成功加载：下次开窗复用同一窗格，而不是走「URL 未标记」自愈重建
        markDonatePaneLoaded()
      },
    },
    {
      name: '启动心跳',
      run: () => {
        startPaneHeartbeat('donate')
      },
    },
  ])
}
