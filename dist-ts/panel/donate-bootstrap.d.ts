/**
 * @fileoverview 赞赏页启动入口（编译产物位于 dist-ts/panel/donate-bootstrap.js）
 * @module panel/donateBootstrap
 * @description 赞赏页是纯展示页：只做「应用主题 + 起页面心跳」，不读工作表、
 *   不碰任何业务 COM。宿主初始化窗口内同步 COM 会互锁，故两步都过 COM 闸门。
 *
 * 注意：本文件由 tsc 编译至 dist-ts/，由 ui/donate.html 通过
 *   <script type="module" src="../dist-ts/panel/donate-bootstrap.js"> 加载。
 */
import '../index.js';
import '../core/constants.js';
import '../tools/events.js';
import '../core/result.js';
import '../tools/wps.js';
//# sourceMappingURL=donate-bootstrap.d.ts.map