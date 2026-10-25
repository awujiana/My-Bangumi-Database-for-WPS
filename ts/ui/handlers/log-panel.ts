/**
 * 日志面板渲染
 * @module ui/handlers/log-panel
 * @description 从 handlers/index.ts 抽出：把最近日志按级别筛选渲染到日志弹窗。
 */

import { getRecentLogs } from '../../tools/logger.js'
import type { LogLevel } from '../../tools/logger.js'

/** 渲染日志条目到日志面板 */
export function renderLogEntries(): void {
  const body = document.getElementById('logModalBody')
  if (!body) return
  const filterSelect = document.getElementById('logLevelFilter') as HTMLSelectElement | null
  const level = filterSelect?.value || undefined
  const logs = getRecentLogs(level as LogLevel | undefined, 100)
  body.replaceChildren()
  if (logs.length === 0) {
    body.textContent = '暂无日志'
    return
  }
  for (const entry of logs) {
    const div = document.createElement('div')
    div.className = `log-entry log-${entry.level.toLowerCase()}`
    const time = new Date(entry.timestamp).toLocaleString()
    div.textContent = `[${time}] [${entry.level}] ${entry.message}`
    body.appendChild(div)
  }
  // 滚动到底部，展示最新日志
  body.scrollTop = body.scrollHeight
}
