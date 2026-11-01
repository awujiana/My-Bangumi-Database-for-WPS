/**
 * @fileoverview i18n 对外入口（纯 barrel）
 * @module i18n
 * @description 业务代码统一从这里取：`import { t } from '../i18n/index.js'`。
 *   实现分四层，各自职责见对应模块：
 *   - {@link module:i18n/translate}：语言代码、占位符、覆盖率（纯函数）
 *   - {@link module:i18n/localeStore}：加载 / 缓存 / 回退链
 *   - {@link module:i18n/dom}：`data-i18n*` 扫描替换
 *   - {@link module:i18n/runtime}：切语言、页面初始化、跨窗格同步
 *
 * 本文件只做 re-export，不放逻辑——这样「谁是权威实现」永远只有一处。
 */
export { applyI18n, canApplyI18n } from './dom.js';
export { getLocaleBundle, getLocaleCoverage, localeUrl, onLocaleChange, preloadLocales, t, } from './locale-store.js';
export { detectSystemLocale, getLanguage, getLocale, getLocaleLabel, initializeI18n, resetI18nForTest, setLanguage, setLocale, startI18nSync, } from './runtime.js';
export type { SetLocaleOptions } from './runtime.js';
export { LOCALE_CODES, LOCALE_LABELS, SOURCE_LOCALE, isLocaleCode } from './translate.js';
export type { LocaleBundle } from './locale-store.js';
export type { LocaleCode, LocaleCoverage, LocaleMessages } from './translate.js';
//# sourceMappingURL=index.d.ts.map