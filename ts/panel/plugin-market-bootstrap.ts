/**
 * @fileoverview 插件市场页面启动入口（编译产物位于 dist-ts/panel/）
 * @module panel/pluginMarketBootstrap
 * @description 与其它页面同构：顶层只做纯 DOM（按钮门禁 / 降级兜底），所有会碰到
 *   COM 的初始化（`PluginStorage` 读索引、载入已装插件、心跳）都排进 COM 闸门。
 *   WPS 任务窗格在「新窗格打开 → COM 桥建好」之间有一段初始化窗口，窗口里发同步
 *   COM 会让宿主与渲染进程互锁（真机实测卡 10~70 秒），背景见 `tools/com-ready.ts`。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/plugin-market.html 通过
 *   <script type="module" src="../dist-ts/panel/plugin-market-bootstrap.js"> 加载。
 */

import { startPaneHeartbeat } from '../tools/pane-alive.js'
import '../index.js'
import '../core/constants.js'
import { markPluginMarketPaneLoaded } from '../tools/util/index.js'
import '../tools/events.js'
import '../tools/wps.js'
import '../ui/dialog.js'

import { installActionButtonsGate, notifyModulesReady } from './action-buttons-gate.js'
import { initializePluginMarketPage } from './plugin-market-page.js'
import { installComStartupFallback, openComGate, runComPhases } from '../tools/com-ready.js'

/** 初始化失败时落一行可见提示（不吞掉，也不把整页变成空白） */
function showBootFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const target = document.getElementById('pluginSourceMessage')
  if (target !== null) {
    target.textContent = `页面初始化失败：${message}`
    target.dataset.level = 'error'
  }
}

if (typeof document !== 'undefined') {
  // ---- 零 COM 首屏：以下全是纯 DOM，绝不碰 Application / PluginStorage ----
  installActionButtonsGate('[BGM PluginMarket]')
  installComStartupFallback('plugin-market')

  // 开闸门：只注册 load / rAF / setTimeout，本身不发任何 COM
  openComGate('plugin-market')

  // ---- COM 分片：插件索引、已装插件载入与窗格标记都要读 PluginStorage ----
  runComPhases('plugin-market', [
    {
      name: '初始化插件市场页',
      run: () => {
        try {
          initializePluginMarketPage()
          notifyModulesReady()
        } catch (error: unknown) {
          showBootFailure(error)
        }
      },
    },
    {
      name: '标记窗格并启动心跳',
      run: () => {
        markPluginMarketPaneLoaded()
        startPaneHeartbeat('plugin-market')
      },
    },
  ])
}
