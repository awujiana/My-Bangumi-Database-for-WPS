/**
 * @fileoverview 一键自动安装更新包：生成辅助脚本 → 关闭 WPS → 覆盖加载项目录 → 自动重启
 * @module tools/update-install
 *
 * @description
 *   为什么不在任务窗格里直接覆盖自己：任务窗格的 JS 运行在 WPS 的 CEF 里，
 *   `ui/`、`dist-ts/` 这些文件正被当前进程打开，运行期覆盖会因文件锁失败；
 *   而且解压到一半失败会把插件写成「半新半旧」的坏状态。
 *
 *   所以真正的覆盖交给一个**外部辅助进程**（PowerShell 脚本），它做四件事：
 *   1. 等 WPS 退出（最多 180 秒）—— 退出后文件锁自然释放；
 *   2. 把当前加载项目录整份备份到临时目录；
 *   3. `Expand-Archive` 覆盖解压（失败则回滚备份，插件仍是旧版可用状态）；
 *   4. 用退出前记下的 `wps.exe` 路径把 WPS 重新拉起来。
 *
 *   更新包的字节由本模块落盘（`FSO.CreateTextFile` 写 base64，纯 ASCII 不会有
 *   二进制被编码破坏的问题），脚本再还原成 zip —— 这样「下载进度条」与「实际
 *   安装的包」是同一份字节，不必再下载一遍。
 *
 *   任何一环不可用（不是本地安装、FSO 不可用、宿主不提供 ShellExecute）都
 *   返回 `unsupported` / `failed`，由调用方回落到「下载 zip + 手动覆盖」的老流程。
 */
/** 自动安装结果状态 */
export type AutoInstallStatus = 'launched' | 'unsupported' | 'failed';
/** 自动安装结果 */
export interface AutoInstallOutcome {
    /** launched = 辅助脚本已启动；unsupported = 环境不支持；failed = 准备阶段失败 */
    status: AutoInstallStatus;
    /** 给用户看的一句话说明 */
    detail: string;
    /** 加载项目录（文件系统路径，unsupported 时为空串） */
    targetDirectory: string;
    /** 辅助脚本路径（unsupported 时为空串） */
    scriptPath: string;
    /** 安装日志路径（unsupported 时为空串） */
    logPath: string;
}
/** 生成命令行所需的参数集合 */
export interface InstallScriptArguments {
    /** 辅助脚本路径 */
    scriptPath: string;
    /** 加载项目录 */
    targetDirectory: string;
    /** base64 更新包路径 */
    base64Path: string;
    /** base64 不可用时的回退下载地址 */
    zipUrl: string;
    /** 安装日志路径 */
    logPath: string;
    /** 目标版本号（写回 publish.xml 用） */
    version: string;
}
/**
 * 统计未保存的文档数
 *
 * 数据安全前置检查：自动安装会调用 `Quit()`，若存在未保存的文档，
 * 用户一旦在保存提示里选「不保存」，工作就丢了。所以只要数得出 > 0，
 * 就**不启动**安装（连脚本都不生成，避免留下一个空等的外部进程）。
 *
 * @returns 未保存文档数；宿主没提供文档集合时返回 null（无法判断）
 */
export declare function countUnsavedDocuments(): number | null;
/**
 * `file://` URL → Windows 文件系统路径
 *
 * `file:///C:/a/b%20c` → `C:\a\b c`。非 file 协议（开发期的 `http://localhost`）返回 null。
 */
export declare function fileUrlToWindowsPath(url: string): string | null;
/**
 * 由插件基址解析出「加载项目录」
 *
 * 入参是 `getUrlPath()` 的返回值，它在不同上下文里可能是
 * `file:///.../jsaddons/xxx`、`file:///.../jsaddons/xxx/ui` 或带尾斜杠的形式。
 *
 * @returns 文件系统绝对路径；开发期（HTTP）或无法解析时返回 null
 */
export declare function resolveAddinDirectory(baseUrl: string): string | null;
/**
 * 二进制 → base64（分块，避免 `String.fromCodePoint` 参数过多爆栈）
 *
 * 用 `btoa` 而不是 `Uint8Array#toBase64()`：后者是 Chrome 130+ / Node 22 才有的新 API，
 * WPS 的 CEF 内核版本远低于此，用了会在真机上直接 `TypeError`。
 */
export declare function bytesToBase64(bytes: Uint8Array): string;
/**
 * 生成 PowerShell 辅助脚本
 *
 * 纯文本、无插值：所有路径都从命令行参数传入，避免脚本里出现中文路径被
 * 编码破坏（脚本本身以 UTF-16 落盘，中文提示可以正常显示）。
 */
export declare function buildUpdateScript(): string;
/** 拼出交给 ShellExecute 的完整命令行 */
export declare function buildPowerShellCommand(arguments_: InstallScriptArguments): string;
/** 取系统临时目录（FSO 的 2 = TemporaryFolder）；不可用返回 null */
export declare function temporaryDirectory(): string | null;
/**
 * 用宿主 ShellExecute 启动命令行（失败抛错，由调用方降级）
 *
 * 之所以抛错而不返回布尔：`ShellExecute` 发出后就没有后续反馈，
 * 唯一能区分「已启动 / 宿主不支持」的时刻就是这次调用本身。
 */
export declare function launchDetachedCommand(commandLine: string): void;
/**
 * 请求 WPS 退出（未保存的文档会由 WPS 自己弹保存提示）
 *
 * 调用成功不代表 WPS 一定退出（用户可能取消保存）；辅助脚本会等 180 秒后放弃。
 */
export declare function quitWps(): void;
/**
 * 准备并启动自动安装
 *
 * @param options.baseUrl 插件基址（`getUrlPath()` 的返回值）
 * @param options.version 目标版本号（如 `v2.2.3`）
 * @param options.bytes 已下载的更新包字节
 * @param options.downloadUrl 更新包地址（本地文件不可用时的回退）
 */
export declare function runAutoInstall(options: {
    baseUrl: string;
    version: string;
    bytes: Uint8Array;
    downloadUrl: string;
}): AutoInstallOutcome;
//# sourceMappingURL=update-install.d.ts.map