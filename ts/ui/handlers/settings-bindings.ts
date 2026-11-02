/**
 * 设置页 UI 绑定（外观主题 / 列表类型 / 时间筛选 / 刷新间隔 / 同步记录开关）
 * @module ui/handlers/settings-bindings
 * @description 从 handlers/index.ts 抽出：各设置控件的 change 处理器与时间筛选控件初始化。
 */

import {
  LOG_LEVELS,
  bgmLog,
  getRefreshInterval,
  getUrlPath,
  saveTheme,
  setListType,
  setLogLevel,
  setRefreshInterval,
  setSyncRecordEnabled,
  setTimeFilter,
  showToast,
} from '../../index.js'
import { applyTheme, switchThemeAnimated } from '../../tools/theme.js'
import {
  clusterModeLabel,
  getTheme,
  mergeModeLabel,
  setMergeMode,
  setClusterMode,
  setModalButtonsPosition,
  setThemeSchedule,
} from '../../tools/config.js'
import type { ThemeMode } from '../../tools/config.js'
import {
  LOCALE_CODES,
  SOURCE_LOCALE,
  applyI18n,
  getLocale,
  getLocaleCoverage,
  getLocaleLabel,
  isLocaleCode,
  setLocale,
  t,
  tOr,
} from '../../i18n/index.js'
// 安装器直连、不经 i18n/index：它 → tools/save-file → ts/index 会绕回桶，
// 把 788 行的总入口拖进每个用桶的模块（详见 ts/i18n/index.ts 的说明）。
import {
  describeInstalledPacks,
  installLocalePacks,
  openLocaleDirectory,
} from '../../i18n/locale-install.js'
import { loadLocaleManifest } from '../../i18n/locale-manifest.js'
import type { LocaleCode } from '../../i18n/index.js'
import { renderLogEntries } from './log-panel.js'

/** 主题模式短名（源语言兜底，实际展示走 `themeModeShortLabel()`） */
const MODE_SHORT_LABELS: Readonly<Record<string, string>> = {
  dark: '深色',
  light: '浅色',
  system: '跟随系统',
  schedule: '定时',
}

/** 主题模式长名（源语言兜底） */
const MODE_LONG_LABELS: Readonly<Record<string, string>> = {
  dark: '深色模式',
  light: '浅色模式',
  system: '跟随系统',
  schedule: '定时切换',
}

/** 收藏列表类型（源语言兜底） */
const LIST_TYPE_LABELS: Readonly<Record<string, string>> = {
  all: '全部收藏',
  collect: '已看',
  wish: '想看',
  do: '在看',
}

/** 时间筛选范围（源语言兜底） */
const TIME_FILTER_LABELS: Readonly<Record<string, string>> = {
  all: '全部时间',
  year: '全年',
  quarter: '季度新番',
  month: '月份',
  future: '预告 / 未来',
}

/** 日志级别 → 展示名（下拉四个档位；未知值原样返回） */
function logLevelLabel(level: number): string {
  return tOr(
    `handlers.settingsBindings.logLevel.${String(level)}`,
    {
      0: 'DEBUG · 全部日志',
      1: 'INFO · 常规信息',
      2: 'WARN · 仅警告与错误',
      3: 'ERROR · 仅错误',
    }[level] ?? String(level),
  )
}

/** 主题模式 → 短名（日夜开关下方的说明） */
function themeModeShortLabel(mode: string): string {
  return tOr(`handlers.settingsBindings.modeShort.${mode}`, MODE_SHORT_LABELS[mode] ?? mode)
}

/** 主题模式 → 长名（切换成功提示） */
function themeModeLongLabel(mode: string): string {
  return tOr(`handlers.settingsBindings.modeLong.${mode}`, MODE_LONG_LABELS[mode] ?? mode)
}

/** 收藏列表类型 → 展示名 */
function listTypeLabel(value: string): string {
  return tOr(`handlers.settingsBindings.listType.${value}`, LIST_TYPE_LABELS[value] ?? value)
}

/** 时间筛选范围 → 展示名 */
function timeFilterLabel(value: string): string {
  return tOr(`handlers.settingsBindings.timeFilter.${value}`, TIME_FILTER_LABELS[value] ?? value)
}

/** 模态框按钮位置 → 展示名 */
function modalPositionLabel(position: string): string {
  const isOutside = position === 'outside'
  return tOr(
    isOutside ? 'handlers.settingsBindings.modalOutside' : 'handlers.settingsBindings.modalInside',
    isOutside ? '模态框外（标题栏右上角）' : '模态框内（底部）',
  )
}

// ========== 设置页：同步记录开关 / 日志级别筛选 / 全局日志级别 ==========

export const handleEnableSyncRecordChange = (): void => {
  const checkboxEnableSyncRecord = document.getElementById(
    'checkboxEnableSyncRecord',
  ) as HTMLInputElement | null
  if (!checkboxEnableSyncRecord) return
  const { checked } = checkboxEnableSyncRecord
  bgmLog(LOG_LEVELS.INFO, `[handlers] 启用同步记录开关切换: ${checked ? '开启' : '关闭'}`)
  setSyncRecordEnabled(checked)
  showToast(
    checked
      ? tOr('handlers.settingsBindings.syncRecordOn', '已启用同步记录功能')
      : tOr('handlers.settingsBindings.syncRecordOff', '已关闭同步记录功能'),
    'info',
  )
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
    showToast(
      tOr('handlers.settingsBindings.logLevelSet', '日志记录级别已设为「{level}」', {
        level: logLevelLabel(level),
      }),
      'success',
    )
  } else {
    showToast(tOr('handlers.settingsBindings.logLevelFailed', '日志级别保存失败'), 'error')
  }
}

// ========== 设置页：外观主题 / 列表类型 / 时间筛选 / 刷新间隔 ==========

/**
 * 同步日夜开关的视觉 / 无障碍状态（momo：用 CodePen 那种太阳月亮按钮替代色卡预览）
 *
 * 开关只有「开 = 深色 / 关 = 浅色」两态，而主题模式有四种：`system` 与 `schedule`
 * 的最终色取决于运行时解析，因此开关状态一律以 `<html data-theme>` 的**实际值**为准，
 * 说明文字才展示用户选的是哪种模式（避免「选了跟随系统，开关却显示浅色」的困惑）。
 */
export function updateThemeToggle(mode: string): void {
  const button = document.getElementById('themeToggleBtn')
  const state = document.getElementById('themeToggleState')
  const isDark = resolveCurrentTheme() === 'dark'
  if (button) {
    button.setAttribute('aria-checked', isDark ? 'true' : 'false')
    button.setAttribute(
      'aria-label',
      isDark
        ? tOr('handlers.settingsBindings.themeToLight', '切换到浅色主题')
        : tOr('handlers.settingsBindings.themeToDark', '切换到深色主题'),
    )
  }
  if (state) {
    const actual = isDark
      ? tOr('handlers.settingsBindings.modeShort.dark', '深色')
      : tOr('handlers.settingsBindings.modeShort.light', '浅色')
    state.textContent = tOr('handlers.settingsBindings.themeState', '当前：{mode}（{actual}）', {
      mode: themeModeShortLabel(mode),
      actual,
    })
  }
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
    showToast(
      tOr('handlers.settingsBindings.themeSet', '主题已切换为「{mode}」', {
        mode: themeModeLongLabel(mode),
      }),
      'success',
    )
  } else {
    showToast(tOr('handlers.settingsBindings.themeFailed', '主题保存失败'), 'error')
  }
}

/** 定时时刻变更：保存后立即按新时刻解析一次（不等 30s 轮询） */
export const handleThemeScheduleChange = (): void => {
  const darkStart = (document.getElementById('themeDarkStart') as HTMLInputElement | null)?.value
  const lightStart = (document.getElementById('themeLightStart') as HTMLInputElement | null)?.value
  if (!darkStart || !lightStart) return
  const isOk = setThemeSchedule({ enabled: true, darkStart, lightStart })
  if (!isOk) {
    showToast(tOr('handlers.settingsBindings.scheduleFormat', '时刻格式应为 HH:MM'), 'error')
    return
  }
  if (getTheme(true) === 'schedule') {
    applyTheme('schedule')
    showToast(
      tOr('handlers.settingsBindings.scheduleUpdated', '定时已更新：{light} 浅 → {dark} 深', {
        light: lightStart,
        dark: darkStart,
      }),
      'success',
    )
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
    showToast(
      tOr('handlers.settingsBindings.themeSet', '主题已切换为「{mode}」', {
        mode: themeModeLongLabel(mode),
      }),
      'success',
    )
  } else {
    showToast(tOr('handlers.settingsBindings.themeFailed', '主题保存失败'), 'error')
  }
}

/**
 * 日夜开关点击：在深色 / 浅色之间切换，并以开关中心为圆心做扩散动画
 *
 * 当前是 `system` / `schedule` 时同样可用 —— 用户按开关就是想要一个确定的颜色，
 * 于是直接落成显式的 dark / light（模式按钮组的高亮随之切换）。
 */
export const handleThemeToggleClick = (event: Event): void => {
  const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const next = resolveCurrentTheme() === 'dark' ? 'light' : 'dark'
  const rect = button?.getBoundingClientRect()
  const origin =
    rect && (rect.width > 0 || rect.height > 0)
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const isOk = saveTheme(next)
  if (!isOk) {
    showToast(tOr('handlers.settingsBindings.themeFailed', '主题保存失败'), 'error')
    return
  }
  switchThemeMode(next, origin)
  updateThemeModeButtons(next)
  updateThemeToggle(next)
  showToast(
    tOr('handlers.settingsBindings.themeSet', '主题已切换为「{mode}」', {
      mode: themeModeLongLabel(next),
    }),
    'success',
  )
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
    showToast(
      tOr('handlers.settingsBindings.modalPositionSet', '模态框按钮位置：{position}', {
        position: modalPositionLabel(position),
      }),
      'success',
    )
  } else {
    showToast(tOr('handlers.settingsBindings.saveFailed', '保存失败'), 'error')
  }
}

// ========== 设置页：条件格式自动聚类口径 ==========

/** 同步聚类口径分段按钮的 active / aria 状态 */
export function updateClusterModeButtons(mode: string): void {
  document.querySelectorAll<HTMLElement>('[data-cluster-mode]').forEach((button) => {
    const isActive = button.dataset.clusterMode === mode
    button.classList.toggle('active', isActive)
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
  })
}

/**
 * 自动聚类口径切换（条件格式页「自动聚类」按钮按它分组）
 *
 * 只写配置 + 同步按钮态：条件格式页每次点「自动聚类」都现读口径，
 * 不做跨窗格即时重算 —— 那边是用户主动触发的操作，静默重排分组反而会打断。
 */
export const handleClusterModeClick = (event: Event): void => {
  const button = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-cluster-mode]')
  const mode = button?.dataset.clusterMode
  if (!mode) return
  updateClusterModeButtons(mode)
  const isOk = setClusterMode(mode)
  if (isOk) {
    showToast(
      tOr('handlers.settingsBindings.clusterSet', '自动聚类口径：{mode}', {
        mode: clusterModeLabel(mode),
      }),
      'success',
    )
  } else {
    showToast(tOr('handlers.settingsBindings.saveFailed', '保存失败'), 'error')
  }
}

// ========== 设置页：条件格式合并重复项口径 ==========

/** 同步合并口径分段按钮的 active / aria 状态 */
export function updateMergeModeButtons(mode: string): void {
  document.querySelectorAll<HTMLElement>('[data-merge-mode]').forEach((button) => {
    const isActive = button.dataset.mergeMode === mode
    button.classList.toggle('active', isActive)
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
  })
}

/** 合并口径切换（条件格式页「合并重复项」按钮按它合并） */
export const handleMergeModeClick = (event: Event): void => {
  const button = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-merge-mode]')
  const mode = button?.dataset.mergeMode
  if (!mode) return
  updateMergeModeButtons(mode)
  const isOk = setMergeMode(mode)
  if (isOk) {
    showToast(
      tOr('handlers.settingsBindings.mergeSet', '合并重复项口径：{mode}', {
        mode: mergeModeLabel(mode),
      }),
      'success',
    )
  } else {
    showToast(tOr('handlers.settingsBindings.saveFailed', '保存失败'), 'error')
  }
}

export const handleListTypeChange = (): void => {
  const select = document.getElementById('listTypeSelect') as HTMLSelectElement | null
  if (!select) return
  const isOk = setListType(select.value)
  if (isOk) {
    showToast(
      tOr('handlers.settingsBindings.listTypeSet', '默认收藏列表类型：{type}', {
        type: listTypeLabel(select.value),
      }),
      'success',
    )
  } else {
    showToast(tOr('handlers.settingsBindings.listTypeFailed', '收藏列表类型保存失败'), 'error')
  }
}

export const handleTimeFilterChange = (): void => {
  const select = document.getElementById('timeFilterSelect') as HTMLSelectElement | null
  if (!select) return
  const isOk = setTimeFilter(select.value)
  if (isOk) {
    showToast(
      tOr('handlers.settingsBindings.timeFilterSet', '默认时间筛选范围：{range}', {
        range: timeFilterLabel(select.value),
      }),
      'success',
    )
  } else {
    showToast(tOr('handlers.settingsBindings.timeFilterFailed', '时间筛选范围保存失败'), 'error')
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
    showToast(
      tOr('handlers.settingsBindings.refreshInvalid', '刷新间隔需为 0–1440 之间的整数（分钟）'),
      'warn',
    )
    input.value = String(getRefreshInterval(true))
    return
  }
  const isOk = setRefreshInterval(minutes)
  if (isOk) {
    const value = Math.round(minutes)
    const offNote = value === 0 ? tOr('handlers.settingsBindings.refreshOff', '（已关闭）') : ''
    showToast(
      tOr('handlers.settingsBindings.refreshSet', '自动刷新间隔已设为 {minutes} 分钟{off}', {
        minutes: String(value),
        off: offNote,
      }),
      'success',
    )
  } else {
    showToast(tOr('handlers.settingsBindings.refreshFailed', '刷新间隔保存失败'), 'error')
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
  const checkboxTimeFilter = document.getElementById(
    'checkboxTimeFilter',
  ) as HTMLInputElement | null
  const timeFilterControls = document.getElementById('timeFilterControls')
  if (!checkboxTimeFilter || !timeFilterControls) return

  // 仅在通过校验后声明后续变量（符合 unicorn/no-declarations-before-early-exit）
  const rangeSelect = document.getElementById('timeFilterRange') as HTMLSelectElement | null
  const yearRow = document.getElementById('yearRow')
  const quarterRow = document.getElementById('quarterRow')
  const monthRow = document.getElementById('monthRow')
  const futureHintRow = document.getElementById('futureHintRow')

  // 复选框切换：显示/隐藏筛选控件
  checkboxTimeFilter.addEventListener('change', () => {
    timeFilterControls.style.display = checkboxTimeFilter.checked ? 'block' : 'none'
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

// ========== 设置页：界面语言（i18n） ==========

/**
 * 同步语言分段按钮的 active / aria 状态，并刷新覆盖率提示
 *
 * 覆盖率只对**非源语言**显示：简体是基准，显示「已翻译 100%」没有信息量，
 * 反而会让人以为「还有 0% 没翻」。
 */
export function updateLanguageButtons(code: LocaleCode): void {
  document.querySelectorAll<HTMLElement>('[data-locale]').forEach((button) => {
    const isActive = button.dataset.locale === code
    button.classList.toggle('active', isActive)
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
  })

  const hint = document.getElementById('localeCoverage')
  if (!hint) return
  if (code === SOURCE_LOCALE) {
    hint.hidden = true
    hint.textContent = ''
    return
  }
  const coverage = getLocaleCoverage(code)
  hint.hidden = false
  hint.textContent = `${getLocaleLabel(code)} · ${t('settings.appearance.languageCoverage', {
    percent: coverage.percent,
  })}（${t('settings.appearance.languageFallback')}）`
}

/**
 * 语言切换
 *
 * 乐观更新按钮态（点下去立刻有反馈），`setLocale` 失败再回滚——语言包缺失是
 * 真实可能（用户手动删过 `locales/<code>/`），不能假装切成功。
 *
 * 成功后的 toast 用**新语言**渲染：`setLocale` 内部已经 `applyI18n()` 过，
 * 此时 `t()` 取到的就是新文案，用户能立刻看到切换生效。
 */
export const handleLanguageClick = (event: Event): void => {
  const button = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-locale]')
  const raw = button?.dataset.locale
  if (raw === undefined || !isLocaleCode(raw)) return

  const previous = getLocale()
  if (raw === previous) return

  updateLanguageButtons(raw)
  void (async (): Promise<void> => {
    const isOk = await setLocale(raw)
    if (isOk) {
      updateLanguageButtons(raw)
      showToast(t('settings.appearance.languageApplied', { name: getLocaleLabel(raw) }), 'success')
      bgmLog(LOG_LEVELS.INFO, `[settings] 界面语言已切换: ${raw}`)
      return
    }
    updateLanguageButtons(previous)
    showToast(t('settings.appearance.languageFailed'), 'error')
  })()
}

// ========== 设置页：语言包在线安装 ==========

/** 状态行是否已经被「操作结果」写过（写过就不再被「已装版本」覆盖） */
let hasLocalePackReport = false

/** 写语言包状态行 */
function setLocalePackStatus(text: string): void {
  const status = document.getElementById('localePackStatus')
  if (status) status.textContent = text
}

/**
 * 刷新状态行：列出每个语言「已装的版本」
 *
 * 只读内存里已加载的语言包，不碰磁盘也不联网——`version` / `updatedAt` 就在包头上。
 * 首次进入设置页时语言包还在异步加载，所以这条要在 `onLocaleChange` 之后才准。
 */
export function refreshLocalePackStatus(): void {
  if (hasLocalePackReport) return
  setLocalePackStatus(describeInstalledPacks(LOCALE_CODES))
}

/**
 * 「更新语言包」：读清单 → 下载 → 校验 → 落盘 → 重渲染
 *
 * 语言包是随插件发布的，这个按钮只在两种情况下有意义：用户删坏过 `locales/`，
 * 或者想拿到比当前插件更新的译文。两条路都要走「下载 + 校验」，所以不区分。
 */
export async function handleLocalePackInstall(): Promise<void> {
  const button = document.getElementById('localePackInstallBtn') as HTMLButtonElement | null
  if (button) button.disabled = true
  hasLocalePackReport = true
  setLocalePackStatus(t('settings.appearance.localePackChecking'))

  try {
    const fetchFunction = (url: string): Promise<Response> => fetch(url)
    const loaded = await loadLocaleManifest({ fetchFunction })
    if (loaded.manifest === null) {
      setLocalePackStatus(t('settings.appearance.localePackFailed', { reason: loaded.detail }))
      bgmLog(LOG_LEVELS.WARN, `[settings] 语言包清单不可用：${loaded.detail}`)
      return
    }

    const outcome = await installLocalePacks({
      baseUrl: getUrlPath(),
      manifest: loaded.manifest,
      fetchFunction,
    })

    if (outcome.status === 'unsupported') {
      setLocalePackStatus(t('settings.appearance.localePackUnsupported'))
      return
    }
    if (outcome.status === 'installed') {
      const count = outcome.reports.filter((report) => report.status === 'installed').length
      setLocalePackStatus(t('settings.appearance.localePackInstalled', { count }))
    } else {
      setLocalePackStatus(t('settings.appearance.localePackFailed', { reason: outcome.detail }))
    }

    // 装的可能就是当前语言：直接重渲染，别让用户以为没生效。
    // 其它语言由下次切换时的 setLocale() 自然生效。
    applyI18n()
    updateLanguageButtons(getLocale())
  } finally {
    if (button) button.disabled = false
  }
}

/** 「打开语言包目录」：交给资源管理器，方便手动拖入 */
export function handleLocalePackOpenDirectory(): void {
  const outcome = openLocaleDirectory(getUrlPath())
  if (outcome.ok) return
  // 成功时不弹 toast：资源管理器窗口本身就是反馈，再弹一次反而多余
  showToast(t('settings.appearance.localePackOpenFailed', { reason: outcome.detail }), 'error')
  bgmLog(LOG_LEVELS.WARN, `[settings] 打开语言包目录失败：${outcome.detail}`)
}
