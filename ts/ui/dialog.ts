/**
 * UI 对话框模块（TypeScript 版）
 * @module ui/dialog
 * @description 自定义对话框、确认对话框、Toast 通知
 */

// ========== 类型定义 ==========


// ========== 对话框选项 ==========
export interface DialogOptions {
    title?: string;
    message?: string;
    prompt?: string;       // 输入框的提示文本（与 message 等效）
    /** 输入确认回调（参数为用户输入的值） */
    onOk?: (value?: string) => void;
    /** 取消回调 */
    onCancel?: () => void;
    // 确认回调（无输入参数，适用于确认对话框） */
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
    onOk?: (value?: string) => void;  // value 改为可选
    onCancel?: () => void;
}




// ========== 常量与配置 ==========
const DIALOG_TYPES: Record<string, DialogConfig> = {
    alert:    { id: 'bgmAlertDialog',    titleId: 'bgmAlertTitle',    msgId: 'bgmAlertMessage',    buttons: [{ id: 'bgmAlertOk',    cls: 'bgm-btn-primary', text: '确定', event: 'ok' }] },
    confirm:  { id: 'bgmConfirmDialog',  titleId: 'bgmConfirmTitle',  msgId: 'bgmConfirmMessage',  buttons: [{ id: 'bgmConfirmOk',   cls: 'bgm-btn-primary', text: '确定', event: 'ok' }, { id: 'bgmConfirmCancel', cls: 'bgm-btn-default', text: '取消', event: 'cancel' }] },
    error:    { id: 'bgmErrorDialog',    titleId: 'bgmErrorTitle',    msgId: 'bgmErrorMessage',    buttons: [{ id: 'bgmErrorOk',    cls: 'bgm-btn-danger',  text: '确定', event: 'ok' }] },
    warning:  { id: 'bgmWarningDialog',  titleId: 'bgmWarningTitle',  msgId: 'bgmWarningMessage',  buttons: [{ id: 'bgmWarningOk',  cls: 'bgm-btn-warning', text: '确定', event: 'ok' }] },
    success:  { id: 'bgmSuccessDialog',  titleId: 'bgmSuccessTitle',  msgId: 'bgmSuccessMessage',  buttons: [{ id: 'bgmSuccessOk',  cls: 'bgm-btn-success', text: '确定', event: 'ok' }] },
    input:    { id: 'bgmInputDialog',    titleId: 'bgmInputTitle',    msgId: 'bgmInputPrompt',     buttons: [{ id: 'bgmInputOk',     cls: 'bgm-btn-primary', text: '确定', event: 'ok' }, { id: 'bgmInputCancel', cls: 'bgm-btn-default', text: '取消', event: 'cancel' }] }
};

// ========== 模块内部状态 ==========
let dialogInitialized: boolean = false;
let _dialogCallback: DialogCallback | null = null;
let _toastTimer: number | null = null;

// 缓存 DOM 引用（初始化后填充）
const dom: Record<string, HTMLElement | null> = {};

// ========== 初始化 ==========
function ensureDialogs(): void {
    if (dialogInitialized) return;
    dialogInitialized = true;
    createDialogs();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureDialogs);
    } else {
        setTimeout(ensureDialogs, 0);
    }
}

function createDialogs(): void {
    if (document.getElementById('bgmDialogContainer')) return;

    const container = document.createElement('div');
    container.id = 'bgmDialogContainer';
    document.body.appendChild(container);

    // 通用对话框创建函数
    function createDialogElement(type: string, iconClass: string, iconChar: string, defaultTitle: string): HTMLElement {
        const cfg = DIALOG_TYPES[type];
        const modal = document.createElement('div');
        modal.id = cfg.id;
        modal.className = 'bgm-modal';
        modal.style.display = 'none';

        const content = document.createElement('div');
        content.className = 'bgm-modal-content ' + type;

        // Header
        const header = document.createElement('div');
        header.className = 'bgm-dialog-header';
        const icon = document.createElement('span');
        icon.className = 'bgm-dialog-icon ' + iconClass;
        icon.innerHTML = iconChar;
        const title = document.createElement('span');
        title.id = cfg.titleId;
        title.className = 'bgm-dialog-title';
        title.textContent = defaultTitle;
        header.appendChild(icon);
        header.appendChild(title);
        content.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'bgm-dialog-body';
        const msg = document.createElement('p');
        msg.id = cfg.msgId;
        msg.className = 'bgm-dialog-message';
        body.appendChild(msg);
        content.appendChild(body);

        // Footer
        const footer = document.createElement('div');
        footer.className = 'bgm-dialog-footer';
        cfg.buttons.forEach((btn: DialogButton) => {
            const button = document.createElement('button');
            button.id = btn.id;
            button.className = 'bgm-btn ' + btn.cls;
            button.textContent = btn.text;
            button.dataset.event = btn.event;
            footer.appendChild(button);
        });
        content.appendChild(footer);
        modal.appendChild(content);
        return modal;
    }

    // 创建各种对话框
    container.appendChild(createDialogElement('alert', 'bgm-icon-info', '&#9432;', '提示'));
    container.appendChild(createDialogElement('confirm', 'bgm-icon-question', '&#63;', '确认'));
    container.appendChild(createDialogElement('error', 'bgm-icon-error', '&#10006;', '错误'));
    container.appendChild(createDialogElement('warning', 'bgm-icon-warning', '&#9888;', '警告'));
    container.appendChild(createDialogElement('success', 'bgm-icon-success', '&#10004;', '成功'));
    container.appendChild(createDialogElement('input', 'bgm-icon-info', '&#9432;', '输入'));

    // 为 Input 对话框添加输入框
    const inputBody = document.querySelector('#bgmInputDialog .bgm-dialog-body');
    if (inputBody) {
        const inputField = document.createElement('input');
        inputField.type = 'text';
        inputField.id = 'bgmInputField';
        inputField.className = 'bgm-input-field';
        inputBody.appendChild(inputField);
    }

    // Toast 容器
    const toast = document.createElement('div');
    toast.id = 'bgmToast';
    toast.className = 'bgm-toast';
    container.appendChild(toast);

    // 绑定事件并缓存 DOM
    bindAllEvents();
}

function bindAllEvents(): void {
    // 缓存对话框元素
    for (const type in DIALOG_TYPES) {
        const cfg = DIALOG_TYPES[type];
        dom[cfg.id] = document.getElementById(cfg.id);
        dom[cfg.titleId] = document.getElementById(cfg.titleId);
        dom[cfg.msgId] = document.getElementById(cfg.msgId);
        cfg.buttons.forEach((btn: DialogButton) => {
            dom[btn.id] = document.getElementById(btn.id);
        });
    }
    // Toast
    dom.bgmToast = document.getElementById('bgmToast');
    dom.bgmInputField = document.getElementById('bgmInputField');

    // 通用事件处理
    const container = document.getElementById('bgmDialogContainer');
    if (!container) return;

    container.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        const btn = target.closest('button');
        if (!btn) return;

        const eventType = (btn as HTMLButtonElement).dataset.event;
        if (!eventType) return;

        const modal = btn.closest('.bgm-modal') as HTMLElement;
        if (!modal) return;

        // 关闭对话框
        modal.style.display = 'none';

        // 获取当前回调并调用
        if (_dialogCallback) {
            if (eventType === 'ok' && _dialogCallback.onOk) {
                if (modal.id === 'bgmInputDialog') {
                    const inputValue = dom.bgmInputField ? (dom.bgmInputField as HTMLInputElement).value.trim() : '';
                    _dialogCallback.onOk(inputValue);
                } else {
                    _dialogCallback.onOk();
                }
            } else if (eventType === 'cancel' && _dialogCallback.onCancel) {
                _dialogCallback.onCancel();
            }
            _dialogCallback = null;
        }
    });

    // Input 框 Enter 键支持
    dom.bgmInputField?.addEventListener('keypress', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            dom.bgmInputOk?.click();
        }
    });
}

/**
 * 通用对话框显示函数
 */
function _showDialog(type: string, opts: DialogOptions = {}): void {
    const cfg = DIALOG_TYPES[type];
    const dialog = dom[cfg.id];
    if (!dialog) {
        // 回退到原生弹窗
        if (type === 'confirm') {
            if (window.confirm(opts.message || '')) {
                // confirm 对话框使用 onConfirm
                opts.onConfirm?.();
            } else {
                opts.onCancel?.();
            }
        } else if (type === 'input') {
            const promptText = opts.prompt || opts.message || '';
            const result = window.prompt(promptText, opts.defaultValue || '');
            if (result !== null) {
                // input 对话框使用 onOk，传入输入值
                opts.onOk?.(result);
            } else {
                opts.onCancel?.();
            }
        } else {
            // alert 对话框
            window.alert(opts.message);
            opts.onConfirm?.();
        }
        return;
    }

    // 设置标题与消息
    const titleEl = dom[cfg.titleId];
    const msgEl = dom[cfg.msgId];
    if (titleEl) titleEl.textContent = opts.title || '';
    if (msgEl) msgEl.textContent = opts.prompt || opts.message || '';

    // 如果是输入框，设置默认值
    if (type === 'input' && dom.bgmInputField) {
        (dom.bgmInputField as HTMLInputElement).value = opts.defaultValue || '';
        dom.bgmInputField.focus();
    }

    // 存储回调（统一使用 onOk 和 onCancel）
    _dialogCallback = { onOk: opts.onOk, onCancel: opts.onCancel };

    dialog.style.display = 'flex';
}
// ========== 公开 API ==========

export function showAlert(message: string, title?: string, onOk?: () => void): void {
    _showDialog('alert', { message, title: title || '提示', onOk });
}

export function showConfirm(message: string, title?: string, onOk?: () => void, onCancel?: () => void): void {
    _showDialog('confirm', { message, title: title || '确认', onOk, onCancel });
}

export function showError(message: string, title?: string, onOk?: () => void): void {
    _showDialog('error', { message, title: title || '错误', onOk });
}

export function showWarning(message: string, title?: string, onOk?: () => void): void {
    _showDialog('warning', { message, title: title || '警告', onOk });
}

export function showSuccess(message: string, title?: string, onOk?: () => void): void {
    _showDialog('success', { message, title: title || '成功', onOk });
}

export function showInput(title: string, prompt: string, defaultValue?: string, onOk?: (value?: string) => void, onCancel?: () => void): void {
    _showDialog('input', { title, message: prompt, onOk, onCancel, defaultValue });
}

// ========== 快捷兼容函数 ==========

export function showInputDialog(title: string, placeholder: string, onSubmit: (value: string) => void): void {
    showInput(title, placeholder, '', (value?: string) => {
        if (onSubmit && value !== undefined) onSubmit(value);
    });
}

export function closeInputDialog(): void {
    const dialog = dom.bgmInputDialog;
    if (dialog) dialog.style.display = 'none';
}

export function showConfirmDialog(message: string, onConfirm: () => void): void {
    showConfirm(message, '确认', onConfirm);
}

export function closeConfirmDialog(): void {
    const dialog = dom.bgmConfirmDialog;
    if (dialog) dialog.style.display = 'none';
}

export function closeDialog(result?: unknown): void {
    for (const id in dom) {
        const el = dom[id];
        if (id.startsWith('bgm') && el?.classList?.contains('bgm-modal')) {
            el.style.display = 'none';
        }
    }
    if ((window as any)._dialogCallback) {
        (window as any)._dialogCallback(result);
        (window as any)._dialogCallback = null;
    }
}

export function closeAlertDialog(): void {
    const dialog = dom.bgmAlertDialog;
    if (dialog) dialog.style.display = 'none';
}

export function showDialog(title: string, message: string): void {
    showAlert(message, title);
}

// ========== Toast 通知 ==========

export function showToast(message: string, type?: string): void {
    const toast = dom.bgmToast;
    if (!toast) return;

    if (_toastTimer !== null) {
        clearTimeout(_toastTimer);
        _toastTimer = null;
    }

    toast.textContent = message;
    toast.className = 'bgm-toast bgm-toast-show';
    if (type) {
        toast.classList.add('bgm-toast-' + type);
    }

    _toastTimer = window.setTimeout(() => {
        toast.className = 'bgm-toast';
        _toastTimer = null;
    }, 3000);
}


