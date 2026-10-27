/**
 * @fileoverview 调试面板渲染层：宿主全局读取、常量与 HTML 模板构建。
 * @module debugPanelRender
 * @description
 *   - 与 `debug-panel.ts`（交互 / 生命周期 / 自动启动）分离，本模块**无 import 时副作用**，可直接单测。
 *   - `window` 上的调试全局集中经 `getDebugGlobals()` 单点断言，避免 `as unknown as` 散布全文件。
 */
export interface ModuleStatus {
    src: string;
    loaded: boolean;
    critical: boolean;
    error?: string;
}
export interface RibbonButtonInfo {
    id: string;
    label: string;
    icon: string;
}
/** 调试面板读取的宿主 window 全局（形状集中在此单点断言） */
export interface DebugGlobals {
    WpsInvoke?: unknown;
    _bgmRibbonReady?: (onAddinLoad: unknown, onAction: unknown, getImage: unknown) => void;
    _ribbonReady?: boolean;
    OnAddinLoad?: unknown;
    OnAction?: (control: {
        Id: string;
    }) => boolean;
    GetBangumiImage?: (control: {
        Id: string;
    }) => string;
    GetIncrementalSyncPressed?: unknown;
    DOMPurify?: unknown;
    z?: unknown;
    __BGM_MODULE_STATUS__?: ModuleStatus[];
}
/** 单点完成 `window → 已知形状` 断言（本文件唯一的 cast） */
export declare function getDebugGlobals(): DebugGlobals;
/** ribbon.xml 中定义的所有按钮（与 ribbon.ts icons map 同步） */
export declare const RIBBON_BUTTONS: readonly RibbonButtonInfo[];
/** 日志级别筛选选项 */
export declare const LOG_FILTERS: readonly {
    label: string;
    level: string | undefined;
}[];
/** 检测是否为调试环境（无 WpsInvoke 即为开发服务器） */
export declare function isDebugEnvironment(): boolean;
/** 从 window.__BGM_MODULE_STATUS__ 读取模块加载状态 */
export declare function getModuleStatuses(): ModuleStatus[];
export declare function escapeHtml(text: string): string;
export declare function buildHeaderHTML(): string;
export declare function buildStatusBarHTML(modules: ModuleStatus[]): string;
export declare function buildTabsHTML(logCount: number): string;
export declare function buildModulesPanelHTML(): string;
export declare function buildRibbonPanelHTML(): string;
export declare function buildConsolePanelHTML(): string;
export declare function buildEnvironmentPanelHTML(): string;
//# sourceMappingURL=debug-panel-render.d.ts.map