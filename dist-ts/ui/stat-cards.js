/**
 * @fileoverview 统一统计卡片组件
 * @module ui/stat-cards
 * @description
 *   历史上三个页面的预览区各自手写统计卡片，样式与结构各不相同
 *   （`clean-stat-*` / `match-stat-*` / `record-stat-*` / `detail-stats`），
 *   新增一个统计值要在多处分别改 HTML + CSS + 渲染代码。
 *
 *   现已收敛为**一个**渲染函数 + **一套** `.stat-grid` / `.stat-card` 标记：
 *   调用方只给 `{ label, value, tone }` 数组；静态页面的统计块
 *   （enrich 匹配 / 进度 / 记录、同步预览弹窗）也改产同一套标记。
 *   视觉语言对齐侧栏导航：横排胶囊 + r-md 圆角，语义色只作用于数值
 *   （`css/styles.css`，所有页面都引入该文件，故各页外观一致）。
 *
 *   **安全**：值可能来自用户数据（工作表名、规则名），一律先 `escapeHtml`
 *   再整体过 `sanitizeHtml`。
 */
import { escapeHtml } from '../tools/string-utilities.js';
import { sanitizeHtml } from '../tools/sanitize.js';
/** tone → CSS class 后缀（`default` 不加后缀，用基础样式） */
const TONE_CLASS = {
    default: '',
    success: ' stat-card-success',
    warning: ' stat-card-warning',
    error: ' stat-card-error',
    accent: ' stat-card-accent',
};
/**
 * 把统计卡片渲染进容器。
 *
 * 目标容器不存在时静默返回 —— 页面可能还没渲染到该区块（或当前页签未激活），
 * 这不是错误，不值得打断调用方。
 *
 * @param container - 目标容器（为 null 时静默返回）
 * @param cards - 卡片列表；空数组会渲染出一个空的栅格（视觉上不占位）
 */
export function renderStatCards(container, cards) {
    if (!container)
        return;
    if (cards.length === 0) {
        container.replaceChildren();
        return;
    }
    const html = cards
        .map((card) => {
        const tone = card.tone ?? 'default';
        return `<div class="stat-card${TONE_CLASS[tone]}"><div class="stat-value">${escapeHtml(String(card.value))}</div><div class="stat-label">${escapeHtml(card.label)}</div></div>`;
    })
        .join('');
    container.innerHTML = sanitizeHtml(`<div class="stat-grid">${html}</div>`);
}
/** 清空统计区（预览被作废 / 重新扫描前调用） */
export function clearStatCards(container) {
    if (container)
        container.replaceChildren();
}
