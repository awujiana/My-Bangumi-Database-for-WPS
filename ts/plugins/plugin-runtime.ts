/**
 * @fileoverview 插件运行时：加载、激活、卸载
 * @module plugins/pluginRuntime
 * @description 用 `import()` 加载 `<加载项目录>/plugins/<id>/plugin.js`。
 *   为什么只有这一条路：安装态页面跑在 `file://` 下，`fetch` 读本地文件会被 CEF 拦
 *   （真机实测 `Failed to fetch`），只有 ESM 模块加载能读到本地代码。
 *
 *   加载失败不抛给调用方 —— 市场页要把「哪个插件坏了、为什么」显示出来，
 *   所以统一返回结构化结果。
 */
import { LOG_LEVELS } from '../core/constants.js'

import { bgmLog } from '../tools/util/index.js'
import { pluginEntryUrl } from './plugin-market.js'
import { createHostApi, createPluginStorage } from './host-api.js'
import type { HostApiDependencies, PluginCommand } from './host-api.js'
import { patchPluginRecord } from './plugin-store.js'
import type {
  InstalledPluginRecord,
  LoadedPlugin,
  PluginContext,
  PluginLoggerApi,
  PluginManifest,
  PluginModule,
} from './plugin-types.js'

/** 已激活的插件（id → 实例） */
const loaded = new Map<string, LoadedPlugin>()

/** 插件注册的命令（id → 命令列表） */
const commands = new Map<string, PluginCommand[]>()

/** 加载结果 */
export type PluginActivateResult =
  { ok: true; plugin: LoadedPlugin } | { ok: false; reason: string }

/** 造一个带插件 id 前缀的 logger */
export function createPluginLogger(
  id: string,
  write: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void,
): PluginLoggerApi {
  const prefix = `[plugin:${id}]`
  return {
    debug: (message, details) => {
      write('debug', `${prefix} ${message}${formatDetails(details)}`)
    },
    info: (message, details) => {
      write('info', `${prefix} ${message}${formatDetails(details)}`)
    },
    warn: (message, details) => {
      write('warn', `${prefix} ${message}${formatDetails(details)}`)
    },
    error: (message, details) => {
      write('error', `${prefix} ${message}${formatDetails(details)}`)
    },
  }
}

/** 把 details 拼成一行（只拼字符串/数字，避免把大对象写进日志） */
function formatDetails(details: unknown): string {
  if (details === undefined || details === null) return ''
  if (typeof details === 'string' || typeof details === 'number') return ` ${String(details)}`
  try {
    return ` ${JSON.stringify(details)}`
  } catch {
    return ''
  }
}

/** 把权限数组转成 Set（缺省为空集） */
function permissionSet(manifest: PluginManifest): Set<PluginManifest['permissions'][number]> {
  return new Set(manifest.permissions)
}

/**
 * 加载并激活一个已安装插件。
 *
 * @param rootUrl 加载项目录 URL
 * @param record 索引记录
 * @param manifest 插件清单（从索引记录还原，见 `manifestFromRecord`）
 * @param dependencies 宿主 API 依赖
 */
export async function activatePlugin(
  rootUrl: URL,
  record: InstalledPluginRecord,
  manifest: PluginManifest,
  dependencies: HostApiDependencies,
): Promise<PluginActivateResult> {
  const existing = loaded.get(record.id)
  if (existing !== undefined) {
    return { ok: true, plugin: existing }
  }
  const entryUrl = pluginEntryUrl(rootUrl, record.id)
  let module: PluginModule
  try {
    module = (await import(/* @vite-ignore */ entryUrl)) as PluginModule
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[plugins] 加载失败 ${record.id}：${message}`)
    return { ok: false, reason: `加载失败：${message}` }
  }
  if (typeof module.activate !== 'function') {
    return { ok: false, reason: '插件没有导出 activate(context)' }
  }

  const disposables: (() => void)[] = []
  const log = createPluginLogger(record.id, (level, message) => {
    const levelMap = {
      debug: LOG_LEVELS.DEBUG,
      info: LOG_LEVELS.INFO,
      warn: LOG_LEVELS.WARN,
      error: LOG_LEVELS.ERROR,
    } as const
    bgmLog(levelMap[level], message)
  })

  const host = createHostApi(manifest, permissionSet(manifest), {
    ...dependencies,
    log,
    registerCommand: (command) => {
      const list = commands.get(record.id) ?? []
      list.push(command)
      commands.set(record.id, list)
      dependencies.registerCommand(command)
    },
  })

  const context: PluginContext = {
    host,
    storage: createPluginStorage(record.id),
    log,
    config: null,
    manifest,
    dispose: (callback) => {
      disposables.push(callback)
    },
  }

  try {
    await module.activate(context)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.ERROR, `[plugins] activate 抛错 ${record.id}：${message}`)
    for (const callback of disposables) {
      try {
        callback()
      } catch {
        // 清理失败不掩盖原始错误
      }
    }
    return { ok: false, reason: `activate 抛错：${message}` }
  }

  const plugin: LoadedPlugin = { manifest, module, context, disposables }
  loaded.set(record.id, plugin)
  bgmLog(LOG_LEVELS.INFO, `[plugins] 已激活 ${record.id} v${manifest.version}`)
  return { ok: true, plugin }
}

/** 停用一个插件（调用 deactivate + 清理 disposables） */
export async function deactivatePlugin(id: string): Promise<void> {
  const plugin = loaded.get(id)
  if (plugin === undefined) return
  try {
    await plugin.module.deactivate?.(plugin.context)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    bgmLog(LOG_LEVELS.WARN, `[plugins] deactivate 抛错 ${id}：${message}`)
  }
  for (const callback of plugin.disposables) {
    try {
      callback()
    } catch {
      // 忽略单个清理失败
    }
  }
  loaded.delete(id)
  commands.delete(id)
}

/** 停用全部插件（页面卸载时调用） */
export async function deactivateAllPlugins(): Promise<void> {
  for (const id of loaded.keys()) {
    await deactivatePlugin(id)
  }
}

/** 取已加载的插件 */
export function getLoadedPlugin(id: string): LoadedPlugin | null {
  return loaded.get(id) ?? null
}

/** 取全部已加载的插件 id */
export function listLoadedPluginIds(): string[] {
  return [...loaded.keys()]
}

/** 取某插件注册的命令 */
export function listPluginCommands(id: string): PluginCommand[] {
  return commands.get(id) ?? []
}

/**
 * 从索引记录还原一份最小清单。
 *
 * 索引里只存了构造 API 必需的 id / name / version / author / permissions / network ——
 * 权限与白名单决定「给不给能力」，其余字段（features / homepage / checksum）由市场页
 * 在联网拉清单时补全，离线时降级展示。
 */
export function manifestFromRecord(record: InstalledPluginRecord): PluginManifest {
  const manifest: PluginManifest = {
    schemaVersion: 1,
    id: record.id,
    name: record.name,
    version: record.version,
    apiVersion: '1.0.0',
    minHostVersion: '0.0.0',
    description: '',
    author: record.author,
    entry: 'plugin.js',
    permissions: record.permissions ?? [],
    checksum: {},
    updatePolicy: 'auto',
  }
  // 白名单不回灌的话，重载后 createHostApi 会把插件的每一个网络请求都拦掉
  if (record.network !== undefined) manifest.network = [...record.network]
  return manifest
}

/** 标记插件「已加载」，供市场页显示运行状态 */
export function markPluginLoaded(id: string, version: string): void {
  patchPluginRecord(id, { pendingReload: false, version })
}
