/**
 * @fileoverview 插件系统的共享类型与权限表
 * @module plugins/pluginTypes
 * @description 定义插件清单结构、权限枚举与人类可读说明。本模块只含数据与纯函数，
 *   不依赖 WPS、不依赖 i18n 运行时 —— 权限说明走语言包 key，由界面层翻译，
 *   与 `sheet-cleaning` 的 `skippedReasonKey` 同一套思路。
 */

/** 清单格式版本。宿主遇到更高版本会拒绝安装并提示升级宿主。 */
export const PLUGIN_SCHEMA_VERSION = 1

/**
 * 插件可声明的权限。
 *
 * 顺序即界面展示顺序（读 → 写 → 联网 → 存储 → 界面），与 `PLUGIN-SPEC.md` §6 一致。
 */
export const PLUGIN_PERMISSIONS = [
  'sheet.read',
  'sheet.write',
  'data.read',
  'data.write',
  'net.fetch',
  'storage',
  'ui.toast',
  'ui.pane',
  'log',
] as const

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

/**
 * 权限 → 语言包 key 前缀。
 *
 * 界面用 `plugin.permission.<id>.name` / `.risk` 取译文；语言包缺 key 时退回
 * `PLUGIN_PERMISSION_FALLBACK` 的中文原文（与 `tOr` 的兜底策略一致）。
 */
export const PLUGIN_PERMISSION_KEY_PREFIX = 'plugin.permission.'

/** 权限的中文兜底文案（语言包未加载时显示） */
export const PLUGIN_PERMISSION_FALLBACK: Readonly<
  Record<PluginPermission, { name: string; risk: string }>
> = {
  'sheet.read': { name: '读取工作表', risk: '可以读取你工作簿里的任何内容' },
  'sheet.write': { name: '修改工作表', risk: '可以修改或删除你工作簿里的内容' },
  'data.read': { name: '读取番组数据', risk: '可以读取你的番组记录' },
  'data.write': { name: '修改番组数据', risk: '可以修改你的番组记录' },
  'net.fetch': { name: '联网访问', risk: '会联网访问清单里列出的域名' },
  storage: { name: '本地存储', risk: '会在本机保存插件自己的数据' },
  'ui.toast': { name: '界面提示', risk: '会弹出提示、确认框与进度条' },
  'ui.pane': { name: '打开宿主页面', risk: '可以打开 MBD 的其他页面' },
  log: { name: '写入日志', risk: '会往日志面板写内容' },
}

/** 清单里的功能条目（市场页展示「这个插件能干什么」） */
export interface PluginFeature {
  key: string
  name: string
  description: string
}

/** 单个文件的校验信息 */
export interface PluginFileChecksum {
  sha256: string
  size: number
}

/**
 * 唯一支持的签名算法。
 *
 * 选 ECDSA P-256 + SHA-256 而不是 Ed25519：WPS 内嵌的 CEF 版本不保证有 Ed25519，
 * 而 P-256 在 WebCrypto 里是必备算法。签名值用 IEEE P1363 的 raw `r||s`（64 字节），
 * 与 Node `crypto.sign(..., { dsaEncoding: 'ieee-p1363' })` 一致。
 */
export const PLUGIN_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256'

/** `plugin.json` 里的签名块（可选字段，缺省即「未签名」） */
export interface PluginSignature {
  algorithm: string
  /** 宿主内置公钥表的键；不认识的 keyId 一律当「不可信」 */
  keyId: string
  /** base64 的签名值 */
  value: string
}

/**
 * 签名校验结论。
 *
 * - `verified`：可信作者，可直接安装
 * - `unsigned`：清单里没有签名块
 * - `untrusted-key`：有签名，但 `keyId` 不在宿主内置公钥表里
 * - `invalid`：验签失败（清单被改过或签名不是这把私钥签的）
 * - `unsupported`：环境没有 WebCrypto，无法验证
 *
 * 除 `verified` 外都要求用户点「无视风险安装」二次确认。
 */
export type PluginSignatureStatus =
  'verified' | 'unsigned' | 'untrusted-key' | 'invalid' | 'unsupported'

/** 插件清单（`plugin.json`） */
export interface PluginManifest {
  schemaVersion: number
  id: string
  name: string
  version: string
  apiVersion: string
  minHostVersion: string
  /**
   * 插件自带数据源的版本（如 `2026H2-2026-11-04`）。
   *
   * 与 `version`（插件代码版本）、`minHostVersion`（宿主最低版本）并称「三项版本信息」。
   * 带数据源的插件必须写，且要与 `data/manifest.json` 的 `dataVersion` 一致；
   * 纯工具型插件可以省略。**不参与签名**：它与 `name` / `description` / `features`
   * 同属展示信息，签它会导致每次更新数据都要重签，且让旧宿主验签失效。
   */
  dataSourceVersion?: string
  description: string
  author: string
  homepage?: string
  license?: string
  entry: string
  permissions: PluginPermission[]
  network?: string[]
  features?: PluginFeature[]
  updatePolicy?: 'auto' | 'manual'
  checksum: Record<string, PluginFileChecksum>
  /** 作者签名；缺省即「未签名」，安装时提示风险 */
  signature?: PluginSignature
}

/** 插件来源的三种模式 */
export type PluginSourceKind = 'github' | 'api' | 'local'

/** 用户填写的插件来源 */
export interface PluginSource {
  kind: PluginSourceKind
  /** GitHub: `owner/repo`；API: 完整 base URL；local: 目录路径 */
  value: string
}

/** 已安装插件的索引项（持久化到 `PluginStorage` 的 `bgm_plugins_index`） */
export interface InstalledPluginRecord {
  id: string
  name: string
  version: string
  author: string
  source: PluginSource
  enabled: boolean
  installedAt: string
  lastCheckedAt?: string
  /** 上次安装/更新时声明的权限，用于判断新版本是否要更多权限 */
  permissions?: PluginPermission[]
  /**
   * 上次安装/更新时的域名白名单。
   *
   * **必须持久化**：页面重载时 `manifestFromRecord()` 靠索引重建清单，丢了它
   * `createHostApi()` 里的 `host.net.fetch` 会把每个 URL 都判成「不在白名单内」。
   */
  network?: string[]
  /** 上次安装/更新时声明的宿主最低版本，市场页「已安装」列表要靠它展示 */
  minHostVersion?: string
  /** 上次安装/更新时声明的数据源版本（可缺省：纯工具型插件没有数据源） */
  dataSourceVersion?: string
  /** 更新已落盘但页面未重载 */
  pendingReload?: boolean
  /** 新版本要求更多权限，暂停更新 */
  pendingPermissions?: PluginPermission[]
  /** 安装时的签名结论（`verified` 才会被自动更新） */
  signatureStatus?: PluginSignatureStatus
}

/** 插件索引文件结构 */
export interface PluginIndexFile {
  schemaVersion: number
  plugins: InstalledPluginRecord[]
}

/** 清单校验结果 */
export type PluginManifestResult =
  { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] }

/** 插件运行期上下文（传给 `activate`） */
export interface PluginContext {
  host: unknown
  storage: PluginStorageApi
  log: PluginLoggerApi
  config: unknown
  manifest: PluginManifest
  dispose: (callback: () => void) => void
}

/** 插件私有存储（键自动加前缀） */
export interface PluginStorageApi {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<boolean>
  remove: (key: string) => Promise<boolean>
  keys: () => Promise<string[]>
  clear: () => Promise<boolean>
}

/** 插件日志（统一前缀写宿主日志面板） */
export interface PluginLoggerApi {
  debug: (message: string, details?: unknown) => void
  info: (message: string, details?: unknown) => void
  warn: (message: string, details?: unknown) => void
  error: (message: string, details?: unknown) => void
}

/** 插件模块形状（`plugin.js` 的导出） */
export interface PluginModule {
  activate?: (context: PluginContext) => void | Promise<void>
  deactivate?: (context: PluginContext) => void | Promise<void>
  onConfigChange?: (config: unknown) => void | Promise<void>
}

/** 已激活的插件实例 */
export interface LoadedPlugin {
  manifest: PluginManifest
  module: PluginModule
  context: PluginContext
  disposables: (() => void)[]
}
