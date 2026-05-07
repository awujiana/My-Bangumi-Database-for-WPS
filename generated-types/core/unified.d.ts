/**
 * 统一错误处理函数
 */
export function handleError(error: any, options: any): any;
/**
 * 安全执行函数包装器
 */
export function safeExecute(fn: any, context: any, options: any): {
    success: boolean;
    result: any;
    error?: undefined;
} | {
    success: boolean;
    error: any;
    result?: undefined;
};
/**
 * 异步安全执行函数包装器
 */
export function safeExecuteAsync(fn: any, context: any, options: any): Promise<{
    success: boolean;
    result: any;
    error?: undefined;
} | {
    success: boolean;
    error: any;
    result?: undefined;
}>;
export function showAlert(message: any, title: any): void;
export function showConfirm(message: any, onConfirm: any, onCancel: any): void;
export function showError(title: any, message: any): void;
export function showSuccess(title: any, message: any): void;
export function showWarning(title: any, message: any): void;
export function showInput(title: any, prompt: any, defaultValue: any, onOk: any, onCancel: any): void;
export function showDialog(type: any, title: any, message: any, options: any): void;
export function postMessage(data: any, targetOrigin: any): boolean;
export function sendToTaskpane(data: any, targetOrigin: any): boolean;
import { XL } from './constants.js';
import { BGM_CONFIG } from './constants.js';
import { LOG_LEVELS } from './constants.js';
import { BGM_COLOR } from './constants.js';
import { ERROR_LEVELS } from './constants.js';
import { PANEL_CONFIG } from './constants.js';
import { BGM_SUBJECT_TYPES } from './constants.js';
import { SYNC_STATUS } from './constants.js';
export { XL, BGM_CONFIG, LOG_LEVELS, BGM_COLOR, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS, BgmError };
//# sourceMappingURL=unified.d.ts.map