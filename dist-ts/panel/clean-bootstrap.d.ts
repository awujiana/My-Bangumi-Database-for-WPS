/**
 * @fileoverview 清理页面启动入口（编译产物位于 dist-ts/panel/clean-bootstrap.js）
 * @module panel/cleanBootstrap
 * @description 绑定清理页面初始化逻辑，在 DOM 就绪后调用 initializeCleanPage()，
 *   并在模块就绪前禁用 data-action 按钮、收到 bgm:modulesReady 后启用。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/clean.html 通过
 *   <script type="module" src="../dist-ts/panel/clean-bootstrap.js"> 加载。
 */
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
//# sourceMappingURL=clean-bootstrap.d.ts.map