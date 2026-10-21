/**
 * @fileoverview `wpsjsrpcsdk.js` 的条件加载器（只在**非加载项环境**才加载它）
 *
 * 背景（真机「右侧黑窗格 + 零日志」的根因候选）：
 * `wpsjsrpcsdk.js` 是 wpsjs 脚手架产物，为「用浏览器打开并唤起 WPS」这条链路服务：
 * 它启动后向 **WPS 客户端本地服务** `http://127.0.0.1:58890` / `ws://127.0.0.1:58892`
 * 探测 `/version`（端口在 rpcsdk 源码里硬编码）。
 *
 * 在 **WPS 加载项（jsplugin）环境**里这条链路用不上 —— 宿主已经把
 * `window.Application` 直接注入到页面（本项目 `getApp()` 读的就是它）。加载 rpcsdk
 * 的代价却是真实的：
 *   1. 探测连不上（真机日志：`ws://127.0.0.1:58892/version ... ERR_CONNECTION_REFUSED`）；
 *   2. rpcsdk 的 `onerror` 会按 `tryCount` 重试（源码 `startWpsInnderWebsocket`：
 *      `setTimeout(() => startWpsInnderWebsocket(tryCount - 1), 1000)`）；
 *   3. 重试耗尽后会走 `InitWpsCloudSvr()` —— 另开一个 WebView 传参。
 *      那一块 WebView 里没有我们的代码，于是表现为「多出一块黑窗格、且没有任何
 *      控制台日志」（日志在它自己的上下文里，任务窗格的调试器看不到）。
 *
 * 做法：加载项环境（已能拿到 `window.Application`）**根本不加载 rpcsdk**；
 * 只有在浏览器直接打开（`Application` 不存在）时才动态插入，保留调试能力。
 *
 * ⚠ 为什么用独立文件而不是内联脚本：各页 CSP 是 `script-src 'self'`（禁内联），
 * 内联 loader 会被拦；本文件是同源静态资源，走 `libs/` 由 vite 复制到 `dist/libs/`。
 */

;(function loadWpsSdkWhenNeeded() {
  // 加载项环境：宿主已注入 Application → 不需要 rpcsdk，直接返回（关键分支）
  if (typeof window !== 'undefined' && window.Application) return

  var script = document.createElement('script')
  // 本文件位于 /libs/ 下，向上一级即项目根（与页面里 ../wpsjsrpcsdk.js 同一目标）
  script.src = '../wpsjsrpcsdk.js'
  document.head.appendChild(script)
})()
