/**
 * @fileoverview 任务窗格 viewport 自愈：窗格被拖宽后页面仍按旧宽度布局的修复
 *
 * 背景（真机截图：内容挤在窗格左侧一条，右侧大片黑色画布）：
 * WPS 任务窗格的 WebView 在**宽度变化**（用户拖动窗格边缘）后，部分 CEF 内核
 * 不会重新计算 layout viewport —— 页面仍按加载时的旧宽度排版（媒体查询、
 * `clientWidth` 全是旧值），新空出来的区域露出 html 画布底色（深色主题下是黑的）。
 *
 * 判别特征：`window.innerWidth`（窗口实际 CSS 宽）明显大于
 * `document.documentElement.clientWidth`（layout viewport 宽）。
 *
 * 修法：检测到偏差超过容差时，改写 `<meta name="viewport">` 的 `width` 强制
 * Chromium 重算 layout viewport —— 这是移动端 WebView 适配的标准手段；
 * 若宿主内核不理会 meta 改写，本脚本就是无害空转（多一次 setAttribute）。
 *
 * ⚠ 为什么是独立文件：各页 CSP `script-src 'self'` 禁内联；本文件同源静态资源，
 * 走 `libs/` 由 vite 复制到 `dist/libs/`，与 wps-sdk-loader.js 同款引入方式。
 */

;(function fitViewport() {
  if (typeof window === 'undefined') return
  var meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return

  /** 容差：小于 24px 的偏差可能是滚动条宽度，强改反而抖动 */
  var TOLERANCE = 24
  /** 上次已应用的 width，避免每秒重写同一个值 */
  var lastAppliedWidth = 0

  function fit() {
    var target = Math.round(window.innerWidth)
    var current = document.documentElement.clientWidth
    if (!target || !current) return
    if (Math.abs(target - current) < TOLERANCE) return
    if (target === lastAppliedWidth) return
    lastAppliedWidth = target
    meta.setAttribute('content', 'width=' + String(target) + ', initial-scale=1')
  }

  window.addEventListener('resize', fit)
  // resize 事件在某些宿主内核里拖宽时也不派发 —— 1s 轮询兜底（成本可忽略）
  window.setInterval(fit, 1000)
  fit()
})()
