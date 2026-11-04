/**
 * @fileoverview 插件清单的解析、校验与来源地址拼接
 * @module plugins/pluginManifest
 * @description 纯函数层：把 `plugin.json` 的原始 JSON 校验成 `PluginManifest`，
 *   以及把用户填写的来源（`owner/repo` / base URL / 本地目录）拼成可下载的地址。
 *
 *   校验顺序与失败原因严格对应 `PLUGIN-SPEC.md` §3.2 —— 少一条就会出现
 *   「装上了但加载不了」的黑盒，所以这里宁可多报一条也不放过。
 */

import { compareVersions, parseVersion } from '../tools/update-check.js'
import {
  PLUGIN_PERMISSIONS,
  PLUGIN_SCHEMA_VERSION,
  PLUGIN_SIGNATURE_ALGORITHM,
} from './plugin-types.js'
import type {
  PluginFileChecksum,
  PluginFeature,
  PluginManifest,
  PluginManifestResult,
  PluginPermission,
  PluginSignature,
  PluginSource,
} from './plugin-types.js'

/** 宿主插件 API 版本。插件按 MAJOR 判兼容（`PLUGIN-SPEC.md` §8）。 */
export const HOST_PLUGIN_API_VERSION = '1.0.0'

/** `plugin.json` 在仓库里的固定文件名 */
export const PLUGIN_MANIFEST_FILE = 'plugin.json'

/** 插件入口的固定文件名（清单里的 `entry` 也必须是它） */
export const PLUGIN_ENTRY_FILE = 'plugin.js'

/**
 * 校验插件 id 形态：小写字母/数字分段，用单个连字符连接。
 *
 * 不用 `^[a-z0-9]+(?:-[a-z0-9]+)*$` 那种嵌套量词正则（`security/detect-unsafe-regex`
 * 会判成灾难性回溯），改成「字符集 + 边界断言」两段式，语义等价且线性。
 */
function isValidPluginId(text: string): boolean {
  if (text === '' || text.startsWith('-') || text.endsWith('-') || text.includes('--')) {
    return false
  }
  return /^[a-z0-9-]+$/.test(text)
}

/** 是不是一个普通对象（排除 null / 数组） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读一个非空字符串字段 */
function readRequiredString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** 读可选字符串字段 */
function readOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 校验 `version` / `apiVersion` / `minHostVersion` 的形态 */
function isValidVersion(text: string): boolean {
  const parts = parseVersion(text)
  return parts.length >= 2 && parts.every((part) => Number.isFinite(part) && part >= 0)
}

/** 只取版本号的主版本 */
function majorOf(version: string): number {
  return parseVersion(version)[0] ?? 0
}

/** 解析权限数组：未知权限视为错误（不静默丢弃，否则作者以为生效了） */
function readPermissions(
  source: Record<string, unknown>,
  errors: string[],
): PluginPermission[] | null {
  const raw = source.permissions
  if (!Array.isArray(raw)) {
    errors.push('permissions 必须是数组（没有权限也要写 []）')
    return null
  }
  const known = new Set<string>(PLUGIN_PERMISSIONS)
  const result: PluginPermission[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || !known.has(item)) {
      errors.push(`permissions 里有未知权限：${String(item)}`)
      return null
    }
    if (!result.includes(item as PluginPermission)) {
      result.push(item as PluginPermission)
    }
  }
  return result
}

/** 解析域名白名单 */
function readNetwork(source: Record<string, unknown>, errors: string[]): string[] | undefined {
  const raw = source.network
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    errors.push('network 必须是字符串数组')
    return undefined
  }
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') {
      errors.push('network 里存在空项')
      return undefined
    }
    result.push(item.trim().toLowerCase())
  }
  return result
}

/** 解析功能清单 */
function readFeatures(source: Record<string, unknown>): PluginFeature[] | undefined {
  const raw = source.features
  if (!Array.isArray(raw)) return undefined
  const result = raw
    .filter(isRecord)
    .map((item) => {
      const key = readOptionalString(item, 'key')
      const name = readOptionalString(item, 'name')
      if (key === undefined || name === undefined) return null
      return { key, name, description: readOptionalString(item, 'description') ?? '' }
    })
    .filter((item): item is PluginFeature => item !== null)
  return result.length > 0 ? result : undefined
}

/** 解析 checksum 表 */
function readChecksum(
  source: Record<string, unknown>,
  errors: string[],
): Record<string, PluginFileChecksum> | null {
  const raw = source.checksum
  if (!isRecord(raw)) {
    errors.push('checksum 缺失或不是对象')
    return null
  }
  const result: Record<string, PluginFileChecksum> = {}
  for (const [file, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      errors.push(`checksum.${file} 不是对象`)
      return null
    }
    const sha256 = readRequiredString(value, 'sha256')
    const { size } = value
    if (sha256 === null || typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      errors.push(`checksum.${file} 需要 sha256（64 位十六进制）与 size（正整数）`)
      return null
    }
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      errors.push(`checksum.${file}.sha256 必须是 64 位小写十六进制`)
      return null
    }
    result[file] = { sha256, size }
  }
  return Object.keys(result).length > 0 ? result : null
}

/** 读签名块（只做形态校验，真伪由 `plugin-signature` 验） */
function readSignature(
  source: Record<string, unknown>,
  errors: string[],
): PluginSignature | undefined {
  const raw = source.signature
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    errors.push('signature 必须是对象')
    return undefined
  }
  const algorithm = readRequiredString(raw, 'algorithm')
  const keyId = readRequiredString(raw, 'keyId')
  const value = readRequiredString(raw, 'value')
  if (algorithm === null || keyId === null || value === null) {
    errors.push('signature 需要 algorithm / keyId / value 三个字符串字段')
    return undefined
  }
  if (algorithm !== PLUGIN_SIGNATURE_ALGORITHM) {
    errors.push(`signature.algorithm 只支持 ${PLUGIN_SIGNATURE_ALGORITHM}`)
    return undefined
  }
  return { algorithm, keyId, value }
}

/**
 * 按 UTF-16 码位比较字符串。
 *
 * 待签名串里的排序必须与区域设置无关 —— 用 `localeCompare` 会让同一个清单
 * 在不同语言的机器上算出不同的签名内容。
 */
function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * 生成待签名字符串（签名与验签双方必须逐字节一致，见 `PLUGIN-SPEC.md` §7）。
 *
 * 只覆盖「决定插件能做什么」的字段：身份、版本、入口、权限、域名白名单、文件校验值。
 * `name` / `description` / `features` 不参与签名 —— 改文案不该导致重签，而它们
 * 被篡改最多让界面显示错乱，不会改变插件的行为边界。
 */
export function pluginSignaturePayload(manifest: PluginManifest): string {
  const checksumParts: string[] = []
  for (const file of Object.keys(manifest.checksum).sort(compareCodeUnits)) {
    const entry = manifest.checksum[file]
    if (entry !== undefined) checksumParts.push(`${file}:${entry.sha256}:${String(entry.size)}`)
  }
  const permissions = [...manifest.permissions].sort(compareCodeUnits).join(',')
  const network = [...(manifest.network ?? [])].sort(compareCodeUnits).join(',')
  return [
    'mbd-plugin',
    `id:${manifest.id}`,
    `version:${manifest.version}`,
    `apiVersion:${manifest.apiVersion}`,
    `minHostVersion:${manifest.minHostVersion}`,
    `entry:${manifest.entry}`,
    `permissions:${permissions}`,
    `network:${network}`,
    `checksum:${checksumParts.join(',')}`,
  ].join('\n')
}

/**
 * 校验并归一化插件清单。
 *
 * @param input `JSON.parse` 之后的原始值
 * @param hostVersion 宿主版本（判 `minHostVersion`），默认取 `CURRENT_VERSION` 之外传入，
 *   便于单测注入
 * @returns 校验通过返回归一化后的清单，否则返回全部错误（一次报全，不让作者反复试）
 */
export function parsePluginManifest(input: unknown, hostVersion: string): PluginManifestResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ['plugin.json 不是 JSON 对象'] }
  }
  const errors: string[] = []

  if (input.schemaVersion !== PLUGIN_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion 必须是 ${String(PLUGIN_SCHEMA_VERSION)}（收到 ${String(input.schemaVersion)}）`,
    )
  }

  const id = readRequiredString(input, 'id')
  if (id === null) {
    errors.push('缺少 id')
  } else if (!isValidPluginId(id)) {
    errors.push('id 只能用小写字母、数字与连字符（如 hmoe-new-anime）')
  }

  const name = readRequiredString(input, 'name')
  if (name === null) errors.push('缺少 name')

  const version = readRequiredString(input, 'version')
  if (version === null) {
    errors.push('缺少 version')
  } else if (!isValidVersion(version)) {
    errors.push('version 必须是语义化版本，如 1.2.0')
  }

  const apiVersion = readRequiredString(input, 'apiVersion')
  if (apiVersion === null) {
    errors.push('缺少 apiVersion')
  } else if (!isValidVersion(apiVersion)) {
    errors.push('apiVersion 必须是语义化版本，如 1.0.0')
  } else if (majorOf(apiVersion) !== majorOf(HOST_PLUGIN_API_VERSION)) {
    errors.push(
      `apiVersion 主版本需为 ${String(majorOf(HOST_PLUGIN_API_VERSION))}.x（收到 ${apiVersion}）`,
    )
  }

  const minHostVersion = readRequiredString(input, 'minHostVersion')
  if (minHostVersion === null) {
    errors.push('缺少 minHostVersion')
  } else if (!isValidVersion(minHostVersion)) {
    errors.push('minHostVersion 必须是语义化版本')
  } else if (compareVersions(minHostVersion, hostVersion) > 0) {
    errors.push(`需要 MBD ≥ ${minHostVersion}（当前 ${hostVersion}）`)
  }

  const description = readRequiredString(input, 'description')
  if (description === null) errors.push('缺少 description')

  const author = readRequiredString(input, 'author')
  if (author === null) errors.push('缺少 author')

  const entry = readRequiredString(input, 'entry') ?? PLUGIN_ENTRY_FILE
  if (entry !== PLUGIN_ENTRY_FILE) {
    errors.push(`entry 目前只支持 ${PLUGIN_ENTRY_FILE}`)
  }

  const permissions = readPermissions(input, errors)
  const network = readNetwork(input, errors)
  if (permissions?.includes('net.fetch') && (network === undefined || network.length === 0)) {
    errors.push('声明了 net.fetch 就必须在 network 里列出允许访问的域名')
  }

  const checksum = readChecksum(input, errors)
  if (checksum !== null && checksum[PLUGIN_ENTRY_FILE] === undefined) {
    errors.push(`checksum 必须包含 ${PLUGIN_ENTRY_FILE}`)
  }
  const signature = readSignature(input, errors)

  if (errors.length > 0) return { ok: false, errors }
  if (
    id === null ||
    name === null ||
    version === null ||
    apiVersion === null ||
    minHostVersion === null ||
    description === null ||
    author === null ||
    permissions === null ||
    checksum === null
  ) {
    return { ok: false, errors: ['清单字段不完整'] }
  }

  const updatePolicyRaw = readOptionalString(input, 'updatePolicy')
  const updatePolicy =
    updatePolicyRaw === 'manual' || updatePolicyRaw === 'auto' ? updatePolicyRaw : 'auto'

  const manifest: PluginManifest = {
    schemaVersion: PLUGIN_SCHEMA_VERSION,
    id,
    name,
    version,
    apiVersion,
    minHostVersion,
    description,
    author,
    entry,
    permissions,
    checksum,
    updatePolicy,
  }
  const homepage = readOptionalString(input, 'homepage')
  if (homepage !== undefined) manifest.homepage = homepage
  const license = readOptionalString(input, 'license')
  if (license !== undefined) manifest.license = license
  if (network !== undefined) manifest.network = network
  const features = readFeatures(input)
  if (features !== undefined) manifest.features = features
  if (signature !== undefined) manifest.signature = signature

  return { ok: true, manifest }
}

/**
 * API 来源的地址校验：必须是 HTTPS，本地调试额外放行 `127.0.0.1` 的明文地址。
 *
 * 用 `URL` 解析而不是正则，避免 `security/detect-unsafe-regex` 与端口写法的边界问题。
 */
function isAllowedApiBaseUrl(text: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return false
  }
  if (parsed.protocol === 'https:') return true
  return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'
}

/**
 * 把用户填写的来源拼成 base URL（末尾不带斜杠）。
 *
 * - `github`：`owner/repo` → `https://raw.githubusercontent.com/owner/repo/main`
 * - `api`：原样返回（必须是 HTTPS，本地调试允许 `127.0.0.1` 的明文地址）
 * - `local`：返回空串（本地目录不走网络，由调用方直接读文件）
 */
export function pluginSourceBaseUrl(source: PluginSource): string {
  if (source.kind === 'github') {
    const trimmed = source.value.trim().replace(/^\/+|\/+$/g, '')
    if (!/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return ''
    return `https://raw.githubusercontent.com/${trimmed}/main`
  }
  if (source.kind === 'api') {
    const trimmed = source.value.trim().replace(/\/+$/, '')
    return isAllowedApiBaseUrl(trimmed) ? trimmed : ''
  }
  return ''
}

/**
 * 解析用户输入的来源。
 *
 * 判定顺序：完整 URL → API 模式；`owner/repo` → GitHub 仓库；其余（含盘符路径）→ 本地目录。
 * 本地来源只在开发者模式下可用，由调用方再判一次。
 */
export function parsePluginSource(text: string): PluginSource | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: 'api', value: trimmed }
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return { kind: 'github', value: trimmed }
  }
  return { kind: 'local', value: trimmed }
}

/**
 * 判断某个 URL 是否在插件声明的域名白名单内。
 *
 * 精确匹配域名；`*.example.com` 匹配它的所有子域（不含 `example.com` 本身）——
 * 同一注册域下的子域由同一个所有者控制，不再按层级收紧。与 `PLUGIN-SPEC.md` §5.3 一致。
 */
export function isHostAllowed(url: string, network: readonly string[] | undefined): boolean {
  if (network === undefined || network.length === 0) return false
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  for (const rule of network) {
    const normalized = rule.trim().toLowerCase()
    if (normalized === host) return true
    if (normalized.startsWith('*.')) {
      const suffix = normalized.slice(2)
      if (host !== suffix && host.endsWith(`.${suffix}`)) return true
    }
  }
  return false
}
