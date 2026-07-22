/**
 * Ribbon 显式入口模块
 * @module entry/ribbon-entry
 * @description Ribbon（WPS 功能区）的统一启动入口。
 *
 * 职责：
 *  1. 显式调用 initRibbon()，替代原 ribbon.ts 中"模块加载时立即执行 initRibbonMessageListener()"
 *     的副作用链。
 *  2. 仅在浏览器上下文自动启动；被 vitest 等测试环境导入时不会触发副作用。
 *
 * 引入此入口后：
 *  - `import { ... } from '../ribbon.js'` 不再自动注册 window message 监听器
 *  - 测试可在不污染全局事件监听器的前提下导入 ribbon 模块
 */

import { initRibbon } from '../ribbon.js'

/**
 * 启动 Ribbon 模块：注册消息监听器以接收来自侧边栏的配置更新。
 */
export function startRibbon(): void {
  initRibbon()
}

// 仅在浏览器上下文自动启动；通过 typeof window !== 'undefined' 守卫，
// 确保 Node 环境（如单元测试）导入此模块不会触发副作用。
if (typeof window !== 'undefined') {
  startRibbon()
}
