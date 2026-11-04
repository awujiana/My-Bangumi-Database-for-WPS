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
import '../index.js';
import '../core/constants.js';
import '../tools/events.js';
import '../tools/wps.js';
import '../ui/dialog.js';
//# sourceMappingURL=plugin-market-bootstrap.d.ts.map