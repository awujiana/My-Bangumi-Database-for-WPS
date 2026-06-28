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
export declare function showSyncResult(summary: string, details: string[]): void;
/**
 * 显示同步进度弹窗（运行中状态）
 * @param title 弹窗标题（如"正在同步 - 选中行同步"）
 * @param handlers 暂停/恢复/停止回调集合
 */
export declare function showSyncProgressDialog(title: string, handlers: {
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
}): void;
/**
 * 更新进度条
 * @param current 当前完成数
 * @param total 总数
 * @param message 当前任务描述（显示在进度条下方）
 * @param logLine 可选的实时日志行（追加到日志区）
 */
export declare function updateSyncProgressDialog(current: number, total: number, message?: string, logLine?: string): void;
/**
 * 切换弹窗为完成状态，显示统计结果
 * @param summary 统计摘要文本
 * @param details 详情数组
 * @param stopped 是否被用户停止
 */
export declare function completeSyncProgressDialog(summary: string, details: string[], stopped?: boolean): void;
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