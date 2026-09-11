/**
 * @fileoverview 富化页三处内嵌进度实例的持有者与工厂
 * @module panel/enrich-progress-hosts
 * @description
 *   「单文件富化 / 批量富化 / 冲突解决」各有一处内嵌进度条，需要在**不同的
 *   流程模块**里创建、更新与回收（例如冲突进度由「冲突对话框」模块创建，批量
 *   进度由「批量富化」模块创建）。
 *
 *   用**对象持有**而不是 `export let`：ESM 的 live binding 只允许导入方*读取*
 *   绑定，不能赋值；而这三个槽位必须能被多个模块写入。因此导出一个 `progressHosts`
 *   对象，写入走属性赋值。
 */

import { createProgress } from '../ui/components/progress.js'
import type { ProgressController, ProgressShowOptions } from '../ui/components/progress.js'

/** 三处内嵌进度槽位（未创建时为 `null`） */
export interface EnrichProgressHosts {
  /** 单文件富化进度 */
  enrich: ProgressController | null
  /** 批量富化进度 */
  batch: ProgressController | null
  /** 冲突解决进度 */
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
 * 走 `createProgress` 而非全局单例 `showProgress`，使三处进度各自独立、互不干扰。
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
