/**
 * UI 对话框模块（TypeScript 版）
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */
export interface DialogOptions {
    title?: string;
    message?: string;
    prompt?: string;
    /** 输入确认回调（参数为用户输入的值） */
    onOk?: (value?: string) => void;
    /** 取消回调 */
    onCancel?: () => void;
    onConfirm?: () => void;
    /** 默认值 */
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
export declare function showAlert(message: string, title?: string, onOk?: () => void): void;
export declare function showConfirm(message: string, title?: string, onOk?: () => void, onCancel?: () => void): void;
export declare function showError(message: string, title?: string, onOk?: () => void): void;
export declare function showWarning(message: string, title?: string, onOk?: () => void): void;
export declare function showSuccess(message: string, title?: string, onOk?: () => void): void;
export declare function showInput(title: string, prompt: string, defaultValue?: string, onOk?: (value?: string) => void, onCancel?: () => void): void;
export declare function showInputDialog(title: string, placeholder: string, onSubmit: (value: string) => void): void;
export declare function closeInputDialog(): void;
export declare function showConfirmDialog(message: string, onConfirm: () => void): void;
export declare function closeConfirmDialog(): void;
export declare function closeDialog(result?: unknown): void;
export declare function closeAlertDialog(): void;
export declare function showDialog(title: string, message: string): void;
export declare function showToast(message: string, type?: string): void;
//# sourceMappingURL=dialog.d.ts.map