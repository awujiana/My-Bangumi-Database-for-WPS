/**
 * 通用进度组件
 * @module ui/components/progress
 * @description
 * 统一的进度展示组件，支持三种渲染模式：
 *  - `modal`：全屏遮罩弹窗（同步等阻塞型长任务，含暂停/停止/日志/完成态仪表盘）
 *  - `inline`：嵌入页面容器的行内进度条（清理页、富化页等面板内任务）
 *  - `detach`：浮动于页面角落的独立卡片（不阻塞用户继续操作）
 *
 * 设计要点：
 *  1. 引擎侧协议不变，仍是 `onProgress(current, total, message)`；
 *  2. 完成态内容由调用方注入 HTML（同步的统计图表、清理的摘要等），
 *     组件只负责进度条、日志、按钮与三态（运行 / 完成 / 隐藏）切换；
 *  3. 所有外部注入的 HTML 一律经 `sanitizeHtml` 净化，防 XSS。
 */
/** 进度组件渲染模式 */
export type ProgressMode = 'modal' | 'inline' | 'detach';
/** 进度组件回调集合（全部可选，未提供的能力对应按钮不渲染） */
export interface ProgressHandlers {
    /** 点击暂停 */
    onPause?: () => void;
    /** 点击继续 */
    onResume?: () => void;
    /** 点击停止 */
    onStop?: () => void;
    /** 弹窗关闭（含完成态关闭与运行中关闭） */
    onClose?: () => void;
}
/** 显示进度组件的可选项 */
export interface ProgressShowOptions extends ProgressHandlers {
    /** 标题（如「正在同步」「正在清理」） */
    title: string;
    /** 标题前置图标，默认 🔄 */
    icon?: string;
    /** 渲染模式 */
    mode: ProgressMode;
    /**
     * `mode: 'inline'` 时的宿主容器元素 id（必填）。
     * 组件会把 DOM 挂载进该容器，隐藏时清空容器。
     */
    hostId?: string;
    /** 顶部配置摘要 HTML（已净化前的原始串，内部会 sanitize） */
    configHtml?: string;
    /** 是否显示实时日志面板，默认 false */
    enableLogs?: boolean;
    /** 是否渲染暂停/继续按钮，默认 false */
    enablePause?: boolean;
    /** 是否渲染停止按钮，默认 false */
    enableStop?: boolean;
    /** 是否显示标题栏（含图标与右上角关闭），`modal` 默认 true，`inline` 默认 false */
    showHeader?: boolean;
    /**
     * 阶段名列表（如 `['下载', '比对', '写入']`）。
     *
     * 提供时进度条上方渲染一条阶段时间线，调用方用 `controller.setPhase(i)` 推进。
     * 不提供则不渲染——既有调用方行为完全不变。
     *
     * 动机：同步一次要跑好几个阶段，进度条只给总数，卡在「下载」还是「写入」
     * 只能翻日志；时间线把当前阶段与已完成阶段的耗时直接摆出来。
     */
    phases?: readonly string[];
    /** 完成态标题（不传则用图标区分成功/停止） */
    doneTitle?: string;
}
/** 完成态参数 */
export interface ProgressCompleteOptions {
    /** 摘要文本（纯文本，内部以 textContent 写入） */
    summary: string;
    /** 完成态自定义 HTML（统计图表等；内部会 sanitize） */
    resultHtml?: string;
    /** 详情文本行（无 detailsHtml 时的降级展示，纯文本） */
    details?: string[];
    /** 详情区自定义 HTML（明细表格等；优先于 details，内部会 sanitize） */
    detailsHtml?: string;
    /** 是否正常完成（false 表示被用户停止），默认 true */
    ok?: boolean;
    /** 完成态标题，默认 ok ? '执行完成' : '已停止' */
    doneTitle?: string;
    /** 完成态图标，默认 ok ? '✅' : '⏹️' */
    icon?: string;
    /** 提供时渲染「下一步」按钮 */
    onNext?: () => void;
}
/** 进度组件实例句柄 */
export interface ProgressController {
    /** 当前渲染模式 */
    readonly mode: ProgressMode;
    /** 更新进度 */
    update(current: number, total: number, message?: string, eta?: string): void;
    /** 追加一行日志（未启用日志面板时静默忽略） */
    log(line: string): void;
    /** 手动切换暂停态的按钮外观（不触发回调，用于引擎侧暂停状态与按钮同步） */
    setPaused(isPaused: boolean): void;
    /** 切换为完成态 */
    complete(options: ProgressCompleteOptions): void;
    /**
     * 切到指定阶段（配合 `phases` 使用）。
     *
     * 把之前的阶段标为「已完成」（并记录耗时），指定的标为「进行中」。
     * 未启用阶段时间线时静默忽略——调用方不必分支判断。
     */
    setPhase(index: number): void;
    /** 隐藏并销毁 */
    hide(): void;
    /** 是否处于可见（运行或完成）状态 */
    isActive(): boolean;
}
/**
 * 格式化耗时为可读字符串。
 *
 * 实现已下沉到 `tools/util/duration.ts`（全项目唯一一份 —— `sync/` 层也要用它，
 * 而 `sync/` 不得反向依赖 `ui/`）。此处保留同名转出，既有调用方无需改动。
 */
export { formatDuration } from '../../tools/util/duration.js';
/**
 * 创建并显示一个进度组件实例
 * @param options 显示参数（模式、标题、能力开关与回调）
 * @returns 进度组件句柄；宿主容器缺失时返回 null（inline 模式专用）
 */
export declare function createProgress(options: ProgressShowOptions): ProgressController | null;
/**
 * 显示进度组件并置为当前活跃实例
 * @returns 句柄；宿主缺失时返回 null
 */
export declare function showProgress(options: ProgressShowOptions): ProgressController | null;
/** 更新当前活跃实例进度（无实例时静默忽略） */
export declare function updateProgress(current: number, total: number, message?: string, eta?: string): void;
/** 向当前活跃实例追加日志（无实例或未启用日志时静默忽略） */
export declare function appendProgressLog(line: string): void;
/** 切换当前活跃实例为完成态 */
export declare function completeProgress(options: ProgressCompleteOptions): void;
/** 隐藏并销毁当前活跃实例 */
export declare function hideProgress(): void;
/** 获取当前活跃实例（供调用方按需直接操作） */
export declare function getActiveProgress(): ProgressController | null;
//# sourceMappingURL=progress.d.ts.map