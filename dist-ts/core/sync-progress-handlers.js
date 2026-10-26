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
/**
 * 标准三键：暂停 / 恢复 / 停止委托 `BGM.sync` 状态机。
 * 适用于「正在同步 - XXX」这类真正可暂停 / 可停止的同步流程。
 */
export function createSyncControlHandlers(sync) {
    return {
        onPause: () => {
            sync.pause();
        },
        onResume: () => {
            sync.resume();
        },
        onStop: () => {
            sync.requestStop();
        },
    };
}
/**
 * 无操作三键：仅展示进度、不提供控制的弹窗（如「Token 未设置」提示）。
 * 保留三键占位以便入口签名统一，点击不产生任何行为。
 */
export function createNoopSyncHandlers() {
    return {
        onPause: () => {
            /* 无操作 */
        },
        onResume: () => {
            /* 无操作 */
        },
        onStop: () => {
            /* 无操作 */
        },
    };
}
