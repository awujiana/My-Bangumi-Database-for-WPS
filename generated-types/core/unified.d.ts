/**
 * 统一错误处理函数
 */
export function handleError(error: any, options: any): BgmError;
/**
 * 安全执行函数包装器
 */
export function safeExecute(fn: any, context: any, options: any): {
    success: boolean;
    result: any;
    error?: undefined;
} | {
    success: boolean;
    error: BgmError;
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
    error: BgmError;
    result?: undefined;
}>;
export { BGM } from "../util.js";
/**
 * 快捷方法
 */
export const showAlert: any;
export const showConfirm: any;
export const showError: any;
export const showSuccess: any;
export const showWarning: any;
export const showInput: any;
export const showDialog: any;
export const postMessage: any;
export const sendToTaskpane: any;
import { BgmError } from '../util.js';
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