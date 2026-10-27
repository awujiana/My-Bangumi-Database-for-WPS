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
export declare const ACTION_HANDLERS: Record<string, ActionHandler>;
export declare function handleActionClick(event: Event): void;
export {};
//# sourceMappingURL=action-handlers.d.ts.map