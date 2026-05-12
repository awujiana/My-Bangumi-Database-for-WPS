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
    onConfirm?: () => void;
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
export declare function showConfirm(message: string, callback: (confirmed: boolean) => void, title?: string): void;
export declare function showError(message: string, title?: string, onOk?: () => void): void;
export declare function showWarning(message: string, title?: string, onOk?: () => void): void;
export declare function showSuccess(message: string, title?: string, onOk?: () => void): void;
export declare function showInput(title: string, prompt: string, defaultValue?: string, onOk?: (value?: string) => void, onCancel?: () => void): void;
export declare function showToast(message: string, type?: string): void;
//# sourceMappingURL=dialog.d.ts.map