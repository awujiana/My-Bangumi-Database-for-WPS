/**
 * Panel 显式入口模块
 * @module entry/panel-entry
 * @description 面板的统一启动入口。
 *
 * 职责：
 *  1. 显式调用 initPanel() / initHandlers()，替代原 panel/index.ts 与
 *     ui/handlers/index.ts 中"模块加载时自动注册 DOMContentLoaded"的副作用链。
 *  2. 仅在浏览器上下文且当前页面为 panel.html 时自动启动；
 *     被 vitest 等测试环境导入时不会触发副作用。
 *
 * 引入此入口后：
 *  - `import { initPanel } from '../panel/panelPage.js'` 不再产生 DOM 操作副作用
 *  - `import { initHandlers } from '../ui/handlers/index.js'` 不再触发 trackedSetTimeout
 *  - 测试可在不污染 DOM / 全局状态的前提下导入源码
 */
import { initPanel } from '../panel/panelPage.js';
import { initHandlers } from '../ui/handlers/index.js';
/**
 * 启动面板：依次执行面板初始化与 UI 事件处理初始化。
 *
 * - 先调用 initPanel() 触发面板初始化（工作表锁定、用户信息轮询、Token 状态等）
 * - 再调用 initHandlers() 注册按钮监听器、消息监听器、事件总线监听器
 */
export function startPanel() {
    initPanel();
    initHandlers();
}
// 仅在浏览器上下文且当前页面为 panel.html 时自动启动；
// 通过 typeof window !== 'undefined' 守卫，确保 Node 环境（如部分单元测试）导入此模块不会触发副作用。
if (typeof window !== 'undefined' && window.location.pathname.includes('panel.html')) {
    startPanel();
}
