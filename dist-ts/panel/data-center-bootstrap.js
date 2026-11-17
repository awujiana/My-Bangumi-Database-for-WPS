/**
 * @fileoverview 数据中心页面启动入口（编译产物位于 dist-ts/panel/）
 * @module panel/dataCenterBootstrap
 * @description 与其它页面同构：顶层只做纯 DOM（按钮门禁 / 降级兜底），所有会碰到
 *   COM 的初始化都排进 COM 闸门，避免 WPS 任务窗格启动期与宿主渲染进程互锁。
 *
 * 本文件由 tsc 编译到 dist-ts/panel/，由 ui/data-center.html 以
 *   <script type="module" src="../dist-ts/panel/data-center-bootstrap.js"> 加载。
 */
import { startPaneHeartbeat } from '../tools/pane-alive.js';
import '../index.js';
import '../core/constants.js';
import { markDataCenterPaneLoaded } from '../tools/util/index.js';
import '../tools/events.js';
import '../tools/wps.js';
import '../ui/dialog.js';
import { installActionButtonsGate, notifyModulesReady } from './action-buttons-gate.js';
import { initializeDataCenterPage } from './data-center-page.js';
import { installComStartupFallback, openComGate, runComPhases } from '../tools/com-ready.js';
/** 初始化失败时落一行可见提示，不吞错误也不把整页变空白 */
function showBootFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    const target = document.getElementById('dcUpdateStatus');
    if (target !== null) {
        target.textContent = `页面初始化失败：${message}`;
        target.dataset.level = 'error';
    }
}
if (typeof document !== 'undefined') {
    installActionButtonsGate('[BGM DataCenter]');
    installComStartupFallback('data-center');
    openComGate('data-center');
    runComPhases('data-center', [
        {
            name: '初始化数据中心页',
            run: () => {
                try {
                    initializeDataCenterPage();
                    notifyModulesReady();
                }
                catch (error) {
                    showBootFailure(error);
                }
            },
        },
        {
            name: '标记窗格并启动心跳',
            run: () => {
                markDataCenterPaneLoaded();
                startPaneHeartbeat('data-center');
            },
        },
    ]);
}
