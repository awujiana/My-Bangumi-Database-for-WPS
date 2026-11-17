/**
 * @fileoverview 富化预览单元格渲染（着色工具）
 * @module panel/enrich-preview-cell
 * @description TAGS / 首播 / 平台按内容稳定配色，以及数据预览单元格 HTML 生成。
 *              自 panel/enrich-page.ts 抽出（P1-G），保持纯逻辑以便单测（P1-H）。
 */
import { escapeHtml } from '../tools/string-utilities.js';
import { shouldFilterNoise } from '../index.js';
import { getEnrichPreviewConfig } from './enrich-page-state.js';
// ========== 着色工具（TAGS / 首播 / 平台按内容稳定配色） ==========
/**
 * 徽标 12 色相（顺序即哈希取模顺序，**改动会让已有表格换色**，只允许追加）。
 * 只存色相名，真实色值由 css/tokens.css 的 --chip-* 按深浅主题给出：
 * 之前这里写死 12 组十六进制，浅色主题下亮色当文字在浅底上只有 1.5~2.5:1，
 * 而内联 style 又会盖掉 CSS 里的主题覆盖，等于浅色主题彻底失守。
 */
const CHIP_HUES = [
    'red',
    'orange',
    'yellow',
    'lime',
    'green',
    'teal',
    'sky',
    'blue',
    'violet',
    'purple',
    'pink',
    'rose',
];
/**
 * 文本到调色板索引的稳定哈希：同一文本（标签/日期/平台名）永远命中同一颜色，
 * 跨预览、完整表格弹窗、匹配结果均一致。
 */
function stableColorIndex(text) {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 31 + (text.codePointAt(index) ?? 0)) >>> 0;
    }
    return hash % CHIP_HUES.length;
}
/** 按文本稳定着色的徽章 HTML（颜色名写入内联 style，DOMPurify 白名单允许 style 属性） */
function coloredChipHtml(text, baseClass) {
    const hue = CHIP_HUES[stableColorIndex(text)] ?? CHIP_HUES[0];
    const escaped = escapeHtml(text);
    if (!hue) {
        return `<span class="${baseClass}">${escaped}</span>`;
    }
    const color = `var(--chip-${hue})`;
    const style = `background:color-mix(in srgb, ${color} 14%, transparent);` +
        `border-color:color-mix(in srgb, ${color} 40%, transparent);` +
        `color:${color}`;
    return `<span class="${baseClass}" title="${escaped}" style="${style}">${escaped}</span>`;
}
/** 按 `/`、`|`、逗号、顿号拆分为条目列表（去空 + 噪声过滤） */
function splitListValues(value) {
    return value
        .split(/\s*[/|,，、]\s*/)
        .map((part) => part.trim())
        .filter((part) => part !== '' && !shouldFilterNoise(part));
}
/** TAGS 标签单元格：每个标签独立彩色徽章，不显示 / 分隔符（可在设置页关闭） */
function renderTagChipsCell(value) {
    if (!getEnrichPreviewConfig().tagsColor) {
        const escaped = escapeHtml(value);
        return `<td title="${escaped}">${escaped}</td>`;
    }
    const chips = splitListValues(value)
        .map((tag) => coloredChipHtml(tag, 'tag-chip'))
        .join('');
    return `<td class="column-tags">${chips}</td>`;
}
/** 首播日期单元格：相同日期同色徽章（可在设置页关闭） */
function renderPremiereCell(value) {
    const escaped = escapeHtml(value);
    if (!getEnrichPreviewConfig().premiereColor) {
        return `<td title="${escaped}">${escaped}</td>`;
    }
    return `<td title="${escaped}">${coloredChipHtml(value, 'premiere-chip')}</td>`;
}
/** 平台徽章单元格：parts 已去空去重（含噪声过滤），逐个渲染 platform-chip（可按名着色） */
export function renderPlatformChipsCell(parts) {
    const shouldColor = getEnrichPreviewConfig().platformColor;
    const chips = parts
        .map((part) => shouldColor
        ? coloredChipHtml(part, 'platform-chip')
        : `<span class="platform-chip" title="${escapeHtml(part)}">${escapeHtml(part)}</span>`)
        .join('');
    return `<td class="column-platform">${chips}</td>`;
}
/** 数据预览单元格渲染：名称加粗、周更/播放平台以徽章形式展示 */
export function renderPreviewCell(fieldKey, rawValue) {
    const value = rawValue.trim();
    if (!value)
        return '<td></td>';
    const escaped = escapeHtml(value);
    if (fieldKey === 'nameColumn') {
        return `<td class="column-name" title="${escaped}"><span class="preview-name">${escaped}</span></td>`;
    }
    if (fieldKey === 'platformCol' || fieldKey === 'exclusiveCol') {
        return renderPlatformChipsCell(splitListValues(value));
    }
    if (fieldKey === 'tagsColumn') {
        return renderTagChipsCell(value);
    }
    if (fieldKey === 'premiereCol') {
        return renderPremiereCell(value);
    }
    if (fieldKey === 'weekdayCol' && /^周[一二三四五六日天]$/.test(value)) {
        const weekdayClass = weekdayChipClass(value);
        return `<td title="${escaped}"><span class="weekday-chip ${weekdayClass}">${escaped}</span></td>`;
    }
    if (fieldKey === 'episodesColumn') {
        const epClass = episodeChipClass(value);
        const chipClass = epClass ? `ep-chip ${epClass}` : '';
        return `<td title="${escaped}"><span class="${chipClass}">${escaped}</span></td>`;
    }
    return `<td title="${escaped}">${escaped}</td>`;
}
/** 周几字符到 CSS 修饰类名（周一~周日各一色） */
function weekdayChipClass(value) {
    const map = {
        周一: 'weekday-mon',
        周二: 'weekday-tue',
        周三: 'weekday-wed',
        周四: 'weekday-thu',
        周五: 'weekday-fri',
        周六: 'weekday-sat',
        周日: 'weekday-sun',
        周天: 'weekday-sun',
    };
    return map[value] ?? '';
}
/**
 * 集数字符串解析为数值（支持"12集"或"12"等），无法解析时返回 NaN
 * /\d+/ 只捕获纯数字段，Number() 转换即整数，无小数风险
 */
function parseEpisodeCount(value) {
    const match = /\d+/.exec(value);
    return match && match[0] !== '' ? Number(match[0]) : NaN;
}
/**
 * 集数徽章 CSS 类（默认阈值：1=橙、2~11=黄、12=无、>12=绿）。
 * 阈值可通过配置覆盖（bgm_enrich_ep_single / bgm_enrich_ep_full）。
 *
 * 优先级：
 *   count === epSingle       → ep-single（橙）
 *   count > epSingle && count < epFull → ep-short（黄）
 *   count === epFull         → 无（不显示颜色）
 *   count > epFull          → ep-full（绿）
 */
function episodeChipClass(value) {
    const count = parseEpisodeCount(value);
    if (!Number.isFinite(count) || count <= 0)
        return '';
    const single = getEpisodeSingleThreshold();
    const full = getEpisodeFullThreshold();
    if (single >= full) {
        // 配置错误：单集阈值 >= 完结阈值时退回「>=full=无、>full=绿、==single=橙」
        if (count === single)
            return 'ep-single';
        if (count > full)
            return 'ep-full';
        return '';
    }
    if (count === single)
        return 'ep-single';
    if (count > single && count < full)
        return 'ep-short';
    if (count > full)
        return 'ep-full';
    return '';
}
/** 集数「单集」阈值（默认 1，对应橙色） */
function getEpisodeSingleThreshold() {
    try {
        return getEnrichPreviewConfig().epSingle;
    }
    catch {
        return 1;
    }
}
/** 集数「完结」阈值（默认 12；== 该值无色，> 该值绿色） */
function getEpisodeFullThreshold() {
    try {
        return getEnrichPreviewConfig().epFull;
    }
    catch {
        return 12;
    }
}
