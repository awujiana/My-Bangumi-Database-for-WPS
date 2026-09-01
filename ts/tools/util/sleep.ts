/**
 * 工具模块 - 延时与异步等待
 * @module tools/util/sleep
 * @description 提供 sleep（同步阻塞延时）与 delay（异步延时）两个工具。
 *              sleep 优先使用 WPS Application.Wait，回退到 busy-loop + DoEvents。
 */
import { LOG_LEVELS } from '../../core/constants.js'

// 循环依赖：仅在函数体内使用 bgmLog / getApp，运行时安全
import { bgmLog, getApp } from './index.js'

/**
 * 延迟执行
 */
export function sleep(ms: number): void {
  try {
    const app = getApp() as
      { Wait?: (date: Date) => void; DoEvents?: () => void } | null | undefined
    if (app?.Wait) {
      const waitTime = new Date(Date.now() + ms)
      app.Wait(waitTime)
      return
    }
  } catch (error) {
    bgmLog(LOG_LEVELS.WARN, `sleep app.Wait 失败: ${(error as Error).message}`)
  }
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const app = getApp() as { DoEvents?: () => void } | null | undefined
      if (app?.DoEvents) app.DoEvents()
    } catch (error) {
      if (typeof bgmLog === 'function') {
        bgmLog(LOG_LEVELS.INFO, `sleep DoEvents 失败: ${(error as Error).message}`)
      }
      break
    }
  }
}

/**
 * 异步延迟指定的毫秒数
 * @param ms 毫秒
 * @returns Promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
