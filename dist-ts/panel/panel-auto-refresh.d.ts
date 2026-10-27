/**
 * 面板预览的「自动刷新」。
 *
 * @module panel/panel-auto-refresh
 * @description
 * 面板原先只在初始化 / 切换工作表 / 锁定 / 筛选时刷新预览，用户在 Excel 里
 * 改完数据切回面板看到的仍是旧内容，必须手动点刷新。
 *
 * 本模块提供**两条互补的触发源**，共用同一套防抖与闸门：
 *  1. `registerSheetChangeAutoRefresh` —— 订阅宿主 `SheetChange` 事件（单元格
 *     编辑即触发）。覆盖「面板一直可见、旁边改数据」的场景。宿主不支持时静默
 *     降级，不影响面板启动。
 *  2. `registerVisibilityRefresh` —— 监听 `window.focus` / `document.visibilitychange`
 *     两个 DOM 事件。覆盖「切走编辑 → 切回面板」的场景，零 COM、零宿主依赖，
 *     是所有宿主都支持的保底路径（SheetChange 在部分宿主版本上不可用）。
 *
 * 三条保护：
 *  1. **防抖**（默认 400ms）：连续敲键盘 / 批量粘贴只刷新一次；
 *  2. **shouldRefresh 闸门**：由页面决定「这次编辑是否影响当前预览」
 *     （例如只关心被锁定/选中的那张表）以及「是否正忙」（同步进行中跳过）；
 *  3. **清理函数**：返回 disposer，移除定时器与监听器（还原事件时仅当仍是
 *     我们挂的处理器，避免覆盖后续注册方）。
 */
import type { WpsWorksheet } from '../tools/wps.js';
/** 宿主事件的最小形状（只声明本模块用到的成员，便于测试直接传字面量） */
export interface SheetChangeHost {
    SheetChange?: ((sheet?: WpsWorksheet, target?: unknown) => void) | undefined;
}
export interface AutoRefreshOptions {
    /** 防抖窗口（毫秒），默认 400 */
    debounceMs?: number;
    /** 是否真的刷新（页面判断：编辑的是不是当前预览的表 / 是否正在同步） */
    shouldRefresh?: () => boolean;
}
/** 默认防抖窗口：比一次连续编辑的间隔长，比用户「感觉卡顿」的阈值短 */
export declare const AUTO_REFRESH_DEBOUNCE_MS = 400;
/**
 * 注册 `SheetChange` 自动刷新（宿主事件，覆盖「面板可见时旁边改数据」）。
 * @param app 宿主（WPS Application）
 * @param refresh 刷新回调（通常是面板的 refreshData）
 * @param options 防抖窗口与刷新闸门
 * @returns 清理函数（移除定时器 + 还原事件）
 */
export declare function registerSheetChangeAutoRefresh(app: SheetChangeHost | null | undefined, refresh: () => void, options?: AutoRefreshOptions): () => void;
/**
 * 注册「面板重新可见 / 重新获得焦点」自动刷新（DOM 事件，零宿主依赖）。
 *
 * 这是所有宿主都支持的保底路径：用户切到 Excel 改数据再切回任务窗格时，
 * WebView 会收到 `focus`（以及可能的 `visibilitychange`），此时刷新预览，
 * 正好对上「改完回来看到还是旧的」这条主诉。
 *
 * @param refresh 刷新回调
 * @param options 防抖窗口与刷新闸门
 * @returns 清理函数（移除定时器 + 解绑监听）
 */
export declare function registerVisibilityRefresh(refresh: () => void, options?: AutoRefreshOptions): () => void;
//# sourceMappingURL=panel-auto-refresh.d.ts.map