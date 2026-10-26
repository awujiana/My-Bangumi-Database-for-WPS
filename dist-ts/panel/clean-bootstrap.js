/**
 * @fileoverview 清理页面启动入口（编译产物位于 dist-ts/panel/clean-bootstrap.js）
 * @module panel/cleanBootstrap
 * @description 绑定清理页面初始化逻辑，在 DOM 就绪后调用 initializeCleanPage()，
 *   并在模块就绪前禁用 data-action 按钮、收到 bgm:modulesReady 后启用。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/clean.html 通过
 *   <script type="module" src="../dist-ts/panel/clean-bootstrap.js"> 加载。
 */
import { startPaneHeartbeat } from '../tools/pane-alive.js';
import '../index.js';
import '../core/constants.js';
import '../tools/util/index.js';
import '../core/token-payload.js';
import '../tools/events.js';
import '../core/result.js';
import '../tools/wps.js';
import '../tools/http.js';
import '../ui/dialog.js';
import '../ui/message.js';
import '../ui/preview.js';
import '../sync/sync-record.js';
import '../sync/scraping.js';
import '../sync/exceltobangumi/index.js';
import { startNavModeSync } from '../tools/nav-mode.js';
import { setupDetachablePanels } from '../ui/components/detachable-panel.js';
import { startModuleStateSync } from '../tools/module-state.js';
import { startNavOrderSync } from '../tools/nav-order.js';
import { initializeCleanPage } from './clean-page.js';
import { installActionButtonsGate } from './action-buttons-gate.js';
import { installComStartupFallback, openComGate, runComPhases } from '../tools/com-ready.js';
if (typeof document !== 'undefined') {
    // ---- 零 COM 首屏：以下全部是纯 DOM，绝不碰 Application / PluginStorage ----
    installActionButtonsGate('[BGM Clean]');
    // 降级兜底：撞上宿主初始化窗口时插「点此继续初始化」按钮（见 tools/com-ready.ts）
    installComStartupFallback('clean');
    setupDetachablePanels();
    // 开闸门：只注册 load / rAF / setTimeout，本身不发任何 COM
    openComGate('clean');
    // ---- COM 分片：initializeCleanPage 里有 getDataSheet / Range 读等同步 COM ----
    const startPolling = () => {
        startNavModeSync();
        startNavOrderSync('clean');
        startModuleStateSync('clean');
        startPaneHeartbeat('clean');
    };
    runComPhases('clean', [
        { name: '初始化清理页', run: initializeCleanPage },
        { name: '启动轮询', run: startPolling },
    ]);
}
