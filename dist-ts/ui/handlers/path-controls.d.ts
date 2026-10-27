/**
 * 默认路径记忆（导出位置 / 导入文件夹）
 * @module ui/handlers/path-controls
 * @description 从 handlers/index.ts 抽出：WPS 文件夹选择对话框（含 GetOpenFilename 回退）
 *              与设置页只读路径输入框回填。
 */
/**
 * 弹出文件夹选择对话框并返回选中的文件夹绝对路径。
 * 优先使用 WPS Application.FileDialog(msoFileDialogFolderPicker=2)，
 * 不可用时回退到 GetOpenFilename 单选（由用户选取文件后取目录）。
 * 用户取消返回 null。
 */
export declare function selectDefaultFolder(title: string): string | null;
/** 设置设置页中的路径只读输入框显示值 */
export declare function updatePathDisplay(inputId: string, value: string): void;
/** 从 PluginStorage 读取已保存的默认路径并回填到设置页输入框 */
export declare function initializeConfigPathControls(): void;
//# sourceMappingURL=path-controls.d.ts.map