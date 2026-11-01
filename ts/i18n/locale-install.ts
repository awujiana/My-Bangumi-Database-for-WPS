/**
 * @fileoverview 语言包在线安装：下载 → 校验 → 转纯 ASCII → 落盘 → 立即生效
 * @module i18n/localeInstall
 *
 * @description
 *   语言包随插件发布（`viteStaticCopy` 的 `locales/**\/*.js` 白名单），正常情况下
 *   用户不需要这个模块。它解决的是两个真实场景：
 *
 *   1. **修复**：用户手动删过 / 覆盖过 `locales/<code>/`，界面一片 key 名；
 *   2. **追新**：修一处译文错字不该逼用户重装整个插件。
 *
 * ## 为什么落盘前必须把内容转成纯 ASCII（最容易踩的一脚）
 *
 *   写盘唯一的通道是 FSO 的 `CreateTextFile(path, isOverwrite, isUnicode)`，
 *   它只能写 **UTF-16 LE（带 BOM）** 或 **系统 ANSI**，**写不了 UTF-8**——
 *   而 `.js` 模块必须是 UTF-8，否则中文全是乱码、`import()` 直接语法错误。
 *
 *   绕法：把非 ASCII 字符全部转成 `\uXXXX`。转义后的文本仍是合法 JS
 *   （字符串里的转义语义不变，注释里只是普通字符），而 **ASCII 在 ANSI 代码页
 *   与 UTF-8 下逐字节相同**，编码问题就此消失。
 *
 * ## 校验只发生在「下载到写盘之间」
 *
 *   落盘后的字节与仓库里的字节必然不同（见上），所以清单里的 `sha256` / `bytes`
 *   只用来校验**下载到的内容**。这也是唯一有意义的时机：那一关挡的是
 *   「发布端被替换 / 代理返回了别的东西」。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { canWriteTextFile, ensureDirectory, joinPath } from '../tools/save-file.js'
import { resolveAddinDirectory } from '../tools/update-install.js'
import { verifyAssetIntegrity } from '../tools/update-check.js'
import type { IntegrityResult } from '../tools/update-check.js'
import { bgmLog, getApp } from '../tools/util/index.js'

import { fetchText, parseModuleJson, remoteLocaleModuleUrl } from './locale-manifest.js'
import type { FetchText, LocaleManifest, LocaleManifestEntry } from './locale-manifest.js'
import { getLocaleBundle, parseLocaleBundle, replaceLocaleBundle } from './locale-store.js'
import type { LocaleBundle } from './locale-store.js'
import type { LocaleCode } from './translate.js'

/** 纯 ASCII 判定（写盘前的最后一道确认） */
function isAsciiOnly(text: string): boolean {
  for (const character of text) {
    if ((character.codePointAt(0) ?? 0) > 0x7f) return false
  }
  return true
}

/**
 * 把一个 UTF-16 码元写成 `\uXXXX`
 *
 * 用 `String.raw` 而不是 `'\\u' + …`：这里要的是**字面量反斜杠**，
 * `String.raw` 的写法与最终产物逐字相同，不会被读成转义序列。
 */
function unicodeEscape(codeUnit: number): string {
  return String.raw`\u${codeUnit.toString(16).padStart(4, '0')}`
}

/**
 * 把一个非 ASCII 码点写成转义
 *
 * 补充平面（emoji 等）拆成代理对的两个转义，与 `JSON.stringify` 的写法一致。
 */
function escapeCodePoint(codePoint: number): string {
  if (codePoint <= 0xff_ff) return unicodeEscape(codePoint)
  const offset = codePoint - 0x1_00_00
  const high = 0xd8_00 + (offset >> 10)
  const low = 0xdc_00 + (offset & 0x3_ff)
  return [high, low].map((unit) => unicodeEscape(unit)).join('')
}

/**
 * 把模块源码转成**纯 ASCII**
 *
 * 只做字符替换，不动结构：`export default {…};` 的外壳、注释、缩进全部原样保留。
 *
 * 为什么保留注释里的中文（转义后成为 `\u4e2d` 这种字面量）：注释不参与解析，
 * 删掉反而要写一个能识别注释的词法分析器，风险更大。转义它零风险。
 */
export function toAsciiModule(text: string): string {
  const parts: string[] = []
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    parts.push(codePoint <= 0x7f ? character : escapeCodePoint(codePoint))
  }
  return parts.join('')
}

/**
 * 转义后再解析一遍，确认语义没变
 *
 * 转义写错（比如把 `\` 也吃了、或者代理对算错）会让用户装上一个**坏语言包**，
 * 而那时界面只会退回中文，看不出是安装器干的。这一步是纯函数级的自证：
 * 转义前后 `JSON.stringify` 的结果必须逐字相同。
 */
export function isAsciiRoundTripSafe(original: unknown, escaped: string): boolean {
  if (!isAsciiOnly(escaped)) return false
  const reparsed = parseModuleJson(escaped)
  if (reparsed === null) return false
  return JSON.stringify(reparsed) === JSON.stringify(original)
}

/** 单个语言的安装结果 */
export interface LocaleInstallReport {
  /** 语言代码 */
  code: LocaleCode
  /** 是否写盘成功 */
  status: 'installed' | 'failed'
  /** 给用户看的一句话（成功时是版本号，失败时是原因） */
  detail: string
}

/** 整次安装的结果 */
export interface LocaleInstallOutcome {
  /** installed = 全部成功；partial = 部分成功；failed = 一个都没成；unsupported = 环境不支持 */
  status: 'installed' | 'partial' | 'failed' | 'unsupported'
  /** 给用户看的一句话说明 */
  detail: string
  /** 加载项目录（unsupported 时为空串） */
  directory: string
  /** 逐语言结果 */
  reports: LocaleInstallReport[]
}

/** 安装选项 */
export interface InstallLocalePacksOptions {
  /** 插件基址（`getUrlPath()` 的返回值） */
  baseUrl: string
  /** 已加载的清单（决定装哪些语言、按什么哈希校验） */
  manifest: LocaleManifest
  /** 注入的 fetch（测试用；生产环境由调用方传 `fetch`） */
  fetchFunction: FetchText
  /** 注入的 WebCrypto（测试用；不传则用全局的） */
  subtle?: SubtleCrypto | null
}

/** 取错误信息的字符串形式 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 哈希只显示前 8 位：完整 64 位放在界面上没人看，日志里有完整的 */
function shortHash(hash: string): string {
  return hash.slice(0, 8)
}

/**
 * 装一个语言
 *
 * 顺序刻意如此：**先校验字节，再解析**。哈希不对的字节连 `JSON.parse` 都不做，
 * 免得给不可信内容任何被解析的机会。
 */
async function installOne(
  entry: LocaleManifestEntry,
  addinDirectory: string,
  options: InstallLocalePacksOptions,
  verify: (bytes: Uint8Array<ArrayBuffer>, expected: string) => Promise<IntegrityResult>,
): Promise<LocaleInstallReport> {
  const { code } = entry

  let text: string
  try {
    text = await fetchText(remoteLocaleModuleUrl(code), options.fetchFunction)
  } catch (error: unknown) {
    return { code, status: 'failed', detail: `下载失败：${messageOf(error)}` }
  }

  // ① 字节数：清单说多大就该多大，差一个字节都不写
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength !== entry.bytes) {
    return {
      code,
      status: 'failed',
      detail: `大小不一致（清单 ${String(entry.bytes)} 字节，实际 ${String(bytes.byteLength)} 字节）`,
    }
  }

  // ② SHA-256：这一关挡的是「发布端被替换」或「代理塞了别的东西」
  const integrity = await verify(bytes, entry.sha256)
  if (integrity.status !== 'verified') {
    const detail =
      integrity.status === 'mismatch'
        ? `SHA-256 不一致（清单 ${shortHash(integrity.expected)}…，实际 ${shortHash(integrity.actual)}…）`
        : '当前环境不支持 SHA-256，无法校验来源（可改用「打开语言包目录」手动放入）'
    return { code, status: 'failed', detail }
  }

  // ③ 结构：与加载时同一个校验器，避免「装进去了但加载被拒」的自相矛盾
  const raw = parseModuleJson(text)
  const bundle: LocaleBundle | null = parseLocaleBundle(raw, code)
  if (bundle === null) {
    return { code, status: 'failed', detail: '内容不是合法的语言包（结构或 schemaVersion 不符）' }
  }

  // ④ 转 ASCII 并自证语义未变
  const ascii = toAsciiModule(text)
  if (!isAsciiRoundTripSafe(raw, ascii)) {
    return { code, status: 'failed', detail: '转 ASCII 后语义发生变化，已放弃写入（程序缺陷）' }
  }

  // ⑤ 落盘：先确保目录（用户可能删过 locales/<code>/），再写
  const localeDirectory = joinPath(addinDirectory, `locales/${code}`)
  if (!ensureDirectory(localeDirectory)) {
    return { code, status: 'failed', detail: `无法创建目录 ${localeDirectory}` }
  }
  const filePath = joinPath(localeDirectory, 'locale.js')
  // isUnicode=false：内容已是纯 ASCII，走 ANSI 通道才不会被写成 UTF-16
  if (!canWriteTextFile(filePath, ascii, false)) {
    return { code, status: 'failed', detail: `无法写入 ${filePath}` }
  }

  // ⑥ 立刻生效：ESM 按 URL 缓存模块，重新 import 拿到的还是旧对象，
  //    所以把刚解析好的包直接塞进仓库（见 replaceLocaleBundle 的注释）
  replaceLocaleBundle(bundle)
  return { code, status: 'installed', detail: `${bundle.version}（${bundle.updatedAt}）` }
}

/**
 * 按清单安装 / 修复语言包
 *
 * 全部语言一起装，不做「只装当前语言」：三个包加起来约 110 KB，
 * 少一次分支就少一类「切过去才发现没装」的问题。
 *
 * @returns 逐语言结果；`unsupported` 表示当前环境根本没法写盘（开发期 HTTP）
 */
export async function installLocalePacks(
  options: InstallLocalePacksOptions,
): Promise<LocaleInstallOutcome> {
  const directory = resolveAddinDirectory(options.baseUrl)
  if (directory === null) {
    return {
      status: 'unsupported',
      detail: '当前环境无法定位加载项目录（开发期页面或非本地安装）',
      directory: '',
      reports: [],
    }
  }

  // 三元的写法是必须的：`subtle` 不传时要走 verifyAssetIntegrity 自己的默认值
  // （取全局 WebCrypto），传 null 才表示「明确没有」，两者不能混。
  const verify = (bytes: Uint8Array<ArrayBuffer>, expected: string): Promise<IntegrityResult> =>
    options.subtle === undefined
      ? verifyAssetIntegrity(bytes, expected)
      : verifyAssetIntegrity(bytes, expected, options.subtle)

  const reports: LocaleInstallReport[] = []
  for (const entry of options.manifest.locales) {
    reports.push(await installOne(entry, directory, options, verify))
  }

  const succeeded = reports.filter((report) => report.status === 'installed')
  const failed = reports.filter((report) => report.status === 'failed')
  const succeededList = succeeded.map((report) => report.code).join(' / ')
  const failedList = failed.map((report) => `${report.code}（${report.detail}）`).join('；')

  if (succeeded.length === 0) {
    bgmLog(LOG_LEVELS.ERROR, `[i18n] 语言包安装失败：${failedList}`)
    return {
      status: 'failed',
      detail: failedList === '' ? '清单里没有可安装的语言' : failedList,
      directory,
      reports,
    }
  }

  bgmLog(
    LOG_LEVELS.INFO,
    `[i18n] 语言包已安装：${succeededList}${failed.length > 0 ? `；失败 ${failedList}` : ''}（${directory}）`,
  )
  return {
    status: failed.length === 0 ? 'installed' : 'partial',
    detail:
      failed.length === 0
        ? `已更新 ${String(succeeded.length)} 个语言包：${succeededList}`
        : `已更新 ${String(succeeded.length)} 个（${succeededList}），${String(failed.length)} 个失败：${failedList}`,
    directory,
    reports,
  }
}

/**
 * 已装语言包的版本摘要（设置页状态行用）
 *
 * 只读内存里的包，不碰磁盘：`version` / `updatedAt` 就在语言包头上，
 * 加载过的语言直接取得到。
 */
export function describeInstalledPacks(codes: readonly LocaleCode[]): string {
  return codes
    .map((code) => {
      const bundle = getLocaleBundle(code)
      return bundle === undefined
        ? `${code} 未安装`
        : `${code} ${bundle.version}${bundle.updatedAt === '' ? '' : `（${bundle.updatedAt}）`}`
    })
    .join(' / ')
}

/** 打开语言包目录的结果 */
export interface OpenDirectoryOutcome {
  /** 是否已把「打开目录」交给宿主 */
  ok: boolean
  /** 目标目录（无法定位加载项时为空串） */
  directory: string
  /** 失败原因（成功时为空串） */
  detail: string
}

/**
 * 在资源管理器里打开语言包目录
 *
 * 为什么自己调 ShellExecute 而不用 `shellExecuteByOAAssist`：那个封装在宿主
 * 不支持时**静默什么都不做**，用户点一下按钮毫无反应、也拿不到任何提示。
 * 这里必须能区分「已打开」和「宿主不让开」。
 */
export function openLocaleDirectory(baseUrl: string): OpenDirectoryOutcome {
  const addinDirectory = resolveAddinDirectory(baseUrl)
  if (addinDirectory === null) {
    return {
      ok: false,
      directory: '',
      detail: '当前环境无法定位加载项目录（开发期页面或非本地安装）',
    }
  }
  const directory = joinPath(addinDirectory, 'locales')
  try {
    const app = getApp() as { OAAssist?: { ShellExecute?: (parameter: string) => void } } | null
    const shellExecute = app?.OAAssist?.ShellExecute
    if (typeof shellExecute !== 'function') {
      return { ok: false, directory, detail: '宿主未提供 OAAssist.ShellExecute' }
    }
    shellExecute.call(app?.OAAssist, directory)
    bgmLog(LOG_LEVELS.INFO, `[i18n] 已请求打开语言包目录：${directory}`)
    return { ok: true, directory, detail: '' }
  } catch (error: unknown) {
    const detail = messageOf(error)
    bgmLog(LOG_LEVELS.WARN, `[i18n] 打开语言包目录失败：${detail}`)
    return { ok: false, directory, detail }
  }
}
