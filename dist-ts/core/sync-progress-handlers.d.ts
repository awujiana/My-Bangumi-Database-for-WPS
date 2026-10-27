/**
 * 同步进度弹窗的「暂停 / 恢复 / 停止」三键 handlers（零依赖叶子模块）。
 *
 * @module core/sync-progress-handlers
 * @description
 * 收敛 `showSyncProgressDialog` / `getSyncProgressApi().show()` 调用处逐字重复的
 * handlers 对象（旧态：5 处 `BGM.sync.pause/resume/requestStop` 委托逐字相同 +
 * 1 处空实现变体，散落在 `ui/handlers/sync.ts`、`ui/preview.ts`、
 * `sync/exceltobangumi/index.ts`）。
 *
 * **为何是叶子模块而不是挂到 `BGM.sync` 上**（§5.6 C1 评估记录）：
 * ① 多个测试用 `{ sync: { pause, resume, requestStop } }` 精简桩，把工厂挂到
 * `BGM.sync` 上会让桩缺方法直接 TypeError；② 各调用方文件对 util barrel 的
 * mock 口径不一（`preview.test.ts` 压根没 mock 它），经 barrel 导入会把真实重
 * 模块拉进测试。叶子模块依赖注入（调用方传入自己依赖路径上的 `BGM.sync`），
 * 两个坑同时绕开。
 */
/** 同步进度弹窗的三键回调集合（`showSyncProgressDialog` 等入口的入参形状） */
export interface SyncProgressHandlers {
    /** 点击暂停 */
    onPause: () => void;
    /** 点击恢复 */
    onResume: () => void;
    /** 请求停止 */
    onStop: () => void;
}
/** `BGM.sync` 状态机的最小形状（工厂只依赖这三个方法，便于测试注入） */
export interface SyncStateMachine {
    pause(): void;
    resume(): void;
    requestStop(): void;
}
/**
 * 标准三键：暂停 / 恢复 / 停止委托 `BGM.sync` 状态机。
 * 适用于「正在同步 - XXX」这类真正可暂停 / 可停止的同步流程。
 */
export declare function createSyncControlHandlers(sync: SyncStateMachine): SyncProgressHandlers;
/**
 * 无操作三键：仅展示进度、不提供控制的弹窗（如「Token 未设置」提示）。
 * 保留三键占位以便入口签名统一，点击不产生任何行为。
 */
export declare function createNoopSyncHandlers(): SyncProgressHandlers;
//# sourceMappingURL=sync-progress-handlers.d.ts.map