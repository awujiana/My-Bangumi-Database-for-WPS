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
/** 同步配置摘要，显示在进度弹窗顶部 */
export interface SyncConfigSummary {
    /** 同步源标签（如 "远程仓库" / "本地文件"） */
    sourceLabel?: string;
    /** 同步策略标签 */
    strategyLabel?: string;
    /** 时间筛选描述 */
    timeFilterLabel?: string;
    /** 是否仅同步选中行 */
    selectedRowsOnly?: boolean;
    /** 同步方向描述（如 "远程仓库 → Excel"） */
    directionLabel?: string;
    /** 额外的自定义配置行（key-value） */
    extra?: {
        label: string;
        value: string;
    }[];
}
/** 构建同步配置摘要的上下文 */
export interface BuildSyncConfigContext {
    /** 数据源标签 */
    source?: string;
    /** 策略标签 */
    strategy?: string;
    /** 方向标签 */
    direction?: string;
    /** 是否选中行 */
    selectedRowsOnly?: boolean;
    /** 时间筛选 */
    timeFilter?: {
        range: 'year' | 'quarter' | 'month' | 'future';
        year: number;
        quarter?: number;
        month?: number;
    };
    /** 额外的 key-value 对 */
    extra?: {
        label: string;
        value: string;
    }[];
}
/**
 * 构造同步配置摘要的工厂函数，统一各入口的配置构造逻辑。
 * @param context 配置上下文
 * @returns 配置摘要（仅包含上下文里实际提供的字段）
 */
export declare function buildSyncConfig(context: BuildSyncConfigContext): SyncConfigSummary;
//# sourceMappingURL=sync-config-summary.d.ts.map