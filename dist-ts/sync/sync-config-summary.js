/**
 * @fileoverview 同步配置摘要的构造（纯函数，零 UI 依赖）
 * @module sync/sync-config-summary
 *
 * @description
 * 本模块原先位于 `ui/dialog.ts`。它构造的是**纯数据**（同步源/策略/方向/时间筛选的
 * 展示文案），却因为历史原因放在 UI 模块里，导致 `sync/exceltobangumi/index.ts`
 * 为了调一个纯函数而反向 import 整个 UI 层（见 文档/TS_AUDIT_2026_09_10.md 的 P1-5）。
 *
 * 下沉到 sync 层后，UI 与同步逻辑都从本模块导入；`ui/dialog.ts` 仍会 re-export
 * 以保持既有调用点兼容。
 */
/**
 * 构造同步配置摘要的工厂函数，统一各入口的配置构造逻辑。
 * @param context 配置上下文
 * @returns 配置摘要（仅包含上下文里实际提供的字段）
 */
export function buildSyncConfig(context) {
    const config = {};
    if (context.source)
        config.sourceLabel = context.source;
    if (context.strategy)
        config.strategyLabel = context.strategy;
    if (context.direction)
        config.directionLabel = context.direction;
    if (context.selectedRowsOnly)
        config.selectedRowsOnly = true;
    if (context.timeFilter) {
        const tf = context.timeFilter;
        switch (tf.range) {
            case 'future': {
                config.timeFilterLabel = '预告/未来动漫';
                break;
            }
            case 'year': {
                config.timeFilterLabel = `${String(tf.year)}年全年`;
                break;
            }
            case 'quarter': {
                config.timeFilterLabel = `${String(tf.year)}年${String(tf.quarter)}月新番`;
                break;
            }
            default: {
                config.timeFilterLabel = `${String(tf.year)}年${String(tf.month)}月`;
                break;
            }
        }
    }
    if (context.extra && context.extra.length > 0)
        config.extra = context.extra;
    return config;
}
