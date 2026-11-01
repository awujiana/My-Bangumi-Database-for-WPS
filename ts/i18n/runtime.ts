/**
 * @fileoverview i18n 编排层（切语言 / 页面初始化 / 跨窗格同步）
 * @module i18n/runtime
 * @description 把「语言包仓库（无状态依赖）」「DOM 替换」「配置持久化」三层拼起来。
 *   对外只通过 {@link module:i18n} 的 barrel 暴露，业务代码不直接引用本文件。
 *
 * ## 为什么切语言不用重启
 *
 * 各任务窗格是独立 WebView，`postMessage` 跨窗格广播不可靠（项目多处踩坑），
 * 所以走 `PluginStorage` + 轮询：设置页写配置 → 各窗格 `subscribeConfigPoll`
 * 读到变化 → `applyI18n()` 重渲染。延迟 ≤3 秒（空闲拍）或 ≤0.6 秒（变化后的快拍）。
 *
 * ribbon 侧是另一套：`<tab>` 的 `getLabel` 能被 `ribbonUI.Invalidate()` 重新调用，
 * 见 `ts/ribbon.ts` 的 `GetRibbonLabel`；group / button / checkBox 实测不调
 * `getLabel`，只能改写 `ribbon.xml` + 重启（P4 再做）。
 */

import { LOG_LEVELS } from '../core/constants.js'
import { CONFIG_KEYS, getConfig, setConfig } from '../tools/config.js'
import { subscribeConfigPoll } from '../tools/config-poll.js'
import { bgmLog } from '../tools/util/index.js'

import { applyI18n, canApplyI18n } from './dom.js'
import {
  getActiveLocale,
  getLocaleBundle,
  hasLocale,
  loadLocale,
  notifyLocaleChange,
  useLocale,
} from './locale-store.js'
import { LOCALE_LABELS, SOURCE_LOCALE, isLocaleCode } from './translate.js'
import type { LocaleCode } from './translate.js'

/** 切语言时的选项 */
export interface SetLocaleOptions {
  /** 是否写入配置（默认 true）；轮询回调里必须传 false，否则会自激循环 */
  persist?: boolean
}

/** 按系统语言猜一个初始值（只在用户从没选过时用） */
export function detectSystemLocale(): LocaleCode {
  const first = (navigator.languages[0] ?? navigator.language).toLowerCase()
  if (first === '') return SOURCE_LOCALE
  if (first.startsWith('zh')) {
    // zh-TW / zh-HK / zh-MO / zh-Hant-* → 繁体；其余中文（含 zh、zh-CN、zh-Hans）→ 简体
    const isTraditional = ['tw', 'hk', 'mo', 'hant'].some((token) => first.includes(token))
    return isTraditional ? 'zh-TW' : 'zh-CN'
  }
  if (first.startsWith('en')) return 'en'
  return SOURCE_LOCALE
}

/**
 * 用户想要的语言（配置值优先，没配过就按系统语言猜）
 *
 * 与 {@link getLocale} 的区别：这个是「意图」，那个是「此刻真的用着的」。
 * 语言包还没加载完时两者会不一致，界面一律以 `getLocale()` 为准。
 */
export function getLanguage(): LocaleCode {
  const stored = getConfig(CONFIG_KEYS.LANGUAGE, '', true)
  if (isLocaleCode(stored)) return stored
  return detectSystemLocale()
}

/** 持久化语言偏好（只写配置，不切界面；切界面用 {@link setLocale}） */
export function setLanguage(code: LocaleCode): boolean {
  return setConfig(CONFIG_KEYS.LANGUAGE, code)
}

/** 语言在列表里的显示名（优先用语言包自己的 `nativeName`） */
export function getLocaleLabel(code: LocaleCode): string {
  return getLocaleBundle(code)?.nativeName ?? LOCALE_LABELS[code]
}

/**
 * 切换语言并立即重渲染当前页面
 *
 * @returns 是否成功；目标语言包拉不到时返回 false 且**不切**——切过去只会满屏 key
 */
export async function setLocale(
  code: LocaleCode,
  options: SetLocaleOptions = {},
): Promise<boolean> {
  if (!isLocaleCode(code)) return false
  const bundle = await loadLocale(code)
  if (bundle === null) {
    // 源语言都拉不到时 HTML 里的简体原文就是兜底：不切、不渲染
    bgmLog(LOG_LEVELS.WARN, `[i18n] 语言包 ${code} 不可用，保持当前语言不变`)
    return false
  }
  useLocale(code)
  applyI18n()
  notifyLocaleChange(code)
  if (options.persist !== false) setLanguage(code)
  bgmLog(LOG_LEVELS.INFO, `[i18n] 已切换语言: ${code}`)
  return true
}

/** 当前页面正在用的语言 */
export function getLocale(): LocaleCode {
  return getActiveLocale()
}

/** 轮询订阅句柄（幂等：重复调用只保留一个） */
let unsubscribeLanguagePoll: (() => void) | null = null

/**
 * 监听语言配置变化（各页面入口调用一次，幂等）
 *
 * 变化时只重渲染，**不写配置**（`persist: false`）——否则「读到变化 → 写回 →
 * 又读到变化」会自激。
 */
export function startI18nSync(): () => void {
  if (unsubscribeLanguagePoll !== null) return unsubscribeLanguagePoll
  unsubscribeLanguagePoll = subscribeConfigPoll({
    keys: [CONFIG_KEYS.LANGUAGE],
    apply: (values) => {
      const next = values[CONFIG_KEYS.LANGUAGE] ?? ''
      if (!isLocaleCode(next)) return
      if (next === getActiveLocale() && hasLocale(next)) return
      void setLocale(next, { persist: false })
    },
  })
  return () => {
    unsubscribeLanguagePoll?.()
    unsubscribeLanguagePoll = null
  }
}

/** 初始化是否已跑过（同一页面只跑一次） */
let isInitialized = false

/**
 * 页面初始化：加载语言包 → 应用文案 → 起跨窗格同步
 *
 * 各页面入口（sync-panel / settings / clean / enrich / highlight / conditional-format /
 * donate）在启动阶段调用一次。加载是异步的（要 fetch 语言包），所以首帧可能
 * 还是 HTML 里的简体原文，加载完才切——这是有意的：**宁可晚 100ms 变，
 * 也不要把界面先刷成一片 key**。
 */
export function initializeI18n(): void {
  if (isInitialized) return
  isInitialized = true
  const wanted = getLanguage()
  void (async (): Promise<void> => {
    await loadLocale(SOURCE_LOCALE)
    if (wanted !== SOURCE_LOCALE) await loadLocale(wanted)
    useLocale(wanted)
    if (!canApplyI18n()) {
      bgmLog(LOG_LEVELS.WARN, '[i18n] 源语言包未能加载，界面保持 HTML 原文')
      return
    }
    applyI18n()
    notifyLocaleChange(wanted)
  })()
  startI18nSync()
}

/** 仅测试用：复位初始化标记与轮询 */
export function resetI18nForTest(): void {
  isInitialized = false
  unsubscribeLanguagePoll?.()
  unsubscribeLanguagePoll = null
}
