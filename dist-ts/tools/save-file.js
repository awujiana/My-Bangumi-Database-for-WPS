/**
 * @fileoverview 「选位置 → 写文件」的通用导出通道
 * @module tools/save-file
 * @description
 *   为什么不是 Blob 下载：`a[download]` 在 WPS 任务窗格里只能落 CEF 固定
 *   下载目录，用户每次导出都要去下载文件夹里翻（momo：所有导出都要能选择
 *   保存的位置）。
 *
 *   通道分两级，全部 try 包裹 + 运行时探测，任何一环不可用都**安全降级**：
 *   1. **选位置**：`Application.FileDialog(msoFileDialogSaveAs)` —— WPS 原生
 *      另存为对话框，`InitialFileName` 预填「默认导出位置 + 默认文件名」，
 *      用户可改目录改名字；取消返回 null（调用方据此中止，不写文件）。
 *   2. **写文件**：`wps.OAAssist.CoCreateInstance('Scripting.FileSystemObject')`
 *      拿 COM 实例，`CreateTextFile(path, isOverwrite, isUnicode)` 直写任意路径
 *      （iframe 没有 fs，这是 WebView 里写本地文件的唯一正经通道）。
 *   3. **降级**：FSO 不可用 / 写失败 → 回退 `downloadTextFile`（Blob 下载，
 *      落点由浏览器决定），结果里 `via: 'download'`，调用方 toast 明示。
 */
import { bgmLog, LOG_LEVELS } from '../index.js';
import { downloadTextFile } from './file-export.js';
/**
 * 取路径的目录部分（`C:/a/b/c.json` → `C:/a/b`）
 *
 * 导出纯函数：单测直测，不碰 COM。反斜杠统一成正斜杠再找最后一个 `/`。
 */
export function directoryNameOf(filePath) {
    const normalized = filePath.replaceAll('\\', '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash <= 0 ? '' : normalized.slice(0, lastSlash);
}
/** 拼接目录与文件名（目录为空时只返回文件名；分隔符统一成 `/`，尾部不重复） */
export function joinPath(directory, fileName) {
    if (directory === '')
        return fileName;
    // 尾部正/反斜杠都去：默认导出位置可能是用户手输的带尾斜杠路径
    const normalizedDirectory = directory.replace(/[/\\]+$/u, '').replaceAll('\\', '/');
    return `${normalizedDirectory}/${fileName}`;
}
/**
 * 弹 WPS 原生另存为对话框选路径
 *
 * @param options.title 对话框标题
 * @param options.defaultDir 初始目录（默认导出位置；空串 = 用对话框记忆的目录）
 * @param options.fileName 默认文件名
 * @param options.filterDescription 文件类型描述（如 `规则文件 (*.json)`）
 * @param options.filterExtensions 扩展名过滤（如 `*.json`）
 * @returns 完整路径；用户取消 / 对话框不可用返回 null
 */
export function pickSavePath(options) {
    try {
        const app = window.Application;
        if (!app || typeof app.FileDialog !== 'function') {
            bgmLog(LOG_LEVELS.WARN, '[save-file] FileDialog 不可用，无法选择保存位置');
            return null;
        }
        // msoFileDialogSaveAs = 2（见 et-jsapi-declare 的 MsoFileDialogType）
        const dialogType = typeof app.msoFileDialogSaveAs === 'number' ? app.msoFileDialogSaveAs : 2;
        const dialog = app.FileDialog(dialogType);
        if (!dialog)
            return null;
        dialog.Title = options.title;
        dialog.ButtonName = '保存';
        dialog.InitialFileName = joinPath(options.defaultDir, options.fileName);
        try {
            dialog.Filters.Clear();
        }
        catch {
            // 部分实现不支持 Clear：Add 会追加，重复过滤器无害
        }
        dialog.Filters.Add(options.filterDescription, options.filterExtensions, 1);
        // Show() 返回 -1 = 确定，0 = 取消
        const result = dialog.Show();
        if (result !== -1)
            return null;
        if (dialog.SelectedItems.Count <= 0)
            return null;
        const path = dialog.SelectedItems.Item(1);
        return typeof path === 'string' && path !== '' ? path : null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bgmLog(LOG_LEVELS.WARN, `[save-file] 另存为对话框异常: ${message}`);
        return null;
    }
}
/**
 * 用 FSO 把文本写到绝对路径（UTF-8，覆盖已存在文件）
 *
 * @returns 成功 true；FSO 不可用 / 写失败 false（调用方回退下载通道）
 */
export function canWriteTextFile(filePath, content) {
    try {
        const { wps } = window;
        const coCreate = wps?.OAAssist?.CoCreateInstance;
        if (typeof coCreate !== 'function') {
            bgmLog(LOG_LEVELS.WARN, '[save-file] OAAssist.CoCreateInstance 不可用');
            return false;
        }
        const fso = coCreate('Scripting.FileSystemObject');
        if (!fso || typeof fso.CreateTextFile !== 'function') {
            bgmLog(LOG_LEVELS.WARN, '[save-file] FileSystemObject 创建失败');
            return false;
        }
        // isOverwrite=true, isUnicode=true（UTF-16 LE；中文规则名不会乱码）
        const stream = fso.CreateTextFile(filePath, true, true);
        stream.Write(content);
        stream.Close();
        return true;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bgmLog(LOG_LEVELS.WARN, `[save-file] 写文件失败(${filePath}): ${message}`);
        return false;
    }
}
/**
 * 完整保存流程：选位置 → 写文件 →（失败）回退下载
 *
 * @returns 保存结果；用户取消返回 null（调用方不写文件、不提示成功）
 */
export function saveTextFileWithDialog(options) {
    const path = pickSavePath({
        title: options.title,
        defaultDir: options.defaultDir,
        fileName: options.fileName,
        filterDescription: options.filterDescription ?? 'JSON 文件 (*.json)',
        filterExtensions: options.filterExtensions ?? '*.json',
    });
    if (path === null)
        return null;
    if (canWriteTextFile(path, options.content)) {
        bgmLog(LOG_LEVELS.INFO, `[save-file] 已写入: ${path}`);
        return { path, via: 'fso' };
    }
    // 降级：Blob 下载（落 CEF 下载目录），文件名沿用用户选的
    const fileName = path.replaceAll('\\', '/').split('/').pop() ?? options.fileName;
    downloadTextFile(options.content, fileName, options.mime ?? 'application/json');
    return { path: '', via: 'download' };
}
