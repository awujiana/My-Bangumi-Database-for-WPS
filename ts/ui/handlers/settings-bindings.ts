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
  setRefreshInterval,
  setSyncRecordEnabled,
  setTimeFilter,
  showToast,
} from '../../index.js'
import { renderLogEntries } from './log-panel.js'

// ========== 设置页：同步记录开关 / 日志级别筛选 ==========

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

// ========== 设置页：外观主题 / 列表类型 / 时间筛选 / 刷新间隔 ==========

/** 同步主题预览卡片的 active 高亮 */
export function updateThemePreview(mode: string): void {
  document.querySelectorAll<HTMLElement>('[data-theme-card]').forEach((card) => {
    card.classList.toggle('active', card.dataset.themeCard === mode)
  })
}

export const handleThemeChange = (): void => {
  const select = document.getElementById('themeSelect') as HTMLSelectElement | null
  const mode = select?.value || 'dark' // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空串表示未选择/未填写，须回退默认（`??` 会保留空串）
  // 乐观更新预览卡片，即使持久化失败也保持视觉一致
  updateThemePreview(mode)
  const isOk = saveTheme(mode)
  if (isOk) {
    const labels: Record<string, string> = {
      dark: '深色模式',
      light: '浅色模式',
      system: '跟随系统',
    }
    showToast(`主题已切换为「${labels[mode] || mode}」`, 'success') // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空串表示未选择/未填写，须回退默认（`??` 会保留空串）
  } else {
    showToast('主题保存失败', 'error')
  }
}

export const handleThemePreviewClick = (event: Event): void => {
  const card = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-theme-card]')
  const mode = card?.dataset.themeCard
  if (!mode) return
  const select = document.getElementById('themeSelect') as HTMLSelectElement | null
  if (select) select.value = mode
  handleThemeChange()
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
    showToast(`默认收藏列表类型：${labels[select.value] || select.value}`, 'success') // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空串表示未选择/未填写，须回退默认（`??` 会保留空串）
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
    showToast(`默认时间筛选范围：${labels[select.value] || select.value}`, 'success') // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- 空串表示未选择/未填写，须回退默认（`??` 会保留空串）
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
