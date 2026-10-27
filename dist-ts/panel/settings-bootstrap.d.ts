/**
 * @fileoverview Settings 页面启动入口（编译产物位于 dist-ts/panel/settings-bootstrap.js）
 * @module panel/settingsBootstrap
 * @description 按依赖顺序加载所有模块并启用按钮；startSettings 由
 *   entry/settings-entry.ts 在导入时（settings.html 上下文）自动触发。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/panel/，由 ui/settings.html 通过
 *   <script type="module" src="./dist-ts/panel/settings-bootstrap.js"> 加载。
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
import '../entry/settings-entry.js';
//# sourceMappingURL=settings-bootstrap.d.ts.map