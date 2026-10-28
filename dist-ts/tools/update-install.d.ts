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
 *   **抗劫持的三处设计（v2.2.4 起）**：
 *   1. 脚本与更新包放在**每次新建的随机目录**（`%TEMP%\bgm-update-<16 位随机>`，
 *      用 `FSO.CreateFolder` 独占创建），不再用可预测的固定文件名 —— 消除
 *      「先占位/软链接把路径重定向到别处」的 TOCTOU 面；
 *   2. 脚本**不联网**：删掉了原来的 `Invoke-WebRequest` 兜底分支。更新包只能来自
 *      插件自己下载并校验过的那份字节，脚本里再按 `-Sha256` 复核一次（防「写完
 *      到脚本读」之间被替换），并检查 zip 魔数 `PK`；
 *   3. 校验失败一律放弃安装（由调用方在启动脚本**之前**判定），脚本自身也
 *      拒绝装非 zip 内容。
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
    /** 辅助脚本路径（在随机工作目录里） */
    scriptPath: string;
    /** 加载项目录 */
    targetDirectory: string;
    /** base64 更新包路径（在随机工作目录里） */
    base64Path: string;
    /** 本次的随机工作目录（脚本结束时整目录删除） */
    workDirectory: string;
    /** 安装日志路径（在临时目录根，固定名字，便于用户按提示找到） */
    logPath: string;
    /** 目标版本号（写回 publish.xml 用） */
    version: string;
    /** 更新包 SHA-256（空串 = 发布端没提供，脚本内跳过复核） */
    sha256: string;
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
/** 生成 16 位十六进制随机后缀（WebCrypto 不可用时退化为 Math.random） */
export declare function randomSuffix(): string;
/**
 * 在临时目录下新建一个**本次专用**的随机工作目录
 *
 * 为什么不再用固定文件名（`%TEMP%\bgm-update-<版本>.ps1`）：`%TEMP%` 是用户可写的，
 * 固定路径意味着任何能写 `%TEMP%` 的进程都可以提前占位（同名文件、目录联接、
 * 符号链接），把「写脚本」重定向到别处再让 PowerShell 去执行 —— 典型 TOCTOU。
 * 改成随机目录后，攻击者无法预知路径。
 *
 * `FSO.CreateFolder` 在目录已存在时会抛错，正好当作**独占创建**：
 * 一旦同名目录存在就换一个随机名，绝不复用别人的目录。
 *
 * @param parentDirectory 系统临时目录
 * @returns 新建目录的绝对路径；FSO 不可用 / 创建失败返回 null
 */
export declare function createUpdateWorkDirectory(parentDirectory: string): string | null;
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
 * @param options.bytes 已下载并**校验通过**的更新包字节
 * @param options.sha256 更新包 SHA-256（空串 = 发布端没提供，脚本内跳过复核）
 */
export declare function runAutoInstall(options: {
    baseUrl: string;
    version: string;
    bytes: Uint8Array<ArrayBuffer>;
    sha256: string;
}): AutoInstallOutcome;
//# sourceMappingURL=update-install.d.ts.map