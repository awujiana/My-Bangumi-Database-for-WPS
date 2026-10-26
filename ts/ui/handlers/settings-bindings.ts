/**
 * 设置页 UI 绑定（外观主题 / 列表类型 / 时间筛选 / 刷新间隔 / 同步记录开关）
 * @module ui/handlers/settings-bindings
 * @description 从 handlers/index.ts 抽出：各设置控件的 change 处理器与时间筛选控件初始化。
 */

import {
  LOG_LEVELS,
  bgmLog,
  getRefreshInterval,
  saveTheme,
  setListType,
  setLogLevel,
  setRefreshInterval,
  setSyncRecordEnabled,
  setTimeFilter,
  showToast,
} from '../../index.js'
import { applyTheme, switchThemeAnimated } from '../../tools/theme.js'
import { getTheme, setModalButtonsPosition, setThemeSchedule } from '../../tools/config.js'
import type { ThemeMode } from '../../tools/config.js'
import { renderLogEntries } from './log-panel.js'

// ========== 设置页：同步记录开关 / 日志级别筛选 / 全局日志级别 ==========

export const handleEnableSyncRecordChange = (): void => {
  const chkEnableSyncRecord = document.getElementById(
    'chkEnableSyncRecord',
  ) as HTMLInputElement | null
  if (!chkEnableSyncRecord) return
  const { checked } = chkEnableSyncRecord
  bgmLog(LOG_LEVELS.INFO, `[handlers] 启用同步记录开关切换: ${checked ? '开启' : '关闭'}`)
  setSyncRecordEnabled(checked)
  showToast(checked ? '已启用同步记录功能' : '已关闭同步记录功能', 'info')
}

export const handleLogLevelFilterChange = (): void => {
  renderLogEntries()
}

/** 设置页「📜 日志偏好」：全局日志记录级别（0=DEBUG … 3=ERROR） */
export const handleLogLevelChange = (): void => {
  const select = document.getElementById('logLevelSelect') as HTMLSelectElement | null
  if (!select) return
  const level = Number(select.value)
  if (!Number.isSafeInteger(level)) return
  const isOk = setLogLevel(level)
  if (isOk) {
    const labels: Record<number, string> = {
      0: 'DEBUG · 全部日志',
      1: 'INFO · 常规信息',
      2: 'WARN · 仅警告与错误',
      3: 'ERROR · 仅错误',
    }
    showToast(`日志记录级别已设为「${labels[level] ?? String(level)}」`, 'success')
  } else {
    showToast('日志级别保存失败', 'error')
  }
}

// ========== 设置页：外观主题 / 列表类型 / 时间筛选 / 刷新间隔 ==========

/** 同步主题预览卡片的 active 高亮 */
export function updateThemePreview(mode: string): void {
  document.querySelectorAll<HTMLElement>('[data-theme-card]').forEach((card) => {
    card.classList.toggle('active', card.dataset.themeCard === mode)
  })
}

/** 同步模式按钮组的 active 与定时框显隐 */
export function updateThemeModeButtons(mode: string): void {
  document.querySelectorAll<HTMLElement>('[data-theme-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themeMode === mode)
    button.setAttribute('aria-pressed', button.dataset.themeMode === mode ? 'true' : 'false')
  })
  const scheduleBox = document.getElementById('themeScheduleBox')
  if (scheduleBox) scheduleBox.hidden = mode !== 'schedule'
}

/**
 * 从元素中心扩散切换主题（momo：点击时从按钮中心向外扩散到整个应用）
 *
 * 只有 dark ↔ light 的直接切换才值得做动画：system / schedule 的「结果色」
 * 取决于运行时解析，切换前后可能同色，扩散动画会变成「闪一下」。
 */
function switchThemeMode(mode: string, origin?: { x: number; y: number }): void {
  const isDirectSwap =
    (mode === 'dark' || mode === 'light') && origin !== undefined && resolveCurrentTheme() !== mode
  if (origin !== undefined && isDirectSwap) {
    switchThemeAnimated(mode, origin)
  } else {
    applyTheme(mode as ThemeMode)
  }
}

/** 当前 <html data-theme> 的解析值（dark / light） */
function resolveCurrentTheme(): string {
  return document.documentElement.dataset.theme ?? 'dark'
}

export const handleThemeModeClick = (event: Event): void => {
  const button = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-theme-mode]')
  const mode = button?.dataset.themeMode
  if (!button || !mode) return
  // 取按钮中心做扩散圆心（getBoundingClientRect 一次，不读多次触发重排）
  const rect = button.getBoundingClientRect()
  const origin =
    rect.width > 0 || rect.height > 0
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  // 乐观更新按钮态，即使持久化失败也保持视觉一致
  updateThemeModeButtons(mode)
  const isOk = saveTheme(mode)
  if (isOk) {
    switchThemeMode(mode, origin)
    const labels: Record<string, string> = {
      dark: '深色模式',
      light: '浅色模式',
      system: '跟随系统',
      schedule: '定时切换',
    }
    showToast(`主题已切换为「${labels[mode] || mode}」`, 'success')
  } else {
    showToast('主题保存失败', 'error')
  }
}

/** 定时时刻变更：保存后立即按新时刻解析一次（不等 30s 轮询） */
export const handleThemeScheduleChange = (): void => {
  const darkStart = (document.getElementById('themeDarkStart') as HTMLInputElement | null)?.value
  const lightStart = (document.getElementById('themeLightStart') as HTMLInputElement | null)?.value
  if (!darkStart || !lightStart) return
  const isOk = setThemeSchedule({ enabled: true, darkStart, lightStart })
  if (!isOk) {
    showToast('时刻格式应为 HH:MM', 'error')
    return
  }
  if (getTheme(true) === 'schedule') {
    applyTheme('schedule')
    showToast(`定时已更新：${lightStart} 浅 → ${darkStart} 深`, 'success')
  }
}

export const handleThemeChange = (): void => {
  // 兼容旧调用方（页面已无 themeSelect 下拉；保留以防脚本直调）
  const select = document.getElementById('themeSelect') as HTMLSelectElement | null
  const mode = select?.value || 'dark'
  updateThemeModeButtons(mode)
  const isOk = saveTheme(mode)
  if (isOk) {
    switchThemeMode(mode)
    const labels: Record<string, string> = {
      dark: '深色模式',
      light: '浅色模式',
      system: '跟随系统',
      schedule: '定时切换',
    }
    showToast(`主题已切换为「${labels[mode] || mode}」`, 'success')
  } else {
    showToast('主题保存失败', 'error')
  }
}

export const handleThemePreviewClick = (event: Event): void => {
  const card = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-theme-card]')
  const mode = card?.dataset.themeCard
  if (!card || !mode) return
  updateThemeModeButtons(mode)
  const isOk = saveTheme(mode)
  if (!isOk) return
  // 预览卡片也支持从卡片中心扩散（与模式按钮同款动画）
  const rect = card.getBoundingClientRect()
  switchThemeMode(mode, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
}

/** 同步模态框按钮位置的分段按钮与说明 */
export function updateModalButtonsPositionButtons(position: string): void {
  document.querySelectorAll<HTMLElement>('[data-modal-buttons-position]').forEach((button) => {
    const isActive = button.dataset.modalButtonsPosition === position
    button.classList.toggle('active', isActive)
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
  })
}

/**
 * 模态框按钮位置切换（momo：按钮可放到模态框之外，右上角）
 *
 * 只写配置 + 同步按钮态：真正的类名切换发生在各模态框**打开时**
 * （conditional-format-page 的 showXxxMask 里读配置套
 * `conditional-format-modal--buttons-outside`）——跨窗格不做即时同步，
 * 下次打开即生效，与「高亮模式上移设置页」同策略。
 */
export const handleModalButtonsPositionClick = (event: Event): void => {
  const button = (event.currentTarget as HTMLElement).closest<HTMLElement>(
    '[data-modal-buttons-position]',
  )
  const position = button?.dataset.modalButtonsPosition
  if (!position) return
  updateModalButtonsPositionButtons(position)
  const isOk = setModalButtonsPosition(position)
  if (isOk) {
    const labels: Record<string, string> = {
      inside: '模态框内（底部）',
      outside: '模态框外（标题栏右上角）',
    }
    showToast(`模态框按钮位置：${labels[position] || position}`, 'success')
  } else {
    showToast('保存失败', 'error')
  }
}

export const handleListTypeChange = (): void => {
  const select = document.getElementById('listTypeSelect') as HTMLSelectElement | null
  if (!select) return
  const isOk = setListType(select.value)
  if (isOk) {
    const labels: Record<string, string> = {
      all: '全部收藏',
      collect: '已看',
      wish: '想看',
      do: '在看',
    }
    showToast(`默认收藏列表类型：${labels[select.value] || select.value}`, 'success')
  } else {
    showToast('收藏列表类型保存失败', 'error')
  }
}

export const handleTimeFilterChange = (): void => {
  const select = document.getElementById('timeFilterSelect') as HTMLSelectElement | null
  if (!select) return
  const isOk = setTimeFilter(select.value)
  if (isOk) {
    const labels: Record<string, string> = {
      all: '全部时间',
      year: '全年',
      quarter: '季度新番',
      month: '月份',
      future: '预告 / 未来',
    }
    showToast(`默认时间筛选范围：${labels[select.value] || select.value}`, 'success')
  } else {
    showToast('时间筛选范围保存失败', 'error')
  }
}

export const handleRefreshIntervalChange = (): void => {
  const input = document.getElementById('refreshIntervalInput') as HTMLInputElement | null
  if (!input) return
  const raw = input.value.trim()
  if (raw === '') {
    input.value = String(getRefreshInterval(true))
    return
  }
  const minutes = Number(raw)
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    showToast('刷新间隔需为 0–1440 之间的整数（分钟）', 'warn')
    input.value = String(getRefreshInterval(true))
    return
  }
  const isOk = setRefreshInterval(minutes)
  if (isOk) {
    const value = Math.round(minutes)
    showToast(
      `自动刷新间隔已设为 ${String(value)} 分钟${value === 0 ? '（已关闭）' : ''}`,
      'success',
    )
  } else {
    showToast('刷新间隔保存失败', 'error')
  }
}

// ========== 时间筛选 UI 控制 ==========

/**
 * 初始化时间筛选控件的显示/隐藏逻辑
 * - 勾选「启用时间筛选」时显示筛选控件区域
 * - 筛选范围切换时显示/隐藏季度/月份下拉框
 * - 选择「预告/未来动漫」时隐藏年份/季度/月份，显示提示
 */
export function setupTimeFilterControls(): void {
  const chkTimeFilter = document.getElementById('chkTimeFilter') as HTMLInputElement | null
  const timeFilterControls = document.getElementById('timeFilterControls')
  if (!chkTimeFilter || !timeFilterControls) return

  // 仅在通过校验后声明后续变量（符合 unicorn/no-declarations-before-early-exit）
  const rangeSelect = document.getElementById('timeFilterRange') as HTMLSelectElement | null
  const yearRow = document.getElementById('yearRow')
  const quarterRow = document.getElementById('quarterRow')
  const monthRow = document.getElementById('monthRow')
  const futureHintRow = document.getElementById('futureHintRow')

  // 复选框切换：显示/隐藏筛选控件
  chkTimeFilter.addEventListener('change', () => {
    timeFilterControls.style.display = chkTimeFilter.checked ? 'block' : 'none'
  })

  // 筛选范围切换：显示/隐藏年份/季度/月份/提示行
  if (rangeSelect && yearRow && quarterRow && monthRow) {
    rangeSelect.addEventListener('change', () => {
      const isFuture = rangeSelect.value === 'future'
      yearRow.style.display = isFuture ? 'none' : ''
      quarterRow.style.display = rangeSelect.value === 'quarter' ? '' : 'none'
      monthRow.style.display = rangeSelect.value === 'month' ? '' : 'none'
      if (futureHintRow) {
        futureHintRow.style.display = isFuture ? '' : 'none'
      }
    })
  }
}
