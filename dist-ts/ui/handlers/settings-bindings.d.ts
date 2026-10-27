/**
 * 设置页 UI 绑定（外观主题 / 列表类型 / 时间筛选 / 刷新间隔 / 同步记录开关）
 * @module ui/handlers/settings-bindings
 * @description 从 handlers/index.ts 抽出：各设置控件的 change 处理器与时间筛选控件初始化。
 */
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
//# sourceMappingURL=settings-bindings.d.ts.map