/**
 * @fileoverview 富化页进度实例的持有者与工厂
 * @module panel/enrich-progress-hosts
 * @description
 *   「单文件富化 / 冲突解决」是页面内嵌（inline）进度，「批量富化」是右下角
 *   浮动卡片（detach）—— 批量一次要跑好几个文件且循环里主动让出主线程，
 *   浮动卡片不占页面布局，用户期间可以继续操作页面其他区域。
 *
 *   这些实例需要在**不同的流程模块**里创建、更新与回收（例如冲突进度由
 *   「冲突对话框」模块创建，批量进度由「批量富化」模块创建）。
 *
 *   用**对象持有**而不是 `export let`：ESM 的 live binding 只允许导入方*读取*
 *   绑定，不能赋值；而这些槽位必须能被多个模块写入。因此导出一个 `progressHosts`
 *   对象，写入走属性赋值。
 */

import { createProgress } from '../ui/components/progress.js'
import type { ProgressController, ProgressShowOptions } from '../ui/components/progress.js'

/** 富化页各流程的进度槽位（未创建时为 `null`） */
export interface EnrichProgressHosts {
  /** 单文件富化进度（inline） */
  enrich: ProgressController | null
  /** 批量富化进度（detach 浮动卡片） */
  batch: ProgressController | null
  /** 冲突解决进度（inline） */
  conflict: ProgressController | null
}

/**
 * 进度实例持有者。
 * 刻意做成可变对象而非三个 `export let`：见文件头说明。
 */
export const progressHosts: EnrichProgressHosts = {
  enrich: null,
  batch: null,
  conflict: null,
}

/**
 * 创建内嵌（inline）进度实例。
 * 走 `createProgress` 而非全局单例 `showProgress`，使各处进度各自独立、互不干扰。
 * @param hostId 宿主容器 ID（由页面静态模板提供）
 * @param title 标题（inline 模式默认不渲染标题栏，仅作语义信息）
 * @param icon 图标
 * @param onStop 提供时渲染「停止」按钮并接管点击
 */
export function createInlineProgress(
  hostId: string,
  title: string,
  icon: string,
  onStop?: () => void,
): ProgressController | null {
  const options: ProgressShowOptions = { mode: 'inline', hostId, title, icon }
  if (onStop !== undefined) {
    options.enableStop = true
    options.onStop = onStop
  }
  return createProgress(options)
}

/**
 * 创建浮动（detach）进度实例：挂到 body 右下角的独立卡片。
 *
 * 与 inline 的差别不只是位置——卡片 `position: fixed` 不占页面布局，
 * 批量富化跑起来后用户可以继续滚动/操作页面其他区域，进度与「停止」
 * 按钮始终在视口里可见。完成态由调用方决定：`complete()` 保留摘要等人来关，
 * 或 `hide()` 立即回收。
 *
 * @param title 标题（detach 模式渲染标题栏，标题必填）
 * @param icon 图标
 * @param onStop 提供时渲染「停止」按钮并接管点击
 */
export function createFloatingProgress(
  title: string,
  icon: string,
  onStop?: () => void,
): ProgressController | null {
  const options: ProgressShowOptions = { mode: 'detach', title, icon }
  if (onStop !== undefined) {
    options.enableStop = true
    options.onStop = onStop
  }
  return createProgress(options)
}
