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
import { bgmLog, LOG_LEVELS } from '../index.js';
import { canWriteTextFile, joinPath } from './save-file.js';
/**
 * 取出所有可用的宿主桥（顺序：`window.wps` → `window.Application`）
 *
 * 两个挂载点历史上都被用到过：`save-file.ts` 走 `window.wps`，
 * `util/shellExecuteByOAAssist` 走 `window.Application`。任一存在即可用。
 */
function hostBridges() {
    const windowObject = window;
    const candidates = [windowObject.wps, windowObject.Application];
    return candidates.filter((item) => typeof item === 'object' && item !== null);
}
/** 取 FSO 实例（不可用时返回 null，不抛错） */
function fileSystemObject() {
    for (const bridge of hostBridges()) {
        try {
            const coCreate = bridge.OAAssist?.CoCreateInstance;
            if (typeof coCreate === 'function') {
                const fso = coCreate('Scripting.FileSystemObject');
                if (fso && typeof fso.CreateTextFile === 'function')
                    return fso;
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            bgmLog(LOG_LEVELS.WARN, `[update-install] FileSystemObject 不可用：${message}`);
        }
    }
    return null;
}
/** 在单个文档集合里数未保存的文档；集合不可用返回 null */
function countUnsavedInCollection(collection) {
    if (!collection || typeof collection.Count !== 'number')
        return null;
    // COM 属性读到循环外（`check:com-in-loop` 门禁的要求，也避免每次比较都跨进程）
    const total = collection.Count;
    let unsaved = 0;
    for (let index = 1; index <= total; index += 1) {
        try {
            if (collection.Item(index)?.Saved === false)
                unsaved += 1;
        }
        catch {
            // 单个文档读失败不影响其余统计
        }
    }
    return unsaved;
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
export function countUnsavedDocuments() {
    for (const bridge of hostBridges()) {
        const fromWorkbooks = countUnsavedInCollection(bridge.Workbooks);
        if (fromWorkbooks !== null)
            return fromWorkbooks;
        const fromDocuments = countUnsavedInCollection(bridge.Documents);
        if (fromDocuments !== null)
            return fromDocuments;
    }
    return null;
}
/**
 * `file://` URL → Windows 文件系统路径
 *
 * `file:///C:/a/b%20c` → `C:\a\b c`。非 file 协议（开发期的 `http://localhost`）返回 null。
 */
export function fileUrlToWindowsPath(url) {
    const trimmed = url.trim();
    if (!/^file:/iu.test(trimmed))
        return null;
    let rest = trimmed.slice('file:'.length);
    // `file:///C:/...` → `/C:/...`；`file://server/share` 的 UNC 形式本插件用不到，按不支持处理
    rest = rest.replace(/^\/{2,}/u, '/');
    if (!rest.startsWith('/'))
        return null;
    rest = rest.slice(1);
    let decoded;
    try {
        decoded = decodeURIComponent(rest);
    }
    catch {
        // 非法百分号转义：按原样使用，总比直接失败好
        decoded = rest;
    }
    if (!/^[A-Za-z]:/u.test(decoded))
        return null;
    return decoded.replaceAll('/', '\\');
}
/**
 * 由插件基址解析出「加载项目录」
 *
 * 入参是 `getUrlPath()` 的返回值，它在不同上下文里可能是
 * `file:///.../jsaddons/xxx`、`file:///.../jsaddons/xxx/ui` 或带尾斜杠的形式。
 *
 * @returns 文件系统绝对路径；开发期（HTTP）或无法解析时返回 null
 */
export function resolveAddinDirectory(baseUrl) {
    const withoutTrailing = baseUrl.trim().replace(/\/+$/u, '');
    // 末尾可能是 `/ui`（在页面内取基址时），统一剥掉，得到加载项根
    const rootUrl = withoutTrailing.replace(/\/ui$/iu, '');
    if (rootUrl === '')
        return null;
    return fileUrlToWindowsPath(rootUrl);
}
/**
 * 二进制 → base64（分块，避免 `String.fromCodePoint` 参数过多爆栈）
 *
 * 用 `btoa` 而不是 `Uint8Array#toBase64()`：后者是 Chrome 130+ / Node 22 才有的新 API，
 * WPS 的 CEF 内核版本远低于此，用了会在真机上直接 `TypeError`。
 */
export function bytesToBase64(bytes) {
    const chunkSize = 32_768;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCodePoint(...bytes.subarray(offset, offset + chunkSize));
    }
    // eslint-disable-next-line unicorn/prefer-uint8array-base64 -- WPS 的 CEF 没有 Uint8Array#toBase64
    return btoa(binary);
}
/**
 * 生成 PowerShell 辅助脚本
 *
 * 纯文本、无插值：所有路径都从命令行参数传入，避免脚本里出现中文路径被
 * 编码破坏（脚本本身以 UTF-16 落盘，中文提示可以正常显示）。
 */
export function buildUpdateScript() {
    return [
        '# BGM 自动更新辅助脚本（由插件生成，安装完成后可删除）',
        'param(',
        '  [Parameter(Mandatory=$true)][string]$TargetDir,',
        '  [Parameter(Mandatory=$true)][string]$Base64Path,',
        "  [string]$ZipUrl = '',",
        "  [string]$LogPath = '',",
        "  [string]$NewVersion = ''",
        ')',
        "$ErrorActionPreference = 'Stop'",
        '',
        'function Write-Log([string]$message) {',
        "  $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $message)",
        "  if ($LogPath -ne '') { Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8 }",
        '}',
        '',
        'function Show-Popup([string]$message, [int]$icon) {',
        '  try {',
        '    $shell = New-Object -ComObject WScript.Shell',
        '    # 60 秒后自动关闭：无人值守时不能卡住 finally 里的「重启 WPS」',
        "    $null = $shell.Popup($message, 60, 'BGM 自动更新', $icon)",
        '  } catch { }',
        '}',
        '',
        '$zipPath = [IO.Path]::ChangeExtension($Base64Path, ".zip")',
        "$backupDir = Join-Path $env:TEMP ('bgm-update-backup-' + [Guid]::NewGuid().ToString('N'))",
        "$wpsExe = ''",
        '$succeeded = $false',
        '$rollbackOk = $false',
        'try {',
        "  Write-Log ('开始更新：' + $TargetDir)",
        '  # 1) 先记下 wps.exe 路径（退出后就查不到了），再等它退出',
        '  $process = Get-Process -Name wps -ErrorAction SilentlyContinue | Select-Object -First 1',
        '  if ($null -ne $process) {',
        "    try { $wpsExe = $process.Path } catch { $wpsExe = '' }",
        '  }',
        '  $deadline = (Get-Date).AddSeconds(180)',
        '  while ((Get-Process -Name wps -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {',
        '    Start-Sleep -Milliseconds 500',
        '  }',
        '  if (Get-Process -Name wps -ErrorAction SilentlyContinue) {',
        "    throw 'WPS 未在 180 秒内退出，已放弃安装（插件未被改动）。'",
        '  }',
        '  # 退出后句柄释放有延迟，给文件锁一点余量',
        '  Start-Sleep -Milliseconds 800',
        '',
        '  # 2) 还原更新包：优先用插件下载好的字节，缺失时按地址重下',
        '  if ((Test-Path -LiteralPath $Base64Path)) {',
        "    Write-Log '正在还原更新包…'",
        '    $text = Get-Content -LiteralPath $Base64Path -Raw',
        '    [IO.File]::WriteAllBytes($zipPath, [Convert]::FromBase64String($text))',
        '  }',
        "  elseif ($ZipUrl -ne '') {",
        "    Write-Log '本地更新包缺失，改用下载地址…'",
        '    Invoke-WebRequest -Uri $ZipUrl -OutFile $zipPath -UseBasicParsing',
        '  }',
        "  else { throw '没有可用的更新包。' }",
        "  Write-Log ('更新包大小：' + (Get-Item -LiteralPath $zipPath).Length + ' 字节')",
        '',
        '  # 3) 备份 → 校验备份 → 覆盖解压（失败回滚，保证插件仍可用）',
        '  $sourceCount = (Get-ChildItem -LiteralPath $TargetDir -Recurse -File -Force | Measure-Object).Count',
        '  Copy-Item -LiteralPath $TargetDir -Destination $backupDir -Recurse -Force',
        '  $backupCount = (Get-ChildItem -LiteralPath $backupDir -Recurse -File -Force | Measure-Object).Count',
        '  if ($backupCount -lt $sourceCount) {',
        "    throw ('备份不完整（' + $backupCount + '/' + $sourceCount + ' 个文件），已放弃安装，加载项目录未被改动。')",
        '  }',
        "  Write-Log ('已备份当前版本（' + $backupCount + ' 个文件）')",
        '  try {',
        '    # -Force 只覆盖同名文件，不会删除目录里多出来的文件（用户自己放的东西不会被清掉）',
        '    Expand-Archive -LiteralPath $zipPath -DestinationPath $TargetDir -Force',
        '  } catch {',
        "    Write-Log ('解压失败，回滚：' + $_.Exception.Message)",
        '    # 回滚用「覆盖复制」而不是「删目录再改名」：中途失败也不会把加载项目录清空',
        '    Copy-Item -Path (Join-Path $backupDir \'*\') -Destination $TargetDir -Recurse -Force',
        '    $rollbackOk = $true',
        "    Write-Log '已用备份覆盖回旧版本'",
        '    throw',
        '  }',
        "  Write-Log '文件已更新'",
        '',
        '  # 4) 顺手把 publish.xml 里的版本号改成新版本（失败不影响安装）',
        '  try {',
        "    $publishXml = Join-Path (Split-Path -Parent $TargetDir) 'publish.xml'",
        "    if ((Test-Path -LiteralPath $publishXml) -and ($NewVersion -ne '')) {",
        '      $original = [IO.File]::ReadAllText($publishXml)',
        '      $pattern = \'name="my-bangumi-database-for-wps"[^>]*?version="([^"]*)"\'',
        '      $match = [regex]::Match($original, $pattern)',
        '      if ($match.Success) {',
        '        $replaced = $match.Value -replace \'version="[^"]*"\', (\'version="\' + $NewVersion + \'"\')',
        '        $updated = $original.Replace($match.Value, $replaced)',
        '        # 改写前先确认结果仍是合法结构，且保留一份 .bak（这是 WPS 自己的配置，不能弄坏）',
        '        if (($updated -ne $original) -and ($updated -like \'*<jsplugin*\')) {',
        '          Copy-Item -LiteralPath $publishXml -Destination ($publishXml + \'.bak\') -Force',
        '          $tempXml = $publishXml + \'.tmp\'',
        '          [IO.File]::WriteAllText($tempXml, $updated, (New-Object System.Text.UTF8Encoding($true)))',
        '          Move-Item -LiteralPath $tempXml -Destination $publishXml -Force',
        "          Write-Log '已更新 publish.xml 版本号（原件备份为 publish.xml.bak）'",
        '        }',
        '      }',
        '    }',
        '  } catch {',
        "    Write-Log ('publish.xml 未更新（不影响使用）：' + $_.Exception.Message)",
        '  }',
        '',
        '  $succeeded = $true',
        "  Write-Log '安装完成，正在重新打开 WPS…'",
        '} catch {',
        "  Write-Log ('失败：' + $_.Exception.Message)",
        '  $message = "自动更新失败：`n" + $_.Exception.Message + "`n`n日志：" + $LogPath + "`nWPS 将重新打开，插件仍是旧版本。"',
        '  Show-Popup $message 16',
        '} finally {',
        '  # 备份只在「装成功」或「已确认回滚成功」时删除；否则留着让用户能手工恢复',
        '  if ($succeeded -or $rollbackOk) {',
        '    Remove-Item -LiteralPath $backupDir -Recurse -Force -ErrorAction SilentlyContinue',
        '  }',
        '  elseif (Test-Path -LiteralPath $backupDir) {',
        "    Write-Log ('备份保留在：' + $backupDir + '（可整目录复制回去恢复）')",
        '  }',
        '  Remove-Item -LiteralPath $Base64Path -Force -ErrorAction SilentlyContinue',
        '  Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue',
        '  # 无论成败都要把 WPS 拉起来：失败时至少还能用旧版',
        "  if ($wpsExe -ne '' -and (Test-Path -LiteralPath $wpsExe)) {",
        '    try { Start-Process -FilePath $wpsExe } catch { }',
        '  }',
        "  if (-not $succeeded) { Write-Log '安装未完成' }",
        '}',
        '',
    ].join('\n');
}
/** 给命令行参数加引号（Windows 路径不含双引号，直接包一层即可） */
function quote(value) {
    return `"${value}"`;
}
/** 拼出交给 ShellExecute 的完整命令行 */
export function buildPowerShellCommand(arguments_) {
    return [
        'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File',
        quote(arguments_.scriptPath),
        '-TargetDir',
        quote(arguments_.targetDirectory),
        '-Base64Path',
        quote(arguments_.base64Path),
        '-ZipUrl',
        quote(arguments_.zipUrl),
        '-LogPath',
        quote(arguments_.logPath),
        '-NewVersion',
        quote(arguments_.version),
    ].join(' ');
}
/** 取系统临时目录（FSO 的 2 = TemporaryFolder）；不可用返回 null */
export function temporaryDirectory() {
    const fso = fileSystemObject();
    if (fso === null || typeof fso.GetSpecialFolder !== 'function')
        return null;
    try {
        const folder = fso.GetSpecialFolder(2);
        const path = folder.Path;
        return typeof path === 'string' && path !== '' ? path : null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bgmLog(LOG_LEVELS.WARN, `[update-install] 取临时目录失败：${message}`);
        return null;
    }
}
/**
 * 用宿主 ShellExecute 启动命令行（失败抛错，由调用方降级）
 *
 * 之所以抛错而不返回布尔：`ShellExecute` 发出后就没有后续反馈，
 * 唯一能区分「已启动 / 宿主不支持」的时刻就是这次调用本身。
 */
export function launchDetachedCommand(commandLine) {
    const bridge = hostBridges().find((item) => typeof item.OAAssist?.ShellExecute === 'function');
    if (bridge === undefined)
        throw new Error('宿主未提供 OAAssist.ShellExecute');
    bridge.OAAssist?.ShellExecute?.call(bridge.OAAssist, commandLine);
}
/**
 * 请求 WPS 退出（未保存的文档会由 WPS 自己弹保存提示）
 *
 * 调用成功不代表 WPS 一定退出（用户可能取消保存）；辅助脚本会等 180 秒后放弃。
 */
export function quitWps() {
    const bridge = hostBridges().find((item) => typeof item.Quit === 'function');
    if (bridge === undefined)
        throw new Error('宿主未提供 Application.Quit');
    bridge.Quit?.call(bridge);
}
/**
 * 准备并启动自动安装
 *
 * @param options.baseUrl 插件基址（`getUrlPath()` 的返回值）
 * @param options.version 目标版本号（如 `v2.2.3`）
 * @param options.bytes 已下载的更新包字节
 * @param options.downloadUrl 更新包地址（本地文件不可用时的回退）
 */
export function runAutoInstall(options) {
    const empty = { targetDirectory: '', scriptPath: '', logPath: '' };
    const targetDirectory = resolveAddinDirectory(options.baseUrl);
    if (targetDirectory === null) {
        return { status: 'unsupported', detail: '当前环境无法定位加载项目录', ...empty };
    }
    const temporaryDirectory_ = temporaryDirectory();
    if (temporaryDirectory_ === null) {
        return { status: 'unsupported', detail: '无法获取系统临时目录', ...empty };
    }
    const tag = options.version.replace(/[^\w.-]/gu, '');
    const scriptPath = joinPath(temporaryDirectory_, `bgm-update-${tag}.ps1`);
    const base64Path = joinPath(temporaryDirectory_, `bgm-update-${tag}.b64`);
    const logPath = joinPath(temporaryDirectory_, `bgm-update-${tag}.log`);
    // base64 是纯 ASCII：用 ANSI 文本流写，体积只有 UTF-16 的一半
    if (!canWriteTextFile(base64Path, bytesToBase64(options.bytes), false)) {
        return {
            status: 'unsupported',
            detail: '无法把更新包写入临时目录',
            ...empty,
            targetDirectory,
            logPath,
        };
    }
    // 脚本含中文提示，必须用 UTF-16（带 BOM）：PowerShell 才不会按本地代码页误读
    if (!canWriteTextFile(scriptPath, buildUpdateScript(), true)) {
        return { status: 'failed', detail: '无法写入安装脚本', targetDirectory, scriptPath: '', logPath };
    }
    const commandLine = buildPowerShellCommand({
        scriptPath,
        targetDirectory,
        base64Path,
        zipUrl: options.downloadUrl,
        logPath,
        version: options.version.replace(/^v/iu, ''),
    });
    try {
        launchDetachedCommand(commandLine);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bgmLog(LOG_LEVELS.WARN, `[update-install] 启动安装程序失败：${message}`);
        return {
            status: 'failed',
            detail: `宿主不允许启动安装程序（${message}）`,
            targetDirectory,
            scriptPath,
            logPath,
        };
    }
    bgmLog(LOG_LEVELS.INFO, `[update-install] 已启动安装程序：${scriptPath}`);
    return { status: 'launched', detail: '安装程序已启动', targetDirectory, scriptPath, logPath };
}
