/**
 * BGM 统一核心模块
 * @module core/unified
 * @description 统一定义对话框、消息通信、错误处理等核心功能
 *              所有其他模块应优先使用此模块提供的功能
 */

import { 
    XL, BGM_CONFIG, LOG_LEVELS, BGM_COLOR, ERROR_LEVELS, 
    PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS
} from './constants.js';

// ========== 导出常量（确保全局可用）==========
export { XL, BGM_CONFIG, LOG_LEVELS, BGM_COLOR, ERROR_LEVELS, PANEL_CONFIG, BGM_SUBJECT_TYPES, SYNC_STATUS };

// ========== 导出 BGM 命名空间 ==========
export { BGM } from '../util.js';

// ========== 统一对话框 API ==========
/**
 * 统一的对话框命名空间
 */
const Dialog = {
    /**
     * 显示提示对话框
     */
    alert: function(message, title) {
        if (typeof window.showAlert === 'function') {
            window.showAlert(message, title);
        } else if (typeof window.BGMAlert === 'function') {
            window.BGMAlert(message, title);
        } else {
            window.alert(message);
        }
    },

    /**
     * 显示确认对话框
     */
    confirm: function(message, onConfirm, onCancel) {
        if (typeof window.BGMConfirm === 'function') {
            window.BGMConfirm(message, '\u786E\u8BA4', onConfirm, onCancel);
        } else if (typeof window.showConfirm === 'function') {
            window.showConfirm(message, '\u786E\u8BA4', onConfirm, onCancel);
        } else {
            if (window.confirm(message)) {
                if (onConfirm) onConfirm();
            } else {
                if (onCancel) onCancel();
            }
        }
    },

    /**
     * 显示错误对话框
     */
    error: function(title, message) {
        if (typeof window.BGMError === 'function') {
            window.BGMError(message, title);
        } else {
            window.alert('[\u9519\u8BEF] ' + message);
        }
    },

    /**
     * 显示成功对话框
     */
    success: function(title, message) {
        if (typeof window.BGMSuccess === 'function') {
            window.BGMSuccess(message, title);
        } else {
            window.alert('[\u6210\u529F] ' + message);
        }
    },

    /**
     * 显示警告对话框
     */
    warning: function(title, message) {
        if (typeof window.BGMWarning === 'function') {
            window.BGMWarning(message, title);
        } else {
            window.alert('[\u8B66\u544A] ' + message);
        }
    },

    /**
     * 显示输入对话框
     */
    input: function(title, prompt, defaultValue, onOk, onCancel) {
        if (typeof window.BGMInput === 'function') {
            window.BGMInput(title, prompt, defaultValue, onOk, onCancel);
        } else if (typeof window.showInput === 'function') {
            window.showInput(title, prompt, defaultValue, onOk, onCancel);
        } else {
            const result = window.prompt(prompt, defaultValue);
            if (result !== null) {
                if (onOk) onOk(result);
            } else {
                if (onCancel) onCancel();
            }
        }
    },

    /**
     * 通用对话框（自动选择类型）
     */
    show: function(type, title, message, options) {
        switch (type) {
            case 'alert':
            case 'info':
                return this.alert(title || '\u63D0\u793A', message);
            case 'error':
                return this.error(title || '\u9519\u8BEF', message);
            case 'success':
                return this.success(title || '\u6210\u529F', message);
            case 'warning':
                return this.warning(title || '\u8B66\u544A', message);
            case 'confirm':
                return this.confirm(message, options?.onConfirm, options?.onCancel);
            case 'input':
                return this.input(title || '\u8F93\u5165', message, options?.defaultValue, options?.onOk, options?.onCancel);
            default:
                return this.alert(title || '\u63D0\u793A', message);
        }
    }
};

// 挂载到全局
window.BGMDialog = Dialog;

/**
 * 快捷方法
 */
export const showAlert = Dialog.alert.bind(Dialog);
export const showConfirm = Dialog.confirm.bind(Dialog);
export const showError = Dialog.error.bind(Dialog);
export const showSuccess = Dialog.success.bind(Dialog);
export const showWarning = Dialog.warning.bind(Dialog);
export const showInput = Dialog.input.bind(Dialog);
export const showDialog = Dialog.show.bind(Dialog);

// ========== 统一消息通信 API ==========
/**
 * 统一的消息通信命名空间
 */
const Message = {
    /**
     * 发送到父窗口（任务窗格）
     */
    send: function(data, targetOrigin) {
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(data, targetOrigin || "*");
                return true;
            }
        } catch (e) {
            // 静默处理 postMessage 不可用的情况（如跨域限制）
            // 仅在调试模式下记录，避免日志泄露
            if (typeof bgmLog === 'function') {
                bgmLog(LOG_LEVELS?.DEBUG || 0, "postMessage \u4E0D\u53EF\u7528: " + e.message);
            }
        }
        return false;
    },

    /**
     * 发送对话框请求
     */
    sendDialog: function(title, message) {
        return this.send({ type: "showDialog", title, message });
    },

    /**
     * 发送确认对话框请求
     */
    sendConfirm: function(message, onConfirm, onCancel) {
        this.send({ type: "showConfirm", message, onConfirm: true });
        window._bgmConfirmCallback = { confirm: onConfirm, cancel: onCancel };
    },

    /**
     * 发送 Token 更新通知
     */
    sendTokenUpdate: function() {
        return this.send({ type: "tokenUpdated" });
    },

    /**
     * 发送用户ID更新通知
     */
    sendUserIdUpdate: function() {
        return this.send({ type: "userIdUpdated" });
    },

    /**
     * 发送数据刷新请求
     */
    sendRefresh: function() {
        return this.send({ type: "refreshData" });
    },

    /**
     * 发送工作表刷新请求
     */
    sendRefreshSheets: function() {
        return this.send({ type: "refreshSheets" });
    }
};

// 挂载到全局
window.BGMMessage = Message;
export const postMessage = Message.send.bind(Message);
export const sendToTaskpane = Message.send.bind(Message);

// ========== 统一错误处理 API ==========
/**
 * 错误类（统一定义在 util.js 中，此处重新导出）
 */
import { BgmError } from '../util.js';
export { BgmError };

/**
 * 统一错误处理函数
 */
export function handleError(error, options) {
    const opts = Object.assign({
        level: ERROR_LEVELS.ERROR,
        showDialog: false,
        context: '',
        logger: true
    }, options || {});

    let bgmError;
    if (error instanceof BgmError) {
        bgmError = error;
    } else if (error instanceof Error) {
        bgmError = new BgmError(error.message, 'JS_ERROR', {
            name: error.name,
            stack: error.stack
        });
    } else {
        bgmError = new BgmError(String(error), 'UNKNOWN');
    }

    if (opts.context) {
        bgmError.context = opts.context;
    }

    // 日志输出
    if (opts.logger !== false) {
        const logMethod = bgmLog;
        if (logMethod) {
            switch (opts.level) {
                case ERROR_LEVELS.SILENT:
                    break;
                case ERROR_LEVELS.WARN:
                    bgmLog(LOG_LEVELS.WARN, bgmError.toString());
                    break;
                case ERROR_LEVELS.ERROR:
                case ERROR_LEVELS.THROW:
                default:
                    bgmLog(LOG_LEVELS.ERROR, bgmError.toString());
                    break;
            }
        }
    }

    // 显示对话框
    if (opts.showDialog) {
        Dialog.error('\u9519\u8BEF', bgmError.message);
    }

    // 抛出异常
    if (opts.level === ERROR_LEVELS.THROW) {
        throw bgmError;
    }

    return bgmError;
}

/**
 * 安全执行函数包装器
 */
export function safeExecute(fn, context, options) {
    try {
        return { success: true, result: fn() };
    } catch (error) {
        return { 
            success: false, 
            error: handleError(error, Object.assign({ context }, options))
        };
    }
}

/**
 * 异步安全执行函数包装器
 */
export async function safeExecuteAsync(fn, context, options) {
    try {
        const result = await fn();
        return { success: true, result };
    } catch (error) {
        return { 
            success: false, 
            error: handleError(error, Object.assign({ context }, options))
        };
    }
}

// ========== 挂载到 window（向后兼容）==========
window.BGMDialog = Dialog;
window.BGMMessage = Message;
window.BgmError = BgmError;
window.handleError = handleError;
window.safeExecute = safeExecute;
window.safeExecuteAsync = safeExecuteAsync;
