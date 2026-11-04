/**
 * @fileoverview 插件市场：拉清单、下载、校验、落盘、卸载
 * @module plugins/pluginMarket
 * @description 全部网络与文件操作集中在这里，页面只调用本模块导出的三个动作
 *   （`fetchPluginManifest` / `installPlugin` / `uninstallPlugin`）。
 *
 *   三个硬约束（都来自真机实测，见 `文档/插件市场.md` §1）：
 *   1. 插件必须是 ESM 单文件 —— 安装态页面只有 `import()` 能读本地代码；
 *   2. 落盘只能走 FSO，而 FSO 写不了 UTF-8 → 写前把非 ASCII 转成 `\uXXXX`；
 *   3. 下载到的字节必须与清单的 `sha256` + `size` 一致，否则拒装。
 */
import { LOG_LEVELS } from '../core/constants.js'

import { bgmLog, getApp } from '../tools/util/index.js'
import { canWriteTextFile, ensureDirectory } from '../tools/save-file.js'
import {
  parsePluginManifest,
  pluginSourceBaseUrl,
  PLUGIN_ENTRY_FILE,
  PLUGIN_MANIFEST_FILE,
} from './plugin-manifest.js'
import { findPluginRecord, removePluginRecord, upsertPluginRecord } from './plugin-store.js'
import { verifyPluginSignature } from './plugin-signature.js'
import type {
  InstalledPluginRecord,
  PluginManifest,
  PluginPermission,
  PluginSignatureStatus,
  PluginSource,
} from './plugin-types.js'

/** 插件目录名（位于加载项目录下） */
export const PLUGIN_DIRECTORY = 'plugins'

/** 安装/更新失败的原因（界面直接展示，属动态内容，不进语言包） */
export interface PluginOperationFailure {
  ok: false
  reason: string
  /** 仅因「签名未通过且未授权无视风险」而失败时为 true，界面据此换按钮文案 */
  requiresTrust?: boolean
}

export type PluginManifestFetchResult =
  | PluginOperationFailure
  | {
      ok: true
      manifest: PluginManifest
      baseUrl: string
      signatureStatus: PluginSignatureStatus
    }

export type PluginInstallResult =
  | PluginOperationFailure
  | {
      ok: true
      manifest: PluginManifest
      pendingPermissions: PluginPermission[]
      signatureStatus: PluginSignatureStatus
    }

/** 安装选项 */
export interface PluginInstallOptions {
  /**
   * 允许安装未通过验签的插件。
   *
   * 只有界面在用户点过「无视风险安装」并二次确认后才置 true —— 调用方绝不能默认给 true。
   */
  allowUntrusted?: boolean
}

/** 把任意错误收成一行可读文本 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 签名结论的中文说明（失败原因里内联用，界面另有徽标） */
export function describeSignatureStatus(status: PluginSignatureStatus): string {
  if (status === 'verified') return '作者签名已验证'
  if (status === 'unsigned') return '作者未签名'
  if (status === 'untrusted-key') return '签名用的公钥不在 MBD 内置的可信列表里'
  if (status === 'unsupported') return '当前环境没有 WebCrypto，无法验证签名'
  return '签名校验失败，清单可能被改动过'
}

/** 把 `file:///D:/a/b` 转成 Windows 路径 `D:\a\b` */
export function fileUrlToPath(url: URL): string {
  const decoded = decodeURIComponent(url.pathname)
  const withoutLeadingSlash = decoded.replace(/^\/+/, '')
  return withoutLeadingSlash.split('/').join('\\')
}

/** 插件根目录（`<加载项目录>/plugins/`） */
export function pluginRootUrl(rootUrl: URL): URL {
  return new URL(`${PLUGIN_DIRECTORY}/`, rootUrl)
}

/** 某个插件的目录 URL */
export function pluginDirectoryUrl(rootUrl: URL, id: string): URL {
  return new URL(`${id}/`, pluginRootUrl(rootUrl))
}

/** 某个插件的入口 URL（用于 `import()`） */
export function pluginEntryUrl(rootUrl: URL, id: string): string {
  return new URL(PLUGIN_ENTRY_FILE, pluginDirectoryUrl(rootUrl, id)).href
}

/**
 * 把源码里的非 ASCII 字符转成 `\uXXXX` 转义。
 *
 * 为什么必须转：FSO 的 `CreateTextFile` 只能写 UTF-16LE / 系统 ANSI，写不了 UTF-8，
 * 而 `.js` 模块必须按 UTF-8 解析 —— 转义后整份源码是纯 ASCII，两种编码下逐字节相同。
 * 代理对（emoji）走 `\u{...}`，仍是合法 ES 语法。
 */
export function toAsciiSource(text: string): string {
  const parts: string[] = []
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    const isPrintable = code >= 0x20 && code <= 0x7e
    const isWhitespace = [0x09, 0x0a, 0x0d].includes(code)
    if (isPrintable || isWhitespace) {
      parts.push(character)
    } else if (code > 0xffff) {
      parts.push(String.raw`\u{${code.toString(16)}}`)
    } else {
      parts.push(String.raw`\u${code.toString(16).padStart(4, '0')}`)
    }
  }
  return parts.join('')
}

/** 计算字节的 sha256（小写十六进制） */
export async function sha256HexOfBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 带超时的 GET（文本） */
async function fetchText(url: string, timeoutMilliseconds = 20_000): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMilliseconds)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)} ${url}`)
    }
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

/** 带超时的 GET（字节） */
async function fetchBytes(
  url: string,
  timeoutMilliseconds = 30_000,
): Promise<Uint8Array<ArrayBuffer>> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMilliseconds)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)} ${url}`)
    }
    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 拉取并校验插件清单。
 *
 * @param source 用户填写的来源
 * @param hostVersion 宿主版本（判 `minHostVersion`）
 */
export async function fetchPluginManifest(
  source: PluginSource,
  hostVersion: string,
): Promise<PluginManifestFetchResult> {
  const baseUrl = pluginSourceBaseUrl(source)
  if (baseUrl === '') {
    return { ok: false, reason: '来源格式不对：填 owner/repo 或 https:// 开头的地址' }
  }
  let text: string
  try {
    text = await fetchText(`${baseUrl}/${PLUGIN_MANIFEST_FILE}`)
  } catch (error: unknown) {
    return { ok: false, reason: `取不到 plugin.json：${describeError(error)}` }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error: unknown) {
    return { ok: false, reason: `plugin.json 不是合法 JSON：${describeError(error)}` }
  }
  const parsed = parsePluginManifest(raw, hostVersion)
  if (!parsed.ok) {
    return { ok: false, reason: parsed.errors.join('；') }
  }
  const signatureStatus = await verifyPluginSignature(parsed.manifest)
  return { ok: true, manifest: parsed.manifest, baseUrl, signatureStatus }
}

/**
 * 安装（或升级）插件。
 *
 * 步骤：取清单 → 验签 → 下载入口文件 → 校验 size/sha256 → 转 ASCII → 落盘 → 写索引。
 * 任何一步失败都不会留下半装状态（先写文件再写索引，索引写失败会清掉文件）。
 *
 * @param rootUrl 加载项目录的 URL（`<root>/ui/` 的上一级）
 * @param source 来源
 * @param hostVersion 宿主版本
 * @param options 安装选项（`allowUntrusted` 只在用户确认过风险后由界面置 true）
 */
export async function installPlugin(
  rootUrl: URL,
  source: PluginSource,
  hostVersion: string,
  options: PluginInstallOptions = {},
): Promise<PluginInstallResult> {
  const fetched = await fetchPluginManifest(source, hostVersion)
  if (!fetched.ok) return fetched

  const { manifest, baseUrl, signatureStatus } = fetched
  if (signatureStatus !== 'verified' && options.allowUntrusted !== true) {
    return {
      ok: false,
      requiresTrust: true,
      reason: `签名未通过（${describeSignatureStatus(signatureStatus)}），需要确认后重试`,
    }
  }

  const expected = manifest.checksum[PLUGIN_ENTRY_FILE]
  if (expected === undefined) {
    return { ok: false, reason: `清单缺少 ${PLUGIN_ENTRY_FILE} 的 checksum` }
  }

  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = await fetchBytes(`${baseUrl}/${manifest.entry}`)
  } catch (error: unknown) {
    return { ok: false, reason: `下载插件失败：${describeError(error)}` }
  }

  if (bytes.byteLength !== expected.size) {
    return {
      ok: false,
      reason: `文件大小不符（清单 ${String(expected.size)}，实际 ${String(bytes.byteLength)}）`,
    }
  }
  const actualSha = await sha256HexOfBytes(bytes)
  if (actualSha !== expected.sha256) {
    return { ok: false, reason: '校验失败：文件内容与清单的 sha256 不一致' }
  }

  const directory = pluginDirectoryUrl(rootUrl, manifest.id)
  const directoryPath = fileUrlToPath(directory)
  if (!ensureDirectory(directoryPath)) {
    return { ok: false, reason: `无法创建插件目录：${directoryPath}` }
  }

  const sourceText = new TextDecoder('utf-8').decode(bytes)
  const asciiSource = toAsciiSource(sourceText)
  if (!canWriteTextFile(`${directoryPath}\\${PLUGIN_ENTRY_FILE}`, asciiSource, false)) {
    return { ok: false, reason: '写入插件文件失败（FSO 不可用或没有写权限）' }
  }
  const manifestText = toAsciiSource(JSON.stringify(manifest, null, 2))
  canWriteTextFile(`${directoryPath}\\${PLUGIN_MANIFEST_FILE}`, manifestText, false)

  const previous = findPluginRecord(manifest.id)
  const previousPermissions = previous?.permissions ?? []
  const addedPermissions = manifest.permissions.filter(
    (permission) => !previousPermissions.includes(permission),
  )

  const record: InstalledPluginRecord = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    source,
    enabled: previous?.enabled ?? true,
    installedAt: previous?.installedAt ?? new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    permissions: manifest.permissions,
    signatureStatus,
  }
  if (addedPermissions.length > 0) {
    record.pendingPermissions = addedPermissions
  }
  // 白名单要跟着索引走：下次开页面用索引重建清单，没有它 net.fetch 会全被拒
  if (manifest.network !== undefined) record.network = [...manifest.network]
  // 三项版本信息也要跟着索引走：页面重载后「已安装」列表只认索引，不认远程清单
  record.minHostVersion = manifest.minHostVersion
  if (manifest.dataSourceVersion !== undefined) {
    record.dataSourceVersion = manifest.dataSourceVersion
  }
  upsertPluginRecord(record)
  if (findPluginRecord(manifest.id) === null) {
    return { ok: false, reason: '写入插件索引失败（PluginStorage 不可用）' }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[plugins] 已安装 ${manifest.id} v${manifest.version}（${String(bytes.byteLength)} 字节，${describeSignatureStatus(signatureStatus)}）`,
  )
  return { ok: true, manifest, pendingPermissions: addedPermissions, signatureStatus }
}

/**
 * 用 FSO 递归删目录（失败返回 false，由调用方提示「请手动删除」）
 */
export function deletePluginDirectory(directoryPath: string): void {
  try {
    const { wps } = window as unknown as {
      wps?: { OAAssist?: { CoCreateInstance?: (progId: string) => unknown } }
    }
    const coCreate = wps?.OAAssist?.CoCreateInstance
    if (typeof coCreate !== 'function') return
    const fso = coCreate('Scripting.FileSystemObject') as
      | {
          FolderExists?: (path: string) => boolean
          DeleteFolder?: (path: string, isForced?: boolean) => void
        }
      | undefined
    if (fso === undefined) return
    const { FolderExists, DeleteFolder } = fso
    if (typeof FolderExists !== 'function' || typeof DeleteFolder !== 'function') return
    if (!FolderExists.call(fso, directoryPath)) return
    DeleteFolder.call(fso, directoryPath, true)
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[plugins] 删除目录失败(${directoryPath})：${describeError(error)}`)
  }
}

/**
 * 卸载插件：删目录 + 删索引 + 清私有存储。
 *
 * @returns 是否完全成功；目录删不掉时返回 `{ ok: false }` 但索引仍会清掉
 *   （用户下次打开市场页看不到它，残留目录不影响运行）
 */
export function uninstallPlugin(rootUrl: URL, id: string): { ok: boolean; reason?: string } {
  const record = findPluginRecord(id)
  if (record === null) return { ok: false, reason: '插件未安装' }
  const directoryPath = fileUrlToPath(pluginDirectoryUrl(rootUrl, id))
  deletePluginDirectory(directoryPath)
  removePluginRecord(id)
  clearPluginStorage(id)
  bgmLog(LOG_LEVELS.INFO, `[plugins] 已卸载 ${id}（目录：${directoryPath}）`)
  return { ok: true }
}

/**
 * 清掉插件的私有存储键（`plugin:<id>:*`）。
 *
 * 宿主的 `PluginStorage` 没有枚举能力，所以靠 `createPluginStorage` 维护的
 * `plugin:<id>:#keys` 登记表来定位 —— 没有这张表就只能清掉登记表本身，
 * 残留的键不影响任何功能（插件 id 唯一，重装后新插件也看不到旧键）。
 */
function clearPluginStorage(id: string): void {
  try {
    const storage = getApp()?.PluginStorage
    if (storage === undefined) return
    const prefix = `plugin:${id}:`
    const registryKey = `${prefix}#keys`
    const raw = storage.getItem(registryKey)
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          for (const key of parsed) {
            if (typeof key === 'string') storage.removeItem(prefix + key)
          }
        }
      } catch {
        // 登记表坏掉就当没有，继续删登记表本身
      }
    }
    storage.removeItem(registryKey)
  } catch {
    // 存储清理失败不影响卸载
  }
}
