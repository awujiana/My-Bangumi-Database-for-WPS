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
import type { LocaleCode } from './translate.js';
/** 切语言时的选项 */
export interface SetLocaleOptions {
    /** 是否写入配置（默认 true）；轮询回调里必须传 false，否则会自激循环 */
    persist?: boolean;
}
/** 按系统语言猜一个初始值（只在用户从没选过时用） */
export declare function detectSystemLocale(): LocaleCode;
/**
 * 用户想要的语言（配置值优先，没配过就按系统语言猜）
 *
 * 与 {@link getLocale} 的区别：这个是「意图」，那个是「此刻真的用着的」。
 * 语言包还没加载完时两者会不一致，界面一律以 `getLocale()` 为准。
 */
export declare function getLanguage(): LocaleCode;
/** 持久化语言偏好（只写配置，不切界面；切界面用 {@link setLocale}） */
export declare function setLanguage(code: LocaleCode): boolean;
/** 语言在列表里的显示名（优先用语言包自己的 `nativeName`） */
export declare function getLocaleLabel(code: LocaleCode): string;
/**
 * 切换语言并立即重渲染当前页面
 *
 * @returns 是否成功；目标语言包拉不到时返回 false 且**不切**——切过去只会满屏 key
 */
export declare function setLocale(code: LocaleCode, options?: SetLocaleOptions): Promise<boolean>;
/** 当前页面正在用的语言 */
export declare function getLocale(): LocaleCode;
/**
 * 监听语言配置变化（各页面入口调用一次，幂等）
 *
 * 变化时只重渲染，**不写配置**（`persist: false`）——否则「读到变化 → 写回 →
 * 又读到变化」会自激。
 */
export declare function startI18nSync(): () => void;
/**
 * 页面初始化：加载语言包 → 应用文案 → 起跨窗格同步
 *
 * 各页面入口（sync-panel / settings / clean / enrich / highlight / conditional-format /
 * donate）在启动阶段调用一次。加载是异步的（要 fetch 语言包），所以首帧可能
 * 还是 HTML 里的简体原文，加载完才切——这是有意的：**宁可晚 100ms 变，
 * 也不要把界面先刷成一片 key**。
 */
export declare function initializeI18n(): void;
/** 仅测试用：复位初始化标记与轮询 */
export declare function resetI18nForTest(): void;
//# sourceMappingURL=runtime.d.ts.map