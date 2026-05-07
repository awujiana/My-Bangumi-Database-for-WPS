/** Alert 对话框 */
export function showAlert(message: any, title: any, onOk: any): void;
/** Confirm 确认对话框 */
export function showConfirm(message: any, title: any, onOk: any, onCancel: any): void;
/** Error 错误对话框 */
export function showError(message: any, title: any, onOk: any): void;
/** Warning 警告对话框 */
export function showWarning(message: any, title: any, onOk: any): void;
/** Success 成功对话框 */
export function showSuccess(message: any, title: any, onOk: any): void;
/** Input 输入对话框 */
export function showInput(title: any, prompt: any, defaultValue: any, onOk: any, onCancel: any): void;
export function showInputDialog(title: any, placeholder: any, onSubmit: any): void;
export function closeInputDialog(): void;
export function showConfirmDialog(message: any, onConfirm: any): void;
export function closeConfirmDialog(): void;
/** 关闭所有对话框（兼容旧接口） */
export function closeDialog(result: any): void;
export function closeAlertDialog(): void;
export function showDialog(title: any, message: any): void;
export function showToast(message: any, type: any): void;
//# sourceMappingURL=dialog.d.ts.map