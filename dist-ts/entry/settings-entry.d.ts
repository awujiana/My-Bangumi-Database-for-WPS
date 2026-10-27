/**
 * Settings 显式入口模块
 * @module entry/settings-entry
 * @description 设置面板的统一启动入口。
 *
 * 职责：
 *  1. 显式调用 initializeHandlers()，复用已有的事件处理逻辑。
 *  2. 调用 initializeSettingsPage() 加载已保存的配置到表单。
 *  3. 仅在浏览器上下文且当前页面为 settings.html 时自动启动。
 */
/**
 * 启动设置面板：执行 UI 事件处理初始化 + 设置页面初始化。
 * 完成后触发 bgm:modulesReady 事件，通知 panel/settingsBootstrap 入口启用按钮。
 */
export declare function startSettings(): void;
//# sourceMappingURL=settings-entry.d.ts.map