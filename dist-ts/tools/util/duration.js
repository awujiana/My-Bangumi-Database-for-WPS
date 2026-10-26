/**
 * 耗时格式化（毫秒 → 可读字符串）
 * @module tools/util/duration
 * @description
 * 全项目**唯一**的 `formatDuration` 实现。
 *
 * 此前有三份同名实现且已漂移（`ui/components/progress.ts`、`sync/github-time-format.ts`、
 * `ui/sync-result-dialog.ts`），差别在「<1s 怎么算」与「整分补不补秒」：
 *
 * | 输入    | 旧·progress 版 | 旧·另两份   |
 * | ------- | -------------- | ----------- |
 * | 999ms   | `0.99秒`       | `1.00秒`    |
 * | 60_000  | `1分`          | `1分00秒`   |
 *
 * 2026-10-15 收敛为一份，取 **progress 版**（即下面这份）：
 *
 * 1. `<1s` **截断**而非四舍五入 —— 999ms 不能显示成 `1.00秒`，否则与 1000ms 的 `1秒`
 *    在同一量级上出现两种写法（边界跨档）；
 * 2. 整分不补 `00秒`（`1分` 而非 `1分00秒`），秒为 0 时不显示冗余的 `00秒`。
 *
 * ⚠️ 放在 `tools/util/` 而不是 `ui/`：`sync/` 层有「不得反向依赖 `ui/`」的分层约束
 *    （导入图门禁 `check:cycles`），而 `sync/github-time-format.ts` 也要用它。
 * ⚠️ 三个旧位置**直接引本子模块**而不是 `tools/util/index.js` barrel —— 多处测试对该
 *    barrel 做整体 mock，从 barrel 取新导出会让未补齐的桩拿到 `undefined`
 *    （与 `readRowsCache` 引 `tools/util/sheet.js` 同一先例）。
 */
/**
 * 格式化耗时为可读字符串。
 *
 * - `<1s`：保留 2 位小数的秒（截断，`999ms` → `0.99秒`）
 * - `1s..59s`：整数秒（`3000ms` → `3秒`）
 * - `≥60s`：`X分` 或 `X分YY秒`（整分不补 `00秒`）
 * - 负数按 `0` 处理
 *
 * @param ms 毫秒数
 * @returns 可读耗时字符串
 */
export function formatDuration(ms) {
    if (ms < 1000) {
        // 截断而非四舍五入到 2 位：999ms 不能显示成「1.00秒」，
        // 否则与 1000ms 的「1秒」在同一量级上出现两种写法（边界跨档）。
        const seconds = Math.max(0, Math.floor(ms / 10) / 100);
        return `${seconds.toFixed(2)}秒`;
    }
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60)
        return `${String(seconds)}秒`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0
        ? `${String(minutes)}分${secs.toString().padStart(2, '0')}秒`
        : `${String(minutes)}分`;
}
