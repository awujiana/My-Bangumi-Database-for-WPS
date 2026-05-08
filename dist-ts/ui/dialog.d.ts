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