/**
 * 剪贴板回退实现
 * @module ui/handlers/clipboard
 * @description 从 handlers/index.ts 抽出：Office/WebView 环境下 navigator.clipboard 不可用，
 *              改用临时 textarea + execCommand 的兼容路径。
 */
import { LOG_LEVELS, bgmLog } from '../../index.js';
/**
 * 将文本复制到剪贴板（使用临时 textarea + execCommand）
 * @returns 是否复制成功
 */
export function copyTextToClipboard(text) {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        // execCommand 已废弃但仍是 WebView/Office 环境中最可靠的剪贴板回退方案（navigator.clipboard 需安全上下文，不可用）
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        const isOk = document.execCommand('copy');
        document.body.removeChild(textarea);
        return isOk;
    }
    catch (error) {
        bgmLog(LOG_LEVELS.WARN, `[_copyTextToClipboard] 复制失败: ${error.message}`);
        return false;
    }
}
