/**
 * @fileoverview Panel 页面启动入口（编译产物位于 dist-ts/panel/panel-bootstrap.js）
 * @module panel/panelBootstrap
 * @description 按依赖顺序加载所有模块并启用按钮；initializePanel/initializeHandlers 由
 *   entry/panel-entry.ts 在导入时（panel.html 上下文）自动触发。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/panel.html 通过
 *   <script type="module" src="./dist-ts/panel/panel-bootstrap.js"> 加载。
 */
import '../index.js';
import '../core/constants.js';
import '../tools/config.js';
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
import '../entry/panel-entry.js';
//# sourceMappingURL=panel-bootstrap.d.ts.map