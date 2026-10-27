// @vitest-environment jsdom
/**
 * @fileoverview ts/tools/update-install.ts 单测
 *
 * 覆盖：
 * 1. 纯函数：`file://` → Windows 路径、加载项目录解析、base64 编码、命令拼装；
 * 2. 辅助脚本内容：必须含「等 WPS 退出 / 备份 / 解压 / 回滚 / 重启 / 改 publish.xml」
 *    这几段关键命令（少一段就不是「无感安装」而是把插件写坏）；
 * 3. 数据安全：备份要校验完整性、回滚只能覆盖复制（不许清空目录）、
 *    回滚失败要保留备份、有未保存文档时不得启动安装；
 * 4. 编排：FSO 写两个临时文件（base64 走 ANSI、脚本走 UTF-16）、ShellExecute 命令行；
 * 5. 降级：不是本地安装 / 没有 FSO / 没有 ShellExecute 都要返回非 launched。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  buildPowerShellCommand,
  buildUpdateScript,
  bytesToBase64,
  countUnsavedDocuments,
  fileUrlToWindowsPath,
  launchDetachedCommand,
  quitWps,
  resolveAddinDirectory,
  runAutoInstall,
  temporaryDirectory,
} from '../ts/tools/update-install.js'

/** 假的系统临时目录 */
const FAKE_TEMPORARY_DIRECTORY = String.raw`C:\Users\me\AppData\Local\Temp`
/** 假的加载项目录 */
const ADDIN_ROOT = String.raw`C:\jsaddons\p`

interface FakeWriteStream {
  Write: ReturnType<typeof vi.fn>
  Close: ReturnType<typeof vi.fn>
}

/** 清掉两个宿主挂载点，避免用例之间互相污染 */
function clearHost(): void {
  delete (window as unknown as { wps?: unknown }).wps
  delete (window as unknown as { Application?: unknown }).Application
}

/** 装配一个假 FSO + ShellExecute，返回可断言的 spy */
function stubWps(options: { withFso?: boolean; withShell?: boolean } = {}): {
  createTextFile: ReturnType<typeof vi.fn>
  shell: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
} {
  clearHost()
  const createTextFile = vi.fn((): FakeWriteStream => ({ Write: vi.fn(), Close: vi.fn() }))
  const shell = vi.fn()
  const quit = vi.fn()
  const fso = {
    CreateTextFile: createTextFile,
    GetSpecialFolder: () => ({ Path: FAKE_TEMPORARY_DIRECTORY }),
  }
  ;(window as unknown as { wps: unknown }).wps = {
    OAAssist: {
      CoCreateInstance: options.withFso === false ? undefined : () => fso,
      ShellExecute: options.withShell === false ? undefined : shell,
    },
    Quit: quit,
  }
  return { createTextFile, shell, quit }
}

/** 装配一个带 Workbooks 集合的宿主桥 */
function stubDocuments(savedFlags: readonly boolean[], mount: 'wps' | 'Application'): void {
  clearHost()
  const items = savedFlags.map((saved) => ({ Saved: saved }))
  const collection = {
    Count: items.length,
    Item: (index: number) => items[index - 1] ?? null,
  }
  ;(window as unknown as Record<string, unknown>)[mount] = { Workbooks: collection }
}

beforeEach(clearHost)

afterEach(clearHost)

describe('fileUrlToWindowsPath', () => {
  it('把 file:/// 本地路径转成反斜杠路径', () => {
    expect(fileUrlToWindowsPath('file:///C:/Users/me/AppData/kingsoft/jsaddons/plugin')).toBe(
      String.raw`C:\Users\me\AppData\kingsoft\jsaddons\plugin`,
    )
  })

  it('解码百分号转义（中文 / 空格路径）', () => {
    expect(fileUrlToWindowsPath('file:///D:/%E7%BC%96%E7%A8%8B/a%20b')).toBe(
      String.raw`D:\编程\a b`,
    )
  })

  it('非 file 协议返回 null（开发期是 http）', () => {
    expect(fileUrlToWindowsPath('http://localhost:3889/ui/panel.html')).toBeNull()
    expect(fileUrlToWindowsPath('')).toBeNull()
  })

  it('UNC 形式（file://server/share）不支持，返回 null', () => {
    expect(fileUrlToWindowsPath('file://server/share/plugin')).toBeNull()
  })

  it('非法百分号转义时按原样使用，不抛错', () => {
    expect(fileUrlToWindowsPath('file:///C:/a%zz')).toBe(String.raw`C:\a%zz`)
  })
})

describe('resolveAddinDirectory', () => {
  it('基址即加载项根', () => {
    expect(resolveAddinDirectory('file:///C:/jsaddons/my-plugin')).toBe(
      String.raw`C:\jsaddons\my-plugin`,
    )
  })

  it('基址带 /ui 时剥掉（页面内取基址会多一层）', () => {
    expect(resolveAddinDirectory('file:///C:/jsaddons/my-plugin/ui')).toBe(
      String.raw`C:\jsaddons\my-plugin`,
    )
  })

  it('尾斜杠不影响结果', () => {
    expect(resolveAddinDirectory('file:///C:/jsaddons/my-plugin/')).toBe(
      String.raw`C:\jsaddons\my-plugin`,
    )
  })

  it('http 基址返回 null → 调用方回落手动安装', () => {
    expect(resolveAddinDirectory('http://localhost:3889/ui')).toBeNull()
    expect(resolveAddinDirectory('')).toBeNull()
  })
})

describe('bytesToBase64', () => {
  it('短字节串与已知 base64 一致', () => {
    expect(bytesToBase64(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('UEsDBA==')
  })

  it('空数组得到空串', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('')
  })

  it('跨 32KB 分块边界的长数据长度与首尾都对（70000 字节 0..255 循环）', () => {
    const bytes = new Uint8Array(70_000)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256
    const encoded = bytesToBase64(bytes)
    // 期望值由独立实现（Python base64）算出：长度 93336、首 12 位、尾 8 位
    expect(encoded.length).toBe(93_336)
    expect(encoded.slice(0, 12)).toBe('AAECAwQFBgcI')
    expect(encoded.slice(-8)).toBe('bG1ubw==')
  })
})

describe('buildUpdateScript', () => {
  const script = buildUpdateScript()

  it('以 param 块开头（注释行之后）', () => {
    const lines = script.split('\n')
    expect(lines[0]).toContain('BGM 自动更新辅助脚本')
    expect(lines[1]).toBe('param(')
  })

  it('包含「等 WPS 退出」的轮询与超时', () => {
    expect(script).toContain('Get-Process -Name wps')
    expect(script).toContain('AddSeconds(180)')
    expect(script).toContain('Start-Sleep -Milliseconds 500')
  })

  it('包含备份 → 解压 → 失败回滚', () => {
    expect(script).toContain(
      'Copy-Item -LiteralPath $TargetDir -Destination $backupDir -Recurse -Force',
    )
    expect(script).toContain(
      'Expand-Archive -LiteralPath $zipPath -DestinationPath $TargetDir -Force',
    )
    // 回滚是「把备份覆盖回目标目录」，不是「删目标目录再改名」
    expect(script).toContain("Copy-Item -Path (Join-Path $backupDir '*'")
  })

  it('包含自动重启 WPS', () => {
    expect(script).toContain('Start-Process -FilePath $wpsExe')
  })

  it('优先用插件下载好的字节，缺失才按地址重下', () => {
    expect(script).toContain('[Convert]::FromBase64String($text)')
    expect(script).toContain('Invoke-WebRequest -Uri $ZipUrl')
  })

  it('改 publish.xml 的版本号（失败不影响安装）', () => {
    expect(script).toContain('publish.xml')
    expect(script).toContain('[regex]::Match')
    expect(script).toContain('$NewVersion')
  })

  it('备份后校验文件数，不完整就放弃（不动目标目录）', () => {
    expect(script).toContain('$sourceCount')
    expect(script).toContain('$backupCount')
    expect(script).toContain('备份不完整')
  })

  it('回滚用覆盖复制，绝不清空加载项目录', () => {
    // 全脚本不允许出现「删除目标目录」这种动作
    expect(script).not.toContain('Remove-Item -LiteralPath $TargetDir')
    expect(script).not.toContain('Move-Item -LiteralPath $backupDir -Destination $TargetDir')
  })

  it('回滚失败时保留备份，便于手工恢复', () => {
    expect(script).toContain('$rollbackOk')
    expect(script).toContain('备份保留在')
  })

  it('改 publish.xml 前先备份并原子替换', () => {
    expect(script).toContain("$publishXml + '.bak'")
    expect(script).toContain('$tempXml')
    expect(script).toContain('Move-Item -LiteralPath $tempXml -Destination $publishXml -Force')
  })

  it('没有残留的 TS 插值占位符', () => {
    expect(script).not.toContain('undefined')
    expect(script).not.toContain('${args')
  })
})

describe('buildPowerShellCommand', () => {
  it('路径全部加引号，参数名齐全', () => {
    const command = buildPowerShellCommand({
      scriptPath: 'C:/tmp/bgm-update.ps1',
      targetDirectory: 'C:/jsaddons/my plugin',
      base64Path: 'C:/tmp/bgm-update.b64',
      zipUrl: 'https://example.com/a.zip',
      logPath: 'C:/tmp/bgm-update.log',
      version: '2.2.3',
    })
    expect(command.startsWith('powershell -NoProfile -ExecutionPolicy Bypass')).toBe(true)
    expect(command).toContain('-File "C:/tmp/bgm-update.ps1"')
    expect(command).toContain('-TargetDir "C:/jsaddons/my plugin"')
    expect(command).toContain('-Base64Path "C:/tmp/bgm-update.b64"')
    expect(command).toContain('-ZipUrl "https://example.com/a.zip"')
    expect(command).toContain('-LogPath "C:/tmp/bgm-update.log"')
    expect(command).toContain('-NewVersion "2.2.3"')
  })
})

describe('temporaryDirectory', () => {
  it('取 FSO 的 TemporaryFolder', () => {
    stubWps()
    expect(temporaryDirectory()).toBe(FAKE_TEMPORARY_DIRECTORY)
  })

  it('没有 FSO 时返回 null', () => {
    expect(temporaryDirectory()).toBeNull()
  })
})

describe('countUnsavedDocuments', () => {
  it('统计 Saved=false 的文档数', () => {
    stubDocuments([true, false, false], 'wps')
    expect(countUnsavedDocuments()).toBe(2)
  })

  it('全部已保存时返回 0（允许安装）', () => {
    stubDocuments([true, true], 'wps')
    expect(countUnsavedDocuments()).toBe(0)
  })

  it('宿主把集合挂在 window.Application 上也能读到', () => {
    stubDocuments([false], 'Application')
    expect(countUnsavedDocuments()).toBe(1)
  })

  it('没有文档集合时返回 null（无法判断）', () => {
    stubWps()
    expect(countUnsavedDocuments()).toBeNull()
  })

  it('单个文档读取抛错不影响其余统计', () => {
    const items = [{ Saved: true }, null, { Saved: false }]
    clearHost()
    ;(window as unknown as Record<string, unknown>).wps = {
      Workbooks: {
        Count: 3,
        Item: (index: number) => {
          if (index === 2) throw new Error('COM busy')
          return items[index - 1] ?? null
        },
      },
    }
    expect(countUnsavedDocuments()).toBe(1)
  })
})

describe('launchDetachedCommand / quitWps', () => {
  it('宿主提供 ShellExecute 时透传命令行', () => {
    const { shell } = stubWps()
    launchDetachedCommand('powershell -File x.ps1')
    expect(shell).toHaveBeenCalledWith('powershell -File x.ps1')
  })

  it('宿主不提供 ShellExecute 时抛错（由调用方降级）', () => {
    stubWps({ withShell: false })
    expect(() => {
      launchDetachedCommand('x')
    }).toThrow(/ShellExecute/u)
  })

  it('Quit 不可用时抛错，可用时调用一次', () => {
    expect(() => {
      quitWps()
    }).toThrow(/Quit/u)
    const { quit } = stubWps()
    quitWps()
    expect(quit).toHaveBeenCalledTimes(1)
  })
})

describe('runAutoInstall', () => {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])

  it('非本地安装（http 基址）→ unsupported', () => {
    stubWps()
    const outcome = runAutoInstall({
      baseUrl: 'http://localhost:3889',
      version: 'v2.2.3',
      bytes,
      downloadUrl: 'https://example.com/a.zip',
    })
    expect(outcome.status).toBe('unsupported')
    expect(outcome.targetDirectory).toBe('')
  })

  it('没有 FSO → unsupported', () => {
    const outcome = runAutoInstall({
      baseUrl: 'file:///C:/jsaddons/p',
      version: 'v2.2.3',
      bytes,
      downloadUrl: '',
    })
    expect(outcome.status).toBe('unsupported')
    expect(outcome.detail).toContain('临时目录')
  })

  it('没有 ShellExecute → failed', () => {
    stubWps({ withShell: false })
    const outcome = runAutoInstall({
      baseUrl: 'file:///C:/jsaddons/p',
      version: 'v2.2.3',
      bytes,
      downloadUrl: '',
    })
    expect(outcome.status).toBe('failed')
    expect(outcome.targetDirectory).toBe(ADDIN_ROOT)
  })

  it('正常路径：写 base64（ANSI）+ 脚本（UTF-16），命令行带目标目录与版本', () => {
    const { createTextFile, shell } = stubWps()
    const outcome = runAutoInstall({
      baseUrl: 'file:///C:/jsaddons/p',
      version: 'v2.2.3',
      bytes,
      downloadUrl: 'https://example.com/a.zip',
    })

    expect(outcome.status).toBe('launched')
    expect(outcome.targetDirectory).toBe(ADDIN_ROOT)
    expect(outcome.scriptPath).toContain('bgm-update-v2.2.3.ps1')
    expect(outcome.logPath).toContain('bgm-update-v2.2.3.log')

    // 两次写入：base64 走 ANSI(false)，脚本走 UTF-16(true)
    expect(createTextFile).toHaveBeenCalledTimes(2)
    expect(createTextFile.mock.calls[0]?.[2]).toBe(false)
    expect(createTextFile.mock.calls[1]?.[2]).toBe(true)
    expect(String(createTextFile.mock.calls[0]?.[0])).toContain('.b64')

    const command = String(shell.mock.calls[0]?.[0])
    expect(command).toContain(`-TargetDir "${ADDIN_ROOT}"`)
    expect(command).toContain('-NewVersion "2.2.3"')
    expect(command).toContain('-ZipUrl "https://example.com/a.zip"')
  })
})
