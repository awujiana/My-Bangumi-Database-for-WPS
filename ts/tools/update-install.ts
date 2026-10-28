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

import { bgmLog, LOG_LEVELS } from '../index.js'
import { canWriteTextFile, joinPath } from './save-file.js'

/** 自动安装结果状态 */
export type AutoInstallStatus = 'launched' | 'unsupported' | 'failed'

/** 自动安装结果 */
export interface AutoInstallOutcome {
  /** launched = 辅助脚本已启动；unsupported = 环境不支持；failed = 准备阶段失败 */
  status: AutoInstallStatus
  /** 给用户看的一句话说明 */
  detail: string
  /** 加载项目录（文件系统路径，unsupported 时为空串） */
  targetDirectory: string
  /** 辅助脚本路径（unsupported 时为空串） */
  scriptPath: string
  /** 安装日志路径（unsupported 时为空串） */
  logPath: string
}

/** 生成命令行所需的参数集合 */
export interface InstallScriptArguments {
  /** 辅助脚本路径（在随机工作目录里） */
  scriptPath: string
  /** 加载项目录 */
  targetDirectory: string
  /** base64 更新包路径（在随机工作目录里） */
  base64Path: string
  /** 本次的随机工作目录（脚本结束时整目录删除） */
  workDirectory: string
  /** 安装日志路径（在临时目录根，固定名字，便于用户按提示找到） */
  logPath: string
  /** 目标版本号（写回 publish.xml 用） */
  version: string
  /** 更新包 SHA-256（空串 = 发布端没提供，脚本内跳过复核） */
  sha256: string
}

/** FileSystemObject 的能力子集（仅本模块用到的成员） */
interface FileSystemObjectLike {
  CreateTextFile(
    fileName: string,
    isOverwrite: boolean,
    isUnicode: boolean,
  ): { Write(text: string): void; Close(): void }
  GetSpecialFolder(type: number): { Path: string }
  /** 创建目录；已存在时抛错（正好用作「独占创建」） */
  CreateFolder?: (folderPath: string) => void
}

/** 宿主桥：WPS 在不同版本/产品线上把它挂在 `window.wps` 或 `window.Application` 上 */
interface HostBridge {
  OAAssist?: {
    CoCreateInstance?: (progID: string) => object | undefined
    ShellExecute?: (parameter: string) => void
  }
  Quit?: () => void
  Workbooks?: DocumentCollectionLike
  Documents?: DocumentCollectionLike
}

/** 文档集合的能力子集（只用于判断「有没有未保存的文档」） */
interface DocumentCollectionLike {
  Count: number
  Item(index: number): { Saved?: boolean } | null
}

/** 带宿主桥的 window 全局 */
interface WindowWithHost {
  wps?: HostBridge
  Application?: HostBridge
}

/**
 * 取出所有可用的宿主桥（顺序：`window.wps` → `window.Application`）
 *
 * 两个挂载点历史上都被用到过：`save-file.ts` 走 `window.wps`，
 * `util/shellExecuteByOAAssist` 走 `window.Application`。任一存在即可用。
 */
function hostBridges(): HostBridge[] {
  const windowObject = window as unknown as WindowWithHost
  const candidates: (HostBridge | null | undefined)[] = [windowObject.wps, windowObject.Application]
  return candidates.filter((item): item is HostBridge => typeof item === 'object' && item !== null)
}

/** 取 FSO 实例（不可用时返回 null，不抛错） */
function fileSystemObject(): FileSystemObjectLike | null {
  for (const bridge of hostBridges()) {
    try {
      const coCreate = bridge.OAAssist?.CoCreateInstance
      if (typeof coCreate === 'function') {
        const fso = coCreate('Scripting.FileSystemObject') as FileSystemObjectLike | undefined
        if (fso && typeof fso.CreateTextFile === 'function') return fso
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      bgmLog(LOG_LEVELS.WARN, `[update-install] FileSystemObject 不可用：${message}`)
    }
  }
  return null
}

/** 在单个文档集合里数未保存的文档；集合不可用返回 null */
function countUnsavedInCollection(collection: DocumentCollectionLike | undefined): number | null {
  if (!collection || typeof collection.Count !== 'number') return null
  // COM 属性读到循环外（`check:com-in-loop` 门禁的要求，也避免每次比较都跨进程）
  const total = collection.Count
  let unsaved = 0
  for (let index = 1; index <= total; index += 1) {
    try {
      if (collection.Item(index)?.Saved === false) unsaved += 1
    } catch {
      // 单个文档读失败不影响其余统计
    }
  }
  return unsaved
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
export function countUnsavedDocuments(): number | null {
  for (const bridge of hostBridges()) {
    const fromWorkbooks = countUnsavedInCollection(bridge.Workbooks)
    if (fromWorkbooks !== null) return fromWorkbooks
    const fromDocuments = countUnsavedInCollection(bridge.Documents)
    if (fromDocuments !== null) return fromDocuments
  }
  return null
}

/**
 * `file://` URL → Windows 文件系统路径
 *
 * `file:///C:/a/b%20c` → `C:\a\b c`。非 file 协议（开发期的 `http://localhost`）返回 null。
 */
export function fileUrlToWindowsPath(url: string): string | null {
  const trimmed = url.trim()
  if (!/^file:/iu.test(trimmed)) return null
  let rest = trimmed.slice('file:'.length)
  // `file:///C:/...` → `/C:/...`；`file://server/share` 的 UNC 形式本插件用不到，按不支持处理
  rest = rest.replace(/^\/{2,}/u, '/')
  if (!rest.startsWith('/')) return null
  rest = rest.slice(1)
  let decoded: string
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    // 非法百分号转义：按原样使用，总比直接失败好
    decoded = rest
  }
  if (!/^[A-Za-z]:/u.test(decoded)) return null
  return decoded.replaceAll('/', '\\')
}

/**
 * 由插件基址解析出「加载项目录」
 *
 * 入参是 `getUrlPath()` 的返回值，它在不同上下文里可能是
 * `file:///.../jsaddons/xxx`、`file:///.../jsaddons/xxx/ui` 或带尾斜杠的形式。
 *
 * @returns 文件系统绝对路径；开发期（HTTP）或无法解析时返回 null
 */
export function resolveAddinDirectory(baseUrl: string): string | null {
  const withoutTrailing = baseUrl.trim().replace(/\/+$/u, '')
  // 末尾可能是 `/ui`（在页面内取基址时），统一剥掉，得到加载项根
  const rootUrl = withoutTrailing.replace(/\/ui$/iu, '')
  if (rootUrl === '') return null
  return fileUrlToWindowsPath(rootUrl)
}

/**
 * 二进制 → base64（分块，避免 `String.fromCodePoint` 参数过多爆栈）
 *
 * 用 `btoa` 而不是 `Uint8Array#toBase64()`：后者是 Chrome 130+ / Node 22 才有的新 API，
 * WPS 的 CEF 内核版本远低于此，用了会在真机上直接 `TypeError`。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 32_768
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCodePoint(...bytes.subarray(offset, offset + chunkSize))
  }
  // eslint-disable-next-line unicorn/prefer-uint8array-base64 -- WPS 的 CEF 没有 Uint8Array#toBase64
  return btoa(binary)
}

/**
 * 生成 PowerShell 辅助脚本
 *
 * 纯文本、无插值：所有路径都从命令行参数传入，避免脚本里出现中文路径被
 * 编码破坏（脚本本身以 UTF-16 落盘，中文提示可以正常显示）。
 */
export function buildUpdateScript(): string {
  return [
    '# BGM 自动更新辅助脚本（由插件生成，安装完成后可删除）',
    'param(',
    '  [Parameter(Mandatory=$true)][string]$TargetDir,',
    '  [Parameter(Mandatory=$true)][string]$Base64Path,',
    '  [Parameter(Mandatory=$true)][string]$WorkDir,',
    "  [string]$LogPath = '',",
    "  [string]$NewVersion = '',",
    "  [string]$Sha256 = ''",
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
    '  # 顺手清理 1 天前遗留的更新临时目录（同前缀，属于本插件；失败不影响本次安装）',
    '  try {',
    "    Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'bgm-update-*' -ErrorAction SilentlyContinue |",
    '      Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } |',
    '      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue',
    '  } catch { }',
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
    '  # 2) 还原更新包：只认插件写好的那份字节（脚本不联网，避免绕过插件的来源约束）',
    '  if (-not (Test-Path -LiteralPath $Base64Path)) {',
    "    throw '更新包缺失（临时目录里没有 base64 包），已放弃安装，加载项目录未被改动。'",
    '  }',
    "  Write-Log '正在还原更新包…'",
    '  $text = Get-Content -LiteralPath $Base64Path -Raw',
    '  $bytes = [Convert]::FromBase64String($text)',
    '  # zip 魔数校验：base64 写入不完整、或内容被换成别的东西时，在这里就拦住',
    '  if (($bytes.Length -lt 4) -or ($bytes[0] -ne 0x50) -or ($bytes[1] -ne 0x4B)) {',
    "    throw '更新包不是有效的 zip（可能写入不完整或被篡改），已放弃安装。'",
    '  }',
    '  [IO.File]::WriteAllBytes($zipPath, $bytes)',
    "  Write-Log ('更新包大小：' + (Get-Item -LiteralPath $zipPath).Length + ' 字节')",
    '',
    '  # 2.1) 再复核一次 SHA-256：插件在启动脚本之前已校验过，这里防「写完之后被替换」',
    "  if ($Sha256 -ne '') {",
    '    $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash',
    '    if ($actual -ne $Sha256.ToUpperInvariant()) {',
    "      throw ('更新包校验失败：期望 ' + $Sha256 + '，实际 ' + $actual + '，已放弃安装。')",
    '    }',
    "    Write-Log '更新包 SHA-256 复核通过'",
    '  }',
    "  else { Write-Log '发布端未提供 SHA-256，跳过复核（建议手动核对）' }",
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
    "    Copy-Item -Path (Join-Path $backupDir '*') -Destination $TargetDir -Recurse -Force",
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
    "        $replaced = $match.Value -replace 'version=\"[^\"]*\"', ('version=\"' + $NewVersion + '\"')",
    '        $updated = $original.Replace($match.Value, $replaced)',
    '        # 改写前先确认结果仍是合法结构，且保留一份 .bak（这是 WPS 自己的配置，不能弄坏）',
    "        if (($updated -ne $original) -and ($updated -like '*<jsplugin*')) {",
    "          Copy-Item -LiteralPath $publishXml -Destination ($publishXml + '.bak') -Force",
    "          $tempXml = $publishXml + '.tmp'",
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
    '  # 清掉本次的随机工作目录（日志在目录外，不受影响；脚本自身删不掉时留一个 .ps1 也无害）',
    '  Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue',
    '  # 无论成败都要把 WPS 拉起来：失败时至少还能用旧版',
    "  if ($wpsExe -ne '' -and (Test-Path -LiteralPath $wpsExe)) {",
    '    try { Start-Process -FilePath $wpsExe } catch { }',
    '  }',
    "  if (-not $succeeded) { Write-Log '安装未完成' }",
    '}',
    '',
  ].join('\n')
}

/** 给命令行参数加引号（Windows 路径不含双引号，直接包一层即可） */
function quote(value: string): string {
  return `"${value}"`
}

/** 拼出交给 ShellExecute 的完整命令行 */
export function buildPowerShellCommand(arguments_: InstallScriptArguments): string {
  return [
    'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File',
    quote(arguments_.scriptPath),
    '-TargetDir',
    quote(arguments_.targetDirectory),
    '-Base64Path',
    quote(arguments_.base64Path),
    '-WorkDir',
    quote(arguments_.workDirectory),
    '-LogPath',
    quote(arguments_.logPath),
    '-NewVersion',
    quote(arguments_.version),
    '-Sha256',
    quote(arguments_.sha256),
  ].join(' ')
}

/** 取系统临时目录（FSO 的 2 = TemporaryFolder）；不可用返回 null */
export function temporaryDirectory(): string | null {
  const fso = fileSystemObject()
  if (fso === null || typeof fso.GetSpecialFolder !== 'function') return null
  try {
    const folder = fso.GetSpecialFolder(2)
    const path = folder.Path
    return typeof path === 'string' && path !== '' ? path : null
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.WARN, `[update-install] 取临时目录失败：${message}`)
    return null
  }
}

/** 生成 16 位十六进制随机后缀（WebCrypto 不可用时退化为 Math.random） */
export function randomSuffix(): string {
  const bytes = new Uint8Array(8)
  const host = globalThis as unknown as {
    crypto?: { getRandomValues?: (array: Uint8Array) => void }
  }
  const candidate = host.crypto
  if (typeof candidate?.getRandomValues === 'function') {
    candidate.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

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
export function createUpdateWorkDirectory(parentDirectory: string): string | null {
  const fso = fileSystemObject()
  if (fso === null || typeof fso.CreateFolder !== 'function') return null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = joinPath(parentDirectory, `bgm-update-${randomSuffix()}`)
    try {
      fso.CreateFolder(candidate)
      return candidate
    } catch {
      // 极小概率撞名：换一个再试（3 次都撞说明 FSO 根本写不进去）
    }
  }
  bgmLog(LOG_LEVELS.WARN, '[update-install] 无法在临时目录创建隔离工作目录')
  return null
}

/**
 * 用宿主 ShellExecute 启动命令行（失败抛错，由调用方降级）
 *
 * 之所以抛错而不返回布尔：`ShellExecute` 发出后就没有后续反馈，
 * 唯一能区分「已启动 / 宿主不支持」的时刻就是这次调用本身。
 */
export function launchDetachedCommand(commandLine: string): void {
  const bridge = hostBridges().find((item) => typeof item.OAAssist?.ShellExecute === 'function')
  if (bridge === undefined) throw new Error('宿主未提供 OAAssist.ShellExecute')
  bridge.OAAssist?.ShellExecute?.call(bridge.OAAssist, commandLine)
}

/**
 * 请求 WPS 退出（未保存的文档会由 WPS 自己弹保存提示）
 *
 * 调用成功不代表 WPS 一定退出（用户可能取消保存）；辅助脚本会等 180 秒后放弃。
 */
export function quitWps(): void {
  const bridge = hostBridges().find((item) => typeof item.Quit === 'function')
  if (bridge === undefined) throw new Error('宿主未提供 Application.Quit')
  bridge.Quit?.call(bridge)
}

/**
 * 准备并启动自动安装
 *
 * @param options.baseUrl 插件基址（`getUrlPath()` 的返回值）
 * @param options.version 目标版本号（如 `v2.2.3`）
 * @param options.bytes 已下载并**校验通过**的更新包字节
 * @param options.sha256 更新包 SHA-256（空串 = 发布端没提供，脚本内跳过复核）
 */
export function runAutoInstall(options: {
  baseUrl: string
  version: string
  bytes: Uint8Array<ArrayBuffer>
  sha256: string
}): AutoInstallOutcome {
  const empty = { targetDirectory: '', scriptPath: '', logPath: '' }
  const targetDirectory = resolveAddinDirectory(options.baseUrl)
  if (targetDirectory === null) {
    return { status: 'unsupported', detail: '当前环境无法定位加载项目录', ...empty }
  }
  const temporaryDirectory_ = temporaryDirectory()
  if (temporaryDirectory_ === null) {
    return { status: 'unsupported', detail: '无法获取系统临时目录', ...empty }
  }
  const workDirectory = createUpdateWorkDirectory(temporaryDirectory_)
  if (workDirectory === null) {
    return {
      status: 'unsupported',
      detail: '无法在临时目录创建隔离工作目录',
      ...empty,
      targetDirectory,
    }
  }

  const tag = options.version.replace(/[^\w.-]/gu, '')
  // 脚本与更新包都在随机目录里；日志留在临时目录根（名字可预测，便于按提示找到）
  const scriptPath = joinPath(workDirectory, 'install.ps1')
  const base64Path = joinPath(workDirectory, 'package.b64')
  const logPath = joinPath(temporaryDirectory_, `bgm-update-${tag}.log`)

  // base64 是纯 ASCII：用 ANSI 文本流写，体积只有 UTF-16 的一半
  if (!canWriteTextFile(base64Path, bytesToBase64(options.bytes), false)) {
    return {
      status: 'unsupported',
      detail: '无法把更新包写入临时目录',
      ...empty,
      targetDirectory,
      logPath,
    }
  }
  // 脚本含中文提示，必须用 UTF-16（带 BOM）：PowerShell 才不会按本地代码页误读
  if (!canWriteTextFile(scriptPath, buildUpdateScript(), true)) {
    return {
      status: 'failed',
      detail: '无法写入安装脚本',
      targetDirectory,
      scriptPath: '',
      logPath,
    }
  }

  const commandLine = buildPowerShellCommand({
    scriptPath,
    targetDirectory,
    base64Path,
    workDirectory,
    logPath,
    version: options.version.replace(/^v/iu, ''),
    sha256: options.sha256,
  })
  try {
    launchDetachedCommand(commandLine)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.WARN, `[update-install] 启动安装程序失败：${message}`)
    return {
      status: 'failed',
      detail: `宿主不允许启动安装程序（${message}）`,
      targetDirectory,
      scriptPath,
      logPath,
    }
  }

  bgmLog(LOG_LEVELS.INFO, `[update-install] 已启动安装程序：${scriptPath}`)
  return { status: 'launched', detail: '安装程序已启动', targetDirectory, scriptPath, logPath }
}
