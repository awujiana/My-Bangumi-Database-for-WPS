/**
 * Panel 显式入口模块
 * @module entry/panel-entry
 * @description 面板的统一启动入口。
 *
 * 职责：
 *  1. 显式调用 initializePanel() / initializeHandlers()，替代原 panel/index.ts 与
 *     ui/handlers/index.ts 中"模块加载时自动注册 DOMContentLoaded"的副作用链。
 *  2. 仅在浏览器上下文且当前页面为 panel.html 时自动启动；
 *     被 vitest 等测试环境导入时不会触发副作用。
 *
 * 引入此入口后：
 *  - `import { initializePanel } from '../panel/panel-page.js'` 不再产生 DOM 操作副作用
 *  - `import { initializeHandlers } from '../ui/handlers/index.js'` 不再触发 trackedSetTimeout
 *  - 测试可在不污染 DOM / 全局状态的前提下导入源码
 */

import { initializePanel } from '../panel/panel-page.js'
import { initializeTheme, startThemeSync } from '../tools/theme.js'
import { startNavModeSync } from '../tools/nav-mode.js'
import { initializeHandlers } from '../ui/handlers/index.js'

/**
 * 启动面板：依次执行面板初始化与 UI 事件处理初始化。
 *
 * - 先调用 initializePanel() 触发面板初始化（工作表锁定、用户信息轮询、Token 状态等）
 * - 再调用 initializeHandlers() 注册按钮监听器、消息监听器、事件总线监听器
 */
export function startPanel(): void {
  initializeTheme()
  // 跨页主题同步：监听其他页面（settings / enrich）的主题变更并重应用
  startThemeSync()
  // 跨页导航模式同步：监听「导航仅显示图标」配置变更并切换布局
  startNavModeSync()
  initializePanel()
  initializeHandlers()
}

// 仅在浏览器上下文且当前页面为 panel.html 时自动启动；
// 通过 typeof window !== 'undefined' 守卫，确保 Node 环境（如部分单元测试）导入此模块不会触发副作用。
if (typeof window !== 'undefined' && window.location.pathname.includes('panel.html')) {
  startPanel()
}
