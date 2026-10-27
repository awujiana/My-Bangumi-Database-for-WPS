/**
 * 剪贴板回退实现
 * @module ui/handlers/clipboard
 * @description 从 handlers/index.ts 抽出：Office/WebView 环境下 navigator.clipboard 不可用，
 *              改用临时 textarea + execCommand 的兼容路径。
 */
/**
 * 将文本复制到剪贴板（使用临时 textarea + execCommand）
 * @returns 是否复制成功
 */
export declare function copyTextToClipboard(text: string): boolean;
//# sourceMappingURL=clipboard.d.ts.map