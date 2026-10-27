/**
 * @fileoverview 条件格式管理页面启动入口（编译产物位于 dist-ts/panel/conditional-format-bootstrap.js）
 * @module panel/conditionalFormatBootstrap
 * @description 绑定条件格式管理页面初始化逻辑，在 DOM 就绪后调用 initializeConditionalFormatPage()，
 *   并在模块就绪前禁用 data-action 按钮、收到 bgm:modulesReady 后启用。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/conditional-format.html 通过
 *   <script type="module" src="../dist-ts/panel/conditional-format-bootstrap.js"> 加载。
 */
import '../index.js';
import '../core/constants.js';
import '../tools/util/index.js';
import '../core/token-payload.js';
import '../tools/events.js';
import '../core/result.js';
import '../tools/wps.js';
import '../ui/dialog.js';
import '../ui/message.js';
//# sourceMappingURL=conditional-format-bootstrap.d.ts.map