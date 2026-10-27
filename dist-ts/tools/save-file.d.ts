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
/** 保存结果 */
export interface SaveFileResult {
    /** 实际写入的完整路径（download 通道为空串——落点由浏览器决定） */
    path: string;
    /** 走了哪条通道 */
    via: 'fso' | 'download';
}
/**
 * 取路径的目录部分（`C:/a/b/c.json` → `C:/a/b`）
 *
 * 导出纯函数：单测直测，不碰 COM。反斜杠统一成正斜杠再找最后一个 `/`。
 */
export declare function directoryNameOf(filePath: string): string;
/** 拼接目录与文件名（目录为空时只返回文件名；分隔符统一成 `/`，尾部不重复） */
export declare function joinPath(directory: string, fileName: string): string;
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
export declare function pickSavePath(options: {
    title: string;
    defaultDir: string;
    fileName: string;
    filterDescription: string;
    filterExtensions: string;
}): string | null;
/**
 * 用 FSO 把文本写到绝对路径（默认 UTF-8，覆盖已存在文件）
 *
 * @param filePath 目标绝对路径
 * @param content 文本内容
 * @param isUnicode 是否以 UTF-16 LE（带 BOM）写入。默认 true —— 中文不会乱码；
 *   纯 ASCII 的大块内容（如 base64 更新包）传 false，体积只有一半。
 * @returns 成功 true；FSO 不可用 / 写失败 false（调用方回退下载通道）
 */
export declare function canWriteTextFile(filePath: string, content: string, isUnicode?: boolean): boolean;
/**
 * 完整保存流程：选位置 → 写文件 →（失败）回退下载
 *
 * @returns 保存结果；用户取消返回 null（调用方不写文件、不提示成功）
 */
export declare function saveTextFileWithDialog(options: {
    title: string;
    defaultDir: string;
    fileName: string;
    content: string;
    mime?: string;
    filterDescription?: string;
    filterExtensions?: string;
}): SaveFileResult | null;
//# sourceMappingURL=save-file.d.ts.map