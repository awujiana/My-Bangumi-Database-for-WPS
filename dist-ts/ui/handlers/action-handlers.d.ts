/**
 * 面板按钮操作分发表
 * @module ui/handlers/action-handlers
 * @description 从 handlers/index.ts 抽出：`handleActionClick` 的事件解析 + `ACTION_HANDLERS`
 *              大表（按 data-action 分发到各业务入口），以及同步指标纯函数。
 */
interface ActionHandlerContext {
    args: string[];
    startTime: number;
}
type ActionHandler = (context: ActionHandlerContext) => void;
/**
 * 把「使用引导」按钮的文案同步成详情区的当前状态
 *
 * 这个按钮**不能挂 `data-i18n`**：文案是状态（展开 / 收起），挂静态 key 会让
 * `applyI18n()` 在切语言时把已经展开的按钮写回「显示详细操作」，下次点击就反了。
 * 但初始化时必须写一次——否则英文界面首屏一直是 HTML 里的中文初始值，
 * 直到用户点过这个按钮才会变（`toggleUsageGuide` 原来只在点击时设文案）。
 */
export declare function syncUsageGuideButton(): void;
export declare const ACTION_HANDLERS: Record<string, ActionHandler>;
export declare function handleActionClick(event: Event): void;
export {};
//# sourceMappingURL=action-handlers.d.ts.map