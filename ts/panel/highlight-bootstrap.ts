/**
 * @fileoverview 番剧高亮页面启动入口（编译产物位于 dist-ts/panel/highlight-bootstrap.js）
 * @module panel/highlightBootstrap
 * @description 绑定高亮页面初始化逻辑：首屏零 COM，初始化拆片过「宿主 COM 就绪闸门」，
 *   并在模块就绪前禁用 data-action 按钮、收到 bgm:modulesReady 后启用。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/，由 ui/highlight.html 通过
 *   <script type="module" src="../dist-ts/panel/highlight-bootstrap.js"> 加载。
 *
 * ===== 为什么改成「零 COM 首屏 + 轻量分片」，且数据读取 100% 交给用户点击 =====
 *
 * 新任务窗格打开时，WPS 宿主还在做「渲染进程 attach → COM 桥建好」的初始化；
 * 在这个窗口里从渲染进程**立即发起同步跨进程 COM**（getDataSheet /
 * Worksheet.Range.Read / PluginStorage 读写）会让宿主主线程与渲染进程**互锁死等**，
 * 直到 JSAPI 桥看门狗超时。真机 bisect：
 *   - 只 import highlight-page，不调任何函数        → 秒开
 *   - 调 initializeHighlightPage（3 次轻量 COM）     → 卡 10 秒
 *   - 原版（3 轻 COM + 一次大 Range 读）             → 卡 70 秒
 *   - load 事件 + setTimeout(0) 之后再调             → **仍卡**（离 load 只有几毫秒，
 *     宿主还在等 attach，固定延迟挪不出这个窗口）
 *
 * 所以本文件遵守三条硬约束：
 *   1. **模块执行期零 COM**：这里只做纯 DOM（按钮门禁 / 外壳导航 / 拖出面板 / 兜底 UI）
 *      和「开闸门」（只注册事件，不发 COM）；
 *   2. **初始化只跑轻量 COM**：createHighlightPagePhases() 仅做「恢复配置 + 事件接线」
 *      （配置 / 枚举表名 / 主题），**绝不读单元格数据**；
 *   3. **数据读取交给用户点击**：高亮页的「加载并预览」按钮在宿主早已 attach 之后才
 *      触发重 COM，稀疏同步调用只有几百毫秒，不再撞窗口、也不轮询。
 */

import { startPaneHeartbeat } from '../tools/pane-alive.js'
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
import { setupDetachablePanels } from '../ui/components/detachable-panel.js'
import { startModuleStateSync } from '../tools/module-state.js'
import { startNavOrderSync } from '../tools/nav-order.js'
import { createHighlightPagePhases } from './highlight-page.js'
import { installActionButtonsGate } from './action-buttons-gate.js'
import { initializeShellNav } from './shell-nav.js'
import { installComStartupFallback, openComGate, runComPhases } from '../tools/com-ready.js'

/** 占位分片：createHighlightPagePhases 分片数变化时的兜底（防越界，不该发生） */
const NOOP_PHASE = {
  name: '空分片',
  run: () => {
    // 占位：正常路径下 createHighlightPagePhases 现返回 2 个分片（配置 / 事件接线），
    // 多余的槽位（原「读取工作表」「渲染预览」）已改为用户点击触发，不再自动跑。
  },
}

if (typeof document !== 'undefined') {
  // ---- 零 COM 首屏：以下全部是纯 DOM，绝不碰 Application / PluginStorage ----
  installActionButtonsGate('[BGM Highlight]')
  // 降级兜底：撞上宿主初始化窗口时插「点此继续初始化」按钮
  installComStartupFallback('highlight')
  initializeShellNav()
  setupDetachablePanels()

  // 开闸门：只注册 load / rAF / setTimeout，本身不发任何 COM
  openComGate('highlight')

  // ---- COM 分片：全部排队，闸门开后一片一片跑 ----
  const phases = createHighlightPagePhases()
  // 轮询类（nav-mode / nav-order / module-state / 心跳）都是周期性同步 COM，
  // 也过闸门；放在「读取工作表」之前，避免被重分片挡住
  const startPolling = (): void => {
    startNavModeSync()
    startNavOrderSync('highlight')
    startModuleStateSync('highlight')
    startPaneHeartbeat('highlight')
  }
  runComPhases('highlight', [
    phases[0] ?? NOOP_PHASE,
    phases[1] ?? NOOP_PHASE,
    { name: '启动轮询', run: startPolling },
    phases[2] ?? NOOP_PHASE,
    phases[3] ?? NOOP_PHASE,
  ])
}
