/**
 * 设置页 UI 绑定（外观主题 / 列表类型 / 时间筛选 / 刷新间隔 / 同步记录开关）
 * @module ui/handlers/settings-bindings
 * @description 从 handlers/index.ts 抽出：各设置控件的 change 处理器与时间筛选控件初始化。
 */
import type { LocaleCode } from '../../i18n/translate.js';
export declare const handleEnableSyncRecordChange: () => void;
export declare const handleLogLevelFilterChange: () => void;
/** 设置页「📜 日志偏好」：全局日志记录级别（0=DEBUG … 3=ERROR） */
export declare const handleLogLevelChange: () => void;
/**
 * 同步日夜开关的视觉 / 无障碍状态（momo：用 CodePen 那种太阳月亮按钮替代色卡预览）
 *
 * 开关只有「开 = 深色 / 关 = 浅色」两态，而主题模式有四种：`system` 与 `schedule`
 * 的最终色取决于运行时解析，因此开关状态一律以 `<html data-theme>` 的**实际值**为准，
 * 说明文字才展示用户选的是哪种模式（避免「选了跟随系统，开关却显示浅色」的困惑）。
 */
export declare function updateThemeToggle(mode: string): void;
/** 同步模式按钮组的 active 与定时框显隐 */
export declare function updateThemeModeButtons(mode: string): void;
export declare const handleThemeModeClick: (event: Event) => void;
/** 定时时刻变更：保存后立即按新时刻解析一次（不等 30s 轮询） */
export declare const handleThemeScheduleChange: () => void;
export declare const handleThemeChange: () => void;
/**
 * 日夜开关点击：在深色 / 浅色之间切换，并以开关中心为圆心做扩散动画
 *
 * 当前是 `system` / `schedule` 时同样可用 —— 用户按开关就是想要一个确定的颜色，
 * 于是直接落成显式的 dark / light（模式按钮组的高亮随之切换）。
 */
export declare const handleThemeToggleClick: (event: Event) => void;
/** 同步模态框按钮位置的分段按钮与说明 */
export declare function updateModalButtonsPositionButtons(position: string): void;
/**
 * 模态框按钮位置切换（momo：按钮可放到模态框之外，右上角）
 *
 * 只写配置 + 同步按钮态：真正的类名切换发生在各模态框**打开时**
 * （conditional-format-page 的 showXxxMask 里读配置套
 * `conditional-format-modal--buttons-outside`）——跨窗格不做即时同步，
 * 下次打开即生效，与「高亮模式上移设置页」同策略。
 */
export declare const handleModalButtonsPositionClick: (event: Event) => void;
/** 同步聚类口径分段按钮的 active / aria 状态 */
export declare function updateClusterModeButtons(mode: string): void;
/**
 * 自动聚类口径切换（条件格式页「自动聚类」按钮按它分组）
 *
 * 只写配置 + 同步按钮态：条件格式页每次点「自动聚类」都现读口径，
 * 不做跨窗格即时重算 —— 那边是用户主动触发的操作，静默重排分组反而会打断。
 */
export declare const handleClusterModeClick: (event: Event) => void;
/** 同步合并口径分段按钮的 active / aria 状态 */
export declare function updateMergeModeButtons(mode: string): void;
/** 合并口径切换（条件格式页「合并重复项」按钮按它合并） */
export declare const handleMergeModeClick: (event: Event) => void;
export declare const handleListTypeChange: () => void;
export declare const handleTimeFilterChange: () => void;
export declare const handleRefreshIntervalChange: () => void;
/**
 * 初始化时间筛选控件的显示/隐藏逻辑
 * - 勾选「启用时间筛选」时显示筛选控件区域
 * - 筛选范围切换时显示/隐藏季度/月份下拉框
 * - 选择「预告/未来动漫」时隐藏年份/季度/月份，显示提示
 */
export declare function setupTimeFilterControls(): void;
/**
 * 同步语言分段按钮的 active / aria 状态，并刷新覆盖率提示
 *
 * 覆盖率只对**非源语言**显示：简体是基准，显示「已翻译 100%」没有信息量，
 * 反而会让人以为「还有 0% 没翻」。
 */
export declare function updateLanguageButtons(code: LocaleCode): void;
/**
 * 语言切换
 *
 * 乐观更新按钮态（点下去立刻有反馈），`setLocale` 失败再回滚——语言包缺失是
 * 真实可能（用户手动删过 `locales/<code>/`），不能假装切成功。
 *
 * 成功后的 toast 用**新语言**渲染：`setLocale` 内部已经 `applyI18n()` 过，
 * 此时 `t()` 取到的就是新文案，用户能立刻看到切换生效。
 */
export declare const handleLanguageClick: (event: Event) => void;
/**
 * 刷新状态行：列出每个语言「已装的版本」
 *
 * 只读内存里已加载的语言包，不碰磁盘也不联网——`version` / `updatedAt` 就在包头上。
 * 首次进入设置页时语言包还在异步加载，所以这条要在 `onLocaleChange` 之后才准。
 */
export declare function refreshLocalePackStatus(): void;
/**
 * 「更新语言包」：读清单 → 下载 → 校验 → 落盘 → 重渲染
 *
 * 语言包是随插件发布的，这个按钮只在两种情况下有意义：用户删坏过 `locales/`，
 * 或者想拿到比当前插件更新的译文。两条路都要走「下载 + 校验」，所以不区分。
 */
export declare function handleLocalePackInstall(): Promise<void>;
/** 「打开语言包目录」：交给资源管理器，方便手动拖入 */
export declare function handleLocalePackOpenDirectory(): void;
//# sourceMappingURL=settings-bindings.d.ts.map