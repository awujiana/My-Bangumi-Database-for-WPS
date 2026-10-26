/**
 * @fileoverview WPS 原生 Web 对话框（独立于任务窗格的窗口）
 * @module tools/wpsWebDialog
 * @description 任务窗格里的浮动窗口受限于窗格视口（`position: fixed` 相对 WebView，
 *   最大宽度就是窗格宽度），做不到「浮在 WPS 表格上面」。本模块走宿主的
 *   Web 对话框接口开出真正的独立窗口：可拖出窗格、可最大化、非模态时用户仍能
 *   回到表格框选区。
 *
 * ## 两条宿主通路（能力探测，不是二选一写死）
 * 1. `Application.CreateWebDialog(url)` → WebDialog：返回句柄，可 `Visible` /
 *    `IsModal` / `Resize` / `Delete`，还能凭 `ID` 用 `GetWebDialog(id)` 查存活。
 *    **唯一支持「程序化关闭」与「关了能感知」的通路**，故优先。
 *    代价：签名里没有标题参数，窗口标题只能由网页 `<title>` 提供。
 * 2. `Application.ShowDialog(url, caption, width, height, isModal)` → 老接口，
 *    有标题与初始尺寸，但**返回值是否可用句柄因版本而异**。拿不到句柄时
 *    `close()` 返回 false（UI 需提示用户手动关窗口），`isAlive()` 也只能
 *    乐观返回 true —— 宁可「以为还开着」，也不要在窗口开着时把它判死。
 * 3. 两条都不存在 → `openWebDialog` 返回 null，调用方回落到任务窗格内浮动
 *    （`ui/components/detachable-panel.js` 的 float 模式），功能不丢。
 *
 * ## 物理像素
 * 宿主收的宽高是**物理像素**，CSS 像素要乘 `devicePixelRatio`，否则高分辨率屏上
 * 窗口只有预期的一半大（官方文档特意点过这个坑）。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { bgmLog, getApp } from './util/index.js'
import type { WpsWebDialog } from './wps.js'

/** 采用的打开通路（日志与排障用） */
export type WebDialogStrategy = 'web-dialog' | 'show-dialog'

/** 开一个对话框的请求 */
export interface WebDialogRequest {
  /** 对话框要加载的页面地址（绝对或相对，见 `resolveDialogUrl`） */
  url: string
  /** 窗口标题（仅 `ShowDialog` 通路生效；`CreateWebDialog` 走网页 `<title>`） */
  title: string
  /** CSS 像素宽 */
  width: number
  /** CSS 像素高 */
  height: number
  /** 是否模态。**管理器必须 false**：用户还要回表格框选区 */
  isModal?: boolean
}

/** 已打开对话框的句柄 */
export interface WebDialogSession {
  /** 实际采用的通路 */
  readonly strategy: WebDialogStrategy
  /** 宿主给的实例 id；拿不到句柄时为 null */
  readonly id: number | null
  /**
   * 是否仍然开着
   *
   * 拿不到句柄时**乐观返回 true**：窗口确实开着（没人关过它），
   * 判成 false 会让调用方在窗口还在时就把占位块收回，比「多留一会儿」糟。
   */
  readonly isAlive: () => boolean
  /** 关闭窗口；宿主不支持程序化关闭时返回 false（调用方应提示手动关闭） */
  readonly close: () => boolean
  /** 改窗口尺寸（物理像素由内部换算）；宿主不支持时返回 false */
  readonly resize: (width: number, height: number) => boolean
}

/**
 * CSS 像素 → 物理像素
 *
 * @param width CSS 像素宽
 * @param height CSS 像素高
 * @param devicePixelRatio 设备像素比；非法值（0 / NaN / Infinity）按 1 处理
 */
export function dialogPhysicalSize(
  width: number,
  height: number,
  devicePixelRatio = 1,
): { width: number; height: number } {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

/**
 * 把相对页名解析成绝对地址
 *
 * 任务窗格的地址在调试态是 `http://127.0.0.1:3889/ui/xxx.html`、发布态是本地资源
 * 路径，写死任一种都会在另一种下 404。相对当前页面解析两种都对。
 * 解析失败（base 不是合法 URL）时原样返回入参，交给宿主处理。
 */
export function resolveDialogUrl(relative: string, baseUrl: string): string {
  try {
    return new URL(relative, baseUrl).href
  } catch {
    return relative
  }
}

/** 判断宿主返回的东西是不是一个对话框对象（不同版本差异大，只认形状） */
function isWebDialogLike(value: unknown): value is WpsWebDialog {
  return typeof value === 'object' && value !== null && 'Visible' in value
}

/** 取对话框 id（有的版本叫 ID 而不是 id，拿不到返回 null） */
function readDialogId(dialog: WpsWebDialog): number | null {
  const raw: unknown = dialog.ID
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/** 按 id 取回对话框；宿主不支持或已销毁时返回 null（COM 调用一律吞异常） */
function readDialogById(id: number): WpsWebDialog | null {
  const app = getApp() as { GetWebDialog?: (dialogId: number) => unknown } | null
  if (typeof app?.GetWebDialog !== 'function') return null
  try {
    const found = app.GetWebDialog(id)
    return isWebDialogLike(found) ? found : null
  } catch {
    return null
  }
}

/** 统一的句柄构造：所有关闭 / 存活逻辑都收敛在这里 */
function makeSession(
  strategy: WebDialogStrategy,
  id: number | null,
  dialog: WpsWebDialog | null,
): WebDialogSession {
  /** 取当前还拿得动的对话框实例：优先按 id 查（窗口被宿主回收后引用会失效） */
  const resolve = (): WpsWebDialog | null => (id === null ? dialog : (readDialogById(id) ?? dialog))

  return {
    strategy,
    id,
    isAlive: () => {
      if (id === null) return dialog !== null
      const found = readDialogById(id)
      // 查不到实例（宿主已回收）= 关了；查到就看 Visible（我们自己关的会置 false）
      if (!found) return false
      return found.Visible !== false
    },
    close: () => {
      const target = resolve()
      if (!target) return false
      try {
        // Delete 是「销毁」，比 Visible=false 干净：后者窗口进程还在，
        // 再开同名对话框可能撞上旧实例
        if (typeof target.Delete === 'function') {
          target.Delete()
          return true
        }
        target.Visible = false
        return true
      } catch (error: unknown) {
        bgmLog(LOG_LEVELS.WARN, `[webDialog] 关闭对话框失败：${(error as Error).message}`)
        return false
      }
    },
    resize: (width, height) => {
      const target = resolve()
      if (!target || typeof target.Resize !== 'function') return false
      const size = dialogPhysicalSize(width, height, readDevicePixelRatio())
      try {
        target.Resize(size.width, size.height)
        return true
      } catch (error: unknown) {
        bgmLog(LOG_LEVELS.WARN, `[webDialog] 调整对话框尺寸失败：${(error as Error).message}`)
        return false
      }
    },
  }
}

/** 读设备像素比（非浏览器环境按 1） */
function readDevicePixelRatio(): number {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

/**
 * 用 `CreateWebDialog` 打开（首选通路）
 *
 * 创建出来默认不可见、无初始尺寸，必须显式 `Visible = true` + `Resize()`，
 * 否则看到的是「点了按钮没反应」。
 */
function openViaCreateWebDialog(request: WebDialogRequest): WebDialogSession | null {
  const app = getApp() as { CreateWebDialog?: (url: string) => unknown } | null
  if (typeof app?.CreateWebDialog !== 'function') return null

  try {
    const created = app.CreateWebDialog(request.url)
    if (!isWebDialogLike(created)) return null
    created.Visible = true
    created.IsModal = request.isModal === true
    const size = dialogPhysicalSize(request.width, request.height, readDevicePixelRatio())
    // 有 Resize 就设初始尺寸；没有也不算失败（宿主会给默认大小），继续用
    if (typeof created.Resize === 'function') created.Resize(size.width, size.height)
    return makeSession('web-dialog', readDialogId(created), created)
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[webDialog] CreateWebDialog 失败：${(error as Error).message}`)
    return null
  }
}

/** 用 `ShowDialog` 打开（老版本通路） */
function openViaShowDialog(request: WebDialogRequest): WebDialogSession | null {
  const app = getApp() as {
    ShowDialog?: (
      url: string,
      caption: string,
      width: number,
      height: number,
      isModal: boolean,
    ) => unknown
  } | null
  if (typeof app?.ShowDialog !== 'function') return null

  const size = dialogPhysicalSize(request.width, request.height, readDevicePixelRatio())
  try {
    const shown = app.ShowDialog(
      request.url,
      request.title,
      size.width,
      size.height,
      request.isModal === true,
    )
    // 拿到句柄就当 web-dialog 用（能关、能查存活）；拿不到就只能开不能关
    const dialog = isWebDialogLike(shown) ? shown : null
    return makeSession('show-dialog', dialog ? readDialogId(dialog) : null, dialog)
  } catch (error: unknown) {
    bgmLog(LOG_LEVELS.WARN, `[webDialog] ShowDialog 失败：${(error as Error).message}`)
    return null
  }
}

/**
 * 开一个 WPS 原生 Web 对话框
 *
 * @returns 句柄；宿主不支持时返回 **null**，调用方必须回落到任务窗格内浮动
 */
export function openWebDialog(request: WebDialogRequest): WebDialogSession | null {
  return openViaCreateWebDialog(request) ?? openViaShowDialog(request)
}

/**
 * 宿主是否支持原生对话框
 *
 * 用于在打开**之前**决定「⧉」按钮的文案与行为，避免点了才被告知不支持。
 */
export function isWebDialogSupported(): boolean {
  const app = getApp() as {
    CreateWebDialog?: unknown
    ShowDialog?: unknown
  } | null
  if (!app) return false
  return typeof app.CreateWebDialog === 'function' || typeof app.ShowDialog === 'function'
}
