/**
 * 语言包 · English. Missing keys fall back to zh-CN.
 *
 * 为什么是 .js 而不是 .json：安装态页面跑在 file:// 下，fetch 读本地文件
 * 会被 CEF 拦掉（真机实测 Failed to fetch），只有 ESM 的 import() 能读。
 * 内容仍是纯数据，不含任何逻辑。
 */
export default {
  "schemaVersion": 1,
  "code": "en",
  "name": "English",
  "nativeName": "English",
  "version": "2.3.0",
  "updatedAt": "2026-11-01",
  "messages": {
    "ribbon.wpsAddinTab": "Bangumi",
    "ribbon.bangumiGroup": "Bangumi",
    "ribbon.enrichGroup": "Anime Enrich",
    "ribbon.cleanGroup": "Data Cleanup",
    "ribbon.highlightGroup": "Anime Highlight",
    "ribbon.conditionalFormatGroup": "Conditional Format",
    "ribbon.buttonOpenSyncPanel": "Open Sync Panel",
    "ribbon.buttonSyncBangumi": "Upload & Sync",
    "ribbon.buttonSetToken": "Set Token",
    "ribbon.buttonTestToken": "Test Token",
    "ribbon.buttonCopyToken": "Copy Token",
    "ribbon.buttonSetUserId": "Set User ID",
    "ribbon.buttonOpenCollection": "Open Collection",
    "ribbon.buttonSyncFromGithub": "Sync Data",
    "ribbon.buttonUndoLastSync": "Undo Sync",
    "ribbon.buttonOpenDonatePanel": "Support",
    "ribbon.buttonOpenSettingsPanel": "Settings",
    "ribbon.buttonCloseAllPanels": "Close All Pages",
    "ribbon.buttonOpenEnrichPanel": "Anime Enrich",
    "ribbon.buttonOpenCleanPanel": "Data Cleanup",
    "ribbon.buttonOpenHighlightPanel": "Anime Highlight",
    "ribbon.buttonOpenConditionalFormatPanel": "Conditional Format",
    "ribbon.checkboxIncrementalSync": "Changed Only",
    "ribbon.checkboxSkipConflicts": "Skip Conflicts",
    "ribbon.checkboxEnableSyncRecord": "Sync Log",
    "settings.appearance.title": "🎨 Appearance & Navigation",
    "settings.appearance.collapseAria": "Collapse / expand Appearance & Navigation",
    "settings.appearance.themeLabel": "Theme",
    "settings.appearance.themeDark": "Dark",
    "settings.appearance.themeLight": "Light",
    "settings.appearance.themeSystem": "System",
    "settings.appearance.themeSchedule": "Schedule",
    "settings.appearance.themeHint": "Click Dark or Light to switch with a ripple from the button; System follows your OS appearance; Schedule switches daily at the two times below.",
    "settings.appearance.darkStart": "Dark starts",
    "settings.appearance.lightStart": "Light starts",
    "settings.appearance.scheduleHint": "Light between the two times, dark otherwise (e.g. 07:00 light → 19:00 dark). Overnight ranges are supported (dark 02:00, light 08:00 = dark at night).",
    "settings.appearance.languageLabel": "Language",
    "settings.appearance.languageHint": "Takes effect immediately, no WPS restart. Task panes switch right away; ribbon button labels change on the next WPS start (WPS only refreshes the tab title at runtime).",
    "settings.appearance.languageCoverage": "{percent}% translated",
    "settings.appearance.languageFallback": "Untranslated items fall back to Simplified Chinese.",
    "settings.appearance.languageApplied": "Language switched to \"{name}\"",
    "settings.appearance.languageFailed": "Failed to switch language (pack missing or corrupted)",
    "settings.appearance.languageGroupAria": "Language"
  }
};
