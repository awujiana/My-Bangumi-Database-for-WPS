/**
 * 设置页 UI 绑定（外观主题 / 列表类型 / 时间筛选 / 刷新间隔 / 同步记录开关）
 * @module ui/handlers/settings-bindings
 * @description 从 handlers/index.ts 抽出：各设置控件的 change 处理器与时间筛选控件初始化。
 */
import { LOG_LEVELS, bgmLog, getRefreshInterval, saveTheme, setListType, setLogLevel, setRefreshInterval, setSyncRecordEnabled, setTimeFilter, showToast, } from '../../index.js';
import { applyTheme, switchThemeAnimated } from '../../tools/theme.js';
import { clusterModeLabel, getTheme, setClusterMode, setModalButtonsPosition, setThemeSchedule, } from '../../tools/config.js';
import { renderLogEntries } from './log-panel.js';
// ========== 设置页：同步记录开关 / 日志级别筛选 / 全局日志级别 ==========
export const handleEnableSyncRecordChange = () => {
    const chkEnableSyncRecord = document.getElementById('chkEnableSyncRecord');
    if (!chkEnableSyncRecord)
        return;
    const { checked } = chkEnableSyncRecord;
    bgmLog(LOG_LEVELS.INFO, `[handlers] 启用同步记录开关切换: ${checked ? '开启' : '关闭'}`);
    setSyncRecordEnabled(checked);
    showToast(checked ? '已启用同步记录功能' : '已关闭同步记录功能', 'info');
};
export const handleLogLevelFilterChange = () => {
    renderLogEntries();
};
/** 设置页「📜 日志偏好」：全局日志记录级别（0=DEBUG … 3=ERROR） */
export const handleLogLevelChange = () => {
    const select = document.getElementById('logLevelSelect');
    if (!select)
        return;
    const level = Number(select.value);
    if (!Number.isSafeInteger(level))
        return;
    const isOk = setLogLevel(level);
    if (isOk) {
        const labels = {
            0: 'DEBUG · 全部日志',
            1: 'INFO · 常规信息',
            2: 'WARN · 仅警告与错误',
            3: 'ERROR · 仅错误',
        };
        showToast(`日志记录级别已设为「${labels[level] ?? String(level)}」`, 'success');
    }
    else {
        showToast('日志级别保存失败', 'error');
    }
};
// ========== 设置页：外观主题 / 列表类型 / 时间筛选 / 刷新间隔 ==========
/**
 * 同步日夜开关的视觉 / 无障碍状态（momo：用 CodePen 那种太阳月亮按钮替代色卡预览）
 *
 * 开关只有「开 = 深色 / 关 = 浅色」两态，而主题模式有四种：`system` 与 `schedule`
 * 的最终色取决于运行时解析，因此开关状态一律以 `<html data-theme>` 的**实际值**为准，
 * 说明文字才展示用户选的是哪种模式（避免「选了跟随系统，开关却显示浅色」的困惑）。
 */
export function updateThemeToggle(mode) {
    const button = document.getElementById('themeToggleBtn');
    const state = document.getElementById('themeToggleState');
    const isDark = resolveCurrentTheme() === 'dark';
    if (button) {
        button.setAttribute('aria-checked', isDark ? 'true' : 'false');
        button.setAttribute('aria-label', isDark ? '切换到浅色主题' : '切换到深色主题');
    }
    if (state) {
        const labels = {
            dark: '深色',
            light: '浅色',
            system: '跟随系统',
            schedule: '定时',
        };
        state.textContent = `当前：${labels[mode] ?? mode}（${isDark ? '深色' : '浅色'}）`;
    }
}
/** 同步模式按钮组的 active 与定时框显隐 */
export function updateThemeModeButtons(mode) {
    document.querySelectorAll('[data-theme-mode]').forEach((button) => {
        button.classList.toggle('active', button.dataset.themeMode === mode);
        button.setAttribute('aria-pressed', button.dataset.themeMode === mode ? 'true' : 'false');
    });
    const scheduleBox = document.getElementById('themeScheduleBox');
    if (scheduleBox)
        scheduleBox.hidden = mode !== 'schedule';
}
/**
 * 从元素中心扩散切换主题（momo：点击时从按钮中心向外扩散到整个应用）
 *
 * 只有 dark ↔ light 的直接切换才值得做动画：system / schedule 的「结果色」
 * 取决于运行时解析，切换前后可能同色，扩散动画会变成「闪一下」。
 */
function switchThemeMode(mode, origin) {
    const isDirectSwap = (mode === 'dark' || mode === 'light') && origin !== undefined && resolveCurrentTheme() !== mode;
    if (origin !== undefined && isDirectSwap) {
        switchThemeAnimated(mode, origin);
    }
    else {
        applyTheme(mode);
    }
}
/** 当前 <html data-theme> 的解析值（dark / light） */
function resolveCurrentTheme() {
    return document.documentElement.dataset.theme ?? 'dark';
}
export const handleThemeModeClick = (event) => {
    const button = event.currentTarget.closest('[data-theme-mode]');
    const mode = button?.dataset.themeMode;
    if (!button || !mode)
        return;
    // 取按钮中心做扩散圆心（getBoundingClientRect 一次，不读多次触发重排）
    const rect = button.getBoundingClientRect();
    const origin = rect.width > 0 || rect.height > 0
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    // 乐观更新按钮态，即使持久化失败也保持视觉一致
    updateThemeModeButtons(mode);
    const isOk = saveTheme(mode);
    if (isOk) {
        switchThemeMode(mode, origin);
        const labels = {
            dark: '深色模式',
            light: '浅色模式',
            system: '跟随系统',
            schedule: '定时切换',
        };
        showToast(`主题已切换为「${labels[mode] || mode}」`, 'success');
    }
    else {
        showToast('主题保存失败', 'error');
    }
};
/** 定时时刻变更：保存后立即按新时刻解析一次（不等 30s 轮询） */
export const handleThemeScheduleChange = () => {
    const darkStart = document.getElementById('themeDarkStart')?.value;
    const lightStart = document.getElementById('themeLightStart')?.value;
    if (!darkStart || !lightStart)
        return;
    const isOk = setThemeSchedule({ enabled: true, darkStart, lightStart });
    if (!isOk) {
        showToast('时刻格式应为 HH:MM', 'error');
        return;
    }
    if (getTheme(true) === 'schedule') {
        applyTheme('schedule');
        showToast(`定时已更新：${lightStart} 浅 → ${darkStart} 深`, 'success');
    }
};
export const handleThemeChange = () => {
    // 兼容旧调用方（页面已无 themeSelect 下拉；保留以防脚本直调）
    const select = document.getElementById('themeSelect');
    const mode = select?.value || 'dark';
    updateThemeModeButtons(mode);
    const isOk = saveTheme(mode);
    if (isOk) {
        switchThemeMode(mode);
        const labels = {
            dark: '深色模式',
            light: '浅色模式',
            system: '跟随系统',
            schedule: '定时切换',
        };
        showToast(`主题已切换为「${labels[mode] || mode}」`, 'success');
    }
    else {
        showToast('主题保存失败', 'error');
    }
};
/**
 * 日夜开关点击：在深色 / 浅色之间切换，并以开关中心为圆心做扩散动画
 *
 * 当前是 `system` / `schedule` 时同样可用 —— 用户按开关就是想要一个确定的颜色，
 * 于是直接落成显式的 dark / light（模式按钮组的高亮随之切换）。
 */
export const handleThemeToggleClick = (event) => {
    const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const next = resolveCurrentTheme() === 'dark' ? 'light' : 'dark';
    const rect = button?.getBoundingClientRect();
    const origin = rect && (rect.width > 0 || rect.height > 0)
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const isOk = saveTheme(next);
    if (!isOk) {
        showToast('主题保存失败', 'error');
        return;
    }
    switchThemeMode(next, origin);
    updateThemeModeButtons(next);
    updateThemeToggle(next);
    showToast(`主题已切换为「${next === 'dark' ? '深色模式' : '浅色模式'}」`, 'success');
};
/** 同步模态框按钮位置的分段按钮与说明 */
export function updateModalButtonsPositionButtons(position) {
    document.querySelectorAll('[data-modal-buttons-position]').forEach((button) => {
        const isActive = button.dataset.modalButtonsPosition === position;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}
/**
 * 模态框按钮位置切换（momo：按钮可放到模态框之外，右上角）
 *
 * 只写配置 + 同步按钮态：真正的类名切换发生在各模态框**打开时**
 * （conditional-format-page 的 showXxxMask 里读配置套
 * `conditional-format-modal--buttons-outside`）——跨窗格不做即时同步，
 * 下次打开即生效，与「高亮模式上移设置页」同策略。
 */
export const handleModalButtonsPositionClick = (event) => {
    const button = event.currentTarget.closest('[data-modal-buttons-position]');
    const position = button?.dataset.modalButtonsPosition;
    if (!position)
        return;
    updateModalButtonsPositionButtons(position);
    const isOk = setModalButtonsPosition(position);
    if (isOk) {
        const labels = {
            inside: '模态框内（底部）',
            outside: '模态框外（标题栏右上角）',
        };
        showToast(`模态框按钮位置：${labels[position] || position}`, 'success');
    }
    else {
        showToast('保存失败', 'error');
    }
};
// ========== 设置页：条件格式自动聚类口径 ==========
/** 同步聚类口径分段按钮的 active / aria 状态 */
export function updateClusterModeButtons(mode) {
    document.querySelectorAll('[data-cluster-mode]').forEach((button) => {
        const isActive = button.dataset.clusterMode === mode;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}
/**
 * 自动聚类口径切换（条件格式页「自动聚类」按钮按它分组）
 *
 * 只写配置 + 同步按钮态：条件格式页每次点「自动聚类」都现读口径，
 * 不做跨窗格即时重算 —— 那边是用户主动触发的操作，静默重排分组反而会打断。
 */
export const handleClusterModeClick = (event) => {
    const button = event.currentTarget.closest('[data-cluster-mode]');
    const mode = button?.dataset.clusterMode;
    if (!mode)
        return;
    updateClusterModeButtons(mode);
    const isOk = setClusterMode(mode);
    if (isOk) {
        showToast(`自动聚类口径：${clusterModeLabel(mode)}`, 'success');
    }
    else {
        showToast('保存失败', 'error');
    }
};
export const handleListTypeChange = () => {
    const select = document.getElementById('listTypeSelect');
    if (!select)
        return;
    const isOk = setListType(select.value);
    if (isOk) {
        const labels = {
            all: '全部收藏',
            collect: '已看',
            wish: '想看',
            do: '在看',
        };
        showToast(`默认收藏列表类型：${labels[select.value] || select.value}`, 'success');
    }
    else {
        showToast('收藏列表类型保存失败', 'error');
    }
};
export const handleTimeFilterChange = () => {
    const select = document.getElementById('timeFilterSelect');
    if (!select)
        return;
    const isOk = setTimeFilter(select.value);
    if (isOk) {
        const labels = {
            all: '全部时间',
            year: '全年',
            quarter: '季度新番',
            month: '月份',
            future: '预告 / 未来',
        };
        showToast(`默认时间筛选范围：${labels[select.value] || select.value}`, 'success');
    }
    else {
        showToast('时间筛选范围保存失败', 'error');
    }
};
export const handleRefreshIntervalChange = () => {
    const input = document.getElementById('refreshIntervalInput');
    if (!input)
        return;
    const raw = input.value.trim();
    if (raw === '') {
        input.value = String(getRefreshInterval(true));
        return;
    }
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
        showToast('刷新间隔需为 0–1440 之间的整数（分钟）', 'warn');
        input.value = String(getRefreshInterval(true));
        return;
    }
    const isOk = setRefreshInterval(minutes);
    if (isOk) {
        const value = Math.round(minutes);
        showToast(`自动刷新间隔已设为 ${String(value)} 分钟${value === 0 ? '（已关闭）' : ''}`, 'success');
    }
    else {
        showToast('刷新间隔保存失败', 'error');
    }
};
// ========== 时间筛选 UI 控制 ==========
/**
 * 初始化时间筛选控件的显示/隐藏逻辑
 * - 勾选「启用时间筛选」时显示筛选控件区域
 * - 筛选范围切换时显示/隐藏季度/月份下拉框
 * - 选择「预告/未来动漫」时隐藏年份/季度/月份，显示提示
 */
export function setupTimeFilterControls() {
    const chkTimeFilter = document.getElementById('chkTimeFilter');
    const timeFilterControls = document.getElementById('timeFilterControls');
    if (!chkTimeFilter || !timeFilterControls)
        return;
    // 仅在通过校验后声明后续变量（符合 unicorn/no-declarations-before-early-exit）
    const rangeSelect = document.getElementById('timeFilterRange');
    const yearRow = document.getElementById('yearRow');
    const quarterRow = document.getElementById('quarterRow');
    const monthRow = document.getElementById('monthRow');
    const futureHintRow = document.getElementById('futureHintRow');
    // 复选框切换：显示/隐藏筛选控件
    chkTimeFilter.addEventListener('change', () => {
        timeFilterControls.style.display = chkTimeFilter.checked ? 'block' : 'none';
    });
    // 筛选范围切换：显示/隐藏年份/季度/月份/提示行
    if (rangeSelect && yearRow && quarterRow && monthRow) {
        rangeSelect.addEventListener('change', () => {
            const isFuture = rangeSelect.value === 'future';
            yearRow.style.display = isFuture ? 'none' : '';
            quarterRow.style.display = rangeSelect.value === 'quarter' ? '' : 'none';
            monthRow.style.display = rangeSelect.value === 'month' ? '' : 'none';
            if (futureHintRow) {
                futureHintRow.style.display = isFuture ? '' : 'none';
            }
        });
    }
}
