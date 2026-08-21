/**
 * UI 对话框模块
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */
export interface DialogOptions {
    title?: string;
    message?: string;
    prompt?: string;
    onOk?: (value?: string) => void;
    onCancel?: () => void;
    defaultValue?: string;
}
export interface DialogButton {
    id: string;
    cls: string;
    text: string;
    event: string;
}
export interface DialogConfig {
    id: string;
    titleId: string;
    msgId: string;
    buttons: DialogButton[];
}
export interface DialogCallback {
    onOk?: (value?: string) => void;
    onCancel?: () => void;
}
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
    extra?: Array<{
        label: string;
        value: string;
    }>;
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
    extra?: Array<{
        label: string;
        value: string;
    }>;
}
/**
 * 构造同步配置摘要的工厂函数，统一各入口的配置构造逻辑。
 * @param ctx 配置上下文
 * @returns SyncConfigSummary 对象
 */
export declare function buildSyncConfig(ctx: BuildSyncConfigContext): SyncConfigSummary;
export declare function showSyncResult(summary: string, details: string[]): void;
/**
 * 渲染配置摘要为 HTML 字符串
 */
export declare function renderConfigSummary(cfg: SyncConfigSummary): string;
/**
 * 显示同步进度弹窗（运行中状态）
 * @param title 弹窗标题（如"正在同步 - 选中行同步"）
 * @param handlers 暂停/恢复/停止回调集合
 * @param config 可选的同步配置摘要，显示在进度区上方
 */
export declare function showSyncProgressDialog(title: string, handlers: {
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
}, config?: SyncConfigSummary): void;
/**
 * 更新进度条
 * @param current 当前完成数
 * @param total 总数
 * @param message 当前任务描述（显示在进度条下方）
 * @param logLine 可选的实时日志行（追加到日志区）
 * @param eta 可选的 ETA 字符串（显示在 ETA 区域，独立于 logLine）
 */
export declare function updateSyncProgressDialog(current: number, total: number, message?: string, logLine?: string, eta?: string): void;
/**
 * 同步统计数据接口（增强版，支持完整仪表盘渲染）
 */
export interface SyncProgressStats {
    added: number;
    updated: number;
    deleted: number;
    unchanged: number;
    failed: number;
    skipped: number;
    remoteTotal: number;
    elapsedMs: number;
    avgSpeed: number;
    strategyLabel: string;
}
/**
 * 切换弹窗为完成状态，显示统计结果
 * @param summary 统计摘要文本
 * @param details 详情数组
 * @param stopped 是否被用户停止
 * @param onNext 点击"下一步"时的回调（用于打开同步完成详情弹窗）
 * @param stats 同步统计数据（用于渲染图表）
 */
export declare function completeSyncProgressDialog(summary: string, details: string[], stopped?: boolean, onNext?: () => void, stats?: SyncProgressStats): void;
/** 隐藏同步进度弹窗 */
export declare function hideSyncProgressDialog(): void;
export declare function showAlert(message: string, title?: string, onOk?: () => void): void;
export declare function showConfirm(message: string, callback: (confirmed: boolean) => void, title?: string): void;
export declare function showError(message: string, title?: string, onOk?: () => void): void;
export declare function showWarning(message: string, title?: string, onOk?: () => void): void;
export declare function showSuccess(message: string, title?: string, onOk?: () => void): void;
export declare function showInput(title: string, prompt: string, defaultValue?: string, onOk?: (value?: string) => void, onCancel?: () => void): void;
export declare function showToast(message: string, type?: string): void;
//# sourceMappingURL=dialog.d.ts.map