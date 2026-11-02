/**
 * 日志面板渲染
 * @module ui/handlers/log-panel
 * @description 从 handlers/index.ts 抽出：把最近日志按级别筛选渲染到日志弹窗。
 */
import { getRecentLogs } from '../../tools/logger.js';
// tOr 直连 locale-store：i18n/index 桶会经 locale-install 拉进 ts/index（模块顶层写 window），
// node 单测一 import 就 ReferenceError。别改回桶。
import { tOr } from '../../i18n/locale-store.js';
/** 渲染日志条目到日志面板 */
export function renderLogEntries() {
    const body = document.getElementById('logModalBody');
    if (!body)
        return;
    const filterSelect = document.getElementById('logLevelFilter');
    const level = filterSelect?.value || undefined;
    const logs = getRecentLogs(level, 100);
    body.replaceChildren();
    if (logs.length === 0) {
        body.textContent = tOr('handlers.log.empty', '暂无日志');
        return;
    }
    for (const entry of logs) {
        const div = document.createElement('div');
        div.className = `log-entry log-${entry.level.toLowerCase()}`;
        const time = new Date(entry.timestamp).toLocaleString();
        div.textContent = `[${time}] [${entry.level}] ${entry.message}`;
        body.appendChild(div);
    }
    // 滚动到底部，展示最新日志
    body.scrollTop = body.scrollHeight;
}
