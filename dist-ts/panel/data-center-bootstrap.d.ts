/**
 * @fileoverview 数据中心页面启动入口（编译产物位于 dist-ts/panel/）
 * @module panel/dataCenterBootstrap
 * @description 与其它页面同构：顶层只做纯 DOM（按钮门禁 / 降级兜底），所有会碰到
 *   COM 的初始化都排进 COM 闸门，避免 WPS 任务窗格启动期与宿主渲染进程互锁。
 *
 * 本文件由 tsc 编译到 dist-ts/panel/，由 ui/data-center.html 以
 *   <script type="module" src="../dist-ts/panel/data-center-bootstrap.js"> 加载。
 */
import '../index.js';
import '../core/constants.js';
import '../tools/events.js';
import '../tools/wps.js';
import '../ui/dialog.js';
//# sourceMappingURL=data-center-bootstrap.d.ts.map