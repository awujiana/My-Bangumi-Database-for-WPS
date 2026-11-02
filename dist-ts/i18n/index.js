/**
 * @fileoverview i18n 公共出口（纯 barrel）
 * @module i18n
 * @description **生产代码已全部直连子模块，本文件当前零使用者**（2026-11-02 全仓统一），
 *   保留作为「i18n 提供哪些能力」的单一清单与对外契约。新代码请按下表直连：
 *   翻译取 `locale-store`、装配取 `runtime`、DOM 取 `dom`、语言代码取 `translate`；
 *   在线安装器直连 `locale-install` / `locale-manifest`（见下方说明）。
 *   实现分六层，各自职责见对应模块：
 *   - {@link module:i18n/translate}：语言代码、占位符、覆盖率（纯函数）
 *   - {@link module:i18n/localeStore}：加载 / 缓存 / 回退链
 *   - {@link module:i18n/localeManifest}：语言包清单（解析 / 校验 / 在线获取）
 *   - {@link module:i18n/localeInstall}：在线安装（下载 → 校验 → 转 ASCII → 落盘）
 *
 *   ⚠️ 后两者**不经本入口导出**，原因见下方 `locale-install` 处的说明。
 *   - {@link module:i18n/dom}：`data-i18n*` 扫描替换
 *   - {@link module:i18n/runtime}：切语言、页面初始化、跨窗格同步
 *
 * 本文件只做 re-export，不放逻辑——这样「谁是权威实现」永远只有一处。
 */
export { applyI18n, canApplyI18n } from './dom.js';
// 在线安装器（`locale-install` / `locale-manifest`）**故意不在此导出**：
//   链路 locale-install → tools/save-file → ts/index → ui/handlers/index → 本文件，
//   会让每一个 `import { t } from 'i18n/index'` 都间接依赖 `ts/index.ts`（788 行，
//   模块图从 34 涨到 161），而 `ts/index.ts` 求值时会经 sync-panel-page 访问 `window`，
//   node 测试环境下直接 `ReferenceError: window is not defined`（2026-11-02 实测）。
//   唯一的真实使用者（设置页）请直连 './locale-install.js' / './locale-manifest.js'。
export { getLocaleBundle, getLocaleCoverage, localeUrl, onLocaleChange, preloadLocales, t, tOr, } from './locale-store.js';
export { detectSystemLocale, getLanguage, getLocale, getLocaleLabel, initializeI18n, resetI18nForTest, setLanguage, setLocale, startI18nSync, } from './runtime.js';
export { LOCALE_CODES, LOCALE_LABELS, SOURCE_LOCALE, isLocaleCode } from './translate.js';
