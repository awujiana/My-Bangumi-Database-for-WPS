/**
 * 「数据同步」（远程仓库 → Excel）按钮的完整动作
 *
 * @module ui/handlers/remote-sync-action
 * @description 从 action-handlers.ts 抽出的 `syncFromGithub` 处理器（原 284 行，
 *              占那张分发表近 1/5）。它比表里其它条目大一个数量级：要读 4 个表单
 *              控件、拼时间筛选、记冲突策略、走「确认框 → 列映射框 → 真正同步 →
 *              结果弹窗」，夹在一张 40 项的扁平分发表里既难读，也让那个文件失去重点。
 *
 *              抽出后 action-handlers.ts 只留一行接线
 *              （`syncFromGithub: runRemoteSyncAction`），分发表回到「一张索引表」
 *              应有的形态。
 */
/** 与 action-handlers.ts 同形的处理器上下文（未直接复用：那边未导出该接口） */
export interface ActionHandlerContext {
    args: string[];
    startTime: number;
}
export declare function runRemoteSyncAction(context: ActionHandlerContext): void;
//# sourceMappingURL=remote-sync-action.d.ts.map